/** Expansión determinista de primitivas de escena (Format D v2).
 *
 *  El motor narrativo puede describir la escena con primitivas de alto nivel
 *  en vez de dibujar el ASCII a mano:
 *   - `terrain_patches`: parches ASCII rectangulares sobre el fill del bioma.
 *   - `decor` con `attach: "wall"`: se pega a la celda de muro más cercana.
 *
 *  `vegetation_zones` NO se expande aquí y es a propósito: estampaba una
 *  entity `tree` de 1×1 por celda plantada (cientos por tile) que se PINTABA
 *  pero no colisionaba, mientras la misma zona derivaba aparte sus volúmenes
 *  de verdad. Dos especies de árbol conviviendo en el mismo bosque. Hoy la
 *  vegetación de masa tiene una sola ruta: volúmenes tree/bush del plan
 *  (`src/scene/tile-plan.ts`).
 *
 *  Se aplica UNA vez, en el bridge, al recibir la escena del motor (antes de
 *  `recordSceneLoaded`): lo persistido y difundido es Format D plano ya
 *  expandido, así los saves y clientes existentes no cambian. La marca
 *  `__expanded` hace la expansión idempotente; las primitivas se conservan
 *  como provenance. `formatDToWorld` expande defensivamente si ve primitivas
 *  sin la marca (fixtures locales).
 *
 *  Fail-loud: una primitiva imposible (rect fuera del grid, puerta fuera de su
 *  lado) lanza con contexto — el pre-flight del motor narrativo la rebota para
 *  que corrija; si llega hasta el bridge, el catch existente la difunde como
 *  `narrative_status: error`. */

import { TILE_CELLS, TILE_MPC, resolveBiome } from "./tile.js";
import { parseGround } from "./blueprint/ground.js";
import { shapeContains, GROUND_WATER_CHAR } from "./blueprint/ground-collision.js";

/** Char de muro: el único que el `decor` con `attach:"wall"` busca para
 *  pegarse. Es el reservado del contrato (`DEFAULT_SOLID_CHARS`), no una
 *  elección de quien declara la escena: desde que se retiró la primitiva de
 *  salas (#301) ninguna introduce un char de muro propio. */
const WALL_CHAR = "W";

/** ¿Tiene la escena primitivas pendientes de expandir? */
export function hasUnexpandedPrimitives(raw: Record<string, unknown>): boolean {
  if (raw.__expanded === true) return false;
  // Un tile SIEMPRE se expande: el fill del bioma es obligatorio aunque no
  // traiga ninguna otra primitiva.
  if (raw.tile !== undefined) return true;
  return Array.isArray(raw.entities) &&
    (raw.entities as Record<string, unknown>[]).some((e) => e && e.attach === "wall");
}

/** Pinta un camino grueso ("_") sobre el grid mutable: celda pintada si la
 *  distancia de su centro al segmento ≤ width/2. Único rasterizador por
 *  polilínea; agua y decks se pintan por área con `shapeContains`. */
function rasterizePath(grid: string[][], points: [number, number][], width: number): void {
  const radius = Math.max(width, 1) / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cMin = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
    const cMax = Math.min(TILE_CELLS - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
    const rMin = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
    const rMax = Math.min(TILE_CELLS - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const px = c + 0.5;
        const py = r + 0.5;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const qx = x0 + t * dx;
        const qy = y0 + t * dy;
        const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
        if (d2 <= radius * radius) grid[r][c] = "_";
      }
    }
  }
}

/** Auto-snap: un endpoint a ≤2 celdas de un borde se pega a él (conserva la
 *  otra coordenada), evitando caminos que "casi" llegan a la costura. Mutación
 *  in-place de los extremos. Lo usa la rasterización de los paths de `ground`,
 *  la vía de costuras. */
function snapPathEndpointsToEdges(pts: [number, number][]): void {
  for (const idx of [0, pts.length - 1]) {
    const [x, y] = pts[idx];
    if (x > 0 && x <= 2) pts[idx] = [0, y];
    else if (x < TILE_CELLS && x >= TILE_CELLS - 2) pts[idx] = [TILE_CELLS, y];
    if (y > 0 && y <= 2) pts[idx] = [pts[idx][0], 0];
    else if (y < TILE_CELLS && y >= TILE_CELLS - 2) pts[idx] = [pts[idx][0], TILE_CELLS];
  }
}

/** Rasteriza los rasgos `ground` de un tile al grid de terreno para que las
 *  COSTURAS entre tiles funcionen: computeTileEdges lee los cruces del grid, y
 *  `ground` es la ÚNICA vía declarativa del suelo. path→"_" (camino, auto-snap
 *  al borde), water→"w" (río, bloquea), deck→"b" (puente transitable, perfora
 *  el agua). `area` no se rasteriza: no forma cruces y su render sale del
 *  greybox. Los rasgos inválidos los rechaza parseGround aguas arriba
 *  (pre-flight / scene-validate); aquí, si no parsean, se omiten sin tocar
 *  el grid. */
function rasterizeGroundToGrid(rawGround: unknown, grid: string[][]): void {
  const parsed = parseGround(rawGround);
  if (!parsed.ok) return;
  // water primero, deck después (el puente perfora el agua) — igual que
  // groundCollisionGrid.
  for (const f of parsed.features) {
    if (f.kind !== "path") continue;
    const pts = f.points.map((p) => [p[0], p[1]] as [number, number]);
    if (pts.length < 2) continue;
    snapPathEndpointsToEdges(pts);
    rasterizePath(grid, pts, f.w ?? 1);
  }
  for (const f of parsed.features) {
    if (f.kind !== "water") continue;
    for (let r = 0; r < TILE_CELLS; r++) for (let c = 0; c < TILE_CELLS; c++) {
      if (shapeContains(f, c + 0.5, r + 0.5)) grid[r][c] = GROUND_WATER_CHAR;
    }
  }
  for (const f of parsed.features) {
    if (f.kind !== "deck") continue;
    for (let r = 0; r < TILE_CELLS; r++) for (let c = 0; c < TILE_CELLS; c++) {
      if (shapeContains(f, c + 0.5, r + 0.5)) grid[r][c] = "b";
    }
  }
}

/** Prepara la BASE de un tile (Format D v3): fill del bioma 128×128 +
 *  terrain_patches + rasterización de los rasgos `ground` al grid. Devuelve
 *  una copia con `size`/`terrain` sintetizados lista para la expansión
 *  compartida (el decor con `attach`). Fail-loud en primitivas
 *  imposibles — mismo contrato que el resto del expander. */
function prepareTileBase(raw: Record<string, unknown>): Record<string, unknown> {
  const t = raw.tile as { tx?: unknown; ty?: unknown };
  if (!t || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) {
    throw new Error(`tile.tx/ty deben ser enteros, got ${JSON.stringify(raw.tile)}`);
  }
  if (raw.size !== undefined || (Array.isArray(raw.terrain) && raw.terrain.length > 0)) {
    throw new Error(
      "un tile no lleva size/terrain completos: la base es `biome` + primitivas (terrain_patches para parches puntuales)",
    );
  }
  const { char: biomeChar, name: biomeName } = resolveBiome(raw.biome);

  const grid: string[][] = [];
  for (let r = 0; r < TILE_CELLS; r++) grid.push(new Array<string>(TILE_CELLS).fill(biomeChar));

  // Parches ASCII rectangulares sobre el fill (detalles puntuales).
  const patches = Array.isArray(raw.terrain_patches) ? (raw.terrain_patches as Record<string, unknown>[]) : [];
  for (let pi = 0; pi < patches.length; pi++) {
    const p = patches[pi];
    const at = p?.at as [number, number] | undefined;
    const rows = p?.rows as string[] | undefined;
    if (!Array.isArray(at) || at.length !== 2 || !Number.isInteger(at[0]) || !Number.isInteger(at[1]) ||
        !Array.isArray(rows) || rows.length === 0 || !rows.every((row) => typeof row === "string" && row.length > 0)) {
      throw new Error(`terrain_patches[${pi}] debe ser { at: [col,row], rows: ["…"] }`);
    }
    const [c0, r0] = at;
    for (let r = 0; r < rows.length; r++) {
      if (r0 + r < 0 || r0 + r >= TILE_CELLS || c0 < 0 || c0 + rows[r].length > TILE_CELLS) {
        throw new Error(`terrain_patches[${pi}] se sale del tile (at [${c0},${r0}], fila ${r} de ${rows[r].length} chars)`);
      }
      for (let c = 0; c < rows[r].length; c++) grid[r0 + r][c0 + c] = rows[r][c];
    }
  }

  // Ground declarativo → grid (única vía de costuras; ver rasterizeGroundToGrid).
  rasterizeGroundToGrid(raw.ground, grid);

  // Leyenda: el char del bioma hereda su nombre de catálogo si la leyenda no
  // lo declara ya (p.ej. forest_floor → g:"suelo de bosque").
  const legend: Record<string, unknown> = { ...((raw.terrain_legend as Record<string, unknown>) ?? {}) };
  if (legend[biomeChar] === undefined && biomeName !== biomeChar) legend[biomeChar] = biomeName;

  return {
    ...raw,
    size: { cols: TILE_CELLS, rows: TILE_CELLS, meters_per_cell: TILE_MPC },
    terrain: grid.map((row) => row.join("")),
    terrain_legend: legend,
  };
}

/** Expande el decor-attach sobre una escena Format D cruda y devuelve una
 *  copia plana marcada `__expanded`. Escena sin primitivas (o ya expandida) →
 *  se devuelve tal cual. Un tile (Format D v3, campo `tile`) pasa primero por
 *  prepareTileBase (bioma + parches + raster). */
export function expandScenePrimitives(raw: Record<string, unknown>): Record<string, unknown> {
  if (!hasUnexpandedPrimitives(raw)) return raw;
  if (raw.tile !== undefined) raw = prepareTileBase(raw);

  const size = raw.size as { cols?: number; rows?: number } | undefined;
  const cols = size?.cols;
  const rows = size?.rows;
  if (typeof cols !== "number" || typeof rows !== "number" || !Array.isArray(raw.terrain)) {
    throw new Error("expandScenePrimitives: la escena no tiene size.cols/rows + terrain (Format D)");
  }

  const out: Record<string, unknown> = { ...raw };
  // Grid mutable normalizado a cols (pad con "g" — mismo criterio tolerante
  // que el saneador de ai_server, que puede no haber corrido en fixtures).
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = typeof (raw.terrain as unknown[])[r] === "string" ? ((raw.terrain as string[])[r]) : "";
    grid.push(row.padEnd(cols, "g").slice(0, cols).split(""));
  }
  const legend: Record<string, unknown> = { ...(raw.terrain_legend as Record<string, unknown> ?? {}) };
  const entities: Record<string, unknown>[] = Array.isArray(raw.entities)
    ? (raw.entities as Record<string, unknown>[]).map((e) => ({ ...e }))
    : [];

  // ── Decor attach:"wall" — snap a la celda de muro más cercana (radio 3) ───
  for (const e of entities) {
    if (e.attach !== "wall" || e.kind !== "decor") continue;
    const cell = e.cell as [number, number] | undefined;
    if (!Array.isArray(cell)) continue;
    const [ec, er] = cell;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let r = Math.max(0, er - 3); r <= Math.min(rows - 1, er + 3); r++) {
      for (let c = Math.max(0, ec - 3); c <= Math.min(cols - 1, ec + 3); c++) {
        if (grid[r][c] !== WALL_CHAR) continue;
        const d = Math.abs(c - ec) + Math.abs(r - er);
        if (d < bestD) {
          bestD = d;
          best = [c, r];
        }
      }
    }
    if (best) e.cell = best;
  }

  out.terrain = grid.map((row) => row.join(""));
  out.terrain_legend = legend;
  out.entities = entities;
  out.__expanded = true;
  return out;
}
