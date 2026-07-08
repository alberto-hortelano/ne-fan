/** Colisión analítica de los volúmenes del plan — la huella declarada en
 *  celdas de mundo, NUNCA los píxeles pintados (bajo perspectiva la pintura
 *  de una cara cae al norte de la huella real).
 *
 *  Devuelve el mismo shape que `svgCollisionGrid`/`solidGridFromMasks`
 *  (`TerrainGridData` con chars `S`), así el cliente lo une con la colisión
 *  de agua del `map_ground` y con la derivada de imagen por el camino de
 *  siempre. Puro y sin DOM: testeable en node. */

import { IMAGE_SOLID_CHAR } from "../image-collision.js";
import type { TerrainGridData } from "../terrain-collision.js";
import { TILE_CELLS, TILE_MPC } from "../tile.js";
import type { WorldRect } from "../tile.js";
import { volumeFootprint } from "./render.js";
import type { Volume } from "./volumes.js";

const OPEN_CHAR = "g";

type Grid = Uint8Array; // 1 = sólido

function mark(grid: Grid, u: number, v: number): void {
  const c = Math.floor(u);
  const r = Math.floor(v);
  if (c < 0 || r < 0 || c >= TILE_CELLS || r >= TILE_CELLS) return;
  grid[r * TILE_CELLS + c] = 1;
}

function clear(grid: Grid, u: number, v: number): void {
  const c = Math.floor(u);
  const r = Math.floor(v);
  if (c < 0 || r < 0 || c >= TILE_CELLS || r >= TILE_CELLS) return;
  grid[r * TILE_CELLS + c] = 0;
}

function markRect(grid: Grid, u0: number, v0: number, u1: number, v1: number): void {
  for (let v = Math.floor(v0); v < Math.ceil(v1); v++) {
    for (let u = Math.floor(u0); u < Math.ceil(u1); u++) mark(grid, u + 0.5, v + 0.5);
  }
}

function markDisc(grid: Grid, cu: number, cv: number, r: number): void {
  for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v++) {
    for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u++) {
      const du = u + 0.5 - cu;
      const dv = v + 0.5 - cv;
      if (du * du + dv * dv <= r * r) mark(grid, u + 0.5, v + 0.5);
    }
  }
}

/** Banda gruesa a lo largo de una polilínea (muro): celdas a distancia ≤
 *  width/2 de algún segmento. */
function markBand(grid: Grid, points: [number, number][], width: number): void {
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [au, av] = points[i];
    const [bu, bv] = points[i + 1];
    const minU = Math.floor(Math.min(au, bu) - half);
    const maxU = Math.ceil(Math.max(au, bu) + half);
    const minV = Math.floor(Math.min(av, bv) - half);
    const maxV = Math.ceil(Math.max(av, bv) + half);
    const dU = bu - au;
    const dV = bv - av;
    const len2 = dU * dU + dV * dV || 1;
    for (let v = minV; v <= maxV; v++) {
      for (let u = minU; u <= maxU; u++) {
        const pu = u + 0.5;
        const pv = v + 0.5;
        const t = Math.max(0, Math.min(1, ((pu - au) * dU + (pv - av) * dV) / len2));
        const dx = pu - (au + t * dU);
        const dy = pv - (av + t * dV);
        if (dx * dx + dy * dy <= half * half) mark(grid, pu, pv);
      }
    }
  }
}

/** Colisión de un edificio.
 *  - CON techo: es escenografía — huella COMPLETAMENTE sólida, sus puertas
 *    son decorativas (un jugador que "entrara" desaparecería bajo el techo
 *    sin ver nada). Enterable ⇒ cutaway.
 *  - Cutaway: anillo de muros (grosor 1.5 celdas) con huecos de puerta. */
function markBuilding(grid: Grid, v: Extract<Volume, { type: "building" }>): void {
  const [u0, v0, w, d] = v.rect;
  const u1 = u0 + w;
  const v1 = v0 + d;
  if (!v.cutaway) {
    markRect(grid, u0, v0, u1, v1);
    return;
  }
  const t = 1.5;
  markRect(grid, u0, v0, u1, v0 + t); // norte
  markRect(grid, u0, v1 - t, u1, v1); // sur
  markRect(grid, u0, v0, u0 + t, v1); // oeste
  markRect(grid, u1 - t, v0, u1, v1); // este
  for (const door of v.doors ?? []) {
    const dw = door.w ?? 4;
    switch (door.edge) {
      case "n":
        for (let vv = v0 - 0.5; vv < v0 + t + 0.5; vv++) for (let uu = u0 + door.at; uu < u0 + door.at + dw; uu++) clear(grid, uu + 0.5, vv + 0.5);
        break;
      case "s":
        for (let vv = v1 - t - 0.5; vv < v1 + 0.5; vv++) for (let uu = u0 + door.at; uu < u0 + door.at + dw; uu++) clear(grid, uu + 0.5, vv + 0.5);
        break;
      case "w":
        for (let uu = u0 - 0.5; uu < u0 + t + 0.5; uu++) for (let vv = v0 + door.at; vv < v0 + door.at + dw; vv++) clear(grid, uu + 0.5, vv + 0.5);
        break;
      case "e":
        for (let uu = u1 - t - 0.5; uu < u1 + 0.5; uu++) for (let vv = v0 + door.at; vv < v0 + door.at + dw; vv++) clear(grid, uu + 0.5, vv + 0.5);
        break;
    }
  }
}

/** Puerta monumental: el vano queda LIBRE — limpia una franja transitable a
 *  través del cuerpo (el muro anfitrión ya habrá marcado sus celdas). */
function clearGatePassage(grid: Grid, g: Extract<Volume, { type: "gate" }>): void {
  const w = g.w ?? 8;
  const dh = 3.5; // holgura: cruza el grosor típico del muro anfitrión
  if (g.orient === "x") {
    for (let vv = Math.floor(g.at[1] - dh); vv <= Math.ceil(g.at[1] + dh); vv++) {
      for (let uu = Math.floor(g.at[0] - w / 2); uu < Math.ceil(g.at[0] + w / 2); uu++) clear(grid, uu + 0.5, vv + 0.5);
    }
  } else {
    for (let uu = Math.floor(g.at[0] - dh); uu <= Math.ceil(g.at[0] + dh); uu++) {
      for (let vv = Math.floor(g.at[1] - w / 2); vv < Math.ceil(g.at[1] + w / 2); vv++) clear(grid, uu + 0.5, vv + 0.5);
    }
  }
}

/** Grid de colisión de las huellas de los volúmenes. Devuelve null si ningún
 *  volumen marca celdas (tile abierto). Las puertas (`gate` y `doors` de
 *  edificios) se aplican al final: SIEMPRE ganan al sólido. */
export function volumeCollisionGrid(volumes: Volume[], rect: WorldRect): TerrainGridData | null {
  const grid: Grid = new Uint8Array(TILE_CELLS * TILE_CELLS);
  for (const v of volumes) {
    switch (v.type) {
      case "building":
        markBuilding(grid, v);
        break;
      case "wall":
        markBand(grid, v.points as [number, number][], v.width ?? 3);
        break;
      case "tower":
        markDisc(grid, v.at[0], v.at[1], v.r ?? 6);
        break;
      case "tree":
        markDisc(grid, v.at[0], v.at[1], Math.max(0.9, 0.9 * (v.s ?? 1)));
        break;
      case "rock":
        markDisc(grid, v.at[0], v.at[1], 2.1 * (v.s ?? 1));
        break;
      case "fountain":
        markDisc(grid, v.at[0], v.at[1], v.r ?? 5);
        break;
      case "gate": {
        // jambas: cuerpo completo; el vano se limpia en la pasada final
        const fp = volumeFootprint(v).cells;
        markRect(grid, fp[0], fp[1], fp[2], fp[3]);
        break;
      }
      case "prop": {
        if (v.passable) break;
        if (v.rect) markRect(grid, v.rect[0], v.rect[1], v.rect[0] + v.rect[2], v.rect[1] + v.rect[3]);
        else markDisc(grid, v.at![0], v.at![1], 1.3);
        break;
      }
      case "bush":
        break; // decorativo, no bloquea
    }
  }
  for (const v of volumes) if (v.type === "gate") clearGatePassage(grid, v);

  let any = false;
  const rows: string[] = [];
  for (let r = 0; r < TILE_CELLS; r++) {
    let row = "";
    for (let c = 0; c < TILE_CELLS; c++) {
      const solid = grid[r * TILE_CELLS + c] === 1;
      any = any || solid;
      row += solid ? IMAGE_SOLID_CHAR : OPEN_CHAR;
    }
    rows.push(row);
  }
  if (!any) return null;
  return {
    grid: rows,
    cols: TILE_CELLS,
    rows: TILE_CELLS,
    meters_per_cell: TILE_MPC,
    origin: [rect.minX, rect.minZ],
    solid_chars: [IMAGE_SOLID_CHAR],
  };
}
