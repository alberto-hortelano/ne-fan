/** DÓNDE VUELVE EL JUGADOR AL MORIR.
 *
 *  Eran seis líneas dentro de `handleRespawnRequest`, en el `main.ts` del
 *  cliente (#241), sin un solo test detrás pese a ser la única regla que decide
 *  en qué punto del mundo continúa la partida. Aquí no hay DOM, ni sim, ni
 *  `gameClient`: entra dónde estaba el cadáver y sale un punto.
 *
 *  UNA SOLA REGLA: donde cayó, con la base a ras de suelo. Reaparecer en el
 *  mismo sitio es lo que el jugador espera y lo que conserva el contexto de la
 *  escena. La `y` a 0 no es cosmética: `position.y` es la BASE en la world
 *  scene, y un punto con otra cosa entierra al jugador o le deja flotando.
 *
 *  POR QUÉ NO MIRA EL MUNDO, dicho aquí porque el nombre invita a suponerlo:
 *  lo que el cliente le podía pasar era `CollisionSystem.collidesAt`, que no
 *  es «¿es sólido este PUNTO?» sino «¿puedo MOVERME de donde estoy hasta
 *  ahí?», y parte siempre de la posición del jugador. Preguntada por el punto
 *  del propio cadáver vale `false` SIEMPRE —hoy por construcción: con origen =
 *  destino la regla de penetración no creciente compara un número consigo
 *  mismo—, así que cualquier rama que cuelgue de ella aquí nace muerta. #538
 *  (2026-09-16) borró la que había, en vez de dejarla documentada como
 *  conducta.
 *
 *  Y SI EL JUGADOR REAPARECE DENTRO DE ALGO, SALE ANDANDO. Aquí ponía que el
 *  motivo era la regla «salir sí, entrar no» de `pasoDelJugador`, y era FALSO
 *  del terreno: esa regla eximía las CELDAS que ya se solapaban, lo que no
 *  saca de un macizo — de un edificio del pueblo no salía nadie, 0 de 36
 *  rumbos. Es la frase exacta que desmentía **#616**, y lo que la hace cierta
 *  hoy es el arreglo de ese issue (`simulation/salida-del-solido.ts`, tanda G,
 *  2026-09-17): el terreno tiene por fin la consulta de PUNTO, la penetración
 *  baja monótona y el paso que saca no se frena.
 *
 *  Que se salga andando NO decide dónde hay que reaparecer, y esta función
 *  sobrevive a la poda por eso: es la costura donde aterrizará la regla de
 *  reaparición el día que se decida (H10 de #538, en la sesión de diseño de
 *  combate junto a #377 y #325). Lo que #616 cambia es que ya no hay urgencia
 *  —reaparecer donde caíste dejó de ser un estado sin salida— y que la
 *  consulta que faltaba ya existe: quien vuelva aquí tiene
 *  `SimCollisionProvider.ocupado` y `sitioParaAparecer` para colgar de ellos.
 */

import type { Vec3 } from "../types.js";

export function puntoDeReaparicion(pos: { x: number; z: number }): Vec3 {
  return { x: pos.x, y: 0, z: pos.z };
}
