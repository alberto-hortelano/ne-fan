/** Handler de tiles del plano continuo: re-broadcast instantáneo de tiles ya
 *  generados (re-render sin LLM) y generación encolada de tiles nuevos con el
 *  contexto de costuras de sus vecinos. */

import { broadcastScene, fireMapTriggers, type BridgeContext } from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene, type TileValidationContext } from "../../src/scene/scene-validate.js";
import { TILE_MPC, tileKey, tileWorldRect, neighborTile, worldToTile, type TileCoord } from "../../src/scene/tile.js";
import { oppositeEdge } from "../../src/world-map/edges.js";
import type { Edge } from "../../src/world-map/types.js";
import type { LlmContext } from "../../src/narrative/types.js";
import type { RequestTileMessage } from "../../src/protocol/messages.js";

const EDGE_ES: Record<Edge, string> = {
  north: "norte",
  south: "sur",
  east: "este",
  west: "oeste",
};

/** Contexto de generación de un tile: vecinos existentes (bioma + cruces del
 *  borde compartido, `at` espejo sin transformación), entrada del jugador y
 *  places cercanos (anclados a tiles del vecindario). */
export function buildGenerateTileCtx(
  ctx: BridgeContext,
  tx: number,
  ty: number,
  approachEdge?: Edge,
): NonNullable<LlmContext["generate_tile"]> {
  const neighbors: NonNullable<LlmContext["generate_tile"]>["neighbors"] = {};
  for (const [edge, rec] of Object.entries(ctx.narrative.neighborsOf(tx, ty)) as Array<
    [Edge, (typeof ctx.narrative.scenes_loaded)[string]]
  >) {
    const shared = rec.edges?.[oppositeEdge(edge)];
    neighbors[edge] = {
      tile: [rec.tile!.tx, rec.tile!.ty],
      scene_id: String(rec.scene_data.scene_id ?? ""),
      description: String(rec.scene_data.scene_description ?? ""),
      biome: shared?.biome ?? String(rec.scene_data.biome ?? "grass"),
      crossings: shared?.crossings ?? [],
    };
  }

  // Places cuya escena realizada es un tile del vecindario (radio 2).
  const nearby: NonNullable<LlmContext["generate_tile"]>["nearby_places"] = [];
  for (const place of Object.values(ctx.narrative.worldMap.map.places)) {
    if (!place.realized_scene_id) continue;
    const rec = ctx.narrative.scenes_loaded[place.realized_scene_id];
    if (!rec?.tile) continue;
    if (Math.abs(rec.tile.tx - tx) <= 2 && Math.abs(rec.tile.ty - ty) <= 2) {
      nearby.push({ id: place.id, name: place.name, kind: place.kind, tile: [rec.tile.tx, rec.tile.ty] });
    }
  }

  return {
    tx,
    ty,
    neighbors,
    // El jugador entra al tile nuevo por el borde OPUESTO al que cruza.
    entry: approachEdge ? { edge: oppositeEdge(approachEdge) } : undefined,
    nearby_places: nearby,
  };
}

/** Genera el tile (tx,ty) — corre DENTRO de la cola (un job a la vez). Captura
 *  sus propios errores y los difunde como narrative_status. */
export async function runTileGeneration(
  ctx: BridgeContext,
  tx: number,
  ty: number,
  approachEdge?: Edge,
): Promise<void> {
  const key = tileKey(tx, ty);
  const start = Date.now();
  const fail = (message: string): void =>
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "tile",
      tile: { tx, ty },
      edge: approachEdge,
      message,
      elapsedMs: Date.now() - start,
    });
  try {
    // El tile pudo generarse mientras esperaba en la cola.
    if (ctx.narrative.hasTile(tx, ty)) return;

    const genCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
    const tileCtx = buildGenerateTileCtx(ctx, tx, ty, approachEdge);
    genCtx.generate_tile = tileCtx;
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "tile",
      tile: { tx, ty },
      edge: approachEdge,
      message: approachEdge
        ? `Explorando hacia el ${EDGE_ES[approachEdge]}...`
        : `Generando el tile (${tx}, ${ty})...`,
    });

    const res = await ctx.aiClient.generateScene(genCtx);
    if (!res.ok || !res.scene) {
      return fail(`No se pudo generar el tile (${tx}, ${ty}). ${res.error ?? "Revisa el motor narrativo."}`);
    }
    // El bridge fija la verdad geométrica aunque el motor invente otra cosa.
    res.scene.tile = { tx, ty };
    res.scene.scene_id = key;
    res.scene.room_id = key;

    // Red de seguridad server-side (el pre-flight MCP ya validó, pero el
    // fake-ai del bench y la ruta API directa no pasan por él).
    const required: TileValidationContext["required_crossings"] = [];
    for (const [edge, n] of Object.entries(tileCtx.neighbors) as Array<[Edge, { crossings: { type: string; at: number; width: number }[] }]>) {
      for (const c of n.crossings) {
        required.push({ edge, ...(c as { type: "path" | "road" | "river" | "bridge"; at: number; width: number }) });
      }
    }
    const check = validateScene(res.scene, undefined, {
      required_crossings: required,
      entry: tileCtx.entry as { edge: Edge; at?: number } | undefined,
    });
    if (!check.ok) {
      return fail(`El tile (${tx}, ${ty}) no es jugable: ${check.errors.join(" · ")}`);
    }

    const expanded = expandScenePrimitives(res.scene);
    // Sin activar: la escena activa la decide la POSICIÓN del jugador (el
    // prefetch no roba el tile actual).
    ctx.narrative.recordSceneLoaded(key, expanded, [], { activate: false });
    await ctx.narrative.save();
    broadcastScene(ctx, key, expanded, Date.now() - start, { edge: approachEdge });
  } catch (err) {
    console.warn(`Bridge: generación del tile ${key} falló:`, err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}

export async function handleRequestTile(
  msg: RequestTileMessage,
  ctx: BridgeContext,
): Promise<void> {
  const { tx, ty } = msg;
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "tile",
      message: `request_tile con coords inválidas: (${tx}, ${ty})`,
    });
    return;
  }
  const existing = ctx.narrative.getTile(tx, ty);
  if (existing) {
    // Re-render al volver: difusión inmediata del esquema persistido, sin LLM
    // y sin robar la escena activa (eso lo decide la posición del jugador).
    broadcastScene(ctx, tileKey(tx, ty), existing.scene_data, undefined, { edge: msg.edge });
    return;
  }
  const status = ctx.sceneGen.enqueue({
    key: tileKey(tx, ty),
    blocking: msg.reason === "blocking",
    run: () => runTileGeneration(ctx, tx, ty, msg.edge),
  });
  if (status !== "queued" && msg.reason === "blocking") {
    // Ya en cola/en vuelo: re-difundir generating para que el cliente que
    // espera pegado al borde mantenga el velo.
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "tile",
      tile: { tx, ty },
      edge: msg.edge,
    });
  }
}

/** Activación por POSICIÓN (mundo continuo): al cambiar de celda, activar el
 *  tile pisado y el place cuyo anchor contiene al jugador, disparando los map
 *  triggers (player_entered/left/first_visit). Llamado desde el hot loop de
 *  input — gateado por cambio de celda para que el coste sea ~0. */
export async function activateByPosition(
  ctx: BridgeContext,
  x: number,
  z: number,
): Promise<void> {
  const t = worldToTile(x, z);
  const rect = tileWorldRect(t.tx, t.ty);
  const cell = `${t.tx},${t.ty}:${Math.floor((x - rect.minX) / TILE_MPC)},${Math.floor((z - rect.minZ) / TILE_MPC)}`;
  if (ctx.posTracking.cellKey === cell) return;
  ctx.posTracking.cellKey = cell;

  if (ctx.narrative.hasTile(t.tx, t.ty)) {
    ctx.narrative.setActiveTile(t.tx, t.ty);
  }

  // Place anclado que contiene la posición (rect en celdas del tile; sin
  // rect = todo el tile). El más específico (con rect) gana.
  const col = Math.floor((x - rect.minX) / TILE_MPC);
  const row = Math.floor((z - rect.minZ) / TILE_MPC);
  let placeId: string | null = null;
  let hasRect = false;
  for (const place of Object.values(ctx.narrative.worldMap.map.places)) {
    const a = place.anchor;
    if (!a || a.tx !== t.tx || a.ty !== t.ty) continue;
    if (a.rect) {
      const [c0, r0, w, h] = a.rect;
      if (col >= c0 && col < c0 + w && row >= r0 && row < r0 + h) {
        placeId = place.id;
        hasRect = true;
      }
    } else if (!hasRect && placeId === null) {
      placeId = place.id;
    }
  }

  if (placeId && placeId !== ctx.posTracking.placeId) {
    const prev = ctx.narrative.worldMap.serialize().active_place_id;
    ctx.posTracking.placeId = placeId;
    ctx.narrative.worldMap.setActivePlace(placeId);
    ctx.narrative.worldMap.markVisited(placeId);
    ctx.narrative.markDirty();
    await fireMapTriggers(ctx, prev, placeId);
  } else if (!placeId) {
    ctx.posTracking.placeId = null;
  }
}

/** Tile del jugador según la escena activa (o su posición como fallback). */
export function activeTileOf(ctx: BridgeContext): TileCoord | null {
  const active = ctx.narrative.scenes_loaded[ctx.narrative.world.active_scene_id];
  if (active?.tile) return active.tile;
  return null;
}

/** El viejo player_crossed_frontier (tanda 2) delega en el pipeline de tiles:
 *  el vecino del tile activo en esa dirección, como blocking. */
export async function handleFrontierAsTile(
  edge: Edge,
  ctx: BridgeContext,
): Promise<boolean> {
  const active = activeTileOf(ctx);
  if (!active) return false;
  const n = neighborTile(active.tx, active.ty, edge);
  await handleRequestTile({ type: "request_tile", tx: n.tx, ty: n.ty, reason: "blocking", edge }, ctx);
  return true;
}
