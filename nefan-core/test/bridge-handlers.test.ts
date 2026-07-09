/** Tests de los handlers del bridge (bridge/router.ts + bridge/handlers/*)
 *  con transporte fake: socket capturador y AiClient falso. Cubre el routing,
 *  el ciclo de sesión con plugins, el patrón fail-loud de dialogue_choice
 *  (broadcast narrative_status: error) y los map triggers. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import { routeMessage } from "../bridge/router.js";
import { SceneGenQueue } from "../bridge/scene-gen-queue.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type { BridgeContext, ClientSocket, NarrativeAiClient } from "../bridge/context.js";
import type {
  ServerMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import type { Consequence } from "../src/narrative/types.js";
import { listGames as listGamesFs } from "../src/games/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const REAL_GAMES_DIR = resolve(DATA_DIR, "games");
const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));
const FIXTURE_STYLES = fileURLToPath(new URL("fixtures/styles", import.meta.url));
const REAL_STYLES_DIR = resolve(DATA_DIR, "styles");

const combatConfig = loadConfig(
  JSON.parse(readFileSync(resolve(DATA_DIR, "combat_config.json"), "utf-8")),
);

function makeSocket(): { socket: ClientSocket; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const socket: ClientSocket = {
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    readyState: 1,
    OPEN: 1,
  };
  return { socket, sent };
}

interface FakeAi {
  generateScene?: NarrativeAiClient["generateScene"];
  reportPlayerChoice?: NarrativeAiClient["reportPlayerChoice"];
  developWorld?: NarrativeAiClient["developWorld"];
}

function makeCtx(opts: { gamesDir?: string; stylesDir?: string; ai?: FakeAi } = {}) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  sim.addCombatant(
    createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
  );
  const storage = new MemorySessionStorage();
  const narrative = new NarrativeState(storage);
  const broadcasts: ServerMessage[] = [];
  const subscribers = new Set<ClientSocket>();
  const aiCalls: Record<string, unknown[]> = { notify: [], scene: [], choice: [], develop: [] };

  const aiClient: NarrativeAiClient = {
    async notifySessionStart(sessionId, gameId, isResume) {
      aiCalls.notify.push({ sessionId, gameId, isResume });
      return true;
    },
    async generateScene(ctx) {
      aiCalls.scene.push(ctx);
      if (opts.ai?.generateScene) return opts.ai.generateScene(ctx);
      return { ok: true, scene: { room_id: "scene_test", room_description: "una escena" } };
    },
    async reportPlayerChoice(payload) {
      aiCalls.choice.push(payload);
      if (opts.ai?.reportPlayerChoice) return opts.ai.reportPlayerChoice(payload);
      return { ok: true, consequences: [] };
    },
    async developWorld(draftText: string) {
      aiCalls.develop.push(draftText);
      if (opts.ai?.developWorld) return opts.ai.developWorld(draftText);
      return {
        ok: true as const,
        game: {
          game_id: "mundo_prueba",
          title: "Mundo de Prueba",
          description: "Un mundo inventado por el jugador.",
          style_id: "estilo_test",
          world_brief: "b".repeat(150),
          world_md: "# Mundo de Prueba\n" + "lore ".repeat(500),
        },
      };
    },
  };

  const ctx: BridgeContext = {
    sim,
    store,
    narrative,
    sessionStorage: storage,
    aiClient,
    mapTriggers: new MapTriggerEvaluator(narrative),
    initialSceneCache: new InitialSceneCache(join(tmpdir(), "nefan-test-scene-cache-unused")),
    gamesDir: opts.gamesDir ?? FIXTURE_GAMES,
    stylesDir: opts.stylesDir ?? FIXTURE_STYLES,
    cacheInitialScene: false,
    activePlugins: new Map(),
    sceneGen: new SceneGenQueue(),
    posTracking: { cellKey: null, placeId: null },
    subscribe(ws) {
      subscribers.add(ws);
    },
    send(ws, msg) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    broadcastNarrative(msg) {
      broadcasts.push(msg);
      for (const ws of subscribers) ctx.send(ws, msg);
    },
  };
  return { ctx, broadcasts, storage, narrative, store, sim, aiCalls, subscribers };
}

/** Espera a que se cumpla una condición (para el trabajo fire-and-forget de
 *  start_session/player_entered_place, que no se awaitea en el handler). */
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("bridge routing básico", () => {
  it("ping → pong", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "ping" }, socket, ctx);
    assert.deepEqual(sent, [{ type: "pong" }]);
  });

  it("list_games devuelve los juegos del directorio real", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "list_games", requestId: "r1" }, socket, ctx);
    assert.equal(sent.length, 1);
    const msg = sent[0] as Extract<ServerMessage, { type: "games_listed" }>;
    assert.equal(msg.requestId, "r1");
    assert.ok(msg.games.some((g) => g.game_id === "toledo_1200"));
    assert.ok(msg.games.every((g) => g.world_brief.length > 100));
    assert.ok(msg.styles.some((st) => st.style_id === "medievo_crudo"));
  });

  it("load_room resetea al player y proyecta los enemigos", async () => {
    const { ctx, store } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "load_room",
        roomId: "crypt_001",
        enemies: [
          {
            id: "skel_1",
            position: { x: 2, y: 0, z: 2 },
            health: 60,
            weaponId: "short_sword",
            personality: { aggression: 0.5, preferred_attacks: ["quick"], reaction_time: 0.4 },
          },
        ],
      },
      socket,
      ctx,
    );
    const update = sent[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.equal(update.playerHp, 100);
    assert.equal(update.enemies.length, 1);
    assert.equal(update.enemies[0].id, "skel_1");
    assert.equal(store.state.enemies.length, 1);
    assert.equal(store.state.world.room_id, "crypt_001");
  });

  it("respawn responde con state_update y HP restaurado", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "respawn" }, socket, ctx);
    const update = sent[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.equal(update.playerHp, 100);
  });

  it("input produce un state_update con eventos del tick", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 0, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      socket,
      ctx,
    );
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as StateUpdateMessage).type, "state_update");
  });
});

describe("bridge ciclo de sesión", () => {
  it("start_session activa los plugins shipped y difunde la escena generada", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );

    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.type, "session_started");
    assert.equal(started.ok, true);
    assert.equal(started.isResume, false);
    assert.ok(started.sessionId);
    // La identidad del mundo queda poblada desde game.json/style.json.
    assert.equal(started.state?.world.name, "Juego de pruebas");
    assert.equal(started.state?.world.style_id, "estilo_test");
    assert.equal(started.state?.world.style_token, "test style token");
    assert.ok(started.state?.world.description.length ?? 0 > 50);
    assert.match(started.state?.world.world_doc_hash ?? "", /^[0-9a-f]{64}$/);
    // Los 3 manifests del fixture plugtest quedan activos con su projection.
    assert.equal(ctx.activePlugins.size, 3);
    assert.equal(narrative.plugins.length, 3);
    // notifySessionStart salió hacia ai_server.
    assert.equal(aiCalls.notify.length, 1);

    // La generación de escena es fire-and-forget: esperar los broadcasts.
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    const phases = broadcasts
      .filter((m): m is NarrativeStatusMessage => m.type === "narrative_status")
      .map((m) => m.phase);
    assert.deepEqual(phases, ["generating", "ready"]);
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event",
    );
    assert.ok(sceneEvent, "scene_init broadcast");
    assert.equal(sceneEvent.eventId, "scene_init");
    assert.equal(sceneEvent.effects[0].kind, "spawn_entity");
    // La escena quedó registrada y persistida.
    assert.ok(narrative.scenes_loaded["scene_test"]);
  });

  it("start_session adjunta world_document al bootstrap y world.description en el contexto", async () => {
    const { ctx, broadcasts, aiCalls } = makeCtx();
    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    assert.equal(aiCalls.scene.length, 1);
    const llmCtx = aiCalls.scene[0] as {
      world_document?: string;
      world: { description: string; style_id: string };
    };
    assert.match(String(llmCtx.world_document ?? ""), /Mundo de pruebas/);
    assert.ok(llmCtx.world.description.length > 50);
    assert.equal(llmCtx.world.style_id, "estilo_test");
  });

  it("create_game desarrolla el borrador y escribe data/games/user_*", async () => {
    const tmpGames = mkdtempSync(join(tmpdir(), "nefan-create-game-"));
    try {
      const { ctx } = makeCtx({ gamesDir: tmpGames });
      const { socket, sent } = makeSocket();
      await routeMessage(
        { type: "create_game", requestId: "r1", draftText: "Un mundo de islas voladoras con clanes rivales." },
        socket,
        ctx,
      );
      const created = sent[0] as Extract<ServerMessage, { type: "game_created" }>;
      assert.equal(created.ok, true);
      assert.equal(created.gameId, "user_mundo_prueba");
      assert.equal(created.title, "Mundo de Prueba");
      // El mundo queda listado y carga con el loader canónico (game.json + world.md).
      const games = listGamesFs(tmpGames);
      assert.ok(games.some((g) => g.game_id === "user_mundo_prueba"));

      // Segundo mundo con el mismo slug ⇒ dedupe con sufijo.
      const { socket: s2, sent: sent2 } = makeSocket();
      await routeMessage(
        { type: "create_game", requestId: "r2", draftText: "Otro borrador cualquiera con más de veinte chars." },
        s2,
        ctx,
      );
      const created2 = sent2[0] as Extract<ServerMessage, { type: "game_created" }>;
      assert.equal(created2.gameId, "user_mundo_prueba_2");

      // Borrador vacío ⇒ fail-loud sin tocar el LLM.
      const { socket: s3, sent: sent3 } = makeSocket();
      await routeMessage({ type: "create_game", requestId: "r3", draftText: "  " }, s3, ctx);
      const created3 = sent3[0] as Extract<ServerMessage, { type: "game_created" }>;
      assert.equal(created3.ok, false);
      assert.match(created3.error ?? "", /draft_too_short/);
    } finally {
      rmSync(tmpGames, { recursive: true, force: true });
    }
  });

  it("start_session respeta el styleId elegido y rechaza estilos inexistentes", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200", styleId: "acuarela_luminosa" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    assert.equal(started.state?.world.style_id, "acuarela_luminosa");

    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r2", gameId: "toledo_1200", styleId: "no_existe" },
      s2,
      ctx,
    );
    const started2 = sent2[0] as SessionStartedMessage;
    assert.equal(started2.ok, false);
    assert.match(started2.error ?? "", /game_load_failed/);
  });

  it("start_session congela la perspectiva elegida (y por defecto topdown)", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200", perspective: "isometric" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    assert.equal(started.state?.world.perspective, "isometric");

    // sin perspective ⇒ default del juego o "topdown"
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r2", gameId: "toledo_1200" },
      s2,
      ctx,
    );
    const started2 = sent2[0] as SessionStartedMessage;
    assert.equal(started2.ok, true);
    assert.equal(started2.state?.world.perspective, "topdown");

    // valor desconocido ⇒ aborta fail-loud
    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r3", gameId: "toledo_1200", perspective: "primera_persona" },
      s3,
      ctx,
    );
    const started3 = sent3[0] as SessionStartedMessage;
    assert.equal(started3.ok, false);
    assert.match(started3.error ?? "", /perspectiva desconocida/);
  });

  it("start_session con juego inexistente o roto responde ok:false (fail-loud)", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "no_existe" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, false);
    assert.match(started.error ?? "", /game_load_failed/);
  });

  it("start_session difunde narrative_status: error si la generación falla", async () => {
    const { ctx, broadcasts } = makeCtx({
      ai: { generateScene: async () => ({ ok: false, error: "MCP caído" }) },
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    assert.equal((sent[0] as SessionStartedMessage).ok, true); // la sesión sí arranca
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("MCP caído"));
  });

  it("resume_session devuelve session_not_found para un id inexistente", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "resume_session", requestId: "r2", sessionId: "no_such" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, false);
    assert.equal(started.error, "session_not_found");
  });

  it("start → save → resume rebindea los plugins por id", async () => {
    const { ctx, narrative } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    // Simular proceso nuevo: vaciar los plugins activos y reanudar.
    ctx.activePlugins = new Map();
    const { socket: socket2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, socket2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    assert.equal(resumed.isResume, true);
    assert.equal(ctx.activePlugins.size, 3);
    assert.equal(narrative.session_id, sessionId);
  });

  it("resume restaura la perspectiva congelada (inmutable a mitad de partida)", async () => {
    const { ctx, narrative } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200", perspective: "isometric" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    // Proceso nuevo: la perspectiva sale del save, no del request.
    narrative.startNewSession("toledo_1200");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    assert.equal(resumed.state?.world.perspective, "isometric");
  });

  it("list_sessions y delete_session operan sobre el storage", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await routeMessage({ type: "save_session" }, socket, ctx);

    await routeMessage({ type: "list_sessions", requestId: "r2" }, socket, ctx);
    const listed = sent.find((m) => m.type === "sessions_listed") as Extract<
      ServerMessage,
      { type: "sessions_listed" }
    >;
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].session_id, sessionId);

    await routeMessage({ type: "delete_session", requestId: "r3", sessionId }, socket, ctx);
    const deleted = sent.find((m) => m.type === "session_deleted") as Extract<
      ServerMessage,
      { type: "session_deleted" }
    >;
    assert.equal(deleted.ok, true);
    assert.equal((await ctx.sessionStorage.list()).length, 0);
  });
});

describe("bridge dialogue_choice", () => {
  async function startSession(ctxBundle: ReturnType<typeof makeCtx>) {
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctxBundle.ctx,
    );
    assert.equal((sent[0] as SessionStartedMessage).ok, true);
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
    await routeMessage(
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
    assert.deepEqual(narrative.getPluginRecord(counterId)?.slice, { count: 1 });
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
    await routeMessage(
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
    assert.ok(err.message?.includes("timeout esperando a Claude"));
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
    await routeMessage(
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

describe("bridge runtime ↔ sesión (persistencia)", () => {
  it("input actualiza store.player.pos (player_moved)", async () => {
    const { ctx, store } = makeCtx();
    const { socket } = makeSocket();
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 3, y: 1, z: -2 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: true,
        },
      },
      socket,
      ctx,
    );
    assert.deepEqual(store.state.player.pos, [3, 1, -2]);
  });

  it("input sin combatiente player no responde (evita playerHp 0 fantasma)", async () => {
    const { ctx, sim } = makeCtx();
    sim.reset(); // bridge recién arrancado / title screen: sin player sembrado
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 0, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      socket,
      ctx,
    );
    assert.equal(sent.length, 0);
  });

  it("save_session snapshotea posición y HP del sim en el save", async () => {
    const bundle = makeCtx();
    const { ctx, narrative, sim, storage } = bundle;
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;

    const player = sim.getCombatant("player")!;
    player.position = { x: 4, y: 1, z: 7 };
    player.health = 42;
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    assert.deepEqual(narrative.player.position, [4, 1, 7]);
    assert.equal(narrative.player.health, 42);
    const onDisk = (await storage.read(sessionId))!;
    assert.deepEqual(onDisk.player.position, [4, 1, 7]);
    assert.equal(onDisk.player.health, 42);
  });

  it("resume_session resiembra el sim con la posición y HP guardados", async () => {
    const bundle = makeCtx();
    const { ctx, sim, store } = bundle;
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    const player = sim.getCombatant("player")!;
    player.position = { x: -5, y: 1, z: 9 };
    player.health = 33;
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    // Ensuciar el runtime como haría seguir jugando (o una sesión distinta).
    player.health = 100;
    player.position = { x: 0, y: 0, z: 0 };
    ctx.activePlugins = new Map();
    const { socket: socket2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, socket2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, true);

    const reseeded = sim.getCombatant("player")!;
    assert.equal(reseeded.health, 33);
    assert.deepEqual(reseeded.position, { x: -5, y: 1, z: 9 });
    assert.equal(store.state.player.hp, 33);
  });

  it("start_session resetea el runtime: no hereda el HP de la sesión anterior", async () => {
    const { ctx, sim, store } = makeCtx();
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    sim.getCombatant("player")!.health = 12; // sesión 1 termina malherida

    const { socket: s2 } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r2", gameId: "plugtest" }, s2, ctx);
    assert.equal(sim.getCombatant("player")!.health, 100);
    assert.equal(store.state.player.hp, 100);
  });

  it("load_room con sesión activa preserva el HP; sin sesión resetea a tope", async () => {
    const loadRoom = {
      type: "load_room",
      roomId: "scene_x",
      enemies: [],
    } as const;

    // Con sesión: el HP vivo sobrevive a la transición de escena.
    const withSession = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      withSession.ctx,
    );
    withSession.sim.getCombatant("player")!.health = 55;
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ ...loadRoom }, s2, withSession.ctx);
    const inSessionUpdate = sent2[0] as StateUpdateMessage;
    assert.equal(inSessionUpdate.playerHp, 55);
    // Transición de escena, NO respawn: sin evento player_respawned (el
    // cliente teletransportaría al player al spawn pisando un resume).
    assert.equal(inSessionUpdate.events.length, 0);

    // Sin sesión (rooms de test legacy): arranque a tope, como siempre.
    const noSession = makeCtx();
    noSession.sim.getCombatant("player")!.health = 55;
    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage({ ...loadRoom }, s3, noSession.ctx);
    const legacyUpdate = sent3[0] as StateUpdateMessage;
    assert.equal(legacyUpdate.playerHp, 100);
    assert.equal(legacyUpdate.events[0]?.type, "player_respawned");
    void sent;
  });

  it("broadcastScene proyecta las entities enemy de la escena a store.enemies", async () => {
    const { ctx, store, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({
      id: "camp",
      kind: "site",
      parent_id: "world",
      name: "El Campamento",
    });
    narrative.recordSceneLoaded("scene_camp", {
      room_id: "scene_camp",
      place_id: "camp",
      room_description: "un campamento",
    });
    narrative.recordEntitySpawned(
      "bandit_1",
      "enemy",
      "scene_camp",
      { x: 2, y: 0, z: 3 },
      { combat: { health: 70, weapon_id: "short_sword" } },
      "react_to_player",
    );
    narrative.recordEntitySpawned(
      "merchant_1",
      "npc",
      "scene_camp",
      { x: 1, y: 0, z: 1 },
      { name: "Boris" },
      "react_to_player",
    );

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "camp" }, socket, ctx);

    assert.equal(store.state.enemies.length, 1);
    assert.equal(store.state.enemies[0].id, "bandit_1");
    assert.equal(store.state.enemies[0].hp, 70);
    assert.equal(store.state.enemies[0].weapon_id, "short_sword");
  });
});

describe("bridge player_entered_place + map triggers", () => {
  it("lugar desconocido → narrative_status: error", async () => {
    const { ctx, broadcasts } = makeCtx();
    ctx.narrative.startNewSession("plugtest");
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "nowhere" }, socket, ctx);
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("nowhere"));
  });

  it("lugar realizado → re-broadcast de la escena cacheada + trigger player_entered", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({
      id: "tavern",
      kind: "site",
      parent_id: "world",
      name: "La Posada",
    });
    narrative.recordSceneLoaded("scene_tavern", {
      room_id: "scene_tavern",
      place_id: "tavern",
      room_description: "la posada",
    });
    narrative.worldMap.addTrigger("tavern", {
      id: "greet",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Huele a estofado." }],
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "tavern" }, socket, ctx);

    // Escena cacheada re-difundida…
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage =>
        m.type === "narrative_event" && m.eventId === "scene_init",
    );
    assert.ok(sceneEvent, "scene_init re-broadcast");
    // …y el trigger disparado con su consequence aplicada.
    const triggerEvent = broadcasts.find(
      (m): m is NarrativeEventMessage =>
        m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    assert.ok(triggerEvent, "map_trigger difundido");
    assert.ok(narrative.story_so_far.includes("Huele a estofado."));
  });

  it("las exits de la escena difundida llevan edge (directo e inverso)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
    narrative.worldMap.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque" });
    // Desde la aldea se sale al bosque por el sur ⇒ desde el bosque, por el norte.
    narrative.worldMap.addLink({ from: "aldea", to: "bosque", kind: "path", edge: "south" });
    narrative.recordSceneLoaded("scene_aldea", { room_id: "scene_aldea", place_id: "aldea", room_description: "x" });
    narrative.recordSceneLoaded("scene_bosque", { room_id: "scene_bosque", place_id: "bosque", room_description: "x" });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "aldea" }, socket, ctx);
    const fromAldea = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const aldeaScene = fromAldea?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(aldeaScene?.exits?.[0]?.place_id, "bosque");
    assert.equal(aldeaScene?.exits?.[0]?.edge, "south");

    broadcasts.length = 0;
    await routeMessage({ type: "player_entered_place", placeId: "bosque" }, socket, ctx);
    const fromBosque = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const bosqueScene = fromBosque?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(bosqueScene?.exits?.[0]?.place_id, "aldea");
    assert.equal(bosqueScene?.exits?.[0]?.edge, "north");
  });

  it("lugar sin escena → lazy realize vía generateScene y trigger tras la escena", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true,
          scene: { room_id: "scene_forge", room_description: "la forja" },
        }),
      },
    });
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({
      id: "forge",
      kind: "site",
      parent_id: "world",
      name: "La Forja",
    });

    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forge" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    // La escena generada queda ligada al place y registrada.
    assert.equal(narrative.worldMap.get("forge")?.realized_scene_id, "scene_forge");
    assert.ok(narrative.scenes_loaded["scene_forge"]);
    const phases = broadcasts
      .filter((m): m is NarrativeStatusMessage => m.type === "narrative_status")
      .map((m) => m.phase);
    assert.deepEqual(phases, ["generating", "ready"]);
  });
});

describe("bridge player_crossed_frontier", () => {
  /** Sesión con un place activo "aldea" realizado, listo para cruzar fronteras. */
  function seedAldea(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    narrative.worldMap.upsertPlace({ id: "aldea", kind: "settlement", parent_id: "world", name: "Aldea" });
    narrative.recordSceneLoaded("scene_aldea", { room_id: "scene_aldea", place_id: "aldea", room_description: "x" });
  }

  it("camino feliz: el motor crea place+link, el bridge estampa el edge y difunde la escena", async () => {
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          assert.equal((llmCtx.frontier_request as { edge: string }).edge, "east");
          // El fake imita al motor: crea el place y el link SIN edge (probamos
          // que el bridge lo estampa con la geometría real del cruce).
          nref!.worldMap.upsertPlace({ id: "bosque_este", kind: "landmark", parent_id: "world", name: "Bosque" });
          nref!.worldMap.addLink({ from: "aldea", to: "bosque_este", kind: "path" });
          return { ok: true, scene: { room_id: "scene_bosque", place_id: "bosque_este", room_description: "el bosque" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);

    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );

    assert.equal(narrative.worldMap.get("bosque_este")?.realized_scene_id, "scene_bosque");
    assert.equal(narrative.worldMap.serialize().active_place_id, "bosque_este");
    // Edge estampado por el bridge sobre el link que dejó el motor.
    const link = narrative.worldMap.getOutgoingLinks("aldea")[0];
    assert.equal(link.edge, "east");
    // La escena difundida lleva el exit de vuelta con el edge opuesto.
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    const scene = sceneEvent?.effects?.[0]?.data?.scene as { exits?: { place_id: string; edge?: string }[] };
    assert.equal(scene?.exits?.[0]?.place_id, "aldea");
    assert.equal(scene?.exits?.[0]?.edge, "west");
    assert.equal(ctx.sceneGen.current, null, "cola drenada");
  });

  it("el motor no crea el place → error accionable con map_upsert_place", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => ({
          ok: true,
          scene: { room_id: "scene_x", place_id: "no_existe", room_description: "x" },
        }),
      },
    });
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "north" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("map_upsert_place"), err?.message);
    assert.equal(ctx.sceneGen.current, null);
  });

  it("el motor no linkea el place nuevo → error accionable con map_link", async () => {
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async () => {
          nref!.worldMap.upsertPlace({ id: "paramo", kind: "landmark", parent_id: "world", name: "Páramo" });
          return { ok: true, scene: { room_id: "scene_p", place_id: "paramo", room_description: "x" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "south" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("map_link"), err?.message);
  });

  it("cola: la misma frontera repetida durante la generación se dedupea", async () => {
    let release: (() => void) | null = null;
    let nref: NarrativeState | null = null;
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          nref!.worldMap.upsertPlace({ id: "colina", kind: "landmark", parent_id: "world", name: "Colina" });
          nref!.worldMap.addLink({ from: "aldea", to: "colina", kind: "path" });
          return { ok: true, scene: { room_id: "scene_c", place_id: "colina", room_description: "x" } };
        },
      },
    });
    nref = narrative;
    seedAldea(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() => release !== null);
    // Misma frontera repetida mientras genera → dedupe + re-broadcast generating.
    const before = broadcasts.length;
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1, "una sola llamada al motor");
    assert.equal(
      (broadcasts[before] as NarrativeStatusMessage)?.phase,
      "generating",
      "re-broadcast de generating para mantener el loader",
    );
    release!();
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    assert.equal(ctx.sceneGen.current, null);
  });

  it("lazy realize en vuelo → la frontera se dropea (y viceversa el guard cubre entered_place)", async () => {
    let release: (() => void) | null = null;
    const { ctx, narrative, aiCalls, broadcasts } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          return { ok: true, scene: { room_id: "scene_f", room_description: "x" } };
        },
      },
    });
    seedAldea(narrative);
    narrative.worldMap.upsertPlace({ id: "forja", kind: "site", parent_id: "world", name: "Forja" });
    const { socket } = makeSocket();
    await routeMessage({ type: "player_entered_place", placeId: "forja" }, socket, ctx);
    await waitFor(() => release !== null);
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1, "la frontera no dispara una segunda generación");
    release!();
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
  });
});

describe("bridge request_tile (plano continuo)", () => {
  /** Tile mínimo válido: bioma + camino que continúa los cruces pedidos. */
  const tileScene = (features: Record<string, unknown>[] = []) => ({
    biome: "grass",
    scene_description: "campo de bench",
    terrain_features: features,
    entities: [],
    ambient_event: "",
  });

  function seedTile00(narrative: NarrativeState): void {
    narrative.startNewSession("plugtest");
    // Tile (0,0) con un camino que muere en su borde ESTE en la fila 41.
    const t = {
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      ...tileScene([
        { type: "path", points: [[64, 41], [128, 41]], width: 2, at_edges: [{ edge: "east", at: 41 }] },
      ]),
    };
    narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives(t));
  }

  it("cache-hit: re-difunde el tile persistido sin llamar al motor", async () => {
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx();
    seedTile00(narrative);
    broadcasts.length = 0;
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 0, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 0, "sin LLM");
    const sceneEvent = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "scene_init",
    );
    assert.ok(sceneEvent, "re-broadcast del esquema persistido");
    const ready = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
    );
    assert.equal(ready?.kind, "tile");
    assert.deepEqual(ready?.tile, { tx: 0, ty: 0 });
  });

  it("miss: genera con contexto de costuras y el prefetch NO roba la escena activa", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          const gt = llmCtx.generate_tile!;
          assert.equal(gt.tx, 1);
          assert.equal(gt.ty, 0);
          // El vecino oeste (tile 0,0) expone su cruce con el MISMO at.
          assert.equal(gt.neighbors.west?.crossings[0]?.at, 41);
          // Continuarlo: camino de oeste a este.
          return {
            ok: true,
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "prefetch", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready" && m.kind === "tile"),
    );
    assert.ok(narrative.hasTile(1, 0), "tile registrado");
    assert.equal(narrative.world.active_scene_id, "tile_0_0", "prefetch sin activar");
    // El registro persistió las costuras del tile nuevo.
    assert.equal(narrative.getTile(1, 0)!.edges!.west.crossings[0]?.at, 41);
  });

  it("map_svg_update persiste el SVG revisado; uno inválido se rechaza sin tocar el record", async () => {
    const { ctx, narrative } = makeCtx();
    seedTile00(narrative);
    const { socket } = makeSocket();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g id="ground"/><g id="water"/><g id="solid"/><g id="tall"/></svg>';
    await routeMessage({ type: "map_svg_update", tx: 0, ty: 0, map_svg: svg }, socket, ctx);
    const rec = narrative.getTile(0, 0)!;
    assert.equal(rec.scene_data.map_svg, svg);
    assert.equal(rec.scene_data.map_svg_reviewed, true);
    // Sin la capa #tall el sanitizador lo rechaza y el persistido no cambia.
    await routeMessage(
      { type: "map_svg_update", tx: 0, ty: 0, map_svg: svg.replace('<g id="tall"/>', "") },
      socket,
      ctx,
    );
    assert.equal(narrative.getTile(0, 0)!.scene_data.map_svg, svg);
    // Tile no registrado: se ignora con warn, sin lanzar.
    await routeMessage({ type: "map_svg_update", tx: 5, ty: 5, map_svg: svg }, socket, ctx);
    assert.ok(!narrative.hasTile(5, 5));
  });

  it("un tile que no continúa los cruces del vecino se rechaza (red server-side)", async () => {
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { generateScene: async () => ({ ok: true, scene: tileScene() }) }, // sin camino
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(err?.message?.includes("no es jugable"), err?.message);
    assert.ok(!narrative.hasTile(1, 0));
  });

  it("player_crossed_frontier delega en el pipeline de tiles cuando el activo es un tile", async () => {
    const { ctx, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async (llmCtx) => {
          assert.ok(llmCtx.generate_tile, "usa generate_tile, no frontier_request");
          assert.equal(llmCtx.frontier_request, undefined);
          assert.equal(llmCtx.generate_tile!.entry?.edge, "west", "entra por el opuesto al cruzado");
          return {
            ok: true,
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "player_crossed_frontier", edge: "east" }, socket, ctx);
    await waitFor(() => narrative.hasTile(1, 0));
    assert.equal(aiCalls.scene.length, 1);
  });

  it("blocking repetido mientras genera → generating re-difundido, una sola llamada", async () => {
    let release: (() => void) | null = null;
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: async () => {
          await new Promise<void>((r) => { release = r; });
          return {
            ok: true,
            scene: tileScene([
              { type: "path", points: [[0, 41], [128, 41]], width: 2, at_edges: [{ edge: "west", at: 41 }, { edge: "east", at: 41 }] },
            ]),
          };
        },
      },
    });
    seedTile00(narrative);
    const { socket } = makeSocket();
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    await waitFor(() => release !== null);
    const before = broadcasts.length;
    await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" }, socket, ctx);
    assert.equal(aiCalls.scene.length, 1);
    const regen = broadcasts.slice(before).find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "generating",
    );
    assert.ok(regen, "re-broadcast de generating para el que espera");
    release!();
    await waitFor(() => narrative.hasTile(1, 0));
  });

  it("add_combatants es aditivo y respawn acepta pos", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "add_combatants",
        enemies: [
          {
            id: "lobo_1",
            position: { x: 70, y: 0, z: 5 },
            health: 40,
            weaponId: "unarmed",
            personality: { aggression: 0.7, preferred_attacks: ["quick"], reaction_time: 0.3 },
          },
        ],
      },
      socket,
      ctx,
    );
    assert.ok(sim.getCombatant("lobo_1"), "enemigo añadido");
    assert.ok(sim.getCombatant("player"), "player intacto (sin reset)");
    // Duplicado ignorado.
    await routeMessage(
      { type: "add_combatants", enemies: [{ id: "lobo_1", position: { x: 0, y: 0, z: 0 }, health: 99, weaponId: "unarmed", personality: { aggression: 0, preferred_attacks: ["quick"], reaction_time: 1 } }] },
      socket,
      ctx,
    );
    assert.equal(sim.getCombatant("lobo_1")!.health, 40, "el duplicado no pisa el HP");

    await routeMessage({ type: "respawn", pos: { x: 66, y: 0, z: 2 } }, socket, ctx);
    assert.deepEqual(sim.getCombatant("player")!.position, { x: 66, y: 0, z: 2 });
    assert.ok((sent.at(-1) as StateUpdateMessage).playerHp > 0);
  });
});

describe("bridge activación por posición (tiles + anchors)", () => {
  it("pisar un tile lo activa y pisar el anchor de un place dispara sus triggers", async () => {
    const { ctx, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    const t00 = expandScenePrimitives({ tile: { tx: 0, ty: 0 }, scene_id: "tile_0_0", biome: "grass", entities: [] });
    const t10 = expandScenePrimitives({ tile: { tx: 1, ty: 0 }, scene_id: "tile_1_0", biome: "grass", entities: [] });
    narrative.recordSceneLoaded("tile_0_0", t00);
    narrative.recordSceneLoaded("tile_1_0", t10, [], { activate: false });
    narrative.worldMap.upsertPlace({
      id: "claro",
      kind: "landmark",
      parent_id: "world",
      name: "El Claro",
      anchor: { tx: 1, ty: 0, rect: [40, 50, 20, 20] },
    });
    narrative.worldMap.addTrigger("claro", {
      id: "bienvenida",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Llegas al claro." }],
    });

    const { socket } = makeSocket();
    const input = (x: number, z: number) => routeMessage(
      { type: "input", delta: 0.016, inputs: { playerPosition: { x, y: 0, z }, playerForward: { x: 0, y: 0, z: -1 }, playerMoving: true } },
      socket, ctx,
    );

    // Dentro del tile (0,0): nada cambia de más.
    await input(0, 0);
    assert.equal(narrative.world.active_scene_id, "tile_0_0");

    // Cruzar al tile (1,0) fuera del anchor: se activa el tile, no el place.
    await input(40, -20);
    assert.equal(narrative.world.active_scene_id, "tile_1_0");
    assert.ok(!narrative.story_so_far.includes("Llegas al claro."));

    // Pisar el rect del anchor (celdas 40..59 × 50..59 → mundo x 52..62, z -7..-2).
    await input(55, -4);
    await waitFor(() => narrative.story_so_far.includes("Llegas al claro."));
    assert.equal(narrative.worldMap.serialize().active_place_id, "claro");
    const trigger = broadcasts.find(
      (m): m is NarrativeEventMessage => m.type === "narrative_event" && m.eventId === "map_trigger",
    );
    assert.ok(trigger, "map_trigger difundido");

    // Re-pisar el anchor no re-dispara player_entered en bucle (gate por celda
    // + place ya activo).
    const count = broadcasts.filter((m) => m.type === "narrative_event" && m.eventId === "map_trigger").length;
    await input(55.2, -4);
    await input(55.4, -4);
    const count2 = broadcasts.filter((m) => m.type === "narrative_event" && m.eventId === "map_trigger").length;
    assert.equal(count2, count, "sin re-disparos");
  });
});

describe("imageElementsAtSharedEdge — análisis del vecino en la costura", () => {
  const record = (tx: number, ty: number, elements: unknown[]): never =>
    ({
      scene_data: {}, loaded_at: "x", asset_refs: [],
      tile: { tx, ty },
      analysis: { analyzed_at: "x", elements },
    }) as never;

  it("elementos que tocan el borde compartido salen con celdas a lo largo del borde", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    // Vecino al ESTE del tile nuevo: tile (1,0), rect x 32..96, z -32..32.
    // Su borde compartido es el oeste (x=32).
    const rec = record(1, 0, [
      { label: "muralla", solid: true, tall: true, rect: { minX: 30, maxX: 60, minZ: 4, maxZ: 12 } },
      { label: "roble", solid: true, tall: true, rect: { minX: 80, maxX: 90, minZ: 0, maxZ: 8 } },
    ]);
    const out = imageElementsAtSharedEdge(rec, "east");
    assert.equal(out.length, 1, "solo la muralla toca la costura");
    assert.equal(out[0].label, "muralla");
    // z 4..12 → celdas (z+32)/0.5 = 72..88
    assert.deepEqual(out[0].at, [72, 88]);
  });

  it("vecino al NORTE: banda sobre su borde sur y celdas a lo largo de x", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    // Vecino (0,-1): rect x -32..32, z -96..-32. Borde compartido = su sur (z=-32).
    const rec = record(0, -1, [
      { label: "río", solid: true, tall: false, rect: { minX: -10, maxX: 6, minZ: -96, maxZ: -30 } },
    ]);
    const out = imageElementsAtSharedEdge(rec, "north");
    assert.equal(out.length, 1);
    // x -10..6 → celdas (x+32)/0.5 = 44..76
    assert.deepEqual(out[0].at, [44, 76]);
  });

  it("sin análisis → []", async () => {
    const { imageElementsAtSharedEdge } = await import("../bridge/handlers/tile.js");
    const rec = { scene_data: {}, loaded_at: "x", asset_refs: [], tile: { tx: 1, ty: 0 } } as never;
    assert.deepEqual(imageElementsAtSharedEdge(rec, "east"), []);
  });
});
