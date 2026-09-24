/** A qué se refiere un identificador de un guion de `qa/guiones/` (o de un
 *  `qa/lib/*.mjs` que importa): el `ctx` y sus alias, los verbos sueltos, las
 *  funciones del fichero y los imports con nombre de un `.mjs` relativo. Es la
 *  RESOLUCIÓN del detector de saltos (`saltos-del-guion.ts`), separada del
 *  juicio y las reglas en #720: el juicio (`afirmante`) y las reglas
 *  (`condicionObservada`, `observadosAntes`) se llaman entre sí y se quedan
 *  juntos; esto no llama a ninguno de los dos.
 *
 *  El ctx va por SÍMBOLO (#720): el checker de TypeScript, sobre el mismo
 *  árbol, dice a qué declaración apunta cada identificador, así que un `c` que
 *  sombrea es otro. Las funciones (`fns`) y los imports siguen por NOMBRE: la
 *  búsqueda de declaración es lo único que se comparte con el checker; el
 *  flujo de valor (`const c = ctx`, el parámetro que recibe un `ctx`) es de
 *  este detector. Lo que no ve está en el punto (12) de
 *  `data/contract/saltos-sin-observar.json`.
 *
 *  Los otros tres resolutores del banco siguen a MANO y con su semántica: el
 *  de sondas (`la-consulta-de-movimiento-tiene-dueno.test.ts`, alias por punto
 *  fijo sin ámbitos), el de esperas (`lecturas-del-predicado.ts`) y el de
 *  relojes (`relojes-de-pared.ts`, ámbito léxico a mano). No se migran al
 *  checker por uniformidad: solo el día que se mida un falso verde en uno,
 *  como el de aquí (#720).
 *
 *  No es un `.test.ts` a propósito (mismo motivo que `helpers-del-banco.ts`). */
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { arbolDelBanco, recorre } from "./helpers-del-banco.js";

/** Lee un fichero por su ruta ABSOLUTA. Inyectable para los negativos en
 *  memoria y los unitarios sintéticos. */
export type Lector = (ruta: string) => string;

export const AFIRMA: ReadonlySet<string> = new Set(["expect", "expectEspera"]);
export const DECLARA: ReadonlySet<string> = new Set(["sinMedir", "sinMedirBloque"]);
export const sinEnvoltorio = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isAwaitExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

/** Los nombres que liga un patrón (`x`, `{a, b: c}`, `[d, ...e]`), con la
 *  declaración de cada uno. */
export function simbolosLigados(m: Modulo, n: ts.BindingName): [string, ts.Symbol][] {
  if (ts.isIdentifier(n)) {
    const s = m.checker.getSymbolAtLocation(n);
    return s ? [[n.text, s]] : [];
  }
  const out: [string, ts.Symbol][] = [];
  for (const el of n.elements) if (!ts.isOmittedExpression(el)) out.push(...simbolosLigados(m, el.name));
  return out;
}

export interface Modulo {
  ruta: string;
  sf: ts.SourceFile;
  /** A qué declaración apunta cada identificador (#720): el binder de
   *  TypeScript sobre el MISMO árbol, con sus ámbitos. */
  checker: ts.TypeChecker;
  leer: Lector;
  /** Funciones con nombre del fichero, a cualquier profundidad. */
  fns: Map<string, ts.FunctionLikeDeclaration>;
  /** `import { a as b } from "./x.mjs"` → b ↦ {ruta absoluta, "a"}. */
  imports: Map<string, { ruta: string; nombre: string }>;
  /** `ctx` y sus alias, por SÍMBOLO: el parámetro `ctx`, por declaración
   *  (`const c = ctx`), por ser el parámetro que recibe un `ctx` y, si su
   *  valor no se conoce en el fichero, por ser receptor de un verbo
   *  (`aliasDeCtx`). */
  ctxs: Set<ts.Symbol>;
  /** Verbos sueltos, por símbolo: `const { expect } = ctx`, `const e = ctx.expect`. */
  sueltos: Map<ts.Symbol, string>;
}

/** Módulos parseados, por lector: un negativo en memoria no puede servir el
 *  árbol del fichero real ni al revés. */
const modulosPorLector = new WeakMap<Lector, Map<string, Modulo | Error>>();
/** La declaración a la que apunta un identificador; en `{ ctx }` abreviado,
 *  la variable y no la propiedad. `undefined` si no se declara en el fichero. */
export function simbolo(m: Modulo, id: ts.Identifier): ts.Symbol | undefined {
  const p = id.parent;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === id) return m.checker.getShorthandAssignmentValueSymbol(p);
  return m.checker.getSymbolAtLocation(id);
}

/** La declaración de un identificador si es una VARIABLE del fichero (una
 *  variable, un parámetro o un nombre de sus patrones): lo que puede ser un
 *  ÁTOMO de una condición. Un import, una función declarada o un global, no. */
export function variableDelFichero(m: Modulo, id: ts.Identifier): ts.Symbol | undefined {
  const s = simbolo(m, id);
  const d = s?.valueDeclaration ?? s?.declarations?.[0];
  return d && (ts.isVariableDeclaration(d) || ts.isParameter(d) || ts.isBindingElement(d)) ? s : undefined;
}

/** ¿Es este identificador el `ctx` o uno de sus alias? Por símbolo: un `c`
 *  que sombrea a otro es otro. */
export function esCtx(m: Modulo, e: ts.Node): boolean {
  if (!ts.isIdentifier(e)) return false;
  const s = simbolo(m, e);
  return s !== undefined && m.ctxs.has(s);
}

/** `ctx.v` / `ctx["v"]` / `c.v` sobre un alias → `v`. */
function verboDeAcceso(m: Modulo, e: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(e) && esCtx(m, e.expression)) return e.name.text;
  if (ts.isElementAccessExpression(e) && esCtx(m, e.expression) && ts.isStringLiteralLike(e.argumentExpression))
    return e.argumentExpression.text;
  return null;
}

const esVerboDeCtx = (v: string | null): boolean => v !== null && (AFIRMA.has(v) || DECLARA.has(v));

/** El nombre de la propiedad que desestructura un elemento de patrón
 *  (`{ expect }`, `{ expect: e }`, `{ "expect": e }`); null si es calculado. */
function propiedadDe(el: ts.BindingElement): string | null {
  const p = el.propertyName;
  if (p === undefined) return ts.isIdentifier(el.name) ? el.name.text : null;
  return ts.isIdentifier(p) || ts.isStringLiteralLike(p) ? p.text : null;
}

/** Lo que DELATA un `ctx` por el nombre de un verbo que afirma o declara, se
 *  llame como se llame: el receptor de `c.v` / `c["v"]` (llamado o no: `let c;
 *  c = ctx`, `(c) => …`, `const e = c.expect`), o un patrón que desestructura
 *  un verbo (`async ({ expect }) => …`). Delata solo lo que el fichero no dice
 *  qué es (`valorDesconocido`): un objeto AJENO con `.expect` no pasa por ctx
 *  (#720; antes, por nombre y sin ámbitos, sí, y EXCUSABA saltos). */
type EvidenciaDeCtx = { receptor: ts.Identifier } | { patron: ts.ObjectBindingPattern };
function evidenciaDeCtx(x: ts.Node): EvidenciaDeCtx | null {
  if (ts.isObjectBindingPattern(x)) return x.elements.some((el) => esVerboDeCtx(propiedadDe(el))) ? { patron: x } : null;
  let nombre: string | null = null;
  if (ts.isPropertyAccessExpression(x)) nombre = x.name.text;
  else if (ts.isElementAccessExpression(x) && ts.isStringLiteralLike(x.argumentExpression)) nombre = x.argumentExpression.text;
  if (!esVerboDeCtx(nombre)) return null;
  const rec = (x as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression;
  return ts.isIdentifier(rec) ? { receptor: rec } : null;
}

/** ¿El fichero NO dice qué vale esta declaración? Un parámetro (o un nombre de
 *  su patrón) o una variable sin inicializador (`let c;`, `for (const c of …)`).
 *  Solo ésas las puede delatar un verbo: una con inicializador es lo que su
 *  inicializador diga, y si es un ctx lo dirá el flujo (`= ctx`, `= alias`). */
function valorDesconocido(d: ts.Node | undefined): boolean {
  let x = d;
  while (x && (ts.isBindingElement(x) || ts.isObjectBindingPattern(x) || ts.isArrayBindingPattern(x))) x = x.parent;
  if (x && ts.isParameter(x)) return true;
  return x !== undefined && ts.isVariableDeclaration(x) && x.initializer === undefined && x === d;
}

/** Vuelca un patrón que desestructura un `ctx` en los verbos sueltos. ¿Cambió algo? */
function vuelcaPatron(m: Modulo, pat: ts.ObjectBindingPattern): boolean {
  let cambio = false;
  for (const el of pat.elements) {
    const prop = propiedadDe(el);
    const s = ts.isIdentifier(el.name) ? m.checker.getSymbolAtLocation(el.name) : undefined;
    if (s === undefined || prop === null || m.sueltos.has(s)) continue;
    m.sueltos.set(s, prop);
    cambio = true;
  }
  return cambio;
}

/** La función a la que se llama, si está a la vista: un IIFE
 *  (`(async (c) => …)(ctx)`) o una función con nombre del propio fichero. */
function llamadaLocal(m: Modulo, x: ts.CallExpression): ts.SignatureDeclaration | null {
  const c = sinEnvoltorio(x.expression);
  if (ts.isArrowFunction(c) || ts.isFunctionExpression(c)) return c;
  return ts.isIdentifier(c) ? (m.fns.get(c.text) ?? null) : null;
}

/** Los alias de `ctx` y los verbos sueltos, por punto fijo y por SÍMBOLO: el
 *  parámetro que se llama `ctx`, lo que delata un verbo (`evidenciaDeCtx`) si
 *  su valor no se conoce en el fichero, las declaraciones del fichero y el
 *  PARÁMETRO que recibe un `ctx` en una llamada a una función a la vista. */
function aliasDeCtx(m: Modulo): void {
  const decls: ts.VariableDeclaration[] = [];
  const llamadas: ts.CallExpression[] = [];
  const declaracion = (s: ts.Symbol | undefined): ts.Declaration | undefined => s?.valueDeclaration ?? s?.declarations?.[0];
  recorre(m.sf, (x) => {
    if (ts.isParameter(x) && ts.isIdentifier(x.name) && x.name.text === "ctx") {
      const s = m.checker.getSymbolAtLocation(x.name);
      if (s) m.ctxs.add(s);
    }
    if (ts.isVariableDeclaration(x) && x.initializer) decls.push(x);
    if (ts.isCallExpression(x)) llamadas.push(x);
    const ev = evidenciaDeCtx(x);
    if (ev && "receptor" in ev) {
      const s = simbolo(m, ev.receptor);
      if (s && valorDesconocido(declaracion(s))) m.ctxs.add(s);
    } else if (ev && valorDesconocido(ev.patron)) vuelcaPatron(m, ev.patron);
    else if (ev && ts.isVariableDeclaration(ev.patron.parent) && ev.patron.parent.initializer) {
      // `const { expect } = c` delata a `c`, si el fichero no dice qué es.
      const ini = sinEnvoltorio(ev.patron.parent.initializer);
      const s = ts.isIdentifier(ini) ? simbolo(m, ini) : undefined;
      if (s && valorDesconocido(declaracion(s))) m.ctxs.add(s);
    }
  });
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const x of llamadas) {
      const fn = llamadaLocal(m, x);
      if (!fn) continue;
      x.arguments.forEach((a, i) => {
        const p = fn.parameters[i]?.name;
        // Un patrón en la firma (`({ expect }) => …`) ya lo delata su verbo.
        const s = p && ts.isIdentifier(p) ? m.checker.getSymbolAtLocation(p) : undefined;
        if (esCtx(m, a) && s && !m.ctxs.has(s)) {
          m.ctxs.add(s);
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
        const s = m.checker.getSymbolAtLocation(d.name);
        if (!s) continue;
        if (esCtx(m, ini) && !m.ctxs.has(s)) {
          m.ctxs.add(s);
          cambio = true;
        }
        const v = verboDeAcceso(m, ini);
        if (v && !m.sueltos.has(s)) {
          m.sueltos.set(s, v);
          cambio = true;
        }
      } else if (ts.isObjectBindingPattern(d.name) && esCtx(m, ini) && vuelcaPatron(m, d.name)) {
        cambio = true;
      }
    }
  }
}

/** El checker de UN fichero, sin lib ni imports resueltos: solo hace falta
 *  saber a qué declaración DEL FICHERO apunta cada identificador. El programa
 *  usa el mismo `SourceFile` que ya se parseó, así que no hay dos árboles. */
function checkerDe(sf: ts.SourceFile): ts.TypeChecker {
  const nombre = "/x.mjs";
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === nombre ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f === nombre,
    readFile: () => undefined,
  };
  return ts.createProgram({ rootNames: [nombre], options: { allowJs: true, noLib: true, noResolve: true, types: [] }, host }).getTypeChecker();
}

export function modulo(ruta: string, leer: Lector): Modulo | Error {
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
  const m: Modulo = { ruta, sf, checker: checkerDe(sf), leer, fns: new Map(), imports: new Map(), ctxs: new Set(), sueltos: new Map() };
  recorre(sf, (x) => {
    if (ts.isFunctionDeclaration(x) && x.name) m.fns.set(x.name.text, x);
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer) {
      const ini = x.initializer;
      if (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini)) m.fns.set(x.name.text, ini);
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
export function verbo(m: Modulo, n: ts.Node): string | null {
  if (!ts.isCallExpression(n)) return null;
  const c = n.expression;
  if (ts.isIdentifier(c)) {
    const s = simbolo(m, c);
    return (s && m.sueltos.get(s)) ?? null;
  }
  return verboDeAcceso(m, c);
}

export type FuncionResuelta = { m: Modulo; fn: ts.FunctionLikeDeclaration } | { error: string };

export function funcionDe(m: Modulo, nombre: string): FuncionResuelta {
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
export function llamadaResuelta(m: Modulo, n: ts.Node): FuncionResuelta | null {
  if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || verbo(m, n) !== null) return null;
  return funcionDe(m, n.expression.text);
}
