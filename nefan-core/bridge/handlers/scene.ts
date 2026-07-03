/** Handler de transición de lugar del world-map: re-broadcast de escena
 *  cacheada o lazy realize vía el motor narrativo, más los map triggers. */

import {
  broadcastScene,
  fireMapTriggers,
  type BridgeContext,
} from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { oppositeEdge } from "../../src/world-map/edges.js";
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

/** Guard single-flight compartido por los dos handlers de escena: con una
 *  generación en vuelo, una petición nueva se dropea (el cliente congela el
 *  movimiento, pero un segundo socket o el emulador pueden colarse) y se
 *  re-difunde `generating` para que un cliente recién conectado mantenga el
 *  loader. Devuelve true si hay que abortar. */
function dropIfSceneGenInFlight(ctx: BridgeContext, what: string): boolean {
  if (!ctx.pendingSceneGen) return false;
  console.warn(
    `Bridge: ${what} dropped — ${ctx.pendingSceneGen.kind}(${ctx.pendingSceneGen.key}) in flight`,
  );
  ctx.broadcastNarrative({ type: "narrative_status", phase: "generating", kind: "scene" });
  return true;
}

export async function handlePlayerEnteredPlace(
  msg: PlayerEnteredPlaceMessage,
  ctx: BridgeContext,
): Promise<void> {
  if (dropIfSceneGenInFlight(ctx, `player_entered_place(${msg.placeId})`)) return;
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
  ctx.pendingSceneGen = { kind: "realize", key: placeId };
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
    })
    .finally(() => {
      ctx.pendingSceneGen = null;
    });
}

/** El jugador cruzó un borde SIN destino conocido en el world map: pedir al
 *  motor narrativo que extienda el mundo en esa dirección. El motor debe crear
 *  el place nuevo + map_link (el pre-flight de narrative_respond ya exige que
 *  el place exista y tenga ≥1 link) y responder la escena que lo realiza. El
 *  bridge valida el link concreto con el place de origen y ESTAMPA el edge con
 *  la geometría real del cruce — el determinismo gana al LLM. */
export async function handlePlayerCrossedFrontier(
  msg: PlayerCrossedFrontierMessage,
  ctx: BridgeContext,
): Promise<void> {
  if (dropIfSceneGenInFlight(ctx, `player_crossed_frontier(${msg.edge})`)) return;
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

  const genCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  genCtx.frontier_request = {
    from_place_id: fromPlaceId,
    from_place_name: fromPlace.name,
    edge: msg.edge,
  };
  const start = Date.now();
  ctx.pendingSceneGen = { kind: "frontier", key: `${fromPlaceId}:${msg.edge}` };
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "scene",
    message: `Explorando hacia el ${EDGE_ES[msg.edge]}...`,
  });

  ctx.aiClient
    .generateScene(genCtx)
    .then(async (res) => {
      const elapsedMs = Date.now() - start;
      const fail = (message: string): void =>
        ctx.broadcastNarrative({ type: "narrative_status", phase: "error", kind: "scene", message, elapsedMs });

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
      const expected = link.from === fromPlaceId ? msg.edge : oppositeEdge(msg.edge);
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
      broadcastScene(ctx, sceneId, res.scene, elapsedMs);
      await fireMapTriggers(ctx, fromPlaceId, newPlaceId);
    })
    .catch((err) => {
      console.warn("Bridge: frontier expansion failed:", err);
      ctx.broadcastNarrative({
        type: "narrative_status",
        phase: "error",
        kind: "scene",
        message: `Error: ${(err as Error).message ?? err}`,
        elapsedMs: Date.now() - start,
      });
    })
    .finally(() => {
      ctx.pendingSceneGen = null;
    });
}
