/** Registro de sistemas de combate — la familia "combat" de game.json.systems.
 *  Default: el sistema estándar actual (fallback por AUSENCIA de declaración);
 *  un id desconocido lanza (fail-loud). */

import type { CombatConfig } from "../types.js";
import { createSystemRegistry } from "../systems/registry.js";
import type { CombatSystem } from "./combat-system.js";
import { StandardCombatSystem } from "./standard-combat-system.js";
import { BasicCombatSystem } from "./basic-combat-system.js";

export const combatRegistry = createSystemRegistry<CombatSystem, CombatConfig>(
  "combat",
  "standard",
  {
    standard: (config) => new StandardCombatSystem(config),
    basic: () => new BasicCombatSystem(),
  },
);
