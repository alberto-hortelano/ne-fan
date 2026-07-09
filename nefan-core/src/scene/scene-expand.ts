/** Expansión determinista de primitivas de escena (Format D v2).
 *
 *  El motor narrativo puede describir la escena con primitivas de alto nivel
 *  en vez de dibujar el ASCII a mano:
 *   - `structures`: habitaciones/edificios enterables — el código estampa el
 *     perímetro de muro CERRADO, el suelo interior y los huecos de puerta.
 *     Garantía por construcción: no hay muros con fugas ni salas selladas por
 *     un typo en una fila de 28 chars.
 *   - `vegetation_zones`: scatter de árboles con seed determinista derivada de
 *     `scene_id` (mismo mapa en cada expansión; sin Math.random).
 *   - `decor` con `attach: "wall"`: se pega a la celda de muro más cercana.
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

import { SeededRng } from "../combat/enemy-ai.js";
import { TILE_CELLS, TILE_MPC, resolveBiome } from "./tile.js";
import type { Edge } from "../world-map/types.js";

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

interface VegetationZone {
  type: string;
  /** Rect [col,row,w,h] o "rest" (solo tiles): todo lo que siga siendo el
   *  char del bioma — excluye automáticamente caminos rasterizados, agua,
   *  parches, estructuras y celdas ocupadas. */
  area: Rect | "rest";
  /** Fracción de celdas candidatas plantadas (0..1]. */
  density: number;
  glyph?: string;
}

/** Hash FNV-1a de 32 bits — determinista y sin dependencias de node:crypto
 *  (este módulo también corre en el navegador vía formatDToWorld). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "veg";
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
  // haya structures ni vegetación).
  if (raw.tile !== undefined) return true;
  const hasStructures = Array.isArray(raw.structures) && raw.structures.length > 0;
  const hasVegetation = Array.isArray(raw.vegetation_zones) && (raw.vegetation_zones as unknown[]).length > 0;
  const hasWallDecor = Array.isArray(raw.entities) &&
    (raw.entities as Record<string, unknown>[]).some((e) => e && e.attach === "wall");
  return hasStructures || hasVegetation || hasWallDecor;
}

/** Char al que rasteriza cada tipo de feature en un tile. Tipos fuera de la
 *  tabla quedan visual-only (como todas las features en escenas legacy). */
const FEATURE_RASTER_CHAR: Record<string, string> = {
  river: "w",
  water: "w",
  bridge: "b",
  path: "_",
  dirt: "_",
  road: "s",
  stone: "s",
  paved: "s",
};

/** Punto de celda EXACTO del borde `edge` en la coordenada `at` (para el snap
 *  de endpoints de features declarados con at_edges). */
function edgePoint(edge: Edge, at: number): [number, number] {
  switch (edge) {
    case "west": return [0, at + 0.5];
    case "east": return [TILE_CELLS, at + 0.5];
    case "north": return [at + 0.5, 0];
    case "south": return [at + 0.5, TILE_CELLS];
  }
}

/** Pinta una polyline gruesa sobre el grid mutable: celda pintada si la
 *  distancia de su centro al segmento ≤ width/2. Orden del array = orden de
 *  pintado (río antes que puente, igual que el render visual). */
function rasterizeFeature(grid: string[][], points: [number, number][], width: number, char: string): void {
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
        if (d2 <= radius * radius) grid[r][c] = char;
      }
    }
  }
}

/** Prepara la BASE de un tile (Format D v3): fill del bioma 128×128 +
 *  terrain_patches + snap de endpoints a at_edges + rasterización de features
 *  al grid. Devuelve una copia con `size`/`terrain` sintetizados lista para la
 *  expansión compartida (structures/vegetación/decor). Fail-loud en primitivas
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

  // Features: snap de endpoints a los bordes declarados + rasterización.
  const feats = Array.isArray(raw.terrain_features) ? (raw.terrain_features as Record<string, unknown>[]) : [];
  const preparedFeats: Record<string, unknown>[] = [];
  for (let fi = 0; fi < feats.length; fi++) {
    const f = { ...feats[fi] };
    const pts = (Array.isArray(f.points) ? (f.points as [number, number][]) : []).map((p) => [p[0], p[1]] as [number, number]);
    if (pts.length < 2) {
      throw new Error(`terrain_features[${fi}] necesita ≥2 points`);
    }
    const atEdges = Array.isArray(f.at_edges) ? (f.at_edges as { edge: Edge; at: number }[]) : [];
    for (const ae of atEdges) {
      if (!["north", "south", "east", "west"].includes(ae.edge) || !Number.isInteger(ae.at) || ae.at < 0 || ae.at >= TILE_CELLS) {
        throw new Error(`terrain_features[${fi}].at_edges: { edge, at 0..${TILE_CELLS - 1} } inválido: ${JSON.stringify(ae)}`);
      }
      // El endpoint más cercano a ese borde se fuerza EXACTAMENTE a la celda
      // declarada — la costura con el vecino depende de esto.
      const target = edgePoint(ae.edge, ae.at);
      const distToEdge = (p: [number, number]): number => {
        switch (ae.edge) {
          case "west": return p[0];
          case "east": return TILE_CELLS - p[0];
          case "north": return p[1];
          case "south": return TILE_CELLS - p[1];
        }
      };
      const endIdx = distToEdge(pts[0]) <= distToEdge(pts[pts.length - 1]) ? 0 : pts.length - 1;
      pts[endIdx] = target;
    }
    // Auto-snap: un endpoint a ≤2 celdas de un borde se pega a él (conserva la
    // otra coordenada) — evita caminos que "casi" llegan a la costura.
    for (const idx of [0, pts.length - 1]) {
      const [x, y] = pts[idx];
      if (x > 0 && x <= 2) pts[idx] = [0, y];
      else if (x < TILE_CELLS && x >= TILE_CELLS - 2) pts[idx] = [TILE_CELLS, y];
      if (y > 0 && y <= 2) pts[idx] = [pts[idx][0], 0];
      else if (y < TILE_CELLS && y >= TILE_CELLS - 2) pts[idx] = [pts[idx][0], TILE_CELLS];
    }
    f.points = pts;
    preparedFeats.push(f);
    const rasterChar = typeof f.type === "string" ? FEATURE_RASTER_CHAR[f.type] : undefined;
    if (rasterChar) {
      const width = typeof f.width === "number" && f.width > 0 ? f.width : 1;
      rasterizeFeature(grid, pts, width, rasterChar);
    }
  }

  // Leyenda: el char del bioma hereda su nombre de catálogo si la leyenda no
  // lo declara ya (p.ej. forest_floor → g:"suelo de bosque").
  const legend: Record<string, unknown> = { ...((raw.terrain_legend as Record<string, unknown>) ?? {}) };
  if (legend[biomeChar] === undefined && biomeName !== biomeChar) legend[biomeChar] = biomeName;

  return {
    ...raw,
    size: { cols: TILE_CELLS, rows: TILE_CELLS, meters_per_cell: TILE_MPC },
    terrain: grid.map((row) => row.join("")),
    terrain_legend: legend,
    terrain_features: preparedFeats,
  };
}

/** Expande structures/vegetation_zones/decor-attach sobre una escena Format D
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
  const roomRects: Rect[] = [];
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
    roomRects.push([c0, r0, w, h]);

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

  // ── Celdas ocupadas (para que el scatter no pise nada) ────────────────────
  const occupied = new Set<number>();
  const key = (c: number, r: number) => r * cols + c;
  for (const rect of roomRects) {
    for (let r = rect[1]; r < rect[1] + rect[3]; r++) {
      for (let c = rect[0]; c < rect[0] + rect[2]; c++) occupied.add(key(c, r));
    }
  }
  for (const e of entities) {
    const cell = e.cell as [number, number] | undefined;
    const fp = (e.footprint as [number, number] | undefined) ?? [1, 1];
    if (!Array.isArray(cell)) continue;
    // Player y NPCs se mueven: margen de 1 celda alrededor para que un árbol
    // adyacente no los deje atrapados (con mpc 0.5, el AABB inflado del
    // jugador ya solapa la celda vecina).
    const margin = e.kind === "player" || e.kind === "npc" ? 1 : 0;
    for (let r = cell[1] - margin; r < cell[1] + (fp[1] ?? 1) + margin; r++) {
      for (let c = cell[0] - margin; c < cell[0] + (fp[0] ?? 1) + margin; c++) occupied.add(key(c, r));
    }
  }
  // Delante de cada puerta no se planta (aproximación: celda "_" y sus vecinas).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== "_") continue;
      for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) occupied.add(key(cc, rr));
      }
    }
  }

  // ── Vegetation zones: scatter determinista (seed = scene_id + índice) ─────
  const usedIds = new Set(entities.map((e) => String(e.id)));
  const zones = Array.isArray(raw.vegetation_zones) ? (raw.vegetation_zones as VegetationZone[]) : [];
  // En tiles el scatter respeta el bioma y deja 1 celda de margen alrededor de
  // los caminos/carreteras rasterizados (que los árboles no invadan la senda).
  const biomeChar = raw.tile !== undefined ? resolveBiome(raw.biome).char : null;
  let nearPath: Set<number> | null = null;
  if (biomeChar !== null && zones.length > 0) {
    nearPath = new Set<number>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = grid[r][c];
        if (ch !== "_" && ch !== "s" && ch !== "b") continue;
        for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const cc = c + dc, rr = r + dr;
          if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) nearPath.add(key(cc, rr));
        }
      }
    }
  }
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    if (!z || typeof z !== "object" || typeof z.type !== "string" || !z.type) {
      throw new Error(`vegetation_zones[${zi}] necesita un type (nombre de la planta)`);
    }
    if (z.area === "rest" && biomeChar === null) {
      throw new Error(`vegetation_zones[${zi}]: area:"rest" solo está disponible en tiles (Format D v3)`);
    }
    const [c0, r0, w, h] = z.area === "rest"
      ? [0, 0, cols, rows] as Rect
      : asRect(z.area, `vegetation_zones[${zi}]`);
    if (c0 < 0 || r0 < 0 || c0 + w > cols || r0 + h > rows) {
      throw new Error(`vegetation_zones[${zi}]: area [${c0},${r0},${w},${h}] se sale del grid ${cols}x${rows}`);
    }
    const density = typeof z.density === "number" ? z.density : NaN;
    if (!(density > 0 && density <= 1)) {
      throw new Error(`vegetation_zones[${zi}]: density=${z.density} debe estar en (0, 1]`);
    }

    const candidates: [number, number][] = [];
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        const ch = grid[r][c];
        if (wallChars.has(ch) || ch === "w") continue; // ni muros ni agua
        // En tiles solo se planta sobre el propio bioma (excluye caminos,
        // parches, suelos interiores…), con margen alrededor de sendas.
        if (biomeChar !== null && ch !== biomeChar) continue;
        if (nearPath?.has(key(c, r))) continue;
        if (occupied.has(key(c, r))) continue;
        candidates.push([c, r]);
      }
    }
    const count = Math.min(candidates.length, Math.round(candidates.length * density));
    const rng = new SeededRng(fnv1a(`${raw.scene_id ?? ""}:veg:${zi}`));
    // Fisher-Yates parcial: basta con los primeros `count` de la permutación.
    for (let i = 0; i < count; i++) {
      const j = i + rng.nextInt(candidates.length - i);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      const [c, r] = candidates[i];
      occupied.add(key(c, r));
      const base = `${slug(z.type)}_z${zi}`;
      let id = `${base}_${i}`;
      let n = i;
      while (usedIds.has(id)) id = `${base}_${++n}`;
      usedIds.add(id);
      entities.push({
        id,
        kind: "tree",
        name: z.type,
        cell: [c, r],
        footprint: [1, 1],
        glyph: typeof z.glyph === "string" && z.glyph.length === 1 ? z.glyph : "T",
        // Marca de scatter: el compositor de blueprints NO deriva volumen de
        // estas (la vegetación visual sale de vegetation_zones con su propio
        // scatter ralo — un árbol del blueprint son ~10 celdas de copa, no 1;
        // derivar cientos de trees del grid colgaba el cliente).
        scattered: true,
      });
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
