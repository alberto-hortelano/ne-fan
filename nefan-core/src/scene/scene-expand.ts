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
  area: Rect;
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
  const hasStructures = Array.isArray(raw.structures) && raw.structures.length > 0;
  const hasVegetation = Array.isArray(raw.vegetation_zones) && (raw.vegetation_zones as unknown[]).length > 0;
  const hasWallDecor = Array.isArray(raw.entities) &&
    (raw.entities as Record<string, unknown>[]).some((e) => e && e.attach === "wall");
  return hasStructures || hasVegetation || hasWallDecor;
}

/** Expande structures/vegetation_zones/decor-attach sobre una escena Format D
 *  cruda y devuelve una copia plana marcada `__expanded`. Escena sin
 *  primitivas (o ya expandida) → se devuelve tal cual. */
export function expandScenePrimitives(raw: Record<string, unknown>): Record<string, unknown> {
  if (!hasUnexpandedPrimitives(raw)) return raw;

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
  const structures = Array.isArray(raw.structures) ? (raw.structures as Record<string, unknown>[]) : [];
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

    // Puertas: huecos transitables en el perímetro.
    const doors = Array.isArray(s.doors) ? (s.doors as RoomDoor[]) : [];
    for (let di = 0; di < doors.length; di++) {
      const d = doors[di];
      const dw = Math.max(1, d.width ?? 1);
      const dchar = typeof d.char === "string" && d.char.length === 1 ? d.char : "_";
      const along = d.side === "north" || d.side === "south" ? w : h;
      if (!["north", "south", "east", "west"].includes(d.side)) {
        throw new Error(`structures[${si}].doors[${di}]: side="${d.side}" inválido`);
      }
      if (!Number.isInteger(d.at) || d.at < 1 || d.at + dw > along - 1) {
        throw new Error(
          `structures[${si}].doors[${di}]: at=${d.at} width=${dw} no cabe en el lado ${d.side} (1..${along - 2}, las esquinas no pueden ser puerta)`,
        );
      }
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
    for (let r = cell[1]; r < cell[1] + (fp[1] ?? 1); r++) {
      for (let c = cell[0]; c < cell[0] + (fp[0] ?? 1); c++) occupied.add(key(c, r));
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
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    if (!z || typeof z !== "object" || typeof z.type !== "string" || !z.type) {
      throw new Error(`vegetation_zones[${zi}] necesita un type (nombre de la planta)`);
    }
    const [c0, r0, w, h] = asRect(z.area, `vegetation_zones[${zi}]`);
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
