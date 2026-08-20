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

