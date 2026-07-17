/** Scene format normalization — engine-agnostic, shared by every client.
 *
 *  The narrative engine emits scenes in "Map Format D": a character grid
 *  (`size.cols`/`size.rows`, `terrain` as an array of strings, `terrain_legend`)
 *  plus `entities` placed by `cell`/`footprint`. Renderers, however, want world
 *  coordinates in metres (`dimensions` + `objects[]`/`npcs[]` with
 *  `position`/`scale`). `formatDToWorld` is the single place that bridges the two
 *  so the logic does not live inside a specific client (CLAUDE.md: "lógica en
 *  nefan-core, Godot/HTML solo visual").
 *
 *  Fail-loud: a malformed Format D entity throws rather than being silently
 *  dropped. A payload that is NOT Format D is returned verbatim (already-resolved
 *  world scene, e.g. legacy room JSON or a `change_scene` payload). */

import { expandScenePrimitives, hasUnexpandedPrimitives } from "./scene-expand.js";
import { tileWorldRect } from "./tile.js";

/** The world-coordinate scene shape a renderer consumes. Loose by design — the
 *  renderer reads a known subset and ignores the rest (e.g. `__player_start`,
 *  `__format_d`). */
export type WorldScene = Record<string, unknown>;

type FormatDEntity = {
  id: string;
  kind: string;
  name: string;
  cell: [number, number];
  footprint: [number, number];
  glyph?: string;
  /** Pista de forma para el render (box|cylinder|sphere|cone). Opcional; el
   *  cliente 2D la usa para dibujar círculos/triángulos en el schematic. */
  shape?: string;
  /** Altura en METROS (no en celdas — el footprint sí va en celdas). Opcional;
   *  sin ella se aplica el default por kind (KIND_DEFAULT_HEIGHT). */
  h?: number;
  texture_hash?: string;
  model_hash?: string;
};

/** Formas válidas que el cliente entiende. `shape` inválido se ignora (cae a box). */
const VALID_SHAPES = new Set(["box", "cylinder", "sphere", "cone"]);

/** Feature vectorial de terreno (Format D `terrain_features`): polyline con
 *  grosor (río, camino) o polígono relleno (`closed`). Puntos en coordenadas
 *  de celda (col,row — floats permitidos), width en celdas. Visual-only: la
 *  colisión no la lee. */
type TerrainFeature = {
  type: string;
  points: [number, number][];
  width?: number;
  closed?: boolean;
  color?: string;
};

/** Valida y normaliza `terrain_features`. Tolerante (mismo criterio que
 *  `shape`): una feature malformada se descarta, no tumba la escena — el LLM
 *  puede equivocarse en un campo opcional sin invalidar todo el mapa. */
function normalizeTerrainFeatures(raw: unknown): TerrainFeature[] {
  if (!Array.isArray(raw)) return [];
  const out: TerrainFeature[] = [];
  for (const f of raw as Record<string, unknown>[]) {
    if (!f || typeof f !== "object") continue;
    if (typeof f.type !== "string" || !f.type) continue;
    const pts = f.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const points: [number, number][] = [];
    for (const p of pts) {
      if (!Array.isArray(p) || p.length < 2) break;
      const [x, y] = p as number[];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) break;
      points.push([x, y]);
    }
    if (points.length !== pts.length) continue;
    const width = typeof f.width === "number" && Number.isFinite(f.width) && f.width > 0 ? f.width : 1;
    const feature: TerrainFeature = { type: f.type, points, width };
    if (f.closed === true) feature.closed = true;
    if (typeof f.color === "string" && /^#[0-9a-fA-F]{6}$/.test(f.color)) feature.color = f.color;
    out.push(feature);
  }
  return out;
}

const VALID_KINDS = new Set(["player", "npc", "building", "prop", "tree", "item", "decor"]);

/** Altura por defecto (METROS) cuando la entity no declara `h`. Alineada con
 *  los defaults de los volumes del blueprint (building wall_h 5 celdas =
 *  2.5 m, prop h 2 celdas = 1 m). Clave = kind (un tree emite category
 *  "prop" pero su altura sale de aquí). Compartida por ambos clientes vía
 *  formatDToWorld; el 2D la usa además para los spawns narrativos. */
export const KIND_DEFAULT_HEIGHT: Record<string, number> = {
  building: 2.5,
  tree: 4,
  prop: 1,
  item: 0.5,
  decor: 0.5,
};

/** Techo duro de altura por entity (metros) — un `h` disparatado del LLM se
 *  recorta en vez de tumbar la escena. */
const MAX_ENTITY_HEIGHT_M = 20;

/** Chars de terreno sólidos por defecto: "W" muro (reservado para interiores)
 *  y "w" agua (los puentes "b" son transitables). La leyenda puede añadir o
 *  quitar solidez por char con la forma objeto `{name, solid}`. */
export const DEFAULT_SOLID_CHARS: readonly string[] = ["W", "w"];

/** Heurística retro para leyendas legacy (valor string, sin `solid`): un
 *  nombre que suena a muro se trata como sólido. Arregla los saves generados
 *  antes de que la leyenda declarase solidez, sin regenerar la escena. */
const SOLID_LEGEND_NAME = /muro|muralla|pared|tapia|wall|acantilado|cliff/i;

/** Normaliza `terrain_legend` (valores string legacy u objeto `{name, solid}`)
 *  a un mapa char→nombre plano para el renderer, y resuelve qué chars bloquean
 *  movimiento. `solid: false` explícito quita un default (p.ej. agua vadeable).
 *  Exportada para que scene-validate use la misma resolución de solidez. */
export function resolveTerrainLegend(rawLegend: unknown): {
  legend: Record<string, string>;
  solidChars: string[];
} {
  const legend: Record<string, string> = {};
  const solid = new Set<string>(DEFAULT_SOLID_CHARS);
  if (rawLegend && typeof rawLegend === "object") {
    for (const [ch, val] of Object.entries(rawLegend as Record<string, unknown>)) {
      if (typeof val === "string") {
        legend[ch] = val;
        if (SOLID_LEGEND_NAME.test(val)) solid.add(ch);
      } else if (val && typeof val === "object") {
        const entry = val as { name?: unknown; solid?: unknown };
        legend[ch] = typeof entry.name === "string" ? entry.name : ch;
        if (entry.solid === true) solid.add(ch);
        else if (entry.solid === false) solid.delete(ch);
      }
    }
  }
  return { legend, solidChars: [...solid].sort() };
}

/** Convert a Map Format D scene to a world-coordinate scene. If `raw` is not in
 *  Format D it is returned unchanged. */
export function formatDToWorld(raw: Record<string, unknown>): WorldScene {
  // Idempotencia: una world scene ya normalizada (lleva __format_d) pasa
  // intacta. Sin esta guarda, un tile normalizado re-entraría en la expansión
  // (conserva `tile` pero no `biome`) y lanzaría — el bridge normaliza en el
  // wire y el cliente HTML vuelve a llamar aquí para sus fixtures locales.
  if (raw.__format_d !== undefined) return raw;
  // Red de seguridad para fixtures locales: las escenas del bridge llegan ya
  // expandidas (__expanded); una escena cruda con primitivas se expande aquí.
  if (hasUnexpandedPrimitives(raw)) raw = expandScenePrimitives(raw);
  const size = raw.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  const terrain = raw.terrain;
  const entities = raw.entities;
  const isFormatD =
    !!size && typeof size.cols === "number" && typeof size.rows === "number" &&
    Array.isArray(terrain) && terrain.every((r) => typeof r === "string") &&
    Array.isArray(entities);

  if (!isFormatD) return raw;

  const cols = size!.cols!;
  const rows = size!.rows!;
  const mpc = size!.meters_per_cell ?? 2;
  const { legend, solidChars } = resolveTerrainLegend(raw.terrain_legend);
  // Rect mundial de la escena — ÚNICA fuente del origen. Un tile vive en su
  // rect global del plano continuo; una escena legacy queda centrada en el
  // origen (comportamiento histórico, sin cambios).
  const tile = raw.tile as { tx?: number; ty?: number } | undefined;
  const worldRect =
    tile && Number.isInteger(tile.tx) && Number.isInteger(tile.ty)
      ? tileWorldRect(tile.tx!, tile.ty!)
      : {
          minX: -(cols * mpc) / 2,
          minZ: -(rows * mpc) / 2,
          maxX: (cols * mpc) / 2,
          maxZ: (rows * mpc) / 2,
        };

  const objects: Record<string, unknown>[] = [];
  const npcs: Record<string, unknown>[] = [];
  let playerStart: { x: number; z: number } | null = null;

  for (let i = 0; i < entities.length; i++) {
    const ent = (entities as FormatDEntity[])[i];
    if (!ent) throw new Error(`scene entities[${i}] is null/undefined`);
    if (!ent.id) throw new Error(`scene entities[${i}] missing id`);
    if (!VALID_KINDS.has(ent.kind)) {
      throw new Error(`scene entities[${i}] (${ent.id}) has invalid kind="${ent.kind}"; expected one of ${[...VALID_KINDS]}`);
    }
    if (!Array.isArray(ent.cell) || ent.cell.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing cell [col,row]`);
    }
    if (!Array.isArray(ent.footprint) || ent.footprint.length < 2) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing footprint [w,h]`);
    }
    const [c, r] = ent.cell;
    const [w, h] = ent.footprint;
    if (![c, r, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new Error(`scene entities[${i}] (${ent.id}) cell/footprint must be finite numbers, got cell=[${c},${r}] fp=[${w},${h}]`);
    }
    // Centro del footprint en coordenadas mundo GLOBALES (esquina NW del
    // rect + offset de celda).
    const x = worldRect.minX + (c + w / 2) * mpc;
    const z = worldRect.minZ + (r + h / 2) * mpc;

    if (ent.kind === "player") {
      playerStart = { x, z };
      continue;
    }
    if (ent.kind === "npc") {
      if (!ent.name) {
        throw new Error(`scene entities[${i}] (npc ${ent.id}) missing name`);
      }
      npcs.push({
        id: ent.id,
        name: ent.name,
        position: [x, 0, z],
      });
      continue;
    }
    // building / prop / tree / item / decor: tree maps to prop visually.
    // decor conserva su categoría — puramente estético, sin colisión ni
    // interacción (el cliente solo bloquea building/prop).
    const category = ent.kind === "tree" ? "prop" : ent.kind;
    if (!ent.name) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing name`);
    }
    // Altura en metros: `h` de la entity si es sano (tolerante, como shape:
    // un valor inválido cae al default por kind en vez de tumbar la escena).
    const entH =
      typeof ent.h === "number" && Number.isFinite(ent.h) && ent.h > 0
        ? Math.min(ent.h, MAX_ENTITY_HEIGHT_M)
        : (KIND_DEFAULT_HEIGHT[ent.kind] ?? 1);
    const obj: Record<string, unknown> = {
      id: ent.id,
      position: [x, 0, z],
      scale: [w * mpc, entH, h * mpc],
      category,
      description: ent.name,
    };
    // Forma: explícita si es válida; si no, los árboles son redondos por defecto.
    if (ent.shape && VALID_SHAPES.has(ent.shape)) obj.shape = ent.shape;
    else if (ent.kind === "tree") obj.shape = "cylinder";
    if (ent.texture_hash) obj.texture_hash = ent.texture_hash;
    if (ent.model_hash) obj.model_hash = ent.model_hash;
    objects.push(obj);
  }

  return {
    scene_id: raw.scene_id ?? raw.room_id,
    room_id: raw.scene_id ?? raw.room_id,
    scene_description: raw.scene_description ?? raw.room_description ?? "",
    room_description: raw.scene_description ?? raw.room_description ?? "",
    dimensions: { width: cols * mpc, depth: rows * mpc, height: 3 },
    // Coordenadas del plano continuo: rect mundial de la escena/tile y, si es
    // un tile, sus coords de grid. El cliente ancla capas/colisión aquí.
    world_rect: worldRect,
    tile: tile && Number.isInteger(tile.tx) && Number.isInteger(tile.ty) ? { tx: tile.tx, ty: tile.ty } : undefined,
    terrain: { color: [0.18, 0.22, 0.14] },
    // El grid de terreno crudo (río/camino/puente/piedra…) para que el cliente
    // lo pinte en el schematic en vez de un color plano. El resto lo ignora.
    // `terrain: { color }` sigue siendo el fallback cuando esto no está.
    terrain_grid: {
      grid: terrain as string[],
      legend,
      cols,
      rows,
      meters_per_cell: mpc,
      // Esquina NW del grid en coordenadas mundo (plano continuo).
      origin: [worldRect.minX, worldRect.minZ] as [number, number],
      // Chars que bloquean movimiento (muro/agua + leyenda `{name, solid}`).
      // Los consume `createTerrainCollider`; el schematic los ignora.
      solid_chars: solidChars,
    },
    // Formas vectoriales de terreno (ríos con meandros, caminos curvos…).
    // El orden del array es el orden de pintado (río antes que puente).
    terrain_features: normalizeTerrainFeatures(raw.terrain_features),
    // Capa SVG opcional de terreno (viewBox en celdas). La valida ai_server;
    // aquí solo passthrough — el cliente la rasteriza para el schematic.
    terrain_svg: typeof raw.terrain_svg === "string" && raw.terrain_svg.trim().startsWith("<svg")
      ? raw.terrain_svg
      : undefined,
    // Plan del tile (arte plano del suelo + volúmenes tipados). Validado por
    // ai_server (y por sanitizeGroundSvg/parseVolumes en el bridge al
    // persistir retoques); aquí passthrough — el cliente compone el blueprint
    // con la perspectiva de la sesión y deriva la colisión de agua + huellas.
    map_ground: typeof raw.map_ground === "string" && raw.map_ground.trim().startsWith("<svg")
      ? raw.map_ground
      : undefined,
    volumes: Array.isArray(raw.volumes) ? raw.volumes : undefined,
    // Zona de estilo etiquetada por el motor narrativo y bioma del tile: los
    // combina el cliente (styleCategoryForTile) para elegir la referencia del
    // style pack por tile. Passthrough sin validar — ai_server sanea el enum.
    style_tag: typeof raw.style_tag === "string" ? raw.style_tag : undefined,
    biome: typeof raw.biome === "string" ? raw.biome : undefined,
    objects,
    npcs,
    ambient_event: raw.ambient_event,
    // El bridge adjunta las salidas del world map; el renderer las ignora pero
    // loadSceneData las pasa al TravelPanel.
    exits: raw.exits,
    // Metadatos para el cliente — el renderer los ignora.
    __player_start: playerStart,
    __format_d: raw,
  };
}
