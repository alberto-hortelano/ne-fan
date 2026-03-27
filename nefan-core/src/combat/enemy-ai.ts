/** Enemy AI — movement, attack decisions, blocking, dodging.
 *  FSM: APPROACH → COMBAT → RETREAT. Configurable difficulty + aggression. */

import type { CombatantState, EnemyPersonality, CombatConfig, CombatEvent } from "../types.js";
import { distanceXZ, sub, normalized, scale, add } from "../vec3.js";
import { getEffectiveWindUp } from "./combat-data.js";
import { buildPersonality } from "./difficulty-presets.js";
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

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

export class EnemyAI {
  readonly combatantId: string;

  // Core params
  aggression: number;
  preferredAttacks: string[];
  reactionTime: number;
  combatRange: number;

  // Movement
  moveSpeed: number;
  preferredDistance: number;

  // Difficulty
  dodgeChance: number;
  damageMult: number;
  blockChance: number;
  attackCooldownMult: number;

  // Internal state
  private timer = 0;
  private cooldownTimer = 0;
  private rng: SeededRng;
  private config: CombatConfig;

  constructor(
    combatantId: string,
    personality: EnemyPersonality,
    config: CombatConfig,
    rng?: SeededRng,
  ) {
    this.combatantId = combatantId;
    this.config = config;
    this.rng = rng ?? new SeededRng();

    // Merge difficulty/aggression presets with personality overrides
    const merged = buildPersonality(
      personality.difficulty ?? "medium",
      personality.aggression_style ?? "neutral",
      personality as unknown as Record<string, unknown>,
    );

    this.aggression = (merged.aggression as number) ?? 0.6;
    this.preferredAttacks = (merged.preferred_attacks as string[]) ?? ["medium"];
    this.reactionTime = (merged.reaction_time as number) ?? 0.5;
    this.combatRange = (merged.combat_range as number) ?? 4.0;
    this.moveSpeed = (merged.move_speed as number) ?? 2.0;
    this.preferredDistance = (merged.preferred_distance as number) ?? 2.5;
    this.dodgeChance = (merged.dodge_chance as number) ?? 0.0;
    this.damageMult = (merged.damage_mult as number) ?? 1.0;
    this.blockChance = (merged.block_chance as number) ?? 0.0;
    this.attackCooldownMult = (merged.attack_cooldown_mult as number) ?? 1.0;
  }

  /** Update enemy position — move toward/away from target. */
  updateMovement(
    delta: number,
    self: CombatantState,
    target: CombatantState,
  ): void {
    if (self.health <= 0 || target.health <= 0) return;
    if (self.state === "winding_up" || self.state === "attacking") return;

    const dist = distanceXZ(self.position, target.position);
    const dir = normalized(sub(target.position, self.position));

    // Always face the target
    if (dir.x !== 0 || dir.z !== 0) {
      self.forward = { x: dir.x, y: 0, z: dir.z };
    }

    // FSM: RETREAT if low HP and defensive style
    if (self.health < self.maxHealth * 0.3 && this.blockChance > 0.4) {
      if (dist < this.preferredDistance + 1.0) {
        // Move away from target
        const retreat = scale({ x: -dir.x, y: 0, z: -dir.z }, this.moveSpeed * 0.7 * delta);
        self.position = add(self.position, retreat);
        Combatant.setMoving(self, true);
        return;
      }
    }

    // APPROACH if too far
    if (dist > this.preferredDistance + 0.5) {
      const move = scale({ x: dir.x, y: 0, z: dir.z }, this.moveSpeed * delta);
      self.position = add(self.position, move);
      Combatant.setMoving(self, true);
      return;
    }

    // Within preferred distance — stop and face target
    if (dist > this.preferredDistance - 0.5) {
      Combatant.setMoving(self, false);
      return;
    }

    // Too close — back up slightly
    if (dist < 1.0) {
      const backup = scale({ x: -dir.x, y: 0, z: -dir.z }, this.moveSpeed * 0.5 * delta);
      self.position = add(self.position, backup);
      Combatant.setMoving(self, true);
      return;
    }

    Combatant.setMoving(self, false);
  }

  /** Decide whether to attack, block, or wait. */
  tick(
    delta: number,
    self: CombatantState,
    target: CombatantState,
  ): CombatEvent[] {
    if (self.health <= 0 || target.health <= 0) return [];

    // Cooldown after last attack
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= delta;
      return [];
    }

    this.timer += delta;
    if (this.timer < this.reactionTime) return [];
    this.timer = 0;

    // Range check
    const dist = distanceXZ(self.position, target.position);
    if (dist > this.combatRange) return [];

    // Aggression roll
    if (this.rng.next() > this.aggression) return [];

    // Block chance — choose defensive instead of attacking
    if (this.rng.next() < this.blockChance) {
      const weaponData = this.config.weapons[self.weaponId]
        ?? this.config.weapons["unarmed"];
      const defType = this.config.attack_types["defensive"];
      if (defType) {
        const windUp = getEffectiveWindUp(defType, weaponData, "defensive");
        this.cooldownTimer = this.reactionTime * this.attackCooldownMult;
        return Combatant.startAttack(self, "defensive", windUp);
      }
    }

    // Pick attack
    const chosen = this.pickAttack(dist);
    if (!chosen) return [];

    const weaponData = this.config.weapons[self.weaponId]
      ?? this.config.weapons["unarmed"];
    const attackType = this.config.attack_types[chosen];
    if (!attackType) return [];

    const windUp = getEffectiveWindUp(attackType, weaponData, chosen);
    this.cooldownTimer = this.reactionTime * this.attackCooldownMult;
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
