/** Difficulty and aggression presets for enemy AI.
 *  3 difficulty levels × 3 aggression styles = 9 combinations. */

export interface DifficultyParams {
  reaction_time: number;
  aggression: number;
  dodge_chance: number;
  damage_mult: number;
  move_speed: number;
}

export interface AggressionParams {
  attack_cooldown_mult: number;
  block_chance: number;
  preferred_distance: number;
}

export const DIFFICULTY: Record<string, DifficultyParams> = {
  easy:   { reaction_time: 1.0, aggression: 0.4, dodge_chance: 0.1, damage_mult: 0.7, move_speed: 1.5 },
  medium: { reaction_time: 0.5, aggression: 0.6, dodge_chance: 0.3, damage_mult: 1.0, move_speed: 2.0 },
  hard:   { reaction_time: 0.2, aggression: 0.8, dodge_chance: 0.6, damage_mult: 1.3, move_speed: 2.5 },
};

export const AGGRESSION_STYLE: Record<string, AggressionParams> = {
  defensive:  { attack_cooldown_mult: 1.5, block_chance: 0.6, preferred_distance: 3.5 },
  neutral:    { attack_cooldown_mult: 1.0, block_chance: 0.3, preferred_distance: 2.5 },
  aggressive: { attack_cooldown_mult: 0.6, block_chance: 0.1, preferred_distance: 1.5 },
};

export function buildPersonality(
  difficulty: string = "medium",
  aggressionStyle: string = "neutral",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const agg = AGGRESSION_STYLE[aggressionStyle] ?? AGGRESSION_STYLE.neutral;
  return {
    ...diff,
    ...agg,
    preferred_attacks: ["quick", "medium", "heavy"],
    combat_range: 4.0,
    ...overrides,
  };
}
