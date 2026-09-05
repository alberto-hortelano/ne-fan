/** LA FRONTERA ENTRE LO SERVIDO Y LO QUE SE RECUERDA (#410).
 *
 *  Una escena sale del bridge como `EscenaServida`: la world scene de
 *  `formatDToWorld` con las salidas del lugar ENCIMA (`bridge/wire-scene.ts`).
 *  Las dos mitades tienen vidas distintas. La escena cambia cuando el motor la
 *  re-emite; las salidas cambian cuando el mapa cambia (`exits_changed`), sin
 *  que la escena se toque. Y el cliente necesita saber cuál de las dos cambió:
 *  de «la escena cambió» depende si la colisión derivada del plan se restaura
 *  o se recalcula, y de las salidas no depende nada de eso.
 *
 *  Hasta esta tanda la huella del TileStore era `JSON.stringify(servida)`, con
 *  las salidas dentro: `actualizarSalidas` la desfasaba y la siguiente
 *  re-difusión del MISMO tile salía como «cambió» y re-derivaba la colisión.
 *  La opción barata era un `delete exits` antes de la huella, y es la que no
 *  se toma: la siguiente clave del overlay lo volvería a olvidar. Aquí el
 *  overlay se separa UNA vez, en la frontera, y la huella recibe un tipo en el
 *  que las salidas no caben: `EscenaSinSalidas` declara `exits?: never`, así
 *  que pasarle una servida no compila. Lo que sí entra en la huella, porque lo
 *  emite core y es geometría o estado de la escena: `position_declared`,
 *  `combat`, `__plan`, `terrain_grid`… todo lo que no sea `exits`. */

import type { WorldScene } from "../scene/scene-normalize.js";
import type { EscenaServida, SceneExit } from "./messages.js";

/** Una world scene de la que se han QUITADO las salidas. No es un alias de
 *  `WorldScene`: el `exits?: never` es lo que impide que una `EscenaServida`
 *  —que las lleva— pase por donde solo cabe esto. */
export type EscenaSinSalidas = WorldScene & { exits?: never };

/** Separa la escena servida en sus dos mitades. Destructuring y no `delete`:
 *  el objeto que llegó del wire no se muta, y el tipo del resto ya no lleva
 *  `exits`. */
export function separarSalidas(servida: EscenaServida): { escena: EscenaSinSalidas; exits: SceneExit[] } {
  const { exits, ...escena } = servida;
  return { escena, exits };
}

/** La huella con la que el cliente distingue «el tile vuelve igual» de «el tile
 *  CAMBIÓ». Solo acepta una escena sin salidas: es el tipo, no una convención,
 *  lo que mantiene el overlay fuera. */
export function huellaDeEscena(escena: EscenaSinSalidas): string {
  return JSON.stringify(escena);
}
