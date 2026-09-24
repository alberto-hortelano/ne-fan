/** Handler de transición de lugar del world-map: re-broadcast de la escena
 *  cacheada o viaje al tile que ancla el lugar, más los map triggers.
 *  La generación pasa por la cola compartida (ctx.sceneGen): el motor solo
 *  atiende una petición a la vez y las demás esperan en vez de perderse. */

import {
  broadcastScene,
  fireMapTriggers,
  type BridgeContext,
  type SitioDeAparicion,
} from "../context.js";
import { resolveExitEdge } from "../../src/world-map/edges.js";
import { resolveTravelAnchor } from "../../src/world-map/place-anchor.js";
import { resolvePlaceTarget } from "../../src/world-map/place-target.js";
import { tileKey, type TileCoord } from "../../src/scene/tile.js";
import { activeTileOf, runTileGeneration } from "./tile.js";
import type { SceneGenOutcome } from "../scene-gen-queue.js";
import {
  FALLO_SIN_SITIO_DONDE_APARECER,
  motivoParaElJugador,
} from "../../src/protocol/status-motivo.js";
import { sitioParaAparecer } from "../../src/simulation/salida-del-solido.js";
import { PLAYER_RADIUS_M } from "../../src/scene/terrain-collision.js";
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
      // Es el desenlace de ESTE viaje: sin su `placeId` el cliente no lo
      // cerraría y el «Viajando...» pagaría la expiración (#737).
      placeId,
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

/** DÓNDE APARECE quien viaja, y los TRES desenlaces que tiene esa pregunta.
 *
 *  Los dos primeros son `SitioDeAparicion` (`bridge/context.ts`) y son los
 *  únicos que `broadcastScene` acepta. El tercero vive SOLO aquí, y ese corte
 *  es el candado: no se puede difundir sin haberlo descartado, porque no
 *  compila. Lo que el tipo no impide —escribir `sin ancla` teniendo un
 *  `sin sitio`— está dicho en el docblock de `SitioDeAparicion`.
 *
 *  Son tres y no dos, y colapsarlos era la mitad de ARRIBA de #616:
 *  `resolvePlaceTarget` devuelve el centro del `anchor.rect` del lugar **sin
 *  una sola consulta de solidez**, y el cliente teletransporta ahí
 *  (`main.ts:946`). Los edificios del plan son MACIZOS —`planCollisionGrid`
 *  rasteriza la huella entera del volumen—, así que ese centro es un punto del
 *  que no se sale: medido sobre las fixtures del selector «Room», los **13
 *  `building` de robledo y puerto están ocupados en su centro, 13 de 13**.
 *
 *  La cuenta la hace core (`sitioParaAparecer`) y el suelo lo pone el
 *  proveedor de la sesión, que es el que conoce las TRES fuentes —grid del
 *  terreno, grid del plan y cajas de runtime— con el solape ABIERTO. El bridge
 *  solo las ata: el cliente no decide dónde aparece, solo pinta.
 *
 *   · `punto`     — hay sitio: el candidato si ya estaba libre, y si no la
 *                   PUERTA del lugar (menor penetración = desplazamiento
 *                   mínimo; ≤ 3,90 m medido sobre esos 13).
 *   · `sin ancla` — el lugar no da punto de aparición (sin `anchor` y sin tile
 *                   realizado): viaje narrative-paced, nadie se mueve. Es el
 *                   `undefined` de siempre y NO es un fallo.
 *   · `sin sitio` — hay punto pero no hay dónde ponerse: la marcha saturó el
 *                   tope cuatro veces (160 m de sólido continuo). Es FAIL-LOUD
 *                   y hay que decirlo: el candidato crudo NO vale como
 *                   respaldo, porque es justamente el punto del que no se
 *                   sale.
 *
 *  Y un desenlace más que NO pasa por aquí: una coordenada fuera del rango en
 *  el que la marcha avanza (`anchor` absurdo, save editado) hace que
 *  `sitioParaAparecer` LANCE `RangeError`. Sube por el `throw`, no por el
 *  `null`: lo recoge el `catch` de `runPlaceTravel` —o, en el camino del place
 *  ya realizado, `routeMessage`— y en los dos sale como `narrative_status:
 *  error` con el nombre del destino. No hay que cablear nada aquí. */
type DondeAparecer = SitioDeAparicion | { de: "sin sitio" };

function dondeAparecer(ctx: BridgeContext, placeId: string): DondeAparecer {
  const punto = resolvePlaceTarget(ctx.narrative, placeId);
  if (!punto) return { de: "sin ancla" };
  const sitio = sitioParaAparecer(punto, PLAYER_RADIUS_M, ctx.simCollision);
  return sitio ? { de: "punto", spawn: sitio } : { de: "sin sitio" };
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
  // El sitio se decide ANTES de tocar el estado: si el lugar no tiene dónde
  // poner al jugador, esto no activa el place, no guarda y no difunde. La
  // consulta ya se puede hacer porque la escena está en `scenes_loaded` —de
  // ahí sale `scene` dos líneas arriba—, que es de donde el proveedor deriva
  // los colliders del tile.
  const donde = dondeAparecer(ctx, placeId);
  if (donde.de === "sin sitio") {
    // FAIL-LOUD, y con el nombre del lugar: la alternativa era difundir la
    // escena con `spawn: undefined`, o sea un SPAWN MUDO — el jugador se queda
    // donde estaba, viendo el tile de otro sitio, y nada se lo dice.
    console.warn(
      `Bridge: "${placeId}" está realizado pero no tiene sitio libre donde aparecer`,
    );
    ctx.broadcastNarrative({
      type: "narrative_status",
      phase: "error",
      kind: "scene",
      placeId,
      // La frase del jugador sale de la MISMA traducción que usa el viaje que
      // aún no está realizado (abajo, por el `throw` de `viaje.sitio`): dos
      // literales iguales en dos canales divergen, y aquí el hecho es uno.
      message: `No se pudo viajar a ${place.name}. ${motivoParaElJugador(
        new Error(FALLO_SIN_SITIO_DONDE_APARECER),
      )}`,
    });
    return true;
  }
  // recordSceneLoaded re-activates the place AND (re-)registers the
  // scene's NPCs into entities so the narrative engine sees them. Este save
  // persiste la activación del place y el ledger de NPCs; la POSICIÓN del
  // jugador llega con el save del cambio de tile (`activateByPosition`,
  // #395), en el primer `input` tras el spawn que se pide abajo.
  ctx.narrative.recordSceneLoaded(sceneId, scene);
  await ctx.narrative.save();
  // El spawn se PIDE al cliente (dueño de la posición). `donde` entra ENTERO:
  // aquí ya está estrechado a `SitioDeAparicion` por la guarda de arriba, y
  // quitarla no compila (#616, H1 de QA).
  // Y con el `placeId` del viaje al lado (#742): es la LLEGADA de ESE viaje,
  // también cuando es `sin ancla` —nadie se mueve y el viaje llega igual—.
  broadcastScene(ctx, sceneId, scene, undefined, { viaje: { placeId, sitio: donde }, source: "cache" });
  // Los triggers se disparan AQUÍ; sin esto, el activateByPosition del
  // siguiente sim_input (el jugador acaba de aterrizar en el anchor) los
  // volvería a disparar.
  if (donde.de === "punto") ctx.posTracking.placeId = placeId;
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
    occupied.add(tileKey(rec.tile.tx, rec.tile.ty));
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
    // Aquí se comprueba que HAY punto, no que esté libre: el tile todavía no
    // existe, así que preguntar por solidez ahora contestaría «libre» sobre un
    // mundo que aún no se ha construido. La solidez se mira al difundir, que
    // es cuando el tile ya está registrado (`viaje.sitio`, abajo).
    if (!resolvePlaceTarget(ctx.narrative, placeId)) {
      throw new Error(`el anclaje de ${place.name} no da punto de aparición`);
    }
    return await runTileGeneration(ctx, anchor.tx, anchor.ty, undefined, {
      message: `Viajando a ${place.name}...`,
      viaje: {
        placeId,
        // Lo que lee el JUGADOR si la generación falla. El motivo técnico
        // (coordenadas del tile, "fetch failed") se queda en el log del bridge:
        // quien viaja pulsó el nombre de un lugar, no un par de coordenadas.
        destino: place.name,
        // Al difundir, no ahora: si el motor afinó el anchor del lugar con un
        // rect (`map_upsert_place.anchor`) mientras generaba, el jugador aparece
        // EN el lugar y no en el centro del tile. Y el tile ya está registrado,
        // así que aquí sí se puede preguntar por solidez: el centro de un
        // edificio macizo es estado sin salida (#616), y lo que viaja es la
        // puerta. El `throw` lo recoge el catch de `runTileGeneration`, que lo
        // difunde con el nombre del destino delante — volver `undefined` sería
        // un spawn mudo: escena nueva, jugador en el tile viejo y nadie avisa.
        sitio: () => {
          const donde = dondeAparecer(ctx, placeId);
          if (donde.de === "sin sitio") {
            throw new Error(`${FALLO_SIN_SITIO_DONDE_APARECER}: ${place.name}`);
          }
          return donde;
        },
      },
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
