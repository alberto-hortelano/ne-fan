/** Colisión analítica de los volúmenes del plan — la huella declarada en
 *  celdas de mundo, NUNCA los píxeles pintados (bajo perspectiva la pintura
 *  de una cara cae al norte de la huella real).
 *
 *  Devuelve el mismo shape que `groundCollisionGrid` (`TerrainGridData` con
 *  chars `S`), así el cliente lo une con la colisión de agua del plan
 *  declarado por el camino de siempre. Puro y sin DOM: testeable en node. */

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

/** Tolerancia del solape: por debajo, dos figuras solo se TOCAN (un borde
 *  sobre la frontera de celdas, o el `cos(90°)` que no da 0 exacto). */
const SOLAPE_EPS = 1e-9;

/** ¿Se cortan la proyección [a, b] de la figura (cerrada; si es un punto,
 *  el punto) y la de la celda (lo, hi) ABIERTA? Tocarse no cuenta. */
function proyeccionesSeCortan(a: number, b: number, lo: number, hi: number): boolean {
  if (b - a <= SOLAPE_EPS) return a > lo + SOLAPE_EPS && a < hi - SOLAPE_EPS;
  return Math.min(b, hi) - Math.max(a, lo) > SOLAPE_EPS;
}

/** ¿Ocupa el rect rotado ÁREA dentro de la celda (col, fila)? Rect de centro
 *  `(cu, cv)`, eje largo unitario `(eu, ev)`, semilargo `sl` y semiancho `sa`
 *  (con `sa` 0 es un segmento, y la pregunta es si cruza la celda abierta).
 *  Ejes separadores (SAT): los dos de la rejilla, el eje y su normal.
 *  Estricto: una figura que solo toca el borde de la celda no la marca. */
function rectRotadoSolapaCelda(
  cu: number, cv: number, eu: number, ev: number, sl: number, sa: number, col: number, fila: number,
): boolean {
  const nu = -ev;
  const nv = eu;
  const radioU = sl * Math.abs(eu) + sa * Math.abs(nu);
  const radioV = sl * Math.abs(ev) + sa * Math.abs(nv);
  if (!proyeccionesSeCortan(cu - radioU, cu + radioU, col, col + 1)) return false;
  if (!proyeccionesSeCortan(cv - radioV, cv + radioV, fila, fila + 1)) return false;
  const mu = col + 0.5;
  const mv = fila + 0.5;
  for (const [au, av, semi] of [[eu, ev, sl], [nu, nv, sa]] as const) {
    const c = cu * au + cv * av;
    const m = mu * au + mv * av;
    const r = (Math.abs(au) + Math.abs(av)) / 2; // semiproyección de la celda
    if (!proyeccionesSeCortan(c - semi, c + semi, m - r, m + r)) return false;
  }
  return true;
}

/** Marca toda celda donde el rect rotado ocupa área (barre el AABB de sus
 *  cuatro esquinas). Contiene al criterio de centro: si el centro de una
 *  celda cae en el rect, el rect ocupa área en ella. */
function markRectRotadoPorSolape(
  grid: Grid, cu: number, cv: number, eu: number, ev: number, sl: number, sa: number, dims: CollisionGridDims,
): void {
  const radioU = sl * Math.abs(eu) + sa * Math.abs(ev);
  const radioV = sl * Math.abs(ev) + sa * Math.abs(eu);
  for (let v = Math.floor(cv - radioV); v <= Math.floor(cv + radioV); v++) {
    for (let u = Math.floor(cu - radioU); u <= Math.floor(cu + radioU); u++) {
      if (rectRotadoSolapaCelda(cu, cv, eu, ev, sl, sa, u, v)) mark(grid, u + 0.5, v + 0.5, dims);
    }
  }
}

/** Disco por CENTRO de celda, más la celda que contiene el centro del disco.
 *  No va por solape como el resto: un tronco de r 0,9 centrado pasaría de 1 a
 *  9 celdas y la derivación del bosque (`vegetation.ts`, `MAX_VEG_DENSITY`)
 *  dejaría de ser verdad. El único agujero del centro es un disco que no
 *  contiene ningún centro (r < √2/2) y se queda en cero celdas: la celda del
 *  centro lo cierra, y con r ≥ √2/2 ya estaba marcada. */
function markDisc(grid: Grid, cu: number, cv: number, r: number, dims: CollisionGridDims): void {
  mark(grid, cu, cv, dims);
  markDiscPorCentro(grid, cu, cv, r, dims);
}

/** Banda gruesa a lo largo de una polilínea (muro): cada tramo es el rect
 *  `[0, len] × [−width/2, width/2]` con los extremos PLANOS, y colisiona toda
 *  celda donde ese rect ocupa área. Por solape y no por centro: una cerca de
 *  `width` < 1 con el eje sobre una frontera de celdas no contenía NINGÚN
 *  centro y se atravesaba (#788); ahora la unión de celdas contiene la banda,
 *  que es continua, así que cierra por construcción en cualquier orientación.
 *  RENDER ≠ COLISIÓN: la colisión cubre lo pintado (`wallPrims`, los mismos
 *  tramos) redondeado hacia fuera hasta la celda, y no añade celdas sin
 *  pintura salvo las tapas de los vértices compartidos.
 *  - PUNTAS LIBRES: el extremo plano ES el corte — la banda acaba en seco,
 *    como el muro pintado; la tapa redonda ponía hasta 3 m de muro invisible
 *    delante de la punta (#787).
 *  - VÉRTICES COMPARTIDOS: la tapa redonda de width/2 por CENTRO de celda
 *    se queda. Ya no hace falta para sellar (los dos rects comparten el
 *    vértice), pero quitarla borraría celdas que hoy bloquean; y ponerla por
 *    solape añadiría la esquina exterior de todo anillo de eje de width 1.
 *  - Tramo de longitud 0: no pinta nada y no marca nada. */
function markBand(grid: Grid, points: [number, number][], width: number, dims: CollisionGridDims): void {
  const half = width / 2;
  const last = points.length - 1;
  const cerrada = last > 1 && points[0][0] === points[last][0] && points[0][1] === points[last][1];
  for (let i = 0; i < last; i++) {
    const [au, av] = points[i];
    const [bu, bv] = points[i + 1];
    const len = Math.hypot(bu - au, bv - av);
    if (len === 0) continue;
    markRectRotadoPorSolape(grid, (au + bu) / 2, (av + bv) / 2, (bu - au) / len, (bv - av) / len, len / 2, half, dims);
  }
  for (let i = cerrada ? 0 : 1; i < last; i++) markDiscPorCentro(grid, points[i][0], points[i][1], half, dims);
}

/** Tapa de vértice: solo las celdas cuyo CENTRO cae en el disco. */
function markDiscPorCentro(grid: Grid, cu: number, cv: number, r: number, dims: CollisionGridDims): void {
  for (let v = Math.floor(cv - r); v <= Math.ceil(cv + r); v++) {
    for (let u = Math.floor(cu - r); u <= Math.ceil(cu + r); u++) {
      const du = u + 0.5 - cu;
      const dv = v + 0.5 - cv;
      if (du * du + dv * dv <= r * r) mark(grid, u + 0.5, v + 0.5, dims);
    }
  }
}

/** Relleno de un polígono arbitrario (contorno de un `prism`): la celda es
 *  sólida si su centro cae dentro (point-in-polygon por ray-casting par-impar
 *  — el MISMO algoritmo que `shapeContains` para el agua del ground) o si
 *  alguna arista cruza la celda abierta. Las dos juntas son «el polígono
 *  ocupa área en la celda»: sin las aristas, una tira de menos de una celda
 *  de ancho no contenía ningún centro y se atravesaba (#788). */
function markPolygon(grid: Grid, points: [number, number][], dims: CollisionGridDims): void {
  if (points.length < 3) return;
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const [u, v] of points) {
    minU = Math.min(minU, u); minV = Math.min(minV, v);
    maxU = Math.max(maxU, u); maxV = Math.max(maxV, v);
  }
  for (let v = Math.floor(minV); v <= Math.ceil(maxV); v++) {
    for (let u = Math.floor(minU); u <= Math.ceil(maxU); u++) {
      const pu = u + 0.5;
      const pv = v + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > pv !== yj > pv && pu < ((xj - xi) * (pv - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mark(grid, pu, pv, dims);
    }
  }
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [au, av] = points[j];
    const [bu, bv] = points[i];
    const len = Math.hypot(bu - au, bv - av);
    if (len === 0) continue;
    markRectRotadoPorSolape(grid, (au + bu) / 2, (av + bv) / 2, (bu - au) / len, (bv - av) / len, len / 2, 0, dims);
  }
}

/** Rect rotado `angleDeg` alrededor de su centro, por solape. Su eje largo
 *  es `(cos a, −sin a)`: el convenio de `rotatedRectCorners` (footprint.ts). */
function markRotRect(
  grid: Grid,
  rect: [number, number, number, number],
  angleDeg: number,
  dims: CollisionGridDims,
): void {
  const [u0, v0, w, d] = rect;
  const a = (angleDeg * Math.PI) / 180;
  markRectRotadoPorSolape(grid, u0 + w / 2, v0 + d / 2, Math.cos(a), -Math.sin(a), w / 2, d / 2, dims);
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

/** Grosor (celdas) del muro anfitrión sobre el que se planta un `gate`: el wall
 *  cuyo trazo pasa por el `at` de la puerta (misma proyección que usa el greybox
 *  para tallar el vano). `null` si ninguno — el vano usa la holgura por defecto.
 *  Con varios candidatos, el más grueso (el vano debe cruzarlos todos). */
function gateHostWallWidth(
  g: Extract<Volume, { type: "gate" }>,
  walls: Array<Extract<Volume, { type: "wall" }>>,
): number | null {
  let best: number | null = null;
  for (const wl of walls) {
    const width = wl.width ?? 3;
    const pts = wl.points as [number, number][];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1) || 1;
      const dirU = (x2 - x1) / len;
      const dirV = (z2 - z1) / len;
      const t = (g.at[0] - x1) * dirU + (g.at[1] - z1) * dirV;
      if (t < -2 || t > len + 2) continue; // fuera del tramo (con margen)
      const px = x1 + dirU * t;
      const pz = z1 + dirV * t;
      if (Math.hypot(g.at[0] - px, g.at[1] - pz) > width / 2 + 2) continue; // lejos del trazo
      best = Math.max(best ?? 0, width);
    }
  }
  return best;
}

/** Puerta monumental: el vano queda LIBRE — limpia una franja transitable a
 *  través del cuerpo. La PROFUNDIDAD del vano (perpendicular al muro) sale del
 *  GROSOR del muro anfitrión: con la holgura fija de 3.5 un muro grueso
 *  (`width` hasta 12 → ±6) dejaba celdas sólidas a ambos lados del vano (puerta
 *  abierta, colisión bloqueada). Suelo en 3.5 (cubre el cuerpo de la puerta y
 *  los muros finos); crece a `width/2 + 0.5` para cruzar los gruesos. */
function clearGatePassage(
  grid: Grid,
  g: Extract<Volume, { type: "gate" }>,
  walls: Array<Extract<Volume, { type: "wall" }>>,
  dims: CollisionGridDims,
): void {
  const w = g.w ?? 8;
  const hostWidth = gateHostWallWidth(g, walls);
  const dh = Math.max(3.5, (hostWidth ?? 0) / 2 + 0.5);
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

/** Radio (celdas) del TRONCO de un árbol: lo ÚNICO que bloquea de un árbol
 *  (la copa se dibuja grande y se atraviesa). Suelo de 0,9 celdas = 0,45 m de
 *  radio para que un ejemplar pequeño siga siendo un obstáculo real.
 *
 *  FUENTE ÚNICA: lo consume la colisión (aquí) y la separación mínima entre
 *  ejemplares del scatter de `vegetation_zones` (`vegetation.ts`), que se
 *  DERIVA de este radio — si el tronco engorda, el bosque se abre solo. */
export function treeTrunkRadiusCells(s: number): number {
  return Math.max(0.9, 0.9 * s);
}

/** Radio (celdas) del disco de colisión de un volumen SÓLIDO UNIFORME
 *  (tower/fountain/rock/prop-punto) — FUENTE ÚNICA compartida por
 *  `volumeCollisionGrid` (markDisc) y la huella del manifest
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
        markDisc(grid, v.at[0], v.at[1], treeTrunkRadiusCells(v.s ?? 1), dims);
        break;
      case "gate": {
        // jambas: cuerpo completo; el vano se limpia en la pasada final
        const fp = volumeFootprint(v);
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
      case "prism":
        // Geometría libre: rellena su contorno salvo que se declare no-sólida.
        if (v.solid !== false) markPolygon(grid, v.points, dims);
        break;
      case "custom": {
        // Composición libre: estampa el AABB de sus piezas (la MISMA huella
        // del manifest — footprint.ts) salvo que se declare no-sólida.
        if (v.solid === false) break;
        const fp = volumeFootprint(v);
        markRect(grid, fp[0], fp[1], fp[2], fp[3], dims);
        break;
      }
      case "bush":
        break; // decorativo, no bloquea
    }
  }
  const walls = volumes.filter((v): v is Extract<Volume, { type: "wall" }> => v.type === "wall");
  for (const v of volumes) if (v.type === "gate") clearGatePassage(grid, v, walls, dims);

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
