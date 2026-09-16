/** DÓNDE SE PONE CADA COSA cuando el motor manda varias en el MISMO turno.
 *
 *  El problema, medido (#524): el bridge las separaba **1,8 m fijos**
 *  (`SEPARACION_M`, retirada con este módulo) sin mirar el TAMAÑO de lo que
 *  separaba. Con las cajas ya sólidas (#489) y las huellas que el motor puede
 *  declarar desde #532, ese número no se sostiene:
 *
 *   · dos `object` (1,5 m de lado) dejaban **0,3 m** entre caras — el cuerpo
 *     del jugador mide 0,8, así que el hueco existía y no se podía cruzar;
 *   · dos `building` (4 m) **se solapaban 0,4 m**: dos cajas sólidas ocupando
 *     el mismo suelo;
 *   · un `npc` del mismo turno caía **DENTRO** de la caja del edificio (1,8 m
 *     de separación contra 2 m de media huella).
 *
 *  Y el error CRECE con lo que el motor ponga: un carro de `[6,6]` mide 3 m y
 *  un granero de `[20,14]`, diez. Un número fijo no puede seguir a un tamaño
 *  declarado.
 *
 *  LO QUE NO ES ESTE MÓDULO, dicho porque el issue lo pide y no se sostiene:
 *  «el jugador queda encajonado». No queda: `aabbBloquea` tiene «salir sí,
 *  entrar no» (`simulation/obstaculos-del-jugador.ts`), así que a quien
 *  aparezca dentro de una caja no se le atrapa. Lo demostrable es el SOLAPE, y
 *  es lo que se arregla aquí.
 *
 *  LA REGLA, en una frase: el primero cae donde siempre y cada uno de los
 *  demás se pone al lado del ÚLTIMO DE SU LADO, contando desde su BORDE y no
 *  desde su centro — que es exactamente lo que el número fijo no sabía hacer.
 *
 *  Módulo puro y aparte del despacho (`consequence-handler`) a propósito: es
 *  aritmética con casos, y aquí tiene batería y medida propias. */

import { RADIO_SIMULADO_POR_KIND } from "../contract/model-io/physics.js";
import { huellaEnMetros } from "../scene/scene-normalize.js";
import { PLAYER_RADIUS_M } from "../scene/terrain-collision.js";

/** Hueco libre que queda entre las caras de dos cosas del mismo turno.
 *
 *  El cuerpo del jugador (`2 × PLAYER_RADIUS_M` = 0,8 m) más un palmo: pasar
 *  rozando no es pasar, y `aabbBloquea` infla cada caja por el radio del
 *  jugador, así que con EXACTAMENTE 0,8 m las dos cajas infladas se tocarían y
 *  el pasillo sería intransitable — el mismo fallo de los 0,3 m, más fino. El
 *  margen es lo único elegido a ojo de este módulo, y se elige por arriba.
 *
 *  ESTÁ DIMENSIONADO PARA EL JUGADOR Y SE QUEDA CORTO PARA EL NPC, y la cuenta
 *  es de dos constantes que ya están en el árbol:
 *
 *    · este hueco vale **1,0 m** (0,4 × 2 + 0,2);
 *    · el cuerpo del NPC es el MAYOR del juego (`NPC_RADIUS_M` = 0,5) y la
 *      regla de la casa para «¿cabe por aquí?» es `celdasLibresParaRadio(0,5,
 *      0,5)` = 3 celdas = **1,5 m** (#289). Y el propio inverso de
 *      `blocksCircle` pide ESTRICTAMENTE mayor que el diámetro, así que 1,0 m
 *      no admite un cuerpo de 1,0 m ni empatando.
 *
 *  O sea: por el pasillo que deja este número pasa el jugador y no pasa un
 *  NPC. Desde #583 las cajas de estos spawns también son sólidas para él, así
 *  que el hueco es suyo tanto como del jugador. No encierra a nadie —cuando un
 *  NPC agota sus siete deflexiones atraviesa la caja y lo dice
 *  (`simulation/npc-behavior.ts`)—, pero ese escape es una red, no la medida
 *  correcta. Quien suba este número a `2 × NPC_RADIUS_M + margen` está
 *  arreglando esto; quien lo baje, reabriéndolo. Rastro de procedencia: #524
 *  (que puso el reparto por tamaño) y #289 (que fijó cuánto hueco pide cada
 *  cuerpo). */
export const HOLGURA_ENTRE_SPAWNS_M = 2 * PLAYER_RADIUS_M + 0.2;

/** Lo que el reparto necesita saber de cada cosa: su clase y la huella que el
 *  motor declaró (si la declaró). El resto —dónde cae, cómo se llama— no le
 *  incumbe. */
export interface CuerpoDelTurno {
  kind: string;
  footprint?: readonly [number, number] | null;
}

/** Media anchura de un cuerpo, EN METROS: lo que ocupa a cada lado de su
 *  centro cuando se le pone algo al lado.
 *
 *  Un `npc` no es una caja —colisiona por el radio de su cuerpo, y es el mismo
 *  número con el que el simulador lo mueve (`RADIO_SIMULADO_POR_KIND`)—; lo
 *  demás sale de `huellaEnMetros`, la misma función que llena el `sizeXZ` del
 *  effect, con el footprint declarado si lo hay.
 *
 *  Se coge el lado MAYOR y no el del eje lateral: el reparto va perpendicular
 *  al forward del jugador, que no tiene por qué estar alineado con los ejes
 *  del mundo, y las cajas sí lo están. Con el lado mayor no hay orientación en
 *  la que dos cuerpos se toquen; con el lateral, las hay. */
export function mediaAnchura(cuerpo: CuerpoDelTurno): number {
  const radio = RADIO_SIMULADO_POR_KIND[cuerpo.kind];
  if (radio !== undefined) return radio;
  const huella = huellaEnMetros(cuerpo.kind, cuerpo.footprint ?? null);
  return Math.max(huella.x, huella.z) / 2;
}

/** El desplazamiento LATERAL de cada cosa del turno, en metros y con signo
 *  (positivo a un lado, negativo al otro). El primero va a 0: cae donde
 *  siempre, y por eso un turno de UNA sola cosa no cambia de sitio.
 *
 *  Los demás alternan lado y se apoyan en el borde del último de SU lado:
 *  `centro = borde + holgura + media anchura`. Así el hueco entre caras es
 *  siempre `HOLGURA_ENTRE_SPAWNS_M`, midan lo que midan — que es lo que un
 *  número fijo no podía prometer. */
export function repartirEnElTurno(cuerpos: readonly CuerpoDelTurno[]): number[] {
  const salida: number[] = [];
  // Hasta dónde llega lo ya colocado a cada lado, medido desde el centro del
  // primero. Los dos empiezan en su media anchura: es el sitio que ocupa él.
  const borde = { 1: 0, [-1]: 0 };
  cuerpos.forEach((cuerpo, i) => {
    const mitad = mediaAnchura(cuerpo);
    if (i === 0) {
      salida.push(0);
      borde[1] = mitad;
      borde[-1] = mitad;
      return;
    }
    // Alternando: el segundo a un lado, el tercero al otro, el cuarto al
    // primero otra vez. Con las cosas repartidas a los dos lados, el jugador
    // tiene el pasillo del medio libre venga por donde venga.
    const lado = i % 2 === 1 ? 1 : -1;
    const centro = borde[lado] + HOLGURA_ENTRE_SPAWNS_M + mitad;
    salida.push(lado * centro);
    borde[lado] = centro + mitad;
  });
  return salida;
}
