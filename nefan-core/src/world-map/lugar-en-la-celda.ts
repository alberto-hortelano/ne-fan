/** Qué place del world map está ACTIVO en una celda de un tile — lógica PURA.
 *
 *  El `rect` de un anchor es la HUELLA del lugar en su tile (el área
 *  construida de un pueblo, un edificio y su patio), así que las huellas se
 *  anidan: la posada cae dentro del pueblo. Entre los rects de ese tile que
 *  contienen la celda gana el de MENOR área —el más específico—, y a igual
 *  área, el primero en orden de iteración (determinista). Si ningún rect la
 *  contiene, el lugar es el primero anclado a ese tile SIN rect, que ocupa el
 *  tile entero. Sin ninguno de los dos, `null`: campo abierto.
 *
 *  Lo llama `activateByPosition` (bridge/handlers/tile.ts); antes el bucle
 *  vivía allí y daba el ÚLTIMO rect que contenía la celda, sin comparar
 *  áreas, con un comentario que decía lo contrario (#465, H3). */

import type { TileCoord } from "../scene/tile.js";
import type { Place } from "./types.js";

export function lugarEnLaCelda(
  places: Iterable<Pick<Place, "id" | "anchor">>,
  tile: TileCoord,
  col: number,
  row: number,
): string | null {
  let conRect: { id: string; area: number } | null = null;
  let sinRect: string | null = null;
  for (const place of places) {
    const a = place.anchor;
    if (!a || a.tx !== tile.tx || a.ty !== tile.ty) continue;
    if (!a.rect) {
      sinRect ??= place.id;
      continue;
    }
    const [c0, r0, w, h] = a.rect;
    if (col < c0 || col >= c0 + w || row < r0 || row >= r0 + h) continue;
    const area = w * h;
    if (conRect === null || area < conRect.area) conRect = { id: place.id, area };
  }
  return conRect?.id ?? sinRect;
}
