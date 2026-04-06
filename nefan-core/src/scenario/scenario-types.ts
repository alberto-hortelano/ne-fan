/** Type definitions for the narrative scenario system. */

import type { Vec3, EnemyPersonality } from "../types.js";

// ── Game Definition (game.json) ──

export interface GameDef {
  game_id: string;
  title: string;
  setting: GameSetting;
  player: PlayerDef;
  initial_scene: string;
  npcs: Record<string, NpcDef>;
  scenes: Record<string, SceneDef>;
  beats: Beat[];
  conversations?: Record<string, ConversationNode[]>;
}

export interface GameSetting {
  region: string;
  time_of_day: string;
  atmosphere: string;
  style_token: string;
}

export interface PlayerDef {
  role: string;
  weapon_id: string;
  hp: number;
}

export interface NpcDef {
  name: string;
  character_type: string;
  role?: string;
  personality?: string;
  combat?: {
    health: number;
    weapon_id: string;
    personality: EnemyPersonality;
  };
}

export interface SceneDef {
  file: string;
  generate?: boolean;
  description?: string;
}

// ── Narrative Beats ──

export interface Beat {
  beat_id: string;
  scene?: string;
  actions: BeatAction[];
  next?: string;
  next_trigger?: Trigger;
}

// ── Actions ──

export type BeatAction =
  | SpawnNpcAction
  | DespawnNpcAction
  | NpcMoveAction
  | NpcAnimationAction
  | SpawnEnemyAction
  | DialogueAction
  | DialogueChoiceAction
  | SetObjectiveAction
  | GiveWeaponAction
  | ChangeSceneAction
  | WaitAction
  | PlaceNpcAction
  | NpcApproachAction
  | PlaceObjectAction
  | GenerateBuildingAction
  | PlaceObjectInBuildingAction;

interface BaseAction {
  type: string;
}

export interface SpawnNpcAction extends BaseAction {
  type: "spawn_npc";
  npc_id: string;
  position: [number, number, number];
  animation?: string;
}

export interface DespawnNpcAction extends BaseAction {
  type: "despawn_npc";
  npc_id: string;
}

export interface NpcMoveAction extends BaseAction {
  type: "npc_move";
  npc_id: string;
  target: [number, number, number];
  speed?: number;
}

export interface NpcAnimationAction extends BaseAction {
  type: "npc_animation";
  npc_id: string;
  animation: string;
}

export interface SpawnEnemyAction extends BaseAction {
  type: "spawn_enemy";
  enemy_id: string;
  character_type: string;
  position: [number, number, number];
  combat: {
    health: number;
    weapon_id: string;
    personality: EnemyPersonality;
  };
}

export interface DialogueAction extends BaseAction {
  type: "dialogue";
  speaker: string;
  text: string;
}

export interface DialogueChoiceAction extends BaseAction {
  type: "dialogue_choice";
  speaker?: string;
  text: string;
  choices: string[];
  choice_beats: string[];
}

export interface SetObjectiveAction extends BaseAction {
  type: "set_objective";
  text: string;
}

export interface GiveWeaponAction extends BaseAction {
  type: "give_weapon";
  weapon_id: string;
}

export interface ChangeSceneAction extends BaseAction {
  type: "change_scene";
  scene_id: string;
}

export interface WaitAction extends BaseAction {
  type: "wait";
  duration: number;
}

// ── World Toolkit Actions ──

export interface PlaceNpcAction extends BaseAction {
  type: "place_npc";
  npc_id: string;
  near?: string;
  animation?: string;
  minDist?: number;
  maxDist?: number;
}

export interface NpcApproachAction extends BaseAction {
  type: "npc_approach";
  npc_id: string;
  target_id: string;
  stop_distance?: number;
  speed?: number;
}

export interface PlaceObjectAction extends BaseAction {
  type: "place_object";
  object_id: string;
  mesh: string;
  scale: [number, number, number];
  description: string;
  category?: string;
  near?: string;
  interactive?: boolean;
  texture_prompt?: string;
}

export interface GenerateBuildingAction extends BaseAction {
  type: "generate_building";
  building_id: string;
  width: number;
  depth: number;
  num_rooms?: number;
  wall_height?: number;
  style?: string;
  description?: string;
  position?: [number, number, number];
  near?: string;
}

export interface PlaceObjectInBuildingAction extends BaseAction {
  type: "place_object_in_building";
  object_id: string;
  building_id: string;
  room_index?: number;
  mesh: string;
  scale: [number, number, number];
  description: string;
  category?: string;
  interactive?: boolean;
  texture_prompt?: string;
}

// ── Triggers ──

export type Trigger =
  | TimerTrigger
  | ExitTrigger
  | EnemiesDefeatedTrigger
  | PlayerNearTrigger
  | DialogueCompleteTrigger;

interface BaseTrigger {
  type: string;
}

export interface TimerTrigger extends BaseTrigger {
  type: "timer";
  delay: number;
}

export interface ExitTrigger extends BaseTrigger {
  type: "exit";
  exit_wall?: string;
}

export interface EnemiesDefeatedTrigger extends BaseTrigger {
  type: "enemies_defeated";
}

export interface PlayerNearTrigger extends BaseTrigger {
  type: "player_near";
  target_id: string;
  distance: number;
}

export interface DialogueCompleteTrigger extends BaseTrigger {
  type: "dialogue_complete";
}

// ── Conversation Nodes ──

export interface ConversationNode {
  speaker: string;
  text: string;
  choices?: string[];
  choice_beats?: string[];
}

// ── Runtime NPC State ──

export interface NpcRuntimeState {
  id: string;
  npcDefId: string;
  name: string;
  characterType: string;
  position: Vec3;
  facing: Vec3;
  animation: string;
  visible: boolean;
  moveTarget: Vec3 | null;
  moveSpeed: number;
}

// ── Bridge Update Types ──

export interface NpcUpdate {
  id: string;
  pos?: { x: number; z: number };
  animation?: string;
  visible?: boolean;
  facing?: { x: number; z: number };
}

export interface ScenarioUpdate {
  dialogue?: { speaker: string; text: string; choices?: string[] };
  objective?: string;
  change_scene?: Record<string, unknown>;
  give_weapon?: string;
  spawn_npc?: {
    id: string;
    name: string;
    character_type: string;
    position: [number, number, number];
    animation: string;
  };
  despawn_npc?: string;
  spawn_enemy?: {
    id: string;
    character_type: string;
    position: [number, number, number];
    combat: {
      health: number;
      weapon_id: string;
      personality: EnemyPersonality;
    };
  };
  spawn_objects?: SpawnObjectData[];
}

export interface SpawnObjectData {
  id: string;
  mesh: string;
  position: [number, number, number];
  scale: [number, number, number];
  category: string;
  description: string;
  interactive?: boolean;
  texture_prompt?: string;
}
