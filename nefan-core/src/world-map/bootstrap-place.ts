/** De qué LUGAR del world map es el tile de arranque — lógica PURA.
 *
 *  El resto de tiles no necesita preguntar: el bridge sabe qué place está
 *  realizando (viaje) o cuál tiene ya su anchor en esas coordenadas, y lo
 *  etiqueta él (`generateTileScene`). El bootstrap es el ÚNICO caso en el que
 *  no puede saberlo de antemano: el world map no existe todavía cuando se
 *  pide la escena — lo siembra el motor con las map tools durante esa misma
 *  llamada, y es él quien decide cuál de los lugares que acaba de inventar es
 *  el de partida.
 *
 *  Lo que sí puede hacer el bridge es no CREÉRSELO a ciegas: lo que declare
 *  el motor sólo se acepta si el mapa real lo corrobora. Y si no se puede
 *  atar el tile a ningún lugar habiendo lugares que visitar, eso no es un
 *  panel de salidas vacío: es un error (issue #172, hallazgo 3 de QA). Sin
 *  `place_id` el panel «Salidas» se apaga SIN UN SOLO AVISO y con él
 *  desaparece la única vía de viaje del cliente.
 */

import type { WorldMapManager } from "./world-map.js";

/** El lugar del tile de arranque, o el motivo por el que no hay ninguno.
 *
 *  Son TRES estados y no dos a propósito: "no hay lugar porque el mapa está
 *  vacío" y "no hay lugar habiendo mapa" se parecen y significan lo
 *  contrario. El primero es legítimo (no hay a dónde viajar); el segundo es
 *  el fallo silencioso. Colapsarlos en un booleano volvería a esconderlo.
 *
 *  `error` va redactado para el MOTOR: llega hasta él por el mismo canal que
 *  el resto de rechazos y tiene que poder corregirlo y re-responder. */
export type BootstrapPlaceResolution =
  | { kind: "place"; placeId: string }
  | { kind: "sin-lugares" }
  | { kind: "error"; error: string };

/** Escena de arranque tal y como vuelve del motor, en lo que aquí importa. */
interface BootstrapSceneLike {
  place_id?: unknown;
  place_anchors?: unknown;
}

/** Lugares "de verdad" del mapa: todos menos la raíz. La raíz (`kind:"world"`)
 *  existe siempre —la crea `createEmpty`— y nunca tiene links salientes, así
 *  que atar el tile a ella es exactamente el fallo silencioso que se combate:
 *  `active_place_id` se queda en "world" y el panel sale vacío. */
function realPlaceIds(wm: WorldMapManager): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.keys(wm.map.places)) {
    if (id !== wm.map.root_id) ids.add(id);
  }
  return ids;
}

/** Ids de place declarados en `place_anchors` que existen de verdad en el
 *  mapa. Es el otro sitio donde el motor dice qué lugares viven en el tile;
 *  `recordSceneLoaded` ya lo lee para fijarles el anchor. */
function declaredAnchorIds(scene: BootstrapSceneLike, real: ReadonlySet<string>): string[] {
  if (!Array.isArray(scene.place_anchors)) return [];
  const ids: string[] = [];
  for (const a of scene.place_anchors as Array<{ place_id?: unknown }>) {
    const id = a?.place_id;
    if (typeof id === "string" && real.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Resuelve el place del tile de arranque cruzando lo que declara la escena
 *  con el mapa que el motor acaba de sembrar.
 *
 *  Orden: `place_id` corroborado por el mapa → el único `place_anchors` que
 *  existe → error. Un mapa SIN lugares no es error: no hay a dónde viajar y
 *  un panel vacío ahí dice la verdad. */
export function resolveBootstrapPlaceId(
  wm: WorldMapManager,
  scene: BootstrapSceneLike,
): BootstrapPlaceResolution {
  const real = realPlaceIds(wm);
  const declared = typeof scene.place_id === "string" ? scene.place_id : null;
  if (declared && real.has(declared)) return { kind: "place", placeId: declared };

  // Mapa vacío: no hay lugar al que atar el tile, pero tampoco ninguno que el
  // jugador se esté perdiendo. El panel vacío no miente.
  if (real.size === 0) return { kind: "sin-lugares" };

  const anchors = declaredAnchorIds(scene, real);
  if (declared) {
    return {
      kind: "error",
      error:
        `la escena de arranque declara place_id "${declared}", que no existe en el world map ` +
        `(hay: ${[...real].join(", ")}) — llama a map_upsert_place para crearlo, o corrige el ` +
        `place_id al lugar de partida, y re-responde`,
    };
  }
  if (anchors.length === 1) return { kind: "place", placeId: anchors[0] };
  if (anchors.length > 1) {
    return {
      kind: "error",
      error:
        `la escena de arranque no declara place_id y ancla ${anchors.length} lugares en el tile ` +
        `(${anchors.join(", ")}): el bridge no puede adivinar en cuál empieza el jugador — ` +
        `añade "place_id" con el lugar de partida y re-responde`,
    };
  }
  return {
    kind: "error",
    error:
      `la escena de arranque no declara place_id y el world map ya tiene lugares ` +
      `(${[...real].join(", ")}): sin él la escena no queda atada a ninguno y el panel de ` +
      `salidas del jugador sale VACÍO — añade "place_id" con el lugar de partida y re-responde`,
  };
}
