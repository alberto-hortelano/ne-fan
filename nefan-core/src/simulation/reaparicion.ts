/** A RAS DE SUELO: el punto donde vuelve el jugador al morir, sacado de una
 *  posición.
 *
 *  QUÉ posición no la decide esta función. En partida la elige el MOTOR
 *  narrativo al morir el jugador (#613, decisión del usuario 2026-09-29: «Que
 *  decida el motor»), y la valida `simulation/despertar.ts`; sin motor
 *  (fixtures), R levanta en el último punto seguro del sim, que es donde esta
 *  función se sigue usando: `GameSimulation` apunta con ella el último sitio
 *  en que el jugador estaba vivo y nadie le tenía enganchado. Hasta la tanda
 *  BN el punto era «donde cayó» y lo calculaba el cliente (`main.ts`).
 *
 *  Aquí queda lo que no depende del combate: la `y` a 0. No es cosmética:
 *  `position.y` es la BASE en la world scene, y un punto con otra cosa entierra
 *  al jugador o le deja flotando.
 *
 *  POR QUÉ NO MIRA EL MUNDO, dicho aquí porque el nombre invita a suponerlo:
 *  lo que el cliente le podía pasar era `CollisionSystem.collidesAt`, que no
 *  es «¿es sólido este PUNTO?» sino «¿puedo MOVERME de donde estoy hasta
 *  ahí?», y parte siempre de la posición del jugador. Preguntada por el punto
 *  del propio cadáver vale `false` SIEMPRE —hoy por construcción: con origen =
 *  destino la regla de penetración no creciente compara un número consigo
 *  mismo—, así que cualquier rama que cuelgue de ella aquí nace muerta. #538
 *  (2026-09-16) borró la que había, y `qa/la-puerta-de-la-reaparicion.mjs`
 *  canda que no vuelva.
 *
 *  Y SI EL JUGADOR REAPARECE DENTRO DE ALGO, SALE ANDANDO: es el arreglo de
 *  #616 (`simulation/salida-del-solido.ts`, tanda G, 2026-09-17) — el terreno
 *  tiene la consulta de PUNTO, la penetración baja monótona y el paso que saca
 *  no se frena. Y el despertar del motor pasa además por `sitioParaAparecer`
 *  (`validarDespertar`): nunca se despierta dentro de un sólido.
 */

import type { Vec3 } from "../types.js";

export function puntoDeReaparicion(pos: { x: number; z: number }): Vec3 {
  return { x: pos.x, y: 0, z: pos.z };
}
