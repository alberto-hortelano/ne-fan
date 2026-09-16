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
 *  este repositorio no tiene una pregunta «¿es sólido este PUNTO?» para las
 *  cajas, solo «¿puedo MOVERME de donde estoy hasta ahí?»
 *  (`CollisionSystem.collidesAt`, que parte siempre de la posición del
 *  jugador). Preguntada por el punto del propio cadáver contesta «libre» en
 *  todo lo que el juego produce —medido sobre las tres fixtures: 99.932 puntos
 *  y ni uno sólido, `qa/la-puerta-de-la-reaparicion.mjs`—, así que cualquier
 *  rama que cuelgue de ella aquí nace muerta. #538 (2026-09-16) borró la que
 *  había, en vez de dejarla documentada como conducta. (El único origen =
 *  destino que sí bloquea es la TANGENCIA exacta del cuerpo con el borde de
 *  una celda sólida, que pide una coordenada que el juego no genera; el mismo
 *  guion la imprime en cada corrida para que el absoluto no se escriba solo.)
 *  Si el jugador reaparece dentro de algo, sale andando por la regla «salir
 *  sí, entrar no» de `pasoDelJugador`, que es su hermano y el motivo de que no
 *  se quede atrapado.
 *
 *  La función sobrevive a la poda a propósito: es la costura donde aterrizará
 *  la regla de reaparición el día que se decida (H10 de #538, en la sesión de
 *  diseño de combate junto a #377 y #325), y hace falta la consulta que falta
 *  ANTES de volver a colgar nada de aquí.
 */

import type { Vec3 } from "../types.js";

export function puntoDeReaparicion(pos: { x: number; z: number }): Vec3 {
  return { x: pos.x, y: 0, z: pos.z };
}
