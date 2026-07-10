/** Shared narrative types — schema mirrors godot/scripts/autoloads/narrative_state.gd.
 *  OJO: el espejo GD sigue en v3 — actualizarlo es un follow-up anotado. */
import type { Vec3 } from "../types.js";
import type { WorldMap } from "../world-map/types.js";
import type { PluginRecord, PluginLlmView } from "../plugins/types.js";
import type { TileEdges } from "../scene/tile-edges.js";
import type { TileCoord } from "../scene/tile.js";

// v3: añade `plugins: PluginRecord[]` (migración v2→v3: lista vacía).
// v4: plano continuo de tiles — SceneRecord gana tile/edges, las posiciones de
//     EntityRecord pasan a metros globales, y la escena activa v3 se envuelve
//     como tile (0,0) al cargar (migración sin mover al jugador).
export const SCHEMA_VERSION = 4;

export interface PlayerAppearance {
  model_id: string;
  skin_path: string;
}

export interface NarrativePlayerState {
  level: number;
  class: string;
  health: number;
  gold: number;
  inventory: unknown[];
  appearance: PlayerAppearance;
  position: [number, number, number];
  current_scene_id: string;
}

export interface NarrativeWorldState {
  name: string;
  atmosphere: string;
  /** Token de texto del estilo visual (prompts de imagen). Viene del
   *  style.json del estilo congelado en la sesión. */
  style_token: string;
  active_scene_id: string;
  /** Resumen del mundo (world_brief del game.json, ~1.200 chars). Viaja al
   *  LLM en CADA turno vía serializeForLlm; el documento completo (world.md)
   *  solo va en el bootstrap y bajo demanda (tool world_doc_get). */
  description: string;
  /** Estilo visual CONGELADO al crear la sesión: editar el pack después no
   *  afecta a partidas en curso (costuras entre tiles ya pintados). */
  style_id: string;
  /** sha256 del world.md con el que se creó la sesión — clave de caches
   *  (initial_scene_cache) y detección de ediciones del mundo. */
  world_doc_hash: string;
  /** Perspectiva del mundo 2D ("topdown" | "isometric"), CONGELADA al crear
   *  la sesión como el estilo — los blueprints de todos los tiles se
   *  componen con ella. Campo aditivo: saves previos la dejan en "" y el
   *  cliente la trata como "topdown". */
  perspective: string;
  /** Modo de render del mundo 2D ("image" | "vector"), CONGELADO al crear la
   *  sesión. "image" = el modelo de imagen repinta los blueprints (créditos);
   *  "vector" = se juega con los blueprints compuestos. Campo aditivo: saves
   *  previos ("") conservan el comportamiento legacy (toggle local). */
  render_mode: string;
  /** Sistema de combate (id del combatRegistry: "standard" | "basic"),
   *  CONGELADO al crear la sesión desde game.json.systems.combat. Campo
   *  aditivo: saves previos ("") = "standard". */
  combat_system: string;
}

/** Un elemento jugable del ANÁLISIS de la imagen IA de un tile: lo que la
 *  visión clasificó sobre lo realmente pintado. `rect` en coords MUNDO. */
export interface AnalyzedElement {
  label: string;
  solid: boolean;
  tall: boolean;
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Análisis de la imagen de un tile (mundo derivado de la imagen): el mapa
 *  REAL del tile, que puede diferir del esquema (el modelo de imagen inventa
 *  estructuras). El motor narrativo lo recibe resumido como ground truth. */
export interface TileAnalysisRecord {
  analyzed_at: string;
  elements: AnalyzedElement[];
}

export interface SceneRecord {
  scene_data: Record<string, unknown>;
  loaded_at: string;
  asset_refs: string[];
  /** Coords del tile del plano continuo (Format D v3). Ausente = escena
   *  legacy accesible solo por TravelPanel/player_entered_place. */
  tile?: TileCoord;
  /** Resumen de costuras por borde (computeTileEdges sobre el expandido) —
   *  contexto de vecinos para generar tiles adyacentes sin re-expandir. */
  edges?: TileEdges;
  /** Análisis de la imagen IA del tile (opcional; lo envía el cliente 2D
   *  tras analizar). Campo aditivo — no requiere bump de schema. */
  analysis?: TileAnalysisRecord;
}

export interface EntityRecord {
  id: string;
  type: string;
  scene_id: string;
  spawned_at: string;
  spawn_reason: string;
  spawn_event_id: string;
  position: [number, number, number];
  data: Record<string, unknown>;
  asset_refs: string[];
}

export interface DialogueChoice {
  text: string;
  [key: string]: unknown;
}

export interface DialogueEvent {
  id: string;
  timestamp: string;
  scene_id: string;
  speaker: string;
  text: string;
  choices: DialogueChoice[] | string[];
  chosen_index: number;
  free_text: string;
  narrative_consequences: Consequence[];
}

export type Consequence =
  | { type: "dialogue"; speaker: string; text: string; choices?: (DialogueChoice | string)[] }
  | { type: "story_update"; delta: string }
  | {
      type: "spawn_entity";
      entity_kind: "npc" | "object" | "building";
      description: string;
      position_hint?: string;
      name?: string;
      texture_hash?: string;
      model_hash?: string;
      character_type?: string;
      [key: string]: unknown;
    }
  | { type: "schedule_event"; description: string; trigger?: string; [key: string]: unknown }
  /** Evento dirigido a un plugin declarativo (next.md §7.7 paso 2). El
   *  consequence-handler sólo lo recolecta; los efectos los resuelve el
   *  dispatcher de plugins en el nivel 3 del tick. snake_case como el resto;
   *  `event_type` evita colisionar con el discriminante `type`. */
  | { type: "plugin_event"; plugin_id: string; event_type: string; payload?: Record<string, unknown> };

export interface SessionData {
  schema_version: number;
  session_id: string;
  game_id: string;
  created_at: string;
  updated_at: string;
  world: NarrativeWorldState;
  player: NarrativePlayerState;
  story_so_far: string;
  scenes_loaded: Record<string, SceneRecord>;
  entities: EntityRecord[];
  dialogue_history: DialogueEvent[];
  asset_index_snapshot: AssetEntry[];
  world_map: WorldMap;
  /** v3 — registro de plugins activos (§7.6 de next.md). */
  plugins: PluginRecord[];
  _next_event_seq: number;
}

export interface SessionMetadata {
  session_id: string;
  game_id: string;
  updated_at: string;
  summary: string;
  scene_count: number;
  entity_count: number;
}

export interface AssetEntry {
  hash: string;
  type: string;
  subtype: string;
  prompt: string;
  created_at: string;
  size_bytes: number;
  extra?: Record<string, unknown>;
}

export interface LlmContext {
  session_id: string;
  game_id: string;
  world: NarrativeWorldState;
  player: NarrativePlayerState;
  story_so_far: string;
  current_scene_id: string;
  entities: Array<{
    id: string;
    type: string;
    name?: string;
    scene_id: string;
    position: [number, number, number];
    spawn_reason: string;
  }>;
  recent_dialogues: Array<{ speaker: string; chosen: string; free_text: string }>;
  rooms_visited: number;
  /** Documento COMPLETO del mundo (world.md). Solo se adjunta en el request
   *  de bootstrap de una sesión nueva — en turnos posteriores el motor usa
   *  world.description y la tool world_doc_get. */
  world_document?: string;
  /** Resumen del análisis de la imagen del tile ACTIVO (mundo derivado de la
   *  imagen): lo que hay pintado DE VERDAD, incluidas estructuras que el
   *  modelo de imagen inventó y no están en el esquema. Ground truth del
   *  mundo jugable — sitúa la narrativa sobre esto, no sobre el esquema. */
  scene_analysis?: {
    scene_id: string;
    /** "muralla (sólido, alto) x[-5..30] z[5..13]" — máx ~20 elementos. */
    elements: string[];
    total: number;
  };
  /** Plugins declarativos activos, resumidos por sus derived_views (F6, §7.6).
   *  Sólo presente si hay plugins activos. El detalle se pide con plugin_inspect. */
  plugins?: PluginLlmView[];
  available_assets?: AssetEntry[];
  /** Set on the first scene request of a fresh session: the narrative engine
   *  should bootstrap the world map (3-5 places + their sites + links) via the
   *  map tools before generating the starting scene. */
  bootstrap_world_map?: boolean;
  /** Present only on lazy-realize scene requests: the world-map place the
   *  player just entered, so the narrative engine builds a scene that fits it. */
  realize_place?: {
    id: string;
    kind: string;
    name: string;
    description: string;
    attrs: Record<string, unknown>;
    sites: Array<{ id: string; kind: string; name: string; description: string }>;
    links: unknown[];
  };
  /** Solo en peticiones de frontera: el jugador salió por `edge` de la escena
   *  que realiza `from_place_id` y el world map no tiene destino en esa
   *  dirección. El motor debe crear place + link (con edge) + escena.
   *  @deprecated con el plano de tiles el bridge delega en generate_tile. */
  frontier_request?: {
    from_place_id: string;
    from_place_name: string;
    edge: "north" | "south" | "east" | "west";
  };
  /** Petición de un TILE del plano continuo (Format D v3): coords, contexto
   *  de costuras de los vecinos ya generados (bioma + cruces del borde
   *  compartido, con `at` espejo sin transformación), por dónde entra el
   *  jugador, y places cercanos. */
  generate_tile?: {
    tx: number;
    ty: number;
    neighbors: Partial<Record<"north" | "south" | "east" | "west", {
      tile: [number, number];
      scene_id: string;
      description: string;
      biome: string;
      crossings: Array<{ type: string; at: number; width: number }>;
      /** Elementos REALES de la imagen pintada del vecino que tocan el borde
       *  compartido (análisis por visión): el LLM debe continuar las
       *  estructuras grandes (murallas, ríos) que cruzan la costura.
       *  `at` = rango de celdas a lo largo del borde (misma coordenada en
       *  ambos lados, como crossings). */
      image_elements?: Array<{
        label: string;
        solid: boolean;
        tall: boolean;
        at: [number, number];
      }>;
    }>>;
    /** Borde del TILE NUEVO por el que entra el jugador (opuesto al cruzado). */
    entry?: { edge: "north" | "south" | "east" | "west"; at?: number };
    nearby_places: Array<{ id: string; name: string; kind: string; tile?: [number, number] }>;
    /** true solo en el primer tile de una sesión nueva (lleva player + place). */
    bootstrap?: boolean;
  };
}

export type Vec3Like = Vec3 | [number, number, number];

export function toTuple(v: Vec3Like): [number, number, number] {
  if (Array.isArray(v)) return [v[0], v[1], v[2]];
  return [v.x, v.y, v.z];
}

/** Renderer-agnostic effects produced by dispatchConsequences. Lives here (not
 * in consequence-handler.ts) so the browser bundle can import the type without
 * pulling in Node-only modules. */
export type ConsequenceEffect =
  | { kind: "show_dialogue"; speaker: string; text: string; choices: (string | { text: string })[] }
  | { kind: "story_delta"; delta: string }
  | {
      kind: "spawn_entity";
      entityId: string;
      entityKind: "npc" | "object" | "building";
      description: string;
      name?: string;
      position: [number, number, number];
      data: Record<string, unknown>;
      eventId: string;
    }
  | { kind: "schedule_event"; description: string; trigger?: string }
  | { kind: "ambient_message"; message: string }
  /** Tick de plugins aplicado (F4): qué plugin procesó qué evento, qué paths
   *  cambiaron (externos + plugins.<id>.slice) y qué eventos emitió. Los
   *  clientes que no lo entiendan deben ignorar kinds desconocidos. */
  | {
      kind: "plugin_applied";
      pluginId: string;
      eventType: string;
      changedPaths: string[];
      emitted: Array<{ type: string; payload: unknown }>;
    };
