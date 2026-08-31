/** Combat state machine — tick-based, no engine dependencies.
 *  Canonical implementation — the client is display-only (HP + events), fed
 *  by the bridge. */

import type { CombatantState, CombatEvent, Vec3 } from "../types.js";

/** Un combatiente nuevo.
 *
 *  `maxHealth` por defecto es `health` —quien nace, nace entero— pero se puede
 *  dar aparte, y hace falta: un enemigo que vuelve de un save llega herido, y
 *  colapsar los dos números le pintaba la barra llena y hacía que la IA lo
 *  creyera entero (`enemy-ai.ts` se retira por debajo del 30 % de `maxHealth`,
 *  que con esto era siempre el 30 % de lo que le quedaba). */
export function createCombatant(
  id: string,
  health: number = 100,
  weaponId: string = "unarmed",
  position: Vec3 = { x: 0, y: 0, z: 0 },
  forward: Vec3 = { x: 0, y: 0, z: -1 },
  maxHealth: number = health,
): CombatantState {
  return {
    id,
    health,
    maxHealth,
    weaponId,
    state: "idle",
    currentAttackType: "",
    windUpTimer: 0,
    windUpDuration: 0,
    position,
    forward,
  };
}

export function tick(c: CombatantState, delta: number): CombatEvent[] {
  const events: CombatEvent[] = [];
  if (c.state === "winding_up") {
    c.windUpTimer += delta;
    if (c.windUpTimer >= c.windUpDuration) {
      events.push({
        type: "attack_impacted",
        combatantId: c.id,
        attackType: c.currentAttackType,
      });
      c.state = "idle";
      c.currentAttackType = "";
    }
  }
  return events;
}

export function startAttack(
  c: CombatantState,
  typeId: string,
  windUpTime: number,
): CombatEvent[] {
  if (c.state === "winding_up" || c.state === "attacking") return [];
  c.state = "winding_up";
  c.currentAttackType = typeId;
  c.windUpTimer = 0;
  c.windUpDuration = windUpTime;
  return [{ type: "attack_started", combatantId: c.id, attackType: typeId }];
}

export function receiveDamage(
  c: CombatantState,
  amount: number,
  fromId: string,
): CombatEvent[] {
  if (c.health <= 0) return [];
  c.health = Math.max(c.health - amount, 0);
  const events: CombatEvent[] = [
    { type: "damage_received", combatantId: c.id, amount, fromId, newHp: c.health },
  ];
  if (c.health <= 0) {
    c.state = "dead";
    events.push({ type: "died", combatantId: c.id });
  }
  return events;
}

export function setMoving(c: CombatantState, moving: boolean): void {
  if (c.state === "winding_up" || c.state === "attacking") return;
  c.state = moving ? "moving" : "idle";
}

export function getCurrentAction(c: CombatantState): string {
  switch (c.state) {
    case "idle": return "idle";
    case "moving": return "moving";
    case "winding_up":
    case "attacking":
      return c.currentAttackType;
    default: return "idle";
  }
}
