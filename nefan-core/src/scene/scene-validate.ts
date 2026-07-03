/** Validador de jugabilidad de escenas Format D — lógica pura compartida.
 *
 *  Comprueba lo que el expander no puede garantizar por construcción: que el
 *  mapa que entrega el motor narrativo se puede JUGAR. La regla de oro es la
 *  inversa del bug de la taberna original (sin muros se salía por todas
 *  partes): con muros sólidos hay que garantizar que se puede salir por
 *  ALGUNA parte — puerta alcanzable y borde de mapa alcanzable con flood-fill
 *  desde el spawn del jugador.
 *
 *  Se ejecuta en el pre-flight de `narrative_respond` (vía
 *  `POST /scene/validate` del state API): si falla, el motor recibe los
 *  errores y re-responde sobre el mismo request. Errores = mapa injugable;
 *  warnings = sospechoso pero jugable. */

import { expandScenePrimitives, hasUnexpandedPrimitives } from "./scene-expand.js";
import { resolveTerrainLegend } from "./scene-normalize.js";

export interface SceneValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    cols: number;
    rows: number;
    walkable_cells: number;
    reachable_cells: number;
    border_reachable: boolean;
    doors_total: number;
    doors_reachable: number;
    npcs_total: number;
    npcs_reachable: number;
  };
}

/** Info del world map que necesita la regla de contexto exterior. La aporta el
 *  state API (que tiene el WorldMapManager); el validador queda puro. */
export interface PlaceContext {
  exists: boolean;
  kind?: string;
  outgoing_links: number;
}

/** Chars reservados siempre legales sin declarar (espejo de RESERVED_TERRAIN
 *  en ai_server/narrative_schemas.py). */
const RESERVED_CHARS = new Set(["g", "w", "_", "s", "b", "d", "a", "o", "W"]);

const emptyStats = (cols = 0, rows = 0): SceneValidationResult["stats"] => ({
  cols,
  rows,
  walkable_cells: 0,
  reachable_cells: 0,
  border_reachable: false,
  doors_total: 0,
  doors_reachable: 0,
  npcs_total: 0,
  npcs_reachable: 0,
});

export function validateScene(
  rawScene: Record<string, unknown>,
  placeContext?: (placeId: string) => PlaceContext | null,
): SceneValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Forma Format D — sobre la escena CRUDA, antes de expandir (el expander
  // normaliza filas con padding y taparía un rows/cols mal contado) ──────────
  const size = rawScene.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  const cols = size?.cols;
  const rows = size?.rows;
  const rawTerrain = rawScene.terrain;
  if (
    typeof cols !== "number" || typeof rows !== "number" ||
    !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 3 || rows < 3 ||
    !Array.isArray(rawTerrain)
  ) {
    return {
      ok: false,
      errors: ["la escena no es Format D: falta size.cols/rows enteros (≥3) o terrain[]"],
      warnings,
      stats: emptyStats(),
    };
  }
  if (rawTerrain.length !== rows) {
    errors.push(`terrain tiene ${rawTerrain.length} filas, size.rows dice ${rows}`);
  }
  for (let r = 0; r < Math.min(rows, rawTerrain.length); r++) {
    const row = rawTerrain[r];
    if (typeof row !== "string") {
      errors.push(`terrain[${r}] no es string`);
    } else if (row.length !== cols) {
      errors.push(`terrain[${r}] tiene ${row.length} chars, size.cols dice ${cols}`);
    }
  }

  // ── Expansión de primitivas (sus fail-loud se vuelven errores legibles) ───
  let scene = rawScene;
  if (hasUnexpandedPrimitives(rawScene)) {
    try {
      scene = expandScenePrimitives(rawScene);
    } catch (err) {
      errors.push((err as Error).message);
      return { ok: false, errors, warnings, stats: emptyStats(cols, rows) };
    }
  }

  // Grid de trabajo desde la escena expandida, normalizado a cols×rows.
  const terrain = scene.terrain as unknown[];
  const grid: string[] = [];
  for (let r = 0; r < Math.min(rows, terrain.length); r++) {
    const row = terrain[r];
    grid.push(typeof row === "string" ? row.padEnd(cols, "g").slice(0, cols) : "g".repeat(cols));
  }
  while (grid.length < rows) grid.push("g".repeat(cols));

  // ── Chars declarados + solidez ────────────────────────────────────────────
  const { legend, solidChars } = resolveTerrainLegend(scene.terrain_legend);
  const solid = new Set(solidChars);
  const undeclared = new Set<string>();
  for (const row of grid) {
    for (const ch of row) {
      if (!RESERVED_CHARS.has(ch) && legend[ch] === undefined) undeclared.add(ch);
    }
  }
  if (undeclared.size > 0) {
    errors.push(`chars de terreno sin declarar en terrain_legend: ${[...undeclared].map((c) => `"${c}"`).join(", ")}`);
  }

  // ── Máscara walkable: terreno no sólido − footprints que bloquean ─────────
  const walkable: boolean[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) walkable[r * cols + c] = !solid.has(grid[r][c]);
  }
  const entities = Array.isArray(scene.entities) ? (scene.entities as Record<string, unknown>[]) : [];
  const blockingKinds = new Set(["building", "prop", "tree"]);
  let player: [number, number] | null = null;
  const npcs: { id: string; cell: [number, number] }[] = [];
  for (const e of entities) {
    if (!e || !Array.isArray(e.cell)) continue;
    const [c, r] = e.cell as [number, number];
    if (e.kind === "player") {
      player = [c, r];
      continue;
    }
    if (e.kind === "npc") {
      npcs.push({ id: String(e.id), cell: [c, r] });
      continue;
    }
    if (!blockingKinds.has(String(e.kind))) continue;
    const fp = (Array.isArray(e.footprint) ? e.footprint : [1, 1]) as [number, number];
    for (let rr = r; rr < r + (fp[1] ?? 1); rr++) {
      for (let cc = c; cc < c + (fp[0] ?? 1); cc++) {
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) walkable[rr * cols + cc] = false;
      }
    }
  }
  const walkableCells = walkable.filter(Boolean).length;

  const stats = emptyStats(cols, rows);
  stats.walkable_cells = walkableCells;
  stats.npcs_total = npcs.length;

  // ── Spawn del jugador ─────────────────────────────────────────────────────
  if (!player) {
    errors.push('falta la entity kind "player" (spawn del jugador)');
  } else if (player[0] < 0 || player[1] < 0 || player[0] >= cols || player[1] >= rows) {
    errors.push(`el player está fuera del grid: [${player[0]}, ${player[1]}]`);
    player = null;
  } else if (!walkable[player[1] * cols + player[0]]) {
    errors.push(
      `el spawn del player [${player[0]}, ${player[1]}] no es transitable (celda "${grid[player[1]][player[0]]}" u ocupada por un footprint)`,
    );
    player = null;
  }

  // ── Flood-fill de alcanzabilidad desde el jugador ─────────────────────────
  // Puertas: celdas de hueco de las structures (si las hay).
  const doorCells: [number, number][] = [];
  const structures = Array.isArray(scene.structures) ? (scene.structures as Record<string, unknown>[]) : [];
  for (const s of structures) {
    const rect = s.rect as [number, number, number, number] | undefined;
    const doors = Array.isArray(s.doors) ? (s.doors as { side: string; at: number; width?: number }[]) : [];
    if (!Array.isArray(rect)) continue;
    const [c0, r0, w, h] = rect;
    for (const d of doors) {
      const dw = Math.max(1, d.width ?? 1);
      for (let k = 0; k < dw; k++) {
        if (d.side === "north") doorCells.push([c0 + d.at + k, r0]);
        else if (d.side === "south") doorCells.push([c0 + d.at + k, r0 + h - 1]);
        else if (d.side === "west") doorCells.push([c0, r0 + d.at + k]);
        else if (d.side === "east") doorCells.push([c0 + w - 1, r0 + d.at + k]);
      }
    }
  }
  stats.doors_total = doorCells.length;

  if (player) {
    const reachable = new Uint8Array(cols * rows);
    const queue: number[] = [player[1] * cols + player[0]];
    reachable[queue[0]] = 1;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const c = idx % cols;
      const r = (idx - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const nidx = rr * cols + cc;
        if (reachable[nidx] || !walkable[nidx]) continue;
        reachable[nidx] = 1;
        queue.push(nidx);
      }
    }
    stats.reachable_cells = queue.length;

    // ¿Se puede salir del mapa? (alguna celda del borde alcanzable)
    let borderReachable = false;
    for (let c = 0; c < cols && !borderReachable; c++) {
      if (reachable[c] || reachable[(rows - 1) * cols + c]) borderReachable = true;
    }
    for (let r = 0; r < rows && !borderReachable; r++) {
      if (reachable[r * cols] || reachable[r * cols + cols - 1]) borderReachable = true;
    }
    stats.border_reachable = borderReachable;
    if (!borderReachable) {
      errors.push(
        "ninguna celda del borde del mapa es alcanzable desde el player: no se puede salir de la zona (mundo abierto = siempre hay continuación)",
      );
    }

    // Puertas alcanzables (la celda del hueco es walkable, así que basta con
    // que el flood la toque).
    let doorsReachable = 0;
    for (const [dc, dr] of doorCells) {
      if (dc >= 0 && dr >= 0 && dc < cols && dr < rows && reachable[dr * cols + dc]) doorsReachable++;
    }
    stats.doors_reachable = doorsReachable;
    if (doorCells.length > 0 && doorsReachable === 0) {
      errors.push("ninguna puerta de las structures es alcanzable desde el player");
    } else if (doorsReachable < doorCells.length) {
      warnings.push(`${doorCells.length - doorsReachable} celda(s) de puerta no alcanzables desde el player`);
    }

    // NPCs alcanzables: su celda o una adyacente.
    let npcsReachable = 0;
    for (const npc of npcs) {
      const [c, r] = npc.cell;
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => {
        const cc = c + dc;
        const rr = r + dr;
        return cc >= 0 && rr >= 0 && cc < cols && rr < rows && reachable[rr * cols + cc];
      });
      if (near) npcsReachable++;
      else warnings.push(`el NPC "${npc.id}" en [${c}, ${r}] no es alcanzable desde el player`);
    }
    stats.npcs_reachable = npcsReachable;

    // Proporción jugable del mapa.
    const walkableRatio = walkableCells / (cols * rows);
    if (walkableRatio < 0.2) {
      warnings.push(`solo el ${Math.round(walkableRatio * 100)}% del mapa es transitable — ¿demasiado muro/agua?`);
    }
  }

  // ── Contexto exterior en el world map ─────────────────────────────────────
  const placeId = typeof scene.place_id === "string" ? scene.place_id : null;
  if (placeId && placeContext) {
    const info = placeContext(placeId);
    if (!info || !info.exists) {
      errors.push(
        `place_id "${placeId}" no existe en el world map — llama a map_upsert_place (y map_link a su exterior) antes de re-responder`,
      );
    } else if (info.outgoing_links === 0) {
      errors.push(
        `el place "${placeId}" no tiene ningún link saliente en el world map: al salir de la escena no hay a dónde ir — llama a map_link para conectarlo (door/path a su exterior o vecino) antes de re-responder`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}
