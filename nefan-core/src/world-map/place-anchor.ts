/** Anclaje de un place al plano continuo de tiles — lógica PURA.
 *
 *  Viajar por el panel «Salidas» a un lugar que todavía no existe NO genera
 *  una escena aparte (esa variante se retiró con el issue #172): el lugar se
 *  ANCLA a un tile libre del plano y ese tile se genera como cualquier otro.
 *  Aquí se decide CUÁL es ese tile.
 *
 *  El criterio es un rayo desde el tile del jugador en la dirección de la
 *  salida (`resolveExitEdge`): el primer tile del rayo que no esté ni generado
 *  ni reclamado por el anchor de otro place. Sin dirección conocida se barren
 *  las cuatro en orden, a la misma distancia antes de alejarse.
 *
 *  Es determinista A PROPÓSITO: nada de aleatoriedad, así el mismo estado da
 *  siempre el mismo destino y un guion de QA puede afirmar dónde aparece el
 *  jugador. La geometría no se duplica: sale entera de `neighborTile`.
 */

import { neighborTile, tileKey, type TileCoord } from "../scene/tile.js";
import { EDGES, type Edge } from "./types.js";

/** Alcance del rayo, en tiles. 8 tiles = 512 m desde el jugador: más allá el
 *  "viaje" dejaría de tener nada que ver con la dirección de la salida. */
export const MAX_TRAVEL_TILES = 8;

export interface TravelAnchorRequest {
  /** Tile donde está el jugador — origen del rayo. */
  origin: TileCoord;
  /** Borde de la escena de origen por el que sale el link hacia el destino, o
   *  null si el world map no lo sabe (link sin `edge` y sin posiciones que
   *  permitan inferirlo). */
  edge: Edge | null;
  /** Claves canónicas `tile_{tx}_{ty}` ya ocupadas: tiles generados MÁS tiles
   *  reclamados por el anchor de otro place. */
  occupied: ReadonlySet<string>;
  /** Alcance del rayo (default `MAX_TRAVEL_TILES`). */
  maxDistance?: number;
}

/** Tile libre donde anclar el place destino. LANZA si el rayo está ocupado
 *  hasta el final del alcance — el caller lo convierte en
 *  `narrative_status: error`, nunca en un destino inventado. */
export function resolveTravelAnchor({
  origin,
  edge,
  occupied,
  maxDistance = MAX_TRAVEL_TILES,
}: TravelAnchorRequest): TileCoord {
  if (!Number.isInteger(origin.tx) || !Number.isInteger(origin.ty)) {
    throw new Error(`resolveTravelAnchor: el origen (${origin.tx}, ${origin.ty}) no es un tile`);
  }
  if (!Number.isInteger(maxDistance) || maxDistance < 1) {
    throw new Error(`resolveTravelAnchor: alcance inválido (${maxDistance})`);
  }
  const directions: readonly Edge[] = edge ? [edge] : EDGES;
  for (let d = 1; d <= maxDistance; d++) {
    for (const dir of directions) {
      const candidate = tileAtDistance(origin, dir, d);
      if (!occupied.has(tileKey(candidate.tx, candidate.ty))) return candidate;
    }
  }
  throw new Error(
    `No hay ningún tile libre donde anclar el destino: el rayo desde (${origin.tx}, ${origin.ty}) ` +
      `${edge ? `hacia el ${edge}` : "en las cuatro direcciones"} está ocupado hasta ${maxDistance} tiles`,
  );
}

/** `distance` pasos de `neighborTile` en la misma dirección. */
function tileAtDistance(origin: TileCoord, edge: Edge, distance: number): TileCoord {
  let t = origin;
  for (let i = 0; i < distance; i++) t = neighborTile(t.tx, t.ty, edge);
  return t;
}
