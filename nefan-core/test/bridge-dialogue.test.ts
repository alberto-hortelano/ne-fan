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
import type { EnemyPersonality } from "../src/types.js";
import { createCombatant } from "../src/combat/combatant.js";
import { FIN_DE_CONVERSACION } from "../bridge/handlers/dialogue.js";
import { jugadorCaido } from "../bridge/handlers/despertar.js";
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

/** Tanda BW, H1: la réplica del motor a un turno del jugador se decide en el
 *  bridge AL LLEGAR. El motor falso cambia el mundo MIENTRAS «piensa» —lo que
 *  pasó jugando: el jugador se fue de viaje, se alejó o empezó una pelea— y
 *  el broadcast tiene que traer `replica_diferida` con el texto del motor
 *  intacto. Sin cambiar nada, el `show_dialogue` de siempre. */
describe("bridge: la réplica tardía no abre el panel (tanda BW)", () => {
  const TEXTO = "¡Eso, eso, encárgate de Brasco!";
  const bravucon: EnemyPersonality = {
    aggression: 1,
    preferred_attacks: ["quick"],
    reaction_time: 0.1,
    combat_range: 4,
    aggro_radius: 6,
  };

  async function replicaCon(
    mientrasPiensa: (b: ReturnType<typeof makeCtx>) => void | Promise<void>,
    mensaje: "dialogue_choice" | "interact_entity" = "dialogue_choice",
  ) {
    const bundle: ReturnType<typeof makeCtx> = makeCtx({
      ai: {
        reportPlayerChoice: async () => {
          await mientrasPiensa(bundle);
          return {
            ok: true,
            consequences: [{ type: "dialogue", speaker: "Orio", text: TEXTO, choices: ["Voy"] }] as Consequence[],
          };
        },
      },
    });
    const { ctx, broadcasts, narrative } = bundle;
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await entrarEnLaPartida(ctx, socket, (sent[0] as SessionStartedMessage).sessionId!);
    // Orio, a 3 m del jugador (que está en el origen), en el tile activo.
    narrative.recordEntitySpawned("orio", "npc", narrative.world.active_scene_id, { x: 3, y: 0, z: 0 }, { name: "Orio" });
    const before = broadcasts.length;
    await porElBorde(
      mensaje === "dialogue_choice"
        ? { type: "dialogue_choice", eventId: "e", choiceIndex: 0, speaker: "Orio", chosenText: "Me encargo", speakerId: "orio" }
        : { type: "interact_entity", entityId: "orio", entityName: "Orio" },
      socket,
      ctx,
    );
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event, "narrative_event difundido");
    return event.effects;
  }

  it("esperando al lado, el panel se abre como siempre (show_dialogue con sus opciones)", async () => {
    const effects = await replicaCon(() => {});
    assert.equal(effects.length, 1);
    const d = effects[0]!;
    assert.equal(d.kind, "show_dialogue");
    if (d.kind === "show_dialogue") {
      assert.equal(d.text, TEXTO);
      assert.equal(d.speakerId, "orio");
      assert.deepEqual(d.choices, ["Voy"]);
    }
  });

  it("el jugador se aleja más allá del alcance del nombre → replica_diferida «lejos»", async () => {
    const effects = await replicaCon(({ store }) => store.dispatch("player_moved", { pos: [0, 0, 40] }));
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "lejos", hayPelea: false },
    ]);
  });

  it("el jugador cambia de tile mientras el motor piensa → replica_diferida «otro_tile»", async () => {
    const effects = await replicaCon(({ narrative }) => {
      narrative.world.active_scene_id = "tile_0_-1";
    });
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "otro_tile", hayPelea: false },
    ]);
  });

  it("el jugador pide un VIAJE mientras el motor piensa y aún no ha llegado → replica_diferida «viaje» (QA, 344)", async () => {
    const effects = await replicaCon(({ ctx }) => {
      // Un viaje bloqueante que no termina durante el test: el tile y la
      // posición son aún los de salida, como en el guion 344.
      ctx.sceneGen.enqueue({ key: "place_molino", blocking: true, run: () => new Promise(() => {}) });
      assert.equal(ctx.sceneGen.viajeEnCurso, true, "premisa: hay un viaje en curso");
    });
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "viaje", hayPelea: false },
    ]);
  });

  it("un PREFETCH en curso no es un viaje: el panel se abre", async () => {
    const effects = await replicaCon(({ ctx }) => {
      ctx.sceneGen.enqueue({ key: "tile_1_0", blocking: false, run: () => new Promise(() => {}) });
    });
    assert.equal(effects[0]?.kind, "show_dialogue");
  });

  const input = (atacar: boolean) => ({
    playerPosition: { x: 0, y: 0, z: 0 },
    playerForward: { x: 0, y: 0, z: -1 },
    playerMoving: false,
    ...(atacar ? { attackRequested: true, attackType: "quick" } : {}),
  });

  it("el jugador ATACA mientras el motor piensa → replica_diferida «combate»", async () => {
    const effects = await replicaCon(({ sim }) => {
      const antes = sim.ataquesDelJugador;
      sim.tick(0.016, input(true));
      assert.equal(sim.ataquesDelJugador, antes + 1, "premisa: el ataque empezó");
    });
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "combate", hayPelea: false },
    ]);
  });

  it("atacar CON un hostil enganchado → «combate» con hayPelea (la pista de la pelea)", async () => {
    const effects = await replicaCon(({ sim }) => {
      sim.addCombatant(createCombatant("brasco", 60, "short_sword", { x: 0, y: 0, z: 2 }), bravucon);
      sim.tick(0.016, input(true));
      assert.equal(sim.jugadorEnCombate, true, "premisa: Brasco le tiene enganchado");
    });
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "combate", hayPelea: true },
    ]);
  });

  /** El HUECO CONOCIDO de la opción B (decisión 2026-09-30), escrito como
   *  test para que cerrarlo sea una decisión y no un accidente: un hostil que
   *  engancha al jugador SIN que este ataque no degrada la réplica. */
  it("HUECO: un hostil le engancha pero el jugador no ataca → el panel se abre igual", async () => {
    const effects = await replicaCon(({ sim }) => {
      sim.addCombatant(createCombatant("brasco", 60, "short_sword", { x: 0, y: 0, z: 2 }), bravucon);
      sim.tick(0.016, input(false));
      assert.equal(sim.jugadorEnCombate, true, "premisa: Brasco le tiene enganchado");
    });
    assert.equal(effects[0]?.kind, "show_dialogue");
  });

  it("el jugador TERMINA otra conversación mientras el motor piensa → replica_diferida «terminada» (tanda BX)", async () => {
    const effects = await replicaCon(async ({ ctx }) => {
      await porElBorde({ type: "dialogue_end", speaker: "Maela", speakerId: "maela" }, makeSocket().socket, ctx);
    });
    assert.deepEqual(effects, [
      { kind: "replica_diferida", speaker: "Orio", text: TEXTO, speakerId: "orio", motivo: "terminada", hayPelea: false },
    ]);
  });

  it("el saludo con E (interact_entity) recibe el mismo trato", async () => {
    const effects = await replicaCon(({ store }) => store.dispatch("player_moved", { pos: [0, 0, 40] }), "interact_entity");
    assert.equal(effects[0]?.kind, "replica_diferida");
    const normal = await replicaCon(() => {}, "interact_entity");
    assert.equal(normal[0]?.kind, "show_dialogue");
  });
});

/** Terminar una conversación (tanda BX, opción B): queda en el historial, el
 *  motor lo lee la próxima vez, y NO se le llama por despedirse. */
describe("bridge dialogue_end", () => {
  async function conPartida() {
    const bundle = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, bundle.ctx);
    await entrarEnLaPartida(bundle.ctx, socket, (sent[0] as SessionStartedMessage).sessionId!);
    return { ...bundle, socket };
  }

  it("apunta la acotación de fin en dialogue_history, cuenta el fin y NO llama al motor", async () => {
    const { ctx, narrative, aiCalls, socket } = await conPartida();
    const antes = aiCalls.choice.length;
    const historial = narrative.dialogue_history.length;
    await porElBorde({ type: "dialogue_end", speaker: "Orio", speakerId: "orio" }, socket, ctx);
    assert.equal(aiCalls.choice.length, antes, "despedirse no cuesta una ida y vuelta al motor");
    assert.equal(narrative.dialogue_history.length, historial + 1);
    const fin = narrative.dialogue_history.at(-1)!;
    assert.equal(fin.speaker, "Orio");
    assert.equal(fin.text, FIN_DE_CONVERSACION);
    assert.equal(fin.chosen_index, -1);
    assert.equal(ctx.conversacion.terminadas, 1);
  });

  it("el motor lo ve en recent_dialogues la próxima vez que le hablen", async () => {
    const { ctx, narrative, aiCalls, socket } = await conPartida();
    await porElBorde({ type: "dialogue_end", speaker: "Orio" }, socket, ctx);
    await porElBorde({ type: "interact_entity", entityId: "orio", entityName: "Orio" }, socket, ctx);
    const payload = aiCalls.choice.at(-1) as { context: { recent_dialogues: { speaker: string; chosen: string }[] } };
    const recientes = payload.context.recent_dialogues;
    assert.ok(
      recientes.some((d) => d.speaker === "Orio" && d.chosen === FIN_DE_CONVERSACION),
      `el fin viaja en el contexto: ${JSON.stringify(recientes)}`,
    );
    assert.ok(narrative.dialogue_history.length >= 2);
  });

  it("un caído también puede cerrar el panel (no pasa por rechazarSiEstaCaido)", async () => {
    const { ctx, sim } = await conPartida();
    const { socket, sent } = makeSocket();
    sim.getCombatant("player")!.health = 0;
    assert.equal(jugadorCaido(ctx), true, "premisa: caído");
    await porElBorde({ type: "dialogue_end", speaker: "Orio" }, socket, ctx);
    assert.equal(ctx.conversacion.terminadas, 1);
    assert.equal(sent.length, 0, "sin rechazo «Estás caído»");
  });

  it("si el guardado falla, difunde narrative_status error kind save (fail-loud)", async () => {
    const { ctx, narrative, broadcasts, socket } = await conPartida();
    narrative.save = () => Promise.reject(new Error("ENOSPC"));
    const log = capturarLogDelBridge();
    try {
      await porElBorde({ type: "dialogue_end", speaker: "Orio" }, socket, ctx);
    } finally {
      log.soltar();
    }
    assert.ok(log.lineas.some((l) => l.includes("ENOSPC")), "el crudo queda en el log");
    const st = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error" && m.kind === "save",
    );
    assert.ok(st, "el fallo del save se dice");
  });
});
