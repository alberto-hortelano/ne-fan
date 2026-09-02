/** LAS SALIDAS CAMBIAN SIN QUE CAMBIE LA ESCENA (#179).
 *
 *  Cuando el motor crea un enlace o renombra un lugar a mitad de sesión
 *  (`map_link`, `map_upsert_place` por el State API), el panel «Salidas» tiene
 *  que enterarse. La forma PROHIBIDA de conseguirlo es re-difundir la escena:
 *  eso vuelve a pasar por el atlas de superficies y por `addEnemies` para
 *  pintar un botón. Aquí sale un mensaje que lleva solo las salidas
 *  (`exits_changed`), calculadas por la misma función que las pone en el wire
 *  cuando la escena se sirve (`src/world-map/exits.ts`): una sola verdad, dos
 *  momentos.
 */

import { placeDeLaEscena, salidasDePlace } from "../src/world-map/exits.js";
import type { BridgeContext } from "./context.js";

/** Difunde las salidas de CADA tile cargado que tenga lugar, tal y como están
 *  ahora en el mapa: un `exits_changed` por escena de `scenes_loaded` con
 *  place (son pocos: los tiles que el jugador ha pisado).
 *
 *  TODOS y no solo el activo (QA de T6, H-1): el cliente conserva una copia de
 *  las salidas de cada tile que tiene en memoria y la pinta al volver a pisarlo
 *  A PIE, sin pasar por el bridge. Un enlace a un lugar cuyo tile está cargado
 *  pero no activo cambia las salidas de ESE tile, y si solo se avisara del
 *  activo el jugador volvería andando a un panel viejo hasta Reanudar. El
 *  cliente aplica cada mensaje a su copia y refresca el panel solo si es el
 *  tile activo (`carga-de-tile.ts`).
 *
 *  Sin escena activa no hay nada que actualizar y no se manda nada: durante el
 *  bootstrap el motor siembra el mapa (places y links) ANTES de responder la
 *  escena, y esa escena ya sale al wire con sus salidas puestas. No es un
 *  silencio: es que el panel que hay que refrescar todavía no existe. Una
 *  escena sin lugar tampoco recibe nada: sin lugar no tiene salidas que puedan
 *  cambiar. */
export function difundirSalidasDeLosTilesCargados(ctx: BridgeContext): void {
  const activa = ctx.narrative.world.active_scene_id;
  if (!activa || !ctx.narrative.scenes_loaded[activa]) return;
  const wm = ctx.narrative.worldMap;
  const activePlaceId = wm.serialize().active_place_id;
  for (const [sceneId, rec] of Object.entries(ctx.narrative.scenes_loaded)) {
    const placeId = placeDeLaEscena(rec.scene_data, sceneId, activa, activePlaceId);
    if (placeId === null) continue;
    ctx.broadcastNarrative({ type: "exits_changed", sceneId, exits: salidasDePlace(wm, placeId) });
  }
}
