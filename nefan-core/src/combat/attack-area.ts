/** El ÁREA de un ataque cuerpo a cuerpo vista desde el suelo: la misma
 *  geometría que resuelve el daño (`combat-resolver`), pero expresada en el
 *  plano del ataque (avance `u` × lateral `s`, metros, origen en el atacante y
 *  `u` hacia su forward) para que el telegraph pueda DIBUJARLA.
 *
 *  Por qué vive en core y no en el renderer: hasta hoy `fps-gl.ts` llevaba su
 *  propia copia de la fórmula. Dos copias de la misma verdad divergen sin que
 *  nada falle — el parche seguiría pintando bonito mientras miente sobre dónde
 *  llega el golpe. Aquí hay una sola, y `test/attack-area.test.ts` la afirma
 *  contra `resolveAttack` punto por punto.
 *
 *  El área es la INTERSECCIÓN de tres restricciones, y el jugador necesita ver
 *  las tres (issue #184: la roja no se veía nunca y el arco tampoco):
 *
 *   1. anillo radial — `|d − óptimo| < tolerancia` (`calculateDistanceFactor`)
 *   2. banda lateral — `|s| < radio` (`calculatePrecisionFactor`)
 *   3. cono frontal  — `u / d > FRONT_COS`, ±60° (`isInFront`)
 *
 *  Puro: sin estado, sin `node:*`, sin three. */

import {
  FRONT_COS,
  calculateDistanceFactor,
  calculatePrecisionFactor,
} from "./combat-resolver.js";

/** Lo que el área necesita de los params efectivos del ataque (el resto
 *  —daño, wind-up, reducción— no tiene forma en el suelo). */
export interface AttackAreaParams {
  optimal_distance: number;
  distance_tolerance: number;
  area_radius: number;
}

/** Seno del semiángulo del cono, para medir la distancia PERPENDICULAR a su
 *  borde. `FRONT_COS` compara cosenos y sirve para decidir dentro/fuera, pero
 *  no dice a cuántos metros está la frontera: un contorno de ancho constante
 *  necesita metros, no cosenos. */
const FRONT_SIN = Math.sqrt(1 - FRONT_COS * FRONT_COS);

/** Distancia con signo al borde del CONO frontal, en metros (negativa dentro).
 *  Espejo exacto de `isInFront` —`|s|·cos < u·sen` ⟺ `u/d > FRONT_COS`— pero
 *  sin dividir: en el origen no hace falta un caso aparte (allí vale 0, o sea
 *  FUERA, que es lo que dice `isInFront` con su vector nulo). Una sola
 *  expresión del cono para la calidad y para el margen: con dos, el parche
 *  podría dibujar un arco distinto del que golpea. */
function conoMargin(u: number, s: number): number {
  return Math.abs(s) * FRONT_COS - u * FRONT_SIN;
}

/** Calidad del golpe (0..1) en el punto `(u, s)` del plano del ataque, sin
 *  factor táctico ni daño base: el mismo producto `distancia × precisión` que
 *  `resolveAttack`, con su mismo gate frontal. */
export function attackAreaQuality(p: AttackAreaParams, u: number, s: number): number {
  if (conoMargin(u, s) >= 0) return 0;
  return (
    calculateDistanceFactor(Math.hypot(u, s), p.optimal_distance, p.distance_tolerance) *
    calculatePrecisionFactor(Math.abs(s), p.area_radius)
  );
}

/** Distancia con signo al BORDE del área, en metros: negativa dentro, positiva
 *  fuera, cero justo en la frontera. Es el `max` de las tres restricciones
 *  —el borde real es el de la que primero se agota— y cada una se mide como
 *  distancia perpendicular a su frontera, para que un contorno de grosor fijo
 *  salga del mismo grosor en las tres.
 *
 *  Existe porque la calidad NO sirve para dibujar el borde: vale 0 en toda la
 *  frontera y también en todo el exterior, así que no distingue "al borde" de
 *  "lejísimos". El margen sí. */
export function attackAreaMargin(p: AttackAreaParams, u: number, s: number): number {
  const d = Math.hypot(u, s);
  const radial = Math.abs(d - p.optimal_distance) - p.distance_tolerance;
  const lateral = Math.abs(s) - p.area_radius;
  return Math.max(radial, lateral, conoMargin(u, s));
}

/** Punto o dirección en el plano del suelo (metros). La `y` no interviene: el
 *  área del ataque es plana. */
export interface AreaPlaneVec {
  x: number;
  z: number;
}

/** Calidad que TIÑE el destello de impacto (0..1): la del MEJOR objetivo
 *  dentro del área, 0 si no hay ninguno. Proyecta cada objetivo al plano del
 *  ataque —avance sobre el `forward` del atacante, lateral a su derecha— y lo
 *  evalúa con la misma `attackAreaQuality` que dibuja el parche y que resuelve
 *  el daño.
 *
 *  Vive en core porque la PROYECCIÓN es parte de la fórmula, no del dibujo. El
 *  cliente llevaba la suya escrita a mano —`distancia × precisión` sin el cono
 *  frontal—, así que un enemigo a la ESPALDA teñía el destello de verde
 *  («golpe perfecto») mientras el resolver no le hacía ni un punto de daño. */
export function attackFlashQuality(
  p: AttackAreaParams,
  from: AreaPlaneVec,
  forward: AreaPlaneVec,
  targets: Iterable<AreaPlaneVec>,
): number {
  let mejor = 0;
  for (const t of targets) {
    const dx = t.x - from.x;
    const dz = t.z - from.z;
    const avance = forward.x * dx + forward.z * dz;
    const lateral = forward.x * dz - forward.z * dx;
    const q = attackAreaQuality(p, avance, lateral);
    if (q > mejor) mejor = q;
  }
  return mejor;
}

/** Alcance del área a lo largo del forward (`s = 0`): el borde CERCA y el
 *  borde LEJOS, en metros. Es lo que el jugador necesita saber —dónde empieza
 *  y dónde deja de llegar el golpe— y lo que el renderer proyecta a pantalla
 *  para poder afirmar sin leer píxeles que la frontera está en cuadro. */
export function attackAreaReach(p: AttackAreaParams): { cerca: number; lejos: number } {
  return {
    cerca: Math.max(0, p.optimal_distance - p.distance_tolerance),
    lejos: p.optimal_distance + p.distance_tolerance,
  };
}
