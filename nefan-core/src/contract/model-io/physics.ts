/** La física del CONTRATO en un solo sitio: los cuerpos que alguien mueve y el
 *  tope de `footprint` que sale de ellos.
 *
 *  No define nada — los radios viven donde vive la colisión
 *  (`scene/terrain-collision.ts`) y el mpc donde vive el tile—: lo que hace es
 *  DERIVAR lo que los otros procesos necesitan y dejarlo en una forma
 *  serializable, para que ai_server pueda leerlo del snapshot
 *  (`data/contract/physics.json`, que escribe `scripts/dump-physics.ts`) en vez
 *  de copiar los números a mano.
 *
 *  Por qué existe, medido: la primera versión de #300 puso en
 *  `narrative_schemas.py` tres constantes copiadas (`TILE_MPC`,
 *  `NPC_RADIUS_M`, `PLAYER_RADIUS_M`) y derivó el tope Python de ESA copia.
 *  Movido `NPC_RADIUS_M` solo en TS, el tope TS pasaba a `{npc:3}`, el Python
 *  se quedaba en `{npc:2}` y los 136 tests de ai_server seguían en OK. Un tope
 *  declarado en dos sitios que pueden divergir en silencio es, palabra por
 *  palabra, el fallo que la tanda de #300 vino a cerrar, un piso más abajo.
 *
 *  Se vuelca el tope YA DERIVADO, no solo los ingredientes: si Python
 *  repitiera la cuenta serían dos fórmulas que también pueden divergir. Los
 *  ingredientes van igualmente, porque el mensaje de error que vuelve al motor
 *  habla en metros y tiene que decir los mismos que el TS. */

import { NPC_RADIUS_M, PLAYER_RADIUS_M, celdasQueCubreRadio } from "../../scene/terrain-collision.js";
import { TILE_MPC } from "../../scene/tile.js";

/** Los kinds que ALGUIEN MUEVE, con el radio del cuerpo que se mueve de
 *  verdad: `npc` lo mueve el simulador (`npc-behavior.ts`) y `player` lo mueve
 *  el cliente, que es autoritativo de su posición. Los otros cinco no se
 *  mueven, así que su `footprint` es geometría y no tiene tope: un granero de
 *  20×14 celdas es legítimo.
 *
 *  Los radios NO se copian aquí: se importan de donde vive la colisión, que es
 *  quien los honra. */
export const RADIO_SIMULADO_POR_KIND: Readonly<Record<string, number>> = {
  npc: NPC_RADIUS_M,
  player: PLAYER_RADIUS_M,
};

/** El footprint declarable de un kind móvil, en celdas del tile. `undefined`
 *  para los cinco kinds que nadie mueve. */
export function topeDeFootprint(kind: string): number | undefined {
  const radio = RADIO_SIMULADO_POR_KIND[kind];
  return radio === undefined ? undefined : celdasQueCubreRadio(radio, TILE_MPC);
}

/** Metros con coma decimal, como el resto de los mensajes que lee el motor. */
export const enMetros = (celdas: number): string => (celdas * TILE_MPC).toFixed(1).replace(".", ",");

export interface PhysicsSnapshot {
  $comment: string;
  tile_mpc: number;
  radio_simulado_m: Record<string, number>;
  footprint_max_cells: Record<string, number>;
}

/** Lo que se serializa a `data/contract/physics.json`. */
export function physicsSnapshot(): PhysicsSnapshot {
  return {
    $comment:
      "GENERADO por nefan-core/scripts/dump-physics.ts desde src/contract/model-io/physics.ts. " +
      "NO editar a mano: lo canda test/contract-physics.test.ts, que compara este fichero con la " +
      "fuente TS y falla si divergen. Lo lee ai_server (narrative_schemas.py) para topar el " +
      "`footprint` de una entity móvil con el mismo número que el zod, en vez de copiarlo.",
    tile_mpc: TILE_MPC,
    radio_simulado_m: { ...RADIO_SIMULADO_POR_KIND },
    footprint_max_cells: Object.fromEntries(
      Object.keys(RADIO_SIMULADO_POR_KIND).map((kind) => [kind, topeDeFootprint(kind)!]),
    ),
  };
}
