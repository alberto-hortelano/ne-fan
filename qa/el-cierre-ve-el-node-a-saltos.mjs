#!/usr/bin/env node
/** ¿Ve el checker de fronteras un `node:*` que entra en el cliente A SALTOS, a través del core,
 *  con el colector REAL —no con `SourceFile[]` fabricados— y lo dice con el camino entero?
 *
 *  Vive fuera de `qa/guiones/` por lo mismo que `qa/el-borrado-pregunta-a-antes.mjs`: no hay
 *  nada que un jugador pueda mirar; el sujeto es un instrumento (`arch-rules.json` +
 *  `scripts/arch-collect.ts` + `src/contract/arch/{check,cierre}.ts`).
 *
 *  POR QUÉ EXISTE. Hasta #359 la pureza browser-safe del bundle la sostenía una lista negra de
 *  ocho módulos escrita a mano: un módulo nuevo del core con `node:fs` que el cliente alcanzara
 *  pasaba el checker hasta que alguien lo añadiera. Desde #359 se DERIVA del grafo: la regla
 *  `el-cliente-no-alcanza-node-ni-a-traves-del-core` recorre el cierre transitivo de imports
 *  desde `nefan-html/src/**` (alias `@nefan-core/*` leído del tsconfig, relativos, `.js→.ts`,
 *  `index.ts`) y denuncia el `node:*` donde esté, con el camino. Eso cambia la dirección del
 *  riesgo: una lista que no ve algo se ve (falta la entrada); un grafo que no ve algo sale
 *  VERDE sin haber mirado — un alias mal resuelto, una arista que `preProcessFile` no cuenta,
 *  un destino podado en silencio.
 *
 *  CÓMO LO COMPRUEBA, y por qué no es una copia de `test/arch-cierre.test.ts`: la batería
 *  prueba el motor del grafo con imports YA RESUELTOS que ella misma inventa, y
 *  `architecture.test.ts` solo comprueba que el cierre real llega a ≥ 80 ficheros. Aquí se
 *  rompe el árbol DE VERDAD —un `node:fs` escrito en un fichero del core— en un clon superficial
 *  en `qa/.tmp/`, y se le pregunta al mismo `checkArchitecture(archConfig, loadArchFiles())`
 *  que corre `npm test`. Los sujetos se ELIGEN del cierre de hoy —un fichero fuera del
 *  perímetro de `core-puro-sin-node` a dos saltos, otro a tres— para que el guion no caduque
 *  si alguien mueve `rng.ts`.
 *
 *  Nueve bloques:
 *    0 · el árbol intacto: 0 violaciones `error`, y el cierre desde el cliente llega al core
 *    1 · `node:fs` a DOS saltos, fuera del perímetro puro     → SOLO la regla del cierre, con el camino
 *    2 · `node:fs` a TRES saltos                              → ídem, cadena de cuatro ficheros
 *    3 · `export * from` como arista                          → salta (una re-exportación también trae código)
 *    4 · import de DIRECTORIO (`./x` → `x/index.ts`)          → salta
 *    5 · import ROTO (fichero inexistente)                    → salta como «el import está roto: … no existe en disco»
 *    6 · `import("./x.js")` DINÁMICO literal                  → salta (Vite lo mete en un chunk igual)
 *    7 · `node:fs` DIRECTO en un fichero del cliente          → salta la regla del cierre, una sola vez
 *    8 · destino que EXISTE pero ningún root escanea           → salta como «existe pero el checker no lo escanea»
 *        (son dos mensajes distintos a propósito: un typo se arregla en el import, un fichero real
 *        fuera de `scan.roots` se arregla en `arch-rules.json`; QA de #359, hallazgo 6)
 *
 *  Juzga el instrumento del ÁRBOL DE TRABAJO (se copian `scripts/`, `src/contract/arch/`,
 *  `arch-rules.json` y el tsconfig del cliente encima del clon y se sellan en un commit), así
 *  que sirve antes de commitear. Lo que NO ve: un import dinámico con especificador no literal
 *  (`import(join(...))`), que `ts.preProcessFile` no puede ver — y que el cliente no tiene.
 *
 *  NO mide mutación, no arranca servicios, cero créditos. No toca el árbol del repo: todo pasa
 *  en el clon, que se borra.
 *
 *    node qa/el-cierre-ve-el-node-a-saltos.mjs
 *    node qa/el-cierre-ve-el-node-a-saltos.mjs --verboso   # también las violaciones que aprueba
 *
 *  Verde = las ocho respuestas son las esperadas.  Rojo = el grafo deja pasar un `node:*` que
 *  el bundle sí cargaría, o salta donde no debe.  2 = no pude medir.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const TMP = join(raiz, "qa", ".tmp");
const VERBOSO = process.argv.includes("--verboso");
const CLON = join(TMP, `cierre-${process.pid}`);
const CLON_CORE = join(CLON, "nefan-core");
const REGLA = "el-cliente-no-alcanza-node-ni-a-traves-del-core";

function limpiar() {
  rmSync(CLON, { recursive: true, force: true });
}
for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, () => {
    limpiar();
    process.exit(s === "SIGINT" ? 130 : 143);
  });
}
function noPude(msg) {
  console.error(`✘ ${msg}\n  «No pude medir» no es verde.`);
  limpiar();
  process.exit(2);
}

function git(args, cwd = CLON) {
  const r = spawnSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@local", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) noPude(`git ${args.join(" ")} falló (${r.status}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Un `tsx -e` en el nefan-core DEL CLON que devuelve JSON por stdout. */
function enClon(codigo, quien) {
  const r = spawnSync("npx", ["tsx", "-e", codigo], {
    cwd: CLON_CORE,
    encoding: "utf8",
    timeout: 600000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  const salida = `${r.stdout ?? ""}`;
  const i = salida.indexOf("<<<JSON>>>");
  if (i < 0) noPude(`${quien}: el hijo no devolvió JSON.\n${salida}\n${r.stderr ?? ""}`);
  return JSON.parse(salida.slice(i + 10));
}

/** Lo que diría `npm test` (architecture.test.ts) del árbol del clon: las violaciones `error`
 *  del checker real, más el cierre desde el cliente. Es el mismo camino: `loadArchFiles` +
 *  `checkArchitecture(archConfig, files)`. */
function checker() {
  return enClon(
    `import { archConfig, loadArchFiles } from "./scripts/arch-collect.ts";
     import { checkArchitecture, matchesAny } from "./src/contract/arch/check.ts";
     import { cierreDesde } from "./src/contract/arch/cierre.ts";
     const files = loadArchFiles();
     const porRuta = new Map(files.map((f) => [f.path, f]));
     const regla = archConfig.rules.find((r) => r.id === ${JSON.stringify(REGLA)});
     const entradas = files.filter((f) => regla && matchesAny(f.path, regla.files)).map((f) => f.path);
     const padres = regla ? cierreDesde(entradas, porRuta) : new Map();
     const perimetro = archConfig.rules.find((r) => r.id === "core-puro-sin-node").files;
     const cierre = [...padres.keys()].filter((p) => p.startsWith("nefan-core/") && porRuta.has(p));
     const saltos = (p) => { let n = 0; let a = padres.get(p); while (a) { n++; a = padres.get(a.desde); } return n; };
     const fuera = cierre.filter((p) => p.endsWith(".ts") && !matchesAny(p, perimetro)).map((p) => ({ path: p, saltos: saltos(p) }));
     const v = checkArchitecture(archConfig, files).filter((x) => x.severity === "error")
       .map(({ ruleId, path, line, detail }) => ({ ruleId, path, line, detail }));
     console.log("<<<JSON>>>" + JSON.stringify({ tieneRegla: Boolean(regla), cierre: cierre.length, fuera, v }));`,
    "checker",
  );
}

// ── 0 · el clon: HEAD del repo, superficial, con el node_modules de aquí ──────
if (!existsSync(join(CORE, "node_modules", "typescript"))) {
  noPude("no encuentro `typescript` en nefan-core/node_modules — corre `npm ci` en nefan-core.");
}
mkdirSync(TMP, { recursive: true });
rmSync(CLON, { recursive: true, force: true });
mkdirSync(CLON);
git(["init", "-q"]);
git(["fetch", "-q", "--depth", "1", raiz, "HEAD"]);
git(["checkout", "-q", "FETCH_HEAD"]);
symlinkSync(join(CORE, "node_modules"), join(CLON_CORE, "node_modules"));
writeFileSync(join(CLON, ".git", "info", "exclude"), "nefan-core/node_modules\n", { flag: "a" });
// El INSTRUMENTO que se juzga es el del ÁRBOL DE TRABAJO: se copia encima del clon y se sella.
cpSync(join(CORE, "scripts"), join(CLON_CORE, "scripts"), { recursive: true });
cpSync(join(CORE, "src", "contract", "arch"), join(CLON_CORE, "src", "contract", "arch"), {
  recursive: true,
});
cpSync(
  join(CORE, "data", "contract", "arch-rules.json"),
  join(CLON_CORE, "data", "contract", "arch-rules.json"),
);
cpSync(join(raiz, "nefan-html", "tsconfig.json"), join(CLON, "nefan-html", "tsconfig.json"));
git([
  "add",
  "-A",
  "--",
  "nefan-core/scripts",
  "nefan-core/src/contract/arch",
  "nefan-core/data/contract/arch-rules.json",
  "nefan-html/tsconfig.json",
]);
git(["commit", "-q", "--allow-empty", "-m", "instrumento del árbol de trabajo"]);
const BASE = git(["rev-parse", "--short", "HEAD"]);

// ── 1 · el estado limpio y los sujetos ─────────────────────────────────────────
const limpio = checker();
if (!limpio.tieneRegla) noPude(`la regla ${REGLA} no está en arch-rules.json: no hay qué probar.`);
if (limpio.cierre < 80) {
  // No es «no pude medir»: es la dirección peligrosa. Un alias que no se lee o un resolver roto
  // dejan el cierre casi vacío y la regla VERDE sin haber mirado nada.
  console.log(
    `  ✘ 0 · el cierre desde el cliente solo alcanza ${limpio.cierre} ficheros del core (medido al nacer: 82): ¿alias del tsconfig sin leer, resolver roto?`,
  );
  limpiar();
  process.exit(1);
}
const aDos = limpio.fuera.find((f) => f.saltos === 2);
const aTres = limpio.fuera.find((f) => f.saltos === 3);
if (!aDos || !aTres) {
  noPude(
    `no hay un fichero del core FUERA del perímetro puro a dos y a tres saltos del cliente (hay: ${JSON.stringify(limpio.fuera)}): elige otro sujeto.`,
  );
}
console.log(
  `\nEl cierre ve el node a saltos · clon en ${BASE} · cierre ${limpio.cierre} · sujetos: ${aDos.path} (2 saltos), ${aTres.path} (3 saltos)\n`,
);

// ── 2 · los bloques ───────────────────────────────────────────────────────────
const fallos = [];
const soloLaRegla = (v) => v.filter((x) => x.ruleId === REGLA);
const otrasReglas = (v) => v.filter((x) => x.ruleId !== REGLA).map((x) => x.ruleId);
/** El directorio del sujeto a dos saltos: un import relativo (`./qa-x.js`) se resuelve desde ÉL,
 *  así que los ficheros auxiliares se escriben a su lado. */
const junto = (nombre) => `${dirname(aDos.path)}/${nombre}`;
const escribe = (rel, texto) => {
  const abs = join(CLON, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, texto);
};
const añade = (rel, linea) => {
  const abs = join(CLON, rel);
  writeFileSync(abs, `${linea}\n${readFileSync(abs, "utf8")}`);
};

function bloque(n, titulo, preparar, juzgar) {
  git(["reset", "-q", "--hard", BASE]);
  git(["clean", "-qfd", "--", "nefan-core/src", "nefan-html/src"]);
  preparar();
  const r = checker();
  const problemas = juzgar(r);
  const ok = problemas.length === 0;
  console.log(`  ${ok ? "✔" : "✘"} ${n} · ${titulo}`);
  const propias = soloLaRegla(r.v);
  console.log(
    `      → ${r.v.length} violación(es) error; de la regla: ${propias.length}${otrasReglas(r.v).length ? `; otras: ${[...new Set(otrasReglas(r.v))].join(", ")}` : ""}`,
  );
  if (VERBOSO || !ok)
    for (const x of r.v) console.log(`      ${x.ruleId} · ${x.path}:${x.line} — ${x.detail}`);
  for (const p of problemas) console.log(`      ✘ ${p}`);
  if (!ok) fallos.push(`${n} · ${titulo}`);
}

/** Exactamente UNA violación de la regla, en `path`, cuyo detalle acaba en `cola`, y ninguna
 *  otra regla `error` roja. */
function unaSola(r, path, cola, ...mas) {
  const p = [];
  const propias = soloLaRegla(r.v);
  if (propias.length !== 1) p.push(`esperaba 1 violación de ${REGLA}, hay ${propias.length}`);
  const v = propias[0];
  if (v && v.path !== path) p.push(`la violación señala ${v.path}, esperaba ${path}`);
  if (v && !v.detail.endsWith(cola)) p.push(`el detalle no acaba en «${cola}»: ${v.detail}`);
  for (const [re, porque] of mas) if (v && !re.test(v.detail)) p.push(`${porque}: ${v.detail}`);
  const otras = otrasReglas(r.v);
  if (otras.length)
    p.push(`también saltan otras reglas por la misma rotura: ${[...new Set(otras)].join(", ")}`);
  return p;
}

bloque(
  0,
  "el árbol intacto está verde y el cierre desde el cliente llega al core",
  () => {},
  (r) => {
    const p = [];
    if (r.v.length !== 0) p.push(`el árbol intacto tiene ${r.v.length} violaciones error`);
    if (r.cierre < 80)
      p.push(`el cierre desde el cliente solo alcanza ${r.cierre} ficheros del core: ¿resolver roto?`);
    return p;
  },
);

bloque(
  1,
  `node:fs a DOS saltos en ${aDos.path} (fuera del perímetro puro) salta SOLO por el cierre, con el camino`,
  () => añade(aDos.path, 'import { readFileSync as qaFs } from "node:fs"; void qaFs;'),
  (r) =>
    unaSola(r, aDos.path, `${aDos.path} → node:fs`, [
      new RegExp(
        `entra en el cliente por: nefan-html/src/[^ ]+ → nefan-core/[^ ]+ → ${aDos.path.replace(/[.]/g, "\\.")} → node:fs$`,
      ),
      "el camino no es cliente → core → sujeto → node:fs",
    ]),
);

bloque(
  2,
  `node:fs a TRES saltos en ${aTres.path} salta con la cadena de cuatro ficheros`,
  () => añade(aTres.path, 'import { readFileSync as qaFs } from "node:fs"; void qaFs;'),
  (r) =>
    unaSola(r, aTres.path, `${aTres.path} → node:fs`, [
      new RegExp(
        `entra en el cliente por: nefan-html/src/[^ ]+ → nefan-core/[^ ]+ → nefan-core/[^ ]+ → ${aTres.path.replace(/[.]/g, "\\.")} → node:fs$`,
      ),
      "el camino no tiene tres saltos",
    ]),
);

bloque(
  3,
  "`export * from` es una arista: la re-exportación de un módulo con node:path salta",
  () => {
    escribe(junto("qa-reexportado.ts"), 'import { join } from "node:path";\nexport const qaJoin = join;\n');
    añade(aDos.path, 'export * from "./qa-reexportado.js";');
  },
  (r) => unaSola(r, junto("qa-reexportado.ts"), `${aDos.path} → ${junto("qa-reexportado.ts")} → node:path`),
);

bloque(
  4,
  "un import de DIRECTORIO (`./qa-dir` → `qa-dir/index.ts`) se sigue",
  () => {
    escribe(
      junto("qa-dir/index.ts"),
      'import { readFileSync } from "node:fs";\nexport const qaLee = readFileSync;\n',
    );
    añade(aDos.path, 'import { qaLee } from "./qa-dir"; void qaLee;');
  },
  (r) => unaSola(r, junto("qa-dir/index.ts"), `${aDos.path} → ${junto("qa-dir/index.ts")} → node:fs`),
);

bloque(
  5,
  "un import ROTO (el fichero no existe) es violación en quien lo escribe, y dice que está roto",
  () => añade(aDos.path, 'import "./qa-no-existe.js";'),
  (r) => {
    const p = [];
    const propias = soloLaRegla(r.v);
    if (propias.length !== 1) p.push(`esperaba 1 violación de ${REGLA}, hay ${propias.length}`);
    const v = propias[0];
    if (v && v.path !== aDos.path) p.push(`la violación señala ${v.path}, esperaba ${aDos.path}`);
    if (v && v.line !== 1) p.push(`la línea es ${v.line}, esperaba 1 (donde está el import)`);
    if (v && !/^el import está roto: .*no existe en disco/.test(v.detail))
      p.push(`no dice, y lo primero, que el import está roto: ${v.detail}`);
    if (v && /amplía scan\.roots/.test(v.detail)) p.push(`a un typo le pide ampliar el escaneo: ${v.detail}`);
    if (v && !/qa-no-existe/.test(v.detail)) p.push(`no nombra el destino: ${v.detail}`);
    if (v && !/Camino: nefan-html\/src\/[^ ]+ → /.test(v.detail)) p.push(`no trae el camino: ${v.detail}`);
    return p;
  },
);

bloque(
  6,
  'un import DINÁMICO literal (`import("./qa-din.js")`) es una arista: Vite lo mete en un chunk igual',
  () => {
    escribe(
      junto("qa-din.ts"),
      'import { readFileSync } from "node:fs";\nexport const qaLee = readFileSync;\n',
    );
    añade(aDos.path, 'export const qaCarga = () => import("./qa-din.js");');
  },
  (r) => unaSola(r, junto("qa-din.ts"), `${aDos.path} → ${junto("qa-din.ts")} → node:fs`),
);

bloque(
  7,
  "node:fs DIRECTO en un fichero del cliente salta por el cierre, una sola vez",
  () =>
    escribe(
      "nefan-html/src/qa-directo.ts",
      'import { readFileSync } from "node:fs";\nexport const qaLee = readFileSync;\n',
    ),
  (r) => unaSola(r, "nefan-html/src/qa-directo.ts", "nefan-html/src/qa-directo.ts → node:fs"),
);

/** Un fichero que EXISTE y ningún root del checker escanea: `nefan-core/package.json`. Se
 *  importa desde el sujeto por ruta relativa, calculada para que el guion no dependa de en qué
 *  carpeta caiga el sujeto. */
const relAlPackage = (() => {
  const r = relative(dirname(aDos.path), "nefan-core/package.json").split("\\").join("/");
  return r.startsWith(".") ? r : `./${r}`;
})();
bloque(
  8,
  "un destino que EXISTE pero ningún root escanea es violación distinta: «existe pero el checker no lo escanea»",
  () => añade(aDos.path, `import "${relAlPackage}";`),
  (r) => {
    const p = [];
    const propias = soloLaRegla(r.v);
    if (propias.length !== 1) p.push(`esperaba 1 violación de ${REGLA}, hay ${propias.length}`);
    const v = propias[0];
    if (v && v.path !== aDos.path) p.push(`la violación señala ${v.path}, esperaba ${aDos.path}`);
    if (
      v &&
      !/^"nefan-core\/package\.json" existe pero el checker no lo escanea: amplía scan\.roots/.test(v.detail)
    )
      p.push(`no distingue «existe pero no se escanea» de un import roto: ${v.detail}`);
    if (v && /está roto/.test(v.detail)) p.push(`llama roto a un import que resuelve: ${v.detail}`);
    return p;
  },
);

limpiar();
if (fallos.length) {
  console.log(`\n✘ ${fallos.length} bloque(s) en rojo:\n  ${fallos.join("\n  ")}\n`);
  process.exit(1);
}
console.log("\n✔ El cierre ve el node a saltos: los nueve bloques responden como se espera.\n");
