export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AttackType {
  display_name: string;
  wind_up_time: number;
  optimal_distance: number;
  distance_tolerance: number;
  area_radius: number;
  base_damage: number;
  damage_reduction: number;
}

export interface WeaponModifiers {
  damage_multiplier?: number;
  optimal_distance_offset?: number;
  area_radius_multiplier?: number;
  wind_up_multiplier?: number;
}

export interface Weapon {
  display_name: string;
  wind_up_modifier: number;
  modifiers: Record<string, WeaponModifiers>;
}

export interface CombatConfig {
  attack_types: Record<string, AttackType>;
  weapons: Record<string, Weapon>;
  tactical_matrix: Record<string, Record<string, number>>;
}

export type CombatState = "idle" | "moving" | "winding_up" | "attacking" | "dead";

export interface CombatantState {
  id: string;
  health: number;
  maxHealth: number;
  weaponId: string;
  state: CombatState;
  currentAttackType: string;
  windUpTimer: number;
  windUpDuration: number;
  position: Vec3;
  forward: Vec3;
}

export interface EnemyPersonality {
  aggression: number;
  preferred_attacks: string[];
  reaction_time: number;
  combat_range?: number;
  difficulty?: string;
  aggression_style?: string;
  dodge_chance?: number;
  damage_mult?: number;
  attack_cooldown_mult?: number;
  block_chance?: number;
  preferred_distance?: number;
  move_speed?: number;
}

export interface PlayerState {
  pos: number[];
  velocity: number[];
  camera_yaw: number;
  camera_pitch: number;
  hp: number;
  max_hp: number;
  weapon_id: string;
  combat_state: string;
  attack_type: string;
  level: number;
  class: string;
  gold: number;
  inventory: unknown[];
  active_quests: unknown[];
}

export interface EnemyState {
  id: string;
  pos: number[];
  hp: number;
  max_hp: number;
  weapon_id: string;
  combat_state: string;
  alive: boolean;
}

export interface WorldState {
  room_id: string;
  room_data: Record<string, unknown>;
  rooms_visited: Record<string, unknown>;
  region: string;
  time_of_day: string;
  atmosphere: string;
}

export interface GameState {
  world: WorldState;
  player: PlayerState;
  enemies: EnemyState[];
  narrative: {
    story_so_far: string;
    last_dialogue: string;
    last_interaction: string;
  };
  meta: {
    fps: number;
    elapsed_ms: number;
    recording: boolean;
  };
}

export interface EffectiveParams {
  optimal_distance: number;
  distance_tolerance: number;
  area_radius: number;
  base_damage: number;
  damage_reduction: number;
  wind_up_time: number;
}

export interface CombatEvent {
  type: string;
  [key: string]: unknown;
}
