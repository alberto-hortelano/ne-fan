/** Handler de transición de lugar del world-map: re-broadcast de la escena
 *  cacheada o viaje al tile que ancla el lugar, más los map triggers.
 *  La generación pasa por la cola compartida (ctx.sceneGen): el motor solo
 *  atiende una petición a la vez y las demás esperan en vez de perderse. */

import {
  broadcastScene,
  fireMapTriggers,
  type BridgeContext,
} from "../context.js";
import { resolveExitEdge } from "../../src/world-map/edges.js";
import { resolveTravelAnchor } from "../../src/world-map/place-anchor.js";
import { resolvePlaceTarget } from "../../src/world-map/place-target.js";
import { tileKey, type TileCoord } from "../../src/scene/tile.js";
import { activeTileOf, runTileGeneration } from "./tile.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";
import { motivoParaElJugador } from "../../src/protocol/status-labels.js";
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
  if (await difundirPlaceRealizado(ctx, placeId, prevPlaceId)) return;

  // Sin escena todavía: el lugar se ANCLA a un tile libre del plano continuo
  // y se genera como tile — es la única variante de Format D que queda (la
  // "suelta" se retiró con el issue #172 y el plató con su vista).
  const { status, delivery } = ctx.sceneGen.enqueue({
    key: `place_${placeId}`,
    blocking: true,
    run: () => runPlaceTravel(ctx, placeId, prevPlaceId),
  });
  // Acuse de recibo del viaje, SIEMPRE y no solo cuando la cola dice
  // "duplicate": es el paso que el cliente apunta en su ledger para saber que
  // el bridge lo cogió, y `enqueued` le dice si está esperando a un gemelo.
  ctx.broadcastNarrative({
    type: "narrative_status",
    phase: "generating",
    kind: "scene",
    placeId,
    enqueued: status,
    message: `Viajando a ${place.name}...`,
  });
  // Fail-loud de la ENTREGA. "duplicate" era una promesa que no firmaba
  // nadie: un `abandonAll` (takeover de sesión, regeneración de mundo) borraba
  // el job gemelo en silencio y el jugador se quedaba con el velo puesto para
  // siempre, sin escena y sin error (issue #210). Ahora quien espera se entera.
  //
  // Se engancha SOLO el caller que creó el job. Los demás comparten esa misma
  // promesa, así que enganchar cada uno difundía N errores idénticos por un
  // solo viaje fallido — y el panel del cliente no deduplica: el jugador que
  // pulsa dos veces la salida vería el fallo dos veces. Un viaje, un error.
  if (status !== "queued") return;
  void delivery.then((res) => {
    if (res.ok) return;
    // `res.error` es el motivo TÉCNICO (la key de la cola, el volcado de la
    // excepción): va al log, no a la cara de quien juega.
    console.warn(`Bridge: viaje a "${placeId}" sin entregar: ${res.error}`);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      placeId,
      message: `No se pudo viajar a ${place.name}. Vuelve a intentarlo.`,
    });
  });
}

/** Difunde la escena de un place YA realizado y pide el spawn: viajar a un
 *  lugar que existe es APARECER en él, no solo re-difundir su tile. Devuelve
 *  false si el place todavía no tiene escena.
 *
 *  Vive aquí, y no dentro del handler, porque hacen falta DOS caminos: el
 *  jugador que viaja a un lugar ya realizado, y el job de viaje que descubre
 *  al salir de la cola que el lugar se realizó mientras esperaba. El segundo
 *  volvía MUDO (`return` a secas) y dejaba al cliente con el velo puesto para
 *  siempre — el mismo cuelgue del #210 dentro del arreglo del #210. */
async function difundirPlaceRealizado(
  ctx: BridgeContext,
  placeId: string,
  prevPlaceId: string,
): Promise<boolean> {
  const place = ctx.narrative.worldMap.get(placeId);
  const sceneId = place?.realized_scene_id;
  if (!sceneId || !ctx.narrative.scenes_loaded[sceneId]) return false;
  const scene = ctx.narrative.scenes_loaded[sceneId].scene_data;
  // recordSceneLoaded re-activates the place AND (re-)registers the
  // scene's NPCs into entities so the narrative engine sees them. Este save
  // persiste la activación del place y el ledger de NPCs; la POSICIÓN del
  // jugador llega con el save del cambio de tile (`activateByPosition`,
  // #395), en el primer `input` tras el spawn que se pide abajo.
  ctx.narrative.recordSceneLoaded(sceneId, scene);
  await ctx.narrative.save();
  // El spawn se PIDE al cliente (dueño de la posición).
  const spawn = resolvePlaceTarget(ctx.narrative, placeId) ?? undefined;
  broadcastScene(ctx, sceneId, scene, undefined, { spawn, source: "cache" });
  // Los triggers se disparan AQUÍ; sin esto, el activateByPosition del
  // siguiente sim_input (el jugador acaba de aterrizar en el anchor) los
  // volvería a disparar.
  if (spawn) ctx.posTracking.placeId = placeId;
  await fireMapTriggers(ctx, prevPlaceId, placeId);
  return true;
}

/** Tile libre donde ANCLAR el place destino: rayo desde el tile del jugador
 *  hacia el borde por el que sale el link. Ocupado = tile ya generado o tile
 *  reclamado por el anchor de otro place. LANZA si no hay sitio. */
function pickTravelAnchor(ctx: BridgeContext, placeId: string, fromPlaceId: string): TileCoord {
  const origin = activeTileOf(ctx);
  if (!origin) {
    throw new Error("el jugador no está en ningún tile del plano continuo");
  }
  const link = ctx.narrative.worldMap
    .getOutgoingLinks(fromPlaceId)
    .find((l) => (l.from === fromPlaceId ? l.to : l.from) === placeId);
  const edge = link ? resolveExitEdge(ctx.narrative.worldMap, fromPlaceId, link) : null;

  const occupied = new Set<string>();
  for (const rec of Object.values(ctx.narrative.scenes_loaded)) {
    if (rec.tile) occupied.add(tileKey(rec.tile.tx, rec.tile.ty));
  }
  for (const p of Object.values(ctx.narrative.worldMap.map.places)) {
    if (p.anchor) occupied.add(tileKey(p.anchor.tx, p.anchor.ty));
  }
  return resolveTravelAnchor({ origin, edge, occupied });
}

/** Viaje a un place del plano continuo que todavía no existe: se ancla a un
 *  tile libre y ese tile se genera como cualquier otro, con el place en el
 *  contexto del motor. Corre dentro de la cola.
 *  Los map triggers NO se disparan aquí: los dispara `activateByPosition`
 *  cuando el cliente reporta la posición nueva (el jugador ENTRA andando en
 *  su propio anchor). */
async function runPlaceTravel(
  ctx: BridgeContext,
  placeId: string,
  prevPlaceId: string,
): Promise<SceneGenOutcome> {
  const place = ctx.narrative.worldMap.get(placeId);
  if (!place) return { delivered: false, motivo: `el lugar ${placeId} ya no está en el mapa` };
  const start = Date.now();
  try {
    // Pudo realizarse mientras esperaba en la cola (lo realizó el motor por su
    // cuenta, o el jugador exploró hasta su tile). Entonces esto ES un viaje a
    // un lugar realizado: se difunde su escena con el spawn. Volver mudo de
    // aquí dejaba al jugador esperando para siempre.
    if (await difundirPlaceRealizado(ctx, placeId, prevPlaceId)) return { delivered: true };
    const anchor = place.anchor ?? pickTravelAnchor(ctx, placeId, prevPlaceId);
    // El anchor se fija ANTES de generar: buildGenerateTileCtx lo lee para
    // decirle al motor QUÉ lugar está construyendo en ese tile.
    place.anchor = anchor;
    if (!resolvePlaceTarget(ctx.narrative, placeId)) {
      throw new Error(`el anclaje de ${place.name} no da punto de aparición`);
    }
    return await runTileGeneration(ctx, anchor.tx, anchor.ty, undefined, {
      placeId,
      message: `Viajando a ${place.name}...`,
      // Lo que lee el JUGADOR si la generación falla. El motivo técnico
      // (coordenadas del tile, "fetch failed") se queda en el log del bridge:
      // quien viaja pulsó el nombre de un lugar, no un par de coordenadas.
      destino: place.name,
      // Al difundir, no ahora: si el motor declaró `place_anchors` con rect,
      // el jugador aparece dentro del lugar y no en el centro del tile.
      spawnAt: () => resolvePlaceTarget(ctx.narrative, placeId) ?? undefined,
    });
  } catch (err) {
    console.warn(`Bridge: viaje a "${placeId}" falló:`, err);
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      placeId,
      message: `No se pudo viajar a ${place.name}. ${motivoParaElJugador(err)}`,
      elapsedMs: Date.now() - start,
    });
    return { delivered: true };
  }
}
