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

/** La frase del guion que terminó limpio sin haber afirmado nada. Se exporta
 *  porque el test que la congela y el runner que la empuja no pueden tenerla
 *  cada uno por su lado: dos copias de un texto divergen calladas. */
export const SIN_AFIRMAR =
  "no afirmó NADA: terminó limpio y sin un solo ctx.expect, así que su verde no dice nada " +
  "del juego. Si no había qué medir, se DECLARA con ctx.sinMedir(motivo) y sale ⊘; si había, " +
  "el aserto está dentro de un bucle o de un if que no se entró.";

/** El veredicto de UN guion, que no es solo «no arrastró fallos»: un verde
 *  exige haber AFIRMADO algo.
 *
 *  Sin esto, «no falló» y «no miró» eran el mismo ✔. El caso que lo pagó
 *  (#639): el 141 recorre las grabaciones de `labs/narrative/runs/` y su único
 *  `ctx.expect` vive DENTRO de ese bucle, así que en un árbol donde el
 *  directorio existe y está VACÍO el bucle no entra, el guion termina limpio y
 *  sale verde sin haber comprobado nada. Un verde que no puede ponerse rojo es
 *  lo más caro que hay en este banco, y el que no mira nada es su forma
 *  extrema — y no lo veía nadie, porque el runner solo miraba `fallos`.
 *
 *  Es ROJO y no ⊘ a propósito: el ⊘ se DECLARA, con su motivo
 *  (`ctx.sinMedir`), y quien no declaró nada y no midió nada tiene un defecto
 *  EN EL GUION, no una precondición rota. Al 141 se le enseñó a declararlo;
 *  esto es la red para el que no lo haga.
 *
 *  La frase solo se añade si el guion venía limpio: con fallos ya empujados el
 *  rojo ya está puesto y su causa es la de arriba, no ésta — el diagnóstico de
 *  un guion que revienta en la primera línea no es «no afirmó nada».
 *
 *  Medido ANTES de entrar (2026-09-17, censo estático de los 143): 142 afirman
 *  siempre, 1 puede no afirmar (el 141, y por eso se arregla con él) y 0 no
 *  afirman nunca. Nace verde y no pone en rojo a nadie más.
 *
 *  LO QUE NO MIRA, para que nadie lo cite como garantía. (1) Si lo afirmado es
 *  PERTINENTE: un `ctx.expect("ok", true)` cuenta, así que mide que hubo
 *  aserto, no que sirviera para algo ni que fuera sobre lo que el guion dice
 *  medir. (2) La mudez PARCIAL, que es la forma común del mismo defecto: un
 *  guion con doce asertos de los que once viven en un bucle que no se entra
 *  sale verde con el que quedó — el umbral es UNO, no «los suyos», porque
 *  cuántos le tocan a cada guion no lo sabe nadie. (3) Los ejecutables de
 *  `qa/*.mjs`, que no pasan por el runner y llevan su propio veredicto. */
export function veredictoDeGuion({ fallos, afirmaciones }) {
  if (!Array.isArray(fallos)) {
    throw new Error(`veredictoDeGuion exige la lista de fallos y llegó ${JSON.stringify(fallos)}`);
  }
  if (!Number.isInteger(afirmaciones) || afirmaciones < 0) {
    throw new Error(
      `veredictoDeGuion exige cuántas veces afirmó el guion (entero ≥ 0) y llegó ${JSON.stringify(afirmaciones)}`,
    );
  }
  if (fallos.length > 0) return { estado: ROJO, fallos };
  if (afirmaciones === 0) return { estado: ROJO, fallos: [SIN_AFIRMAR] };
  return { estado: VERDE, fallos };
}
