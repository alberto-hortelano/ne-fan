/** Bootstrap del tile (0,0) de una sesión nueva — extraído del handler de
 *  sesión: generación LLM (con world_document y bootstrap_world_map), fijado
 *  de la verdad geométrica, validación de jugabilidad, expansión de
 *  primitivas, snapshot de mundo y broadcast. Corre dentro de la cola de
 *  generación (ctx.sceneGen); lo encolan start_session, el reintento de
 *  resume sin escenas y el job generate_game (que usa el núcleo sin
 *  broadcast). */
import { loadWorldDoc } from "../../src/games/loader.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { motivoParaElJugador } from "../../src/protocol/status-motivo.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { tileKey } from "../../src/scene/tile.js";
import { resolveBootstrapPlaceId } from "../../src/world-map/bootstrap-place.js";
import {
  broadcastScene,
  sessionChangedError,
  writeSessionSnapshot,
  type BridgeContext,
} from "../context.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";

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
  // El bridge fija la verdad geométrica del tile de arranque. Se pidió con
  // `generate_tile`, así que lo que vuelva TIENE que ser un tile: una escena
  // sin `tile` ni `biome` era la variante suelta, que ya no existe (issue
  // #172) — fail-loud con el mensaje que el motor puede corregir.
  if (res.scene.tile === undefined && res.scene.biome === undefined) {
    throw new Error(
      "El motor narrativo respondió al bootstrap sin `tile` ni `biome`: en un mundo de plano " +
        "continuo la escena inicial es un TILE (la escena suelta se retiró del contrato)",
    );
  }
  res.scene.tile = { tx: 0, ty: 0 };
  const sceneId = tileKey(0, 0);
  res.scene.scene_id = sceneId;
  // A qué LUGAR pertenece el tile de arranque. Es el único tile en el que el
  // bridge no puede decidirlo solo (el mapa lo acaba de sembrar el motor en
  // esta misma llamada), así que se cruza lo que declaró con el mapa real: si
  // no cuadra, error que el motor puede corregir — nunca un panel «Salidas»
  // vacío, que es la única vía de viaje del cliente (issue #172).
  const placeRes = resolveBootstrapPlaceId(ctx.narrative.worldMap, res.scene);
  if (placeRes.kind === "error") {
    throw new Error(`El tile inicial no queda atado a ningún lugar del mapa: ${placeRes.error}`);
  }
  if (placeRes.kind === "place") res.scene.place_id = placeRes.placeId;
  else delete res.scene.place_id;
  const check = validateScene(res.scene, { required_crossings: [], bootstrap: true });
  if (!check.ok) {
    throw new Error(`El tile inicial no es jugable: ${check.errors.join(" · ")}`);
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
): Promise<SceneGenOutcome> {
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
    // Snapshot pasivo del mundo: la segunda partida de este juego arranca sin
    // motor. La escena ya está guardada (generateBootstrapTileScene) y el
    // broadcast no la toca: las salidas se calculan al servir.
    writeSessionSnapshot(ctx, sessionGameId, sceneId);
    broadcastScene(ctx, sceneId, scene, Date.now() - sceneStart, { source: "engine" });
    return { delivered: true };
  } catch (err) {
    console.warn("Bridge: generate_scene failed:", err);
    // TRADUCIDO. Aquí decía «el motivo va ENTERO porque el jugador no tiene
    // nada que reintentar», y esa premisa se cayó: el overlay del mundo vacío
    // ya ofrece volver al título (#189), así que sí hay adónde ir. Lo que
    // quedaba era que en el ARRANQUE —el momento en que más falla— se leyera
    // «Error: No se pudo generar la escena. fetch failed», que es un volcado
    // de motor, no una frase (#180). La causa exacta —un place_id que falta,
    // un tile injugable, el motor mudo— sigue entera en el `console.warn` de
    // arriba, que es el log de quien desarrolla.
    fail(motivoParaElJugador(err));
    return { delivered: true };
  }
}
