/** Ciclo de sesión del bridge (start/resume/save/delete, plugins, persistencia runtime ↔ save).
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { combatRegistry } from "../src/combat/registry.js";
import { createCombatant } from "../src/combat/combatant.js";
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
  capturarLogDelBridge,
  combatConfig,
  entrarEnLaPartida,
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
    assert.ok(narrative.scenes_loaded["tile_0_0"]);
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

  it("start_session ignora el campo legacy `perspective` de clientes viejos", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "start_session",
        requestId: "r1",
        gameId: "toledo_1200",
        perspective: "isometric",
      } as never,
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    assert.equal(
      (started.state?.world as Record<string, unknown>).perspective,
      undefined,
    );
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

  /** El eje de vistas murió y el save ya no congela ninguna. El riesgo de
   *  esa retirada no es que deje de compilar: es que el resume tome una rama
   *  VACÍA y abra una sesión sin mundo, sin error. Este test lo vigila desde
   *  el otro lado — reanudar debe devolver el mundo, no un ok:true hueco. */
  it("resume: la sesión reanudada trae su mundo (nunca un ok:true vacío)", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    const sessionId = started.sessionId!;
    // El mundo del arranque existe antes de guardar (snapshot o bootstrap).
    await waitFor(() => Object.keys(ctx.narrative.scenes_loaded).length > 0);
    const escenas = Object.keys(ctx.narrative.scenes_loaded).length;
    await entrarEnLaPartida(ctx, socket, sessionId);

    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    assert.equal(
      Object.keys(resumed.state?.scenes_loaded ?? {}).length,
      escenas,
      "el resume devuelve las mismas escenas, no una sesión hueca",
    );
    assert.ok(resumed.state?.world.active_scene_id, "escena activa restaurada");
    // Y el catálogo de refs se recalcula del pack (personajes + caras).
    assert.ok(Array.isArray(resumed.state?.world.style_refs.characters));

    // Tolerancia del borde: un cliente viejo que siga mandando `view` no
    // rompe nada (el zod hace strip) — el campo simplemente ya no existe.
    const { socket: s3, sent: sent3 } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r4", gameId: "toledo_1200", view: "vr" } as never,
      s3,
      ctx,
    );
    const legacy = sent3[0] as SessionStartedMessage;
    assert.equal(legacy.ok, true, "un `view` sobrante se ignora, no aborta");
    assert.ok(!("view" in (legacy.state?.world ?? {})), "y no se congela nada");
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

    // El input con "strike" simula; con un ataque estándar el sim lanza. Va
    // por el socket de la partida: con sesión abierta, el sim solo lo conduce
    // quien está DENTRO (el que pasó por start_session).
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
      socket,
      ctx,
    );
    const update = sent.find((m) => m.type === "state_update") as StateUpdateMessage;
    assert.ok(update, "el socket de la sesión conduce el sim");
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
    await entrarEnLaPartida(ctx, socket, sessionId);

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
    await ctx.narrative.save();
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

  it("start_session difunde narrative_status: error si la generación falla, TRADUCIDO", async () => {
    // El `ok:true` de la primera línea es el hecho que sostiene #189: la
    // sesión arranca ANTES de que el mundo exista, así que este fallo no llega
    // por el rechazo de `startSession` sino por un broadcast posterior. Y lo
    // que el jugador lee ahí no puede ser el volcado del motor (#180): antes
    // era «Error: No se pudo generar la escena. MCP caído».
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
    assert.ok(!err?.message?.includes("MCP caído"), `volcado al jugador: ${err?.message}`);
    assert.equal(err?.message, "El motor narrativo no pudo construirlo; inténtalo de nuevo.");
  });

  it("y el motor MUDO en el arranque tampoco enseña la excepción", async () => {
    // El caso real del bench: el ai_server caído. `generateScene` no devuelve
    // `ok:false`, LANZA — otra rama del mismo catch.
    const { ctx, broadcasts } = makeCtx({
      ai: {
        generateScene: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.equal(err?.message, "El motor narrativo no responde; inténtalo de nuevo en un momento.");
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
      terrain_legend: {},
      __expanded: true,
      entities: [
        { id: "caja", kind: "prop", name: "Caja", cell: [1, 1], footprint: [1, 1], glyph: "c" },
      ],
      ambient_event: "",
    });
    await entrarEnLaPartida(ctx, socket, sessionId);

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

  it("resume: la escena sale al wire con la vida VIVA, y sin los muertos", async () => {
    // El criterio central de #326 por el lado de la escena. Hasta esta tanda,
    // `formatDToWorld` emitía `HOSTILE_HEALTH` constante para todo hostil, así
    // que reanudar devolvía enteros a los heridos y VIVOS a los muertos.
    const { ctx, narrative } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    narrative.recordSceneLoaded("fd_pelea", {
      scene_id: "fd_pelea",
      scene_description: "prueba",
      size: { cols: 4, rows: 4, meters_per_cell: 2 },
      terrain: ["gggg", "gggg", "gggg", "gggg"],
      terrain_legend: {},
      __expanded: true,
      entities: [
        { id: "herido_1", kind: "npc", name: "Herido", role: "hostile", cell: [1, 1], footprint: [1, 1], glyph: "h" },
        { id: "muerto_1", kind: "npc", name: "Muerto", role: "hostile", cell: [2, 2], footprint: [1, 1], glyph: "m" },
        { id: "barkeep", kind: "npc", name: "Tabernero", cell: [3, 3], footprint: [1, 1], glyph: "b" },
      ],
      ambient_event: "",
    });
    // Lo que dejó la partida anterior en el ledger (lo escribe `save()` desde
    // el runtime del sim; aquí se pone a mano para aislar el sujeto: el WIRE).
    narrative.getEntity("herido_1")!.data.combat = { health: 12, max_health: 60 };
    narrative.getEntity("muerto_1")!.data.combat = { health: 0, max_health: 60 };
    await entrarEnLaPartida(ctx, socket, sessionId);

    narrative.startNewSession("plugtest");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
    const wire = resumed.state!.scenes_loaded["fd_pelea"].scene_data;
    const npcs = wire.npcs as Array<Record<string, unknown>>;

    const herido = npcs.find((n) => n.id === "herido_1");
    assert.ok(herido, "el herido vuelve");
    const combat = herido!.combat as Record<string, unknown>;
    assert.equal(combat.health, 12, "vuelve con la vida que le dejaste, no con la del contrato");
    assert.equal(combat.max_health, 60, "y con su denominador: la barra no se pinta llena");

    assert.equal(
      npcs.some((n) => n.id === "muerto_1"),
      false,
      "el muerto no vuelve: no se pinta, no se registra en el sim y no tiene barra",
    );
    assert.ok(npcs.some((n) => n.id === "barkeep"), "y el vecino pacífico sigue ahí");

    // Y lo PERSISTIDO sigue siendo Format D crudo: el overlay se escribe sobre
    // la copia del wire, no sobre el save (#179).
    const crudo = ctx.narrative.scenes_loaded["fd_pelea"].scene_data;
    assert.equal(crudo.npcs, undefined, "la persistencia no se enriquece");
    assert.equal((crudo.entities as unknown[]).length, 3, "el muerto sigue en el Format D crudo");
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

  it("resume de un save de versión vieja responde save_invalido con el motivo, no session_not_found", async () => {
    // #334/#336: un save que EXISTE pero no vale (versión vieja, contrato
    // violado) es un fallo distinto de «no existe» y el jugador debe ver el
    // motivo — antes loadSession colapsaba ambos en false.
    const { ctx, narrative } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);
    const data = (await ctx.sessionStorage.read(sessionId))!;
    (data as { schema_version: number }).schema_version = 3;
    await ctx.sessionStorage.write(sessionId, data);

    narrative.startNewSession("plugtest");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r2", sessionId }, s2, ctx);
    const started = sent2[0] as SessionStartedMessage;
    assert.equal(started.ok, false);
    assert.match(started.error ?? "", /^save_invalido: /, "molde de plugin_integrity");
    assert.match(started.error ?? "", /schema_version 3/, "el motivo viaja al jugador");
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
    await entrarEnLaPartida(ctx, socket, sessionId);

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

  it("resume tolera saves viejos con `world.perspective` en el JSON", async () => {
    const { ctx, narrative, storage } = makeCtx({
      gamesDir: REAL_GAMES_DIR,
      stylesDir: REAL_STYLES_DIR,
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "toledo_1200" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);

    // Save de la era de dos perspectivas: inyectar el campo congelado legacy.
    const saved = await storage.read(sessionId);
    assert.ok(saved);
    (saved.world as Record<string, unknown>).perspective = "isometric";
    await storage.write(sessionId, saved);

    narrative.startNewSession("toledo_1200");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, ctx);
    const resumed = sent2[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
  });

  /** SUSTITUYE al test del reintento de bootstrap, que se quedó sin sujeto
   *  con #279 (ya no nacen saves de cero escenas, así que ninguna partida en
   *  disco puede necesitarlo). Lo que se pierde: «reanudar re-encola el
   *  bootstrap». Lo que se gana es el invariante que lo hace imposible, y que
   *  es el criterio 1/3 de la tanda en unitario: un arranque que falla
   *  DESPUÉS del ok:true no deja nada en `saves/`. */
  it("bootstrap fallido y sin ack: el disco se queda VACÍO (nada que reanudar)", async () => {
    const { ctx, narrative, storage, aiCalls, broadcasts } = makeCtx({
      ai: {
        generateScene: async () => ({ ok: false as const, error: "HTTP 504: timeout tras 900s" }),
      },
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true, "el arranque contesta ok ANTES de generar: ese es el caso");
    await waitFor(() => aiCalls.scene.length === 1);
    await waitFor(() =>
      broadcasts.some((b) => b.type === "narrative_status" && (b as NarrativeStatusMessage).phase === "error"),
    );
    assert.equal(Object.keys(narrative.scenes_loaded).length, 0, "el motor no dio mundo");
    assert.deepEqual(await storage.list(), [], "y el jugador NO se encuentra una partida que nadie jugó");

    // Y el título no la ofrece, que es donde lo ve quien juega.
    await routeMessage({ type: "list_sessions", requestId: "r2" }, socket, ctx);
    const listed = sent.find((m) => m.type === "sessions_listed") as Extract<
      ServerMessage,
      { type: "sessions_listed" }
    >;
    assert.deepEqual(listed.sessions, []);
  });

  it("start_session no escribe nada: la partida existe cuando el jugador entra", async () => {
    const { ctx, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() => Object.keys(ctx.narrative.scenes_loaded).length > 0);
    // El mundo YA llegó (el tile del motor falso) y el jugador podría seguir
    // vistiéndose: hasta que no confirme, en disco no hay nada.
    assert.deepEqual(await storage.list(), [], "ni siquiera con la escena registrada");

    await entrarEnLaPartida(ctx, socket, sessionId);
    const enDisco = await storage.list();
    assert.equal(enDisco.length, 1);
    assert.equal(enDisco[0].session_id, sessionId);
    assert.ok(enDisco[0].scene_count > 0, "y lo acumulado antes del ack viaja en esa primera escritura");
  });

  it("un ack de OTRA sesión no escribe nada, y se dice", async () => {
    const { ctx, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    const log = capturarLogDelBridge();
    try {
      await entrarEnLaPartida(ctx, socket, "una-sesion-de-otro-bridge");
    } finally {
      log.soltar();
    }
    assert.deepEqual(await storage.list(), [], "el ack ajeno no puede establecer esta partida");
    assert.ok(
      log.lineas.some((l) => l.includes("una-sesion-de-otro-bridge") && l.includes(sessionId)),
      log.lineas.join(" · "),
    );
  });

  it("reanudar NO necesita ack: la partida ya existe y sigue guardando", async () => {
    const { ctx, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);

    // Proceso nuevo: solo el save. Reanudar y guardar, sin ningún ack.
    ctx.narrative.startNewSession("plugtest");
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r2", sessionId }, s2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, true);
    ctx.narrative.appendStory("el jugador siguió jugando");
    assert.deepEqual(await ctx.narrative.save(), { escrito: true });
    assert.match((await storage.read(sessionId))!.story_so_far, /siguió jugando/);
  });

  /** C5: la tecla `H` abre el libro y pide `resume_session` de la sesión
   *  activa. Durante la ventana provisional eso es `session_not_found`, y el
   *  bridge vaciaba `ctx.activePlugins` ANTES del load fallido: la partida
   *  viva se quedaba sin plugins para el motor el resto de la sesión. */
  it("un resume que falla NO deja la sesión viva sin plugins (la tecla H)", async () => {
    const { ctx } = makeCtx();
    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    assert.equal(ctx.activePlugins.size, 3);
    const sessionId = ctx.narrative.session_id;

    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r2", sessionId }, s2, ctx);
    assert.equal((sent2[0] as SessionStartedMessage).ok, false);
    assert.equal((sent2[0] as SessionStartedMessage).error, "session_not_found");
    assert.equal(ctx.activePlugins.size, 3, "los plugins de la partida viva siguen ahí");
    assert.equal(ctx.narrative.session_id, sessionId, "y la sesión no se ha movido");
  });

  it("set_render_mode con el mundo todavía en vuelo no miente con un ok", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await routeMessage(
      { type: "set_render_mode", requestId: "r2", sessionId, renderMode: "vector", facet: "scenes" },
      socket,
      ctx,
    );
    const res = sent.find((m) => m.type === "render_mode_set") as Extract<
      ServerMessage,
      { type: "render_mode_set" }
    >;
    assert.equal(res.ok, false);
    // La frase es sobre lo que el jugador VE, no sobre el estado interno (H4
    // de QA): con un motor lento el título ya se fue y está DENTRO mirando
    // el loader, así que «entra en ella» era falso justo aquí.
    assert.match(res.error ?? "", /el mundo todavía no ha llegado/);
    assert.doesNotMatch(res.error ?? "", /entra en ella/);
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
    await entrarEnLaPartida(ctx, socket, sessionId);

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

  /** El sujeto es la FRESCURA del save, no un mensaje: la posición y la vida
   *  viven en el combatiente del sim durante la partida, y hasta #245 solo se
   *  copiaban al save en un handler de guardado explícito cuyo mensaje no
   *  mandaba nadie. Ahora la fuente va ATADA al NarrativeState, así que se
   *  ejerce por un guardado CUALQUIERA del bridge —aquí el de `dialogue_choice`,
   *  que no sabe nada de posiciones— y se lee el fichero de disco. */
  it("un guardado cualquiera del bridge lleva la posición y la vida VIVAS", async () => {
    const { ctx, narrative, sim, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);

    const player = sim.getCombatant("player")!;
    player.position = { x: 4, y: 1, z: 7 };
    player.health = 42;
    // Un diálogo: guarda porque cambió la historia, no porque nadie le pida
    // un snapshot del jugador.
    await routeMessage(
      {
        type: "dialogue_choice",
        eventId: "e1",
        choiceIndex: 0,
        speaker: "Tabernero",
        chosenText: "Hola",
      },
      socket,
      ctx,
    );

    assert.deepEqual(narrative.player.position, [4, 1, 7]);
    assert.equal(narrative.player.health, 42);
    const onDisk = (await storage.read(sessionId))!;
    assert.deepEqual(onDisk.player.position, [4, 1, 7], "la posición viva llegó al disco");
    assert.equal(onDisk.player.health, 42, "y la vida también: reanudar ya no cura");
  });

  /** Lo mismo para el ENEMIGO, que es lo que faltaba: hasta #326 el save no
   *  sabía nada de su vida, así que un herido volvía entero y un muerto
   *  volvía vivo. Aquí se pelea de verdad —input con ataque por el router,
   *  como el cliente— y se mira el fichero de disco. */
  it("matar a un enemigo llega AL DISCO en el mismo tick (handleInput guarda)", async () => {
    const { ctx, narrative, sim, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);

    // El bandido, como lo deja la escena: registro en el ledger + combatiente
    // en el sim (la vía real es cliente → add_combatants). A un golpe de morir,
    // a distancia óptima del ataque rápido y SIN personalidad (no devuelve).
    const sceneId = narrative.world.active_scene_id;
    narrative.recordEntitySpawned(
      "bandido_1", "npc", sceneId, [0, 0, -1.5], { name: "Bandido", role: "hostile" }, "scene_init",
    );
    sim.addCombatant(createCombatant("bandido_1", 1, "unarmed", { x: 0, y: 0, z: -1.5 }, { x: 0, y: 0, z: 1 }, 60));
    const enDiscoAntes = (await storage.read(sessionId))!;
    assert.equal(
      enDiscoAntes.entities.find((e) => e.id === "bandido_1"),
      undefined,
      "precondición: el enemigo aún no está en el save (nadie ha guardado desde que se registró)",
    );

    const golpear = (attackRequested: boolean) =>
      routeMessage(
        {
          type: "input",
          delta: 0.05,
          inputs: {
            playerPosition: { x: 0, y: 0, z: 0 },
            playerForward: { x: 0, y: 0, z: -1 },
            playerMoving: false,
            ...(attackRequested ? { attackRequested: true, attackType: "quick" } : {}),
          },
        },
        socket,
        ctx,
      );
    await golpear(true);
    for (let i = 0; i < 10 && sim.getCombatant("bandido_1")!.health > 0; i++) await golpear(false);
    assert.equal(sim.getCombatant("bandido_1")!.health, 0, "el jugador lo mata en el sim");

    // El bloque `combat` en el disco ES la prueba de que hubo un guardado:
    // nada más guarda en este test, y el ledger nace sin él (lo escribe
    // `refreshCombatantsFromRuntime` desde el sim). Se mide así y no con
    // `updated_at`, que es un ISO de milisegundos y en esta batería el save
    // anterior cae en el MISMO ms: ese aserto salía verde o rojo según la
    // carga de la máquina, que es peor que no tenerlo.
    const onDisk = (await storage.read(sessionId))!;
    const guardado = onDisk.entities.find((e) => e.id === "bandido_1");
    assert.ok(guardado, "morir provocó un guardado: el enemigo llegó al ledger del disco");
    assert.deepEqual(
      guardado.data.combat,
      { health: 0, max_health: 60 },
      "la muerte está en el disco: reanudar ya no lo resucita",
    );
  });

  /** La otra mitad: el runtime atado es de UNA sesión. Sin soltarlo al
   *  cambiar de identidad, el primer save de la partida nueva escribiría la
   *  posición del jugador de la vieja. */
  it("empezar otra partida suelta el runtime de la anterior", async () => {
    const { ctx, narrative, sim, storage } = makeCtx();
    const { socket } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    sim.getCombatant("player")!.position = { x: 40, y: 1, z: 40 };

    // Sesión nueva EN CRUDO (sin pasar por el handler, que resiembra y vuelve
    // a atar): el sim sigue con el combatiente de la partida anterior.
    narrative.startNewSession("plugtest");
    await narrative.establecer();
    const onDisk = (await storage.read(narrative.session_id))!;
    assert.deepEqual(onDisk.player.position, [0, 1, 0], "arranque, no el final de la anterior");
  });

  /** Con partida abierta, el sim lo conduce QUIEN ESTÁ DENTRO. Antes el
   *  bridge sembraba un combatiente en (0,0,0) al arrancar el PROCESO, así que
   *  la guarda de handleInput no saltaba nunca y cualquier socket movía al
   *  jugador. Con el save llevando la posición viva, eso deja de ser latente:
   *  el cliente que está en el título tras un F5 late a 60 Hz con su posición
   *  por defecto y se lleva por delante la partida guardada. */
  it("con sesión abierta, un socket de fuera NO conduce el sim", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    sim.getCombatant("player")!.position = { x: 12, y: 1, z: -6 };

    // Otro socket: conectado al mismo bridge, pero nunca pasó por
    // start/resume (el cliente en el título, otra pestaña, un bench pegado).
    const { socket: fuera, sent: sentFuera } = makeSocket();
    const paso = (x: number, z: number) => ({
      type: "input" as const,
      delta: 0.016,
      inputs: {
        playerPosition: { x, y: 0, z },
        playerForward: { x: 0, y: 0, z: -1 },
        playerMoving: true,
      },
    });
    await routeMessage(paso(0, 2), fuera, ctx);
    assert.deepEqual(
      sim.getCombatant("player")!.position,
      { x: 12, y: 1, z: -6 },
      "el socket de fuera movió al jugador",
    );
    assert.equal(sentFuera.length, 0, "ni se le contesta con un state_update");

    // Y el de DENTRO sí, que es lo que impide que este verde sea vacío.
    const antes = sent.length;
    await routeMessage(paso(0, 2), socket, ctx);
    assert.deepEqual(sim.getCombatant("player")!.position, { x: 0, y: 0, z: 2 });
    assert.ok(sent.length > antes, "el socket de la sesión sí conduce y recibe estado");
  });

  /** EL CAMINO DEL JUGADOR, no uno legacy: jugar → F5 → título → «✕ Cerrar
   *  (modo fixtures)» → una fixture del selector. El socket de la partida se
   *  cerró, así que el mundo queda sin dueño y lo toma el cliente nuevo — para
   *  una escena de PRUEBA, así que el save deja de escuchar al sim.
   *
   *  El candado que había aquí antes usaba `crypt_001`, una sala legacy sin
   *  `tile`: era un candado sobre un mensaje que el cliente ya no manda (QA
   *  2026-08-25). La fixture es una de las de verdad, y el candado en vivo por
   *  el camino entero es `qa/guiones/25-mirar-fixtures-no-se-lleva-la-partida.mjs`. */
  it("mirar una fixture tras un F5 no se lleva la partida guardada", async () => {
    const { ctx, sim, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    sim.getCombatant("player")!.position = { x: 30, y: 1, z: 30 };
    await entrarEnLaPartida(ctx, socket, sessionId);

    // F5: el socket de la partida se va. El mundo queda sin dueño.
    ctx.world.release(socket);

    // La pestaña nueva abre una fixture del selector y anda por ella.
    const { socket: fixtura, sent: sentFixtura } = makeSocket();
    await routeMessage({ type: "load_room", roomId: "robledo_tile", enemies: [] }, fixtura, ctx);
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: -10.25, y: 0, z: -1.68 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: true,
        },
      },
      fixtura,
      ctx,
    );
    assert.deepEqual(
      sim.getCombatant("player")!.position,
      { x: -10.25, y: 0, z: -1.68 },
      "el modo fixtures sigue siendo jugable tras una partida en el mismo bridge",
    );
    assert.ok(sentFixtura.length > 0);

    // Y el motor escribe en la partida mientras tanto: no se lleva al muñeco.
    await ctx.narrative.save();
    assert.deepEqual(
      (await storage.read(sessionId))!.player.position,
      [30, 1, 30],
      "la partida guardada conserva dónde estaba el jugador",
    );
  });

  /** Variante SIN F5: el jugador vuelve al título con la misma pestaña (el
   *  botón «Volver al título» del muro) y de ahí se va a las fixtures. Ahí el
   *  mundo lo sigue teniendo SU socket, así que la toma no la refresca nadie —
   *  y sin embargo el save tiene que soltarse igual. */
  it("…y tampoco volviendo al título con la misma pestaña", async () => {
    const { ctx, sim, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    sim.getCombatant("player")!.position = { x: 30, y: 1, z: 30 };
    await entrarEnLaPartida(ctx, socket, sessionId);

    // Mismo socket, ahora mirando una fixture.
    await routeMessage({ type: "load_room", roomId: "robledo_tile", enemies: [] }, socket, ctx);
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: -10.25, y: 0, z: -1.68 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: true,
        },
      },
      socket,
      ctx,
    );
    await ctx.narrative.save();
    assert.deepEqual((await storage.read(sessionId))!.player.position, [30, 1, 30]);
  });

  /** Y una pestaña AJENA no le quita el mundo a quien está jugando: antes le
   *  congelaba el jugador (su `input` dejaba de mover nada). */
  it("un load_room ajeno no le roba el mundo a la partida viva", async () => {
    const { ctx, sim } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    assert.equal((sent[0] as SessionStartedMessage).ok, true);

    const { socket: ajeno, sent: sentAjeno } = makeSocket();
    await routeMessage({ type: "load_room", roomId: "robledo_tile", enemies: [] }, ajeno, ctx);
    assert.equal(sentAjeno.length, 0, "al socket ajeno no se le contesta nada");

    // El jugador de verdad sigue conduciendo.
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 4, y: 0, z: 4 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: true,
        },
      },
      socket,
      ctx,
    );
    assert.deepEqual(sim.getCombatant("player")!.position, { x: 4, y: 0, z: 4 });
  });

  /** Reaparecer también MUEVE al jugador, y con el save escuchando al sim eso
   *  acaba en el `state.json`: mismo dueño que el input (I3 de QA). */
  it("un respawn ajeno no teletransporta al jugador de la partida", async () => {
    const { ctx, sim, storage } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);
    sim.getCombatant("player")!.position = { x: 12, y: 1, z: -6 };

    const { socket: ajeno, sent: sentAjeno } = makeSocket();
    await routeMessage({ type: "respawn", pos: { x: 0, y: 0, z: 0 } }, ajeno, ctx);
    assert.equal(sentAjeno.length, 0, "al socket ajeno no se le contesta nada");
    assert.deepEqual(sim.getCombatant("player")!.position, { x: 12, y: 1, z: -6 });

    await ctx.narrative.save();
    assert.deepEqual((await storage.read(sessionId))!.player.position, [12, 1, -6]);
  });

  it("resume_session resiembra el sim con la posición y HP guardados", async () => {
    const bundle = makeCtx();
    const { ctx, sim, store } = bundle;
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "start_session", requestId: "r1", gameId: "plugtest" }, socket, ctx);
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await entrarEnLaPartida(ctx, socket, sessionId);
    const player = sim.getCombatant("player")!;
    player.position = { x: -5, y: 1, z: 9 };
    player.health = 33;
    await ctx.narrative.save();

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
    // Por el MISMO socket: es el camino real (el jugador vuelve al título con
    // su pestaña y abre el selector «Room»). Un socket ajeno no puede tomar
    // el mundo de una partida viva — eso lo canda el test de abajo.
    sent.length = 0;
    await routeMessage({ ...loadRoom }, socket, withSession.ctx);
    const inSessionUpdate = sent[0] as StateUpdateMessage;
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

  // Aquí vivía «broadcastScene proyecta las entities enemy…», que se va con
  // `state-projection.ts` (#323). Tenía el defecto exacto que esta tanda vino
  // a corregir: fabricaba a mano una entity `type:"enemy"` que la producción
  // NO puede producir —el enum de `spawn_entity` es npc/building/object y
  // `EmittedSceneSchema` rechaza `kind:"enemy"`—, así que pasaba siempre y no
  // podía ponerse rojo por la razón que importa. Lo que ahora sí se mide, y
  // en una partida real, es `qa/guiones/41-el-jugador-puede-pelear.mjs`.
});


describe("set_render_mode (cambio de modo por faceta, ambos sentidos)", () => {
  /** Save mínimo en vector como los pre-facetas: sin character_mode. La
   *  versión es la ACTUAL — un save viejo ya no carga (#336) y el sujeto de
   *  estos tests es el campo ausente, no la versión. */
  const legacyVectorSave = (id: string) =>
    ({
      schema_version: 5,
      session_id: id,
      game_id: "toledo_1200",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      world: { render_mode: "vector" },
      player: {},
      story_so_far: "",
      scenes_loaded: {},
      entities: [],
      dialogue_history: [],
      asset_index_snapshot: [],
      world_map: { places: [], links: [], triggers: [] },
      plugins: [],
      _next_event_seq: 1,
    }) as unknown as import("../src/narrative/types.js").SessionData;

  it("activar escenarios en save legacy FIJA character_mode=vector (no arrastra los skins)", async () => {
    const { ctx } = makeCtx();
    await ctx.sessionStorage.write("s1", legacyVectorSave("s1"));
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s1", renderMode: "image", facet: "scenes" },
      socket,
      ctx,
    );
    assert.deepEqual(sent[0], {
      type: "render_mode_set", requestId: "r1", ok: true, facet: "scenes", renderMode: "image",
    });
    const data = await ctx.sessionStorage.read("s1");
    assert.equal(data?.world.render_mode, "image");
    // Regresión: sin este pin, character_mode "" seguiría a render_mode y
    // activar escenarios activaría también los skins IA (gasto no pedido).
    assert.equal(data?.world.character_mode, "vector");
  });

  it("activar personajes deja los escenarios en vector", async () => {
    const { ctx } = makeCtx();
    await ctx.sessionStorage.write("s2", legacyVectorSave("s2"));
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s2", renderMode: "image", facet: "characters" },
      socket,
      ctx,
    );
    assert.deepEqual(sent[0], {
      type: "render_mode_set", requestId: "r1", ok: true, facet: "characters", renderMode: "image",
    });
    const data = await ctx.sessionStorage.read("s2");
    assert.equal(data?.world.render_mode, "vector");
    assert.equal(data?.world.character_mode, "image");
  });

  it("doble activación y sesión inexistente fallan con error claro", async () => {
    const { ctx } = makeCtx();
    await ctx.sessionStorage.write("s3", legacyVectorSave("s3"));
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s3", renderMode: "image", facet: "scenes" },
      socket, ctx,
    );
    await routeMessage(
      { type: "set_render_mode", requestId: "r2", sessionId: "s3", renderMode: "image", facet: "scenes" },
      socket, ctx,
    );
    await routeMessage(
      { type: "set_render_mode", requestId: "r3", sessionId: "no_existe", renderMode: "image" },
      socket, ctx,
    );
    assert.equal((sent[1] as { ok: boolean }).ok, false);
    assert.match((sent[1] as { error?: string }).error ?? "", /ya tiene los escenarios/);
    assert.equal((sent[2] as { ok: boolean }).ok, false);
    assert.match((sent[2] as { error?: string }).error ?? "", /no existe/);
    // Facet desconocido: rechazar, no adivinar (un typo activaría otra faceta).
    await routeMessage(
      { type: "set_render_mode", requestId: "r4", sessionId: "s3", renderMode: "image", facet: "scene" as never },
      socket, ctx,
    );
    assert.equal((sent[3] as { ok: boolean }).ok, false);
    assert.match((sent[3] as { error?: string }).error ?? "", /facet desconocido/);
    // renderMode fuera del enum: rechazar (mismo motivo, el wire no está validado aquí).
    await routeMessage(
      { type: "set_render_mode", requestId: "r5", sessionId: "s3", renderMode: "clay" as never, facet: "scenes" },
      socket, ctx,
    );
    assert.equal((sent[4] as { ok: boolean }).ok, false);
    assert.match((sent[4] as { error?: string }).error ?? "", /renderMode desconocido/);
  });

  it("image → vector en save inactivo: lo baja y no arrastra los skins legacy", async () => {
    const { ctx } = makeCtx();
    const save = legacyVectorSave("s6");
    (save.world as { render_mode: string }).render_mode = "image";
    await ctx.sessionStorage.write("s6", save);
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s6", renderMode: "vector", facet: "scenes" },
      socket, ctx,
    );
    assert.deepEqual(sent[0], {
      type: "render_mode_set", requestId: "r1", ok: true, facet: "scenes", renderMode: "vector",
    });
    const data = await ctx.sessionStorage.read("s6");
    assert.equal(data?.world.render_mode, "vector");
    // Sin el pin, character_mode "" seguiría a render_mode y bajar escenarios
    // apagaría también los skins IA (apagado no pedido).
    assert.equal(data?.world.character_mode, "image");
  });

  it("con la sesión ACTIVA, el cambio se difunde como render_mode_changed", async () => {
    const { ctx, narrative, broadcasts } = makeCtx();
    await ctx.sessionStorage.write("s7", legacyVectorSave("s7"));
    assert.equal(await narrative.loadSession("s7"), true, "la sesión activa sale del save");
    narrative.world.render_mode = "image";
    narrative.world.character_mode = "image";
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s7", renderMode: "vector", facet: "characters" },
      socket, ctx,
    );
    assert.deepEqual(sent[0], {
      type: "render_mode_set", requestId: "r1", ok: true, facet: "characters", renderMode: "vector",
    });
    assert.equal(narrative.world.character_mode, "vector");
    assert.deepEqual(broadcasts.at(-1), {
      type: "render_mode_changed", sessionId: "s7", facet: "characters", renderMode: "vector",
    });
  });

  it("con la sesión ACTIVA, el espejo en memoria fija ambos modos", async () => {
    const { ctx, narrative } = makeCtx();
    await ctx.sessionStorage.write("s4", legacyVectorSave("s4"));
    assert.equal(await narrative.loadSession("s4"), true, "la sesión activa sale del save");
    narrative.world.render_mode = "vector";
    narrative.world.character_mode = "";
    const { socket } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s4", renderMode: "image", facet: "scenes" },
      socket, ctx,
    );
    assert.equal(narrative.world.render_mode, "image");
    assert.equal(narrative.world.character_mode, "vector");
  });

  it("con la sesión ACTIVA persiste vía narrative.save() SIN pisar el estado más nuevo en memoria", async () => {
    const { ctx, narrative } = makeCtx();
    // Disco tiene el snapshot inicial (story_so_far vacío).
    await ctx.sessionStorage.write("s5", legacyVectorSave("s5"));
    // La sesión activa avanzó EN MEMORIA (progreso aún no reflejado en ese
    // snapshot de disco) — el escritor único es narrative.
    assert.equal(await narrative.loadSession("s5"), true, "la sesión activa sale del save");
    narrative.world.render_mode = "vector";
    narrative.world.character_mode = "";
    narrative.story_so_far = "el jugador cruzó tres tiles";
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "set_render_mode", requestId: "r1", sessionId: "s5", renderMode: "image", facet: "scenes" },
      socket, ctx,
    );
    assert.deepEqual(sent[0], {
      type: "render_mode_set", requestId: "r1", ok: true, facet: "scenes", renderMode: "image",
    });
    const data = await ctx.sessionStorage.read("s5");
    // El flag se activó en disco...
    assert.equal(data?.world.render_mode, "image");
    assert.equal(data?.world.character_mode, "vector");
    // ...Y el estado MÁS NUEVO en memoria se preservó. Con el read-modify-write
    // anterior (leer disco → mutar → escribir), story_so_far habría revertido a
    // "" (el snapshot de disco), pisando el progreso.
    assert.equal(data?.story_so_far, "el jugador cruzó tres tiles");
  });
});
