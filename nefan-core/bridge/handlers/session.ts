/** Handlers de ciclo de vida de sesión: listado de juegos/sesiones, start,
 *  resume, delete, save y el bypass legacy load_game. */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { createCombatant } from "../../src/combat/combatant.js";
import { WorldMapManager } from "../../src/world-map/world-map.js";
import {
  loadGamePluginManifests,
  activatePluginsForNewSession,
  bindPluginsForResume,
} from "../../src/plugins/loader.js";
import { broadcastScene, type BridgeContext, type ClientSocket } from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import type {
  DeleteSessionMessage,
  ListGamesMessage,
  ListSessionsMessage,
  LoadGameMessage,
  ResumeSessionMessage,
  SaveSessionMessage,
  StartSessionMessage,
  StateUpdateMessage,
} from "../../src/protocol/messages.js";

export function listGames(
  gamesDir: string,
): Array<{ game_id: string; title: string; description?: string }> {
  if (!existsSync(gamesDir)) {
    throw new Error(`games directory not found: ${gamesDir}`);
  }
  const out: Array<{ game_id: string; title: string; description?: string }> = [];
  for (const entry of readdirSync(gamesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const gameJson = resolve(gamesDir, entry.name, "game.json");
    if (!existsSync(gameJson)) continue;
    let def: { game_id?: string; title?: string; description?: string };
    try {
      def = JSON.parse(readFileSync(gameJson, "utf-8"));
    } catch (err) {
      throw new Error(`game.json malformed (${gameJson}): ${(err as Error).message}`, {
        cause: err,
      });
    }
    out.push({
      game_id: def.game_id ?? entry.name,
      title: def.title ?? entry.name,
      description: def.description,
    });
  }
  return out;
}

export function handleListGames(
  msg: ListGamesMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  ctx.send(ws, { type: "games_listed", requestId: msg.requestId, games: listGames(ctx.gamesDir) });
}

export async function handleListSessions(
  msg: ListSessionsMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const sessions = await ctx.sessionStorage.list();
  ctx.send(ws, { type: "sessions_listed", requestId: msg.requestId, sessions });
}

export async function handleStartSession(
  msg: StartSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  ctx.activePlugins = new Map();
  ctx.narrative.startNewSession(msg.gameId);
  if (msg.appearance) {
    ctx.narrative.updatePlayerAppearance(msg.appearance.model_id, msg.appearance.skin_path);
  }
  // Génesis de plugins shipped (F3): validación + projections. Un
  // manifest inválido aborta el arranque de sesión — fail-loud.
  try {
    const loaded = loadGamePluginManifests(ctx.gamesDir, msg.gameId);
    ctx.activePlugins = activatePluginsForNewSession(ctx.narrative, loaded);
  } catch (err) {
    console.error("Bridge: plugin load failed on start_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `plugin_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
  // Sesión nueva ⇒ runtime nuevo: sin este reset el sim arrastra los
  // combatientes (y el HP herido) de la sesión anterior del proceso.
  ctx.sim.reset();
  const freshHp = ctx.narrative.player.health;
  const freshPos = ctx.narrative.player.position;
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      freshHp,
      ctx.store.state.player.weapon_id,
      { x: freshPos[0], y: freshPos[1], z: freshPos[2] },
      { x: 0, y: 0, z: -1 },
    ),
  );
  ctx.store.dispatch("player_respawned", { hp: freshHp, pos: [...freshPos] });
  await ctx.aiClient.notifySessionStart(ctx.narrative.session_id, msg.gameId, false);
  await ctx.narrative.save();
  ctx.subscribe(ws);
  ctx.send(ws, {
    type: "session_started",
    requestId: msg.requestId,
    ok: true,
    sessionId: ctx.narrative.session_id,
    gameId: ctx.narrative.game_id,
    isResume: false,
    state: ctx.narrative.toSessionData(),
  });
  // Dev-only shortcut: replay a cached bootstrap (world_map + first
  // scene) for the same gameId instead of paying the ~90 s LLM cost.
  // Gated by CONFIG.dev.cache_initial_scene; off in production.
  const cached = ctx.cacheInitialScene ? ctx.initialSceneCache.get(msg.gameId) : null;
  if (cached) {
    console.log(
      `Bridge: initial_scene_cache HIT for gameId="${msg.gameId}" ` +
        `(cached_at=${cached.cached_at}); skipping LLM bootstrap`,
    );
    // Restore the world map that the narrative engine bootstrapped on
    // the cached run, then replay the scene through the normal
    // recordSceneLoaded + broadcastScene path so NPCs, exits and the
    // visited flag all line up.
    ctx.narrative.worldMap = WorldMapManager.fromSerialized(
      JSON.parse(JSON.stringify(cached.world_map)),
    );
    const cachedScene = JSON.parse(JSON.stringify(cached.scene)) as Record<string, unknown>;
    const sceneId = String(cachedScene.room_id ?? `scene_${Date.now()}`);
    ctx.narrative.recordSceneLoaded(sceneId, cachedScene);
    await ctx.narrative.save();
    broadcastScene(ctx, sceneId, cachedScene, 0);
    await ctx.narrative.save();
    return;
  }

  // Generate the initial scene asynchronously and broadcast it as a
  // narrative_event so all subscribed clients render the same world.
  // Emit lifecycle hints so the client can show a loader instead of a
  // blank canvas while we wait on the LLM.
  const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  // Fresh session: ask the narrative engine to bootstrap the world map
  // (3-5 places + sites + links) via the map tools before it builds the
  // starting scene. Progressive expansion happens later, via the tools.
  llmCtx.bootstrap_world_map = true;
  const sceneStart = Date.now();
  const sessionGameId = msg.gameId;
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "scene",
    message: "Generando mundo inicial...",
  });
  ctx.aiClient
    .generateScene(llmCtx)
    .then(async (res) => {
      const elapsedMs = Date.now() - sceneStart;
      if (!res.ok || !res.scene) {
        ctx.broadcastNarrative({
          type: "narrative_status",
          phase: "error",
          kind: "scene",
          message: `No se pudo generar la escena. ${res.error ?? "Revisa el motor narrativo."}`,
          elapsedMs,
        });
        return;
      }
      const sceneId = String(res.scene.room_id ?? `scene_${Date.now()}`);
      // Expandir primitivas (structures/vegetation) ANTES de persistir y de
      // cachear: lo guardado, cacheado y difundido es Format D plano. Un throw
      // cae al catch y se difunde como narrative_status error.
      res.scene = expandScenePrimitives(res.scene);
      ctx.narrative.recordSceneLoaded(sceneId, res.scene);
      await ctx.narrative.save();
      // Snapshot the bootstrap before broadcastScene mutates the scene
      // with `exits`. Replays go through broadcastScene again, which
      // re-attaches exits from the restored world map.
      if (ctx.cacheInitialScene) {
        try {
          ctx.initialSceneCache.set(sessionGameId, res.scene, ctx.narrative.worldMap.serialize());
          console.log(`Bridge: initial_scene_cache SET for gameId="${sessionGameId}"`);
        } catch (cacheErr) {
          console.warn(
            `Bridge: initial_scene_cache SET failed for "${sessionGameId}":`,
            cacheErr,
          );
        }
      }
      broadcastScene(ctx, sceneId, res.scene, elapsedMs);
      // broadcastScene mutated the scene with `exits` — persist them.
      await ctx.narrative.save();
    })
    .catch((err) => {
      console.warn("Bridge: generate_scene failed:", err);
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message: `Error: ${(err as Error).message ?? err}`,
        elapsedMs: Date.now() - sceneStart,
      });
    });
}

export async function handleResumeSession(
  msg: ResumeSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  ctx.activePlugins = new Map();
  const ok = await ctx.narrative.loadSession(msg.sessionId);
  if (!ok) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: "session_not_found",
    });
    return;
  }
  // Bind de plugins shipped (F3): el slice vive en el save, el manifest
  // se relee del FS y se casa por id (integridad fail-loud).
  try {
    const loaded = loadGamePluginManifests(ctx.gamesDir, ctx.narrative.game_id);
    ctx.activePlugins = bindPluginsForResume(ctx.narrative, loaded);
  } catch (err) {
    console.error("Bridge: plugin bind failed on resume_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `plugin_integrity: ${(err as Error).message ?? err}`,
    });
    return;
  }
  // Resembrar el sim desde el save: sin esto arrastra los combatientes de la
  // sesión anterior y el HP guardado nunca vuelve al runtime.
  ctx.sim.reset();
  const savedPos = ctx.narrative.player.position;
  const savedHp = ctx.narrative.player.health;
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      savedHp,
      ctx.store.state.player.weapon_id,
      { x: savedPos[0], y: savedPos[1], z: savedPos[2] },
      { x: 0, y: 0, z: -1 },
    ),
  );
  ctx.store.dispatch("player_respawned", { hp: savedHp, pos: [...savedPos] });
  await ctx.aiClient.notifySessionStart(ctx.narrative.session_id, ctx.narrative.game_id, true);
  ctx.subscribe(ws);
  ctx.send(ws, {
    type: "session_started",
    requestId: msg.requestId,
    ok: true,
    sessionId: ctx.narrative.session_id,
    gameId: ctx.narrative.game_id,
    isResume: true,
    state: ctx.narrative.toSessionData(),
  });
}

export async function handleDeleteSession(
  msg: DeleteSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const ok = await ctx.sessionStorage.delete(msg.sessionId);
  ctx.send(ws, { type: "session_deleted", requestId: msg.requestId, ok });
}

export async function handleSaveSession(
  msg: SaveSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // Snapshot del runtime antes de escribir: posición y HP viven en el sim
  // durante el juego y sólo se persisten aquí (un único punto de sincronía).
  const player = ctx.sim.getCombatant("player");
  if (player) {
    ctx.narrative.updatePlayerPosition(player.position, ctx.narrative.world.active_scene_id);
    ctx.narrative.updatePlayerHealth(player.health);
  } else {
    console.warn("Bridge: save_session without player combatant — runtime snapshot skipped");
  }
  const ok = await ctx.narrative.save();
  ctx.send(ws, { type: "session_saved", requestId: msg.requestId, ok });
}

export function handleLoadGame(msg: LoadGameMessage, ws: ClientSocket, ctx: BridgeContext): void {
  // Reset simulation
  ctx.sim.reset();
  ctx.scenario
    .loadGame(ctx.gamesDir, msg.gameId)
    .then(async (sceneData) => {
      if (!sceneData) {
        // No initial scene materialized — the scenario runner expected
        // one but loadSceneData returned null. Reply directly to the
        // requesting socket: `load_game` is the legacy bypass path so
        // the caller is not necessarily in `narrativeSubscribers`, and
        // a `broadcastNarrative` would not reach them.
        const message = `load_game '${msg.gameId}': scenario produced no initial scene`;
        console.warn(`Bridge: ${message}`);
        ctx.send(ws, {
          type: "narrative_status",
          phase: "error",
          kind: "scene",
          message,
        });
        return;
      }

      // Set up player
      const playerHp = 100;
      ctx.store.dispatch("player_respawned", { hp: playerHp, pos: [0, 0, 0] });
      ctx.sim.addCombatant(
        createCombatant("player", playerHp, "unarmed", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }),
      );

      // Send scene data first so Godot rebuilds the room
      const sceneResponse: StateUpdateMessage = {
        type: "state_update",
        events: [{ type: "player_respawned", hp: playerHp }],
        playerHp,
        enemies: [],
        scenario: { change_scene: sceneData },
      };
      ctx.send(ws, sceneResponse);

      // Run an initial tick to execute first beat actions (spawn NPCs, dialogue, etc.)
      const initialTick = await ctx.scenario.tick(0, { x: 0, y: 0, z: 0 });

      // Send beat actions after a short delay so Godot has time to build the scene
      if (initialTick.scenarioUpdates.length > 0) {
        setTimeout(() => {
          for (const u of initialTick.scenarioUpdates) {
            const beatResponse: StateUpdateMessage = {
              type: "state_update",
              events: [],
              playerHp,
              enemies: [],
              npcs: initialTick.npcs,
              scenario: u,
            };
            ctx.send(ws, beatResponse);
          }
        }, 500);
      }

      console.log(`Bridge: game '${msg.gameId}' loaded`);
    })
    .catch((err: unknown) => {
      // Reply directly to the requesting socket — see the !sceneData
      // branch above for why we don't `broadcastNarrative` here.
      const message = `load_game '${msg.gameId}' failed: ${(err as Error).message ?? String(err)}`;
      console.error(`Bridge: ${message}`);
      ctx.send(ws, {
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message,
      });
    });
}
