/** Handlers de interacción narrativa: dialogue_choice e interact_entity.
 *  Ambos comparten el mismo ciclo: registrar el evento en NarrativeState,
 *  reportarlo al motor narrativo, aplicar las consequences y hacer broadcast. */

import { dispatchConsequences } from "../../src/narrative/consequence-handler.js";
import { npcSync, runPluginTick, type BridgeContext } from "../context.js";
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
): Promise<void> {
  const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  const result = await ctx.aiClient.reportPlayerChoice({
    eventId,
    speaker,
    chosenText,
    freeText,
    context: llmCtx,
  });
  if (!result.ok) {
    console.warn(`Bridge: reportPlayerChoice (${logLabel}) failed for ${eventId}: ${result.error}`);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "consequences",
      message: `Narrative engine error: ${result.error}`,
    });
    return;
  }
  const consequences = result.consequences;
  const playerPos = ctx.store.state.player.pos;
  const dispatched = dispatchConsequences(ctx.narrative, eventId, consequences, {
    playerPosition: { x: playerPos[0], y: playerPos[1], z: playerPos[2] },
    playerForward: { x: 0, y: 0, z: -1 },
  });
  const pluginFx = runPluginTick(ctx, eventId, dispatched.pluginEvents);
  await ctx.narrative.save();
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
  await reportAndDispatch(ctx, eventId, msg.speaker, msg.chosenText, msg.freeText ?? "", "dialogue_choice");
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
  );
}
