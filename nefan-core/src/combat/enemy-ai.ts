/** Enemy AI decision logic — tick-based, seeded RNG.
 *  Port of godot/scripts/combat/enemy_combat_ai.gd */

import type { CombatantState, EnemyPersonality, CombatConfig, CombatEvent } from "../types.js";
import { distance } from "../vec3.js";
import { getEffectiveWindUp } from "./combat-data.js";
import * as Combatant from "./combatant.js";

/** Simple seeded PRNG (xoshiro128) for deterministic replay */
export class SeededRng {
  private s: Uint32Array;

  constructor(seed: number = Date.now()) {
    this.s = new Uint32Array(4);
    this.s[0] = seed >>> 0;
    this.s[1] = (seed * 1812433253 + 1) >>> 0;
    this.s[2] = (this.s[1] * 1812433253 + 1) >>> 0;
    this.s[3] = (this.s[2] * 1812433253 + 1) >>> 0;
  }

  /** Returns float in [0, 1) */
  next(): number {
    const result = (this.s[0] + this.s[3]) >>> 0;
    const t = (this.s[1] << 9) >>> 0;
    this.s[2] ^= this.s[0];
    this.s[3] ^= this.s[1];
    this.s[1] ^= this.s[2];
    this.s[0] ^= this.s[3];
    this.s[2] ^= t;
    this.s[3] = ((this.s[3] << 11) | (this.s[3] >>> 21)) >>> 0;
    return (result >>> 0) / 4294967296;
  }

  /** Returns int in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

export class EnemyAI {
  readonly combatantId: string;
  aggression: number;
  preferredAttacks: string[];
  reactionTime: number;
  combatRange: number;
  private timer = 0;
  private rng: SeededRng;
  private config: CombatConfig;

  constructor(
    combatantId: string,
    personality: EnemyPersonality,
    config: CombatConfig,
    rng?: SeededRng,
  ) {
    this.combatantId = combatantId;
    this.aggression = personality.aggression;
    this.preferredAttacks = personality.preferred_attacks;
    this.reactionTime = personality.reaction_time;
    this.combatRange = personality.combat_range ?? 4.0;
    this.config = config;
    this.rng = rng ?? new SeededRng();
  }

  tick(
    delta: number,
    self: CombatantState,
    target: CombatantState,
  ): CombatEvent[] {
    if (self.health <= 0 || target.health <= 0) return [];

    this.timer += delta;
    if (this.timer < this.reactionTime) return [];
    this.timer = 0;

    // Range check
    const dist = distance(self.position, target.position);
    if (dist > this.combatRange) return [];

    // Aggression roll
    if (this.rng.next() > this.aggression) return [];

    // Pick attack
    const chosen = this.pickAttack(dist);
    if (!chosen) return [];

    // Calculate wind-up
    const weaponData = this.config.weapons[self.weaponId]
      ?? this.config.weapons["unarmed"];
    const attackType = this.config.attack_types[chosen];
    if (!attackType) return [];

    const windUp = getEffectiveWindUp(attackType, weaponData, chosen);
    return Combatant.startAttack(self, chosen, windUp);
  }

  private pickAttack(dist: number): string {
    const candidates = [...this.preferredAttacks];
    if (candidates.length === 0) candidates.push("medium");

    if (dist < 1.5 && this.config.attack_types["quick"]) {
      candidates.push("quick");
    } else if (dist > 2.5 && this.config.attack_types["heavy"]) {
      candidates.push("heavy");
    }

    return candidates[this.rng.nextInt(candidates.length)];
  }
}
