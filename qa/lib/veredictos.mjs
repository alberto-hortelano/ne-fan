/** La escala ÚNICA de veredictos de una corrida de QA, y el exit que deriva.
 *
 *  Hasta #331 había DOS escalas con el mismo icono `⊘`: la de `qa/run.mjs`
 *  (VERDE/ROJO/SIN_MEDIR) y la de `qa/lib/presets-clasifica.mjs`
 *  (OK/ROJO/AJENO), cuya doc ya declaraba EN PROSA que AJENO «es el mismo que
 *  ⊘ SIN MEDIR». Una equivalencia que solo existe en prosa diverge sin que
 *  nadie lo note; aquí pasa al código, y `AJENO` muere como ESTADO —
 *  sobrevive como detalle (`ajenos[]` en presets-clasifica: quién ocupaba qué
 *  puerto), que es lo que siempre fue.
 */

/** Los tres veredictos posibles de una medida (un guion, un preset), que hasta
 *  #272 eran dos.
 *
 *  «Falló» y «no pudo medir» no son lo mismo y confundirlos es lo que hace que
 *  un rojo de verdad se cuele: una corrida cuyo stack se cayó a mitad pintaba
 *  siete guiones ✘ —9/23 cuando en realidad eran 14— y no había en toda la
 *  salida una sola línea que permitiera distinguirlo del juego roto. Cada
 *  investigación de un rojo espurio cuesta lo mismo que la de uno real. */
export const VERDE = "verde";
export const ROJO = "rojo";
export const SIN_MEDIR = "sin-medir";

export const ICONO = { [VERDE]: "✔", [ROJO]: "✘", [SIN_MEDIR]: "⊘" };

/** El código de salida de una CORRIDA, que no es la suma de sus veredictos:
 *
 *    0  todo verde
 *    1  hay medidas en rojo, y todas midieron: es el sujeto (el juego, el
 *       launcher)
 *    2  algo no llegó a medir: la corrida NO dice nada del sujeto, ni bueno
 *       ni malo
 *
 *  El 2 gana al 1 a propósito: con algo sin medir dentro, ni los rojos son de
 *  fiar. Corolario que hereda el `⊘` que un guion DECLARA (#331): reconvertir
 *  un rojo en ⊘ EMPEORA el exit por construcción — el canal no es una vía de
 *  escape. */
export function exitDeCorrida(rojos, noMedidos) {
  return noMedidos > 0 ? 2 : rojos > 0 ? 1 : 0;
}
