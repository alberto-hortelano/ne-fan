/** Bootstrap del tile (0,0) de una sesión nueva — extraído del handler de
 *  sesión: generación LLM (con world_document y bootstrap_world_map), fijado
 *  de la verdad geométrica, validación de jugabilidad, expansión de
 *  primitivas, cache dev del arranque y broadcast. Corre dentro de la cola de
 *  generación (ctx.sceneGen); lo encolan start_session y el reintento de
 *  resume sin escenas. */
import { loadWorldDoc } from "../../src/games/loader.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { tileKey } from "../../src/scene/tile.js";
import { broadcastScene, type BridgeContext } from "../context.js";

/** Genera el tile (0,0) de una sesión nueva — corre dentro de la cola. El
 *  motor siembra el world map (map tools) y responde el tile de arranque con
 *  la escena inicial (taberna…), player y place_anchors. */
export async function runBootstrapTile(
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
