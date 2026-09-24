/** Bootstrap del tile (0,0) de una sesión nueva — extraído del handler de
 *  sesión: generación LLM (con world_document y bootstrap_world_map), fijado
 *  de la verdad geométrica, validación de jugabilidad, expansión de
 *  primitivas, snapshot de mundo y broadcast. Corre dentro de la cola de
 *  generación (ctx.sceneGen); lo encolan start_session, el reintento de
 *  resume sin escenas y el job generate_game (que usa el núcleo sin
 *  broadcast).
 *
 *  Y su hermano sin sembrar (#578): `runEntradaEnElMapaDelFichero` regenera
 *  SOLO la entrada de un mundo pre-generado cuya entrada ya no pasa el
 *  validador, dentro del mapa y con el anillo del fichero. */
import { loadWorldDoc } from "../../src/games/loader.js";
import { expandScenePrimitives } from "../../src/scene/scene-expand.js";
import { motivoParaElJugador } from "../../src/protocol/status-motivo.js";
import { validateScene } from "../../src/scene/scene-validate.js";
import { tileKey } from "../../src/scene/tile.js";
import { resolveBootstrapPlaceId } from "../../src/world-map/bootstrap-place.js";
import type { PlanDeEntrada } from "../../src/world-map/entrada-del-fichero.js";
import {
  broadcastScene,
  restaurarMundoServible,
  sessionChangedError,
  writeSessionSnapshot,
  type BridgeContext,
} from "../context.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";
import { generateTileScene } from "./tile.js";

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
 *  la escena inicial (taberna…), su `player` y el `place_id` del lugar de
 *  partida (los anchors de los lugares van por `map_upsert_place`). */
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
    //
    // REEMPLAZA (#578). Aquí solo se llega sin fichero, con el fichero stale o
    // ilegible (`caminoDeArranque`), y en los tres casos no hay nada que
    // conservar. Hasta #578 se llegaba también con la ENTRADA injugable y
    // conservaba el anillo del fichero junto al mapa que este bootstrap acaba
    // de sembrar: dos generaciones en un fichero, y los `place_id` del anillo
    // colgando de lugares que el mapa nuevo no tenía. Ese caso tiene hoy su
    // propio camino, `runEntradaEnElMapaDelFichero`, que no siembra.
    writeSessionSnapshot(ctx, sessionGameId, sceneId, "reemplaza-el-mundo");
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

/** La ENTRADA regenerada dentro del mapa del fichero (#578) — corre dentro de
 *  la cola, en el sitio del bootstrap y con su mismo coste: UNA llamada al
 *  motor.
 *
 *  Se llega cuando el mundo pre-generado es de hoy pero su escena de entrada
 *  no pasa el validador de hoy (`caminoDeArranque`). En vez de sembrar un
 *  mapa nuevo —lo que hacía el bootstrap vivo, y con él el fichero acababa
 *  con dos generaciones mezcladas—, se restaura el mundo del fichero (mapa +
 *  anillo servible) y se pide SOLO el tile (0,0) como un tile más: con las
 *  costuras de sus vecinos, con el lugar de partida que decide el bridge
 *  (`plan.placeId`) y con el `player` del arranque.
 *
 *  Si falla, NO se escribe nada —el fichero queda como estaba— y NO se cae al
 *  bootstrap que siembra: eso sería volver a fabricar la mezcla en silencio.
 *  El jugador lee el motivo y el overlay le ofrece volver al título, donde
 *  regenerar el mundo sigue siendo un botón.
 *
 *  Lo que esto NO sujeta (QA de BE, H5): que el motor no SIEMBRE lugares con
 *  las map tools durante esta llamada. Solo lo pide el prompt («do not seed it
 *  again»); si lo hace, el lugar se escribe en el fichero. Es aditivo y no
 *  deja nada colgando, pero el mapa deja de ser solo el del fichero. Se mira
 *  con el motor real en el playtest de #239. */
export async function runEntradaEnElMapaDelFichero(
  ctx: BridgeContext,
  sessionGameId: string,
  plan: PlanDeEntrada,
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
    restaurarMundoServible(ctx, plan.worldMap, plan.anillo);
    const hecho = await generateTileScene(ctx, 0, 0, undefined, {
      ...(plan.placeId === null ? {} : { placeId: plan.placeId }),
      arranque: { gameId: sessionGameId },
    });
    if (hecho === "exists") {
      // Inalcanzable: el anillo no contiene la entrada (`cargarParaArrancar`
      // la separa). Si alguien lo hiciera alcanzable, el motor no habría
      // generado nada y escribir aquí volvería a guardar la entrada rota.
      throw new Error(`${plan.entrySceneId} ya estaba en la sesión: no se generó ninguna entrada`);
    }
    // CONSERVA: el anillo del fichero vuelve a él, el que no pasa el validador
    // también (roto, para que el chip del título siga avisando). El mapa es el
    // del fichero, restaurado arriba: no hay nada que mezclar.
    writeSessionSnapshot(ctx, sessionGameId, hecho.sceneId, "conserva-el-mundo-en-disco");
    broadcastScene(ctx, hecho.sceneId, hecho.scene, Date.now() - sceneStart, { source: "engine" });
    return { delivered: true };
  } catch (err) {
    console.warn("Bridge: la entrada en el mapa del fichero falló:", err);
    fail(motivoParaElJugador(err));
    return { delivered: true };
  }
}
