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
import { parseGround } from "./blueprint/ground.js";
import { shapeContains } from "./blueprint/ground-collision.js";
import { resolveTerrainLegend } from "./scene-normalize.js";
import { parseStage, type StageBlock } from "./stage/schema.js";
import { COMPATIBLE, computeTileEdges, matchCrossings, type EdgeCrossing } from "./tile-edges.js";
import { TILE_CELLS } from "./tile.js";
import type { Edge } from "../world-map/types.js";

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
  /** Links salientes con destino (y edge si lo declara). Lo necesitan las
   *  escenas proscenio: cada link debe tener su salida física y viceversa. */
  links?: Array<{ to: string; edge?: Edge }>;
}

/** Contexto de validación de un TILE: qué cruces de los vecinos existentes
 *  debe continuar, por dónde entra el jugador, y si es el tile de bootstrap
 *  (el único que lleva entity player). Lo construye el state API desde los
 *  `edges` de los vecinos en scenes_loaded — el validador queda puro. */
export interface TileValidationContext {
  required_crossings: Array<{ edge: Edge } & EdgeCrossing>;
  entry?: { edge: Edge; at?: number };
  bootstrap?: boolean;
}

/** Celda del grid sobre la línea del borde `edge` en la coordenada `at`. */
function edgeCell(edge: Edge, at: number): [number, number] {
  switch (edge) {
    case "west": return [0, at];
    case "east": return [TILE_CELLS - 1, at];
    case "north": return [at, 0];
    case "south": return [at, TILE_CELLS - 1];
  }
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
  tileContext?: TileValidationContext,
): SceneValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isTile = rawScene.tile !== undefined;

  // ── Bloque stage (escena proscenio): parse temprano — sus reglas de zonas
  // y salidas se aplican más abajo, tras construir la máscara walkable ──────
  let stage: StageBlock | null = null;
  if (rawScene.stage !== undefined) {
    if (isTile) {
      errors.push(
        "una escena con bloque `stage` (proscenio) no puede ser un tile: los platós son escenas discretas por place",
      );
    } else {
      const parsedStage = parseStage(rawScene.stage);
      if (parsedStage.ok) stage = parsedStage.stage;
      else errors.push(parsedStage.error);
    }
  }

  let cols: number;
  let rows: number;
  if (isTile) {
    // Tile (Format D v3): la forma la garantiza el expander (bioma + 128×128
    // sintetizados); aquí solo las coords. size/terrain completos los rechaza
    // el propio expander con mensaje accionable.
    const t = rawScene.tile as { tx?: unknown; ty?: unknown };
    if (!t || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) {
      return {
        ok: false,
        errors: [`tile.tx/ty deben ser enteros, got ${JSON.stringify(rawScene.tile)}`],
        warnings,
        stats: emptyStats(),
      };
    }
    cols = TILE_CELLS;
    rows = TILE_CELLS;
  } else {
    // ── Forma Format D — sobre la escena CRUDA, antes de expandir (el expander
    // normaliza filas con padding y taparía un rows/cols mal contado) ────────
    const size = rawScene.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
    const rawTerrain = rawScene.terrain;
    if (
      typeof size?.cols !== "number" || typeof size?.rows !== "number" ||
      !Number.isInteger(size.cols) || !Number.isInteger(size.rows) || size.cols < 3 || size.rows < 3 ||
      !Array.isArray(rawTerrain)
    ) {
      return {
        ok: false,
        errors: ["la escena no es Format D: falta size.cols/rows enteros (≥3) o terrain[]"],
        warnings,
        stats: emptyStats(),
      };
    }
    cols = size.cols;
    rows = size.rows;
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
  // ── Agua declarada del `ground` (v8, platós): water∖deck resta walkable —
  // el flood-fill ve el río ANTES de runtime (una salida al otro lado sin
  // deck es error del motor aquí, no una sorpresa jugable). Solo escenas
  // no-tile: la validación del tile conserva su contrato actual. ────────────
  if (rawScene.tile === undefined && rawScene.ground !== undefined) {
    const parsedGround = parseGround(rawScene.ground);
    if (!parsedGround.ok) {
      errors.push(`ground inválido: ${parsedGround.error}`);
    } else {
      const waters = parsedGround.features.filter((f) => f.kind === "water");
      const decks = parsedGround.features.filter((f) => f.kind === "deck");
      for (let r = 0; waters.length > 0 && r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!walkable[r * cols + c]) continue;
          const u = c + 0.5;
          const v = r + 0.5;
          if (
            waters.some((w) => shapeContains(w, u, v)) &&
            !decks.some((d) => shapeContains(d, u, v))
          ) {
            walkable[r * cols + c] = false;
          }
        }
      }
    }
  }
  const walkableCells = walkable.filter(Boolean).length;
  const cellWalkable = ([c, r]: [number, number]): boolean =>
    c >= 0 && r >= 0 && c < cols && r < rows && walkable[r * cols + c];

  const stats = emptyStats(cols, rows);
  stats.walkable_cells = walkableCells;
  stats.npcs_total = npcs.length;

  // ── Salidas del plató: zona dentro del grid y con celdas transitables ─────
  const exitTargets: Array<{ id: string; label: string; cells: [number, number][] }> = [];
  if (stage) {
    for (const exit of stage.exits) {
      const [zc, zr, zw, zh] = exit.zone;
      const c0 = Math.floor(zc);
      const r0 = Math.floor(zr);
      const c1 = Math.ceil(zc + zw);
      const r1 = Math.ceil(zr + zh);
      if (c0 < 0 || r0 < 0 || c1 > cols || r1 > rows) {
        errors.push(`stage.exits "${exit.id}": zone [${exit.zone.join(", ")}] se sale del grid ${cols}×${rows}`);
        continue;
      }
      const cells: [number, number][] = [];
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          if (walkable[r * cols + c]) cells.push([c, r]);
        }
      }
      if (cells.length === 0) {
        errors.push(
          `stage.exits "${exit.id}" (${exit.label}): ninguna celda de su zone es transitable — la salida no se puede pisar`,
        );
        continue;
      }
      exitTargets.push({ id: exit.id, label: exit.label, cells });
    }
  }

  // ── Spawn del jugador ─────────────────────────────────────────────────────
  // Tiles normales NO llevan player: el jugador entra andando desde el vecino.
  // Solo el tile de bootstrap (primera escena de la sesión) lo incluye.
  if (isTile && !tileContext?.bootstrap) {
    if (player) {
      errors.push(
        "los tiles no llevan entity kind \"player\" (el jugador entra andando desde el tile vecino); solo el tile inicial de bootstrap la incluye",
      );
      player = null;
    }
  } else if (!player) {
    // Escenas proscenio de realize: el jugador entra por una salida (el
    // spawn lo resuelve el cliente con spawnPointForEntry) — sin player, el
    // flood-fill se siembra desde las zonas de salida. El bootstrap SÍ exige
    // player: lo comprueba el bridge (bootstrap-stage), que sabe que lo es.
    if (!stage) {
      errors.push('falta la entity kind "player" (spawn del jugador)');
    }
  } else if (player[0] < 0 || player[1] < 0 || player[0] >= cols || player[1] >= rows) {
    errors.push(`el player está fuera del grid: [${player[0]}, ${player[1]}]`);
    player = null;
  } else if (!walkable[player[1] * cols + player[0]]) {
    errors.push(
      `el spawn del player [${player[0]}, ${player[1]}] no es transitable (celda "${grid[player[1]][player[0]]}" u ocupada por un footprint)`,
    );
    player = null;
  }

  // ── Costuras (tiles): cada cruce de un vecino debe continuarse ────────────
  // Los puntos de arranque del flood-fill de un tile son sus cruces reales.
  const startCells: [number, number][] = [];
  const requiredReachCells: Array<{ cell: [number, number]; label: string }> = [];
  if (isTile) {
    const actualEdges = computeTileEdges(scene);
    const required = tileContext?.required_crossings ?? [];
    const byEdge = new Map<Edge, Array<{ edge: Edge } & EdgeCrossing>>();
    for (const req of required) {
      const list = byEdge.get(req.edge) ?? [];
      list.push(req);
      byEdge.set(req.edge, list);
    }
    for (const [edge, reqs] of byEdge) {
      const actual = actualEdges[edge].crossings;
      const { missing } = matchCrossings(reqs, actual);
      for (const m of missing) {
        errors.push(
          `el vecino ${edge} tiene un ${m.type} que muere en vuestra costura en la celda ${m.at}: ` +
            `tu tile debe continuarlo con celdas transitables compatibles en el borde ${edge}, celdas ${m.at - 2}..${m.at + 2}`,
        );
      }
      // Las continuaciones reales de los cruces requeridos son OBJETIVOS de
      // alcanzabilidad (no arranques: sembrar el flood con todos los cruces
      // los haría trivialmente alcanzables entre sí). SOLO cruces TRANSITABLES:
      // un río continúa en una celda de agua (sólida), a la que no se llega
      // andando — exigirle alcanzabilidad rechazaba tiles correctos. Su
      // continuidad ya la valida el chequeo de costura de arriba; se casa por
      // tipo compatible, no por proximidad ciega.
      for (const req of reqs) {
        const match = actual.find(
          (a) => COMPATIBLE[req.type].has(a.type) && Math.abs(a.at - req.at) <= 2,
        );
        if (match && cellWalkable(edgeCell(edge, match.at))) {
          requiredReachCells.push({
            cell: edgeCell(edge, match.at),
            label: `cruce ${match.type} del borde ${edge} (celda ${match.at})`,
          });
        }
      }
    }
    // Arranque del flood: la entrada explícita (borde por el que viene el
    // jugador) o, en su defecto, la primera continuación de cruce. Debe ser
    // TRANSITABLE: si la entrada casa con un río (agua), sembrar ahí dejaba
    // walkableStarts vacío y se saltaba toda la validación en silencio.
    if (tileContext?.entry) {
      const { edge, at } = tileContext.entry;
      const near = actualEdges[edge].crossings.find(
        (a) => (at === undefined || Math.abs(a.at - at) <= 2) && cellWalkable(edgeCell(edge, a.at)),
      );
      if (near) startCells.push(edgeCell(edge, near.at));
    }
    if (startCells.length === 0 && requiredReachCells.length > 0) {
      startCells.push(requiredReachCells[0].cell);
    }
  }
  if (player) startCells.unshift(player);
  // Plató sin player (realize): arrancar el flood desde UNA salida — el
  // jugador entrará por alguna y todas deben quedar conectadas entre sí
  // (sembrar todas las haría trivialmente alcanzables).
  if (stage && !player && startCells.length === 0 && exitTargets.length > 0) {
    startCells.push(exitTargets[0].cells[0]);
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

  const walkableStarts = startCells.filter(([c, r]) => cellWalkable([c, r]));
  // Un tile con cruces de vecinos o entrada declarada pero SIN terreno
  // transitable es injugable: el jugador entraría en agua/roca y no podría
  // moverse. Antes se aprobaba en silencio (el flood no arrancaba). Fail-loud.
  const tileHasNeighborLink = requiredReachCells.length > 0 || Boolean(tileContext?.entry);
  if (isTile && tileHasNeighborLink && walkableCells === 0) {
    errors.push("tile sin terreno transitable: el jugador no podría moverse dentro (injugable)");
  }
  if (isTile && startCells.length === 0 && !tileHasNeighborLink) {
    // Tile aislado sin cruces requeridos ni entrada (p.ej. prefetch diagonal):
    // no hay punto de entrada que validar — se acepta con aviso.
    warnings.push("tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada");
  } else if (isTile && tileHasNeighborLink && walkableStarts.length === 0 && walkableCells > 0) {
    // Hay terreno transitable pero ningún arranque declarado cae en él (p.ej.
    // la entrada casa con un río). ANTES el flood no corría y pasaba en
    // silencio; ahora al menos se avisa de que la alcanzabilidad no se verificó.
    warnings.push(
      "la entrada del tile no cae en terreno transitable: alcanzabilidad no verificada",
    );
  }
  if (walkableStarts.length > 0) {
    const reachable = new Uint8Array(cols * rows);
    const queue: number[] = [];
    for (const [c, r] of walkableStarts) {
      const idx = r * cols + c;
      if (!reachable[idx]) {
        reachable[idx] = 1;
        queue.push(idx);
      }
    }
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

    if (isTile) {
      // La regla "se puede salir" de un tile es que sus cruces (las costuras
      // con los vecinos) estén conectados entre sí y con la entrada.
      let allCrossingsReachable = true;
      for (const target of requiredReachCells) {
        const [c, r] = target.cell;
        if (!(c >= 0 && r >= 0 && c < cols && r < rows && reachable[r * cols + c])) {
          allCrossingsReachable = false;
          errors.push(`el ${target.label} no es alcanzable desde la entrada del tile`);
        }
      }
      stats.border_reachable = allCrossingsReachable;
    } else if (stage) {
      // Proscenio: no se sale por el borde sino por las salidas declaradas —
      // cada zona de exit debe ser alcanzable desde el spawn del jugador.
      let allExitsReachable = exitTargets.length > 0;
      for (const target of exitTargets) {
        const hit = target.cells.some(([c, r]) => reachable[r * cols + c] === 1);
        if (!hit) {
          allExitsReachable = false;
          errors.push(`la salida "${target.id}" (${target.label}) no es alcanzable desde el player`);
        }
      }
      stats.border_reachable = allExitsReachable;
    } else {
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

  // ── Contexto exterior en el world map (solo escenas legacy: la salida de
  // un tile es el propio plano continuo, no necesita links) ─────────────────
  const placeId = typeof scene.place_id === "string" ? scene.place_id : null;
  if (stage && !placeId) {
    errors.push("una escena proscenio necesita place_id: el plató ES un place del world map");
  }
  if (placeId && placeContext && !isTile) {
    const info = placeContext(placeId);
    if (!info || !info.exists) {
      errors.push(
        `place_id "${placeId}" no existe en el world map — llama a map_upsert_place (y map_link a su exterior) antes de re-responder`,
      );
    } else if (info.outgoing_links === 0) {
      errors.push(
        `el place "${placeId}" no tiene ningún link saliente en el world map: al salir de la escena no hay a dónde ir — llama a map_link para conectarlo (door/path a su exterior o vecino) antes de re-responder`,
      );
    } else if (stage && info.links) {
      // Proscenio: la salida física es la ÚNICA forma de viajar — cada link
      // del world map necesita su exit y cada exit su link.
      const linkTargets = new Set(info.links.map((l) => l.to));
      for (const exit of stage.exits) {
        if (!linkTargets.has(exit.to_place_id)) {
          errors.push(
            `stage.exits "${exit.id}" apunta a "${exit.to_place_id}" pero el place "${placeId}" no tiene link hacia él en el world map — llama a map_link antes de re-responder`,
          );
        }
      }
      const exitTargetIds = new Set(stage.exits.map((e) => e.to_place_id));
      for (const link of info.links) {
        if (!exitTargetIds.has(link.to)) {
          errors.push(
            `el link ${placeId} → ${link.to} del world map no tiene salida física en stage.exits — declara un exit hacia "${link.to}" (en proscenio solo se viaja pisando salidas)`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}
