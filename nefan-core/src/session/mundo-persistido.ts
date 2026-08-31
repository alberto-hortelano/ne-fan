/** EL MUNDO QUE EL JUGADOR DEJÓ: qué vuelve al reanudar y en qué estado.
 *
 *  El estado de combate de un enemigo —**existir** incluido— vivía solo en la
 *  memoria del sim, y al reanudar el mundo se resembraba desde la escena
 *  persistida: un spawn de runtime no está en ninguna escena, así que
 *  desaparecía entero; y lo que sí estaba renacía con la vida del CONTRATO
 *  (`HOSTILE_HEALTH`), no con la que le dejaste — matarlo y volver lo devolvía
 *  vivo y a 60 (#326, y el resucitado que #323 dejó sin issue).
 *
 *  Aquí vive la mitad PURA de la respuesta, y son tres funciones con un solo
 *  criterio detrás: **cada entidad tiene EXACTAMENTE UNA puerta de vuelta, y
 *  la decide el `spawn_reason` que ya está persistido**.
 *
 *   · `spawn_reason: "scene_init"` → vuelve por la ESCENA. El bridge normaliza
 *     el Format D como siempre y `escenaConCombateVivo` le baja la vida al
 *     herido y saca del `npcs[]` al muerto, sobre la copia que sale al wire.
 *   · `spawn_reason: "narrative_request"` → vuelve por el LEDGER.
 *     `spawnsDeRuntime` lo convierte en lo que come `materializeSpawn`, la
 *     puerta única que el cliente ya tenía para las tres clases (npc, objeto,
 *     edificio).
 *
 *  Nunca las dos: `spawnsDeRuntime` no devuelve jamás un `scene_init`, y el
 *  overlay de la escena solo toca lo que la escena ya nombra. Un id que
 *  entrara por las dos sería un enemigo con dos barras al que el sim conoce
 *  una vez — la señal temprana de que alguien abrió una segunda puerta.
 *
 *  POR QUÉ NO ES LA VÍA REVERTIDA (`state-projection.ts`, retirada en #323):
 *  aquella REEMPLAZABA `GameStore.enemies` en cada broadcast con una
 *  proyección del ledger, y como `getEnemyStates` itera esa lista, el primer
 *  tile nuevo borraba del `state_update` a un enemigo que seguía vivo en el
 *  sim. Aquí no se toca el store ni el sim: se escribe sobre el objeto NUEVO
 *  que devuelve `formatDToWorld`, camino del cable, y el alta sigue siendo la
 *  de siempre (cliente → `add_combatants` → `sim.addCombatant`).
 *
 *  Módulo PURO (perímetro `core-puro-sin-node`): entra un save, sale una
 *  escena o una lista. Lo importan el bridge (para el wire) y el cliente
 *  (para el resume), que es exactamente por qué no puede tocar `node:*`.
 */

import type { EntityRecord } from "../narrative/types.js";

/** El runtime de un combatiente que el SAVE sí puede saber: cuánta vida le
 *  queda y sobre cuánta. Las dos, y no solo la primera: sin el denominador,
 *  un herido vuelve con la barra llena (ver `HostileCombat.max_health`). */
export interface EstadoDeCombate {
  health: number;
  max_health: number;
}

/** Qué dice el ledger del combate de una entity. Tres desenlaces DISTINTOS y
 *  ninguno colapsable con otro:
 *
 *   · `ninguno` — no es un combatiente (un aldeano, un barril, una casa). No
 *     es un error y no se reporta: la inmensa mayoría de las entities lo son.
 *   · `combate` — lo es y su bloque está entero.
 *   · `roto` — lo es y su bloque NO sirve. Se dice con el id delante y el
 *     campo que falla, porque un `null` mudo aquí es un enemigo que
 *     desaparece del mundo sin que nadie sepa por qué. */
export type CombateDelLedger =
  | { tipo: "ninguno" }
  | { tipo: "combate"; combate: EstadoDeCombate }
  | { tipo: "roto"; motivo: string };

/** El `spawn_reason` de lo que puso el MOTOR a mitad de partida
 *  (`dispatchConsequences`). El otro valor —`scene_init`— es lo que declara
 *  una escena, y ese vuelve por la escena. */
export const SPAWN_DE_RUNTIME = "narrative_request";

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Lee el estado de combate persistido de una entity.
 *
 *  Solo mira los DOS números que el runtime escribe (`health` / `max_health`):
 *  son los únicos que el save puede saber y los únicos que hacen falta para
 *  decidir si vuelve, con cuánta vida y sobre qué denominador. El resto del
 *  bloque —arma y personalidad— lo pone el core al derivarlo y lo valida el
 *  cliente en su puerta (`enemigoDesdeCombat`); duplicar aquí esa validación
 *  sería un segundo criterio de «qué es un enemigo utilizable». */
export function combateDeEntity(rec: EntityRecord): CombateDelLedger {
  const bruto = rec.data.combat;
  if (bruto === undefined) return { tipo: "ninguno" };
  if (!esObjeto(bruto)) {
    return { tipo: "roto", motivo: `entity "${rec.id}": data.combat no es un objeto` };
  }
  const health = numero(bruto.health);
  if (health === null) {
    return {
      tipo: "roto",
      motivo: `entity "${rec.id}": combat.health no es un número (${JSON.stringify(bruto.health)})`,
    };
  }
  const maxHealth = numero(bruto.max_health);
  if (maxHealth === null || maxHealth <= 0) {
    return {
      tipo: "roto",
      motivo:
        `entity "${rec.id}": combat.max_health inválido (${JSON.stringify(bruto.max_health)}) — ` +
        `sin denominador la barra de vida miente`,
    };
  }
  return { tipo: "combate", combate: { health, max_health: maxHealth } };
}

/** La world scene tal y como sale al cable, con el combate VIVO encima.
 *
 *  Devuelve un OBJETO NUEVO y no toca el que recibe. No es higiene: sellar el
 *  estado de sesión dentro del `scene_data` persistido es lo que se hizo con
 *  `exits` y causó #179 — la escena guardada dejaba de ser Format D crudo y el
 *  resume servía un enriquecimiento congelado. Aquí lo persistido no se entera
 *  de que esto existe.
 *
 *  Dos cosas, y las dos sobre `npcs[]`:
 *   · al HERIDO se le baja la vida (y se le pone su denominador), y
 *   · al MUERTO se le quita de la lista. Esa es toda la permanencia de la
 *     muerte vista desde el cliente: un npc que no viene en la escena no se
 *     pinta, no se registra en el sim y no tiene barra. */
export function escenaConCombateVivo(
  escena: Record<string, unknown>,
  estados: ReadonlyMap<string, EstadoDeCombate>,
): Record<string, unknown> {
  const npcs = escena.npcs;
  if (!Array.isArray(npcs)) return escena;
  const vivos: unknown[] = [];
  for (const npc of npcs) {
    if (!esObjeto(npc) || typeof npc.id !== "string") {
      vivos.push(npc);
      continue;
    }
    const estado = estados.get(npc.id);
    if (!estado) {
      vivos.push(npc);
      continue;
    }
    // El muerto NO vuelve. Es la decisión del usuario (2026-08-31) hecha
    // visible: matar tiene consecuencia y repoblar es cosa del motor.
    if (estado.health <= 0) continue;
    if (!esObjeto(npc.combat)) {
      // Tiene runtime pero la escena no lo declara hostil: no hay bloque que
      // sobrescribir. Se conserva tal cual — inventarle un `combat` aquí sería
      // que este módulo decidiera quién pelea, y eso lo deriva el core.
      vivos.push(npc);
      continue;
    }
    vivos.push({
      ...npc,
      combat: { ...npc.combat, health: estado.health, max_health: estado.max_health },
    });
  }
  return { ...escena, npcs: vivos };
}

/** Lo que `materializeSpawn` come: la forma del effect `spawn_entity`, sin el
 *  `eventId` (que es del turno en el que ocurrió, y esto es un resume). */
export interface SpawnDeRuntime {
  entityId: string;
  entityKind: "npc" | "object" | "building";
  description: string;
  name?: string;
  position: [number, number, number];
  data: Record<string, unknown>;
}

const CLASES_QUE_VUELVEN = new Set(["npc", "object", "building"]);

/** Las entities que puso el MOTOR a mitad de partida, listas para volver a
 *  materializarse en el cliente.
 *
 *  Devuelve también los `errores`, y no los traga: una entity de runtime que
 *  no se puede rehidratar es algo que el jugador VIO y que al reanudar ya no
 *  está. El caller los manda a su canal (`errors.push("session", …)`).
 *
 *  Lo que NO es un error y por eso no aparece ahí: un muerto. Se salta a
 *  propósito y en silencio — que no vuelva es lo que se pidió. */
export function spawnsDeRuntime(entities: readonly EntityRecord[]): {
  spawns: SpawnDeRuntime[];
  errores: string[];
} {
  const spawns: SpawnDeRuntime[] = [];
  const errores: string[] = [];
  for (const rec of entities) {
    // La puerta única: lo de la escena vuelve por la escena. Sin este filtro
    // un `bandido_1` entraría por los DOS sitios y el jugador vería dos barras.
    if (rec.spawn_reason !== SPAWN_DE_RUNTIME) continue;
    if (!CLASES_QUE_VUELVEN.has(rec.type)) {
      errores.push(
        `entity de runtime "${rec.id}" no vuelve: tipo "${rec.type}" desconocido ` +
          `(esperaba npc|object|building)`,
      );
      continue;
    }
    const combate = combateDeEntity(rec);
    if (combate.tipo === "roto") {
      errores.push(`${combate.motivo} — no vuelve al mundo`);
      continue;
    }
    if (combate.tipo === "combate" && combate.combate.health <= 0) continue;
    const data = rec.data;
    const nombre = typeof data.name === "string" && data.name ? data.name : undefined;
    const descripcion =
      typeof data.description === "string" && data.description ? data.description : rec.id;
    spawns.push({
      entityId: rec.id,
      entityKind: rec.type as SpawnDeRuntime["entityKind"],
      description: descripcion,
      ...(nombre ? { name: nombre } : {}),
      position: [rec.position[0], rec.position[1], rec.position[2]],
      data,
    });
  }
  return { spawns, errores };
}
