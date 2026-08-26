/** Expansión determinista de primitivas de escena (Format D v2).
 *
 *  El motor narrativo puede describir la escena con primitivas de alto nivel
 *  en vez de dibujar el ASCII a mano:
 *   - `structures`: habitaciones/edificios enterables — el código estampa el
 *     perímetro de muro CERRADO, el suelo interior y los huecos de puerta.
 *     Garantía por construcción: no hay muros con fugas ni salas selladas por
 *     un typo en una fila de 28 chars.
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

type Rect = [number, number, number, number]; // [col, row, w, h]

interface RoomDoor {
  side: "north" | "south" | "east" | "west";
  /** Celdas desde la esquina superior/izquierda del rect a lo largo del lado. */
  at: number;
  width?: number;
  /** Char del hueco (default "_", umbral transitable). */
  char?: string;
}

interface RoomStructure {
  type: "room";
  rect: Rect;
  wall_char?: string;
  floor_char?: string;
  doors?: RoomDoor[];
}

function asRect(raw: unknown, ctx: string): Rect {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === "number" && Number.isInteger(n))) {
    throw new Error(`${ctx}: rect/area debe ser [col,row,w,h] de enteros, got ${JSON.stringify(raw)}`);
  }
  return raw as Rect;
}

/** ¿Tiene la escena primitivas pendientes de expandir? */
export function hasUnexpandedPrimitives(raw: Record<string, unknown>): boolean {
  if (raw.__expanded === true) return false;
  // Un tile SIEMPRE se expande (el fill del bioma es obligatorio aunque no
  // haya structures).
  if (raw.tile !== undefined) return true;
  const hasStructures = Array.isArray(raw.structures) && raw.structures.length > 0;
  const hasWallDecor = Array.isArray(raw.entities) &&
    (raw.entities as Record<string, unknown>[]).some((e) => e && e.attach === "wall");
  return hasStructures || hasWallDecor;
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
 *  compartida (structures/decor). Fail-loud en primitivas
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

/** Expande structures/decor-attach sobre una escena Format D
 *  cruda y devuelve una copia plana marcada `__expanded`. Escena sin
 *  primitivas (o ya expandida) → se devuelve tal cual. Un tile (Format D v3,
 *  campo `tile`) pasa primero por prepareTileBase (bioma + parches + raster). */
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

  // ── Structures: muros cerrados + suelo + puertas, por construcción ────────
  const wallChars = new Set<string>(["W"]);
  const structures = Array.isArray(raw.structures)
    ? (raw.structures as (Partial<RoomStructure> & Record<string, unknown>)[])
    : [];
  for (let si = 0; si < structures.length; si++) {
    const s = structures[si];
    if (!s || typeof s !== "object") throw new Error(`structures[${si}] no es un objeto`);
    if (s.type !== "room") throw new Error(`structures[${si}].type="${s.type}" desconocido (solo "room")`);
    const [c0, r0, w, h] = asRect(s.rect, `structures[${si}]`);
    if (w < 3 || h < 3) throw new Error(`structures[${si}]: rect ${w}x${h} demasiado pequeño (mínimo 3x3 para tener interior)`);
    if (c0 < 0 || r0 < 0 || c0 + w > cols || r0 + h > rows) {
      throw new Error(`structures[${si}]: rect [${c0},${r0},${w},${h}] se sale del grid ${cols}x${rows}`);
    }
    const wallChar = typeof s.wall_char === "string" && s.wall_char.length === 1 ? s.wall_char : "W";
    const floorChar = typeof s.floor_char === "string" && s.floor_char.length === 1 ? s.floor_char : "o";
    wallChars.add(wallChar);

    // Perímetro de muro + interior de suelo.
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        const isEdge = r === r0 || r === r0 + h - 1 || c === c0 || c === c0 + w - 1;
        grid[r][c] = isEdge ? wallChar : floorChar;
      }
    }

    // Puertas: huecos transitables en el perímetro. Anchura mínima por
    // construcción: el jugador (~0.8 m de diámetro) necesita ≥1.1 m de hueco
    // para pasar sin alinearse al píxel — una puerta más estrecha se
    // auto-ensancha (a mpc 0.5 eso son 3 celdas; a mpc 2 basta 1).
    const mpc = (raw.size as { meters_per_cell?: number }).meters_per_cell ?? 2;
    const minDoorCells = Math.max(1, Math.ceil(1.1 / mpc));
    const doors = Array.isArray(s.doors) ? (s.doors as RoomDoor[]) : [];
    for (let di = 0; di < doors.length; di++) {
      const d = doors[di];
      const dw = Math.max(Math.max(1, d.width ?? 1), minDoorCells);
      const dchar = typeof d.char === "string" && d.char.length === 1 ? d.char : "_";
      const along = d.side === "north" || d.side === "south" ? w : h;
      if (!["north", "south", "east", "west"].includes(d.side)) {
        throw new Error(`structures[${si}].doors[${di}]: side="${d.side}" inválido`);
      }
      if (!Number.isInteger(d.at) || d.at < 1 || d.at + Math.max(1, d.width ?? 1) > along - 1) {
        throw new Error(
          `structures[${si}].doors[${di}]: at=${d.at} width=${d.width ?? 1} no cabe en el lado ${d.side} (1..${along - 2}, las esquinas no pueden ser puerta)`,
        );
      }
      // Si el ensanchado se sale del lado, se desplaza hacia dentro.
      const at = Math.max(1, Math.min(d.at, along - 1 - dw));
      if (at + dw > along - 1) {
        throw new Error(
          `structures[${si}].doors[${di}]: el lado ${d.side} (${along} celdas) es demasiado corto para una puerta transitable de ${dw} celdas`,
        );
      }
      d.at = at;
      d.width = dw;
      for (let k = 0; k < dw; k++) {
        if (d.side === "north") grid[r0][c0 + d.at + k] = dchar;
        else if (d.side === "south") grid[r0 + h - 1][c0 + d.at + k] = dchar;
        else if (d.side === "west") grid[r0 + d.at + k][c0] = dchar;
        else grid[r0 + d.at + k][c0 + w - 1] = dchar;
      }
    }
    // El char de muro queda declarado sólido si la leyenda no lo hace ya.
    const entry = legend[wallChar];
    if (entry === undefined) {
      legend[wallChar] = { name: "muro", solid: true };
    } else if (typeof entry === "string") {
      legend[wallChar] = { name: entry, solid: true };
    } else if (entry && typeof entry === "object" && (entry as { solid?: unknown }).solid === undefined) {
      legend[wallChar] = { ...(entry as object), solid: true };
    }
  }

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
        if (!wallChars.has(grid[r][c])) continue;
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
