/** Resolución place → coordenadas mundo para el ejecutor de NPCs.
 *
 *  Un place es físicamente alcanzable si tiene `anchor` (tile + rect opcional
 *  en celdas — la misma convención que activateByPosition en
 *  bridge/handlers/tile.ts) o una escena realizada que sea un tile. Sin
 *  ninguno de los dos devuelve null y el viaje queda narrative-paced. */

import type { NarrativeState } from "../narrative/narrative-state.js";
import { parseTileKey, tileWorldRect, TILE_MPC } from "../scene/tile.js";

export function resolvePlaceTarget(
  state: NarrativeState,
  placeId: string,
): { x: number; z: number } | null {
  const place = state.worldMap.get(placeId);
  if (!place) return null;

  if (place.anchor) {
    const rect = tileWorldRect(place.anchor.tx, place.anchor.ty);
    const r = place.anchor.rect;
    if (r) {
      const [col, row, w, h] = r;
      return {
        x: rect.minX + (col + w / 2) * TILE_MPC,
        z: rect.minZ + (row + h / 2) * TILE_MPC,
      };
    }
    return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
  }

  if (place.realized_scene_id) {
    const coord = parseTileKey(place.realized_scene_id);
    if (coord) {
      const rect = tileWorldRect(coord.tx, coord.ty);
      return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
    }
  }
  return null;
}
