/** Handler de transición de lugar del world-map: re-broadcast de escena
 *  cacheada o lazy realize vía el motor narrativo, más los map triggers. */

import {
  broadcastScene,
  fireMapTriggers,
  type BridgeContext,
} from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import type { PlayerEnteredPlaceMessage } from "../../src/protocol/messages.js";

export async function handlePlayerEnteredPlace(
  msg: PlayerEnteredPlaceMessage,
  ctx: BridgeContext,
): Promise<void> {
  const placeId = msg.placeId;
  const place = ctx.narrative.worldMap.get(placeId);
  if (!place) {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      message: `Lugar desconocido en el mapa: ${placeId}`,
    });
    return;
  }
  // Captured before the place becomes active, so we can fire player_left.
  const prevPlaceId = ctx.narrative.worldMap.serialize().active_place_id;

  // Already realized → re-activate and re-broadcast the cached scene.
  const cachedSceneId = place.realized_scene_id;
  if (cachedSceneId && ctx.narrative.scenes_loaded[cachedSceneId]) {
    const cachedScene = ctx.narrative.scenes_loaded[cachedSceneId].scene_data;
    // recordSceneLoaded re-activates the place AND (re-)registers the
    // scene's NPCs into entities so the narrative engine sees them.
    ctx.narrative.recordSceneLoaded(cachedSceneId, cachedScene);
    await ctx.narrative.save();
    broadcastScene(ctx, cachedSceneId, cachedScene);
    await fireMapTriggers(ctx, prevPlaceId, placeId);
    return;
  }

  // Lazy realize: ask the narrative engine for this place's low-level scene.
  const realizeCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  realizeCtx.realize_place = {
    id: place.id,
    kind: place.kind,
    name: place.name,
    description: place.description,
    attrs: place.attrs,
    sites: ctx.narrative.worldMap.getChildren(placeId).map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      description: s.description,
    })),
    links: ctx.narrative.worldMap.getOutgoingLinks(placeId),
  };
  const realizeStart = Date.now();
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "scene",
    message: `Generando ${place.name}...`,
  });
  ctx.aiClient
    .generateScene(realizeCtx)
    .then(async (res) => {
      const elapsedMs = Date.now() - realizeStart;
      if (!res.ok || !res.scene) {
        ctx.broadcastNarrative({
          type: "narrative_status",
          phase: "error",
          kind: "scene",
          message: `No se pudo generar ${place.name}. ${res.error ?? "Revisa el motor narrativo."}`,
          elapsedMs,
        });
        return;
      }
      const sceneId = String(res.scene.room_id ?? res.scene.scene_id ?? `scene_${Date.now()}`);
      // Expandir primitivas (structures/vegetation) ANTES de persistir: lo
      // guardado y difundido es Format D plano. Un throw cae al catch de abajo
      // y se difunde como narrative_status error.
      res.scene = expandScenePrimitives(res.scene);
      // Tag the scene with the place so recordSceneLoaded attaches it.
      res.scene.place_id = placeId;
      ctx.narrative.recordSceneLoaded(sceneId, res.scene);
      await ctx.narrative.save();
      broadcastScene(ctx, sceneId, res.scene, elapsedMs);
      await fireMapTriggers(ctx, prevPlaceId, placeId);
    })
    .catch((err) => {
      console.warn("Bridge: lazy realize failed:", err);
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message: `Error: ${(err as Error).message ?? err}`,
        elapsedMs: Date.now() - realizeStart,
      });
    });
}
