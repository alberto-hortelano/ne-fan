/** Protocol messages between frontend (Godot/HTML) and nefan-core logic. */

import type { Vec3, CombatEvent, EnemyPersonality } from "../types.js";
import type { NpcUpdate, ScenarioUpdate } from "../scenario/scenario-types.js";
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
}

export interface PingMessage {
  type: "ping";
}

export interface LoadGameMessage {
  type: "load_game";
  gameId: string;
}

export interface ScenarioEventMessage {
  type: "scenario_event";
  event: "dialogue_advanced" | "dialogue_choice" | "exit_entered";
  data?: {
    choiceIndex?: number;
    exitWall?: string;
  };
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

export interface ListGamesMessage {
  type: "list_games";
  requestId: string;
}

export interface SaveSessionMessage {
  type: "save_session";
  requestId?: string;
}

export type ClientMessage =
  | InputMessage
  | LoadRoomMessage
  | RespawnMessage
  | PingMessage
  | LoadGameMessage
  | ScenarioEventMessage
  | ListSessionsMessage
  | StartSessionMessage
  | ResumeSessionMessage
  | DeleteSessionMessage
  | DialogueChoiceMessage
  | ListGamesMessage
  | SaveSessionMessage;

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
  npcs?: NpcUpdate[];
  scenario?: ScenarioUpdate;
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

export interface GamesListedMessage {
  type: "games_listed";
  requestId: string;
  games: Array<{ game_id: string; title: string; description?: string }>;
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
  | GamesListedMessage
  | SessionDeletedMessage
  | SessionSavedMessage;
