/** Contrato del sistema de combate intercambiable (game.json → systems.combat).
 *
 *  La orquestación (GameSimulation) y la state machine de combatant.ts son
 *  compartidas: todo sistema emite los mismos eventos (attack_started →
 *  attack_impacted → attack_landed/damage_received → died), así el protocolo
 *  del bridge y los clientes no cambian entre implementaciones. Lo que varía
 *  es el catálogo de ataques, el wind-up y la resolución de impactos. */

import type { CombatantState, CombatEvent } from "../types.js";

/** Un ataque del catálogo del jugador — el cliente construye su HUD con esto. */
export interface AttackSpec {
  id: string;
  /** Texto del HUD (español de cara al jugador cuando aplique). */
  label: string;
  /** Alcance orientativo (m) para el feedback visual del cliente. */
  displayRange: number;
}

export interface CombatSystem {
  /** Id de registro ("standard" | "basic"). */
  readonly id: string;
  /** Catálogo de ataques del jugador. Invariante: nunca vacío. */
  readonly attacks: readonly AttackSpec[];
  /** Id canónico del ataque, o null si el sistema no lo conoce. */
  normalizeAttack(typeId: string): string | null;
  /** Wind-up efectivo (s) para ataque+arma. Lanza si el ataque es desconocido. */
  windUpTime(typeId: string, weaponId: string): number;
  /** Encola un impacto madurado por la state machine del combatiente. */
  addPendingImpact(attackerId: string, typeId: string): void;
  /** Resuelve impactos pendientes → attack_landed / damage_received / died. */
  resolve(delta: number, combatants: Map<string, CombatantState>): CombatEvent[];
  reset(): void;
}
