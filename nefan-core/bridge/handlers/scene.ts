/** Handler de transición de lugar del world-map: re-broadcast de escena
 *  cacheada o lazy realize vía el motor narrativo, más los map triggers.
 *  La generación pasa por la cola compartida (ctx.sceneGen): el motor solo
 *  atiende una petición a la vez y las demás esperan en vez de perderse. */

import {
  broadcastScene,
  fireMapTriggers,
  type BridgeContext,
} from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { oppositeEdge } from "../../src/world-map/edges.js";
import { handleFrontierAsTile } from "./tile.js";
import type { Edge } from "../../src/world-map/types.js";
import type {
  PlayerCrossedFrontierMessage,
  PlayerEnteredPlaceMessage,
} from "../../src/protocol/messages.js";

const EDGE_ES: Record<Edge, string> = {
  north: "norte",
  south: "sur",
  east: "este",
  west: "oeste",
};

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
  const status = ctx.sceneGen.enqueue({
    key: `place_${placeId}`,
    blocking: true,
    run: () => runPlaceRealize(ctx, placeId, prevPlaceId),
  });
  if (status !== "queued") {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: `Generando ${place.name}...`,
    });
  }
}

/** Generación de la escena de un place — corre dentro de la cola. */
async function runPlaceRealize(
  ctx: BridgeContext,
  placeId: string,
  prevPlaceId: string,
): Promise<void> {
  const place = ctx.narrative.worldMap.get(placeId);
  if (!place) return;
  const realizeStart = Date.now();
  const fail = (message: string): void =>
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      message,
      elapsedMs: Date.now() - realizeStart,
    });
  try {
    // Pudo realizarse mientras esperaba en la cola.
    if (place.realized_scene_id && ctx.narrative.scenes_loaded[place.realized_scene_id]) return;

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
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: `Generando ${place.name}...`,
    });

    const res = await ctx.aiClient.generateScene(realizeCtx);
    if (!res.ok || !res.scene) {
      return fail(`No se pudo generar ${place.name}. ${res.error ?? "Revisa el motor narrativo."}`);
    }
    const sceneId = String(res.scene.room_id ?? res.scene.scene_id ?? `scene_${Date.now()}`);
    // Expandir primitivas (structures/vegetation) ANTES de persistir: lo
    // guardado y difundido es Format D plano.
    res.scene = expandScenePrimitives(res.scene);
    // Tag the scene with the place so recordSceneLoaded attaches it.
    res.scene.place_id = placeId;
    ctx.narrative.recordSceneLoaded(sceneId, res.scene);
    await ctx.narrative.save();
    broadcastScene(ctx, sceneId, res.scene, Date.now() - realizeStart);
    await fireMapTriggers(ctx, prevPlaceId, placeId);
  } catch (err) {
    console.warn("Bridge: lazy realize failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}

/** El jugador cruzó un borde SIN destino conocido. Con el plano de tiles la
 *  frontera ES el tile vecino: delega en el pipeline de tiles. La ruta legacy
 *  (place+link de la tanda 2) queda solo para sesiones cuya escena activa no
 *  es un tile. */
export async function handlePlayerCrossedFrontier(
  msg: PlayerCrossedFrontierMessage,
  ctx: BridgeContext,
): Promise<void> {
  if (await handleFrontierAsTile(msg.edge, ctx)) return;

  const fromPlaceId = ctx.narrative.worldMap.serialize().active_place_id;
  const fromPlace = ctx.narrative.worldMap.get(fromPlaceId);
  if (!fromPlace) {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      message: `Frontera sin place activo válido: "${fromPlaceId}"`,
    });
    return;
  }
  const status = ctx.sceneGen.enqueue({
    key: `frontier_${fromPlaceId}_${msg.edge}`,
    blocking: true,
    run: () => runLegacyFrontier(ctx, fromPlaceId, msg.edge),
  });
  if (status !== "queued") {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: `Explorando hacia el ${EDGE_ES[msg.edge]}...`,
    });
  }
}

/** Frontera legacy (tanda 2): el motor crea place + link y el bridge estampa
 *  el edge con la geometría real del cruce. */
async function runLegacyFrontier(
  ctx: BridgeContext,
  fromPlaceId: string,
  edge: Edge,
): Promise<void> {
  const start = Date.now();
  const fail = (message: string): void =>
    ctx.broadcastNarrative({ type: "narrative_status", phase: "error", kind: "scene", message, elapsedMs: Date.now() - start });
  try {
    const fromPlace = ctx.narrative.worldMap.get(fromPlaceId);
    if (!fromPlace) return fail(`Frontera sin place activo válido: "${fromPlaceId}"`);

    const genCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
    genCtx.frontier_request = {
      from_place_id: fromPlaceId,
      from_place_name: fromPlace.name,
      edge,
    };
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: `Explorando hacia el ${EDGE_ES[edge]}...`,
    });

    const res = await ctx.aiClient.generateScene(genCtx);
    if (!res.ok || !res.scene) {
      return fail(`No se pudo expandir el mundo. ${res.error ?? "Revisa el motor narrativo."}`);
    }
    const newPlaceId = typeof res.scene.place_id === "string" ? res.scene.place_id : null;
    if (!newPlaceId) {
      return fail("El motor respondió una escena de frontera sin place_id.");
    }
    if (!ctx.narrative.worldMap.get(newPlaceId)) {
      return fail(`El motor no creó el place "${newPlaceId}" en el mapa (map_upsert_place).`);
    }
    const link = ctx.narrative.worldMap
      .getOutgoingLinks(fromPlaceId)
      .find((l) => (l.from === fromPlaceId ? l.to : l.from) === newPlaceId);
    if (!link) {
      return fail(`El motor no linkó "${newPlaceId}" con "${fromPlaceId}" (map_link).`);
    }
    // El edge es relativo a link.from (puede ser cualquiera de los dos).
    const expected = link.from === fromPlaceId ? edge : oppositeEdge(edge);
    if (link.edge !== expected) {
      if (link.edge) {
        console.warn(`Bridge: frontier link edge "${link.edge}" != cruzado "${expected}" — corregido`);
      }
      link.edge = expected;
    }

    const sceneId = String(res.scene.room_id ?? res.scene.scene_id ?? `scene_${Date.now()}`);
    res.scene = expandScenePrimitives(res.scene);
    ctx.narrative.recordSceneLoaded(sceneId, res.scene);
    await ctx.narrative.save();
    broadcastScene(ctx, sceneId, res.scene, Date.now() - start);
    await fireMapTriggers(ctx, fromPlaceId, newPlaceId);
  } catch (err) {
    console.warn("Bridge: frontier expansion failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}
