/** Shared narrative types — schema mirrors godot/scripts/autoloads/narrative_state.gd. */
import type { Vec3 } from "../types.js";

export const SCHEMA_VERSION = 1;

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
  style_token: string;
  active_scene_id: string;
}

export interface SceneRecord {
  scene_data: Record<string, unknown>;
  loaded_at: string;
  asset_refs: string[];
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
  | { type: "schedule_event"; description: string; trigger?: string; [key: string]: unknown };

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
    scene_id: string;
    position: [number, number, number];
    spawn_reason: string;
  }>;
  recent_dialogues: Array<{ speaker: string; chosen: string; free_text: string }>;
  rooms_visited: number;
  available_assets?: AssetEntry[];
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
  | { kind: "ambient_message"; message: string };
