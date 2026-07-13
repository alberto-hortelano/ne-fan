/** Ciclo de sesión del bridge (start/resume/save/delete, plugins, persistencia runtime ↔ save).
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { combatRegistry } from "../src/combat/registry.js";
import { routeMessage } from "../bridge/router.js";
import type {
  ServerMessage,
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import { listGames as listGamesFs } from "../src/games/loader.js";
import {
  combatConfig,
  makeCtx,
  makeSocket,
  waitFor,
  REAL_GAMES_DIR,
  REAL_STYLES_DIR,
} from "./helpers.js";

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

  it("start_session congela el modo de render (default image, vector explícito, inválido aborta)", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200", renderMode: "vector" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    assert.equal(started.state?.world.render_mode, "vector");

    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r2", gameId: "toledo_1200" }, s2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).state?.world.render_mode, "image");

    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r3", gameId: "toledo_1200", renderMode: "ascii" },
      s3,
      ctx,
    );
    const started3 = sent3[0] as SessionStartedMessage;
    assert.equal(started3.ok, false);
    assert.match(started3.error ?? "", /modo de render desconocido/);
  });

  it("start_session congela el sistema de combate de game.json (default standard)", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "combatbasic" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    assert.equal(started.state?.world.combat_system, "basic");
    assert.equal(sim.combatSystem.id, "basic");
    assert.equal(sim.combatSystem.attacks.length, 1);

    // El input con "strike" simula; con un ataque estándar el sim lanza.
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 0, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
          attackRequested: true,
          attackType: "strike",
        },
      },
      s2,
      ctx,
    );
    const update = sent2[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.ok(update.events.some((e) => e.type === "attack_started"));

    // Sin systems en game.json ⇒ estándar.
    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r2", gameId: "plugtest" }, s3, ctx);
    assert.equal((sent3[0] as SessionStartedMessage).state?.world.combat_system, "standard");
    assert.equal(sim.combatSystem.id, "standard");
  });

  it("load_room sin sesión vuelve al combate estándar (los fixtures asumen ese catálogo)", async () => {
    const { ctx, sim } = makeCtx();
    ctx.sim.reset();
    ctx.sim.setCombatSystem(combatRegistry.create("basic", combatConfig));
    const { socket } = makeSocket();
    await routeMessage({ type: "load_room", roomId: "crypt_001", enemies: [] }, socket, ctx);
    assert.equal(sim.combatSystem.id, "standard");
  });

  it("start_session con systems.combat desconocido aborta (fail-loud)", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "combatbad" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, false);
    assert.match(started.error ?? "", /sistema de combate desconocido "noexiste"/);
  });

  it("resume restaura el sistema de combate congelado; un id desconocido en el save aborta", async () => {
    const { ctx, narrative, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "combatbasic" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    // Proceso nuevo: el sistema sale del save, no del game.json.
    narrative.startNewSession("plugtest");
    ctx.sim.reset();
    ctx.sim.setCombatSystem(combatRegistry.create("standard", combatConfig));
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    assert.equal(resumed.state?.world.combat_system, "basic");
    assert.equal(sim.combatSystem.id, "basic");

    // Save con un id que ya no existe en el registro ⇒ resume abortado.
    narrative.world.combat_system = "retirado";
    await routeMessage({ type: "save_session", requestId: "r4" }, s2, ctx);
    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r5", sessionId }, s3, ctx);
    const bad = sent3[0] as SessionStartedMessage;
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /combat_system_unknown: "retirado"/);
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

  it("resume normaliza scene_data en el wire y deja la persistencia en Format D crudo", async () => {
    const { ctx, narrative } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    // Escena Format D mínima registrada como haría el motor narrativo.
    narrative.recordSceneLoaded("fd_scene", {
      scene_id: "fd_scene",
      scene_description: "prueba",
      size: { cols: 4, rows: 4, meters_per_cell: 2 },
      terrain: ["gggg", "gggg", "gggg", "gggg"],
      entities: [
        { id: "caja", kind: "prop", name: "Caja", cell: [1, 1], footprint: [1, 1], glyph: "c" },
      ],
      ambient_event: "",
    });
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, ctx);

    narrative.startNewSession("plugtest");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    const wire = resumed.state!.scenes_loaded["fd_scene"].scene_data;
    assert.ok(Array.isArray(wire.objects), "wire: objects[] en metros");
    assert.ok(wire.__format_d, "wire: el crudo viaja en __format_d");
    assert.equal(wire.size, undefined, "wire: sin size top-level");
    // El estado interno (y por tanto el próximo save) sigue crudo.
    const internal = ctx.narrative.scenes_loaded["fd_scene"].scene_data;
    assert.ok(internal.size, "persistencia: Format D crudo");
    assert.equal(internal.__format_d, undefined);
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

  it("resume de una sesión SIN escenas reintenta el bootstrap (recuperación de timeout)", async () => {
    // Bootstrap que falla (timeout del motor narrativo): la sesión queda
    // guardada sin escenas. Reanudarla debe re-encolar el bootstrap — y esta
    // vez el motor responde (en producción, la respuesta tardía cacheada).
    let failScene = true;
    const { ctx, narrative, aiCalls, broadcasts } = makeCtx({
      ai: {
        generateScene: async () =>
          failScene
            ? { ok: false as const, error: "HTTP 504: timeout tras 900s" }
            : { ok: true as const, scene: { room_id: "scene_test", room_description: "una escena" } },
      },
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() => aiCalls.scene.length === 1);
    await waitFor(() =>
      broadcasts.some((b) => b.type === "narrative_status" && (b as NarrativeStatusMessage).phase === "error"),
    );
    assert.equal(Object.keys(narrative.scenes_loaded).length, 0, "bootstrap fallido → sin escenas");

    failScene = false;
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r2", sessionId }, s2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, true);
    await waitFor(() => aiCalls.scene.length === 2);
    await waitFor(() => Object.keys(narrative.scenes_loaded).length > 0);
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

