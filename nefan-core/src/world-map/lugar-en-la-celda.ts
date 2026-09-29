/** Dónde está el jugador en el world map, por su celda — lógica PURA.
 *
 *  El `rect` de un anchor es la HUELLA del lugar en su tile (el área
 *  construida de un pueblo, un edificio y su patio), así que las huellas se
 *  anidan: la posada cae dentro del barrio, y el barrio dentro del pueblo que
 *  ocupa el tile entero (anchor sin rect). El jugador está en TODOS los que
 *  contienen su celda: esa es la CADENA, de fuera adentro, y los triggers de
 *  entrar y salir salen de comparar la cadena vieja con la nueva
 *  (`cruceDeCadenas`). Entrar en la posada no es salir del barrio (#465, F1).
 *
 *  Una sola regla ordena la cadena y decide también qué lugar ES el tile
 *  (`lugarDelTile`): el ÁREA de la huella, con el anchor sin rect como el
 *  tile entero. A igual área manda el orden de iteración del mapa: el primero
 *  es el más interior al elegir el activo y el más exterior al elegir el
 *  lugar del tile (determinista en los dos sentidos).
 *
 *  Lo llaman `activateByPosition` y `buildGenerateTileCtx`
 *  (bridge/handlers/tile.ts). Antes el bucle vivía allí, daba el ÚLTIMO rect
 *  que contenía la celda sin comparar áreas y seguía un solo lugar, así que
 *  salir a campo abierto no disparaba `player_left` y entrar en un lugar
 *  anidado disparaba el `player_left` del que lo contiene (#465, H3 y F1). */

import type { TileCoord } from "../scene/tile.js";
import type { Place } from "./types.js";

type ConAnchor = Pick<Place, "id" | "anchor">;

/** Área de la huella en celdas; sin rect, el tile entero (mayor que
 *  cualquier rect que quepa en él). */
function area(anchor: NonNullable<Place["anchor"]>): number {
  return anchor.rect ? anchor.rect[2] * anchor.rect[3] : Number.POSITIVE_INFINITY;
}

/** Los lugares anclados a `tile`, con su área y su orden de iteración. */
function delTile(places: Iterable<ConAnchor>, tile: TileCoord) {
  const out: Array<{ id: string; anchor: NonNullable<Place["anchor"]>; area: number; orden: number }> = [];
  for (const place of places) {
    const a = place.anchor;
    if (!a || a.tx !== tile.tx || a.ty !== tile.ty) continue;
    out.push({ id: place.id, anchor: a, area: area(a), orden: out.length });
  }
  return out;
}

function contiene(anchor: NonNullable<Place["anchor"]>, col: number, row: number): boolean {
  if (!anchor.rect) return true;
  const [c0, r0, w, h] = anchor.rect;
  return col >= c0 && col < c0 + w && row >= r0 && row < r0 + h;
}

/** Los lugares cuya huella contiene la celda, de FUERA adentro: el último es
 *  el activo. Vacía = campo abierto. */
export function cadenaEnLaCelda(
  places: Iterable<ConAnchor>,
  tile: TileCoord,
  col: number,
  row: number,
): string[] {
  return delTile(places, tile)
    .filter((p) => contiene(p.anchor, col, row))
    .sort((a, b) => b.area - a.area || b.orden - a.orden)
    .map((p) => p.id);
}

/** El lugar ACTIVO en la celda: el más interior de su cadena (la huella más
 *  pequeña; a igual área, el primero). `null` en campo abierto. */
export function lugarEnLaCelda(
  places: Iterable<ConAnchor>,
  tile: TileCoord,
  col: number,
  row: number,
): string | null {
  return cadenaEnLaCelda(places, tile, col, row).at(-1) ?? null;
}

/** El lugar que ES el tile: el más EXTERIOR de los anclados en él. El anchor
 *  sin rect (el que ocupa el tile entero, y el que la activación da fuera de
 *  toda huella) gana a cualquier rect; si todos tienen rect, la huella mayor.
 *  A igual área, el primero. `null` si no hay ninguno anclado. */
export function lugarDelTile(places: Iterable<ConAnchor>, tile: TileCoord): string | null {
  let mejor: { id: string; area: number } | null = null;
  for (const p of delTile(places, tile)) {
    if (mejor === null || p.area > mejor.area) mejor = p;
  }
  return mejor?.id ?? null;
}

/** Qué lugares se dejan y en cuáles se entra al pasar de una cadena a otra.
 *  `salen` va de dentro afuera (se sale de la posada antes que del barrio) y
 *  `entran` de fuera adentro. Un lugar que está en las dos no dispara nada. */
export function cruceDeCadenas(
  vieja: readonly string[],
  nueva: readonly string[],
): { salen: string[]; entran: string[] } {
  const enNueva = new Set(nueva);
  const enVieja = new Set(vieja);
  return {
    salen: vieja.filter((id) => !enNueva.has(id)).reverse(),
    entran: nueva.filter((id) => !enVieja.has(id)),
  };
}
