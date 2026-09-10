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

/** Los números del jugador que el config DEBE traer, con QUÉ SIGNIFICA que
 *  cada uno sea imposible. Sin default a propósito: un `?? 2.2` escondido aquí
 *  sería la misma mentira que el multiplicador que vivía en el cliente (#241)
 *  — el config diría una cosa y el juego haría otra, y nadie tendría por qué
 *  enterarse. Si falta uno, no hay partida.
 *
 *  Los CUATRO son estrictamente positivos, y el rango no es cosmética (#539):
 *  hasta esta tanda solo se miraba el TIPO, así que `speed_scale: -1` y
 *  `interact_range_m: 0` cargaban sin una queja. Un jugador que anda hacia
 *  atrás o que nunca alcanza la `E` no es una configuración, es un error — y
 *  uno que no se ve en el arranque sino jugando, buscando por qué la tecla no
 *  hace nada. El motivo nombra el campo, lo que pasaría, y el fichero: es lo
 *  que el jugador va a leer en la pantalla y lo que el launcher cita.
 *
 *  Lo que aquí NO se comprueba, para no inventar reglas de balance: que
 *  `sprint_speed` sea mayor que `walk_speed`. Correr más despacio que andar es
 *  raro, pero es una decisión de feel jugable, no un imposible. */
const CAMPOS_DEL_JUGADOR = {
  walk_speed: "el jugador no podría andar",
  sprint_speed: "esprintar no le movería",
  speed_scale: "andaría hacia atrás o se quedaría clavado",
  interact_range_m: "la tecla E no alcanzaría a nadie",
} as const;

type CampoDelJugador = keyof typeof CAMPOS_DEL_JUGADOR;
const CAMPOS = Object.keys(CAMPOS_DEL_JUGADOR) as CampoDelJugador[];

/** El motivo por el que un `combat_config.json` no sirve, o `null` si sirve.
 *  Devolver el texto en vez de lanzar es lo que deja que el llamante lo mande
 *  al canal de SU capa: el cliente a la pantalla de quien juega, el bridge a su
 *  stdout (que es lo que el launcher cita). */
export function motivoDeConfigInvalido(json: unknown): string | null {
  const data = json as CombatConfig | undefined;
  if (!data?.attack_types || !data?.weapons || !data?.tactical_matrix) {
    return "combat_config.json no trae attack_types, weapons y tactical_matrix: no es un config de combate";
  }
  const player = data.player as Partial<Record<CampoDelJugador, unknown>> | undefined;
  if (!player) {
    return "combat_config.json no trae el bloque `player` (velocidades y alcance del jugador)";
  }
  const faltan = CAMPOS.filter((k) => typeof player[k] !== "number" || !Number.isFinite(player[k]));
  if (faltan.length > 0) {
    return `combat_config.json: player.${faltan.join(", player.")} debe(n) ser número finito`;
  }
  const imposible = CAMPOS.find((k) => (player[k] as number) <= 0);
  if (imposible !== undefined) {
    return (
      `combat_config.json: player.${imposible} vale ${player[imposible]} y tiene que ser mayor que 0 — ` +
      `con ese valor ${CAMPOS_DEL_JUGADOR[imposible]}`
    );
  }
  return null;
}

export function loadConfig(json: unknown): CombatConfig {
  const motivo = motivoDeConfigInvalido(json);
  if (motivo !== null) throw new Error(`CombatData: ${motivo}`);
  return json as CombatConfig;
}
