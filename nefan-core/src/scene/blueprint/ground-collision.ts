/** Colisión analítica del suelo declarado (`ground`): las celdas cubiertas
 *  por AGUA bloquean, y los DECKS (puentes/embarcaderos) las perforan —
 *  transitable sobre el agua. Puro y sin DOM: sustituye al raster del extinto
 *  `map_ground` SVG, así que también corre server-side (sim-collision).
 *
 *  Devuelve el mismo shape que `volumeCollisionGrid` (`TerrainGridData` con
 *  chars `S`); el cliente une ambas fuentes por el camino de siempre. */

import { IMAGE_SOLID_CHAR } from "../image-collision.js";
import type { TerrainGridData } from "../terrain-collision.js";
import { TILE_CELLS, TILE_MPC } from "../tile.js";
import type { WorldRect } from "../tile.js";
import type { GroundDeck, GroundFeature, GroundWater } from "./ground.js";

const OPEN_CHAR = "g";

type Shaped = GroundWater | GroundDeck;

/** Dimensiones del grid de colisión (default: las del tile). El plató pasa
 *  las suyas — cols/rows de la escena y su meters_per_cell (fix del bug
 *  latente: con mpc 1.0 el grid del tile quedaba desalineado del mundo). */
export interface CollisionGridDims {
  cols: number;
  rows: number;
  mpc: number;
}
export const TILE_GRID_DIMS: CollisionGridDims = { cols: TILE_CELLS, rows: TILE_CELLS, mpc: TILE_MPC };

/** true si el centro de celda (u, v) cae dentro de la forma del rasgo. */
export function shapeContains(f: Shaped, u: number, v: number): boolean {
  if (f.rect) {
    const [c0, r0, w, d] = f.rect;
    return u >= c0 && u < c0 + w && v >= r0 && v < r0 + d;
  }
  if (f.ellipse) {
    const { center, rx, ry } = f.ellipse;
    const du = (u - center[0]) / rx;
    const dv = (v - center[1]) / ry;
    return du * du + dv * dv <= 1;
  }
  if (f.polygon) {
    // Ray casting par-impar (el estándar de point-in-polygon).
    const pts = f.polygon;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** Bbox en celdas de la forma (acota el barrido). */
function shapeBounds(f: Shaped): [number, number, number, number] | null {
  if (f.rect) return [f.rect[0], f.rect[1], f.rect[0] + f.rect[2], f.rect[1] + f.rect[3]];
  if (f.ellipse) {
    const { center, rx, ry } = f.ellipse;
    return [center[0] - rx, center[1] - ry, center[0] + rx, center[1] + ry];
  }
  if (f.polygon) {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of f.polygon) {
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    return [minU, minV, maxU, maxV];
  }
  return null;
}

function sweep(grid: Uint8Array, f: Shaped, value: 0 | 1, dims: CollisionGridDims): void {
  const b = shapeBounds(f);
  if (!b) return;
  const c0 = Math.max(0, Math.floor(b[0]));
  const r0 = Math.max(0, Math.floor(b[1]));
  const c1 = Math.min(dims.cols, Math.ceil(b[2]));
  const r1 = Math.min(dims.rows, Math.ceil(b[3]));
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (shapeContains(f, c + 0.5, r + 0.5)) grid[r * dims.cols + c] = value;
    }
  }
}

/** Grid de colisión del suelo declarado: agua ∖ decks. Devuelve null si no
 *  hay ninguna celda sólida (tile sin agua, o toda el agua cubierta). */
export function groundCollisionGrid(
  features: GroundFeature[],
  rect: WorldRect,
  dims: CollisionGridDims = TILE_GRID_DIMS,
): TerrainGridData | null {
  const grid = new Uint8Array(dims.cols * dims.rows);
  for (const f of features) if (f.kind === "water") sweep(grid, f, 1, dims);
  for (const f of features) if (f.kind === "deck") sweep(grid, f, 0, dims);

  let any = false;
  const rows: string[] = [];
  for (let r = 0; r < dims.rows; r++) {
    let row = "";
    for (let c = 0; c < dims.cols; c++) {
      const solid = grid[r * dims.cols + c] === 1;
      any = any || solid;
      row += solid ? IMAGE_SOLID_CHAR : OPEN_CHAR;
    }
    rows.push(row);
  }
  if (!any) return null;
  return {
    grid: rows,
    cols: dims.cols,
    rows: dims.rows,
    meters_per_cell: dims.mpc,
    origin: [rect.minX, rect.minZ],
    solid_chars: [IMAGE_SOLID_CHAR],
  };
}
