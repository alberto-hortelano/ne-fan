/** LAS SALIDAS CAMBIAN SIN QUE CAMBIE LA ESCENA (#179).
 *
 *  Cuando el motor crea un enlace o renombra un lugar a mitad de sesión
 *  (`map_link`, `map_upsert_place` por el State API), el panel «Salidas» del
 *  tile activo tiene que enterarse. La forma PROHIBIDA de conseguirlo es
 *  re-difundir la escena: eso vuelve a pasar por el atlas de superficies y
 *  por `addEnemies` para pintar un botón. Aquí sale un mensaje que lleva solo
 *  las salidas (`exits_changed`), calculadas por la misma función que las
 *  pone en el wire cuando la escena se sirve (`src/world-map/exits.ts`): una
 *  sola verdad, dos momentos.
 */

import { placeDeLaEscena, salidasDePlace } from "../src/world-map/exits.js";
import type { BridgeContext } from "./context.js";

/** Difunde las salidas del tile ACTIVO tal y como están ahora en el mapa.
 *
 *  Sin escena activa no hay nada que actualizar y no se manda nada: durante el
 *  bootstrap el motor siembra el mapa (places y links) ANTES de responder la
 *  escena, y esa escena ya sale al wire con sus salidas puestas. No es un
 *  silencio: es que el panel que hay que refrescar todavía no existe. */
export function difundirSalidasDelTileActivo(ctx: BridgeContext): void {
  const sceneId = ctx.narrative.world.active_scene_id;
  const rec = sceneId ? ctx.narrative.scenes_loaded[sceneId] : undefined;
  if (!sceneId || !rec) return;
  const wm = ctx.narrative.worldMap;
  const placeId = placeDeLaEscena(rec.scene_data, sceneId, sceneId, wm.serialize().active_place_id);
  ctx.broadcastNarrative({
    type: "exits_changed",
    sceneId,
    exits: placeId === null ? [] : salidasDePlace(wm, placeId),
  });
}
