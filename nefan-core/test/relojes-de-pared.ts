/** El detector de RELOJES DE PARED en un fuente del banco (#711).
 *
 *  Un guion que mide el juego —metros por segundo, frames por segundo, cuánto
 *  tarda algo en ocurrir DENTRO del mundo— tiene que dividir por el reloj de
 *  SIMULACIÓN (`window.__nefan.reloj().sim`), no por el de pared: bajo carga la
 *  pared corre y el mundo no, y la medida se rompe sin que el juego haya
 *  cambiado. Es la cura del guion 93 (#679): su `medirVelocidad` divide por
 *  `reloj.sim`, y si alguien devuelve el denominador al timestamp que
 *  `requestAnimationFrame` le pasa a su callback, solo lo vería el reproductor
 *  bajo carga (`qa/bajo-carga.mjs`, ~20 min a mano).
 *
 *  Aquí se censan, por el ÁRBOL de TypeScript —los comentarios y los strings no
 *  son nodos que lean un reloj, así que la prosa se excluye sola—, las formas en
 *  que un guion lee la pared:
 *
 *   · `performance.now` y `Date.now`: toda REFERENCIA a esa propiedad, llamada
 *     o no (`performance.now.bind(performance)` también lee la pared), también
 *     con corchetes (`performance["now"]`) y con `window.`/`globalThis.`/`self.`
 *     delante.
 *   · `new Date()` SIN argumentos (con argumento convierte una fecha, no la lee).
 *   · `document.timeline.currentTime`: el mismo reloj que el timestamp del rAF.
 *   · `process.hrtime`: la pared de Node (`hrtime()` y `hrtime.bigint()`).
 *   · `raf-param`: una LLAMADA a `requestAnimationFrame` (o a
 *     `window.`/`globalThis.`/`self.requestAnimationFrame`) cuyo primer argumento
 *     es una función con al menos un parámetro —el timestamp de pared—, escrita
 *     en línea o NOMBRADA por un identificador que se resuelve a su
 *     declaración (`const tick = (t) => …` o `function tick(t)`) subiendo por
 *     los ámbitos léxicos desde la llamada. Esa segunda forma es EXACTAMENTE la
 *     regresión del 93, y por eso se resuelve. Asignar A la función
 *     (`window.requestAnimationFrame = (cb) => …`, como hacen 131/132/133 para
 *     pausar el loop) no es una llamada y no cuenta: el `cb` de ese reemplazo
 *     es el callback del JUEGO, no un reloj que lea el guion.
 *
 *  Lo que NO ve, medido, está en `_lo_que_esto_NO_sujeta` del padrón
 *  (`data/contract/relojes-de-pared.json`) y en los `it` «LÍMITE MEDIDO» de
 *  `el-reloj-de-pared-tiene-padron.test.ts`.
 *
 *  Puro (sin `node:*`): quien lo llama lee los ficheros. */
import ts from "typescript";

export type FormaDeReloj =
  | "performance.now"
  | "Date.now"
  | "new Date()"
  | "document.timeline"
  | "process.hrtime"
  | "raf-param";

export interface Reloj {
  /** 1-based, como la da un editor. */
  linea: number;
  forma: FormaDeReloj;
}

/** Los prefijos que no cambian de qué reloj se habla: `window.performance`. */
const GLOBALES: ReadonlySet<string> = new Set(["window", "globalThis", "self"]);

const desenvuelve = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? desenvuelve(e.expression) : e);

/** ¿`e` nombra el global `nombre`, a pelo o detrás de `window.`/`globalThis.`/`self.`? */
function esGlobal(e: ts.Expression, nombre: string): boolean {
  const x = desenvuelve(e);
  if (ts.isIdentifier(x)) return x.text === nombre;
  return ts.isPropertyAccessExpression(x) && x.name.text === nombre && ts.isIdentifier(x.expression) && GLOBALES.has(x.expression.text);
}

/** El nombre de la propiedad que lee un acceso `a.b` o `a["b"]`, y su objeto. */
function acceso(n: ts.Node): { objeto: ts.Expression; propiedad: string } | null {
  if (ts.isPropertyAccessExpression(n)) return { objeto: n.expression, propiedad: n.name.text };
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
    return { objeto: n.expression, propiedad: n.argumentExpression.text };
  }
  return null;
}

type Funcion = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** La función que DECLARA `nombre` en el ámbito léxico más cercano a `desde`:
 *  un `const/let/var nombre = <función>` o un `function nombre(…)` entre las
 *  sentencias de un bloque, del fichero o de una cláusula de `switch` que
 *  contenga la llamada. Si el nombre es un PARÁMETRO de una función que la
 *  contiene, el valor llega de fuera y no se resuelve (`null`): límite medido. */
function resuelve(nombre: string, desde: ts.Node): Funcion | null {
  for (let p: ts.Node | undefined = desde.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && p.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === nombre)) return null;
    const sentencias = ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) ? p.statements : null;
    if (!sentencias) continue;
    for (const s of sentencias) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === nombre) return s;
      if (!ts.isVariableStatement(s)) continue;
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== nombre) continue;
        // Declarado aquí: este ámbito manda, sea o no una función.
        const init = d.initializer && desenvuelve(d.initializer);
        return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
      }
    }
  }
  return null;
}

/** ¿El primer argumento de esta llamada a rAF es un callback que RECIBE el timestamp? */
function callbackConTiempo(llamada: ts.CallExpression): boolean {
  const arg = llamada.arguments[0] && desenvuelve(llamada.arguments[0]);
  if (!arg) return false;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg.parameters.length > 0;
  if (ts.isIdentifier(arg)) return (resuelve(arg.text, llamada)?.parameters.length ?? 0) > 0;
  return false;
}

/** Los relojes de pared de este fuente, en orden de aparición. */
export function relojesDe(fuente: string): Reloj[] {
  const sf = ts.createSourceFile("x.mjs", fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: Reloj[] = [];
  const apunta = (n: ts.Node, forma: FormaDeReloj): void => {
    out.push({ linea: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, forma });
  };
  const visita = (n: ts.Node): void => {
    const a = acceso(n);
    if (a) {
      if (a.propiedad === "now" && esGlobal(a.objeto, "performance")) apunta(n, "performance.now");
      else if (a.propiedad === "now" && esGlobal(a.objeto, "Date")) apunta(n, "Date.now");
      else if (a.propiedad === "hrtime" && esGlobal(a.objeto, "process")) apunta(n, "process.hrtime");
      else if (a.propiedad === "currentTime") {
        const t = acceso(desenvuelve(a.objeto));
        if (t && t.propiedad === "timeline" && esGlobal(t.objeto, "document")) apunta(n, "document.timeline");
      }
    }
    if (ts.isNewExpression(n) && esGlobal(n.expression, "Date") && (n.arguments?.length ?? 0) === 0) apunta(n, "new Date()");
    if (ts.isCallExpression(n) && esGlobal(n.expression, "requestAnimationFrame") && callbackConTiempo(n)) apunta(n, "raf-param");
    ts.forEachChild(n, visita);
  };
  visita(sf);
  return out;
}
