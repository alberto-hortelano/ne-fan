/** Loads and merges combat configuration data.
 *  Canonical implementation — `npm run dump-config` precomputes the
 *  effective-params table from here. */

import type { CombatConfig, EffectiveParams, AttackType, Weapon } from "../types.js";

export function getEffectiveParams(
  attackTypeId: string,
  attackTypes: Record<string, AttackType>,
  weaponData: Weapon,
): EffectiveParams {
  const base = attackTypes[attackTypeId];
  if (!base) {
    throw new Error(`CombatData: unknown attack type '${attackTypeId}'`);
  }

  const mods = weaponData.modifiers?.[attackTypeId] ?? {};
  const windUpTime = getEffectiveWindUp(base, weaponData, attackTypeId);

  return {
    optimal_distance: base.optimal_distance + (mods.optimal_distance_offset ?? 0),
    distance_tolerance: base.distance_tolerance,
    area_radius: base.area_radius * (mods.area_radius_multiplier ?? 1.0),
    base_damage: base.base_damage * (mods.damage_multiplier ?? 1.0),
    damage_reduction: base.damage_reduction,
    wind_up_time: windUpTime,
  };
}

export function getEffectiveWindUp(
  attackTypeData: AttackType,
  weaponData: Weapon,
  attackTypeId: string = "",
): number {
  const baseWup = attackTypeData.wind_up_time;
  const globalMod = weaponData.wind_up_modifier ?? 1.0;
  let typeMod = 1.0;
  if (attackTypeId) {
    const mods = weaponData.modifiers?.[attackTypeId] ?? {};
    typeMod = mods.wind_up_multiplier ?? 1.0;
  }
  return baseWup * globalMod * typeMod;
}

/** Los números del jugador que el config DEBE traer. Sin default a propósito:
 *  un `?? 2.2` escondido aquí sería la misma mentira que el multiplicador que
 *  vivía en el cliente (#241) — el config diría una cosa y el juego haría otra,
 *  y nadie tendría por qué enterarse. Si falta uno, no hay partida. */
const CAMPOS_DEL_JUGADOR = ["walk_speed", "sprint_speed", "speed_scale", "interact_range_m"] as const;

export function loadConfig(json: unknown): CombatConfig {
  const data = json as CombatConfig;
  if (!data?.attack_types || !data?.weapons || !data?.tactical_matrix) {
    throw new Error("CombatData: invalid combat config");
  }
  const player = data.player as Partial<Record<(typeof CAMPOS_DEL_JUGADOR)[number], unknown>> | undefined;
  if (!player) {
    throw new Error("CombatData: combat config sin bloque `player` (velocidades y alcance del jugador)");
  }
  const faltan = CAMPOS_DEL_JUGADOR.filter((k) => typeof player[k] !== "number" || !Number.isFinite(player[k]));
  if (faltan.length > 0) {
    throw new Error(`CombatData: player.${faltan.join(", player.")} debe(n) ser número finito en combat_config.json`);
  }
  return data;
}
