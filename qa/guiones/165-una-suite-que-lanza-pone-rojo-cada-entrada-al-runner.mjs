/** UNA SUITE QUE LANZA PONE ROJO EL RUNNER, POR TODAS SUS FORMAS, Y SE SABE
 *  QUÉ ENTRADAS AL RUNNER SIGUEN CIEGAS (#697).
 *
 *  El hecho: `node --test` v24.11.1 sale con 0 cuando el CUERPO de un
 *  `describe` lanza —la suite desaparece del resumen (`ℹ tests 0 · fail 0`) y
 *  el build queda verde—. Lo arregla el reporter
 *  `nefan-core/test/la-suite-que-falla-pone-rojo.ts` en tres entradas:
 *  `scripts.test`, `scripts.coverage` y el `corre()` de
 *  `qa/contrato-candados-en-negativo.mjs`. El test hermano
 *  (`test/una-suite-que-falla-pone-rojo.test.ts`) canda las dos de npm con UNA
 *  forma del fallo (un `JSON.parse` síncrono). Esto es la QA de la tanda AN
 *  (2026-09-23) en ejecutable, en dos mitades:
 *
 *  1. EL MECANISMO POR FORMAS. Seis maneras de que una suite falle por sí
 *     misma que Node deja MUDAS (medido: exit 0 sin reporter): `throw`
 *     síncrono, `describe` async que rechaza, `throw` de un STRING (no un
 *     Error), un `describe` anidado que lanza dentro de uno verde, un hook
 *     `after` que lanza —éste no está en el issue y también era verde—, y un
 *     `describe` sin ningún `it`. Cada una corre por la línea REAL de
 *     `scripts.test` (la de `package.json`, con el glob sustituido) y tiene que
 *     salir ≠ 0 y NOMBRADA. La misma línea SIN el reporter se MIDE y se dice
 *     con la versión de Node, sin afirmarla: Node lo arregló en v24.15.0
 *     (24.11.1–24.14.1 salen 0, 24.15.0–24.20.0 salen 1, binarios oficiales,
 *     2026-09-23), la máquina de desarrollo corre 24.11.1 y CI la última 24, y
 *     afirmar «Node las deja mudas» ponía CI rojo por la versión. Y el
 *     `before` que lanza, que Node SÍ cuenta (el issue lo dice), va como
 *     control: rojo con y sin reporter.
 *
 *  2. EL PADRÓN DE ENTRADAS AL RUNNER. Un censo textual de toda invocación de
 *     `node --test` en el árbol (los `package.json` de los tres paquetes,
 *     `qa/**.mjs`, `nefan-core/scripts/*.ts`, el plan de mutación y `ci.yml`),
 *     clasificada: CON reporter (las tres del alcance), AGUJERO CONOCIDO (una
 *     invocación sin él: hoy siete, empezando por el `npm test` de
 *     `nefan-html`, que el job `nefan-html` de CI corre sobre suites con
 *     `describe`) y NO-INVOCACIÓN (un predicado que compara con la cadena). Es
 *     el molde del 151: la totalidad exige que cada hallazgo del censo esté
 *     clasificado —una entrada NUEVA al runner sin reporter sale roja al
 *     nacer—, y cada agujero conocido se pone rojo con «YA NO ES UN AGUJERO»
 *     el día que alguien lo cierre, para subirlo a la lista de los cubiertos.
 *
 *  LO QUE NO MIRA: `scripts.coverage` por formas (el test hermano la cubre con
 *  una y cuesta un proceso instrumentado por forma); si `ci.yml` invoca cada
 *  script (lo lee como texto: `npm run coverage` y `npm test` tienen que estar);
 *  ni la batería de mutación en marcha (`tap-runner`), que es una de las
 *  entradas del padrón y se declara, no se corre.
 *
 *  Cero créditos: no abre partida ni página. Escribe sus fixtures en un
 *  temporal del sistema (nunca en el árbol), lo borra en `finally`, y no toca
 *  ningún fichero del repo. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** El guardarraíl de gasto: corre `node --test` sobre fixtures de un temporal;
 *  ni partida ni motor. */
export const sinMotor = "corre node --test sobre fixtures temporales y lee ficheros del árbol; no abre partida ni habla con el motor";
/** Ni página (#655): el runner de tests y el disco. */
export const sinNavegador = "mide el código de salida de node --test y censa invocaciones en el árbol; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const GLOB = "test/*.test.ts";
const REPORTER = "--test-reporter=./test/la-suite-que-falla-pone-rojo.ts --test-reporter-destination=stdout";
const PREFIJO = "✖ suite que falla:";

// ── 1. las formas ─────────────────────────────────────────────────────────
/** Cada forma: nombre de fichero, nombre de la suite (lo que el reporter tiene
 *  que imprimir) y el cuerpo. Las seis MUDAS salen 0 sin el reporter; el
 *  `before` es el control que Node sí cuenta. */
const MUDAS = [
  ["throw-sincrono", "throw síncrono en el cuerpo", `describe("throw síncrono en el cuerpo", () => { JSON.parse("{roto"); it("no llega", () => {}); });`],
  ["async-rechaza", "describe async que rechaza", `describe("describe async que rechaza", async () => { await Promise.resolve(); throw new Error("async roto"); });`],
  ["throw-string", "throw de un string", `describe("throw de un string", () => { throw "cadena"; });`],
  ["anidado", "hijo que lanza", `describe("padre verde", () => { it("verde del padre", () => {}); describe("hijo que lanza", () => { JSON.parse("{roto"); it("no llega", () => {}); }); });`],
  ["after-lanza", "after que lanza", `describe("after que lanza", () => { after(() => { throw new Error("after roto"); }); it("verde", () => {}); });`],
  ["sin-it", "describe sin ningún it que lanza", `describe("describe sin ningún it que lanza", () => { throw new Error("sin hijos"); });`],
];
const CONTROL_ROJO = ["before-lanza", "before que lanza", `describe("before que lanza", () => { before(() => { JSON.parse("{roto"); }); it("no corre", () => {}); });`];
const CONTROL_VERDE = ["verde", "verde", `describe("verde", () => { it("pasa", () => {}); });`];

const scripts = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")).scripts;

/** La línea REAL de `scripts.test` con el glob sustituido por la fixture, como
 *  la correría npm (`sh -c`), a concurrencia 1 y sin `NODE_TEST_CONTEXT`: si
 *  este guion corriera desde dentro de un `node --test`, el hijo se portaría
 *  como hijo y no pasaría por los reporters de su línea. */
function corre(linea, fixture) {
  const env = { ...process.env, NEFAN_TEST_CONCURRENCY: "1" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync("sh", ["-c", linea.replace(GLOB, fixture)], { cwd: CORE, encoding: "utf8", env, timeout: 120000 });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /^ℹ fail (\d+)$/m.exec(salida);
  return { status: r.status, fallos: m ? Number(m[1]) : -1, nombrada: salida.includes(PREFIJO), salida };
}

// ── 2. el padrón de entradas al runner ────────────────────────────────────
/** `--test` como FLAG suelto (no `--test-reporter`, no `--test-only`): en una
 *  línea de script, en un argv de `spawnSync`, en un array JSON. */
const ES_FLAG = /(^|[\s"'`[,=])--test(?=[\s"'`,\]]|$)/;
/** Prosa que no cuenta: comentarios y el `_comment` de los JSON de contrato. */
const ES_PROSA = /^(\*|\/\/|#|\/\*|"_comment")/;

const CON_REPORTER = "con reporter";
const AGUJERO = "agujero conocido";
const PREDICADO = "no es una invocación";
/** fichero relativo a la raíz · trozo que identifica la línea · clase · por qué. */
const PADRON = [
  ["nefan-core/package.json", '"test":', CON_REPORTER, "npm test (verify)"],
  ["nefan-core/package.json", '"coverage":', CON_REPORTER, "npm run coverage (lo que corre el job nefan-core de CI)"],
  ["qa/contrato-candados-en-negativo.mjs", 'spawnSync("node", ["--import", "tsx", "--test"', CON_REPORTER, "corre() del arnés de sabotajes de contrato"],
  ["nefan-html/package.json", '"test":', AGUJERO, "npm test del cliente: el job nefan-html de CI lo corre sobre suites con describe, sin reporter"],
  ["nefan-core/data/contract/mutation-targets.json", '"--test"', AGUJERO, "node_args del plan de mutación (tap-runner, --test-isolation=none): un mutante que haga lanzar un describe sale superviviente falso"],
  ["qa/mutacion-candados-en-negativo.mjs", 'spawnSync("node", ["--import", "tsx", "--test"', AGUJERO, "decide por `ℹ fail N`, sin reporter ni status: la misma ceguera que tenía el arnés de contrato"],
  ["qa/mutacion-reparto-en-lotes.mjs", '["--import", "tsx", "--test"', AGUJERO, "decide por status, sin reporter"],
  ["qa/guiones/151-el-candado-del-prefijo-puede-ponerse-rojo.mjs", 'spawnSync("node", ["--import", "tsx", "--test"', AGUJERO, "corre un candado en subproceso sin reporter"],
  ["qa/guiones/152-el-padron-de-clientes-ws-puede-ponerse-rojo.mjs", 'spawnSync("npx", ["tsx", "--test"', AGUJERO, "corre un candado en subproceso sin reporter"],
  ["nefan-core/scripts/paso-c-ab.ts", "COMANDO_A", AGUJERO, "bench A/B de la mutación, sin reporter"],
  ["nefan-core/scripts/mutation-plan.ts", 'a === "--test"', PREDICADO, "compara node_args con la cadena; no lanza nada (dos veces)"],
];

/** El conjunto que se barre. Los tests (`nefan-core/test/**`) NO entran: hablan
 *  de `node --test` en prosa y en asertos, y los que lo invocan de verdad son
 *  el hermano de este guion y los que este padrón ya cubre por sus scripts. */
function ficherosBarridos() {
  const lista = [
    "nefan-core/package.json",
    "nefan-html/package.json",
    "narrative-mcp/package.json",
    "nefan-core/data/contract/mutation-targets.json",
    ".github/workflows/ci.yml",
  ];
  // Este guion no se barre a sí mismo: su padrón cita los trozos con `--test`.
  const yo = basename(fileURLToPath(import.meta.url));
  for (const d of ["qa", "qa/lib", "qa/guiones"]) {
    for (const f of readdirSync(join(RAIZ, d))) if (f.endsWith(".mjs") && f !== yo) lista.push(`${d}/${f}`);
  }
  for (const f of readdirSync(join(CORE, "scripts"))) if (f.endsWith(".ts")) lista.push(`nefan-core/scripts/${f}`);
  return lista;
}

/** Cada línea de código (no prosa) con `--test` como flag, con una ventana de
 *  tres líneas por delante: en el arnés el reporter va en la línea SIGUIENTE al
 *  `--test`. */
function censo() {
  const hallazgos = [];
  for (const rel of ficherosBarridos()) {
    const lineas = readFileSync(join(RAIZ, rel), "utf8").split("\n");
    lineas.forEach((l, i) => {
      if (!ES_PROSA.test(l.trim()) && ES_FLAG.test(l)) {
        hallazgos.push({ rel, linea: i + 1, texto: l.trim(), ventana: lineas.slice(i, i + 3).join("\n") });
      }
    });
  }
  return hallazgos;
}

export default async function (ctx) {
  ctx.expect(
    "scripts.test de nefan-core nombra el glob una vez y lleva el reporter",
    typeof scripts.test === "string" && scripts.test.split(GLOB).length === 2 && scripts.test.includes(REPORTER),
    `scripts.test = ${JSON.stringify(scripts.test)}`,
  );

  // ── 1. las formas, sobre fixtures en un temporal ───────────────────────
  const dir = mkdtempSync(join(tmpdir(), "nefan-165-"));
  try {
    const cabecera = `import { describe, it, before, after } from "node:test";\n`;
    const ruta = ([fichero, , cuerpo]) => {
      const p = join(dir, `${fichero}.mjs`);
      writeFileSync(p, cabecera + cuerpo + "\n");
      return p;
    };

    const verde = corre(scripts.test, ruta(CONTROL_VERDE));
    ctx.expect(
      "control: una suite verde sale 0 por la línea de npm test y el reporter no la nombra",
      verde.status === 0 && verde.fallos === 0 && !verde.nombrada,
      `EXIT ${verde.status} · fail ${verde.fallos} · nombrada ${verde.nombrada}`,
    );

    const sinReporter = scripts.test.replace(REPORTER, "");
    const control = corre(scripts.test, ruta(CONTROL_ROJO));
    const controlSin = corre(sinReporter, ruta(CONTROL_ROJO));
    ctx.expect(
      "control: un `before` que lanza ya sale ≠ 0 sin el reporter (Node lo cuenta) y sigue ≠ 0 con él",
      controlSin.status !== 0 && control.status !== 0,
      `sin reporter EXIT ${controlSin.status} · con reporter EXIT ${control.status}`,
    );

    const cuentaNode = [];
    for (const forma of MUDAS) {
      const [, suite] = forma;
      const p = ruta(forma);
      const con = corre(scripts.test, p);
      ctx.expect(
        `forma «${suite}»: por la línea de npm test sale ≠ 0 y el reporter la nombra`,
        con.status !== 0 && con.salida.includes(`${PREFIJO} ${suite}`),
        `EXIT ${con.status} · fail ${con.fallos} · nombrada ${con.nombrada}\n${con.salida.slice(-600)}`,
      );
      const sin = corre(sinReporter, p);
      ctx.log(`  · «${suite}»: con reporter EXIT ${con.status} (fail ${con.fallos}) · sin reporter EXIT ${sin.status} (fail ${sin.fallos})`);
      if (sin.status !== 0) cuentaNode.push(`${suite} (EXIT ${sin.status})`);
    }
    // Un HECHO DE LA VERSIÓN, no un invariante: se nombra y no se afirma.
    const version = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? "¿?";
    ctx.log(
      cuentaNode.length === 0
        ? `  · Node ${version} deja MUDAS las seis formas sin el reporter: el reporter es lo único que las pone rojas`
        : `  ⚠ Node ${version} ya cuenta ${cuentaNode.length} de 6 sin el reporter (${cuentaNode.join(" | ")}): ahí el reporter es redundante (Node lo arregla en v24.15.0)`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── 2. el padrón ───────────────────────────────────────────────────────
  const hallazgos = censo();
  ctx.log(`  · censo: ${hallazgos.length} invocación(es) de --test en ${ficherosBarridos().length} ficheros`);
  ctx.expect(
    "el censo encuentra sitios: la totalidad tiene sujeto",
    hallazgos.length >= PADRON.length,
    `${hallazgos.length} hallazgo(s) para un padrón de ${PADRON.length}`,
  );

  const sinClasificar = [];
  const vistos = new Map();
  for (const h of hallazgos) {
    const fila = PADRON.find(([rel, trozo]) => rel === h.rel && h.texto.includes(trozo));
    if (!fila) sinClasificar.push(`${h.rel}:${h.linea}: ${h.texto.slice(0, 90)}`);
    else vistos.set(fila, [...(vistos.get(fila) ?? []), h]);
  }
  ctx.expect(
    "toda invocación de --test del árbol está clasificada en el padrón (una entrada NUEVA al runner sin reporter no nace en silencio)",
    sinClasificar.length === 0,
    `sin clasificar:\n  ${sinClasificar.join("\n  ")}`,
  );

  for (const fila of PADRON) {
    const [rel, trozo, clase, porQue] = fila;
    const h = vistos.get(fila) ?? [];
    const esperados = clase === PREDICADO ? 2 : 1;
    ctx.expect(
      `el padrón sigue apuntando a un sitio vivo: ${rel} · «${trozo}»`,
      h.length === esperados,
      `${h.length} hallazgo(s), se esperaban ${esperados}: el sitio se movió o se borró — actualiza el padrón`,
    );
    const llevaReporter = h.some((x) => x.ventana.includes("la-suite-que-falla-pone-rojo"));
    if (clase === CON_REPORTER) {
      ctx.expect(`${rel} · ${porQue}: lleva el reporter`, llevaReporter, h.map((x) => x.ventana).join("\n"));
    } else if (clase === AGUJERO) {
      ctx.expect(
        `AGUJERO CONOCIDO · ${rel}: ${porQue}`,
        !llevaReporter,
        `YA NO ES UN AGUJERO: ${rel} lleva el reporter — súbelo a CON_REPORTER en este padrón`,
      );
      ctx.log(`      ↳ hoy sin reporter: ${rel}:${h.map((x) => x.linea).join(",")}`);
    } else {
      ctx.expect(`${rel} · ${porQue}: no invoca nada`, !llevaReporter && h.every((x) => /===|startsWith/.test(x.texto)), h.map((x) => x.texto).join("\n"));
    }
  }

  const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
  ctx.expect(
    "ci.yml corre `npm run coverage` (job nefan-core) y `npm test` (job nefan-html): las dos líneas de package.json que el padrón juzga",
    /^\s+- run: npm run coverage\s*$/m.test(ci) && /^\s+- run: npm test\s*$/m.test(ci),
    "si CI cambia cómo invoca el runner, el padrón juzga una línea que nadie corre",
  );
}
