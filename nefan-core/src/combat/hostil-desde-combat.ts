/** QUÉ ES UN ENEMIGO UTILIZABLE: el único criterio, y lo comparten las dos
 *  puertas por las que uno entra al juego.
 *
 *  El bloque `combat` de un hostil lo DERIVA el core (`combatForHostileRole`),
 *  así que nadie escribe sus números a mano; pero el bloque viaja —por la world
 *  scene, por el effect de un `spawn_entity`, por el save del ledger y por el
 *  cable de `add_combatants`/`load_room`— y en el camino puede llegar roto o no
 *  llegar. Comprobarlo es lo que decide si algo entra al sim como combatiente:
 *  un enemigo con `health` NaN entra y ya no se puede matar, y uno con
 *  `preferred_attacks` vacío entra sin nada que el resolver sepa resolver.
 *
 *  Hasta la PR 6 de #241 (2026-09-07) ese criterio estaba escrito DOS veces y
 *  no decían lo mismo: el parser de `nefan-html/src/scene/enemigo.ts` (que
 *  exigía `combat_range`, `preferred_attacks` no vacía y números FINITOS) y el
 *  `EnemySpawnSchema` de `protocol/message-schema.ts` (que solo miraba el TIPO
 *  de los tres escalares —aceptaba `health: 0` y `weapon_id: ""`— y de la
 *  personalidad dejaba pasar la lista vacía, el `Infinity` y la ausencia de
 *  `combat_range`, aunque comprobaba el tipo de los opcionales que el otro
 *  ignoraba). Con dos
 *  criterios, un enemigo podía pasar la puerta del cliente y morir en el borde
 *  del bridge con un motivo distinto —«El juego mandó un mensaje que el
 *  servidor no reconoce»— o al revés. Aquí hay UNO, y es la UNIÓN de los dos:
 *  nada que ambos aceptaban se rechaza ahora, y nada que uno rechazaba pasa.
 *
 *  Módulo PURO: sin DOM, sin `errors.push`, sin zod. Devuelve `Result` y el
 *  llamante lo manda al canal de su capa —`errors.push("scene", …)` en el
 *  cliente, un issue zod en el borde WS— con el MISMO texto. */

import type { EnemyPersonality } from "../types.js";
import type { HostileCombat } from "./hostiles.js";

/** El bloque `combat` ya comprobado. Mismos campos que `HostileCombat`, con la
 *  personalidad TIPADA en vez de `Record<string, unknown>`.
 *
 *  Hasta #530 la personalidad comprobada tenía tipo propio
 *  (`EnemyPersonality & { combat_range: number }`) porque el contrato dejaba
 *  `combat_range` opcional y este criterio lo exigía: un tipo que existía solo
 *  para tapar que el otro mentía. Hoy el contrato lo exige, así que la
 *  personalidad comprobada ES `EnemyPersonality` y no hay dos formas de decir
 *  lo mismo. */
export type HostileCombatValidado = Omit<HostileCombat, "personality"> & {
  personality: EnemyPersonality;
};

/** `Result<EnemyPersonality, string>`: «vacío» y «error» no se colapsan.
 *  Interno: las dos puertas entran por `parseHostileCombat`, con el bloque
 *  entero, que es como viaja. */
type ResultadoDePersonalidad =
  | { ok: true; personality: EnemyPersonality }
  | { ok: false; error: string };

/** `Result<HostileCombatValidado, string>`. */
export type ResultadoDeHostil =
  | { ok: true; hostil: HostileCombatValidado }
  | { ok: false; error: string };

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Número USABLE: `Number.isFinite` y no sólo `typeof`. Un `Infinity` en
 *  `reaction_time` es un enemigo que nunca ataca, y un NaN en cualquiera de
 *  los tres envenena la aritmética del sim en silencio. */
function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Los campos que la personalidad puede traer o no, con el tipo que el
 *  contrato (`EnemyPersonality`) les promete. No son obligatorios —los rellena
 *  `buildPersonality` por preset— pero SI vienen tienen que ser lo que dicen:
 *  un `difficulty: 5` degrada a "medium" sin decir nada
 *  (`difficulty-presets.ts:33`), que es la clase de fallo mudo que la casa
 *  prohíbe. Esta comprobación la hacía sólo el zod del bridge. */
const OPCIONALES_TEXTO = ["difficulty", "aggression_style"] as const;
const OPCIONALES_NUMERO = [
  "aggro_radius",
  "attack_cooldown_mult",
  "block_chance",
  "preferred_distance",
  "move_speed",
] as const;

/** La personalidad de un hostil, o el motivo por el que no sirve. La mitad de
 *  dentro de `parseHostileCombat`, en función aparte porque es donde estaba la
 *  divergencia entre los dos criterios que esta PR unifica.
 *
 *  El texto del motivo es el que ve el jugador en el registro de errores del
 *  cliente y el que el bridge escribe en su log al rechazar el frame: es el
 *  MISMO string por construcción, no por disciplina. */
function parseHostilePersonality(v: unknown): ResultadoDePersonalidad {
  if (!esObjeto(v)) return { ok: false, error: "combat.personality ausente" };

  const aggression = numero(v.aggression);
  const reactionTime = numero(v.reaction_time);
  const combatRange = numero(v.combat_range);
  if (aggression === null || reactionTime === null || combatRange === null) {
    return {
      ok: false,
      error:
        "combat.personality necesita aggression, reaction_time y combat_range numéricos " +
        `(${JSON.stringify({ aggression: v.aggression, reaction_time: v.reaction_time, combat_range: v.combat_range })})`,
    };
  }

  const attacks = v.preferred_attacks;
  if (!Array.isArray(attacks) || attacks.length === 0 || !attacks.every((a) => typeof a === "string")) {
    return {
      ok: false,
      error: "combat.personality.preferred_attacks no es una lista de ataques no vacía",
    };
  }

  for (const clave of OPCIONALES_TEXTO) {
    const valor = v[clave];
    if (valor !== undefined && typeof valor !== "string") {
      return { ok: false, error: `combat.personality.${clave} inválido (${JSON.stringify(valor)})` };
    }
  }
  for (const clave of OPCIONALES_NUMERO) {
    const valor = v[clave];
    if (valor !== undefined && numero(valor) === null) {
      return { ok: false, error: `combat.personality.${clave} inválido (${JSON.stringify(valor)})` };
    }
  }

  // Se conserva TODO lo que traía (un plugin puede añadir campos suyos que
  // `buildPersonality` mezcla por override) y se reescriben los tres números
  // ya comprobados, que es lo que hacía el cliente antes de mandarla al cable.
  return {
    ok: true,
    personality: {
      ...v,
      aggression,
      reaction_time: reactionTime,
      combat_range: combatRange,
      preferred_attacks: attacks as string[],
    } as EnemyPersonality,
  };
}

/** El bloque `combat` entero, o el motivo por el que ese enemigo NO se
 *  construye. Devolver el motivo y no un enemigo a medias es deliberado: un
 *  combatiente con vida NaN entra en el sim y ya no se puede matar. */
export function parseHostileCombat(v: unknown): ResultadoDeHostil {
  if (!esObjeto(v)) return { ok: false, error: "su bloque `combat` no es un objeto" };

  const health = numero(v.health);
  if (health === null || health <= 0) {
    return { ok: false, error: `combat.health inválido (${JSON.stringify(v.health)})` };
  }
  // El DENOMINADOR de la barra, y llega o no se construye el enemigo: SIN
  // fallback a `health`. Ese fallback es exactamente la mentira que había —un
  // herido que vuelve de un save con 12 PV se pintaba con la barra llena y la
  // IA lo trataba como entero—, y un save previo a #326 no trae el campo, así
  // que se rechaza en voz alta en vez de resucitar el defecto en silencio
  // (pre-producción: cero compatibilidad hacia atrás).
  const maxHealth = numero(v.max_health);
  if (maxHealth === null || maxHealth <= 0) {
    return { ok: false, error: `combat.max_health inválido (${JSON.stringify(v.max_health)})` };
  }
  const weaponId = v.weapon_id;
  if (typeof weaponId !== "string" || !weaponId) {
    return { ok: false, error: `combat.weapon_id inválido (${JSON.stringify(weaponId)})` };
  }

  const personalidad = parseHostilePersonality(v.personality);
  if (!personalidad.ok) return personalidad;

  return {
    ok: true,
    hostil: {
      health,
      max_health: maxHealth,
      weapon_id: weaponId,
      personality: personalidad.personality,
    },
  };
}
