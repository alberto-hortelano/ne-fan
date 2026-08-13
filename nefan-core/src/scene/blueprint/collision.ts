/** Colisión analítica de los volúmenes del plan — la huella declarada en
 *  celdas de mundo, NUNCA los píxeles pintados (bajo perspectiva la pintura
 *  de una cara cae al norte de la huella real).
 *
 *  Devuelve el mismo shape que `groundCollisionGrid`/`solidGridFromMasks`
 *  (`TerrainGridData` con chars `S`), así el cliente lo une con la colisión
 *  de agua del plan declarado y con la derivada de imagen por el camino de
 *  siempre. Puro y sin DOM: testeable en node. */

import { IMAGE_SOLID_CHAR } from "../image-collision.js";
import type { TerrainGridData } from "../terrain-collision.js";
import type { WorldRect } from "../tile.js";
import { volumeFootprint } from "./footprint.js";
import type { Volume } from "./volumes.js";
import { TILE_GRID_DIMS, type CollisionGridDims } from "./ground-collision.js";

const OPEN_CHAR = "g";

type Grid = Uint8Array; // 1 = sólido

function mark(grid: Grid, u: number, v: number, dims: CollisionGridDims): void {
  const c = Math.floor(u);
  const r = Math.floor(v);
  if (c < 0 || r < 0 || c >= dims.cols || r >= dims.rows) return;
  grid[r * dims.cols + c] = 1;
}

function clear(grid: Grid, u: number, v: number, dims: CollisionGridDims): void {
  const c = Math.floor(u);
  const r = Math.floor(v);
  if (c < 0 || r < 0 || c >= dims.cols || r >= dims.rows) return;
  grid[r * dims.cols + c] = 0;
}

function markRect(grid: Grid, u0: number, v0: number, u1: number, v1: number, dims: CollisionGridDims): void {
  for (let v = Math.floor(v0); v < Math.ceil(v1); v++) {
    for (let u = Math.floor(u0); u < Math.ceil(u1); u++) mark(grid, u + 0.5, v + 0.5, dims);
  }
}

function markDisc(grid: Grid, cu: number, cv: number, r: number, dims: CollisionGridDims): void {
  for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v++) {
    for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u++) {
      const du = u + 0.5 - cu;
      const dv = v + 0.5 - cv;
      if (du * du + dv * dv <= r * r) mark(grid, u + 0.5, v + 0.5, dims);
    }
  }
}

/** Banda gruesa a lo largo de una polilínea (muro): celdas a distancia ≤
 *  width/2 de algún segmento. */
function markBand(grid: Grid, points: [number, number][], width: number, dims: CollisionGridDims): void {
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
        if (dx * dx + dy * dy <= half * half) mark(grid, pu, pv, dims);
      }
    }
  }
}

/** Rect rotado `angleDeg` alrededor de su centro (patrón de markBand: barrer
 *  el AABB y testear el centro de cada celda en el marco LOCAL del rect). */
function markRotRect(
  grid: Grid,
  rect: [number, number, number, number],
  angleDeg: number,
  dims: CollisionGridDims,
): void {
  const [u0, v0, w, d] = rect;
  const cu = u0 + w / 2;
  const cv = v0 + d / 2;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const eu = (Math.abs(c) * w + Math.abs(s) * d) / 2;
  const ev = (Math.abs(s) * w + Math.abs(c) * d) / 2;
  for (let v = Math.floor(cv - ev); v < Math.ceil(cv + ev); v++) {
    for (let u = Math.floor(cu - eu); u < Math.ceil(cu + eu); u++) {
      const du = u + 0.5 - cu;
      const dv = v + 0.5 - cv;
      // Marco local: rotar el offset por −angle (inversa de rotatedRectCorners).
      const lu = du * c - dv * s;
      const lv = du * s + dv * c;
      if (Math.abs(lu) <= w / 2 && Math.abs(lv) <= d / 2) mark(grid, u + 0.5, v + 0.5, dims);
    }
  }
}

/** Colisión de un edificio.
 *  - CON techo: es escenografía — huella COMPLETAMENTE sólida, sus puertas
 *    son decorativas (un jugador que "entrara" desaparecería bajo el techo
 *    sin ver nada). Enterable ⇒ cutaway.
 *  - Cutaway: anillo de muros (grosor 1.5 celdas) con huecos de puerta.
 *  - Con `angle` (nunca cutaway, lo rechaza parseVolumes): huella rotada. */
function markBuilding(grid: Grid, v: Extract<Volume, { type: "building" }>, dims: CollisionGridDims): void {
  const [u0, v0, w, d] = v.rect;
  const u1 = u0 + w;
  const v1 = v0 + d;
  if (!v.cutaway) {
    if (v.angle) markRotRect(grid, v.rect, v.angle, dims);
    else markRect(grid, u0, v0, u1, v1, dims);
    return;
  }
  const t = 1.5;
  markRect(grid, u0, v0, u1, v0 + t, dims); // norte
  markRect(grid, u0, v1 - t, u1, v1, dims); // sur
  markRect(grid, u0, v0, u0 + t, v1, dims); // oeste
  markRect(grid, u1 - t, v0, u1, v1, dims); // este
  for (const door of v.doors ?? []) {
    const dw = door.w ?? 4;
    switch (door.edge) {
      case "n":
        for (let vv = v0 - 0.5; vv < v0 + t + 0.5; vv++) for (let uu = u0 + door.at; uu < u0 + door.at + dw; uu++) clear(grid, uu + 0.5, vv + 0.5, dims);
        break;
      case "s":
        for (let vv = v1 - t - 0.5; vv < v1 + 0.5; vv++) for (let uu = u0 + door.at; uu < u0 + door.at + dw; uu++) clear(grid, uu + 0.5, vv + 0.5, dims);
        break;
      case "w":
        for (let uu = u0 - 0.5; uu < u0 + t + 0.5; uu++) for (let vv = v0 + door.at; vv < v0 + door.at + dw; vv++) clear(grid, uu + 0.5, vv + 0.5, dims);
        break;
      case "e":
        for (let uu = u1 - t - 0.5; uu < u1 + 0.5; uu++) for (let vv = v0 + door.at; vv < v0 + door.at + dw; vv++) clear(grid, uu + 0.5, vv + 0.5, dims);
        break;
    }
  }
}

/** Puerta monumental: el vano queda LIBRE — limpia una franja transitable a
 *  través del cuerpo (el muro anfitrión ya habrá marcado sus celdas). */
function clearGatePassage(grid: Grid, g: Extract<Volume, { type: "gate" }>, dims: CollisionGridDims): void {
  const w = g.w ?? 8;
  const dh = 3.5; // holgura: cruza el grosor típico del muro anfitrión
  if (g.orient === "x") {
    for (let vv = Math.floor(g.at[1] - dh); vv <= Math.ceil(g.at[1] + dh); vv++) {
      for (let uu = Math.floor(g.at[0] - w / 2); uu < Math.ceil(g.at[0] + w / 2); uu++) clear(grid, uu + 0.5, vv + 0.5, dims);
    }
  } else {
    for (let uu = Math.floor(g.at[0] - dh); uu <= Math.ceil(g.at[0] + dh); uu++) {
      for (let vv = Math.floor(g.at[1] - w / 2); vv < Math.ceil(g.at[1] + w / 2); vv++) clear(grid, uu + 0.5, vv + 0.5, dims);
    }
  }
}

/** Radio (celdas) del disco de colisión de un volumen SÓLIDO UNIFORME
 *  (tower/fountain/rock/prop-punto) — FUENTE ÚNICA compartida por
 *  `volumeCollisionGrid` (markDisc) y la huella del manifest del stage
 *  (`volumeFootprintCells`), para que la huella COLISIONABLE del manifest
 *  coincida SIEMPRE con la colisión (antes los defaults divergían: tower r??3
 *  vs r??6, etc.). `null` = no es un disco sólido uniforme (building/wall/gate,
 *  prop con rect, y el ÁRBOL — cuya copa se dibuja grande pero colisiona solo
 *  en el tronco, así que su huella NO sale de aquí). El RENDER es independiente
 *  de este radio. */
export function volumeSolidDiscRadiusCells(v: Volume): number | null {
  switch (v.type) {
    case "tower":
      return v.r ?? 6;
    case "fountain":
      return v.r ?? 5;
    case "rock":
      return 2.1 * (v.s ?? 1);
    case "prop":
      return v.at !== undefined && v.rect === undefined ? 1.3 : null;
    default:
      return null;
  }
}

/** Grid de colisión de las huellas de los volúmenes. Devuelve null si ningún
 *  volumen marca celdas (tile abierto). Las puertas (`gate` y `doors` de
 *  edificios) se aplican al final: SIEMPRE ganan al sólido. */
export function volumeCollisionGrid(
  volumes: Volume[],
  rect: WorldRect,
  dims: CollisionGridDims = TILE_GRID_DIMS,
): TerrainGridData | null {
  const grid: Grid = new Uint8Array(dims.cols * dims.rows);
  for (const v of volumes) {
    switch (v.type) {
      case "building":
        markBuilding(grid, v, dims);
        break;
      case "wall":
        markBand(grid, v.points as [number, number][], v.width ?? 3, dims);
        break;
      case "tower":
      case "fountain":
      case "rock":
        markDisc(grid, v.at[0], v.at[1], volumeSolidDiscRadiusCells(v)!, dims);
        break;
      case "tree":
        // Árbol: colisión solo en el tronco (la copa se dibuja grande pero no
        // bloquea) — radio propio, NO el disco sólido uniforme.
        markDisc(grid, v.at[0], v.at[1], Math.max(0.9, 0.9 * (v.s ?? 1)), dims);
        break;
      case "gate": {
        // jambas: cuerpo completo; el vano se limpia en la pasada final
        const fp = volumeFootprint(v).cells;
        markRect(grid, fp[0], fp[1], fp[2], fp[3], dims);
        break;
      }
      case "prop": {
        if (v.passable) break;
        if (v.rect && v.angle) markRotRect(grid, v.rect, v.angle, dims);
        else if (v.rect) markRect(grid, v.rect[0], v.rect[1], v.rect[0] + v.rect[2], v.rect[1] + v.rect[3], dims);
        else markDisc(grid, v.at![0], v.at![1], volumeSolidDiscRadiusCells(v)!, dims);
        break;
      }
      case "bush":
        break; // decorativo, no bloquea
    }
  }
  for (const v of volumes) if (v.type === "gate") clearGatePassage(grid, v, dims);

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
