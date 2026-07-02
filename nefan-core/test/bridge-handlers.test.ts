/** Tests de los handlers del bridge (bridge/router.ts + bridge/handlers/*)
 *  con transporte fake: socket capturador y AiClient falso. Cubre el routing,
 *  el ciclo de sesión con plugins, el patrón fail-loud de dialogue_choice
 *  (broadcast narrative_status: error) y los map triggers. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GameSimulation } from "../src/simulation/game-loop.js";
import { createCombatant } from "../src/combat/combatant.js";
import { loadConfig } from "../src/combat/combat-data.js";
import { GameStore } from "../src/store/game-store.js";
import { ScenarioRunner } from "../src/scenario/scenario-runner.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";
import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import { routeMessage } from "../bridge/router.js";
import type { BridgeContext, ClientSocket, NarrativeAiClient } from "../bridge/context.js";
import type {
  ServerMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import type { Consequence } from "../src/narrative/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");
const REAL_GAMES_DIR = resolve(DATA_DIR, "games");
const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));

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
}

function makeCtx(opts: { gamesDir?: string; ai?: FakeAi } = {}) {
  const store = new GameStore();
  const sim = new GameSimulation(combatConfig, store, 12345);
  sim.addCombatant(
    createCombatant("player", 100, "short_sword", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
  );
  const storage = new MemorySessionStorage();
  const narrative = new NarrativeState(storage);
  const broadcasts: ServerMessage[] = [];
  const subscribers = new Set<ClientSocket>();
  const aiCalls: Record<string, unknown[]> = { notify: [], scene: [], choice: [] };

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
  };

  const ctx: BridgeContext = {
    sim,
    store,
    scenario: new ScenarioRunner(),
    narrative,
    sessionStorage: storage,
    aiClient,
    mapTriggers: new MapTriggerEvaluator(narrative),
    initialSceneCache: new InitialSceneCache(join(tmpdir(), "nefan-test-scene-cache-unused")),
    gamesDir: opts.gamesDir ?? FIXTURE_GAMES,
    cacheInitialScene: false,
    activePlugins: new Map(),
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
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "list_games", requestId: "r1" }, socket, ctx);
    assert.equal(sent.length, 1);
    const msg = sent[0] as Extract<ServerMessage, { type: "games_listed" }>;
    assert.equal(msg.requestId, "r1");
    assert.ok(msg.games.some((g) => g.game_id === "tavern_intro"));
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
