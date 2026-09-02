/** Geometría del plano continuo de tiles — ÚNICA fuente de verdad.
 *
 *  El mundo es un plano global dividido en tiles cuadrados de 64×64 m con
 *  clave (tx, ty). El tile (0,0) está CENTRADO en el origen del mundo: así la
 *  migración del save v3 (escenas centradas en el origen) estampa la escena
 *  vieja en el tile (0,0) sin mover al jugador ni a los NPC.
 *
 *  Convención de ejes (idéntica al cliente): east = +x, west = −x,
 *  south = +z (ty+1), north = −z (ty−1).
 *
 *  El cliente HTML IMPORTA este módulo — no duplicar la geometría. */

import type { Edge } from "../world-map/types.js";

export const TILE_SIZE_M = 64;
export const TILE_MPC = 0.5;
export const TILE_CELLS = TILE_SIZE_M / TILE_MPC; // 128

export interface TileCoord {
  tx: number;
  ty: number;
}

export interface WorldRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const tileKey = (tx: number, ty: number): string => `tile_${tx}_${ty}`;

/** Parse de un id canónico `tile_{tx}_{ty}` → coords, o null si no lo es. */
export function parseTileKey(key: string): TileCoord | null {
  const m = /^tile_(-?\d+)_(-?\d+)$/.exec(key);
  if (!m) return null;
  return { tx: Number(m[1]), ty: Number(m[2]) };
}

/** Rect mundial del tile — (0,0) centrado en el origen. */
export function tileWorldRect(tx: number, ty: number): WorldRect {
  return {
    minX: tx * TILE_SIZE_M - TILE_SIZE_M / 2,
    minZ: ty * TILE_SIZE_M - TILE_SIZE_M / 2,
    maxX: tx * TILE_SIZE_M + TILE_SIZE_M / 2,
    maxZ: ty * TILE_SIZE_M + TILE_SIZE_M / 2,
  };
}

/** Tile que contiene el punto mundial (x, z). Consistente con el rect
 *  centrado: round, no floor. */
export function worldToTile(x: number, z: number): TileCoord {
  // El `+ 0` normaliza el -0 de Math.round con negativos pequeños.
  return { tx: Math.round(x / TILE_SIZE_M) + 0, ty: Math.round(z / TILE_SIZE_M) + 0 };
}

export function neighborTile(tx: number, ty: number, edge: Edge): TileCoord {
  switch (edge) {
    case "north": return { tx, ty: ty - 1 };
    case "south": return { tx, ty: ty + 1 };
    case "east": return { tx: tx + 1, ty };
    case "west": return { tx: tx - 1, ty };
  }
}

/** Catálogo de biomas → char base del grid (el fill que sintetiza
 *  `scene-expand`; el nombre del bioma no viaja: nadie lo lee). El bioma
 *  desconocido es fail-loud — el motor solo puede elegir del catálogo, que es
 *  el mismo enum que `SCENE_BIOMES` en el zod y en su espejo Python. */
export const BIOME_CATALOG: Record<string, string> = {
  grass: "g",
  forest_floor: "g",
  meadow: "g",
  sand: "a",
  dirt: "d",
  stone: "s",
  snow: "n",
  swamp: "d",
};

/** Resuelve un `biome` del catálogo → char base del fill. Lanza si es
 *  desconocido: el catálogo es lo único que el contrato admite. */
export function resolveBiome(biome: unknown): string {
  if (typeof biome !== "string" || !biome) {
    throw new Error(`tile.biome requerido (catálogo: ${Object.keys(BIOME_CATALOG).join(", ")})`);
  }
  const entry = BIOME_CATALOG[biome];
  if (entry) return entry;
  throw new Error(
    `tile.biome "${biome}" desconocido — usa el catálogo (${Object.keys(BIOME_CATALOG).join(", ")})`,
  );
}
