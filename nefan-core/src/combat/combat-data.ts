/** Loads and merges combat configuration data.
 *  Direct port of godot/scripts/combat/combat_data.gd */

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

export function loadConfig(json: unknown): CombatConfig {
  const data = json as CombatConfig;
  if (!data?.attack_types || !data?.weapons || !data?.tactical_matrix) {
    throw new Error("CombatData: invalid combat config");
  }
  return data;
}
