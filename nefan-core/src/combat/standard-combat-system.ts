/** Sistema de combate estándar: envuelve el CombatManager/resolver existentes
 *  (fórmula distancia × precisión × matriz táctica × armas) tras la interfaz
 *  CombatSystem. La lógica de combat-manager.ts y combat-resolver.ts no
 *  cambia — este adapter solo expone el catálogo y delega. */

import type { CombatantState, CombatConfig, CombatEvent, Weapon } from "../types.js";
import { CombatManager } from "./combat-manager.js";
import { getEffectiveParams } from "./combat-data.js";
import type { AttackSpec, CombatSystem } from "./combat-system.js";

export class StandardCombatSystem implements CombatSystem {
  readonly id = "standard";
  readonly attacks: readonly AttackSpec[];
  private manager: CombatManager;
  private config: CombatConfig;

  constructor(config: CombatConfig) {
    this.config = config;
    this.manager = new CombatManager(config);
    // Catálogo en el orden del JSON (el del HUD: quick/heavy/medium/defensive/precise).
    this.attacks = Object.entries(config.attack_types).map(([id, at]) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      displayRange: at.optimal_distance,
    }));
    if (this.attacks.length === 0) {
      throw new Error("StandardCombatSystem: combat config has no attack_types");
    }
  }

  normalizeAttack(typeId: string): string | null {
    return typeId in this.config.attack_types ? typeId : null;
  }

  windUpTime(typeId: string, weaponId: string): number {
    return getEffectiveParams(typeId, this.config.attack_types, this.weapon(weaponId)).wind_up_time;
  }

  addPendingImpact(attackerId: string, typeId: string): void {
    this.manager.addPendingImpact(attackerId, typeId);
  }

  resolve(delta: number, combatants: Map<string, CombatantState>): CombatEvent[] {
    return this.manager.tick(delta, combatants);
  }

  reset(): void {
    this.manager.reset();
  }

  private weapon(weaponId: string): Weapon {
    return this.config.weapons[weaponId] ?? this.config.weapons["unarmed"];
  }
}
