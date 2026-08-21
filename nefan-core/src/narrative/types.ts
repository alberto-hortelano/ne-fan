/** Shared narrative types — schema mirrors godot/scripts/autoloads/narrative_state.gd.
 *  OJO: el espejo GD sigue en v3 — actualizarlo es un follow-up anotado. */
import type { Vec3 } from "../types.js";
import type { WorldMap } from "../world-map/types.js";
import type { PluginRecord, PluginLlmView } from "../plugins/types.js";
import type { TileEdges } from "../scene/tile-edges.js";
import type { TileCoord } from "../scene/tile.js";
import type { Consequence as WireConsequence } from "../contract/model-io/schemas.js";

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
  /** Vista del mundo ("overworld" | "proscenium"), CONGELADA al crear la
   *  sesión (game.json → view). "proscenium" = escenas discretas tipo plató
   *  enlazadas por el world map (sin plano continuo de tiles). Campo aditivo:
   *  saves previos ("") = overworld. */
  view: string;
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
  /** Modo de render del mundo 2D ("image" | "vector"), CONGELADO al crear la
   *  sesión. "image" = el modelo de imagen repinta los blueprints (créditos);
   *  "vector" = se juega con los blueprints compuestos. Campo aditivo: saves
   *  previos ("") conservan el comportamiento legacy (toggle local). */
  render_mode: string;
  /** Modo de imagen de los PERSONAJES ("image" = skins IA por descripción,
   *  "vector" = base y_bot), independiente de los escenarios. Campo aditivo:
   *  saves previos ("") siguen a render_mode (comportamiento de siempre). */
  character_mode: string;
  /** Sistema de combate (id del combatRegistry: "standard" | "basic"),
   *  CONGELADO al crear la sesión desde game.json.systems.combat. Campo
   *  aditivo: saves previos ("") = "standard". */
  combat_system: string;
  /** Catálogo de refs del style pack que el motor puede elegir por escena
   *  (`style_ref`): las de la vista activa (`scene`) y las de personaje
   *  (`characters`), cada una `{id, description}`. NO es fuente de verdad:
   *  el bridge lo RECALCULA del style.json en start_session Y resume_session
   *  (editar el pack a mano se refleja al reanudar). Campo aditivo: saves
   *  previos = listas vacías (sin catálogo, el server usa su fallback). */
  style_refs: {
    scene: Array<{ id: string; description: string }>;
    characters: Array<{ id: string; description: string }>;
    /** Refs temáticas de CARA (carpeta fps/ del pack, sin la lámina): el
     *  motor las elige por cara de volumen (`surface_ref`) para guiar las
     *  celdas hero del atlas de superficies. Solo mundos de rama tile;
     *  ausente cuando el pack no declara ninguna. */
    fps_faces?: Array<{ id: string; description: string }>;
  };
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
      /** Rol de comportamiento ambiental (peasant | guard | villager |
       *  merchant). Fluye a entity.data y lo consume el NpcBehaviorSystem;
       *  un rol desconocido degrada a villager con warning. */
      role?: string;
      [key: string]: unknown;
    }
  | { type: "schedule_event"; description: string; trigger?: string; [key: string]: unknown }
  /** Evento dirigido a un plugin declarativo (next.md §7.7 paso 2). El
   *  consequence-handler sólo lo recolecta; los efectos los resuelve el
   *  dispatcher de plugins en el nivel 3 del tick. snake_case como el resto;
   *  `event_type` evita colisionar con el discriminante `type`. */
  | { type: "plugin_event"; plugin_id: string; event_type: string; payload?: Record<string, unknown> }
  /** Sin reacción explícita. El handler no emite efecto (cae del switch) pero
   *  la consequence queda auditada en dialogue_history. */
  | { type: "noop" };

// ── Guardia de deriva (compile-time) ──
// Todo lo que el pre-flight zod admite (contract/model-io/schemas.ts) debe
// caber en el union del handler de arriba: si el SoT gana un tipo de
// consequence o cambia un campo, esta asignación deja de compilar hasta que el
// handler lo aprenda. Solo en ese sentido — el union del handler es MÁS ancho
// a propósito (dialogue_history persiste choices-objeto de saves antiguos).
// VIVE AQUÍ y no en un test porque test/ corre con tsx sin typecheck.
const _wireConsequenceFitsHandler: Consequence = null as unknown as WireConsequence;
void _wireConsequenceFitsHandler;

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
  /** Log de vida ambiental de NPCs (campo aditivo — saves previos no lo
   *  traen; default []). Cap 30 entradas, escrito por el bridge desde los
   *  NpcBehaviorEvents del sim. */
  ambient_log?: string[];
  /** Eventos programados por el motor (consequence schedule_event) aún sin
   *  resolver (campo aditivo; default []). Reaparecen en cada contexto LLM
   *  hasta que el motor los dispara y resuelve (tool scheduled_event_resolve). */
  scheduled_events?: ScheduledEventRecord[];
  _next_event_seq: number;
  /** Contador de ids de scheduled_events (aditivo; default derivado). */
  _next_sched_seq?: number;
}

/** Un schedule_event pendiente: la "agenda" del director. Persistido para que
 *  el motor lo re-vea cada turno (antes se perdía tras emitirse). */
export interface ScheduledEventRecord {
  id: string;
  description: string;
  trigger?: string;
  created_at: string;
  /** Evento de diálogo en el que se programó (procedencia). */
  event_id: string;
}

export interface SessionMetadata {
  session_id: string;
  game_id: string;
  updated_at: string;
  summary: string;
  scene_count: number;
  entity_count: number;
  /** Vista congelada en el save ("overworld" | "proscenium") — el title
   *  screen la muestra en la lista de partidas. Ausente en saves antiguos. */
  view?: string;
  /** Modo de gráficos de ESCENARIOS congelado ("image" | "vector") — si la
   *  partida gasta créditos de imagen o va en maqueta 3D. Ausente en saves
   *  antiguos. */
  render_mode?: string;
  /** Modo de imagen de PERSONAJES ("image" | "vector"). Ausente = sigue a
   *  render_mode (legacy). */
  character_mode?: string;
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
  /** Crónica del playthrough. Por encima de LLM_STORY_MAX_CHARS solo viaja
   *  la cola reciente con un marcador; la tool story_get da el texto entero
   *  (el save siempre conserva todo). */
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
  /** Total real de entidades cuando `entities` viene TRUNCADO (cap
   *  LLM_ENTITIES_MAX: escena activa completa + spawns más recientes).
   *  Ausente si la lista está completa. El índice entero se pide con la tool
   *  entity_list; el detalle por id con entity_get. */
  entities_total?: number;
  recent_dialogues: Array<{ speaker: string; chosen: string; free_text: string; npc_reply?: string }>;
  rooms_visited: number;
  /** Vida ambiental reciente (últimas 10): "guard_02 intervino en una pelea",
   *  "aldeana_1 llegó a plaza_mercado"… Contexto, no requiere reacción. */
  ambient_events?: string[];
  /** Tus schedule_event PENDIENTES (la agenda del director) — presentes hasta
   *  que los dispares y resuelvas con la tool scheduled_event_resolve(id). */
  scheduled_events?: Array<{ id: string; description: string; trigger?: string }>;
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
  /** Solo en el bootstrap del job generate_game: habilita la tool
   *  vocabulary_set — el motor puede declarar el vocabulario canónico del
   *  mundo (descripciones de superficies/fachadas y arquetipos de personaje)
   *  que los tiles futuros reutilizan verbatim (cache-hit por descripción). */
  generate_world_vocabulary?: boolean;
  /** Vocabulario canónico del mundo (data/games/{id}/world/vocabulary.json),
   *  adjuntado en turnos de tile/realize. Reusar una desc verbatim en
   *  surface_desc o como prompt de skin es un cache-hit del asset estilizado
   *  ya pintado; el reuso es opcional (mismo contrato que available_assets). */
  world_vocabulary?: Array<{
    id: string;
    kind: "surface" | "character";
    desc: string;
    roles?: string[];
  }>;
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
    /** El place del world map ANCLADO a este tile: lo que hay que construir
     *  aquí. Aparece cuando el jugador viaja por el panel «Salidas» a un
     *  lugar que aún no existía y el bridge lo ancló al plano. */
    place?: {
      id: string;
      name: string;
      kind: string;
      description: string;
      attrs: Record<string, unknown>;
    };
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
  | {
      kind: "show_dialogue";
      speaker: string;
      text: string;
      choices: (string | { text: string })[];
      /** Entidad que habla, casada por NOMBRE contra el registro
       *  (resolveSpeaker). Ausente = narrador o nombre sin NPC detrás. */
      speakerId?: string;
      /** Su prompt de skin — el cliente pinta con él el retrato del panel,
       *  incluso si el hablante no está en pantalla. */
      speakerSkinPrompt?: string;
      /** Ref de personaje del style pack elegida para ese NPC. */
      speakerStyleRef?: string;
    }
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
  | { kind: "schedule_event"; id: string; description: string; trigger?: string }
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
