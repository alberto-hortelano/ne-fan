/** El combate de un NPC hostil, DERIVADO en el core de su `role`.
 *
 *  Por qué aquí y no en el contrato: el motor narrativo declara HOSTILIDAD
 *  (`role:"hostile"`), no números. Un bloque `{health, weapon_id,
 *  personality}` escrito por el LLM sería balance inventado turno a turno —
 *  irreproducible entre dos partidas del mismo mundo, imposible de ajustar
 *  desde un sitio, y un campo 13 en un `EntitySchema` que es `.strict()` con
 *  12 por argumento medido (#324). El modelo conserva toda la expresividad
 *  donde se ve: `name` y `description`.
 *
 *  Esta es la ÚNICA fuente del bloque `combat`, y por eso las dos vías de
 *  spawn convergen: la escena inicial (`formatDToWorld`) y el spawn en
 *  runtime (`dispatchConsequences`) llaman aquí. Si mañana el balance cambia,
 *  cambia para las dos a la vez.
 */
import { buildPersonality } from "./difficulty-presets.js";
import { isHostileRole } from "../simulation/npc-roles.js";

/** Lo que el sim necesita para dar de alta un combatiente. Es la forma que
 *  viaja en `npcs[].combat` de la world scene y en `data.combat` del spawn,
 *  y la que el cliente pasa por `add_combatants`. */
export interface HostileCombat {
  /** La vida que le queda AHORA. Nace igual que `max_health` —un enemigo
   *  recién derivado está entero— y a partir de ahí es lo que el jugador le
   *  haya dejado: el save la baja al reanudar (`escenaConCombateVivo`). */
  health: number;
  /** El DENOMINADOR de la barra, que no es lo mismo que la vida y hasta hoy
   *  se colapsaban: `createCombatant` ponía `maxHealth = health` y el cliente
   *  `maxHp = hp`, así que un herido que volvía con 12 PV volvía también con
   *  la barra llena y con la IA creyéndolo entero (`enemy-ai.ts` decide
   *  retirarse por debajo del 30 % de `maxHealth`). Viaja aparte porque son
   *  dos hechos distintos, y solo uno cambia al pegarle. */
  max_health: number;
  weapon_id: string;
  personality: Record<string, unknown>;
}

/** Vida de un hostil derivado. Cuatro golpes rápidos con espada corta
 *  (15 × 1,3 de multiplicador de arma, en distancia y centro óptimos) o dos
 *  fuertes: se puede matar en un encuentro sin que sea un muñeco de paja. */
export const HOSTILE_HEALTH = 60;

/** El arma del hostil. `unarmed` a propósito: el catálogo de armas es del
 *  jugador y el arte de las suyas no existe todavía, así que darle una espada
 *  sería prometer en el HUD algo que no se ve en el mundo. */
export const HOSTILE_WEAPON = "unarmed";

/** A qué distancia el hostil se da por enterado del jugador.
 *
 *  10 m y no «siempre», que es lo que hacía el sim sin esta puerta: MEDIDO en
 *  el banco el 2026-08-29, un hostil a 34 m mataba en 27,7 s a un jugador que
 *  no tocaba una tecla, así que alejarlo no protegía de nada. Y 10 m y no 3:
 *  el rótulo y la mirilla del cliente alcanzan de sobra a esa distancia, así
 *  que al jugador le da tiempo a VER lo que se le viene antes de que empiece
 *  a pegarle. La pelea la elige quien juega acercándose; el enemigo la
 *  termina. */
export const HOSTILE_AGGRO_M = 10;

/** Bloque de combate de un rol hostil, o `undefined` si el rol no lo es
 *  (aldeano, guardia, ausente…). Devolver `undefined` y no un bloque vacío es
 *  lo que deja escribir `...(combat ? { combat } : {})` en las dos vías sin
 *  que un NPC ambiental acabe con un `combat` de ceros que el cliente
 *  registraría como combatiente. */
export function combatForHostileRole(role: unknown): HostileCombat | undefined {
  if (!isHostileRole(role)) return undefined;
  return {
    // Recién derivado, entero: la vida VIVA y el denominador coinciden. Solo
    // el runtime las separa (pegarle baja `health` y deja `max_health`).
    health: HOSTILE_HEALTH,
    max_health: HOSTILE_HEALTH,
    weapon_id: HOSTILE_WEAPON,
    // `medium` + `aggressive`: el hostil BUSCA al jugador (preferred_distance
    // 1,5 m) en vez de esperar a que se le acerque. Sin eso, un enemigo
    // declarado a 8 m se queda mirando y "hay contra quién pelear" vuelve a
    // ser mentira — que es exactamente lo que pasó en el único rastro de
    // combate del repositorio.
    personality: buildPersonality("medium", "aggressive", { aggro_radius: HOSTILE_AGGRO_M }),
  };
}
