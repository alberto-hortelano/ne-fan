/** Handlers de ciclo de vida de sesión: listado de juegos/sesiones, start,
 *  resume, delete y save. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createCombatant } from "../../src/combat/combatant.js";
import { combatRegistry } from "../../src/combat/registry.js";
import {
  GameMetaSchema,
  listGames,
  listStyles,
  loadGameMeta,
  loadStyleManifest,
  loadWorldDoc,
} from "../../src/games/loader.js";
import { WorldMapManager } from "../../src/world-map/world-map.js";
import {
  loadGamePluginManifests,
  activatePluginsForNewSession,
  bindPluginsForResume,
} from "../../src/plugins/loader.js";
import {
  broadcastScene,
  createSessionNpcBehavior,
  npcSync,
  type BridgeContext,
  type ClientSocket,
} from "../context.js";
import { npcBehaviorRegistry } from "../../src/simulation/npc-behavior-registry.js";
import { isPerspective } from "../../src/scene/blueprint/index.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { tileKey } from "../../src/scene/tile.js";
import type {
  CreateGameMessage,
  DeleteSessionMessage,
  ListGamesMessage,
  ListSessionsMessage,
  ResumeSessionMessage,
  SaveSessionMessage,
  StartSessionMessage,
} from "../../src/protocol/messages.js";

export function handleListGames(
  msg: ListGamesMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): void {
  ctx.send(ws, {
    type: "games_listed",
    requestId: msg.requestId,
    games: listGames(ctx.gamesDir),
    styles: listStyles(ctx.stylesDir),
  });
}

/** Mundo subido por el jugador: el borrador se desarrolla con el motor
 *  narrativo (POST /develop_world → MCP kind develop_world) y el resultado se
 *  escribe como data/games/user_{slug}/. Fail-loud en cada paso — un mundo a
 *  medias no debe aparecer en el listado. */
export async function handleCreateGame(
  msg: CreateGameMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const fail = (error: string): void => {
    console.error(`Bridge: create_game failed: ${error}`);
    ctx.send(ws, { type: "game_created", requestId: msg.requestId, ok: false, error });
  };
  const draft = (msg.draftText ?? "").trim();
  if (draft.length < 20) {
    return fail("draft_too_short: describe el mundo con al menos unas frases");
  }
  if (draft.length > 64_000) {
    return fail("draft_too_long: máximo ~64k caracteres");
  }

  const res = await ctx.aiClient.developWorld(draft);
  if (!res.ok) {
    return fail(`develop_world: ${res.error}`);
  }
  const game = res.game;

  // Slug propio con prefijo user_ (el id que sugiera el LLM es solo una
  // base); dedupe con sufijo numérico si ya existe.
  const base = `user_${String(game.game_id || game.title || "mundo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "mundo"}`;
  let gameId = base;
  for (let i = 2; existsSync(join(ctx.gamesDir, gameId)); i++) {
    gameId = `${base}_${i}`;
  }

  // El estilo sugerido debe existir; si no, el primero disponible.
  const styles = listStyles(ctx.stylesDir);
  if (styles.length === 0) {
    return fail("no_styles_available: no hay estilos en data/styles");
  }
  const styleId = styles.some((st) => st.style_id === game.style_id)
    ? game.style_id
    : styles[0].style_id;

  const meta = GameMetaSchema.safeParse({
    game_id: gameId,
    title: game.title,
    description: game.description,
    style_id: styleId,
    world_brief: game.world_brief,
  });
  if (!meta.success) {
    return fail(`develop_world produced invalid game meta: ${meta.error.message.slice(0, 500)}`);
  }
  if (typeof game.world_md !== "string" || game.world_md.length < 2000) {
    return fail("develop_world produced a world_md too short (<2000 chars)");
  }

  const dir = join(ctx.gamesDir, gameId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.json"), JSON.stringify(meta.data, null, 2) + "\n", "utf-8");
  writeFileSync(join(dir, "world.md"), game.world_md, "utf-8");
  console.log(`Bridge: mundo de usuario creado: ${gameId} ("${meta.data.title}")`);
  ctx.send(ws, {
    type: "game_created",
    requestId: msg.requestId,
    ok: true,
    gameId,
    title: meta.data.title,
  });
}

export async function handleListSessions(
  msg: ListSessionsMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  const sessions = await ctx.sessionStorage.list();
  // Poda de saves basura: un bootstrap fallido deja un save "0 escenas" en
  // disco (start_session persiste antes de generar). El de la sesión ACTIVA
  // se conserva — reanudarla ES el reintento del bootstrap (ver
  // handleResumeSession); los demás son restos de sesiones abandonadas.
  const alive: typeof sessions = [];
  for (const s of sessions) {
    if (s.scene_count === 0 && s.session_id !== ctx.narrative.session_id) {
      const ok = await ctx.sessionStorage.delete(s.session_id);
      if (!ok) console.error(`Bridge: no se pudo podar el save vacío ${s.session_id}`);
      continue;
    }
    alive.push(s);
  }
  ctx.send(ws, { type: "sessions_listed", requestId: msg.requestId, sessions: alive });
}

/** Resembra el sim para la sesión vigente: runtime nuevo (sin este reset el
 *  sim arrastra los combatientes y el HP de la sesión anterior del proceso) +
 *  player con el HP/posición del NarrativeState (defaults en start, save en
 *  resume — misma fuente). Común a start_session y resume_session. */
function reseedSimForSession(
  ctx: BridgeContext,
  combatId: string,
  npcBehaviorId: string | undefined,
): void {
  ctx.sim.reset();
  ctx.sim.setCombatSystem(combatRegistry.create(combatId, ctx.combatConfig));
  ctx.sim.setNpcBehavior(createSessionNpcBehavior(ctx, npcBehaviorId));
  const hp = ctx.narrative.player.health;
  const pos = ctx.narrative.player.position;
  ctx.sim.addCombatant(
    createCombatant(
      "player",
      hp,
      ctx.store.state.player.weapon_id,
      { x: pos[0], y: pos[1], z: pos[2] },
      { x: 0, y: 0, z: -1 },
    ),
  );
  ctx.store.dispatch("player_respawned", { hp, pos: [...pos] });
}

export async function handleStartSession(
  msg: StartSessionMessage,
  ws: ClientSocket,
  ctx: BridgeContext,
): Promise<void> {
  // El juego debe existir y validar ANTES de crear la sesión — arrancar un
  // mundo roto en silencio dejaría al motor narrativo sin identidad de mundo.
  let worldKey: string;
  let combatId: string;
  let npcBehaviorId: string | undefined;
  try {
    const meta = loadGameMeta(ctx.gamesDir, msg.gameId);
    // Estilo: el elegido por el jugador o el por defecto del juego. Un
    // styleId inexistente aborta (fail-loud), no degrada en silencio.
    const style = loadStyleManifest(ctx.stylesDir, msg.styleId || meta.style_id);
    // Perspectiva: elegida en el título o default del juego. Queda CONGELADA
    // en el save igual que el estilo; un valor desconocido aborta.
    const perspective = msg.perspective || meta.default_perspective || "topdown";
    if (!isPerspective(perspective)) {
      throw new Error(`perspectiva desconocida "${perspective}" (esperaba topdown|isometric)`);
    }
    // Modo de render: imagen IA (créditos) o mundo vectorial (blueprints
    // compuestos). Congelado como el estilo: mezclar tiles pintados y
    // vectoriales rompe la continuidad visual entre vecinos.
    const renderMode = msg.renderMode || "image";
    if (renderMode !== "image" && renderMode !== "vector") {
      throw new Error(`modo de render desconocido "${renderMode}" (esperaba image|vector)`);
    }
    // Sistema de combate: el que declare game.json (systems.combat) o el
    // estándar. Queda CONGELADO en el save como el estilo/perspectiva; un id
    // fuera del registro aborta (fail-loud), no degrada en silencio.
    combatId = meta.systems?.combat ?? combatRegistry.defaultId;
    if (!combatRegistry.has(combatId)) {
      throw new Error(
        `sistema de combate desconocido "${combatId}" (esperaba ${combatRegistry.ids().join("|")})`,
      );
    }
    // Vida ambiental de NPCs: no se congela en el save (v1, una sola
    // implementación) pero el id se valida igual de fail-loud.
    npcBehaviorId = meta.systems?.npc_behavior;
    if (npcBehaviorId !== undefined && !npcBehaviorRegistry.has(npcBehaviorId)) {
      throw new Error(
        `sistema npc_behavior desconocido "${npcBehaviorId}" (esperaba ${npcBehaviorRegistry.ids().join("|")})`,
      );
    }
    const worldDoc = loadWorldDoc(ctx.gamesDir, msg.gameId);
    const worldDocHash = createHash("sha256").update(worldDoc, "utf-8").digest("hex");
    // La perspectiva forma parte de la identidad del bootstrap cacheado: los
    // blueprints compuestos difieren aunque el mundo y el estilo coincidan.
    worldKey = `${worldDocHash}:${style.style_id}:${perspective}`;
    ctx.activePlugins = new Map();
    ctx.narrative.startNewSession(msg.gameId);
    ctx.narrative.setWorldInfo({
      name: meta.title,
      description: meta.world_brief,
      style_id: style.style_id,
      style_token: style.style_token,
      world_doc_hash: worldDocHash,
      perspective,
      render_mode: renderMode,
      combat_system: combatId,
    });
  } catch (err) {
    console.error("Bridge: game load failed on start_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `game_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
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
  reseedSimForSession(ctx, combatId, npcBehaviorId);
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
  const cached = ctx.cacheInitialScene ? ctx.initialSceneCache.get(msg.gameId, worldKey) : null;
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

  // Generate the initial TILE (0,0) asynchronously (via the shared queue) and
  // broadcast it as a narrative_event so all subscribed clients render the
  // same world. Emit lifecycle hints so the client can show a loader.
  const sessionGameId = msg.gameId;
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "tile",
    tile: { tx: 0, ty: 0 },
    message: "Generando mundo inicial...",
  });
  ctx.sceneGen.enqueue({
    key: "bootstrap",
    blocking: true,
    run: () => runBootstrapTile(ctx, sessionGameId, worldKey),
  });
}

/** Genera el tile (0,0) de una sesión nueva — corre dentro de la cola. El
 *  motor siembra el world map (map tools) y responde el tile de arranque con
 *  la escena inicial (taberna…), player y place_anchors. */
async function runBootstrapTile(
  ctx: BridgeContext,
  sessionGameId: string,
  worldKey = "",
): Promise<void> {
  const sceneStart = Date.now();
  const fail = (message: string): void =>
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "tile",
      tile: { tx: 0, ty: 0 },
      message,
      elapsedMs: Date.now() - sceneStart,
    });
  try {
    const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
    // Fresh session: ask the narrative engine to bootstrap the world map
    // (3-5 places + sites + links) via the map tools before it builds the
    // starting tile. Progressive expansion happens tile a tile.
    llmCtx.bootstrap_world_map = true;
    // Solo en el bootstrap viaja el documento COMPLETO del mundo; el resto de
    // turnos llevan world.description y la tool world_doc_get da el detalle.
    llmCtx.world_document = loadWorldDoc(ctx.gamesDir, sessionGameId);
    llmCtx.generate_tile = {
      tx: 0,
      ty: 0,
      neighbors: {},
      nearby_places: [],
      bootstrap: true,
    };
    const res = await ctx.aiClient.generateScene(llmCtx);
    if (!res.ok || !res.scene) {
      return fail(`No se pudo generar la escena. ${res.error ?? "Revisa el motor narrativo."}`);
    }
    // El bridge fija la verdad geométrica del tile de arranque. Las escenas
    // legacy (sin biome) siguen pasando por la ruta antigua de Format D v2.
    const isTileScene = res.scene.tile !== undefined || res.scene.biome !== undefined;
    let sceneId: string;
    if (isTileScene) {
      res.scene.tile = { tx: 0, ty: 0 };
      sceneId = tileKey(0, 0);
      res.scene.scene_id = sceneId;
      res.scene.room_id = sceneId;
      const check = validateScene(res.scene, undefined, { required_crossings: [], bootstrap: true });
      if (!check.ok) {
        return fail(`El tile inicial no es jugable: ${check.errors.join(" · ")}`);
      }
    } else {
      sceneId = String(res.scene.room_id ?? `scene_${Date.now()}`);
    }
    // Expandir primitivas ANTES de persistir y de cachear: lo guardado,
    // cacheado y difundido es Format D plano.
    res.scene = expandScenePrimitives(res.scene);
    ctx.narrative.recordSceneLoaded(sceneId, res.scene);
    await ctx.narrative.save();
    // Snapshot the bootstrap before broadcastScene mutates the scene
    // with `exits`. Replays go through broadcastScene again, which
    // re-attaches exits from the restored world map.
    if (ctx.cacheInitialScene) {
      try {
        ctx.initialSceneCache.set(sessionGameId, res.scene, ctx.narrative.worldMap.serialize(), worldKey);
        console.log(`Bridge: initial_scene_cache SET for gameId="${sessionGameId}"`);
      } catch (cacheErr) {
        console.warn(
          `Bridge: initial_scene_cache SET failed for "${sessionGameId}":`,
          cacheErr,
        );
      }
    }
    broadcastScene(ctx, sceneId, res.scene, Date.now() - sceneStart);
    // broadcastScene mutated the scene with `exits` — persist them.
    await ctx.narrative.save();
  } catch (err) {
    console.warn("Bridge: generate_scene failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
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
  // Sistema de combate congelado en el save (saves previos sin campo →
  // estándar). Un id fuera del registro aborta el resume — fail-loud, igual
  // que un plugin narrativo desaparecido.
  const combatId = ctx.narrative.world.combat_system || combatRegistry.defaultId;
  if (!combatRegistry.has(combatId)) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `combat_system_unknown: "${combatId}" (esperaba ${combatRegistry.ids().join("|")})`,
    });
    return;
  }
  // Vida ambiental: no congelada en el save (v1, una sola implementación) —
  // se lee del game.json vigente. El game dir existe (el bind de plugins de
  // arriba ya lo leyó); un id fuera del registro aborta como el de combate.
  let npcBehaviorId: string | undefined;
  try {
    npcBehaviorId = loadGameMeta(ctx.gamesDir, ctx.narrative.game_id).systems?.npc_behavior;
  } catch (err) {
    console.error("Bridge: game load failed on resume_session:", err);
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `game_load_failed: ${(err as Error).message ?? err}`,
    });
    return;
  }
  if (npcBehaviorId !== undefined && !npcBehaviorRegistry.has(npcBehaviorId)) {
    ctx.send(ws, {
      type: "session_started",
      requestId: msg.requestId,
      ok: false,
      error: `npc_behavior_unknown: "${npcBehaviorId}" (esperaba ${npcBehaviorRegistry.ids().join("|")})`,
    });
    return;
  }
  reseedSimForSession(ctx, combatId, npcBehaviorId);
  // Los NPC del save vuelven a la vida ambiental donde se quedaron (su
  // posición vive en el EntityRecord persistido).
  npcSync(ctx);
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
  // Sesión sin NINGUNA escena = el bootstrap de su creación falló (timeout
  // del motor narrativo, MCP caído…). Reanudar ES el reintento: re-encolar
  // el bootstrap con la MISMA sesión — si la respuesta tardía del intento
  // anterior llegó a ai_server, la sirve al instante sin re-generar.
  if (Object.keys(ctx.narrative.scenes_loaded).length === 0) {
    console.log(
      `Bridge: resume de sesión sin escenas (${ctx.narrative.session_id}) — reintentando bootstrap`,
    );
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "tile",
      tile: { tx: 0, ty: 0 },
      message: "Reintentando la generación del mundo inicial...",
    });
    const resumeGameId = ctx.narrative.game_id;
    ctx.sceneGen.enqueue({
      // Key propia: con "bootstrap" el dedupe de la cola puede descartar el
      // reintento si el job fallido del arranque aún figura en vuelo (su
      // finally corre un microtask después del broadcast de error).
      key: "bootstrap_retry",
      blocking: true,
      // Sin worldKey: el initial-scene-cache es solo para el arranque dev.
      run: () => runBootstrapTile(ctx, resumeGameId),
    });
  }
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
