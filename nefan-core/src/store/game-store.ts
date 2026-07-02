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
    meta: {
      fps: 0,
      elapsed_ms: 0,
      recording: false,
    },
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key]);
  }
  return obj;
}

export class GameStore {
  state: GameState;
  private listeners = new Map<string, EventCallback[]>();
  private globalListeners: GlobalCallback[] = [];
  private freezeInDev = false;

  constructor(initialState?: GameState) {
    this.state = initialState ?? createInitialState();
  }

  /** When enabled, snapshot() deep-freezes the returned clone so accidental
   *  consumer mutations throw in dev. Reducers still mutate `state` in place
   *  via dispatch(). Off by default for production cost. */
  setFreezeInDev(enabled: boolean): void {
    this.freezeInDev = enabled;
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
    const snap = structuredClone(this.state);
    if (this.freezeInDev) deepFreeze(snap);
    return snap;
  }

  restore(snap: GameState): void {
    this.state = structuredClone(snap);
    for (const cb of this.globalListeners) {
      cb("state_restored", {});
    }
  }
}
