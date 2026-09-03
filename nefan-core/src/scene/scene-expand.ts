/** Expansión determinista de un tile Format D.
 *
 *  El motor declara `biome` + `ground`/`volumes`; aquí se SINTETIZA el grid
 *  de terreno que el motor nunca escribe —fill del bioma 128×128 más los
 *  rasgos de `ground` rasterizados—, que viaja solo para la colisión de
 *  celdas y las costuras entre tiles. Es la ÚNICA expansión: la del decor
 *  pegado al muro se retiró (#399) porque buscaba un char de muro que ningún
 *  productor escribía desde que los muros son `volumes`.
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

/** ¿Tiene la escena primitivas pendientes de expandir? Un tile sin la marca
 *  SIEMPRE: el fill del bioma es obligatorio aunque no traiga ninguna otra
 *  primitiva. Una escena sin `tile` no tiene nada que expandir. */
export function hasUnexpandedPrimitives(raw: Record<string, unknown>): boolean {
  return raw.__expanded !== true && raw.tile !== undefined;
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

/** Prepara la BASE de un tile: fill del bioma 128×128 + rasterización de los
 *  rasgos `ground` al grid. Devuelve una copia con `size`/`terrain`
 *  sintetizados. Fail-loud en coords rotas o en un tile que traiga el grid
 *  escrito. */
function prepareTileBase(raw: Record<string, unknown>): Record<string, unknown> {
  const t = raw.tile as { tx?: unknown; ty?: unknown };
  if (!t || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) {
    throw new Error(`tile.tx/ty deben ser enteros, got ${JSON.stringify(raw.tile)}`);
  }
  if (raw.size !== undefined || (Array.isArray(raw.terrain) && raw.terrain.length > 0)) {
    throw new Error("un tile no lleva size/terrain: la base es `biome` + `ground`/`volumes`");
  }
  const biomeChar = resolveBiome(raw.biome);

  const grid: string[][] = [];
  for (let r = 0; r < TILE_CELLS; r++) grid.push(new Array<string>(TILE_CELLS).fill(biomeChar));

  // Ground declarativo → grid (única vía de costuras; ver rasterizeGroundToGrid).
  rasterizeGroundToGrid(raw.ground, grid);

  return {
    ...raw,
    size: { cols: TILE_CELLS, rows: TILE_CELLS, meters_per_cell: TILE_MPC },
    terrain: grid.map((row) => row.join("")),
  };
}

/** Expande un tile Format D crudo y devuelve una copia plana marcada
 *  `__expanded`. Escena sin `tile` (o ya expandida) → se devuelve tal cual. */
export function expandScenePrimitives(raw: Record<string, unknown>): Record<string, unknown> {
  if (!hasUnexpandedPrimitives(raw)) return raw;
  return { ...prepareTileBase(raw), __expanded: true };
}
