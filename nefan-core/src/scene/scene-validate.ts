/** Validador de jugabilidad de escenas Format D — lógica pura compartida.
 *
 *  Comprueba lo que el expander no puede garantizar por construcción: que el
 *  mapa que entrega el motor narrativo se puede JUGAR. La regla de oro es la
 *  inversa del bug de la taberna original (sin muros se salía por todas
 *  partes): con muros sólidos hay que garantizar que se puede salir por
 *  ALGUNA parte, y salir de un TILE es cruzar sus costuras con los vecinos.
 *  Format D tiene UNA sola variante: el tile. La "suelta" se retiró con el
 *  issue #172 y el PLATÓ proscenio con la vista que lo pintaba, así que una
 *  escena sin `tile` se rechaza aquí igual que en el gate estructural.
 *
 *  Se ejecuta en el pre-flight de `narrative_respond` (vía
 *  `POST /scene/validate` del state API): si falla, el motor recibe los
 *  errores y re-responde sobre el mismo request. Errores = mapa injugable;
 *  warnings = sospechoso pero jugable.
 *
 *  ── Cómo está montado ────────────────────────────────────────────────────
 *  `validateScene` es un PIPELINE: abre el tile una vez y encadena pasadas
 *  con nombre, cada una un concepto entero (chars declarados, máscara
 *  walkable, spawn, costuras, puertas, alcanzabilidad, presupuestos). Las
 *  pasadas NO son independientes —la máscara la construye una y la consumen
 *  tres, el spawn siembra el flood—, así que la dependencia viaja en la
 *  FIRMA: cada una recibe exactamente lo que lee y devuelve lo que aporta. El
 *  compilador impide que una pasada lea algo que ninguna anterior produjo, y
 *  cada una se puede probar sola con un grid de seis filas hecho a mano en
 *  vez de un tile que sobreviva a las siete comprobaciones anteriores.
 *
 *  Los mensajes no le hablan a un humano sino al motor, así que su TEXTO y su
 *  ORDEN son contrato: los congela `test/scene-validate-golden.test.ts`. */

import { expandScenePrimitives, hasUnexpandedPrimitives } from "./scene-expand.js";
import { MAX_GROUND_FEATURES } from "./blueprint/ground.js";
import { planCollisionGrid } from "./blueprint/plan-collision.js";
import { parseScatter } from "./blueprint/scatter.js";
import { MAX_VOLUMES } from "./blueprint/volumes.js";
import { resolveTerrainLegend } from "./scene-normalize.js";
import { BODY_RADIUS_M, celdasLibresParaRadio } from "./terrain-collision.js";
import { composeTilePlan, MAX_TILE_VOLUMES } from "./tile-plan.js";
import { COMPATIBLE, computeTileEdges, matchCrossings, type EdgeCrossing, type TileEdges } from "./tile-edges.js";
import { TILE_CELLS, TILE_MPC, tileWorldRect } from "./tile.js";
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
    /** Utilización de los presupuestos del plan — telemetría OBJETIVA que el
     *  MCP devuelve al motor con la escena aceptada ("lo que se valida es lo
     *  que se optimiza"); el criterio de calidad vive en el prompt, no aquí. */
    volumes_declared: number;
    volumes_cap: number;
    /** Volúmenes del plan COMPUESTO (declarados + derivados del esquema): lo
     *  que de verdad se pinta y colisiona, y lo que gasta presupuesto. */
    volumes_total: number;
    volumes_total_cap: number;
    ground_features: number;
    ground_cap: number;
    scatter_zones: number;
    vegetation_zones: number;
    distinct_building_heights: number;
  };
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

// ═══ Lo que las pasadas se pasan entre sí ═══════════════════════════════════

/** Celda del grid: [columna, fila]. */
export type Cell = [number, number];

/** Tamaño del grid. Lo separa del resto quien solo necesita medir (el
 *  flood-fill), para que se pueda probar sin fabricar un tile entero. */
export interface GridDims {
  cols: number;
  rows: number;
}

/** El tile ABIERTO: lo que declaró el motor, lo que salió de expandirlo, el
 *  grid normalizado a cols×rows y su leyenda resuelta. Es material de solo
 *  lectura — ninguna pasada lo modifica. */
export interface TileView extends GridDims {
  /** La escena TAL CUAL la mandó el motor: los presupuestos se miden aquí,
   *  sobre lo DECLARADO, no sobre lo que el expander añadió. */
  raw: Record<string, unknown>;
  /** La misma escena con las primitivas ya rasterizadas. */
  scene: Record<string, unknown>;
  /** `rows` filas de exactamente `cols` chars. */
  grid: string[];
  /** char → nombre de terreno, según `terrain_legend`. */
  legend: Record<string, string>;
  /** Chars que bloquean el paso (muro, agua…). */
  solid: ReadonlySet<string>;
}

/** NPC colocado en el tile: objetivo de alcanzabilidad, no obstáculo. */
interface PlacedNpc {
  id: string;
  cell: Cell;
}

/** Dónde se puede pisar y qué entities hay que tener en cuenta después. */
export interface WalkableMap {
  /** `cols*rows` flags en orden fila-mayor. */
  walkable: boolean[];
  walkableCells: number;
  /** Fuera del grid es «no transitable», no una excepción. */
  isWalkable(cell: Cell): boolean;
  /** El player DECLARADO por el motor, aún sin juzgar (lo hace `checkPlayerSpawn`). */
  player: Cell | null;
  npcs: PlacedNpc[];
}

/** Celda a la que el jugador TIENE que poder llegar, con el nombre que verá
 *  el motor si no puede. */
interface ReachTarget {
  cell: Cell;
  label: string;
}

/** Resultado de mirar las costuras: por dónde arranca el flood y a qué
 *  celdas obliga a llegar. */
export interface Seams {
  startCells: Cell[];
  crossingTargets: ReachTarget[];
}

/** Qué celdas tocó el flood-fill. */
export interface Reach {
  count: number;
  /** ¿Alcanzada? Fuera del grid es «no». */
  has(cell: Cell): boolean;
}

/** Sumidero de hallazgos del pipeline: lo que el motor recibirá de vuelta.
 *  Cada pasada escribe en el MISMO objeto y en su turno — el orden de los
 *  mensajes es contrato con el motor, no un detalle de implementación. */
export interface Findings {
  errors: string[];
  warnings: string[];
  stats: SceneValidationResult["stats"];
}

/** Celda del grid sobre la línea del borde `edge` en la coordenada `at`. */
function edgeCell(edge: Edge, at: number): Cell {
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
  volumes_declared: 0,
  volumes_cap: MAX_VOLUMES,
  volumes_total: 0,
  volumes_total_cap: MAX_TILE_VOLUMES,
  ground_features: 0,
  ground_cap: MAX_GROUND_FEATURES,
  scatter_zones: 0,
  vegetation_zones: 0,
  distinct_building_heights: 0,
});

export const emptyFindings = (cols = 0, rows = 0): Findings => ({
  errors: [],
  warnings: [],
  stats: emptyStats(cols, rows),
});

// ═══ Pasada 0 · abrir el tile ═══════════════════════════════════════════════

/** El tile abierto, o el rechazo que ya cierra la validación (variante que no
 *  es tile, coords rotas, primitiva imposible de expandir). */
export type OpenTileResult =
  | { ok: true; view: TileView }
  | { ok: false; rejected: SceneValidationResult };

/** Grid de trabajo desde la escena expandida, normalizado a cols×rows: filas
 *  cortas se rellenan con hierba y las largas se recortan (mismo criterio
 *  tolerante que el saneador de ai_server, que puede no haber corrido). */
function normalizeGrid(terrain: unknown[], { cols, rows }: GridDims): string[] {
  const grid: string[] = [];
  for (let r = 0; r < Math.min(rows, terrain.length); r++) {
    const row = terrain[r];
    grid.push(typeof row === "string" ? row.padEnd(cols, "g").slice(0, cols) : "g".repeat(cols));
  }
  while (grid.length < rows) grid.push("g".repeat(cols));
  return grid;
}

/** Gate de variante + expansión de primitivas + grid + leyenda.
 *
 *  Es lo único que puede cortar la validación en seco: a partir de aquí todas
 *  las pasadas acumulan hallazgos sobre el MISMO tile y el motor recibe todo
 *  lo que está mal de una vez, no el primer fallo. */
export function openTile(rawScene: Record<string, unknown>): OpenTileResult {
  // Format D tiene UNA variante: el tile del mundo continuo. La "suelta"
  // (grid propio sin sitio en el plano) se retiró con el issue #172 y el
  // plató proscenio con su vista; aquí se corta antes de gastar el
  // flood-fill, con el mismo mensaje que el gate estructural.
  if (rawScene.tile === undefined) {
    return {
      ok: false,
      rejected: {
        ok: false,
        errors: [
          "una escena necesita `tile` {tx,ty}: es la única variante de Format D " +
            "(mundo continuo, pídela con generate_tile)",
        ],
        warnings: [],
        stats: emptyStats(),
      },
    };
  }

  // Tile (Format D v3): la forma la garantiza el expander (bioma + 128×128
  // sintetizados); aquí solo las coords. size/terrain completos los rechaza
  // el propio expander con mensaje accionable.
  const t = rawScene.tile as { tx?: unknown; ty?: unknown };
  if (!t || !Number.isInteger(t.tx) || !Number.isInteger(t.ty)) {
    return {
      ok: false,
      rejected: {
        ok: false,
        errors: [`tile.tx/ty deben ser enteros, got ${JSON.stringify(rawScene.tile)}`],
        warnings: [],
        stats: emptyStats(),
      },
    };
  }
  const dims: GridDims = { cols: TILE_CELLS, rows: TILE_CELLS };

  // Los fail-loud del expander se vuelven errores legibles para el motor.
  let scene = rawScene;
  if (hasUnexpandedPrimitives(rawScene)) {
    try {
      scene = expandScenePrimitives(rawScene);
    } catch (err) {
      return {
        ok: false,
        rejected: { ok: false, errors: [(err as Error).message], warnings: [], stats: emptyStats(dims.cols, dims.rows) },
      };
    }
  }

  const { legend, solidChars } = resolveTerrainLegend(scene.terrain_legend);
  return {
    ok: true,
    view: {
      ...dims,
      raw: rawScene,
      scene,
      grid: normalizeGrid(scene.terrain as unknown[], dims),
      legend,
      solid: new Set(solidChars),
    },
  };
}

// ═══ Pasada 1 · chars declarados ════════════════════════════════════════════

/** Todo char del grid debe ser reservado o traer entrada en `terrain_legend`:
 *  uno sin declarar es terreno que nadie sabe pintar ni si se puede pisar. */
export function checkDeclaredChars(view: TileView, found: Findings): void {
  const undeclared = new Set<string>();
  for (const row of view.grid) {
    for (const ch of row) {
      if (!RESERVED_CHARS.has(ch) && view.legend[ch] === undefined) undeclared.add(ch);
    }
  }
  if (undeclared.size > 0) {
    found.errors.push(
      `chars de terreno sin declarar en terrain_legend: ${[...undeclared].map((c) => `"${c}"`).join(", ")}`,
    );
  }
}

// ═══ Pasada 2 · el plan compuesto ═══════════════════════════════════════════

/** Qué celdas bloquea el PLAN del tile, y de qué tamaño es. */
export interface PlanMask {
  /** ¿Bloquea el plan esta celda? Fuera del grid, «no». */
  solid(c: number, r: number): boolean;
  /** Volúmenes del plan compuesto (declarados + derivados). */
  volumes: number;
}

/** Compone el plan del tile —el MISMO que pinta el cliente y colisiona el
 *  bridge, `composeTilePlan`— y lo rasteriza a la máscara con la que se juzga
 *  la jugabilidad.
 *
 *  Antes esta pasada tenía su propia idea de qué bloquea: estampaba la huella
 *  de cada entity estática. O sea que veía los postes de vegetación que el
 *  juego atravesaba y NO veía ni un árbol de los que el juego sí frena — el
 *  validador juzgaba un tile que nadie llegaba a jugar. Lo que el compositor
 *  tuvo que ignorar o recortar sale como ERROR: en esta capa el motor puede
 *  re-responder, que es lo único que arregla un plan que no cabe. */
export function composePlan(view: TileView, found: Findings): PlanMask {
  const { plan, warnings } = composeTilePlan(view.scene);
  for (const w of warnings) found.errors.push(w);
  found.stats.volumes_total = plan?.volumes.length ?? 0;
  const tile = view.scene.tile as { tx: number; ty: number };
  const grid = plan
    ? planCollisionGrid(plan.ground, plan.volumes, tileWorldRect(tile.tx, tile.ty), {
        // La solidez de ESTA escena: un vado declarado (`{name, solid:false}`)
        // no bloquea tampoco por el plan — igual que en juego.
        solidChars: [...view.solid],
      })
    : null;
  const solidChars = new Set(grid?.solid_chars ?? []);
  return {
    volumes: plan?.volumes.length ?? 0,
    solid: (c, r) =>
      grid !== null && c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && solidChars.has(grid.grid[r][c]),
  };
}

// ═══ Pasada 3 · máscara walkable ════════════════════════════════════════════

/** Terreno no sólido MENOS lo que bloquea el PLAN, y de paso las entities que
 *  no son decorado: el player declarado (aún sin juzgar) y los NPCs, que son
 *  objetivos de alcanzabilidad y no obstáculos.
 *  No emite errores — construye el material de las cuatro pasadas siguientes. */
export function buildWalkableMap(view: TileView, planMask: PlanMask, found: Findings): WalkableMap {
  const { cols, rows, grid } = view;
  const walkable: boolean[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) walkable[r * cols + c] = !view.solid.has(grid[r][c]) && !planMask.solid(c, r);
  }
  const entities = Array.isArray(view.scene.entities) ? (view.scene.entities as Record<string, unknown>[]) : [];
  let player: Cell | null = null;
  const npcs: PlacedNpc[] = [];
  for (const e of entities) {
    if (!e || !Array.isArray(e.cell)) continue;
    const [c, r] = e.cell as Cell;
    if (e.kind === "player") player = [c, r];
    else if (e.kind === "npc") npcs.push({ id: String(e.id), cell: [c, r] });
  }
  found.stats.walkable_cells = walkable.filter(Boolean).length;
  found.stats.npcs_total = npcs.length;
  return {
    walkable,
    walkableCells: found.stats.walkable_cells,
    isWalkable: ([c, r]: Cell): boolean => c >= 0 && r >= 0 && c < cols && r < rows && walkable[r * cols + c],
    player,
    npcs,
  };
}

// ═══ Pasada 3 · scatter declarativo (vista fps) ═════════════════════════════

/** Validación fail-loud con ruta exacta (`parseScatter`): el motor recibe el
 *  error preciso al responder, no un bloque silenciosamente ignorado en
 *  runtime. Se mide sobre lo DECLARADO — el scatter no pasa por el expander. */
export function checkScatter(view: TileView, found: Findings): void {
  const { scatter_generators: generators, scatter_zones: zones } = view.raw;
  if (generators === undefined && zones === undefined) return;
  const parsed = parseScatter(generators, zones);
  if (!parsed.ok) found.errors.push(`scatter inválido: ${parsed.error}`);
}

// ═══ Pasada 4 · spawn del jugador ═══════════════════════════════════════════

/** Los tiles normales NO llevan player: el jugador entra andando desde el
 *  vecino. Solo el tile de bootstrap (primera escena de la sesión) lo
 *  incluye, y ahí su celda tiene que existir y ser pisable.
 *
 *  Devuelve el spawn VÁLIDO (semilla del flood) o null: un player mal puesto
 *  no siembra alcanzabilidad, o el mapa saldría verde desde una celda
 *  imposible. */
export function checkPlayerSpawn(
  view: TileView,
  map: WalkableMap,
  tileContext: TileValidationContext | undefined,
  found: Findings,
): Cell | null {
  const player = map.player;
  if (!tileContext?.bootstrap) {
    if (player) {
      found.errors.push(
        "los tiles no llevan entity kind \"player\" (el jugador entra andando desde el tile vecino); solo el tile inicial de bootstrap la incluye",
      );
    }
    return null;
  }
  if (!player) {
    found.errors.push('falta la entity kind "player" (spawn del jugador)');
    return null;
  }
  const [c, r] = player;
  if (c < 0 || r < 0 || c >= view.cols || r >= view.rows) {
    found.errors.push(`el player está fuera del grid: [${c}, ${r}]`);
    return null;
  }
  if (!map.isWalkable(player)) {
    found.errors.push(
      `el spawn del player [${c}, ${r}] no es transitable (celda "${view.grid[r][c]}" u ocupada por un footprint)`,
    );
    return null;
  }
  return player;
}

// ═══ Pasada 5 · costuras del tile ═══════════════════════════════════════════

/** Cada cruce de un vecino debe continuarse en nuestro borde, y de ahí sale
 *  también por dónde entra el jugador: los arranques del flood son los cruces
 *  REALES del tile, no cualquier celda transitable.
 *
 *  Devuelve los objetivos de alcanzabilidad y las semillas del flood. */
export function checkSeams(
  view: TileView,
  map: WalkableMap,
  edges: TileEdges,
  tileContext: TileValidationContext | undefined,
  player: Cell | null,
  found: Findings,
): Seams {
  const startCells: Cell[] = [];
  const crossingTargets: ReachTarget[] = [];
  const byEdge = new Map<Edge, Array<{ edge: Edge } & EdgeCrossing>>();
  for (const req of tileContext?.required_crossings ?? []) {
    const list = byEdge.get(req.edge) ?? [];
    list.push(req);
    byEdge.set(req.edge, list);
  }
  for (const [edge, reqs] of byEdge) {
    const actual = edges[edge].crossings;
    const { missing } = matchCrossings(reqs, actual);
    for (const m of missing) {
      found.errors.push(
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
      if (match && map.isWalkable(edgeCell(edge, match.at))) {
        crossingTargets.push({
          cell: edgeCell(edge, match.at),
          label: `cruce ${match.type} del borde ${edge} (celda ${match.at})`,
        });
      }
    }
  }
  // Arranque del flood: la entrada explícita (borde por el que viene el
  // jugador) o, en su defecto, la primera continuación de cruce. Debe ser
  // TRANSITABLE: si la entrada casa con un río (agua), sembrar ahí dejaba
  // startCells vacío y se saltaba toda la validación en silencio.
  if (tileContext?.entry) {
    const { edge, at } = tileContext.entry;
    const near = edges[edge].crossings.find(
      (a) => (at === undefined || Math.abs(a.at - at) <= 2) && map.isWalkable(edgeCell(edge, a.at)),
    );
    if (near) startCells.push(edgeCell(edge, near.at));
  }
  if (startCells.length === 0 && crossingTargets.length > 0) {
    startCells.push(crossingTargets[0].cell);
  }
  if (player) startCells.unshift(player);
  return { startCells, crossingTargets };
}

// ═══ Pasada 6 · puertas ═════════════════════════════════════════════════════

const sceneVolumes = (scene: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(scene.volumes) ? (scene.volumes as Record<string, unknown>[]) : [];

/** Huecos de las `structures` (el camino viejo: el expander ya talló el vano
 *  en el grid). */
function structureDoorCells(scene: Record<string, unknown>): Cell[] {
  const cells: Cell[] = [];
  const structures = Array.isArray(scene.structures) ? (scene.structures as Record<string, unknown>[]) : [];
  for (const s of structures) {
    const rect = s.rect as [number, number, number, number] | undefined;
    const doors = Array.isArray(s.doors) ? (s.doors as { side: string; at: number; width?: number }[]) : [];
    if (!Array.isArray(rect)) continue;
    const [c0, r0, w, h] = rect;
    for (const d of doors) {
      const dw = Math.max(1, d.width ?? 1);
      for (let k = 0; k < dw; k++) {
        if (d.side === "north") cells.push([c0 + d.at + k, r0]);
        else if (d.side === "south") cells.push([c0 + d.at + k, r0 + h - 1]);
        else if (d.side === "west") cells.push([c0, r0 + d.at + k]);
        else if (d.side === "east") cells.push([c0 + w - 1, r0 + d.at + k]);
      }
    }
  }
  return cells;
}

/** Huecos de los buildings CUTAWAY declarados en `volumes` (el camino
 *  moderno: el greybox talla el hueco en runtime; aquí cuentan como
 *  telemetría y objetivo de alcanzabilidad — sus celdas son suelo llano para
 *  el flood, los muros del volume no se estampan en walkable). Antes
 *  doors_total = 0 con un cutaway CON doors: stat engañoso (playtest
 *  2026-08-13). */
function cutawayDoorCells(scene: Record<string, unknown>): Cell[] {
  const cells: Cell[] = [];
  for (const v of sceneVolumes(scene)) {
    if (!v || v.type !== "building" || v.cutaway !== true) continue;
    const rect = v.rect as [number, number, number, number] | undefined;
    const doors = Array.isArray(v.doors) ? (v.doors as { edge: string; at: number; w?: number }[]) : [];
    if (!Array.isArray(rect) || rect.length !== 4) continue;
    const [c0, r0, w, d] = rect;
    for (const door of doors) {
      if (typeof door?.at !== "number") continue;
      const dw = Math.max(1, Math.round(door.w ?? 4));
      for (let k = 0; k < dw; k++) {
        if (door.edge === "n") cells.push([Math.round(c0 + door.at) + k, Math.round(r0)]);
        else if (door.edge === "s") cells.push([Math.round(c0 + door.at) + k, Math.round(r0 + d) - 1]);
        else if (door.edge === "w") cells.push([Math.round(c0), Math.round(r0 + door.at) + k]);
        else if (door.edge === "e") cells.push([Math.round(c0 + w) - 1, Math.round(r0 + door.at) + k]);
      }
    }
  }
  return cells;
}

/** Todas las celdas de vano del tile, vengan del camino viejo o del moderno. */
export function collectDoorCells(view: TileView, found: Findings): Cell[] {
  const cells = [...structureDoorCells(view.scene), ...cutawayDoorCells(view.scene)];
  found.stats.doors_total = cells.length;
  return cells;
}

// ═══ Pasada 7 · utilización de los presupuestos del plan ════════════════════

/** Telemetría objetiva de vuelta al motor: lo que DECLARÓ (su presupuesto de
 *  `volumes`) y lo que gasta el plan COMPUESTO — el motor no puede componer el
 *  tile en su cabeza, así que si no se le dice cuánto ocupa su vegetación de
 *  masa no puede decidir si le queda sitio. El criterio de calidad vive en la
 *  QUALITY BAR del prompt, no aquí. */
export function reportPlanBudget(view: TileView, found: Findings): void {
  const { raw } = view;
  found.stats.volumes_declared = Array.isArray(raw.volumes) ? (raw.volumes as unknown[]).length : 0;
  found.stats.ground_features = Array.isArray(raw.ground) ? (raw.ground as unknown[]).length : 0;
  found.stats.scatter_zones = Array.isArray(raw.scatter_zones) ? (raw.scatter_zones as unknown[]).length : 0;
  found.stats.vegetation_zones = Array.isArray(raw.vegetation_zones) ? (raw.vegetation_zones as unknown[]).length : 0;
  const buildingHeights = new Set<number>();
  // Del `scene` porque es lo mismo: el expander copia `volumes` sin tocarlo.
  for (const v of sceneVolumes(view.scene)) {
    if (v?.type !== "building") continue;
    const wallH = typeof v.wall_h === "number" && Number.isFinite(v.wall_h) ? v.wall_h : 5;
    buildingHeights.add(Math.round(wallH * 2) / 2);
  }
  found.stats.distinct_building_heights = buildingHeights.size;
}

// ═══ Pasada 8 · alcanzabilidad ══════════════════════════════════════════════

/** Máscara de ANCLAS de tamaño `k`: 1 donde el bloque k×k con esquina NO en
 *  (c, r) es enteramente pisable. Es la EROSIÓN de la máscara walkable, y con
 *  `k = 1` es la máscara walkable misma.
 *
 *  Dimensiones `(cols−k+1) × (rows−k+1)`: un ancla que se saliera del grid no
 *  existe, y el borde del tile no es transitable por definición (lo gobierna
 *  el soft-clamp del cliente). */
function anchorMask({ cols, rows }: GridDims, walkable: boolean[], k: number): Uint8Array {
  const aCols = cols - k + 1;
  const anchors = new Uint8Array(Math.max(0, aCols) * Math.max(0, rows - k + 1));
  for (let r = 0; r + k <= rows; r++) {
    for (let c = 0; c + k <= cols; c++) {
      let libre = true;
      for (let dr = 0; dr < k && libre; dr++) {
        for (let dc = 0; dc < k; dc++) {
          if (!walkable[(r + dr) * cols + c + dc]) { libre = false; break; }
        }
      }
      if (libre) anchors[r * aCols + c] = 1;
    }
  }
  return anchors;
}

/** Flood-fill 4-conexo CON CUERPO sobre la máscara walkable desde las
 *  semillas dadas. Algoritmo puro: se prueba con un grid de seis filas, sin
 *  fabricar un tile que sobreviva a las siete pasadas anteriores.
 *
 *  `k` = celdas libres consecutivas que exige el cuerpo que recorre el mapa
 *  (`celdasLibresParaRadio`). No tiene default A PROPÓSITO: un default invita
 *  a llamarlo «como antes», y «como antes» es un punto sin dimensión que
 *  declara transitable la puerta de 1 m que el collider bloquea. Quien llama
 *  DERIVA su `k` de un radio; `k = 1` es exactamente el algoritmo de siempre,
 *  así que no hay dos.
 *
 *  Lo que recorre no son celdas sino ANCLAS —posiciones donde el cuerpo cabe
 *  entero— y una celda queda alcanzada si alguna ancla del flood la cubre. Un
 *  corredor más estrecho que el cuerpo no tiene ni un ancla: no se cruza, que
 *  es justo lo que pasa en juego.
 *
 *  Una semilla que no sea pisable no siembra nada (antes se marcaba alcanzada
 *  por decreto): con cuerpo la pregunta es si CABE ahí, y las tres fuentes de
 *  arranque ya filtran por transitable antes de llegar aquí. */
export function floodFill(dims: GridDims, map: WalkableMap, starts: Cell[], k: number): Reach {
  const { cols, rows } = dims;
  const covered = new Uint8Array(cols * rows);
  const aCols = cols - k + 1;
  const aRows = rows - k + 1;
  if (k < 1 || aCols < 1 || aRows < 1) {
    // El cuerpo no cabe ni en el tile entero: nada es alcanzable.
    return { count: 0, has: () => false };
  }
  const anchors = anchorMask(dims, map.walkable, k);
  const seen = new Uint8Array(aCols * aRows);
  const queue: number[] = [];
  const sembrar = (c: number, r: number): void => {
    if (c < 0 || r < 0 || c >= aCols || r >= aRows) return;
    const idx = r * aCols + c;
    if (seen[idx] || !anchors[idx]) return;
    seen[idx] = 1;
    queue.push(idx);
  };
  // El cuerpo puede estar plantado de cualquier forma sobre la semilla: vale
  // cualquiera de las k×k anclas que la cubren.
  for (const [c, r] of starts) {
    for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) sembrar(c - dc, r - dr);
  }
  let head = 0;
  let count = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const c = idx % aCols;
    const r = (idx - c) / aCols;
    for (let dr = 0; dr < k; dr++) {
      for (let dc = 0; dc < k; dc++) {
        const ci = (r + dr) * cols + c + dc;
        if (!covered[ci]) {
          covered[ci] = 1;
          count++;
        }
      }
    }
    sembrar(c + 1, r);
    sembrar(c - 1, r);
    sembrar(c, r + 1);
    sembrar(c, r - 1);
  }
  return {
    count,
    has: ([c, r]: Cell): boolean => c >= 0 && r >= 0 && c < cols && r < rows && covered[r * cols + c] === 1,
  };
}

/** La regla "se puede salir" de un tile: sus cruces (las costuras con los
 *  vecinos) conectados entre sí y con la entrada. */
function checkCrossingsReachable(targets: ReachTarget[], reach: Reach, found: Findings): void {
  let all = true;
  for (const target of targets) {
    if (!reach.has(target.cell)) {
      all = false;
      found.errors.push(`el ${target.label} no es alcanzable desde la entrada del tile`);
    }
  }
  found.stats.border_reachable = all;
}

/** Puertas alcanzables: la celda del hueco es walkable, así que basta con que
 *  el flood la toque. Ninguna alcanzable es injugable; algunas, sospechoso. */
function checkDoorsReachable(doorCells: Cell[], reach: Reach, found: Findings): void {
  const reachable = doorCells.filter((cell) => reach.has(cell)).length;
  found.stats.doors_reachable = reachable;
  if (doorCells.length > 0 && reachable === 0) {
    found.errors.push("ninguna puerta de las structures es alcanzable desde el player");
  } else if (reachable < doorCells.length) {
    found.warnings.push(`${doorCells.length - reachable} celda(s) de puerta no alcanzables desde el player`);
  }
}

/** NPCs: primero que puedan estar donde nacen, después que se llegue a ellos.
 *
 *  Las dos son ERROR, no aviso. Un NPC que no puede moverse de su celda no es
 *  «jugable, pero revísalo»: es el bug que se leyó durante semanas como
 *  ambiente —el tabernero de `alta_fantasia` nació dentro del prop
 *  `mostrador` y avanzó 0,72 m en 60 s, contaminando #247, #262 y #284—. Con
 *  severidad de aviso el motor entrega la escena igual (narrative-mcp los
 *  rotula «playable, but review»), así que el flood con cuerpo no cerraría
 *  nada. Como error, el pre-flight de `narrative_respond` devuelve isError y
 *  el motor RE-RESPONDE; no hace falta maquinaria nueva.
 *
 *  1. **Celda de nacimiento sólida** — `checkNpcsReachable` se conformaba con
 *     que una celda VECINA fuera transitable, así que un NPC empotrado en un
 *     prop daba el mismo veredicto que uno bien puesto (`ok:true`, «1/1
 *     alcanzables»). Se le habla desde al lado, sí, pero él no puede salir.
 *  2. **Alcanzable** — su celda o una adyacente en el flood CON CUERPO: se
 *     les habla desde al lado, y quien va a hablarles también tiene cuerpo.
 *
 *  La celda se lee con `floor`: el contrato la declara entera
 *  (`generate_scene.json`) pero el zod admite fracción, y un índice
 *  fraccionario daba `undefined` en la máscara — o sea «inalcanzable» para un
 *  NPC plantado en mitad de un prado. Con severidad de error, esa mentira
 *  rechazaría el tile entero. */
function checkNpcsReachable(npcs: PlacedNpc[], map: WalkableMap, reach: Reach, found: Findings): void {
  let reachableNpcs = 0;
  for (const npc of npcs) {
    const [c, r] = npc.cell;
    const celda: Cell = [Math.floor(c), Math.floor(r)];
    if (!map.isWalkable(celda)) {
      found.errors.push(
        `el NPC "${npc.id}" nace en [${c}, ${r}], celda no transitable (muro, agua o huella de un ` +
          "volumen): no podría moverse de ahí",
      );
      continue;
    }
    const near = ([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dc, dr]) =>
      reach.has([celda[0] + dc, celda[1] + dr]),
    );
    if (near) reachableNpcs++;
    else found.errors.push(`el NPC "${npc.id}" en [${c}, ${r}] no es alcanzable desde el player`);
  }
  found.stats.npcs_reachable = reachableNpcs;
}

/** ¿Se puede llegar a lo que importa desde donde entra el jugador?
 *
 *  Antes de correr el flood hay que decidir si hay desde dónde: un tile con
 *  vecino enlazado pero sin terreno pisable es injugable, y uno cuyas
 *  semillas caen todas en agua no se puede verificar — los dos casos pasaban
 *  en silencio porque el flood simplemente no arrancaba. */
export function checkReachability(
  view: TileView,
  map: WalkableMap,
  seams: Seams,
  doorCells: Cell[],
  tileContext: TileValidationContext | undefined,
  found: Findings,
): void {
  const starts = seams.startCells.filter((cell) => map.isWalkable(cell));
  const hasNeighborLink = seams.crossingTargets.length > 0 || Boolean(tileContext?.entry);
  if (hasNeighborLink && map.walkableCells === 0) {
    found.errors.push("tile sin terreno transitable: el jugador no podría moverse dentro (injugable)");
  }
  if (seams.startCells.length === 0 && !hasNeighborLink) {
    // Tile aislado sin cruces requeridos ni entrada (p.ej. prefetch diagonal):
    // no hay punto de entrada que validar — se acepta con aviso.
    found.warnings.push("tile sin cruces de vecinos ni entrada conocida: alcanzabilidad no verificada");
  } else if (hasNeighborLink && starts.length === 0 && map.walkableCells > 0) {
    // Hay terreno transitable pero ningún arranque declarado cae en él (p.ej.
    // la entrada casa con un río). ANTES el flood no corría y pasaba en
    // silencio; ahora al menos se avisa de que la alcanzabilidad no se verificó.
    found.warnings.push("la entrada del tile no cae en terreno transitable: alcanzabilidad no verificada");
  }
  if (starts.length === 0) return;

  // El flood recorre el tile con el CUERPO MAYOR que el sim mueve, no con un
  // punto sin dimensión: una puerta de 1 m la cruza el jugador (radio 0,4) y
  // NUNCA un NPC (0,5), y con el punto salía verde. `k` se deriva del radio y
  // del mpc del tile — no se escribe a mano y no es el AABB (2 celdas), que
  // haría nacer el candado verde sobre su propio caso.
  const reach = floodFill(view, map, starts, celdasLibresParaRadio(BODY_RADIUS_M, TILE_MPC));
  found.stats.reachable_cells = reach.count;
  checkCrossingsReachable(seams.crossingTargets, reach, found);
  checkDoorsReachable(doorCells, reach, found);
  checkNpcsReachable(map.npcs, map, reach, found);

  // Proporción jugable del mapa.
  const walkableRatio = map.walkableCells / (view.cols * view.rows);
  if (walkableRatio < 0.2) {
    found.warnings.push(`solo el ${Math.round(walkableRatio * 100)}% del mapa es transitable — ¿demasiado muro/agua?`);
  }
}

// ═══ El pipeline ════════════════════════════════════════════════════════════

export function validateScene(
  rawScene: Record<string, unknown>,
  tileContext?: TileValidationContext,
): SceneValidationResult {
  const opened = openTile(rawScene);
  if (!opened.ok) return opened.rejected;
  const view = opened.view;
  const found = emptyFindings(view.cols, view.rows);

  checkDeclaredChars(view, found);
  const planMask = composePlan(view, found);
  const map = buildWalkableMap(view, planMask, found);
  checkScatter(view, found);
  const player = checkPlayerSpawn(view, map, tileContext, found);
  const seams = checkSeams(view, map, computeTileEdges(view.scene), tileContext, player, found);
  const doorCells = collectDoorCells(view, found);
  reportPlanBudget(view, found);
  checkReachability(view, map, seams, doorCells, tileContext, found);

  return { ok: found.errors.length === 0, errors: found.errors, warnings: found.warnings, stats: found.stats };
}
