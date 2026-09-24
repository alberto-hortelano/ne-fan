/** CRAP score: complejidad ciclomática × falta de cobertura.
 *
 *  La cobertura sola miente: dice que el test PASÓ POR la línea, no que se
 *  habría enterado de que cambia. La complejidad sola tampoco basta: una
 *  función enrevesada pero exhaustivamente probada no es deuda. El CRAP los
 *  cruza — `c² · (1−cov)³ + c` — y ordena por lo que hay que atacar primero:
 *  complejo Y poco cubierto.
 *
 *  Sin dependencias nuevas: la cobertura sale del runner nativo de Node 24 y
 *  la complejidad se calcula sobre el AST con la API de TypeScript, que ya es
 *  dependencia. Se hace aquí en vez de leerla de ESLint porque necesitamos el
 *  RANGO real de cada función [inicio, fin]: repartir las líneas del lcov "de
 *  una función a la siguiente" da artefactos absurdos (una función con una
 *  arrow en su primera línea sale con 0% de cobertura).
 *
 *  QUÉ ENTRA EN EL DENOMINADOR (#525). Solo las líneas que EMITEN código, y se
 *  deciden sobre el AST, no sobre el lcov: el reporter de Node escribe un `DA:`
 *  por cada línea física del fichero —cabecera, `interface`, blancos— y las que
 *  no producen JavaScript salen con 0 hits porque no hay nada que ejecutar en
 *  ellas. Contarlas convertía el suelo de cobertura en un impuesto sobre
 *  documentar: `src/scene/aim.ts` medía 69,1 % (sus 51 líneas "descubiertas"
 *  eran las 1-56: cabecera y cuatro `interface`) y `src/simulation/mirada.ts`,
 *  igual de probado, 100 % por tener un `export const` arriba. Con el filtro
 *  los dos miden 100 %.
 *
 *  DOS MEDIDAS, UNA DEFINICIÓN (#664). El cliente (`nefan-html/src`) se mide
 *  con ESTAS mismas funciones —`lineasDeCodigo`, `cuentaLineas`, `functionsOf`—
 *  y no con una copia, que se desincronizaría del denominador de #525. Lo que
 *  cambia es la `Medida`: su lcov, sus árboles y su UNIVERSO. El core mide lo
 *  que un test carga (su banco lo carga casi todo); el cliente mide EL ÁRBOL
 *  ENTERO, con lo que nadie carga a cobertura 0, porque ahí lo no cargado es
 *  el 77 % y medir solo lo cargado no es monótono: un test que IMPORTA un
 *  fichero invisible metería sus funciones sin cubrir y pondría el gate rojo
 *  por añadir un test. Su gate tampoco es el del core: es por FUNCIÓN, contra
 *  `data/contract/client-crap.json` (tope + foto de lo que ya lo superaba).
 *
 *  Uso:
 *    npm run coverage && npm run crap        # tabla
 *    npm run crap -- --check                 # falla si algo supera el umbral
 *    npm run crap -- --top 40                # más filas
 *    (en nefan-html) npm run coverage && npm run crap -- --check   # el cliente
 *    (en nefan-html) npm run crap -- --foto  # la foto de congeladas, en JSON
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const htmlRoot = join(coreRoot, "..", "nefan-html");
const THRESHOLDS = join(coreRoot, "data", "contract", "quality-thresholds.json");
const CONTRATO_CLIENTE = join(coreRoot, "data", "contract", "client-crap.json");

/** Qué se mide y sobre qué. `arboles` son los prefijos (relativos a `raiz`) que
 *  son deuda de ESTE paquete: lo demás que aparezca en el lcov (dist/, otros
 *  paquetes) se descarta. `universo` decide qué pasa con lo que ningún test
 *  cargó: `lo-cargado` lo deja fuera (el core, hoy), `el-arbol` lo mete con sus
 *  líneas de código a 0 hits (el cliente). */
export interface Medida {
  nombre: "core" | "cliente";
  raiz: string;
  lcov: string;
  arboles: readonly string[];
  universo: "lo-cargado" | "el-arbol";
  /** El comando que regenera el lcov, para los mensajes. */
  comando: string;
}

export const MEDIDA_CORE: Medida = {
  nombre: "core",
  raiz: coreRoot,
  lcov: join(coreRoot, "coverage", "lcov.info"),
  arboles: ["src/", "bridge/", "services/"],
  universo: "lo-cargado",
  comando: "npm run coverage",
};

export const MEDIDA_CLIENTE: Medida = {
  nombre: "cliente",
  raiz: htmlRoot,
  lcov: join(htmlRoot, "coverage", "lcov.info"),
  arboles: ["src/"],
  universo: "el-arbol",
  comando: "cd nefan-html && npm run coverage",
};

const ANONIMA = "(anónima)";

export interface FuncInfo {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
  /** La función CON NOMBRE más cercana que la contiene, si la hay. Solo sirve
   *  para la clave de una anónima (`claveDe`). */
  padre?: string;
  /** Solo en las anónimas: la clave completa, `padre>(anónima)@forma` con un
   *  `#n` si hay hermanas de la misma forma. Ver `claveDe`. */
  clave?: string;
}

/** Complejidad ciclomática de McCabe: 1 + cada punto de decisión. Cuenta los
 *  operadores de cortocircuito (`&&`, `||`, `??`) porque cada uno es una rama
 *  que un test puede no recorrer. Las funciones ANIDADAS no suman a la de
 *  fuera: cada una se mide por separado, como hace ESLint. */
function complexityOf(fn: ts.Node): number {
  let total = 1;
  const visit = (node: ts.Node): void => {
    if (node !== fn && ts.isFunctionLike(node)) return; // la anidada se mide sola
    switch (node.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
        total++;
        break;
      case ts.SyntaxKind.CaseClause:
        // `case x:` sin cuerpo (fallthrough) no añade rama propia.
        if ((node as ts.CaseClause).statements.length > 0) total++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const op = (node as ts.BinaryExpression).operatorToken.kind;
        if (
          op === ts.SyntaxKind.AmpersandAmpersandToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.QuestionQuestionToken
        ) {
          total++;
        }
        break;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return total;
}

function nameOf(fn: ts.Node): string {
  const named = fn as ts.FunctionLikeDeclaration;
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  if (ts.isConstructorDeclaration(fn)) {
    const cls = fn.parent as ts.ClassDeclaration;
    return `${cls.name?.text ?? "?"}.constructor`;
  }
  // `const foo = () => {}` / `foo: () => {}`
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  return ANONIMA;
}

/** Todas las funciones del fichero con su rango de líneas (1-based) y su
 *  complejidad. */
export function functionsOf(text: string, fileName = "x.ts"): FuncInfo[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const out: FuncInfo[] = [];
  const visit = (node: ts.Node, padre: string | undefined): void => {
    let dentro = padre;
    if (ts.isFunctionLike(node) && node.getSourceFile()) {
      const body = (node as ts.FunctionLikeDeclaration).body;
      if (body) {
        const name = nameOf(node);
        out.push({
          name,
          startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          complexity: complexityOf(node),
          ...(padre === undefined ? {} : { padre }),
          ...(name === ANONIMA ? { clave: `${padre ?? "<módulo>"}>${ANONIMA}@${formaDe(node, sf)}` } : {}),
        });
        if (name !== ANONIMA) dentro = name;
      }
    }
    ts.forEachChild(node, (h) => visit(h, dentro));
  };
  ts.forEachChild(sf, (h) => visit(h, undefined));
  // Hermanas de la misma forma bajo el mismo padre: la primera se queda sin
  // número y las siguientes llevan `#2`, `#3`… en orden de aparición.
  const vistas = new Map<string, number>();
  for (const f of out) {
    if (f.clave === undefined) continue;
    const n = (vistas.get(f.clave) ?? 0) + 1;
    vistas.set(f.clave, n);
    if (n > 1) f.clave = `${f.clave}#${n}`;
  }
  return out;
}

/** Dónde vive una anónima, dicho por el nodo que la contiene y no por su
 *  línea: si es argumento de una llamada, la llamada (`window.addEventListener("keyup")`);
 *  si no, el tipo del nodo padre (`ReturnStatement`, `PropertyAssignment`…).
 *  Estable ante inserciones de otras líneas y de anónimas de OTRA forma. */
function formaDe(fn: ts.Node, sf: ts.SourceFile): string {
  const p = fn.parent;
  if (p && (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression !== fn) {
    const callee = p.expression.getText(sf).replace(/\s+/g, "");
    const primero = p.arguments?.[0];
    const lit = primero && ts.isStringLiteralLike(primero) ? JSON.stringify(primero.text) : "";
    const corto = callee.length > 60 ? `…${callee.slice(-59)}` : callee;
    return `${ts.isNewExpression(p) ? "new " : ""}${corto}(${lit})`;
  }
  return p ? ts.SyntaxKind[p.kind] : "SourceFile";
}

/** Cómo se identifica una función entre dos medidas: su nombre, o para una
 *  anónima `padre>(anónima)@forma[#n]` (`<módulo>` si no tiene padre con
 *  nombre). La forma es necesaria: con solo el padre, las 24 anónimas de nivel
 *  de módulo de `main.ts` eran UNA clave congelada en 1122 y un listener nuevo
 *  de CRAP 812 entraba en verde (QA de la tanda BF, H1). Una anónima NUEVA
 *  tiene clave nueva y se mide contra el tope. Lo que queda: insertar una
 *  hermana de la MISMA forma delante de una congelada corre su `#n`, y eso da
 *  ROJO (la congelada pierde su foto), no verde. Las funciones con nombre
 *  homónimas del mismo fichero siguen fundiéndose por el máximo. */
export function claveDe(f: FuncInfo): string {
  return f.clave ?? f.name;
}

/** Líneas (1-based) del fichero que EMITEN código, que son las únicas que un
 *  test puede recorrer. Fuera quedan, por este orden:
 *
 *   · lo que no es un token — blancos y comentarios sueltos, de línea o de
 *     bloque, que el parser ya trata como trivia;
 *   · el JSDoc, que SÍ cuelga del AST como hijo del nodo que documenta y por
 *     tanto no basta con "saltarse la trivia": hay que descartarlo a mano, y es
 *     la mitad de la prosa de esta casa;
 *   · lo que solo existe en tiempo de compilación: `interface`, `type`, nodos
 *     de tipo, `import type` / `export type`, declaraciones `declare` y las
 *     firmas de sobrecarga (función sin cuerpo).
 *
 *  Una línea entra si le queda ALGÚN token vivo, `}` incluido: la unidad del
 *  lcov es la línea, así que el criterio también. */
export function lineasDeCodigo(text: string, fileName = "x.ts"): Set<number> {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const out = new Set<number>();
  const marca = (pos: number, end: number): void => {
    const desde = sf.getLineAndCharacterOfPosition(pos).line;
    // `end` es exclusivo: un token que acaba en el salto de línea no ocupa la
    // línea siguiente.
    const hasta = sf.getLineAndCharacterOfPosition(Math.max(pos, end - 1)).line;
    for (let l = desde; l <= hasta; l++) out.add(l + 1);
  };
  const sinEmision = (n: ts.Node): boolean => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return true;
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return true;
    if (ts.isTypeNode(n)) return true;
    if (ts.isImportDeclaration(n) && n.importClause?.isTypeOnly) return true;
    if (ts.isExportDeclaration(n) && n.isTypeOnly) return true;
    if (ts.isFunctionLike(n) && !(n as ts.FunctionLikeDeclaration).body) return true;
    if (ts.canHaveModifiers(n)) {
      const mods = ts.getCombinedModifierFlags(n as ts.Declaration);
      if (mods & ts.ModifierFlags.Ambient) return true;
    }
    return false;
  };
  const visit = (n: ts.Node): void => {
    if (n !== sf && sinEmision(n)) return;
    const hijos = n.getChildren(sf);
    if (hijos.length === 0) {
      if (n.kind !== ts.SyntaxKind.EndOfFileToken) marca(n.getStart(sf), n.getEnd());
      return;
    }
    for (const h of hijos) visit(h);
  };
  visit(sf);
  return out;
}

/** Cobertura por línea de cada fichero del lcov. Requiere que la cobertura se
 *  genere con `--enable-source-maps`, o las líneas serían las del transpilado
 *  y no casarían con el AST del fuente. */
export function lineHitsFromLcov(text: string): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  let file = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      file = line.slice(3);
      if (!out.has(file)) out.set(file, new Map());
    } else if (line.startsWith("DA:") && file) {
      const [l, h] = line.slice(3).split(",");
      out.get(file)!.set(Number(l), Number(h));
    }
  }
  return out;
}

export function crap(complexity: number, coverage: number): number {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

export interface CrapRow extends FuncInfo {
  file: string;
  coverage: number;
  crap: number;
}

/** `quality-thresholds.json`, validado. Era un `JSON.parse` con cast: un bloque
 *  añadido o un typo en una clave pasaba sin que nadie lo leyera. */
export const ThresholdsSchema = z
  .object({
    $comment: z.string(),
    crap: z
      .object({ max: z.number().positive(), objetivo: z.number().positive(), nota: z.string() })
      .strict(),
    cobertura_lineas: z.object({ min: z.number().min(0).max(100), nota: z.string() }).strict(),
  })
  .strict();

export type Thresholds = z.infer<typeof ThresholdsSchema>;

export function readThresholds(): Thresholds {
  return ThresholdsSchema.parse(JSON.parse(readFileSync(THRESHOLDS, "utf-8")));
}

/** El contrato del cliente (`data/contract/client-crap.json`). Un tope por
 *  función, el mismo que el del core, y la FOTO de las funciones que ya lo
 *  superaban el día que el cliente entró, cada una en su cifra redondeada hacia
 *  arriba a 0,1. Sin suelo de cobertura: no hay base que lo sostenga. */
export const ContratoClienteSchema = z
  .object({
    $comment: z.string(),
    _lo_que_esto_NO_sujeta: z.array(z.string()).min(1),
    tope: z.number().positive(),
    objetivo: z.number().positive(),
    congeladas: z.array(
      z
        .object({
          fichero: z.string().startsWith("src/"),
          funcion: z.string().min(1),
          crap: z.number().positive(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((c, ctx) => {
    const vistas = new Set<string>();
    for (const [i, g] of c.congeladas.entries()) {
      const clave = `${g.fichero}\u0000${g.funcion}`;
      if (vistas.has(clave)) {
        ctx.addIssue({
          code: "custom",
          path: ["congeladas", i],
          message: `${g.fichero} · ${g.funcion} repetida`,
        });
      }
      vistas.add(clave);
      // Una congelada bajo el tope no es una excepción: es un permiso de
      // recrecer hasta su cifra que el tope general no daría.
      if (g.crap <= c.tope) {
        ctx.addIssue({
          code: "custom",
          path: ["congeladas", i, "crap"],
          message: `${g.fichero} · ${g.funcion} congelada en ${g.crap}, que no pasa del tope ${c.tope}`,
        });
      }
    }
  });

export type ContratoCliente = z.infer<typeof ContratoClienteSchema>;

export function leerContratoCliente(ruta = CONTRATO_CLIENTE): ContratoCliente {
  return ContratoClienteSchema.parse(JSON.parse(readFileSync(ruta, "utf-8")));
}

/** Líneas medidas y cubiertas en el rango [desde, hasta]. Una línea cuenta si
 *  emite código Y el lcov trae dato de ella: sin lo primero su hit no significa
 *  nada —normalmente 0, pero 1 si cae dentro de un rango de V8 que la barre de
 *  paso, y eso depende de la máquina—; sin lo segundo no se sabe nada de ella.
 *  Es la ÚNICA definición de qué se mide: la usan igual el denominador global y
 *  el de cada función. */
export function cuentaLineas(
  hits: Map<number, number>,
  codigo: Set<number>,
  desde: number,
  hasta: number,
): { total: number; cubiertas: number } {
  let total = 0;
  let cubiertas = 0;
  for (let l = desde; l <= hasta; l++) {
    if (!codigo.has(l)) continue;
    const h = hits.get(l);
    if (h === undefined) continue;
    total++;
    if (h > 0) cubiertas++;
  }
  return { total, cubiertas };
}

export interface Medicion {
  filas: CrapRow[];
  cobGlobal: number;
  lineasMedidas: number;
  /** Lo del árbol que ningún test cargó: cuántos ficheros, cuántas de sus
   *  líneas de código y de cuántos ficheros del árbol. Se cuenta en los dos
   *  universos; solo `el-arbol` lo mete además en `filas`. */
  sinCargar: { ficheros: number; lineas: number; deFicheros: number };
  /** Entradas del lcov fuera de los árboles (otro paquete, dist/…). */
  descartados: string[];
}

/** El corazón de la medida, PURO: los hits del lcov y el fuente de cada fichero
 *  del árbol entran, las filas salen. `fuentes` tiene el texto de todo `.ts` de
 *  los árboles (y de lo que el lcov trae dentro de ellos). Una entrada del lcov
 *  sin fuente es una medida de otro árbol y para; lo que el lcov no trae se
 *  mide a cobertura 0 si el universo es `el-arbol`. */
export function medirFuentes(
  porFichero: ReadonlyMap<string, Map<number, number>>,
  fuentes: ReadonlyMap<string, string>,
  medida: Pick<Medida, "arboles" | "universo">,
): Medicion {
  const filas: CrapRow[] = [];
  let lineasTotales = 0;
  let lineasCubiertas = 0;
  const sinFuente: string[] = [];
  const descartados: string[] = [];
  const mide = (file: string, texto: string, hits: Map<number, number>): void => {
    const codigo = lineasDeCodigo(texto, file);
    const ultima = Math.max(0, ...hits.keys());
    const delFichero = cuentaLineas(hits, codigo, 1, ultima);
    lineasTotales += delFichero.total;
    lineasCubiertas += delFichero.cubiertas;
    for (const fn of functionsOf(texto, file)) {
      const { total, cubiertas } = cuentaLineas(hits, codigo, fn.startLine, fn.endLine);
      if (total === 0) continue;
      const coverage = cubiertas / total;
      filas.push({ ...fn, file, coverage, crap: crap(fn.complexity, coverage) });
    }
  };
  // Primero en el orden del lcov: a igual CRAP, `sort` es estable y la tabla
  // del core sale como salía.
  for (const [file, hits] of porFichero) {
    // El lcov recoge todo lo que se cargó, incluidos los .js de dist/ (los
    // carga narrative-mcp por su `exports`) y ficheros de otros paquetes. La
    // deuda se mide sobre el FUENTE de este paquete y nada más.
    if (!medida.arboles.some((d) => file.startsWith(d))) {
      descartados.push(file);
      continue;
    }
    const texto = fuentes.get(file);
    // El fuente NO es opcional: sin él no se puede decir qué línea emite código
    // y el fichero entraría con sus comentarios en el denominador. Que falte
    // significa que el lcov es de otro árbol, así que se para.
    if (texto === undefined) {
      sinFuente.push(file);
      continue;
    }
    mide(file, texto, hits);
  }
  if (sinFuente.length > 0) {
    throw new Error(
      `El lcov mide ${sinFuente.length} fichero(s) que ya no están en el árbol:\n` +
        sinFuente.map((f) => `   ${f}`).join("\n") +
        `\nEs una medida de otra revisión. Regenérala con el \`coverage\` de su paquete.`,
    );
  }
  const sinCargar = { ficheros: 0, lineas: 0, deFicheros: 0 };
  for (const [file, texto] of fuentes) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
    sinCargar.deFicheros++;
    if (porFichero.has(file)) continue;
    const codigo = lineasDeCodigo(texto, file);
    sinCargar.ficheros++;
    sinCargar.lineas += codigo.size;
    // Nadie lo cargó: cada línea que emite código, a 0 hits. Es lo que
    // escribiría el reporter si un test lo importara sin ejecutar nada, así
    // que cargarlo mañana solo puede SUBIR su cobertura.
    if (medida.universo === "el-arbol") mide(file, texto, new Map([...codigo].map((l) => [l, 0])));
  }
  filas.sort((a, b) => b.crap - a.crap);
  return {
    filas,
    cobGlobal: lineasTotales === 0 ? 0 : (lineasCubiertas / lineasTotales) * 100,
    lineasMedidas: lineasTotales,
    sinCargar,
    descartados,
  };
}

/** Los `.ts` bajo un directorio, relativos a `raiz`. */
function tsBajo(raiz: string, dir: string): string[] {
  const abs = join(raiz, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === "dist") continue;
    const rel = `${dir.replace(/\/$/, "")}/${name}`;
    if (statSync(join(raiz, rel)).isDirectory()) out.push(...tsBajo(raiz, rel));
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

/** Fila por función medida, ordenada de peor a mejor CRAP, más la cobertura
 *  global de líneas sobre los mismos árboles. Lo comparten la tabla (`--check`)
 *  y la cola de deuda (`scripts/deuda.ts`): una sola definición de qué se mide.
 *  Falta el lcov → error duro, no una tabla vacía que parece "cero deuda". */
export function crapRows(medida: Medida = MEDIDA_CORE): Medicion {
  if (!existsSync(medida.lcov)) {
    throw new Error(`No hay ${medida.lcov}.\nGenera la cobertura primero:  ${medida.comando}`);
  }
  const porFichero = lineHitsFromLcov(readFileSync(medida.lcov, "utf-8"));
  const fuentes = new Map<string, string>();
  for (const d of medida.arboles) for (const f of tsBajo(medida.raiz, d)) fuentes.set(f, "");
  // Lo que el lcov trae dentro de los árboles y existe, aunque no sea `.ts`
  // (el core lo medía así): sin esto una extensión rara pararía la medida.
  for (const f of porFichero.keys()) {
    if (medida.arboles.some((d) => f.startsWith(d)) && existsSync(join(medida.raiz, f))) fuentes.set(f, "");
  }
  for (const f of fuentes.keys()) fuentes.set(f, readFileSync(join(medida.raiz, f), "utf-8"));
  return medirFuentes(porFichero, fuentes, medida);
}

interface PeorDeClave {
  fichero: string;
  funcion: string;
  crap: number;
  fila: CrapRow;
}

/** El peor CRAP de cada (fichero, clave). */
function peoresPorClave(filas: readonly CrapRow[]): PeorDeClave[] {
  const por = new Map<string, PeorDeClave>();
  for (const f of filas) {
    const funcion = claveDe(f);
    const k = `${f.file}\u0000${funcion}`;
    const ya = por.get(k);
    if (!ya || f.crap > ya.crap) por.set(k, { fichero: f.file, funcion, crap: f.crap, fila: f });
  }
  return [...por.values()];
}

/** Hacia arriba a 0,1: la foto no puede quedar por debajo de lo medido. */
const redondeaArriba = (x: number): number => Math.ceil(x * 10) / 10;

/** Las congeladas que tocaría escribir hoy: cada clave por encima de `tope`,
 *  con su CRAP redondeado hacia arriba a 0,1, en orden de fichero y función. */
export function fotoDeCongeladas(filas: readonly CrapRow[], tope: number): ContratoCliente["congeladas"] {
  return peoresPorClave(filas)
    .filter((p) => p.crap > tope)
    .map((p) => ({ fichero: p.fichero, funcion: p.funcion, crap: redondeaArriba(p.crap) }))
    .sort((a, b) => a.fichero.localeCompare(b.fichero) || a.funcion.localeCompare(b.funcion));
}

export interface VeredictoCliente {
  /** Claves por encima de su límite: el tope, o su foto si está congelada. */
  rojas: {
    fichero: string;
    funcion: string;
    crap: number;
    limite: number;
    fila: CrapRow;
    /** La congelada que ya no está y tenía EXACTAMENTE esta cifra: casi seguro
     *  un renombrado o un fichero movido, y ahí sí se regenera la entrada. */
    renombradoDe?: { fichero: string; funcion: string };
  }[];
  /** Congeladas cuya foto ya no hace falta en su cifra: bajaron, o ya caben en
   *  el tope, o su función no está. Avisan; no ponen rojo. */
  sobran: { fichero: string; funcion: string; congelada: number; ahora: number | undefined }[];
}

/** El gate del cliente, PURO. Añadir un test solo puede subir los hits de una
 *  línea, así que ninguna clave sube: el veredicto no se pone rojo por testear. */
export function veredictoCliente(filas: readonly CrapRow[], contrato: ContratoCliente): VeredictoCliente {
  const peores = peoresPorClave(filas);
  const foto = new Map(contrato.congeladas.map((c) => [`${c.fichero}\u0000${c.funcion}`, c.crap]));
  const rojas: VeredictoCliente["rojas"] = [];
  const ahora = new Map<string, number>();
  for (const p of peores) {
    const k = `${p.fichero}\u0000${p.funcion}`;
    ahora.set(k, p.crap);
    const limite = foto.get(k) ?? contrato.tope;
    if (p.crap > limite) rojas.push({ ...p, limite });
  }
  const sobran: VeredictoCliente["sobran"] = [];
  for (const c of contrato.congeladas) {
    const v = ahora.get(`${c.fichero}\u0000${c.funcion}`);
    if (v === undefined || redondeaArriba(v) < c.crap) {
      sobran.push({ fichero: c.fichero, funcion: c.funcion, congelada: c.crap, ahora: v });
    }
  }
  for (const r of rojas) {
    const origen = sobran.find((s) => s.ahora === undefined && s.congelada === redondeaArriba(r.crap));
    if (origen) r.renombradoDe = { fichero: origen.fichero, funcion: origen.funcion };
  }
  rojas.sort((a, b) => b.crap - a.crap);
  return { rojas, sobran };
}

function tabla(filas: readonly CrapRow[], top: number): void {
  console.log(`\nCRAP = complejidad² · (1−cobertura)³ + complejidad\n`);
  console.log(`${"CRAP".padStart(7)}  ${"cx".padStart(3)}  ${"cob".padStart(5)}  función`);
  console.log("─".repeat(78));
  for (const r of filas.slice(0, top)) {
    console.log(
      `${r.crap.toFixed(1).padStart(7)}  ${String(r.complexity).padStart(3)}  ` +
        `${`${(r.coverage * 100).toFixed(0)}%`.padStart(5)}  ${r.name} · ${r.file}:${r.startLine}`,
    );
  }
  console.log("─".repeat(78));
}

function medirOSalir(medida: Medida): Medicion {
  try {
    return crapRows(medida);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

function mainCore(check: boolean, top: number): void {
  const { filas, cobGlobal, lineasMedidas } = medirOSalir(MEDIDA_CORE);
  tabla(filas, top);
  console.log(
    `${filas.length} funciones medidas · cobertura ${cobGlobal.toFixed(2)}% de ${lineasMedidas} ` +
      `líneas DE CÓDIGO · complejidad máxima ${Math.max(...filas.map((r) => r.complexity))}`,
  );

  const umbral = readThresholds();
  const peores = filas.filter((r) => r.crap > umbral.crap.max);
  const sobreObjetivo = filas.filter((r) => r.crap > umbral.crap.objetivo);
  // El margen SE IMPRIME, en puntos y en líneas. El suelo se erosionó de 89,3 a
  // 89,1 a lo largo de una serie de PR sin que nadie lo viera venir porque el
  // informe redondeaba a un decimal y no decía a cuánto estaba el borde (#525).
  const margen = cobGlobal - umbral.cobertura_lineas.min;
  console.log(
    `\nTope (no empeorar): CRAP ≤ ${umbral.crap.max} — ${peores.length} por encima.` +
      `\nObjetivo a medio plazo: CRAP ≤ ${umbral.crap.objetivo} — ${sobreObjetivo.length} por encima.` +
      `\nCobertura mínima: ${umbral.cobertura_lineas.min}% — ahora ${cobGlobal.toFixed(2)}% ` +
      `(margen ${margen.toFixed(2)} puntos ≈ ${Math.round((margen / 100) * lineasMedidas)} líneas).`,
  );

  if (!check) return;
  const fallos: string[] = [];
  if (peores.length > 0) {
    fallos.push(
      `${peores.length} función(es) por encima del tope de CRAP (${umbral.crap.max}):\n` +
        peores
          .slice(0, 20)
          .map((r) => `   ${r.crap.toFixed(1)}  ${r.name} · ${r.file}:${r.startLine}`)
          .join("\n"),
    );
  }
  if (cobGlobal < umbral.cobertura_lineas.min) {
    fallos.push(
      `la cobertura de líneas bajó a ${cobGlobal.toFixed(2)}% (mínimo ${umbral.cobertura_lineas.min}%)`,
    );
  }
  if (fallos.length > 0) {
    console.error(`\n✘ ${fallos.join("\n✘ ")}`);
    process.exit(1);
  }
  console.log("\n✔ dentro de los umbrales");
}

function mainCliente(check: boolean, top: number, foto: boolean): void {
  const m = medirOSalir(MEDIDA_CLIENTE);
  const contrato = leerContratoCliente();
  if (foto) {
    console.log(JSON.stringify(fotoDeCongeladas(m.filas, contrato.tope), null, 2));
    return;
  }
  tabla(m.filas, top);
  const pct = m.lineasMedidas === 0 ? 0 : (m.sinCargar.lineas / m.lineasMedidas) * 100;
  console.log(
    `${m.filas.length} funciones medidas (EL ÁRBOL ENTERO de nefan-html/src) · cobertura ` +
      `${m.cobGlobal.toFixed(2)}% de ${m.lineasMedidas} líneas DE CÓDIGO`,
  );
  console.log(
    `sin ejercer: ${m.sinCargar.ficheros} de ${m.sinCargar.deFicheros} ficheros, ` +
      `${m.sinCargar.lineas} de ${m.lineasMedidas} líneas de código (${pct.toFixed(0)} %) — ningún test los carga, ` +
      `y cuentan a cobertura 0`,
  );
  console.log(`descartados: ${m.descartados.length} fichero(s) del lcov de otro paquete (../nefan-core, …)`);

  const v = veredictoCliente(m.filas, contrato);
  const sobreObjetivo = m.filas.filter((r) => r.crap > contrato.objetivo);
  console.log(
    `\nTope por función (no empeorar): CRAP ≤ ${contrato.tope}, o ≤ su foto — ` +
      `${contrato.congeladas.length} congeladas, ${v.rojas.length} por encima de su límite.` +
      `\nObjetivo a medio plazo: CRAP ≤ ${contrato.objetivo} — ${sobreObjetivo.length} por encima.` +
      `\nSin suelo de cobertura: data/contract/client-crap.json dice por qué.`,
  );
  if (v.sobran.length > 0) {
    console.log(
      `\n⚠ ${v.sobran.length} congelada(s) SOBRAN en su cifra (bajaron o ya no están): aprieta la foto ` +
        `o volverá a crecer gratis:\n` +
        v.sobran
          .slice(0, 20)
          .map(
            (s) =>
              `   ${s.congelada} → ${s.ahora === undefined ? "no está" : s.ahora.toFixed(1)}  ${s.funcion} · ${s.fichero}`,
          )
          .join("\n"),
    );
  }

  if (!check) return;
  if (v.rojas.length > 0) {
    console.error(
      `\n✘ ${v.rojas.length} función(es) del cliente por encima de su límite de CRAP:\n` +
        v.rojas
          .slice(0, 20)
          .map(
            (r) =>
              `   ${r.crap.toFixed(1)} > ${r.limite}  ${r.funcion} · ${r.fichero}:${r.fila.startLine}` +
              (r.renombradoDe
                ? `  ← ¿renombrado de ${r.renombradoDe.funcion} · ${r.renombradoDe.fichero}?`
                : ""),
          )
          .join("\n") +
        (v.rojas.some((r) => r.renombradoDe)
          ? `\nLas marcadas con ← parecen un RENOMBRADO o un fichero movido (su congelada ya no está y ` +
            `tenía esa misma cifra): ahí SÍ se regenera la entrada con \`npm run crap -- --foto\` y se quita la vieja.`
          : "") +
        `\nPara lo demás, la respuesta por defecto NO es tocar la foto: es un test, o partir la función.`,
    );
    process.exit(1);
  }
  console.log("\n✔ dentro de los umbrales");
}

function main(): void {
  const argv = process.argv.slice(2);
  const CHECK = argv.includes("--check");
  const TOP = Number(argv[argv.indexOf("--top") + 1]) || 25;
  if (argv.includes("--cliente")) mainCliente(CHECK, TOP, argv.includes("--foto"));
  else mainCore(CHECK, TOP);
}

if (process.argv[1]?.endsWith("crap-score.ts")) main();
