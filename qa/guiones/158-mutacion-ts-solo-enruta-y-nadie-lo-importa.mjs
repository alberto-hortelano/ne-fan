/** `scripts/mutacion.ts` SOLO ENRUTA, y nadie lo importa (#605, QA de la tanda AC).
 *
 *  POR QUÉ EXISTE. #605 partió `nefan-core/scripts/mutacion.ts` (1.760 líneas,
 *  diez verbos) por CIERRE DE LLAMADAS en seis trozos `mutacion-<cierre>.ts`, y
 *  dejó en el fichero del nombre la tabla `VERBOS` y `main()`. Dos cosas de ese
 *  corte no las mide ninguna herramienta y las dos se deshacen en verde:
 *
 *   1. **Que el fichero siga siendo solo enrutado.** El monolito creció +1.022
 *      líneas en 24 días a razón de un verbo o un guardia por commit, y el
 *      camino de menor resistencia para el siguiente verbo es escribirlo en
 *      `mutacion.ts` otra vez. `scripts/` está fuera de CRAP y de mutación por
 *      perímetro, así que `npm run deuda` no lo vería nunca.
 *   2. **Que nadie lo importe.** Con el corte se retiró el guardia
 *      `if (process.argv[1]?.endsWith("mutacion.ts")) main()` —existía porque
 *      `mutate.ts`, `deuda.ts` y un test importaban de ahí, y hoy los tres
 *      importan de `mutacion-repo.ts`— y `main();` va a secas. Es correcto para
 *      el CLI y es una trampa para el primero que vuelva a importarlo: el
 *      import EJECUTA un verbo con el `argv` de quien importa (un test: imprime
 *      el uso y deja `exitCode = 2`). `tsc` no lo ve y lint tampoco.
 *
 *  QUÉ AFIRMA, leyendo el ÁRBOL (TypeScript de `nefan-core`) y no el texto:
 *   A. en `mutacion.ts` la única función declarada es `main`, la única
 *      constante es `VERBOS`, no hay `export`, y la última sentencia es la
 *      llamada `main();` sin guardia (si alguien vuelve a poner un guardia, que
 *      lo diga: cambiaría la regla 2);
 *   B. cada verbo de `VERBOS` es un identificador IMPORTADO de un
 *      `./mutacion-*.js` — ningún verbo tiene su cuerpo aquí;
 *   C. ningún fichero del repo (`git ls-files`, `.ts`/`.mts`/`.js`/`.mjs`/`.cjs`)
 *      importa `mutacion.js`/`mutacion.ts` por ninguna de las tres puertas
 *      (`from`, `import "…"`, `import()`/`require()`); `mutacion-repo.js` y los
 *      demás trozos no cuentan, y es a propósito;
 *   D. `package.json` sigue entrando por `scripts/mutacion.ts`: si el enrutado
 *      se mueve, esto se entera antes que el workflow.
 *
 *  PROBADO EN NEGATIVO por QA sobre el árbol de la tanda, un sabotaje por vez y
 *  restaurado con `git checkout`: una `function extra() {}` añadida a
 *  `mutacion.ts` → rojo en A nombrándola; una sentencia de import del módulo
 *  (sin escribirla aquí: ver el párrafo de abajo) añadida a `scripts/deuda.ts`
 *  → rojo en C nombrando el fichero y la línea.
 *
 *  POR QUÉ EL BLOQUE C MIRA EL ÁRBOL Y NO EL TEXTO, con su número. La primera
 *  versión casaba los imports con una expresión regular sobre el fuente, y eso
 *  la hacía ciega en una dirección y MENTIROSA en la otra: en cuanto el guion se
 *  commiteó, `git ls-files` empezó a incluirlo y el censo se acusó A SÍ MISMO —
 *  esta misma cabecera citaba la sentencia del sabotaje entre comillas, y el
 *  guion la contó como un importador (rojo en C, `…/158-…mjs:37`). Era verde en
 *  el worktree de QA solo porque allí el fichero todavía no estaba en el índice.
 *  Un censo por grafía no distingue una PROSA de una sentencia; el árbol sí. Así
 *  que C parsea cada fichero con el mismo TypeScript y cuenta NODOS: `import`,
 *  `export … from`, `import()` y `require()`. La grafía se queda como criba
 *  barata para no parsear 700 ficheros que no nombran nada, nunca como veredicto.
 *
 *  LO QUE NO VE, dicho para que nadie lo cuente de más: no mira que los seis
 *  trozos sigan disjuntos por cierre (que `mutacion-pedir.ts` no importe de
 *  `mutacion-reparto.ts`, por ejemplo) ni que la huella tenga un solo escritor;
 *  eso lo apuntó el plan de #605 como reglas de `arch-rules.json` pendientes.
 *  Tampoco mira las CONDUCTAS de los verbos: eso es de
 *  `qa/mutacion-cableado-en-negativo.mjs` y `qa/mutacion-reparto-en-lotes.mjs`.
 *
 *  Cero créditos, cero servicios: lee ficheros y pregunta a git por la lista.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const sinMotor = "solo lee scripts/mutacion.ts, package.json y la lista de ficheros de git; no arranca partida ni habla con el motor";
export const sinNavegador = "afirma sobre el árbol sintáctico de un script de nefan-core y sobre los imports del repo; no hay cliente que conducir";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(raiz, "nefan-core");
const MUTACION = "scripts/mutacion.ts";

/** El TypeScript con el que `nefan-core` typechequea: mismo parser, mismo árbol. */
async function cargarTs() {
  const mod = await import(join(CORE, "node_modules", "typescript", "lib", "typescript.js"));
  return mod.default ?? mod;
}

/** Los ficheros del repo que pueden importar algo, según git (no hay `dist/` ni `node_modules/`). */
function ficherosQueImportan() {
  const salida = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"], { cwd: raiz, encoding: "utf8" });
  return salida.split("\0").filter((f) => f && !f.startsWith("archivo/") && !f.startsWith("docs/"));
}

/** ¿Este especificador apunta a `scripts/mutacion.ts`? Se compara el ÚLTIMO segmento sin
 *  extensión, así que `mutacion-repo.js` y los demás trozos NO casan, que es a propósito. */
const apuntaAMutacion = (espec) => /(?:^|\/)mutacion(?:\.[cm]?[jt]s)?$/.test(espec);

/** Los especificadores que IMPORTA un fuente, contando NODOS del árbol y no grafías: las cuatro
 *  puertas son `import … from`, `import "…"`, `export … from` e `import()`/`require()`. Devuelve
 *  `[{espec, linea}]`. Un fichero que no parsea se devuelve como tal para decirlo en voz alta en
 *  vez de contarlo como «no importa nada». */
function importesDe(ts, ruta, fuente) {
  const jsish = /\.[cm]?js$/.test(ruta);
  const sf = ts.createSourceFile(ruta, fuente, ts.ScriptTarget.ES2022, true, jsish ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const salida = [];
  const anota = (nodo, espec) => {
    if (typeof espec === "string") salida.push({ espec, linea: sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1 });
  };
  const anda = (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      anota(n, n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n)) {
      const esImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const esRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const arg = n.arguments[0];
      if ((esImport || esRequire) && arg && ts.isStringLiteral(arg)) anota(n, arg.text);
    }
    ts.forEachChild(n, anda);
  };
  anda(sf);
  return salida;
}

export default async function (ctx) {
  const ts = await cargarTs();
  const fuente = readFileSync(join(CORE, MUTACION), "utf8");
  const sf = ts.createSourceFile(MUTACION, fuente, ts.ScriptTarget.ES2022, true);

  // ── A · solo enrutado ──────────────────────────────────────────────────────
  const funciones = [];
  const constantes = [];
  const exportadas = [];
  const otras = [];
  const importadosDeTrozos = new Map(); // identificador → especificador
  let ultima = null;
  for (const st of sf.statements) {
    const texto = fuente.slice(st.getStart(sf), st.end);
    if (ts.isImportDeclaration(st)) {
      const desde = st.moduleSpecifier.text;
      const nombres = st.importClause?.namedBindings;
      if (nombres && ts.isNamedImports(nombres)) for (const e of nombres.elements) importadosDeTrozos.set(e.name.text, desde);
      continue;
    }
    if (/^export\b/.test(texto)) exportadas.push(texto.split("\n")[0]);
    if (ts.isFunctionDeclaration(st)) funciones.push(st.name?.text ?? "(anónima)");
    else if (ts.isVariableStatement(st)) constantes.push(...st.declarationList.declarations.map((d) => d.name.getText(sf)));
    else if (ts.isExpressionStatement(st)) { /* la llamada final */ }
    else otras.push(`${ts.SyntaxKind[st.kind]}: ${texto.split("\n")[0].slice(0, 60)}`);
    ultima = st;
  }
  ctx.log(`  · ${MUTACION}: ${sf.statements.length} sentencias, funciones=[${funciones}] constantes=[${constantes}] importa de ${new Set(importadosDeTrozos.values()).size} módulos`);

  ctx.expect("A · la única función declarada en mutacion.ts es `main`", funciones.length === 1 && funciones[0] === "main", `declara: [${funciones.join(", ")}]`);
  ctx.expect("A · la única constante es `VERBOS`", constantes.length === 1 && constantes[0] === "VERBOS", `declara: [${constantes.join(", ")}]`);
  ctx.expect("A · no exporta nada: es una entrada, no un módulo", exportadas.length === 0, exportadas.join(" | "));
  ctx.expect("A · no hay clases, tipos, bucles ni condicionales sueltos", otras.length === 0, otras.join(" | "));
  const ultimaEsMain = ultima !== null && ts.isExpressionStatement(ultima) && ultima.expression.getText(sf) === "main()";
  ctx.expect("A · la última sentencia es `main();` a secas, sin guardia", ultimaEsMain, ultima ? fuente.slice(ultima.getStart(sf), ultima.end).split("\n")[0] : "(vacío)");

  // ── B · cada verbo viene de un trozo ───────────────────────────────────────
  const verbos = [];
  const verbosConCuerpoAqui = [];
  const verbosDeOtroSitio = [];
  const decl = sf.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(sf) === "VERBOS"));
  const init = decl?.declarationList.declarations.find((d) => d.name.getText(sf) === "VERBOS")?.initializer;
  if (init && ts.isObjectLiteralExpression(init)) {
    for (const p of init.properties) {
      const nombre = p.name?.getText(sf) ?? "?";
      verbos.push(nombre);
      if (!ts.isShorthandPropertyAssignment(p)) { verbosConCuerpoAqui.push(nombre); continue; }
      const desde = importadosDeTrozos.get(nombre);
      if (!desde || !/^\.\/mutacion-[a-z]+\.js$/.test(desde)) verbosDeOtroSitio.push(`${nombre} ← ${desde ?? "(local)"}`);
    }
  }
  ctx.log(`  · VERBOS: ${verbos.join(" ")}`);
  ctx.expect("B · `VERBOS` es un objeto con al menos los diez verbos del ciclo", verbos.length >= 10, `hay ${verbos.length}`);
  ctx.expect("B · ningún verbo lleva su cuerpo en mutacion.ts (todos son identificadores)", verbosConCuerpoAqui.length === 0, verbosConCuerpoAqui.join(", "));
  ctx.expect("B · cada verbo está importado de un `./mutacion-<cierre>.js`", verbosDeOtroSitio.length === 0, verbosDeOtroSitio.join(", "));

  // ── C · nadie lo importa ───────────────────────────────────────────────────
  const ficheros = ficherosQueImportan();
  const importadores = [];
  const ilegibles = [];
  let parseados = 0;
  for (const f of ficheros) {
    const src = readFileSync(join(raiz, f), "utf8");
    // Criba barata: si el fuente no nombra `mutacion` ni de lejos, no hay nada que parsear.
    // Es una criba, no el veredicto — el veredicto lo da el árbol, unas líneas más abajo.
    if (!src.includes("mutacion")) continue;
    parseados += 1;
    let importes;
    try {
      importes = importesDe(ts, f, src);
    } catch (err) {
      ilegibles.push(`${f} (${err.message.split("\n")[0]})`);
      continue;
    }
    for (const { espec, linea } of importes) {
      if (apuntaAMutacion(espec)) importadores.push(`${f}:${linea} → ${espec}`);
    }
  }
  ctx.log(`  · ${ficheros.length} ficheros de git ls-files; ${parseados} nombran \`mutacion\` y se parsearon`);
  ctx.expect("C · todo lo que se cribó se pudo parsear (un fuente ilegible no es «no importa nada»)", ilegibles.length === 0, ilegibles.join(" | "));
  ctx.expect("C · hay ficheros que mirar (la lista de git no vino vacía)", ficheros.length > 100, `${ficheros.length}`);
  ctx.expect(
    "C · nadie importa `mutacion.js`/`mutacion.ts`: importarlo ejecutaría `main()` con el argv ajeno",
    importadores.length === 0,
    importadores.join(" | "),
  );

  // ── D · la entrada del npm script ─────────────────────────────────────────
  const pkg = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8"));
  ctx.expect("D · `npm run mutacion` entra por scripts/mutacion.ts", pkg.scripts?.mutacion === `tsx ${MUTACION}`, String(pkg.scripts?.mutacion));
}
