/** Sistema de combate de disparo: un solo ataque ("shoot") hitscan con daño
 *  fijo al objetivo vivo más cercano dentro del rango Y del cono frontal del
 *  atacante (según su forward). Sin proyectil físico, sin precisión, sin
 *  matriz táctica ni armas — la variante ranged mínima del contrato
 *  CombatSystem. No necesita combat_config.json. */

import type { CombatantState, CombatEvent } from "../types.js";
import { distanceXZ, dot, normalized } from "../vec3.js";
import * as Combatant from "./combatant.js";
import type { AttackSpec, CombatSystem } from "./combat-system.js";

const SHOOT: AttackSpec = { id: "shoot", label: "Disparar", displayRange: 12.0 };
const WIND_UP_S = 0.15;
const DAMAGE = 20;
/** Semiángulo del cono de disparo (~15°). */
const COS_HALF_ANGLE = Math.cos((15 * Math.PI) / 180);

interface PendingImpact {
  attackerId: string;
}

export class ShootingCombatSystem implements CombatSystem {
  readonly id = "shooting";
  readonly attacks: readonly AttackSpec[] = [SHOOT];
  private pending: PendingImpact[] = [];

  normalizeAttack(typeId: string): string | null {
    return typeId === SHOOT.id ? SHOOT.id : null;
  }

  windUpTime(typeId: string, _weaponId: string): number {
    if (typeId !== SHOOT.id) {
      throw new Error(`ShootingCombatSystem: unknown attack type '${typeId}' (only '${SHOOT.id}')`);
    }
    return WIND_UP_S;
  }

  addPendingImpact(attackerId: string, typeId: string): void {
    if (typeId !== SHOOT.id) {
      throw new Error(`ShootingCombatSystem: unknown attack type '${typeId}' (only '${SHOOT.id}')`);
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

      const aim = normalized({ x: attacker.forward.x, y: 0, z: attacker.forward.z });
      let target: CombatantState | null = null;
      let targetDist = Infinity;
      for (const [, c] of combatants) {
        if (c.id === attacker.id || c.health <= 0) continue;
        const d = distanceXZ(attacker.position, c.position);
        if (d > SHOOT.displayRange || d >= targetDist) continue;
        const toTarget = normalized({
          x: c.position.x - attacker.position.x,
          y: 0,
          z: c.position.z - attacker.position.z,
        });
        if (dot(toTarget, aim) < COS_HALF_ANGLE) continue;
        targetDist = d;
        target = c;
      }
      if (!target) continue;

      const dmgEvents = Combatant.receiveDamage(target, DAMAGE, attacker.id);
      events.push({
        type: "attack_landed",
        attackerId: attacker.id,
        targetId: target.id,
        attackType: SHOOT.id,
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
