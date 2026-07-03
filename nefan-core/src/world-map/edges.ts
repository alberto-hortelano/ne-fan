/** Resolución de bordes (Edge) de los links del world map — lógica pura.
 *
 *  La convención vive en `PlaceLink.edge` (lado de la escena del place `from`
 *  donde está la salida hacia `to`). Aquí se resuelve el borde EFECTIVO para
 *  un place concreto: directo si se recorre el link hacia delante, opuesto si
 *  se recorre al revés, y con una heurística por `approx_position` como
 *  fallback para links legacy sin edge. */

import { type Edge, type PlaceLink } from "./types.js";
import type { WorldMapManager } from "./world-map.js";

export function oppositeEdge(e: Edge): Edge {
  switch (e) {
    case "north": return "south";
    case "south": return "north";
    case "east": return "west";
    case "west": return "east";
  }
}

/** Borde de la escena de `placeId` por el que sale el link, o null si no se
 *  puede saber. Orden de resolución:
 *   1. `link.edge` — directo cuando placeId === link.from; opuesto cuando el
 *      link se recorre al revés (bidirectional, placeId === link.to).
 *   2. Heurística por `approx_position` — SOLO si ambos endpoints existen,
 *      comparten `parent_id` y ambos tienen posición: eje dominante del delta
 *      en el espacio local del parent (x+ = east, y+ = south). Empate
 *      (incluye places superpuestos) → null, nunca adivinar.
 *   3. null — el caller decide (exit sin edge = comportamiento legacy). */
export function resolveExitEdge(
  map: WorldMapManager,
  placeId: string,
  link: PlaceLink,
): Edge | null {
  const forward = link.from === placeId;
  if (link.edge) return forward ? link.edge : oppositeEdge(link.edge);

  const here = map.get(placeId);
  const there = map.get(forward ? link.to : link.from);
  if (!here?.approx_position || !there?.approx_position) return null;
  if (here.parent_id !== there.parent_id) return null;
  const dx = there.approx_position[0] - here.approx_position[0];
  const dy = there.approx_position[1] - here.approx_position[1];
  if (Math.abs(dx) === Math.abs(dy)) return null; // empate (incluye 0,0)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}
