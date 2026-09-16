/** LAS CAJAS DE LO QUE EL MOTOR PONE A MITAD DE PARTIDA, para quien mueve a
 *  los NPCs.
 *
 *  Lo que DECLARA un tile ya frena a los dos desde #232: su huella entra en el
 *  plan compuesto y el bridge lo rasteriza igual que el cliente. Lo que el
 *  motor spawnea a mitad de partida no está en el plan de nadie —su caja es lo
 *  único que hay—, y hasta #583 esa caja solo la miraba el JUGADOR
 *  (`aabbBloquea`, en el módulo de al lado): mismo granero, misma coordenada,
 *  sólido para quien juega y transparente para el NPC.
 *
 *  LA GEOMETRÍA NO ES DE AQUÍ, y es a propósito: la pone `cajaBloquea`, la
 *  misma que decide dónde se para el jugador. Dos cuerpos con dos ideas de
 *  dónde acaba una caja es el defecto que este módulo existe para cerrar, así
 *  que aquí solo vive QUÉ cajas hay y CUÁL de ellas contesta.
 *
 *  LA FUENTE ES `spawnsDeRuntime` y no `narrative.entities` en crudo. El
 *  ledger lleva también lo que sembró la escena (`scene_init`, que YA está en
 *  el plan: contarlo otra vez sería ponerle una segunda caja ciega encima),
 *  los NPCs y los cadáveres, y crece sin tope. `spawnsDeRuntime` es la puerta
 *  que el resume ya usa para la misma pregunta —qué puso el motor y qué tamaño
 *  tiene—, con el `footprint` DECLARADO mandando sobre el defecto de la clase
 *  (#532).
 *
 *  SIN CACHÉ, y también a propósito. Estas cajas aparecen a mitad de partida,
 *  que es justo cuando una caché por escena no se invalida: la de
 *  `collidersFor` cachea el plan del tile porque nada revisa un plan ya
 *  emitido, pero una entity nueva entra en el ledger sin que nadie recargue la
 *  escena. Derivarlas en cada consulta no puede quedarse rancio porque no hay
 *  clave que envejecer. El coste está medido y escrito en `sim-collision.ts`.
 */

import type { EntityRecord } from "../narrative/types.js";
import { spawnsDeRuntime, type SpawnDeRuntime } from "../session/mundo-persistido.js";
import { cajaBloquea, penetracionEnCaja, type CajaXZ } from "./obstaculos-del-jugador.js";

/** Una caja de runtime: la geometría de `CajaXZ` más DE QUIÉN es, porque quien
 *  la atraviesa tiene que poder decir a qué se la saltó. */
export interface CajaDeRuntime extends CajaXZ {
  /** `entityId` del record que la puso — el que sale en la traza. */
  id: string;
}

/** QUÉ IMPIDE UN PASO, que no es lo mismo que si lo impide algo.
 *
 *  Existe porque el escape del encajonado (#583) solo puede abrirse sobre las
 *  cajas de runtime: un NPC que atraviesa un granero recién puesto se lee como
 *  raro, y uno que atraviesa el muro del pueblo se lee como que el mundo es
 *  mentira. Un booleano colapsa los dos casos y no deja decidir. */
export type Impedimento = null | { de: "tile" } | { de: "caja"; id: string };

/** Las cajas de los spawns que OCUPAN SITIO, en metros y coordenadas de mundo.
 *
 *  Las clases son las mismas dos que frenan al jugador —`aabbBloquea` mira
 *  `category` `building`/`prop`, que es lo que `materializar-spawn.ts` pinta
 *  para ellas—, y son las dos escritas a mano y no una lista: un `item` se
 *  PISA por contrato (#532) y un `npc` no lleva huella por tipo (su cuerpo es
 *  un radio, y quien lo mueve ya lo conoce). Dejar entrar cualquiera de los
 *  dos no es un tamaño de más: es un sitio del suelo que deja de poder
 *  pisarse. */
export function cajasDeSpawns(spawns: readonly SpawnDeRuntime[]): CajaDeRuntime[] {
  const cajas: CajaDeRuntime[] = [];
  for (const spawn of spawns) {
    if (spawn.entityKind !== "building" && spawn.entityKind !== "object") continue;
    cajas.push({
      id: spawn.entityId,
      pos: { x: spawn.position[0], z: spawn.position[2] },
      sizeXZ: spawn.sizeXZ,
    });
  }
  return cajas;
}

/** LA PUERTA: del ledger a las cajas, en un paso y por el mismo sitio que el
 *  resume.
 *
 *  Los `errores` de `spawnsDeRuntime` no se leen aquí, y conviene decir por
 *  qué en vez de que parezca un `catch` vacío: solo los produce un record de
 *  `type` desconocido o sin estado de combate legible, que por definición no es
 *  una caja — no hay nada que este módulo pudiera hacer con ellos. Sus dueños
 *  son el resume (que se los enseña al jugador: algo que vio y no vuelve) y
 *  `npcSync`. */
export function cajasDeRuntime(entities: readonly EntityRecord[]): CajaDeRuntime[] {
  return cajasDeSpawns(spawnsDeRuntime(entities).spawns);
}

/** La primera caja que frena este paso, o `null`. «Frenar» es lo mismo que
 *  para el jugador: `cajaBloquea`, o sea PENETRACIÓN NO CRECIENTE. Quien ya
 *  está dentro de una —un spawn le cayó encima— puede salir andando, y por eso
 *  el escape no es para él. */
export function cajaQueBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  cajas: readonly CajaDeRuntime[],
): CajaDeRuntime | null {
  for (const caja of cajas) {
    if (cajaBloquea(desde, hasta, radio, caja)) return caja;
  }
  return null;
}

/** La primera caja en la que este cuerpo está METIDO, o `null`: la pregunta
 *  de PUNTO, la que contesta «¿este sitio está ocupado?» sin mirar de dónde se
 *  viene. La usa `blocksCircle` —elegir un waypoint, sembrar a alguien— donde
 *  la de movimiento no sirve: hacia un punto al que ya se está no hay paso que
 *  bloquear. */
export function cajaQueContiene(
  x: number,
  z: number,
  radio: number,
  cajas: readonly CajaDeRuntime[],
): CajaDeRuntime | null {
  for (const caja of cajas) {
    if (penetracionEnCaja({ x, z }, caja, radio) > 0) return caja;
  }
  return null;
}
