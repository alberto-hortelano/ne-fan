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
 *  Uso:
 *    npm run coverage && npm run crap        # tabla
 *    npm run crap -- --check                 # falla si algo supera el umbral
 *    npm run crap -- --top 40                # más filas
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const LCOV = join(coreRoot, "coverage", "lcov.info");
const THRESHOLDS = join(coreRoot, "data", "contract", "quality-thresholds.json");
/** Árboles fuente de este paquete: lo demás que aparezca en el lcov (dist/,
 *  otros paquetes) no es deuda nuestra. */
const MEDIDOS = ["src/", "bridge/", "services/"];

export interface FuncInfo {
  name: string;
  startLine: number;
  endLine: number;
  complexity: number;
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
  return "(anónima)";
}

/** Todas las funciones del fichero con su rango de líneas (1-based) y su
 *  complejidad. */
export function functionsOf(text: string, fileName = "x.ts"): FuncInfo[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const out: FuncInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node.getSourceFile()) {
      const body = (node as ts.FunctionLikeDeclaration).body;
      if (body) {
        out.push({
          name: nameOf(node),
          startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          complexity: complexityOf(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
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

export interface Thresholds {
  crap: { max: number; objetivo: number };
  cobertura_lineas: { min: number };
}

export function readThresholds(): Thresholds {
  return JSON.parse(readFileSync(THRESHOLDS, "utf-8")) as Thresholds;
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

/** Fila por función medida, ordenada de peor a mejor CRAP, más la cobertura
 *  global de líneas sobre los mismos árboles. Lo comparten la tabla (`--check`)
 *  y la cola de deuda (`scripts/deuda.ts`): una sola definición de qué se mide.
 *  Falta el lcov → error duro, no una tabla vacía que parece "cero deuda". */
export function crapRows(): { filas: CrapRow[]; cobGlobal: number; lineasMedidas: number } {
  if (!existsSync(LCOV)) {
    throw new Error(`No hay ${LCOV}.\nGenera la cobertura primero:  npm run coverage`);
  }
  const porFichero = lineHitsFromLcov(readFileSync(LCOV, "utf-8"));

  const filas: CrapRow[] = [];
  let lineasTotales = 0;
  let lineasCubiertas = 0;
  const sinFuente: string[] = [];
  for (const [file, hits] of porFichero) {
    // El lcov recoge todo lo que se cargó, incluidos los .js de dist/ (los
    // carga narrative-mcp por su `exports`) y ficheros de otros paquetes. La
    // deuda se mide sobre el FUENTE de este paquete y nada más.
    if (!MEDIDOS.some((d) => file.startsWith(d))) continue;
    const abs = join(coreRoot, file);
    // El fuente NO es opcional: sin él no se puede decir qué línea emite código
    // y el fichero entraría con sus comentarios en el denominador. Que falte
    // significa que el lcov es de otro árbol, así que se para.
    if (!existsSync(abs)) {
      sinFuente.push(file);
      continue;
    }
    const texto = readFileSync(abs, "utf-8");
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
  }
  if (sinFuente.length > 0) {
    throw new Error(
      `El lcov mide ${sinFuente.length} fichero(s) que ya no están en el árbol:\n` +
        sinFuente.map((f) => `   ${f}`).join("\n") +
        `\nEs una medida de otra revisión. Regenérala:  npm run coverage`,
    );
  }
  filas.sort((a, b) => b.crap - a.crap);
  return {
    filas,
    cobGlobal: lineasTotales === 0 ? 0 : (lineasCubiertas / lineasTotales) * 100,
    lineasMedidas: lineasTotales,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const CHECK = argv.includes("--check");
  const TOP = Number(argv[argv.indexOf("--top") + 1]) || 25;

  let medida: ReturnType<typeof crapRows>;
  try {
    medida = crapRows();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const { filas, cobGlobal, lineasMedidas } = medida;

  console.log(`\nCRAP = complejidad² · (1−cobertura)³ + complejidad\n`);
  console.log(`${"CRAP".padStart(7)}  ${"cx".padStart(3)}  ${"cob".padStart(5)}  función`);
  console.log("─".repeat(78));
  for (const r of filas.slice(0, TOP)) {
    console.log(
      `${r.crap.toFixed(1).padStart(7)}  ${String(r.complexity).padStart(3)}  ` +
        `${`${(r.coverage * 100).toFixed(0)}%`.padStart(5)}  ${r.name} · ${r.file}:${r.startLine}`,
    );
  }
  console.log("─".repeat(78));
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

  if (!CHECK) return;
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

if (process.argv[1]?.endsWith("crap-score.ts")) main();
