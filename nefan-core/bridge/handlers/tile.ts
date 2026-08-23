/** Handler de tiles del plano continuo: re-broadcast instantáneo de tiles ya
 *  generados (re-render sin LLM) y generación encolada de tiles nuevos con el
 *  contexto de costuras de sus vecinos. */

import {
  attachWorldVocabulary,
  broadcastScene,
  fireMapTriggers,
  npcSync,
  sessionChangedError,
  type BridgeContext,
} from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene, type TileValidationContext } from "../../src/scene/scene-validate.js";
import { TILE_MPC, tileKey, tileWorldRect, worldToTile, type TileCoord } from "../../src/scene/tile.js";
import { oppositeEdge } from "../../src/world-map/edges.js";
import type { Edge } from "../../src/world-map/types.js";
import type { LlmContext } from "../../src/narrative/types.js";
import type { RequestTileMessage } from "../../src/protocol/messages.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";

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

  // Places del vecindario (radio 2), situados por su `anchor` o por una
  // escena realizada que sea un tile. El place anclado a ESTE tile no es
  // "cercano": es lo que hay que construir aquí, y viaja aparte en `place`.
  const nearby: NonNullable<LlmContext["generate_tile"]>["nearby_places"] = [];
  let place: NonNullable<LlmContext["generate_tile"]>["place"];
  for (const p of Object.values(ctx.narrative.worldMap.map.places)) {
    const realizedTile = p.realized_scene_id
      ? ctx.narrative.scenes_loaded[p.realized_scene_id]?.tile
      : undefined;
    const coord: TileCoord | undefined = p.anchor ?? realizedTile;
    if (!coord) continue;
    if (coord.tx === tx && coord.ty === ty) {
      place ??= {
        id: p.id,
        name: p.name,
        kind: p.kind,
        description: p.description,
        attrs: p.attrs,
      };
      continue;
    }
    if (Math.abs(coord.tx - tx) <= 2 && Math.abs(coord.ty - ty) <= 2) {
      nearby.push({ id: p.id, name: p.name, kind: p.kind, tile: [coord.tx, coord.ty] });
    }
  }

  return {
    tx,
    ty,
    neighbors,
    // El jugador entra al tile nuevo por el borde OPUESTO al que cruza.
    entry: approachEdge ? { edge: oppositeEdge(approachEdge) } : undefined,
    ...(place ? { place } : {}),
    nearby_places: nearby,
  };
}

/** Núcleo de generación de un tile, compartido por la sesión en vivo y por
 *  generate_game: LLM con contexto de costuras, validación server-side,
 *  expansión y registro SIN activar (la escena activa la decide la posición
 *  del jugador). "exists" si el tile ya estaba; LANZA en cualquier fallo.
 *  `opts.placeId` marca el tile como la escena realizada de ese place (viaje
 *  a un lugar anclado): recordSceneLoaded lo engancha y las exits difundidas
 *  pasan a ser las suyas. */
export async function generateTileScene(
  ctx: BridgeContext,
  tx: number,
  ty: number,
  approachEdge?: Edge,
  opts: { placeId?: string } = {},
): Promise<{ sceneId: string; scene: Record<string, unknown> } | "exists"> {
  const key = tileKey(tx, ty);
  // El tile pudo generarse mientras esperaba en la cola.
  if (ctx.narrative.hasTile(tx, ty)) return "exists";

  const jobSession = ctx.narrative.session_id;
  const genCtx = ctx.narrative.serializeForLlm(ctx.activePlugins);
  const tileCtx = buildGenerateTileCtx(ctx, tx, ty, approachEdge);
  genCtx.generate_tile = tileCtx;
  attachWorldVocabulary(ctx, genCtx);

  const res = await ctx.aiClient.generateScene(genCtx);
  // Defensa en profundidad: takeover colado ⇒ descartar sin escribir.
  const changed = sessionChangedError(ctx, jobSession);
  if (changed) throw new Error(changed);
  if (!res.ok || !res.scene) {
    throw new Error(`No se pudo generar el tile (${tx}, ${ty}). ${res.error ?? "Revisa el motor narrativo."}`);
  }
  // El bridge fija la verdad geométrica aunque el motor invente otra cosa.
  res.scene.tile = { tx, ty };
  res.scene.scene_id = key;
  res.scene.room_id = key;
  // De qué LUGAR es este tile lo decide el BRIDGE, no el modelo: el place que
  // se está realizando al viajar (`opts.placeId`) o el que ya tiene su anchor
  // en estas coordenadas (`tileCtx.place`, el mismo que viajó al motor en el
  // contexto). Determinista y sin pedirle nada al prompt.
  //
  // El `else` no sobra: si el bridge sabe que aquí no hay ningún lugar, un
  // place_id inventado por el motor secuestraría el binding —
  // `recordSceneLoaded` lo activaría como place— y el panel «Salidas» pasaría
  // a pintar las salidas de OTRO sitio. Campo abierto es campo abierto.
  const tilePlaceId = opts.placeId ?? tileCtx.place?.id;
  if (tilePlaceId) res.scene.place_id = tilePlaceId;
  else delete res.scene.place_id;

  // Red de seguridad server-side (el pre-flight MCP ya validó, pero el
  // fake-ai del bench y la ruta API directa no pasan por él).
  const required: TileValidationContext["required_crossings"] = [];
  for (const [edge, n] of Object.entries(tileCtx.neighbors) as Array<[Edge, { crossings: { type: string; at: number; width: number }[] }]>) {
    for (const c of n.crossings) {
      required.push({ edge, ...(c as { type: "path" | "road" | "river" | "bridge"; at: number; width: number }) });
    }
  }
  const check = validateScene(res.scene, {
    required_crossings: required,
    entry: tileCtx.entry as { edge: Edge; at?: number } | undefined,
  });
  if (!check.ok) {
    throw new Error(`El tile (${tx}, ${ty}) no es jugable: ${check.errors.join(" · ")}`);
  }

  const expanded = expandScenePrimitives(res.scene);
  // Sin activar: la escena activa la decide la POSICIÓN del jugador (el
  // prefetch no roba el tile actual).
  ctx.narrative.recordSceneLoaded(key, expanded, [], { activate: false });
  await ctx.narrative.save();
  return { sceneId: key, scene: expanded };
}

/** Genera el tile (tx,ty) — corre DENTRO de la cola (un job a la vez). Captura
 *  sus propios errores y los difunde como narrative_status.
 *  `opts` sirve al viaje a un place anclado: `placeId` engancha el tile al
 *  lugar, `message` narra "Viajando a X..." en vez de "Explorando..." y
 *  `spawnAt` PIDE al cliente que aparezca ahí cuando el tile esté listo. Es
 *  una función porque se resuelve AL DIFUNDIR: el motor pudo declarar
 *  `place_anchors` con rect y afinar el anclaje durante la generación. */
export async function runTileGeneration(
  ctx: BridgeContext,
  tx: number,
  ty: number,
  approachEdge?: Edge,
  opts: {
    placeId?: string;
    message?: string;
    /** Nombre del LUGAR al que se viaja, para el mensaje de error que lee el
     *  jugador. Sin él, un viaje fallido le enseñaba coordenadas de tile. */
    destino?: string;
    spawnAt?: () => { x: number; z: number } | undefined;
  } = {},
): Promise<SceneGenOutcome> {
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
    // El tile pudo generarse mientras esperaba en la cola: se difunde IGUAL.
    // Antes solo se difundía si había spawn pedido, así que un `request_tile`
    // cuyo tile apareció mientras esperaba volvía mudo y el cliente se quedaba
    // con su key en `frontier.requested` y el velo puesto.
    const already = ctx.narrative.getTile(tx, ty);
    if (already) {
      broadcastScene(ctx, key, already.scene_data, Date.now() - start, {
        edge: approachEdge,
        spawn: opts.spawnAt?.(),
        source: "cache",
      });
      return { delivered: true };
    }
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "tile",
      tile: { tx, ty },
      edge: approachEdge,
      message:
        opts.message ??
        (approachEdge
          ? `Explorando hacia el ${EDGE_ES[approachEdge]}...`
          : `Generando el tile (${tx}, ${ty})...`),
    });
    const res = await generateTileScene(ctx, tx, ty, approachEdge, { placeId: opts.placeId });
    if (res === "exists") {
      // Apareció mientras se generaba (otro camino lo registró): se difunde
      // el que hay. Volver mudo dejaba esperando a quien lo pidió.
      const ahora = ctx.narrative.getTile(tx, ty);
      if (!ahora) return { delivered: false, motivo: `el tile ${key} se registró y desapareció` };
      broadcastScene(ctx, key, ahora.scene_data, Date.now() - start, {
        edge: approachEdge,
        spawn: opts.spawnAt?.(),
        source: "cache",
      });
      return { delivered: true };
    }
    broadcastScene(ctx, res.sceneId, res.scene, Date.now() - start, {
      edge: approachEdge,
      spawn: opts.spawnAt?.(),
      // El tile se ha generado y rasterizado AHORA (expandScenePrimitives
      // sobre el `ground` que el motor acaba de declarar).
      source: "engine",
    });
    return { delivered: true };
  } catch (err) {
    console.warn(`Bridge: generación del tile ${key} falló:`, err);
    // Si esto es un VIAJE, quien lo pulsó eligió un lugar por su nombre: el
    // mensaje nombra el lugar y traduce el motivo, y el volcado de la
    // excepción se queda en el `console.warn` de arriba (era lo que el jugador
    // leía: «No se pudo generar el tile (2, 0). fetch failed»).
    // Explorando NO se traduce: ahí el motivo exacto —un tile que el validador
    // rechaza, un cruce que no continúa— es lo único que dice qué ha pasado, y
    // no hay un nombre de destino que ponerle en su lugar.
    fail(
      opts.destino
        ? `No se pudo llegar a ${opts.destino}. ${motivoParaElJugador(err)}`
        : `Error: ${(err as Error).message ?? err}`,
    );
    return { delivered: true };
  }
}

/** Traduce un fallo interno a algo que quien juega pueda leer (el detalle
 *  técnico se queda en el `console.warn` de arriba). */
function motivoParaElJugador(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err);
  if (/fetch failed|ECONNREFUSED|socket hang up|timeout/i.test(raw)) {
    return "El motor narrativo no responde; inténtalo de nuevo en un momento.";
  }
  if (/no es jugable/i.test(raw)) {
    return "El motor narrativo devolvió un terreno inservible; inténtalo de nuevo.";
  }
  return "El motor narrativo no pudo construirlo; inténtalo de nuevo.";
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
    broadcastScene(ctx, tileKey(tx, ty), existing.scene_data, undefined, { edge: msg.edge, source: "cache" });
    return;
  }
  const { status, delivery } = ctx.sceneGen.enqueue({
    key: tileKey(tx, ty),
    blocking: msg.reason === "blocking",
    run: () => runTileGeneration(ctx, tx, ty, msg.edge),
  });
  // Fail-loud de la ENTREGA: un `abandonAll` (takeover de sesión, regeneración
  // de mundo) borraba este job en silencio y el cliente se quedaba con la key
  // en `frontier.requested` y el velo puesto hasta su propio timeout de 5 min,
  // sin volver a pedir el tile. Vale igual para el prefetch: sin el error, esa
  // key no se libera y el tile no se vuelve a pedir al acercarse otra vez.
  void delivery.then((res) => {
    if (res.ok) return;
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "tile",
      tile: { tx, ty },
      edge: msg.edge,
      message: `Error: ${res.error}`,
    });
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
    // El vecindario 3×3 de la vida ambiental sigue al tile activo. Gateado
    // por cambio de celda (arriba), no cuesta nada en el hot loop.
    npcSync(ctx);
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
