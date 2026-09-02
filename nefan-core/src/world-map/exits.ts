/** LAS SALIDAS DE UN LUGAR: un derivado del mapa, calculado y nunca sellado.
 *
 *  El panel «Salidas» del cliente es la única vía de viaje a un lugar, y se
 *  pinta desde `exits`: los links salientes del place de la escena, con el
 *  nombre del destino y el borde por el que se sale. Hasta #179 ese derivado
 *  se HORNEABA dentro del `scene_data` al difundir la escena (el mismo objeto
 *  que va al save), así que tenía un único invalidador —volver a difundir— y
 *  un link que el motor creaba a mitad de conversación llegaba al save y no al
 *  panel; el resume servía el sello congelado. Aquí solo se CALCULA: quién lo
 *  pone en el wire (`bridge/wire-scene.ts`) lo hace sobre el objeto nuevo que
 *  sale al cable, y quien lo difunde cuando cambia el mapa (`bridge/salidas.ts`)
 *  manda solo las salidas. La escena persistida sigue siendo Format D crudo,
 *  y lo canda `las-salidas-no-se-sellan-en-la-escena` (arch-rules.json).
 *
 *  Módulo PURO (`core-puro-sin-node`): entra el mapa y un place, sale una
 *  lista. Vive en `world-map` porque las salidas son del MAPA, no de la escena.
 */

import type { SceneExit } from "../protocol/messages.js";
import { resolveExitEdge } from "./edges.js";
import type { WorldMapManager } from "./world-map.js";

/** Las salidas de `placeId`: un `SceneExit` por link saliente, con el destino
 *  resuelto a su nombre (o su id si el place no existe: se enseña, no se
 *  calla) y el borde de ESTA escena por el que se sale (`undefined` cuando no
 *  se puede saber). */
export function salidasDePlace(wm: WorldMapManager, placeId: string): SceneExit[] {
  return wm.getOutgoingLinks(placeId).map((l): SceneExit => {
    const targetId = l.from === placeId ? l.to : l.from;
    return {
      place_id: targetId,
      name: wm.get(targetId)?.name ?? targetId,
      link_kind: l.kind,
      travel_hours: l.travel_hours,
      description: l.description,
      // Lado de esta escena por el que sale el link (para la transición
      // continua del cliente). null → undefined: exit sin orientación.
      edge: resolveExitEdge(wm, placeId, l) ?? undefined,
    };
  });
}

/** De qué lugar son las salidas de una escena.
 *
 *  El `place_id` que declara la escena, y si no lo declara, el place ACTIVO —
 *  pero SOLO para la escena activa. Una escena no activa sin place (campo
 *  abierto) no hereda las salidas del sitio donde está el jugador: hasta #179
 *  sí las heredaba al sellarse en la difusión, y un tile pelado ofrecía los
 *  destinos de otro lugar. `null` = sin lugar, o sea sin salidas, que para
 *  campo abierto es lo correcto. */
export function placeDeLaEscena(
  scene: Record<string, unknown>,
  sceneId: string,
  activeSceneId: string,
  activePlaceId: string | null | undefined,
): string | null {
  if (typeof scene.place_id === "string" && scene.place_id) return scene.place_id;
  if (sceneId === activeSceneId && activePlaceId) return activePlaceId;
  return null;
}
