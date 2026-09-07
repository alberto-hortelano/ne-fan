/** LOS PARÁMETROS DEL ARO DEL TELEGRAPH: qué distancia óptima, qué tolerancia
 *  y qué radio de área se le dibujan al jugador para el ataque que tiene
 *  elegido, con el arma que lleva.
 *
 *  Dos fuentes, y el orden importa: un ataque de `combat_config.json` sale de
 *  `getEffectiveParams` —la MISMA función que usa el sim para resolver el
 *  golpe, así que el aro no puede mentir sobre el alcance—, y uno que solo
 *  existe en el catálogo del sistema de combate de la sesión (el `strike` del
 *  combate básico, que declara un `displayRange` y ningún número de daño) sale
 *  de una construcción SINTÉTICA que solo alimenta el dibujo: el aro cubre
 *  `[0, displayRange]`, y el daño y el wind-up van a cero porque aquí no se
 *  conocen — los resuelve el sistema detrás del bridge.
 *
 *  Vivía en `nefan-html/src/ui/hud-de-combate.ts` (PR 4 de #241, #504). Es
 *  regla de juego, no pintura: dice a qué distancia hay que ponerse. Aquí
 *  entra el config y el catálogo como argumentos —el cliente ya los tiene— y
 *  no se lee ningún JSON: el módulo es puro. */

import type { CombatConfig, EffectiveParams } from "../types.js";
import type { AttackSpec } from "./combat-system.js";
import { getEffectiveParams } from "./combat-data.js";

export function paramsDeTelegraph(
  ataque: string,
  config: CombatConfig,
  armaId: string,
  catalogo: readonly AttackSpec[],
): EffectiveParams {
  if (config.attack_types[ataque]) {
    // Un arma que el config no conoce pega como las manos desnudas: es lo que
    // hace el sim con un `weapon_id` que no está en la tabla, y el aro tiene
    // que decir lo mismo. `""` (todavía sin frame del bridge) cae por aquí.
    const arma = config.weapons[armaId] ?? config.weapons["unarmed"];
    return getEffectiveParams(ataque, config.attack_types, arma);
  }
  const spec = catalogo.find((a) => a.id === ataque);
  if (!spec) {
    throw new Error(
      `paramsDeTelegraph: el ataque '${ataque}' no está ni en combat_config ni en el catálogo de la sesión`,
    );
  }
  // Params sintéticos: el arma NO entra: un ataque que el config no conoce no
  // tiene modificadores por arma que aplicar, y aplicarle los de otro sería
  // inventarse el alcance del jugador.
  const medio = spec.displayRange / 2;
  return {
    optimal_distance: medio,
    distance_tolerance: medio, // el aro cubre [0, displayRange]
    area_radius: spec.displayRange,
    base_damage: 0,
    damage_reduction: 0,
    wind_up_time: 0,
  };
}
