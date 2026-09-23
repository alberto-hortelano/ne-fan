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
 *  ## El contrato (copiado en el `_comment` del padrón)
 *
 *  **Ámbito:** el cuerpo del `export default` del guion (`cuerpoPrincipal`),
 *  sin entrar en funciones anidadas.
 *
 *  **Salto `return`:** un `if` con un `return` en una rama (`then`, o un
 *  `else` que no es otro `if`) detrás del cual el cuerpo principal todavía
 *  tiene un `ctx.expect`/`ctx.expectEspera`. Un `return` que no se salta
 *  ningún aserto no es salto.
 *
 *  **Salto `rama-muda`:** un `if` sin `return` en el que una rama afirma de
 *  VERDAD (`expectEspera`, o `expect` cuyo 2.º argumento no es el literal
 *  `false`) sin reportar un fallo, y la otra —un `else` o su ausencia— no
 *  afirma, no declara y no lanza. Es el mismo salto escrito sin `return`.
 *
 *  **Observado** si:
 *   1. (solo `return`) cada rama que retorna contiene `throw`, `ctx.expect`,
 *      `ctx.expectEspera`, `ctx.sinMedir` o `ctx.sinMedirBloque`;
 *   2. la condición —sin `await`, paréntesis, `!` ni `Boolean(…)`— es idéntica
 *      token a token al 2.º argumento (normalizado igual) de un `ctx.expect`
 *      que DOMINA el `if`: sentencia hermana anterior en su bloque o en un
 *      bloque ancestro, dentro de la misma función. Nunca la frase;
 *   3. todos los ÁTOMOS de la condición están observados, y hay al menos uno.
 *      Átomo: un identificador declarado en el fichero (no un import, no
 *      `ctx`, no un nombre de propiedad, no lo que va dentro de los
 *      argumentos de una llamada) o una llamada (`Boolean`/`Number`/`String`
 *      son transparentes). Un identificador está observado si es átomo del
 *      2.º argumento de un `ctx.expect` que domina el `if`, o si su
 *      declaración domina el `if` y su inicializador contiene —callbacks
 *      incluidos— un verbo de afirmación o declaración o un `throw`, o si es
 *      `[await] f(…)` con `f` AFIRMANTE. Una llamada está observada si llama
 *      a un afirmante.
 *
 *  **Afirmante:** una función del guion, o importada con nombre de un `.mjs`
 *  relativo, que acaba en `return`/`throw` y en la que todo `return` devuelve
 *  un valor construido (objeto, array, `true`, número, cadena no vacía) o un
 *  vacío (`null`/`false`/`undefined`/`return;`) dentro de una rama de un `if`
 *  que cumple 1-3. Lo que no se resuelve (`import *`, reexport, dinámico, un
 *  `.js`) NO es afirmante: el error va siempre hacia el ROJO.
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
  /** 1-based, del `if`. Solo para leer: el padrón identifica por `condicion`. */
  linea: number;
  forma: FormaDeSalto;
  /** `condicionNormalizada` de la condición del `if`: la clave del padrón. */
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
  /** Analiza TAMBIÉN las funciones del guion con un parámetro `ctx`. No es el
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

/** `ctx.<verbo>(…)` → `<verbo>`; cualquier otra cosa → null. */
function verbo(n: ts.Node): string | null {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return null;
  const o = n.expression.expression;
  return ts.isIdentifier(o) && o.text === "ctx" ? n.expression.name.text : null;
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

/** ¿Hay un nodo que cumple `pred` bajo `raiz`? Por defecto sin entrar en
 *  funciones anidadas; `conCallbacks` sí entra (regla 3b: el `.catch`). */
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

const esObservador = (n: ts.Node): boolean => {
  const v = verbo(n);
  return ts.isThrowStatement(n) || (v !== null && (AFIRMA.has(v) || DECLARA.has(v)));
};
const esExpectFalse = (n: ts.Node): boolean =>
  verbo(n) === "expect" && (n as ts.CallExpression).arguments[1]?.kind === ts.SyntaxKind.FalseKeyword;
const reportaFallo = (n: ts.Node): boolean =>
  contiene(n, (x) => ts.isThrowStatement(x) || DECLARA.has(verbo(x) ?? "") || esExpectFalse(x));
const afirmaDeVerdad = (n: ts.Node): boolean =>
  contiene(n, (x) => verbo(x) === "expectEspera" || (verbo(x) === "expect" && !esExpectFalse(x)));

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
  /** Funciones con nombre del fichero, a cualquier profundidad. */
  fns: Map<string, ts.FunctionLikeDeclaration>;
  /** `import { a as b } from "./x.mjs"` → b ↦ {ruta absoluta, "a"}. */
  imports: Map<string, { ruta: string; nombre: string }>;
  /** Todo lo que el fichero declara (variables, parámetros, patrones). */
  locales: Set<string>;
}

interface Veredicto {
  ok: boolean;
  porque: string;
}

/** Módulos parseados, por lector: un negativo en memoria no puede servir el
 *  árbol del fichero real ni al revés. */
const modulosPorLector = new WeakMap<Lector, Map<string, Modulo | Error>>();
/** Afirmantes ya juzgados. Por nodo: cada parseo da nodos nuevos. */
const afirmantes = new WeakMap<ts.Node, Veredicto>();

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
  const m: Modulo = { ruta, sf, fns: new Map(), imports: new Map(), locales: new Set() };
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
  cache.set(ruta, m);
  return m;
}

type FuncionResuelta = { m: Modulo; fn: ts.FunctionLikeDeclaration } | { error: string };

function funcionDe(m: Modulo, nombre: string, leer: Lector): FuncionResuelta {
  const local = m.fns.get(nombre);
  if (local) return { m, fn: local };
  const imp = m.imports.get(nombre);
  if (!imp) return { error: `\`${nombre}\` no es una función del guion ni un import con nombre de un .mjs relativo` };
  const otro = modulo(imp.ruta, leer);
  if (otro instanceof Error) return { error: `\`${nombre}\`: no se pudo leer ${imp.ruta} (${otro.message})` };
  const fn = otro.fns.get(imp.nombre);
  if (!fn) return { error: `\`${nombre}\`: ${imp.ruta} no declara la función \`${imp.nombre}\` (¿reexport?)` };
  return { m: otro, fn };
}

function afirmante(m: Modulo, fn: ts.FunctionLikeDeclaration, nombre: string, leer: Lector): Veredicto {
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
      const construido =
        e !== null &&
        (ts.isObjectLiteralExpression(e) ||
          ts.isArrayLiteralExpression(e) ||
          e.kind === ts.SyntaxKind.TrueKeyword ||
          ts.isNumericLiteral(e) ||
          (ts.isStringLiteral(e) && e.text !== ""));
      if (construido) return;
      const vacio =
        e === null ||
        e.kind === ts.SyntaxKind.NullKeyword ||
        e.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isIdentifier(e) && e.text === "undefined");
      if (!vacio) {
        falla = `\`${dondeEsta}\` no es afirmante: \`return ${e.getText().slice(0, 40)}\` en la línea ${lineaDe(x)}`;
        return false;
      }
      const rama = ramaQueContiene(x, fn);
      if (!rama || !(contiene(rama.rama, esObservador) || condicionObservada(m, rama.si, fn, leer).ok))
        falla = `\`${dondeEsta}\` no es afirmante: devuelve un vacío sin observar en la línea ${lineaDe(x)}`;
      return false;
    });
    return falla ? { ok: false, porque: falla } : { ok: true, porque: `\`${dondeEsta}\` es afirmante` };
  };
  const v = juzga();
  afirmantes.set(fn, v);
  return v;
}

/** El `if` más cercano que contiene a `n` dentro de `fn`, y la rama por la que. */
function ramaQueContiene(n: ts.Node, fn: ts.Node): { si: ts.IfStatement; rama: ts.Statement } | null {
  let hijo: ts.Node = n;
  let p: ts.Node | undefined = n.parent;
  while (p && p !== fn) {
    if (ts.isIfStatement(p) && hijo !== p.expression) return { si: p, rama: hijo as ts.Statement };
    hijo = p;
    p = p.parent;
  }
  return null;
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

/** `ctx.expect(frase, cond, …)` como sentencia → `cond`. */
function condicionDeExpect(st: ts.Statement): ts.Expression | null {
  if (!ts.isExpressionStatement(st)) return null;
  const e = sinEnvoltorio(st.expression);
  if (verbo(e) !== "expect") return null;
  return (e as ts.CallExpression).arguments[1] ?? null;
}

type Atomo = { id: string; nodo: ts.Node } | { llamada: ts.CallExpression; veredicto: Veredicto };

function atomos(m: Modulo, cond: ts.Expression, leer: Lector): Atomo[] {
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
      const f = funcionDe(m, callee, leer);
      out.push({ llamada: x, veredicto: "error" in f ? { ok: false, porque: f.error } : afirmante(f.m, f.fn, callee, leer) });
      return;
    }
    if (ts.isIdentifier(x)) {
      const padre = x.parent;
      if (ts.isPropertyAccessExpression(padre) && padre.name === x) return;
      if (x.text !== "ctx" && m.locales.has(x.text)) out.push({ id: x.text, nodo: x });
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
function observadosAntes(m: Modulo, si: ts.Node, fn: ts.FunctionLikeDeclaration, leer: Lector): Map<string, Veredicto> {
  const vistos = new Map<string, Veredicto>();
  const anota = (id: string, v: Veredicto): void => {
    if (!vistos.get(id)?.ok) vistos.set(id, v);
  };
  for (const st of dominantes(si, fn)) {
    const cond = condicionDeExpect(st);
    if (cond) {
      for (const a of atomos(m, cond, leer)) if ("id" in a) anota(a.id, { ok: true, porque: `\`${a.id}\` afirmado en la línea ${lineaDe(st)}` });
      continue;
    }
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!d.initializer) continue;
      let v: Veredicto | null = contiene(d.initializer, esObservador, true)
        ? { ok: true, porque: `su inicializador afirma o declara (línea ${lineaDe(d)})` }
        : null;
      const ini = sinEnvoltorio(d.initializer);
      if (!v && ts.isCallExpression(ini) && ts.isIdentifier(ini.expression)) {
        const f = funcionDe(m, ini.expression.text, leer);
        v = "error" in f ? { ok: false, porque: f.error } : afirmante(f.m, f.fn, ini.expression.text, leer);
      }
      if (v) for (const n of nombresLigados(d.name)) anota(n, { ok: v.ok, porque: `\`${n}\`: ${v.porque}` });
    }
  }
  return vistos;
}

/** Reglas 2 y 3 sobre la condición de `si`, dentro de `fn`. */
function condicionObservada(m: Modulo, si: ts.IfStatement, fn: ts.FunctionLikeDeclaration, leer: Lector): Veredicto {
  const clave = normalizaCondicion(si.expression);
  for (const st of dominantes(si, fn)) {
    const cond = condicionDeExpect(st);
    if (cond && normalizaCondicion(cond) === clave) return { ok: true, porque: `condición afirmada literalmente en la línea ${lineaDe(st)}` };
  }
  const at = atomos(m, si.expression, leer);
  if (at.length === 0) return { ok: false, porque: "la condición no tiene ningún átomo que se pueda observar" };
  const antes = observadosAntes(m, si, fn, leer);
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

/** Los saltos de una función (el cuerpo principal, o un helper con `ctx`). */
function saltosDe(m: Modulo, fn: ts.FunctionLikeDeclaration, nombre: string, leer: Lector): Salto[] {
  const out: Salto[] = [];
  const cuerpo = fn.body;
  if (!cuerpo || !ts.isBlock(cuerpo)) return out;
  const asertaDetras = (si: ts.IfStatement): boolean =>
    contiene(cuerpo, (x) => x.pos >= si.end && AFIRMA.has(verbo(x) ?? ""));
  recorreSinAnidadas(cuerpo, (x) => {
    if (!ts.isIfStatement(x)) return;
    const ramas = [x.thenStatement, ...(x.elseStatement && !ts.isIfStatement(x.elseStatement) ? [x.elseStatement] : [])];
    const conReturn = ramas.filter((r) => contiene(r, ts.isReturnStatement));
    let forma: FormaDeSalto | null = null;
    if (conReturn.length > 0) {
      if (asertaDetras(x)) forma = "return";
    } else {
      const muda = (r: ts.Statement | undefined): boolean => !r || !contiene(r, esObservador);
      const afirma = (r: ts.Statement | undefined): boolean => Boolean(r) && afirmaDeVerdad(r!) && !reportaFallo(r!);
      if ((afirma(x.thenStatement) && muda(x.elseStatement)) || (afirma(x.elseStatement) && muda(x.thenStatement))) forma = "rama-muda";
    }
    if (!forma) return;
    const base = { fichero: m.ruta, linea: lineaDe(x), forma, condicion: condicionNormalizada(x.expression), funcion: nombre };
    if (forma === "return" && conReturn.every((r) => contiene(r, esObservador))) {
      out.push({ ...base, observado: true, porque: "la rama que retorna afirma, declara o lanza" });
      return;
    }
    const v = condicionObservada(m, x, fn, leer);
    out.push({ ...base, observado: v.ok, porque: v.porque });
  });
  return out;
}

/** Todos los saltos del guion en `ruta` (absoluta), observados o no. Lanza si
 *  el guion no se puede leer o no tiene `export default`: un guion que el
 *  detector no ve no puede salir como «0 saltos». */
export function saltosDelGuion(ruta: string, leer: Lector, opciones: OpcionesDelDetector = {}): Salto[] {
  const m = modulo(ruta, leer);
  if (m instanceof Error) throw m;
  const principal = cuerpoPrincipal(m.sf, ruta);
  const out = saltosDe(m, principal, "default", leer);
  if (opciones.helpers) {
    for (const [nombre, fn] of m.fns) {
      if (fn === principal) continue;
      if (fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === "ctx")) out.push(...saltosDe(m, fn, nombre, leer));
    }
  }
  return out;
}
