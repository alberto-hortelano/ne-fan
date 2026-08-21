/** Handler de transición de lugar del world-map: re-broadcast de escena
 *  cacheada o lazy realize vía el motor narrativo, más los map triggers.
 *  La generación pasa por la cola compartida (ctx.sceneGen): el motor solo
 *  atiende una petición a la vez y las demás esperan en vez de perderse. */

import {
  attachWorldVocabulary,
  broadcastScene,
  fireMapTriggers,
  sessionChangedError,
  type BridgeContext,
} from "../context.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { resolveExitEdge } from "../../src/world-map/edges.js";
import { resolveTravelAnchor } from "../../src/world-map/place-anchor.js";
import { resolvePlaceTarget } from "../../src/world-map/place-target.js";
import { tileKey, type TileCoord } from "../../src/scene/tile.js";
import { activeTileOf, runTileGeneration } from "./tile.js";
import { stagePlaceContext } from "./bootstrap-stage.js";
import type { Edge } from "../../src/world-map/types.js";
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
    // Place anclado al plano continuo: viajar es APARECER en él, no solo
    // re-difundir su tile. El spawn se PIDE al cliente (dueño de la posición).
    const spawn = resolvePlaceTarget(ctx.narrative, placeId) ?? undefined;
    broadcastScene(ctx, cachedSceneId, cachedScene, undefined, { spawn });
    // Los triggers se disparan AQUÍ; sin esto, el activateByPosition del
    // siguiente sim_input (el jugador acaba de aterrizar en el anchor) los
    // volvería a disparar.
    if (spawn) ctx.posTracking.placeId = placeId;
    await fireMapTriggers(ctx, prevPlaceId, placeId);
    return;
  }

  // Sin escena todavía. En proscenio cada place ES un plató discreto y se
  // pide al motor; en el plano continuo el lugar se ANCLA a un tile libre y
  // se genera como tile (la escena "suelta" se retiró, issue #172).
  const isStageWorld = ctx.narrative.world.view === "proscenium";
  const status = ctx.sceneGen.enqueue({
    key: `place_${placeId}`,
    blocking: true,
    run: () =>
      isStageWorld
        ? runPlaceRealize(ctx, placeId, prevPlaceId)
        : runPlaceTravel(ctx, placeId, prevPlaceId),
  });
  if (status !== "queued") {
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: isStageWorld ? `Generando ${place.name}...` : `Viajando a ${place.name}...`,
    });
  }
}

/** Núcleo del realize de un place, compartido por la sesión en vivo y por
 *  generate_game: LLM con el contexto del place, validación (stage plan en
 *  mundos proscenio), expansión y registro. `activate:false` deja la escena
 *  servible sin robar la activa (pre-generación). "exists" si ya estaba
 *  realizado; LANZA en cualquier fallo. */
export async function realizePlaceScene(
  ctx: BridgeContext,
  placeId: string,
  opts: { entryEdge?: Edge | null; activate?: boolean } = {},
): Promise<{ sceneId: string; scene: Record<string, unknown> } | "exists"> {
  const place = ctx.narrative.worldMap.get(placeId);
  if (!place) throw new Error(`Lugar desconocido en el mapa: ${placeId}`);
  // Pudo realizarse mientras esperaba en la cola.
  if (place.realized_scene_id && ctx.narrative.scenes_loaded[place.realized_scene_id]) {
    return "exists";
  }

  const jobSession = ctx.narrative.session_id;
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
  attachWorldVocabulary(ctx, realizeCtx);
  // Mundos proscenio: la escena del place es un PLATÓ (stage plan).
  const isStageWorld = ctx.narrative.world.view === "proscenium";
  if (isStageWorld) {
    realizeCtx.stage_request = opts.entryEdge ? { entry_edge: opts.entryEdge } : {};
  }

  const res = await ctx.aiClient.generateScene(realizeCtx);
  // Defensa en profundidad: takeover colado ⇒ descartar sin escribir.
  const changed = sessionChangedError(ctx, jobSession);
  if (changed) throw new Error(changed);
  if (!res.ok || !res.scene) {
    throw new Error(`No se pudo generar ${place.name}. ${res.error ?? "Revisa el motor narrativo."}`);
  }
  const sceneId = String(res.scene.room_id ?? res.scene.scene_id ?? `scene_${Date.now()}`);
  // Tag the scene with the place so recordSceneLoaded attaches it (y para
  // que la validación proscenio cruce exits⇔links del place correcto).
  res.scene.place_id = placeId;
  if (isStageWorld) {
    if (res.scene.stage === undefined) {
      throw new Error(
        `El motor narrativo respondió ${place.name} sin bloque \`stage\` en un mundo proscenio — el plató necesita sus salidas declaradas`,
      );
    }
    const check = validateScene(res.scene, stagePlaceContext(ctx));
    if (!check.ok) {
      throw new Error(`${place.name} no es jugable: ${check.errors.join(" · ")}`);
    }
  }
  // Expandir primitivas (structures/vegetation) ANTES de persistir: lo
  // guardado y difundido es Format D plano.
  res.scene = expandScenePrimitives(res.scene);
  ctx.narrative.recordSceneLoaded(sceneId, res.scene, [], { activate: opts.activate ?? true });
  await ctx.narrative.save();
  return { sceneId, scene: res.scene };
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
): Promise<void> {
  const place = ctx.narrative.worldMap.get(placeId);
  if (!place) return;
  const start = Date.now();
  try {
    // Pudo realizarse mientras esperaba en la cola.
    if (place.realized_scene_id && ctx.narrative.scenes_loaded[place.realized_scene_id]) return;
    const anchor = place.anchor ?? pickTravelAnchor(ctx, placeId, prevPlaceId);
    // El anchor se fija ANTES de generar: buildGenerateTileCtx lo lee para
    // decirle al motor QUÉ lugar está construyendo en ese tile.
    place.anchor = anchor;
    ctx.narrative.markDirty();
    if (!resolvePlaceTarget(ctx.narrative, placeId)) {
      throw new Error(`el anclaje de ${place.name} no da punto de aparición`);
    }
    await runTileGeneration(ctx, anchor.tx, anchor.ty, undefined, {
      placeId,
      message: `Viajando a ${place.name}...`,
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
      message: `No se pudo viajar a ${place.name}: ${(err as Error).message ?? err}`,
      elapsedMs: Date.now() - start,
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
    if (place.realized_scene_id && ctx.narrative.scenes_loaded[place.realized_scene_id]) return;
    // El edge de entrada es el opuesto al edge del link que trae al jugador
    // desde el place anterior (si el world map lo sabe).
    const linkBack = ctx.narrative.worldMap
      .getOutgoingLinks(placeId)
      .find((l) => (l.from === placeId ? l.to : l.from) === prevPlaceId);
    const entryEdge = linkBack ? resolveExitEdge(ctx.narrative.worldMap, placeId, linkBack) : null;
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "generating",
      kind: "scene",
      message: `Generando ${place.name}...`,
    });

    const res = await realizePlaceScene(ctx, placeId, { entryEdge });
    if (res === "exists") return;
    broadcastScene(ctx, res.sceneId, res.scene, Date.now() - realizeStart);
    await fireMapTriggers(ctx, prevPlaceId, placeId);
  } catch (err) {
    console.warn("Bridge: lazy realize failed:", err);
    fail(`Error: ${(err as Error).message ?? err}`);
  }
}

