/** Orchestrates combat: batch resolution of simultaneous attacks.
 *  Port of godot/scripts/combat/combat_manager.gd */

import type { CombatantState, CombatEvent, CombatConfig, EffectiveParams } from "../types.js";
import { resolveAttack, applyDefensiveReduction } from "./combat-resolver.js";
import { getEffectiveParams } from "./combat-data.js";
import { getCurrentAction } from "./combatant.js";
import * as Combatant from "./combatant.js";
import { distance } from "../vec3.js";

const SIMULTANEOUS_WINDOW = 0.05;

interface PendingImpact {
  attackerId: string;
  typeId: string;
  time: number;
}

export class CombatManager {
  private pendingImpacts: PendingImpact[] = [];
  private timeAcc = 0;
  private config: CombatConfig;

  constructor(config: CombatConfig) {
    this.config = config;
  }

  addPendingImpact(attackerId: string, typeId: string): void {
    this.pendingImpacts.push({
      attackerId,
      typeId,
      time: this.timeAcc,
    });
  }

  tick(delta: number, combatants: Map<string, CombatantState>): CombatEvent[] {
    this.timeAcc += delta;
    if (this.pendingImpacts.length === 0) return [];

    // Group impacts within the simultaneous window
    const cutoff = this.timeAcc - SIMULTANEOUS_WINDOW;
    let batch: PendingImpact[] = [];
    const remaining: PendingImpact[] = [];

    for (const impact of this.pendingImpacts) {
      if (impact.time <= cutoff) {
        batch.push(impact);
      } else {
        remaining.push(impact);
      }
    }

    if (batch.length === 0) {
      const oldestTime = this.pendingImpacts[0].time;
      if (this.timeAcc - oldestTime >= SIMULTANEOUS_WINDOW) {
        batch = [...this.pendingImpacts];
        this.pendingImpacts = [];
      } else {
        return [];
      }
    } else {
      this.pendingImpacts = remaining;
    }

    return this.resolveBatch(batch, combatants);
  }

  private resolveBatch(
    batch: PendingImpact[],
    combatants: Map<string, CombatantState>,
  ): CombatEvent[] {
    const events: CombatEvent[] = [];

    for (const impact of batch) {
      const attacker = combatants.get(impact.attackerId);
      if (!attacker || attacker.health <= 0) continue;

      const weaponData = this.config.weapons[attacker.weaponId]
        ?? this.config.weapons["unarmed"];
      const effectiveParams = getEffectiveParams(
        impact.typeId,
        this.config.attack_types,
        weaponData,
      );

      // Find best target
      let bestTarget: CombatantState | null = null;
      let bestDamage = 0;

      for (const [, target] of combatants) {
        if (target.id === attacker.id || target.health <= 0) continue;

        const defenderAction = getCurrentAction(target);
        let damage = resolveAttack(
          attacker.position,
          attacker.forward,
          target.position,
          defenderAction,
          effectiveParams,
          this.config.tactical_matrix,
          impact.typeId,
        );

        if (damage <= 0) continue;

        // Apply defensive reduction
        if (defenderAction === "defensive") {
          const defWeapon = this.config.weapons[target.weaponId]
            ?? this.config.weapons["unarmed"];
          const defParams = getEffectiveParams(
            "defensive",
            this.config.attack_types,
            defWeapon,
          );
          damage = applyDefensiveReduction(damage, defParams.damage_reduction);
        }

        if (damage > bestDamage) {
          bestDamage = damage;
          bestTarget = target;
        }
      }

      if (bestTarget && bestDamage > 0) {
        const dmgEvents = Combatant.receiveDamage(bestTarget, bestDamage, attacker.id);
        events.push({
          type: "attack_landed",
          attackerId: attacker.id,
          targetId: bestTarget.id,
          attackType: impact.typeId,
          damage: bestDamage,
          newHp: bestTarget.health,
        });
        events.push(...dmgEvents);
      }
    }

    return events;
  }

  reset(): void {
    this.pendingImpacts = [];
    this.timeAcc = 0;
  }
}
