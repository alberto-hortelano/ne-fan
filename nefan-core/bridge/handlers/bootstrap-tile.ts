/** Bootstrap del tile (0,0) de una sesión nueva — extraído del handler de
 *  sesión: generación LLM (con world_document y bootstrap_world_map), fijado
 *  de la verdad geométrica, validación de jugabilidad, expansión de
 *  primitivas, snapshot de mundo y broadcast. Corre dentro de la cola de
 *  generación (ctx.sceneGen); lo encolan start_session, el reintento de
 *  resume sin escenas y el job generate_game (que usa el núcleo sin
 *  broadcast). */
import { loadWorldDoc } from "../../src/games/loader.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { tileKey } from "../../src/scene/tile.js";
import {
  broadcastScene,
  sessionChangedError,
  writeSessionSnapshot,
  type BridgeContext,
} from "../context.js";

/** Núcleo del bootstrap de tile, compartido por la sesión en vivo y por
 *  generate_game: llama al motor (que siembra el world map vía map tools),
 *  valida y expande el tile (0,0) y lo registra en la sesión. LANZA en
 *  cualquier fallo — el caller difunde el narrative_status que corresponda. */
export async function generateBootstrapTileScene(
  ctx: BridgeContext,
  sessionGameId: string,
  opts: { generateVocabulary?: boolean } = {},
): Promise<{ sceneId: string; scene: Record<string, unknown> }> {
  const jobSession = ctx.narrative.session_id;
  const llmCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  // Fresh session: ask the narrative engine to bootstrap the world map
  // (3-5 places + sites + links) via the map tools before it builds the
  // starting tile. Progressive expansion happens tile a tile.
  llmCtx.bootstrap_world_map = true;
  // Solo en el bootstrap viaja el documento COMPLETO del mundo; el resto de
  // turnos llevan world.description y la tool world_doc_get da el detalle.
  llmCtx.world_document = loadWorldDoc(ctx.gamesDir, sessionGameId);
  if (opts.generateVocabulary) llmCtx.generate_world_vocabulary = true;
  llmCtx.generate_tile = {
    tx: 0,
    ty: 0,
    neighbors: {},
    nearby_places: [],
    bootstrap: true,
  };
  const res = await ctx.aiClient.generateScene(llmCtx);
  // Defensa en profundidad: si un takeover se coló pese a la guardia de
  // session.ts, el tile NO se escribe en la sesión equivocada.
  const changed = sessionChangedError(ctx, jobSession);
  if (changed) throw new Error(changed);
  if (!res.ok || !res.scene) {
    throw new Error(`No se pudo generar la escena. ${res.error ?? "Revisa el motor narrativo."}`);
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
      throw new Error(`El tile inicial no es jugable: ${check.errors.join(" · ")}`);
    }
  } else {
    sceneId = String(res.scene.room_id ?? `scene_${Date.now()}`);
  }
  // Expandir primitivas ANTES de persistir y de snapshotear: lo guardado,
  // snapshoteado y difundido es Format D plano.
  res.scene = expandScenePrimitives(res.scene);
  ctx.narrative.recordSceneLoaded(sceneId, res.scene);
  await ctx.narrative.save();
  return { sceneId, scene: res.scene };
}

/** Genera el tile (0,0) de una sesión nueva — corre dentro de la cola. El
 *  motor siembra el world map (map tools) y responde el tile de arranque con
 *  la escena inicial (taberna…), player y place_anchors. */
export async function runBootstrapTile(
  ctx: BridgeContext,
  sessionGameId: string,
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
    const { sceneId, scene } = await generateBootstrapTileScene(ctx, sessionGameId);
    // Snapshot pasivo del mundo ANTES de que broadcastScene mute la escena
    // con `exits`: la segunda partida de este juego arranca sin motor. Los
    // replays vuelven a pasar por broadcastScene, que re-adjunta los exits
    // desde el world map restaurado.
    writeSessionSnapshot(ctx, sessionGameId, "tile", sceneId);
    broadcastScene(ctx, sceneId, scene, Date.now() - sceneStart);
    // broadcastScene mutated the scene with `exits` — persist them.
    await ctx.narrative.save();
  } catch (err) {
    console.warn("Bridge: generate_scene failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}
