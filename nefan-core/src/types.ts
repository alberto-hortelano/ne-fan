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

/** LO QUE EL JUGADOR PUEDE HACER, en números editables sin recompilar.
 *
 *  Las dos velocidades y la escala de arcade salen juntas porque el metro por
 *  segundo real del juego es su producto: el `walk_speed` de aquí es la
 *  velocidad HUMANA (1,9 m/s es andar de verdad) y `speed_scale` es lo que se
 *  le sube para que el mundo abierto no se haga eterno. Antes ese multiplicador
 *  vivía en el cliente (`ARCADE_SPEED_SCALE`, #241), así que el config decía
 *  1,9 y el jugador andaba a 4,18 sin que ningún fichero lo dijera. */
export interface PlayerConfig {
  /** m/s andando, antes de `speed_scale`. */
  walk_speed: number;
  /** m/s esprintando, antes de `speed_scale`. */
  sprint_speed: number;
  /** Multiplicador de arcade sobre las dos velocidades. OJO al heredarlo: el
   *  2,2 se calibró para la vista CENITAL, donde el jugador se veía entero y el
   *  mundo pasaba por debajo. En primera persona nadie lo ha vuelto a mirar —
   *  4,2 m/s de paseo es un trote largo a la altura de los ojos. Es una
   *  decisión de feel, no un bug, así que se queda hasta que se juegue y se
   *  decida. */
  speed_scale: number;
  /** Alcance de la tecla E en METROS: hasta dónde llega el jugador para hablar
   *  con alguien (`pickNearestTarget` lo usa como `maxDistanceM`). */
  interact_range_m: number;
}

export interface CombatConfig {
  attack_types: Record<string, AttackType>;
  weapons: Record<string, Weapon>;
  tactical_matrix: Record<string, Record<string, number>>;
  player: PlayerConfig;
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
  /** A qué distancia ataca. OBLIGATORIO, y no es una promesa nueva: es la que
   *  el borde ya EXIGÍA. `parseHostileCombat` —el único criterio de «qué es un
   *  enemigo utilizable», y lo aplican las dos puertas— rechaza en runtime al
   *  que no lo trae, así que dejarlo opcional aquí era un tipo que compilaba lo
   *  que el cable tira (#530). La garantía va en el tipo. */
  combat_range: number;
  difficulty?: string;
  aggression_style?: string;
  /** Distancia (m) a la que el enemigo empieza a hacer caso al jugador.
   *  Ausente = sin puerta (comportamiento histórico: persigue desde donde
   *  esté). Ver EnemyAI.aggroRadius. */
  aggro_radius?: number;
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
  region: string;
  time_of_day: string;
  atmosphere: string;
}

export interface GameState {
  world: WorldState;
  player: PlayerState;
  enemies: EnemyState[];
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
