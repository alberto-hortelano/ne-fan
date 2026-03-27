/** Protocol messages between frontend (Godot/HTML) and nefan-core logic. */

import type { Vec3, CombatEvent, EnemyPersonality } from "../types.js";

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

export type ClientMessage = InputMessage | LoadRoomMessage | RespawnMessage | PingMessage;

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

export type ServerMessage = StateUpdateMessage | PongMessage;
