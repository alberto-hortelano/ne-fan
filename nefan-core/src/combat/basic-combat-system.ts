/** Sistema de combate básico: un solo ataque ("strike") con daño fijo al
 *  objetivo vivo más cercano dentro de rango. Sin facing, sin precisión, sin
 *  matriz táctica, sin armas ni ventana de simultaneidad — la variante mínima
 *  que demuestra el contrato CombatSystem. No necesita combat_config.json. */

import type { CombatantState, CombatEvent } from "../types.js";
import { distanceXZ } from "../vec3.js";
import * as Combatant from "./combatant.js";
import type { AttackSpec, CombatSystem } from "./combat-system.js";

const STRIKE: AttackSpec = { id: "strike", label: "Golpe", displayRange: 2.0 };
const WIND_UP_S = 0.35;
const DAMAGE = 15;

interface PendingImpact {
  attackerId: string;
}

export class BasicCombatSystem implements CombatSystem {
  readonly id = "basic";
  readonly attacks: readonly AttackSpec[] = [STRIKE];
  private pending: PendingImpact[] = [];

  normalizeAttack(typeId: string): string | null {
    return typeId === STRIKE.id ? STRIKE.id : null;
  }

  windUpTime(typeId: string, _weaponId: string): number {
    if (typeId !== STRIKE.id) {
      throw new Error(`BasicCombatSystem: unknown attack type '${typeId}' (only '${STRIKE.id}')`);
    }
    return WIND_UP_S;
  }

  addPendingImpact(attackerId: string, typeId: string): void {
    if (typeId !== STRIKE.id) {
      throw new Error(`BasicCombatSystem: unknown attack type '${typeId}' (only '${STRIKE.id}')`);
    }
    this.pending.push({ attackerId });
  }

  resolve(_delta: number, combatants: Map<string, CombatantState>): CombatEvent[] {
    if (this.pending.length === 0) return [];
    const batch = this.pending;
    this.pending = [];

    const events: CombatEvent[] = [];
    for (const impact of batch) {
      const attacker = combatants.get(impact.attackerId);
      if (!attacker || attacker.health <= 0) continue;

      let target: CombatantState | null = null;
      let targetDist = Infinity;
      for (const [, c] of combatants) {
        if (c.id === attacker.id || c.health <= 0) continue;
        const d = distanceXZ(attacker.position, c.position);
        if (d <= STRIKE.displayRange && d < targetDist) {
          targetDist = d;
          target = c;
        }
      }
      if (!target) continue;

      const dmgEvents = Combatant.receiveDamage(target, DAMAGE, attacker.id);
      events.push({
        type: "attack_landed",
        attackerId: attacker.id,
        targetId: target.id,
        attackType: STRIKE.id,
        damage: DAMAGE,
        newHp: target.health,
      });
      events.push(...dmgEvents);
    }
    return events;
  }

  reset(): void {
    this.pending = [];
  }
}
