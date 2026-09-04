/** Handlers de interacción narrativa: dialogue_choice e interact_entity.
 *  Ambos comparten el mismo ciclo: registrar el evento en NarrativeState,
 *  reportarlo al motor narrativo, aplicar las consequences y hacer broadcast. */

import { dispatchConsequences } from "../../src/narrative/consequence-handler.js";
import { motivoDeReaccionParaElJugador } from "../../src/protocol/status-motivo.js";
import { npcSync, runPluginTick, sessionChangedError, type BridgeContext } from "../context.js";
import type {
  DialogueChoiceMessage,
  InteractEntityMessage,
} from "../../src/protocol/messages.js";

/** Reporta la elección al motor narrativo y, si responde, aplica y difunde
 *  las consequences. En fallo difunde narrative_status: error (patrón
 *  fail-loud del bridge — el cliente que espera no se queda colgado). */
async function reportAndDispatch(
  ctx: BridgeContext,
  eventId: string,
  speaker: string,
  chosenText: string,
  freeText: string,
  logLabel: string,
  /** Entidad con la que se está hablando: desambigua al hablante cuando el
   *  motor devuelve un nombre repetido (tres "Guardia" en la misma plaza). */
  speakerHintId?: string,
): Promise<void> {
  const jobSession = ctx.narrative.session_id;
  const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  const result = await ctx.aiClient.reportPlayerChoice({
    eventId,
    speaker,
    chosenText,
    freeText,
    context: llmCtx,
  });
  // Defensa en profundidad (mismo patrón que los jobs de generación): si un
  // start/resume pisó la sesión durante el await, las consequences NO se
  // aplican a la sesión nueva.
  const changed = sessionChangedError(ctx, jobSession);
  if (changed) {
    console.warn(`Bridge: reportPlayerChoice (${logLabel}) descartado — ${changed}`);
    // `takeover` y no `consequences` (#352): lo que ha pasado es que otro
    // cliente tomó esta partida mientras el motor pensaba. El motor no ha
    // rechazado nada — su respuesta es la que se está tirando.
    //
    // Y el CUERPO no es `changed` (QA 2026-09-01, H-3): esa cadena la escribe
    // `sessionChangedError` para el LOG y lleva dentro los dos session-id
    // («era 1788…-abc, ahora 1788…-def — resultado descartado sin escribir»),
    // que a pantalla completa es un volcado. El detalle técnico no se pierde:
    // está entero en el `console.warn` de la línea de arriba, que es donde
    // sirve.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "takeover",
      message:
        "Esta partida se ha abierto en otro sitio y lo que acabas de decir no se ha guardado. " +
        "Vuelve al título y reanúdala para seguir jugando aquí.",
    });
    return;
  }
  if (!result.ok) {
    console.warn(`Bridge: reportPlayerChoice (${logLabel}) failed for ${eventId}: ${result.error}`);
    // El ÚNICO rechazo real del motor, y hasta hoy el único de los siete cuyo
    // cuerpo estaba en INGLÉS y con el volcado dentro («Narrative engine
    // error: …»). El titular ya era cierto; lo que el jugador leía debajo, no
    // era ni suyo ni su idioma (QA 2026-09-01, H-3). El crudo sigue entero en
    // el `console.warn` de arriba.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "consequences",
      message: motivoDeReaccionParaElJugador(result.error),
    });
    return;
  }
  const consequences = result.consequences;
  const playerPos = ctx.store.state.player.pos;
  const dispatched = dispatchConsequences(ctx.narrative, eventId, consequences, {
    playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
    playerForward: { x: 0, y: 0, z: -1 },
    speakerHintId,
  });
  const pluginFx = runPluginTick(ctx, eventId, dispatched.pluginEvents);
  // Fail-loud del bridge (patrón de simulation.ts): si el guardado falla
  // (ENOSPC, permisos), la reacción YA vive en memoria y el jugador tiene que
  // ver sus efectos igualmente — se avisa del save y el turno sigue. Sin este
  // catch, el throw se tragaba el narrative_event entero y el modal de diálogo
  // se quedaba esperando una respuesta que no iba a llegar.
  await ctx.narrative.save().catch((err: unknown) => {
    console.error(`Bridge: no se pudo guardar tras la reacción (${logLabel}):`, err);
    // `save` y no `consequences` (#352): la reacción SÍ llegó y ya vive en
    // memoria — lo que ha fallado es escribirla en disco.
    //
    // El cuerpo EMPIEZA POR LA CONSECUENCIA y no repite el titular (QA
    // 2026-09-01, H-4): decía «No se pudo guardar la partida tras esta
    // reacción: …» debajo de «No se pudo guardar la partida», así que el
    // jugador leía la misma frase dos veces y lo único nuevo quedaba al final
    // de la segunda. Con el titular puesto, el cuerpo solo tiene que contar
    // qué se pierde.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "save",
      message: "Lo que acaba de pasar en esta conversación podría faltar si reanudas.",
    });
  });
  // Un spawn_entity dinámico puede haber creado NPCs — engancharlos a la
  // vida ambiental sin esperar al siguiente cambio de tile.
  npcSync(ctx);
  ctx.broadcastNarrative({
    type: "narrative_event",
    eventId,
    consequences,
    effects: [...dispatched.effects, ...pluginFx],
  });
}

export async function handleDialogueChoice(
  msg: DialogueChoiceMessage,
  ctx: BridgeContext,
): Promise<void> {
  const eventId = ctx.narrative.recordDialogueEvent(
    msg.speaker,
    msg.chosenText,
    [],
    msg.choiceIndex,
    msg.freeText ?? "",
  );
  await reportAndDispatch(
    ctx,
    eventId,
    msg.speaker,
    msg.chosenText,
    msg.freeText ?? "",
    "dialogue_choice",
    msg.speakerId,
  );
}

export async function handleInteractEntity(
  msg: InteractEntityMessage,
  ctx: BridgeContext,
): Promise<void> {
  // The player walked up to an NPC and pressed E. Report it to the
  // narrative engine via the same path as a dialogue choice; it replies
  // with consequences (a `dialogue` effect that opens the dialogue UI).
  //
  // Framing matters: a parenthetical stage direction like "(el jugador
  // inicia conversación con X)" reads as narration and nudges the engine
  // to answer with a story_update (3rd-person narration) instead of a
  // `dialogue` consequence — so the dialogue modal never opens. We send
  // an explicit first-person greeting as the player's line plus an
  // approach marker in chosen_text; the engine then naturally replies
  // AS the NPC. The MCP prompt's narrative_event section reinforces that
  // an approach/greeting MUST open with the NPC speaking.
  const approachLine = "Saludos. ¿Puedes hablar conmigo un momento?";
  const chosenText = "(el jugador se acerca y saluda)";
  const eventId = ctx.narrative.recordDialogueEvent(
    msg.entityName,
    chosenText,
    [],
    -1,
    approachLine,
  );
  await reportAndDispatch(
    ctx,
    eventId,
    msg.entityName,
    chosenText,
    approachLine,
    `interact_entity ${msg.entityName}`,
    msg.entityId,
  );
}
