/** Centralized state store. Read anywhere, write only via dispatch().
 *  Direct port of godot/scripts/autoloads/game_store.gd */

import type { GameState } from "../types.js";
import { applyReducer } from "./reducers.js";

export type EventCallback = (payload: Record<string, unknown>) => void;
export type GlobalCallback = (eventName: string, payload: Record<string, unknown>) => void;

export function createInitialState(): GameState {
  return {
    world: {
      room_id: "",
      room_data: {},
      rooms_visited: {},
      region: "forgotten_depths",
      time_of_day: "night",
      atmosphere: "ominous",
    },
    player: {
      pos: [0, 0, 0],
      velocity: [0, 0, 0],
      camera_yaw: 0,
      camera_pitch: 0,
      hp: 100,
      max_hp: 100,
      weapon_id: "short_sword",
      combat_state: "idle",
      attack_type: "",
      level: 1,
      class: "rogue",
      gold: 0,
      inventory: [],
      active_quests: [],
    },
    enemies: [],
    narrative: {
      story_so_far: "",
      last_dialogue: "",
      last_interaction: "",
    },
    meta: {
      fps: 0,
      elapsed_ms: 0,
      recording: false,
    },
  };
}

export class GameStore {
  state: GameState;
  private listeners = new Map<string, EventCallback[]>();
  private globalListeners: GlobalCallback[] = [];

  constructor(initialState?: GameState) {
    this.state = initialState ?? createInitialState();
  }

  dispatch(eventName: string, payload: Record<string, unknown> = {}): void {
    applyReducer(this.state, eventName, payload);
    for (const cb of this.globalListeners) {
      cb(eventName, payload);
    }
    const cbs = this.listeners.get(eventName);
    if (cbs) {
      for (const cb of cbs) {
        cb(payload);
      }
    }
  }

  on(eventName: string, callback: EventCallback): void {
    const cbs = this.listeners.get(eventName) ?? [];
    cbs.push(callback);
    this.listeners.set(eventName, cbs);
  }

  off(eventName: string, callback: EventCallback): void {
    const cbs = this.listeners.get(eventName);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    }
  }

  onAll(callback: GlobalCallback): void {
    this.globalListeners.push(callback);
  }

  snapshot(): GameState {
    return structuredClone(this.state);
  }

  restore(snap: GameState): void {
    this.state = structuredClone(snap);
    for (const cb of this.globalListeners) {
      cb("state_restored", {});
    }
  }
}
