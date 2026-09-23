/** El detector de SALTOS SIN OBSERVAR de un guion de `qa/guiones/` (#356,
 *  tanda AG, 2026-09-23). Lo consume `un-salto-del-guion-se-observa.test.ts`.
 *
 *  El agujero: un guion que aserta otras cosas y se salta UN bloque por una
 *  precondición sale VERDE (`if (!x) { ctx.log("no se pudo"); return; }`).
 *  #639 cerró el guion MUDO entero (`afirmaciones > 0`); esto cierra la mudez
 *  PARCIAL, y lo hace por el árbol, en `npm test`, porque 149 de los 157
 *  guiones abren navegador y la batería de navegador no corre en CI: una
 *  regla en tiempo de ejecución solo se pondría roja el día que alguien
 *  corriera la batería Y fallase la precondición.
 *
 *  ## El contrato (resumido en el `_comment` del padrón)
 *
 *  **Ámbito:** el cuerpo del `export default` del guion (`cuerpoPrincipal`),
 *  sin entrar en funciones anidadas.
 *
 *  **El `ctx` y sus alias.** Un verbo es `ctx.v(…)`, `ctx["v"](…)` o la
 *  llamada a un alias: `const c = ctx` (y `c.v(…)`), `const { v } = ctx`,
 *  `const e = ctx.v` o `ctx.v.bind(ctx)` (QA de la tanda: con cualquiera de
 *  ellos el detector veía 0 saltos).
 *
 *  **Aserto** (para DETECTAR un salto, en la dirección que da más saltos): un
 *  `expect`/`expectEspera`, la llamada a un ASERTADOR (una función del guion
 *  o importada de un `.mjs` relativo cuyo cuerpo contiene un aserto), o una
 *  llamada que recibe el `ctx` y no se puede resolver. QA de la tanda: un
 *  salto seguido solo de `afirmarPose(ctx, …)` no contaba.
 *
 *  **Salto `return`:** un `return` detrás del cual el cuerpo principal
 *  todavía tiene un aserto. Su GUARDA es el `if`, `case` o `catch` más
 *  cercano que lo contiene; sin guarda es un `return` incondicional.
 *
 *  **Salto `rama-muda`:** un `if` sin `return` propio en el que una rama
 *  aserta sin reportar un fallo, y la otra —un `else` o su ausencia— no
 *  OBSERVA nada (ver «observador»). Es el mismo salto escrito sin `return`.
 *
 *  **Observador:** `throw`, `sinMedir`/`sinMedirBloque`, un
 *  `expect`/`expectEspera` que no es TAUTOLÓGICO (2.º argumento `true`, un
 *  literal verdadero, `x || true`, `x === x`), o la llamada a un asertador.
 *
 *  **Observado** si:
 *   1. cada rama o bloque que retorna (la del `if`, el `case`, el `catch`)
 *      contiene un observador. Un `return` incondicional nunca lo está;
 *   2. (solo `if`) la condición —sin `await`, paréntesis, `!` ni
 *      `Boolean(…)`— es idéntica token a token al 2.º argumento (normalizado
 *      igual y no tautológico) de un `ctx.expect` que DOMINA el `if`:
 *      sentencia hermana anterior en su bloque o en un bloque ancestro, dentro
 *      de la misma función. Nunca la frase;
 *   3. (solo `if`) todos los ÁTOMOS de la condición están observados, y hay al
 *      menos uno. Átomo: un identificador declarado en el fichero (no un
 *      import, no `ctx`, no un nombre de propiedad, no lo que va dentro de los
 *      argumentos de una llamada) o una llamada (`Boolean`/`Number`/`String`
 *      son transparentes). Un identificador está observado si es átomo del
 *      2.º argumento no tautológico de un `ctx.expect` que domina el `if`, o
 *      si su declaración domina el `if` y su inicializador contiene
 *      —callbacks incluidos— un observador PROPIO (no la llamada a un
 *      asertador: afirmar algo no dice nada del valor devuelto), o si es
 *      `[await] f(…)` con `f` AFIRMANTE. Una llamada está observada si llama a un afirmante.
 *
 *  **Afirmante:** una función del guion, o importada con nombre de un `.mjs`
 *  relativo, que acaba en `return`/`throw` y en la que todo `return` devuelve
 *  un valor construido (objeto, array, `true`, número distinto de 0, cadena
 *  no vacía) o un vacío (`null`/`false`/`undefined`/`0`/`""`/`return;`)
 *  dentro de una rama de un `if` que cumple 1-3. Lo que no se resuelve
 *  (`import *`, reexport, dinámico, un `.js`) NO es afirmante: el error va
 *  siempre hacia el ROJO.
 *
 *  Lo que esto no ve está en `_lo_que_esto_NO_sujeta` del padrón, cada punto
 *  con un `it` que MIDE su cifra de hoy.
 *
 *  No es un `.test.ts` a propósito (mismo motivo que `helpers-del-banco.ts`). */
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { arbolDelBanco, cuerpoPrincipal, recorre, recorreSinAnidadas } from "./helpers-del-banco.js";

export type FormaDeSalto = "return" | "rama-muda";

export interface Salto {
  /** La ruta tal y como se le pasó a `saltosDelGuion`. */
  fichero: string;
  /** 1-based, de la guarda (o del `return` incondicional). Solo para leer: el
   *  padrón identifica por `condicion`. */
  linea: number;
  forma: FormaDeSalto;
  /** La clave del padrón: `condicionNormalizada` del `if`; `case:<switch>=<caso>`
   *  para un `case`; `catch` y `incondicional` para las otras dos guardas. */
  condicion: string;
  observado: boolean;
  /** Por qué se da por observado, o qué le falta. Nombra el helper cuando
   *  la culpa es de un «no afirmante», para que se sepa qué arreglar. */
  porque: string;
  /** El nombre de la función analizada: `default` para el cuerpo principal. */
  funcion: string;
}

/** Lee un fichero por su ruta ABSOLUTA. Inyectable para los negativos en
 *  memoria y los unitarios sintéticos. */
export type Lector = (ruta: string) => string;

export interface OpcionesDelDetector {
  /** Analiza TAMBIÉN toda función del guion que usa el `ctx` (por parámetro
   *  o capturado de un ámbito exterior, con nombre o anónima). No es el
   *  candado —su ámbito es el cuerpo principal—: existe para MEDIR el punto
   *  (1) de `_lo_que_esto_NO_sujeta` sobre el banco real. */
  helpers?: boolean;
}

const AFIRMA: ReadonlySet<string> = new Set(["expect", "expectEspera"]);
const DECLARA: ReadonlySet<string> = new Set(["sinMedir", "sinMedirBloque"]);
const TRANSPARENTES: ReadonlySet<string> = new Set(["Boolean", "Number", "String"]);

/** La condición sin espacios: la clave con la que el padrón nombra un salto.
 *  No se usa la línea, que deriva con cualquier edición del guion. */
export function condicionNormalizada(expr: ts.Expression): string {
  return expr.getText().replace(/\s+/g, "");
}

const sinEnvoltorio = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

/** Sin `await`, paréntesis, `!` ni `Boolean(x)`: para comparar una condición
 *  con el argumento de un `expect` (regla 2). */
function normalizaCondicion(e: ts.Expression): string {
  let x = sinEnvoltorio(e);
  for (;;) {
    if (ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken) x = sinEnvoltorio(x.operand);
    else if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Boolean" && x.arguments.length === 1)
      x = sinEnvoltorio(x.arguments[0]);
    else break;
  }
  return condicionNormalizada(x);
}

/** Un literal que JavaScript da por falso: el vacío de un afirmante. */
function esLiteralFalso(e: ts.Expression): boolean {
  return (
    e.kind === ts.SyntaxKind.NullKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(e) && e.text === "undefined") ||
    (ts.isNumericLiteral(e) && Number(e.text) === 0) ||
    (ts.isStringLiteralLike(e) && e.text === "")
  );
}

/** Un literal que JavaScript da por verdadero: `true`, un número ≠ 0, una
 *  cadena no vacía, un objeto o un array. `return 0` NO es construido (QA). */
function esLiteralVerdadero(e: ts.Expression): boolean {
  return (
    e.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isNumericLiteral(e) && Number(e.text) !== 0) ||
    (ts.isStringLiteralLike(e) && e.text !== "") ||
    ts.isObjectLiteralExpression(e) ||
    ts.isArrayLiteralExpression(e)
  );
}

/** El 2.º argumento de un `expect` que no puede ponerse rojo, por su FORMA:
 *  un literal verdadero, `!<contradicción>` (`!false`, `!!true`), `a ||
 *  <tautología>`, `a && b` con los dos tautológicos, o `x === x`. Por su VALOR
 *  (una constante con nombre, `typeof`…) no se evalúa: punto (11) del padrón. */
function esTautologia(arg: ts.Expression): boolean {
  const e = sinEnvoltorio(arg);
  if (esLiteralVerdadero(e)) return true;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return esContradiccion(e.operand);
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Boolean" && e.arguments.length === 1)
    return esTautologia(e.arguments[0]);
  if (!ts.isBinaryExpression(e)) return false;
  const op = e.operatorToken.kind;
  if (op === ts.SyntaxKind.BarBarToken) return esTautologia(e.left) || esTautologia(e.right);
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) return esTautologia(e.left) && esTautologia(e.right);
  const iguales = [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken];
  return iguales.includes(op) && condicionNormalizada(e.left) === condicionNormalizada(e.right);
}

/** Lo que siempre es falso por su forma: un literal falso o `!<tautología>`.
 *  `!!x` no lo es (el guion 14 usa `!!c1`): solo `!!true` y sus parientes. */
function esContradiccion(arg: ts.Expression): boolean {
  const e = sinEnvoltorio(arg);
  if (esLiteralFalso(e)) return true;
  return ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken && esTautologia(e.operand);
}

/** Lo que devuelve una sonda escrita en línea: el cuerpo de una flecha de
 *  expresión, o el de un bloque con un único `return e`. Otra cosa → null. */
function devuelveLaSonda(arg: ts.Expression): ts.Expression | null {
  const f = sinEnvoltorio(arg);
  if (!ts.isArrowFunction(f) && !ts.isFunctionExpression(f)) return null;
  if (!ts.isBlock(f.body)) return f.body;
  const [st] = f.body.statements;
  return f.body.statements.length === 1 && ts.isReturnStatement(st) && st.expression ? st.expression : null;
}

/** `expectEspera(frase, debeOcurrir, sonda, …)` que no puede ponerse rojo: la
 *  sonda (el TERCER argumento; el 2.º es la polaridad, qa/run.mjs) devuelve
 *  una tautología y se espera que ocurra, o una contradicción y se espera que
 *  no. Una polaridad que no es un literal no se evalúa: punto (11). */
function esEsperaTautologica(n: ts.CallExpression): boolean {
  const [, debe, sonda] = n.arguments;
  const e = debe && sonda ? devuelveLaSonda(sonda) : null;
  if (!e) return false;
  if (debe.kind === ts.SyntaxKind.TrueKeyword) return esTautologia(e);
  return debe.kind === ts.SyntaxKind.FalseKeyword && esContradiccion(e);
}

const lineaDe = (n: ts.Node): number => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

/** Los nombres que liga un patrón (`x`, `{a, b: c}`, `[d, ...e]`). */
function nombresLigados(n: ts.BindingName): string[] {
  if (ts.isIdentifier(n)) return [n.text];
  const out: string[] = [];
  for (const el of n.elements) if (!ts.isOmittedExpression(el)) out.push(...nombresLigados(el.name));
  return out;
}

interface Modulo {
  ruta: string;
  sf: ts.SourceFile;
  leer: Lector;
  /** Funciones con nombre del fichero, a cualquier profundidad. */
  fns: Map<string, ts.FunctionLikeDeclaration>;
  /** `import { a as b } from "./x.mjs"` → b ↦ {ruta absoluta, "a"}. */
  imports: Map<string, { ruta: string; nombre: string }>;
  /** Todo lo que el fichero declara (variables, parámetros, patrones). */
  locales: Set<string>;
  /** `ctx` y sus alias por declaración (`const c = ctx`). */
  ctxs: Set<string>;
  /** Verbos sueltos: `const { expect } = ctx`, `const e = ctx.expect`. */
  sueltos: Map<string, string>;
}

interface Veredicto {
  ok: boolean;
  porque: string;
}

/** Módulos parseados, por lector: un negativo en memoria no puede servir el
 *  árbol del fichero real ni al revés. */
const modulosPorLector = new WeakMap<Lector, Map<string, Modulo | Error>>();
/** Afirmantes y asertadores ya juzgados. Por nodo: cada parseo da nodos nuevos. */
const afirmantes = new WeakMap<ts.Node, Veredicto>();
const asertadores = new WeakMap<ts.Node, boolean>();
const afirmanSiempre = new WeakMap<ts.Node, boolean>();

/** `ctx.v` / `ctx["v"]` / `c.v` sobre un alias → `v`. */
function verboDeAcceso(m: Modulo, e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && m.ctxs.has(e.expression.text)) return e.name.text;
  if (ts.isElementAccessExpression(e) && ts.isIdentifier(e.expression) && m.ctxs.has(e.expression.text) && ts.isStringLiteralLike(e.argumentExpression))
    return e.argumentExpression.text;
  return null;
}

/** El receptor de `x.v(…)` / `x["v"](…)` con `v` un verbo que afirma o
 *  declara: es un `ctx`, se llame como se llame (`let c; c = ctx`, `(c) => …`). */
function receptorDeVerbo(x: ts.Node): string | null {
  if (!ts.isCallExpression(x)) return null;
  const c = x.expression;
  const nombre = ts.isPropertyAccessExpression(c)
    ? c.name.text
    : ts.isElementAccessExpression(c) && ts.isStringLiteralLike(c.argumentExpression)
      ? c.argumentExpression.text
      : null;
  if (nombre === null || !(AFIRMA.has(nombre) || DECLARA.has(nombre))) return null;
  return ts.isIdentifier(c.expression) ? c.expression.text : null;
}

/** La función a la que se llama, si está a la vista: un IIFE
 *  (`(async (c) => …)(ctx)`) o una función con nombre del propio fichero. */
function llamadaLocal(m: Modulo, x: ts.CallExpression): ts.SignatureDeclaration | null {
  const c = sinEnvoltorio(x.expression);
  if (ts.isArrowFunction(c) || ts.isFunctionExpression(c)) return c;
  return ts.isIdentifier(c) ? (m.fns.get(c.text) ?? null) : null;
}

/** Los alias de `ctx` y los verbos sueltos, por punto fijo: el receptor de un
 *  verbo, las declaraciones del fichero y el PARÁMETRO que recibe un `ctx` en
 *  una llamada a una función a la vista. Sin ámbitos: un `c` ajeno
 *  SOBRECUENTA. */
function aliasDeCtx(m: Modulo): void {
  const decls: ts.VariableDeclaration[] = [];
  const llamadas: ts.CallExpression[] = [];
  recorre(m.sf, (x) => {
    if (ts.isVariableDeclaration(x) && x.initializer) decls.push(x);
    if (ts.isCallExpression(x)) llamadas.push(x);
    const r = receptorDeVerbo(x);
    if (r) m.ctxs.add(r);
  });
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const x of llamadas) {
      const fn = llamadaLocal(m, x);
      if (!fn) continue;
      x.arguments.forEach((a, i) => {
        const p = fn.parameters[i]?.name;
        if (ts.isIdentifier(a) && m.ctxs.has(a.text) && p && ts.isIdentifier(p) && !m.ctxs.has(p.text)) {
          m.ctxs.add(p.text);
          cambio = true;
        }
      });
    }
    for (const d of decls) {
      let ini = sinEnvoltorio(d.initializer!);
      // `ctx.expect.bind(ctx)` es `ctx.expect`.
      if (ts.isCallExpression(ini) && ts.isPropertyAccessExpression(ini.expression) && ini.expression.name.text === "bind")
        ini = ini.expression.expression;
      if (ts.isIdentifier(d.name)) {
        if (ts.isIdentifier(ini) && m.ctxs.has(ini.text) && !m.ctxs.has(d.name.text)) {
          m.ctxs.add(d.name.text);
          cambio = true;
        }
        const v = verboDeAcceso(m, ini);
        if (v && !m.sueltos.has(d.name.text)) {
          m.sueltos.set(d.name.text, v);
          cambio = true;
        }
      } else if (ts.isObjectBindingPattern(d.name) && ts.isIdentifier(ini) && m.ctxs.has(ini.text)) {
        for (const el of d.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          if (!m.sueltos.has(el.name.text)) {
            m.sueltos.set(el.name.text, prop);
            cambio = true;
          }
        }
      }
    }
  }
}

function modulo(ruta: string, leer: Lector): Modulo | Error {
  let cache = modulosPorLector.get(leer);
  if (!cache) {
    cache = new Map();
    modulosPorLector.set(leer, cache);
  }
  const hecho = cache.get(ruta);
  if (hecho) return hecho;
  let fuente: string;
  try {
    fuente = leer(ruta);
  } catch (err) {
    // No se calla: el `Error` viaja al veredicto del helper como «no
    // afirmante: no se pudo leer», o sea ROJO en el guion que lo importa.
    const e = err instanceof Error ? err : new Error(String(err));
    cache.set(ruta, e);
    return e;
  }
  const sf = arbolDelBanco(fuente);
  const m: Modulo = { ruta, sf, leer, fns: new Map(), imports: new Map(), locales: new Set(), ctxs: new Set(["ctx"]), sueltos: new Map() };
  recorre(sf, (x) => {
    if (ts.isFunctionDeclaration(x) && x.name) m.fns.set(x.name.text, x);
    if (ts.isVariableDeclaration(x) || ts.isParameter(x)) {
      for (const nombre of nombresLigados(x.name)) m.locales.add(nombre);
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) {
        const ini = x.initializer;
        if (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)) m.fns.set(x.name.text, ini);
      }
    }
  });
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const espec = st.moduleSpecifier.text;
    const ligaduras = st.importClause?.namedBindings;
    if (!espec.startsWith(".") || !espec.endsWith(".mjs") || !ligaduras || !ts.isNamedImports(ligaduras)) continue;
    const destino = resolve(dirname(ruta), espec);
    for (const el of ligaduras.elements) m.imports.set(el.name.text, { ruta: destino, nombre: (el.propertyName ?? el.name).text });
  }
  aliasDeCtx(m);
  cache.set(ruta, m);
  return m;
}

/** `ctx.<verbo>(…)` o la llamada a un alias → `<verbo>`; cualquier otra cosa → null. */
function verbo(m: Modulo, n: ts.Node): string | null {
  if (!ts.isCallExpression(n)) return null;
  const c = n.expression;
  if (ts.isIdentifier(c)) return m.sueltos.get(c.text) ?? null;
  return verboDeAcceso(m, c);
}

type FuncionResuelta = { m: Modulo; fn: ts.FunctionLikeDeclaration } | { error: string };

function funcionDe(m: Modulo, nombre: string): FuncionResuelta {
  const local = m.fns.get(nombre);
  if (local) return { m, fn: local };
  const imp = m.imports.get(nombre);
  if (!imp) return { error: `\`${nombre}\` no es una función del guion ni un import con nombre de un .mjs relativo` };
  const otro = modulo(imp.ruta, m.leer);
  if (otro instanceof Error) return { error: `\`${nombre}\`: no se pudo leer ${imp.ruta} (${otro.message})` };
  const fn = otro.fns.get(imp.nombre);
  if (!fn) return { error: `\`${nombre}\`: ${imp.ruta} no declara la función \`${imp.nombre}\` (¿reexport?)` };
  return { m: otro, fn };
}

/** ¿Llama `n` a una función con nombre que se resuelve? */
function llamadaResuelta(m: Modulo, n: ts.Node): FuncionResuelta | null {
  if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || verbo(m, n) !== null) return null;
  return funcionDe(m, n.expression.text);
}

/** Una función cuyo cuerpo (sin sus anidadas) contiene un aserto propio o la
 *  llamada a otro asertador. Un ciclo cuenta como no asertador. */
function esAsertador(m: Modulo, fn: ts.FunctionLikeDeclaration): boolean {
  const hecho = asertadores.get(fn);
  if (hecho !== undefined) return hecho;
  asertadores.set(fn, false);
  const v = Boolean(fn.body) && contiene(fn.body!, (x) => AFIRMA.has(verbo(m, x) ?? "") || llamaAsertador(m, x));
  asertadores.set(fn, v);
  return v;
}

function llamaAsertador(m: Modulo, n: ts.Node): boolean {
  const f = llamadaResuelta(m, n);
  return f !== null && !("error" in f) && esAsertador(f.m, f.fn);
}

/** Para DETECTAR saltos (la dirección que da más): un aserto propio, un
 *  asertador, o una llamada que recibe el `ctx` y no se sabe qué hace. */
function esAsertoLaxo(m: Modulo, n: ts.Node): boolean {
  if (AFIRMA.has(verbo(m, n) ?? "")) return true;
  const f = llamadaResuelta(m, n);
  if (f && !("error" in f)) return esAsertador(f.m, f.fn);
  if (!ts.isCallExpression(n) || verbo(m, n) !== null) return false;
  return n.arguments.some((a) => ts.isIdentifier(a) && m.ctxs.has(a.text));
}

/** Lo que observa POR SÍ MISMO, sin llamar a nadie: `throw`, un verbo que
 *  declara, o un `expect`/`expectEspera` que no es tautológico (QA de AG:
 *  `expect("no se pudo", true)`; #716: `!!true` y la sonda que devuelve lo
 *  que se espera por su forma). */
function observaPropio(m: Modulo, n: ts.Node): boolean {
  if (ts.isThrowStatement(n)) return true;
  const v = verbo(m, n);
  if (v && DECLARA.has(v)) return true;
  if (v === "expectEspera") return !esEsperaTautologica(n as ts.CallExpression);
  if (v === "expect") {
    const arg = (n as ts.CallExpression).arguments[1];
    return arg !== undefined && !esTautologia(arg);
  }
  return false;
}

/** Para EXCUSAR un salto (la dirección que da menos): lo que de verdad
 *  observa. La llamada a un helper cuenta solo si ese helper AFIRMA SIEMPRE;
 *  que CONTENGA un aserto (`esAsertador`) es la vara del lado que detecta, y
 *  para excusar deja pasar al que afirma `true` o afirma bajo un `if` (#716). */
function esObservador(m: Modulo, n: ts.Node): boolean {
  return observaPropio(m, n) || llamaAfirmaSiempre(m, n);
}

function llamaAfirmaSiempre(m: Modulo, n: ts.Node): boolean {
  const f = llamadaResuelta(m, n);
  return f !== null && !("error" in f) && afirmaSiempre(f.m, f.fn);
}

/** Un helper que, llamado, observa en TODO camino que no lance: en el tronco
 *  de su cuerpo hay un observador antes del primer `return`. Un ciclo cuenta
 *  como no. */
function afirmaSiempre(m: Modulo, fn: ts.FunctionLikeDeclaration): boolean {
  const hecho = afirmanSiempre.get(fn);
  if (hecho !== undefined) return hecho;
  afirmanSiempre.set(fn, false);
  const cuerpo = fn.body;
  const v = cuerpo === undefined ? false : ts.isBlock(cuerpo) ? secuenciaAfirma(m, cuerpo.statements) : enElTronco(m, cuerpo);
  afirmanSiempre.set(fn, v);
  return v;
}

/** Una lista de sentencias afirma si una afirma antes de la primera que
 *  puede retornar. */
function secuenciaAfirma(m: Modulo, sts: readonly ts.Statement[]): boolean {
  for (const st of sts) {
    if (sentenciaAfirma(m, st)) return true;
    if (contiene(st, ts.isReturnStatement)) return false;
  }
  return false;
}

/** Un bloque recursa; un `if` afirma por su condición o si sus DOS ramas
 *  afirman (el if/else honesto); un `try`, si su `finally` afirma o si lo
 *  hacen el bloque y el `catch` que se traga lo que lance. Bucles, `switch` y
 *  etiquetas no afirman: pueden no entrarse. */
function sentenciaAfirma(m: Modulo, st: ts.Statement): boolean {
  if (ts.isBlock(st)) return secuenciaAfirma(m, st.statements);
  if (ts.isIfStatement(st))
    return enElTronco(m, st.expression) || (st.elseStatement !== undefined && sentenciaAfirma(m, st.thenStatement) && sentenciaAfirma(m, st.elseStatement));
  if (ts.isTryStatement(st)) {
    if (st.finallyBlock && secuenciaAfirma(m, st.finallyBlock.statements)) return true;
    return secuenciaAfirma(m, st.tryBlock.statements) && (!st.catchClause || secuenciaAfirma(m, st.catchClause.block.statements));
  }
  const simple = ts.isExpressionStatement(st) || ts.isVariableStatement(st) || ts.isReturnStatement(st) || ts.isThrowStatement(st);
  return simple && enElTronco(m, st);
}

/** ¿Hay un observador en `raiz` que se evalúa siempre? Sin entrar en
 *  funciones anidadas, ni en las ramas de un ternario, ni en el lado derecho
 *  de `&&`/`||`/`??`, ni detrás de un `?.`. */
function enElTronco(m: Modulo, raiz: ts.Node): boolean {
  const CORTOCIRCUITO = new Set([
    ts.SyntaxKind.AmpersandAmpersandToken,
    ts.SyntaxKind.BarBarToken,
    ts.SyntaxKind.QuestionQuestionToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
  ]);
  let hay = false;
  const baja = (n: ts.Node): void => {
    if (hay || ts.isFunctionLike(n)) return;
    if (esObservador(m, n)) hay = true;
    else if (ts.isConditionalExpression(n)) baja(n.condition);
    else if (ts.isBinaryExpression(n) && CORTOCIRCUITO.has(n.operatorToken.kind)) baja(n.left);
    else if (ts.isOptionalChain(n)) baja(n.expression);
    else ts.forEachChild(n, baja);
  };
  baja(raiz);
  return hay;
}

const esExpectFalse = (m: Modulo, n: ts.Node): boolean =>
  verbo(m, n) === "expect" && (n as ts.CallExpression).arguments[1]?.kind === ts.SyntaxKind.FalseKeyword;
const reportaFallo = (m: Modulo, n: ts.Node): boolean =>
  contiene(n, (x) => ts.isThrowStatement(x) || DECLARA.has(verbo(m, x) ?? "") || esExpectFalse(m, x));

/** ¿Hay un nodo que cumple `pred` bajo `raiz`? Por defecto sin entrar en
 *  funciones anidadas; `conCallbacks` sí entra (regla 3: el `.catch`). */
function contiene(raiz: ts.Node, pred: (n: ts.Node) => boolean, conCallbacks = false): boolean {
  let hay = false;
  const visita = (n: ts.Node): boolean | void => {
    if (hay) return false;
    if (pred(n)) {
      hay = true;
      return false;
    }
  };
  if (conCallbacks) recorre(raiz, visita);
  else recorreSinAnidadas(raiz, visita);
  return hay;
}

type Guarda = ts.IfStatement | ts.CaseOrDefaultClause | ts.CatchClause;

/** La guarda de un `return`: el `if` (por una de sus ramas), `case` o
 *  `catch` más cercano que lo contiene dentro de `fn`; `null` si ninguno. */
function guardaDe(n: ts.Node, fn: ts.Node): { guarda: Guarda; rama: ts.Node } | null {
  let hijo: ts.Node = n;
  let p: ts.Node | undefined = n.parent;
  while (p && p !== fn) {
    if (ts.isIfStatement(p) && hijo !== p.expression) return { guarda: p, rama: hijo };
    if (ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isCatchClause(p)) return { guarda: p, rama: p };
    hijo = p;
    p = p.parent;
  }
  return null;
}

function afirmante(m: Modulo, fn: ts.FunctionLikeDeclaration, nombre: string): Veredicto {
  const hecho = afirmantes.get(fn);
  if (hecho) return hecho;
  const dondeEsta = `${nombre} (${m.ruta.split("/").slice(-2).join("/")})`;
  // Provisional ANTES de mirar dentro: un ciclo cuenta como no afirmante.
  afirmantes.set(fn, { ok: false, porque: `\`${dondeEsta}\` es recursiva: un ciclo no es afirmante` });
  const juzga = (): Veredicto => {
    const body = fn.body;
    if (!body || !ts.isBlock(body)) return { ok: false, porque: `\`${dondeEsta}\` no tiene cuerpo de bloque` };
    const ultima = body.statements.at(-1);
    if (!ultima || !(ts.isReturnStatement(ultima) || ts.isThrowStatement(ultima)))
      return { ok: false, porque: `\`${dondeEsta}\` no acaba en return/throw` };
    let falla: string | null = null;
    recorreSinAnidadas(body, (x) => {
      if (falla) return false;
      if (!ts.isReturnStatement(x)) return;
      const e = x.expression ? sinEnvoltorio(x.expression) : null;
      if (e !== null && esLiteralVerdadero(e)) return;
      if (e !== null && !esLiteralFalso(e)) {
        falla = `\`${dondeEsta}\` no es afirmante: \`return ${e.getText().slice(0, 40)}\` en la línea ${lineaDe(x)}`;
        return false;
      }
      const g = guardaDe(x, fn);
      const observado =
        g !== null &&
        (contiene(g.rama, (y) => esObservador(m, y)) || (ts.isIfStatement(g.guarda) && condicionObservada(m, g.guarda, fn).ok));
      if (!observado) falla = `\`${dondeEsta}\` no es afirmante: devuelve un vacío sin observar en la línea ${lineaDe(x)}`;
      return false;
    });
    return falla ? { ok: false, porque: falla } : { ok: true, porque: `\`${dondeEsta}\` es afirmante` };
  };
  const v = juzga();
  afirmantes.set(fn, v);
  return v;
}

/** Las sentencias que DOMINAN a `nodo` dentro de `fn`: las hermanas
 *  anteriores en su bloque y en cada bloque ancestro hasta el cuerpo. */
function* dominantes(nodo: ts.Node, fn: ts.FunctionLikeDeclaration): Generator<ts.Statement> {
  let hijo: ts.Node = nodo;
  let p: ts.Node | undefined = nodo.parent;
  while (p && hijo !== fn.body) {
    if (ts.isBlock(p)) {
      for (const st of p.statements) {
        if (st === hijo) break;
        yield st;
      }
    }
    hijo = p;
    p = p.parent;
  }
}

/** `ctx.expect(frase, cond, …)` como sentencia, con `cond` no tautológica → `cond`. */
function condicionDeExpect(m: Modulo, st: ts.Statement): ts.Expression | null {
  if (!ts.isExpressionStatement(st)) return null;
  const e = sinEnvoltorio(st.expression);
  if (verbo(m, e) !== "expect") return null;
  const arg = (e as ts.CallExpression).arguments[1];
  return arg && !esTautologia(arg) ? arg : null;
}

type Atomo = { id: string; nodo: ts.Node } | { llamada: ts.CallExpression; veredicto: Veredicto };

function atomos(m: Modulo, cond: ts.Expression): Atomo[] {
  const out: Atomo[] = [];
  const baja = (x: ts.Node): void => {
    if (ts.isFunctionLike(x)) return;
    if (ts.isCallExpression(x)) {
      const callee = ts.isIdentifier(x.expression) ? x.expression.text : null;
      if (callee && TRANSPARENTES.has(callee)) {
        x.arguments.forEach(baja);
        return;
      }
      if (!callee) {
        out.push({ llamada: x, veredicto: { ok: false, porque: `la llamada \`${x.expression.getText().slice(0, 40)}\` no es a una función con nombre` } });
        return;
      }
      const f = funcionDe(m, callee);
      out.push({ llamada: x, veredicto: "error" in f ? { ok: false, porque: f.error } : afirmante(f.m, f.fn, callee) });
      return;
    }
    if (ts.isIdentifier(x)) {
      const padre = x.parent;
      if (ts.isPropertyAccessExpression(padre) && padre.name === x) return;
      if (!m.ctxs.has(x.text) && m.locales.has(x.text)) out.push({ id: x.text, nodo: x });
      return;
    }
    ts.forEachChild(x, baja);
  };
  baja(cond);
  return out;
}

/** Lo que lo que domina a `si` en `fn` dice de cada identificador (regla 3):
 *  observado, con su motivo, o NO observado porque su inicializador llama a un
 *  no afirmante — y entonces el motivo nombra al helper, que es lo que hay
 *  que arreglar. */
function observadosAntes(m: Modulo, si: ts.Node, fn: ts.FunctionLikeDeclaration): Map<string, Veredicto> {
  const vistos = new Map<string, Veredicto>();
  const anota = (id: string, v: Veredicto): void => {
    if (!vistos.get(id)?.ok) vistos.set(id, v);
  };
  for (const st of dominantes(si, fn)) {
    const cond = condicionDeExpect(m, st);
    if (cond) {
      for (const a of atomos(m, cond)) if ("id" in a) anota(a.id, { ok: true, porque: `\`${a.id}\` afirmado en la línea ${lineaDe(st)}` });
      continue;
    }
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!d.initializer) continue;
      // Aquí solo el aserto PROPIO (el `.catch(e => ctx.expect(false…))`):
      // llamar a un asertador no dice nada del valor que devuelve, y para eso
      // está la regla del afirmante, justo debajo.
      let v: Veredicto | null = contiene(d.initializer, (y) => observaPropio(m, y), true)
        ? { ok: true, porque: `su inicializador afirma o declara (línea ${lineaDe(d)})` }
        : null;
      const ini = sinEnvoltorio(d.initializer);
      if (!v && ts.isCallExpression(ini) && ts.isIdentifier(ini.expression)) {
        const f = funcionDe(m, ini.expression.text);
        v = "error" in f ? { ok: false, porque: f.error } : afirmante(f.m, f.fn, ini.expression.text);
      }
      if (v) for (const n of nombresLigados(d.name)) anota(n, { ok: v.ok, porque: `\`${n}\`: ${v.porque}` });
    }
  }
  return vistos;
}

/** Reglas 2 y 3 sobre la condición de `si`, dentro de `fn`. */
function condicionObservada(m: Modulo, si: ts.IfStatement, fn: ts.FunctionLikeDeclaration): Veredicto {
  const clave = normalizaCondicion(si.expression);
  for (const st of dominantes(si, fn)) {
    const cond = condicionDeExpect(m, st);
    if (cond && normalizaCondicion(cond) === clave) return { ok: true, porque: `condición afirmada literalmente en la línea ${lineaDe(st)}` };
  }
  const at = atomos(m, si.expression);
  if (at.length === 0) return { ok: false, porque: "la condición no tiene ningún átomo que se pueda observar" };
  const antes = observadosAntes(m, si, fn);
  const por: string[] = [];
  for (const a of at) {
    if ("llamada" in a) {
      if (!a.veredicto.ok) return { ok: false, porque: a.veredicto.porque };
      por.push(a.veredicto.porque);
    } else {
      const v = antes.get(a.id);
      if (!v?.ok) return { ok: false, porque: v?.porque ?? `\`${a.id}\` no se afirma antes ni lo inicializa algo que afirme` };
      por.push(v.porque);
    }
  }
  return { ok: true, porque: [...new Set(por)].join("; ") };
}

/** La clave de padrón de un `case`/`default`/`catch`. */
function claveDeGuarda(g: ts.CaseOrDefaultClause | ts.CatchClause): string {
  if (ts.isCatchClause(g)) return "catch";
  const sw = condicionNormalizada(g.parent.parent.expression);
  return `case:${sw}=${ts.isCaseClause(g) ? condicionNormalizada(g.expression) : "default"}`;
}

/** Los saltos de una función (el cuerpo principal, o un helper). */
function saltosDe(m: Modulo, fn: ts.FunctionLikeDeclaration, nombre: string): Salto[] {
  const out: Salto[] = [];
  const cuerpo = fn.body;
  if (!cuerpo || !ts.isBlock(cuerpo)) return out;
  const asertaDetras = (n: ts.Node): boolean => contiene(cuerpo, (x) => x.pos >= n.end && esAsertoLaxo(m, x));
  const observa = (r: ts.Node): boolean => contiene(r, (y) => esObservador(m, y));
  // Los `return` de cada guarda, para que un `return` cuente en UNA sola.
  const porGuarda = new Map<Guarda | null, { rama: ts.Node; ret: ts.ReturnStatement }[]>();
  recorreSinAnidadas(cuerpo, (x) => {
    if (!ts.isReturnStatement(x)) return;
    const g = guardaDe(x, fn);
    const k = g?.guarda ?? null;
    porGuarda.set(k, [...(porGuarda.get(k) ?? []), { rama: g?.rama ?? x, ret: x }]);
  });
  recorreSinAnidadas(cuerpo, (x) => {
    if (!ts.isIfStatement(x)) return;
    const propios = porGuarda.get(x) ?? [];
    const base = { fichero: m.ruta, linea: lineaDe(x), condicion: condicionNormalizada(x.expression), funcion: nombre };
    if (propios.length > 0) {
      if (!propios.some((p) => asertaDetras(p.ret))) return;
      const ramas = [...new Set(propios.map((p) => p.rama))];
      if (ramas.every(observa)) {
        out.push({ ...base, forma: "return", observado: true, porque: "la rama que retorna observa (afirma, declara o lanza)" });
        return;
      }
      const v = condicionObservada(m, x, fn);
      out.push({ ...base, forma: "return", observado: v.ok, porque: v.porque });
      return;
    }
    const muda = (r: ts.Statement | undefined): boolean => !r || !observa(r);
    const afirma = (r: ts.Statement | undefined): boolean => Boolean(r) && contiene(r!, (y) => esAsertoLaxo(m, y)) && !reportaFallo(m, r!);
    if (!((afirma(x.thenStatement) && muda(x.elseStatement)) || (afirma(x.elseStatement) && muda(x.thenStatement)))) return;
    const v = condicionObservada(m, x, fn);
    out.push({ ...base, forma: "rama-muda", observado: v.ok, porque: v.porque });
  });
  for (const [g, rets] of porGuarda) {
    if (g !== null && ts.isIfStatement(g)) continue;
    const detras = rets.filter((r) => asertaDetras(r.ret));
    if (detras.length === 0) continue;
    if (g === null) {
      for (const r of detras)
        out.push({ fichero: m.ruta, linea: lineaDe(r.ret), forma: "return", condicion: "incondicional", funcion: nombre, observado: false, porque: "un `return` sin guarda deja muertos los asertos de detrás" });
      continue;
    }
    const ok = observa(g);
    out.push({
      fichero: m.ruta,
      linea: lineaDe(g),
      forma: "return",
      condicion: claveDeGuarda(g),
      funcion: nombre,
      observado: ok,
      porque: ok ? `el ${ts.isCatchClause(g) ? "catch" : "case"} que retorna observa` : `el ${ts.isCatchClause(g) ? "catch" : "case"} retorna sin afirmar, declarar ni lanzar`,
    });
  }
  return out.sort((a, b) => a.linea - b.linea);
}

/** El nombre legible de una función: el suyo, el de la variable que la
 *  recibe, o `anónima:<línea>`. */
function nombreDe(fn: ts.FunctionLikeDeclaration): string {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return `anónima:${lineaDe(fn)}`;
}

/** Todos los saltos del guion en `ruta` (absoluta), observados o no. Lanza si
 *  el guion no se puede leer o no tiene `export default`: un guion que el
 *  detector no ve no puede salir como «0 saltos». */
export function saltosDelGuion(ruta: string, leer: Lector, opciones: OpcionesDelDetector = {}): Salto[] {
  const m = modulo(ruta, leer);
  if (m instanceof Error) throw m;
  const principal = cuerpoPrincipal(m.sf, ruta);
  const out = saltosDe(m, principal, "default");
  if (opciones.helpers) {
    recorre(m.sf, (x) => {
      if (x === principal || !ts.isFunctionLike(x)) return;
      const fn = x as ts.FunctionLikeDeclaration;
      if (!fn.body || !ts.isBlock(fn.body)) return;
      if (contiene(fn, (y) => ts.isIdentifier(y) && m.ctxs.has(y.text))) out.push(...saltosDe(m, fn, nombreDe(fn)));
    });
  }
  return out;
}
