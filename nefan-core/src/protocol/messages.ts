/** Protocol messages between frontend (Godot/HTML) and nefan-core logic. */

import type { Vec3, CombatEvent, EnemyPersonality } from "../types.js";
import type { Edge } from "../world-map/types.js";
import type {
  Consequence,
  ConsequenceEffect,
  SessionData,
  SessionMetadata,
} from "../narrative/types.js";

// ── Frontend → Logic ──

export interface InputMessage {
  type: "input";
  delta: number;
  inputs: {
    playerPosition: Vec3;
    playerForward: Vec3;
    playerMoving: boolean;
    attackRequested?: boolean;
    attackType?: string;
  };
}

export interface LoadRoomMessage {
  type: "load_room";
  roomId: string;
  dimensions?: { width: number; depth: number };
  enemies: {
    id: string;
    position: Vec3;
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[];
}

export interface RespawnMessage {
  type: "respawn";
  /** Punto de reaparición en coordenadas globales (el cliente elige un punto
   *  libre cercano en el tile actual). Ausente = legacy (0,0,4). */
  pos?: Vec3;
}

export interface PingMessage {
  type: "ping";
}

export interface ListSessionsMessage {
  type: "list_sessions";
  requestId: string;
}

export interface StartSessionMessage {
  type: "start_session";
  requestId: string;
  gameId: string;
  appearance?: { model_id: string; skin_path: string };
  /** Estilo visual elegido en el título; ausente = el por defecto del juego.
   *  Queda CONGELADO en el save al crear la sesión. */
  styleId?: string;
  /** Perspectiva del mundo 2D ("topdown" | "isometric") elegida en el título;
   *  ausente = default_perspective del juego (o "topdown"). Queda CONGELADA
   *  en el save — cambia la proyección de TODOS los blueprints/tiles, así que
   *  no puede variar a mitad de partida. */
  perspective?: string;
  /** Modo de render del mundo 2D elegido en el título: "image" (el modelo de
   *  imagen repinta cada blueprint — gasta créditos) | "vector" (el mundo se
   *  ve con los blueprints compuestos del plan del motor narrativo — gratis).
   *  Ausente = "image". Congelado en el save: mezclar tiles pintados y
   *  vectoriales rompe la continuidad visual entre vecinos. */
  renderMode?: string;
}

export interface ResumeSessionMessage {
  type: "resume_session";
  requestId: string;
  sessionId: string;
}

export interface DeleteSessionMessage {
  type: "delete_session";
  requestId: string;
  sessionId: string;
}

export interface DialogueChoiceMessage {
  type: "dialogue_choice";
  requestId?: string;
  eventId: string;
  choiceIndex: number;
  freeText?: string;
  speaker: string;
  chosenText: string;
}

/** Crear un mundo de usuario: el borrador (textarea o archivo .md/.txt) se
 *  desarrolla con el motor narrativo contra la plantilla y el bridge escribe
 *  data/games/user_{slug}/. Respuesta: game_created. */
export interface CreateGameMessage {
  type: "create_game";
  requestId: string;
  draftText: string;
}

export interface ListGamesMessage {
  type: "list_games";
  requestId: string;
}

export interface SaveSessionMessage {
  type: "save_session";
  requestId?: string;
}

/** The player walked into a world-map place. The bridge realizes the place's
 *  low-level scene on demand (lazy realize): if it already has a scene it is
 *  re-broadcast, otherwise the narrative engine generates one. */
export interface PlayerEnteredPlaceMessage {
  type: "player_entered_place";
  placeId: string;
}

/** El jugador salió por un borde de la escena que NO tiene destino conocido en
 *  el world map. El bridge pide al motor narrativo extender el mundo en esa
 *  dirección: crear place + link (con edge) + escena on-the-fly.
 *  @deprecated con el plano de tiles delega en request_tile (se mantiene por
 *  compat con clientes de la tanda 2). */
export interface PlayerCrossedFrontierMessage {
  type: "player_crossed_frontier";
  edge: Edge;
}

/** Petición de un tile del plano continuo. `prefetch` = el jugador se acerca
 *  al borde (generar en segundo plano, sin activar); `blocking` = está pegado
 *  al borde esperando. Si el tile ya existe, el bridge lo re-difunde al
 *  instante sin LLM (re-render al volver). */
export interface RequestTileMessage {
  type: "request_tile";
  tx: number;
  ty: number;
  reason: "prefetch" | "blocking";
  /** Borde del tile ACTUAL por el que se acerca/espera el jugador (para el
   *  velo direccional y el `entry` del motor). */
  edge?: Edge;
}

/** Análisis de la imagen IA de un tile (mundo derivado de la imagen): el
 *  cliente lo envía tras clasificar los segmentos por visión. Solo
 *  persistencia — el bridge lo guarda en el SceneRecord del tile y lo resume
 *  al motor narrativo; no dispara LLM. `rect` en coords MUNDO globales. */
export interface TileAnalysisMessage {
  type: "tile_analysis";
  tx: number;
  ty: number;
  elements: Array<{
    label: string;
    solid: boolean;
    tall: boolean;
    rect: { minX: number; maxX: number; minZ: number; maxZ: number };
  }>;
}

/** El retoque de visión (blueprint_review) corrigió el plan de un tile
 *  (arte del suelo y/o volúmenes): persistirlo en el SceneRecord (el bridge
 *  es el único escritor del save). También se envía SIN cambios tras un
 *  review aprobado, para estampar `map_plan_reviewed` y que el resume no
 *  re-revise. Solo persistencia. */
export interface MapPlanUpdateMessage {
  type: "map_plan_update";
  tx: number;
  ty: number;
  /** SVG plano del suelo corregido (documento COMPLETO), si cambió. */
  map_ground?: string;
  /** Array COMPLETO de volúmenes corregido, si cambió. */
  volumes?: unknown[];
}

/** Alta ADITIVA de combatientes en el sim (enemigos de un tile nuevo). No
 *  resetea nada: los combatientes de otros tiles siguen vivos. */
export interface AddCombatantsMessage {
  type: "add_combatants";
  enemies: {
    id: string;
    position: Vec3;
    health: number;
    weaponId: string;
    personality: EnemyPersonality;
  }[];
}

/** Salida que el bridge adjunta a toda escena difundida (enrichSceneWithExits,
 *  derivada de los links del world map). El cliente la usa para el TravelPanel
 *  y para la transición continua al cruzar un borde. */
export interface SceneExit {
  place_id: string;
  name: string;
  link_kind: string;
  travel_hours?: number;
  description?: string;
  /** Lado de ESTA escena donde está la salida; ausente si no se pudo resolver. */
  edge?: Edge;
}

/** The player walked up to an entity (NPC) and pressed the interact key. The
 *  bridge reports it to the narrative engine, which replies with consequences
 *  (typically a show_dialogue effect). */
export interface InteractEntityMessage {
  type: "interact_entity";
  entityId: string;
  entityName: string;
}

export type ClientMessage =
  | InputMessage
  | LoadRoomMessage
  | RespawnMessage
  | PingMessage
  | ListSessionsMessage
  | StartSessionMessage
  | ResumeSessionMessage
  | DeleteSessionMessage
  | DialogueChoiceMessage
  | CreateGameMessage
  | ListGamesMessage
  | SaveSessionMessage
  | PlayerEnteredPlaceMessage
  | PlayerCrossedFrontierMessage
  | RequestTileMessage
  | TileAnalysisMessage
  | MapPlanUpdateMessage
  | AddCombatantsMessage
  | InteractEntityMessage;

// ── Logic → Frontend ──

export interface StateUpdateMessage {
  type: "state_update";
  events: CombatEvent[];
  playerHp: number;
  enemies: {
    id: string;
    hp: number;
    state: string;
    alive: boolean;
    pos?: { x: number; y: number; z: number };
    forward?: { x: number; y: number; z: number };
    attackType?: string;
  }[];
}

export interface PongMessage {
  type: "pong";
}

export interface SessionsListedMessage {
  type: "sessions_listed";
  requestId: string;
  sessions: SessionMetadata[];
}

export interface SessionStartedMessage {
  type: "session_started";
  requestId: string;
  ok: boolean;
  sessionId?: string;
  gameId?: string;
  isResume?: boolean;
  state?: SessionData;
  scene?: Record<string, unknown>;
  error?: string;
}

export interface NarrativeEventMessage {
  type: "narrative_event";
  eventId: string;
  consequences: Consequence[];
  effects: ConsequenceEffect[];
}

/** Lifecycle hint for long-running narrative work so clients can show a loader.
 *  Phase: "generating" (LLM dispatched, awaiting), "ready" (scene applied),
 *  "error" (LLM call failed — surfaced verbatim, no silent placeholder). */
export interface NarrativeStatusMessage {
  type: "narrative_status";
  phase: "generating" | "ready" | "error";
  kind: "scene" | "consequences" | "tile";
  message?: string;
  elapsedMs?: number;
  /** Tile al que se refiere el status (kind "tile") — el cliente pinta el
   *  velo/notificación direccional con esto. */
  tile?: { tx: number; ty: number };
  /** Borde del tile ACTUAL del jugador hacia el que se genera/completó. */
  edge?: Edge;
}

export interface GamesListedMessage {
  type: "games_listed";
  requestId: string;
  games: Array<{
    game_id: string;
    title: string;
    description: string;
    /** Estilo visual por defecto del juego (el jugador puede cambiarlo). */
    style_id: string;
    /** Perspectiva 2D por defecto del juego ("topdown" si falta). */
    default_perspective?: string;
    /** Resumen del mundo (~1.200 chars) — la tarjeta puede mostrar un extracto. */
    world_brief: string;
  }>;
  /** Estilos disponibles para el selector; cover_url se sirve en el State
   *  API del bridge (GET /styles/{id}/{file}, puerto :9878). */
  styles: Array<{
    style_id: string;
    name: string;
    description: string;
    cover_url?: string;
  }>;
}

export interface GameCreatedMessage {
  type: "game_created";
  requestId: string;
  ok: boolean;
  gameId?: string;
  title?: string;
  error?: string;
}

export interface SessionDeletedMessage {
  type: "session_deleted";
  requestId: string;
  ok: boolean;
}

export interface SessionSavedMessage {
  type: "session_saved";
  requestId?: string;
  ok: boolean;
}

export type ServerMessage =
  | StateUpdateMessage
  | PongMessage
  | SessionsListedMessage
  | SessionStartedMessage
  | NarrativeEventMessage
  | NarrativeStatusMessage
  | GamesListedMessage
  | GameCreatedMessage
  | SessionDeletedMessage
  | SessionSavedMessage;
