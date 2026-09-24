/** EL ENTORNO CONTRA EL QUE MIDE CADA GUION (tanda AS, 2026-09-24).
 *
 *  Pagar arte en los caminos automáticos es CONFIGURACIÓN: el bridge lee
 *  `NEFAN_ENTORNO` al arrancar y en `desarrollo` —el defecto— ningún camino
 *  automático genera (`gatesDeImagen`, nefan-core). Eso parte el banco en dos:
 *  los guiones que MIDEN QUE SE PINTA (59, 88, 114…) necesitan `produccion`
 *  contra el motor falso, o saldrían verdes sin medir nada; y los que miden
 *  que en desarrollo NO se paga necesitan `desarrollo`. Una constante no puede
 *  valer las dos cosas a la vez, así que el entorno es del STACK y cada guion
 *  declara contra cuál mide:
 *
 *      export const entorno = "desarrollo";
 *
 *  Sin declarar vale `produccion`, que es lo que medía el banco hasta hoy (el
 *  motor falso es gratis): ningún guion anterior cambia de significado sin que
 *  nadie lo decida. El runner (`qa/run.mjs`) ordena los guiones por entorno,
 *  levanta un stack por grupo con su `NEFAN_ENTORNO`, y ANTES de cada cuerpo
 *  comprueba en la página (`__nefan.entorno`, lo que dijo el `bridge_hello`)
 *  que el stack es el declarado: con `--url`/`--adoptar` el stack es ajeno y no
 *  se puede reiniciar, así que el guion que no casa sale ⊘ diciéndolo.
 *
 *  Módulo PURO (sin navegador, sin stack): lo mide
 *  `nefan-core/test/el-banco-declara-el-modo-de-gasto.test.ts`. */

/** Los dos entornos, con los MISMOS nombres que `Entorno` de core
 *  (`session/gates-de-imagen.ts`). El test los compara con los de core. */
export const ENTORNOS = ["desarrollo", "produccion"];

/** El entorno de un guion que no declara nada. */
export const ENTORNO_DEL_BANCO = "produccion";

/** La declaración, leída del FICHERO para poder ordenar sin importar (importar
 *  un guion tiene efectos). La que manda es el `export` del módulo, que valida
 *  `entornoDeclarado`: si las dos no dicen lo mismo, el guion sale ⊘. */
const DECLARA_ENTORNO = /^export const entorno\s*=\s*["'`]([^"'`]*)["'`]/m;

/** El entorno que declara el TEXTO de un guion (sin validar), o
 *  `ENTORNO_DEL_BANCO` si no declara nada. */
export function entornoDelFuente(fuente) {
  return DECLARA_ENTORNO.exec(fuente)?.[1] ?? ENTORNO_DEL_BANCO;
}

/** El entorno que declara el MÓDULO. Ausente = `ENTORNO_DEL_BANCO`; cualquier
 *  otra cosa que no sea uno de los dos nombres LANZA con nombre: una
 *  declaración mal escrita no puede acabar midiendo contra el stack que no era.
 */
export function entornoDeclarado(nombre, valor) {
  if (valor === undefined) return ENTORNO_DEL_BANCO;
  if (!ENTORNOS.includes(valor)) {
    throw new Error(
      `${nombre}: \`export const entorno\` vale ${JSON.stringify(valor)} y tiene que ser uno de ` +
        `${ENTORNOS.map((e) => JSON.stringify(e)).join(" o ")}`,
    );
  }
  return valor;
}

/** Los guiones ordenados para que cada entorno vaya SEGUIDO (un reinicio del
 *  stack por cambio de grupo, no uno por guion): primero los del banco
 *  (`produccion`), luego `desarrollo`. ESTABLE: dentro de cada grupo se
 *  conserva el orden que traían (`--orden`). `entornoDe(nombre)` dice el de
 *  cada uno. */
export function ordenarPorEntorno(guiones, entornoDe) {
  const peso = (g) => (entornoDe(g) === ENTORNO_DEL_BANCO ? 0 : 1);
  return guiones.map((g, i) => ({ g, i })).sort((a, b) => peso(a.g) - peso(b.g) || a.i - b.i).map((x) => x.g);
}
