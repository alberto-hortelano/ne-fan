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

function main(): void {
  const argv = process.argv.slice(2);
  const CHECK = argv.includes("--check");
  const TOP = Number(argv[argv.indexOf("--top") + 1]) || 25;

  if (!existsSync(LCOV)) {
    console.error(`No hay ${LCOV}.\nGenera la cobertura primero:  npm run coverage`);
    process.exit(2);
  }
  const porFichero = lineHitsFromLcov(readFileSync(LCOV, "utf-8"));

  const filas: (FuncInfo & { file: string; coverage: number; crap: number })[] = [];
  for (const [file, hits] of porFichero) {
    // El lcov recoge todo lo que se cargó, incluidos los .js de dist/ (los
    // carga narrative-mcp por su `exports`) y ficheros de otros paquetes. La
    // deuda se mide sobre el FUENTE de este paquete y nada más.
    if (!MEDIDOS.some((d) => file.startsWith(d))) continue;
    const abs = join(coreRoot, file);
    if (!existsSync(abs)) continue;
    for (const fn of functionsOf(readFileSync(abs, "utf-8"), file)) {
      let total = 0;
      let cubiertas = 0;
      for (let l = fn.startLine; l <= fn.endLine; l++) {
        const h = hits.get(l);
        if (h === undefined) continue; // línea no ejecutable
        total++;
        if (h > 0) cubiertas++;
      }
      if (total === 0) continue;
      const coverage = cubiertas / total;
      filas.push({ ...fn, file, coverage, crap: crap(fn.complexity, coverage) });
    }
  }
  filas.sort((a, b) => b.crap - a.crap);

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
  // Cobertura global de líneas, sobre los mismos árboles medidos.
  let lineasTotales = 0;
  let lineasCubiertas = 0;
  for (const [file, hits] of porFichero) {
    if (!MEDIDOS.some((d) => file.startsWith(d))) continue;
    for (const h of hits.values()) {
      lineasTotales++;
      if (h > 0) lineasCubiertas++;
    }
  }
  const cobGlobal = lineasTotales === 0 ? 0 : (lineasCubiertas / lineasTotales) * 100;
  console.log(
    `${filas.length} funciones medidas · cobertura de líneas ${cobGlobal.toFixed(1)}% · ` +
      `complejidad máxima ${Math.max(...filas.map((r) => r.complexity))}`,
  );

  const umbral = JSON.parse(readFileSync(THRESHOLDS, "utf-8")) as {
    crap: { max: number; objetivo: number };
    cobertura_lineas: { min: number };
  };
  const peores = filas.filter((r) => r.crap > umbral.crap.max);
  const sobreObjetivo = filas.filter((r) => r.crap > umbral.crap.objetivo);
  console.log(
    `\nTope (no empeorar): CRAP ≤ ${umbral.crap.max} — ${peores.length} por encima.` +
      `\nObjetivo a medio plazo: CRAP ≤ ${umbral.crap.objetivo} — ${sobreObjetivo.length} por encima.` +
      `\nCobertura de líneas mínima: ${umbral.cobertura_lineas.min}% — ahora ${cobGlobal.toFixed(1)}%.`,
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
      `la cobertura de líneas bajó a ${cobGlobal.toFixed(1)}% (mínimo ${umbral.cobertura_lineas.min}%)`,
    );
  }
  if (fallos.length > 0) {
    console.error(`\n✘ ${fallos.join("\n✘ ")}`);
    process.exit(1);
  }
  console.log("\n✔ dentro de los umbrales");
}

if (process.argv[1]?.endsWith("crap-score.ts")) main();
