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
  texture_hash?: string;
  model_hash?: string;
};

/** Formas válidas que el cliente entiende. `shape` inválido se ignora (cae a box). */
const VALID_SHAPES = new Set(["box", "cylinder", "sphere", "cone"]);

const VALID_KINDS = new Set(["player", "npc", "building", "prop", "tree", "item"]);

/** Convert a Map Format D scene to a world-coordinate scene. If `raw` is not in
 *  Format D it is returned unchanged. */
export function formatDToWorld(raw: Record<string, unknown>): WorldScene {
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
  const halfW = (cols * mpc) / 2;
  const halfD = (rows * mpc) / 2;

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
    // Centro del footprint en coordenadas mundo (origin = centro del mapa).
    const x = (c + w / 2) * mpc - halfW;
    const z = (r + h / 2) * mpc - halfD;

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
    // building / prop / tree / item: tree maps to prop visually.
    const category = ent.kind === "tree" ? "prop" : ent.kind;
    if (!ent.name) {
      throw new Error(`scene entities[${i}] (${ent.id}) missing name`);
    }
    const obj: Record<string, unknown> = {
      id: ent.id,
      position: [x, 0, z],
      scale: [w * mpc, 1, h * mpc],
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
    terrain: { color: [0.18, 0.22, 0.14] },
    // El grid de terreno crudo (río/camino/puente/piedra…) para que el cliente
    // lo pinte en el schematic en vez de un color plano. El resto lo ignora.
    // `terrain: { color }` sigue siendo el fallback cuando esto no está.
    terrain_grid: {
      grid: terrain as string[],
      legend: (raw.terrain_legend as Record<string, string>) ?? {},
      cols,
      rows,
      meters_per_cell: mpc,
    },
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
