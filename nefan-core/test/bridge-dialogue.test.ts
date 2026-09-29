/** dialogue_choice: consequences, fail-loud (narrative_status: error) y plugin tick.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { NarrativeAiClient } from "../bridge/context.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
  } from "../src/protocol/messages.js";
import type { Consequence } from "../src/narrative/types.js";
import {
  capturarLogDelBridge,
  entrarEnLaPartida,
  makeCtx,
  makeSocket,
  porElBorde,
  waitFor,
} from "./helpers.js";

describe("bridge dialogue_choice", () => {
  async function startSession(ctxBundle: ReturnType<typeof makeCtx>) {
    const { socket, sent } = makeSocket();
    await porElBorde(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctxBundle.ctx,
    );
    assert.equal((sent[0] as SessionStartedMessage).ok, true);
    // Drenar el bootstrap encolado antes de seguir: sin esto, su scene_init
    // tardío se cuela entre los broadcasts del diálogo y el find() del test
    // pesca el narrative_event equivocado (carrera de microtasks).
    await waitFor(() =>
      ctxBundle.broadcasts.some(
        (m) => m.type === "narrative_status" && (m.phase === "ready" || m.phase === "error"),
      ),
    );
    return { socket, sent };
  }

  it("aplica las consequences y difunde narrative_event (incluido plugin tick)", async () => {
    const bundle = makeCtx();
    await startSession(bundle);
    const { ctx, broadcasts, narrative } = bundle;
    const counterId = [...ctx.activePlugins.entries()].find(
      ([, m]) => m.name === "test_counter",
    )![0];
    const consequences: Consequence[] = [
      { type: "story_update", delta: "El tabernero asiente." },
      { type: "plugin_event", plugin_id: counterId, event_type: "counter_inc", payload: {} },
    ];
    (bundle.ctx as { aiClient: NarrativeAiClient }).aiClient = {
      ...ctx.aiClient,
      reportPlayerChoice: async () => ({ ok: true, consequences }),
    };

    const before = broadcasts.length;
    const { socket } = makeSocket();
    await porElBorde(
      {
        type: "dialogue_choice",
        eventId: "ignored",
        choiceIndex: 0,
        speaker: "Boris",
        chosenText: "¿Qué vendes?",
      },
      socket,
      ctx,
    );
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event, "narrative_event difundido");
    assert.deepEqual(event.consequences, consequences);
    // story_update aplicado al estado + plugin tick aplicado al slice.
    assert.ok(narrative.story_so_far.includes("El tabernero asiente."));
    assert.deepEqual(narrative.pluginDelManifest(counterId)?.slice, { count: 1 });
    assert.ok(event.effects.some((e) => e.kind === "plugin_applied"));
  });

  it("difunde narrative_status: error si el motor narrativo falla (fail-loud)", async () => {
    const bundle = makeCtx({
      ai: { reportPlayerChoice: async () => ({ ok: false, error: "timeout esperando a Claude" }) },
    });
    await startSession(bundle);
    const { ctx, broadcasts } = bundle;
    const before = broadcasts.length;
    const { socket } = makeSocket();
    await porElBorde(
      {
        type: "dialogue_choice",
        eventId: "ignored",
        choiceIndex: 1,
        speaker: "Boris",
        chosenText: "Adiós",
      },
      socket,
      ctx,
    );
    const err = broadcasts
      .slice(before)
      .find(
        (m): m is NarrativeStatusMessage =>
          m.type === "narrative_status" && m.phase === "error" && m.kind === "consequences",
      );
    assert.ok(err, "narrative_status error difundido");
    assert.equal(err.causaReaccion, "conexion", "el titular recibe la misma causa que el consejo");
    // El cuerpo va TRADUCIDO, no crudo (QA 2026-09-01, H-3): hasta hoy esto
    // difundía `Narrative engine error: timeout esperando a Claude` y el
    // cliente lo pintaba verbatim a pantalla completa, en inglés y con el
    // volcado dentro. El crudo no se pierde: sigue en el `console.warn` del
    // bridge, que es donde sirve.
    assert.equal(
      err.message,
      "El motor narrativo no responde; inténtalo de nuevo en un momento.",
    );
    assert.ok(
      !err.message?.includes("timeout esperando a Claude"),
      "el volcado del motor no puede llegar a la pantalla del jugador",
    );
  });

  it("un save que falla tras la reacción AVISA al jugador y no se traga los efectos", async () => {
    // El agujero B de la revisión 2026-09-01: el tramo post-`result.ok` no
    // protegía el save(), así que un disco lleno (ENOSPC) tras aplicar las
    // consequences se tragaba el narrative_event ENTERO — el diálogo aplicado
    // en memoria y el jugador mirando un modal que no iba a responder nunca.
    // Con el fix (patrón simulation.ts) tienen que difundirse LAS DOS COSAS:
    // el aviso del guardado y el evento con sus efectos.
    const consequences: Consequence[] = [
      { type: "dialogue", speaker: "Boris", text: "Te escucho.", choices: ["Sigue"] },
    ];
    const bundle = makeCtx({
      ai: { reportPlayerChoice: async () => ({ ok: true, consequences }) },
    });
    await startSession(bundle);
    const { ctx, broadcasts, narrative } = bundle;
    narrative.save = async () => {
      throw new Error("ENOSPC: no space left on device");
    };
    const before = broadcasts.length;
    const { socket } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await porElBorde(
        {
          type: "dialogue_choice",
          eventId: "ignored",
          choiceIndex: 0,
          speaker: "Boris",
          chosenText: "Escúchame",
        },
        socket,
        ctx,
      );
    } finally {
      log.soltar();
    }
    // `kind: "save"` y no `"consequences"` (#352): la reacción del motor
    // llegó y se aplicó — lo que falló es el disco. Con el kind viejo este
    // aviso salía bajo «El motor narrativo rechazó la respuesta», que es
    // justamente lo contrario de lo que había pasado. El aserto va por el kind
    // y no solo por el texto porque el kind es lo que elige el TITULAR.
    const err = broadcasts
      .slice(before)
      .find(
        (m): m is NarrativeStatusMessage =>
          m.type === "narrative_status" && m.phase === "error" && m.kind === "save",
      );
    assert.ok(err, "el fallo de guardado tiene que llegar al jugador");
    // El cuerpo EMPIEZA POR LA CONSECUENCIA (QA 2026-09-01, H-4): decía «No se
    // pudo guardar la partida tras esta reacción: …», o sea el titular otra
    // vez, y el jugador leía la misma frase dos veces. Se afirman las dos
    // mitades —lo que dice y lo que ya NO repite— porque si solo se mirara el
    // texto nuevo, volver a meter el titular delante saldría verde.
    assert.equal(
      err.message,
      "Lo que acaba de pasar en esta conversación podría faltar si reanudas.",
    );
    assert.ok(
      !err.message?.includes("No se pudo guardar la partida"),
      "el cuerpo no repite el titular que ya está encima",
    );
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event, "los efectos de la reacción se difunden IGUALMENTE");
    assert.deepEqual(event.consequences, consequences);
    // El detalle técnico (ENOSPC), en el log del bridge.
    assert.match(log.lineas.join(" | "), /ENOSPC/);
  });

  it("interact_entity pasa por el mismo ciclo y difunde narrative_event", async () => {
    const bundle = makeCtx({
      ai: {
        reportPlayerChoice: async () => ({
          ok: true,
          consequences: [
            { type: "dialogue", speaker: "Boris", text: "¡Bienvenido!", choices: ["Hola"] },
          ] as Consequence[],
        }),
      },
    });
    await startSession(bundle);
    const { ctx, broadcasts, aiCalls } = bundle;
    const before = broadcasts.length;
    const { socket } = makeSocket();
    await porElBorde(
      { type: "interact_entity", entityId: "boris", entityName: "Boris" },
      socket,
      ctx,
    );
    // El saludo va en primera persona como free_text (framing del prompt).
    const call = aiCalls.choice.at(-1) as { freeText: string; speaker: string };
    assert.equal(call.speaker, "Boris");
    assert.ok(call.freeText.length > 0);
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event);
    assert.equal(event.consequences[0].type, "dialogue");
  });
});


/** #613, pieza D: la ÚNICA curación del juego es la del motor (decisión del
 *  usuario 2026-09-29, «se cura por consecuencias»). Todo por el borde: la
 *  reacción entra por `dialogue_choice` con la consequence `player_healed`, y
 *  se afirma en los TRES sitios donde tiene que acabar — el sim (lo que manda
 *  el siguiente `state_update`), el store y el `state.json` guardado en el
 *  mismo turno. */
describe("bridge: player_healed cura al jugador (#613)", () => {
  async function curarCon(amount: number, vidaAntes: number) {
    const bundle = makeCtx({
      ai: { reportPlayerChoice: async () => ({ ok: true, consequences: [{ type: "player_healed", amount }] }) },
    });
    const { ctx, sim, store, storage } = bundle;
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);
    const player = sim.getCombatant("player")!;
    assert.equal(player.maxHealth, 100, "premisa: el jugador de la sesión tiene 100 de máximo");
    player.health = vidaAntes;
    await porElBorde(
      { type: "dialogue_choice", eventId: "e", choiceIndex: 0, speaker: "Curandera", chosenText: "Dame la poción" },
      socket,
      ctx,
    );
    const guardado = (await storage.read(sessionId))!;
    return { sim: player.health, store: store.state.player.hp, disco: guardado.player.health };
  }

  it("a un herido le suma la cantidad, en el sim, el store y el save del turno", async () => {
    assert.deepEqual(await curarCon(25, 50), { sim: 75, store: 75, disco: 75 });
  });

  it("topa en el máximo: 90 + 25 son 100, no 115", async () => {
    assert.deepEqual(await curarCon(25, 90), { sim: 100, store: 100, disco: 100 });
  });

  /** QA H3 de BN: un caído no habla. La conversación no llega al motor, el
   *  jugador sigue a 0 y el bridge contesta al socket con `kind:"despertar"`
   *  —«Estás caído»—. (Que `player_healed` no levante a un muerto lo sujeta
   *  el unitario de `curarAlJugador`: por aquí la cura ni se pide.) */
  it("un caído no habla: el diálogo se rechaza, no llega al motor y lo dice", async () => {
    const bundle = makeCtx({
      ai: { reportPlayerChoice: async () => ({ ok: true, consequences: [{ type: "player_healed", amount: 25 }] }) },
    });
    const { ctx, sim, aiCalls } = bundle;
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);
    sim.getCombatant("player")!.health = 0;
    const antes = sent.length;
    await porElBorde(
      { type: "dialogue_choice", eventId: "e", choiceIndex: 0, speaker: "Curandera", chosenText: "Dame la poción" },
      socket,
      ctx,
    );
    assert.equal(aiCalls.choice.length, 0, "el motor no se entera");
    assert.equal(sim.getCombatant("player")!.health, 0);
    const aviso = sent.slice(antes).find((m) => m.type === "narrative_status") as NarrativeStatusMessage | undefined;
    assert.equal((aviso as { kind?: string } | undefined)?.kind, "despertar");
    assert.match(aviso?.message ?? "", /Estás caído/);
  });});
