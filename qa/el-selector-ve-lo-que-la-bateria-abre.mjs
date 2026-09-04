#!/usr/bin/env node
/** ¿VE el selector de mutación todos los ficheros de datos que una batería ABRE?
 *
 *  Vive fuera de `qa/guiones/` por lo mismo que `qa/mutacion-candados-en-negativo.mjs`:
 *  `qa/run.mjs` carga todo `.mjs` de esa carpeta y lo conduce contra un navegador con el
 *  stack levantado, y aquí no hay nada que un jugador pueda mirar.
 *
 *  POR QUÉ EXISTE. #404 retiró los tres forzadores de «corrida completa» de
 *  `scripts/afectado.ts`, así que un fichero de datos ya no fuerza los 41 módulos: ahora
 *  lo selecciona QUIEN LO LEE, calculado con `leeElDato` (`scripts/mutation-plan.ts`).
 *  Esa función contesta por dos vías — el fichero NOMBRA el basename en un literal de
 *  cadena, o ENUMERA un directorio que lo contiene — y las dos miran literales. El modo
 *  de fallo que eso deja abierto tiene nombre: **un dato que una batería abre de verdad
 *  se resuelve a «no lo lee nadie», y su PR sale verde sin medir nada.** El crítico midió
 *  una mitad (`readdirSync`, cerrada en #404); ésta es la otra: abrir con el NOMBRE
 *  COMPUESTO, `readFileSync(join(DIR, `${x}.json`))`, donde el basename no aparece en
 *  ningún literal y no hay enumeración que valga.
 *
 *  CÓMO LO COMPRUEBA, y por qué es un oráculo INDEPENDIENTE y no una copia del selector:
 *  no pregunta «¿quién nombra este fichero?» sino «¿qué DIRECTORIOS abre cada fichero del
 *  alcance de una batería?», que es la pregunta desde el otro lado. Para cada fichero F
 *  de algún alcance busca en su AST
 *
 *    · directorios que ENUMERA y nombra (`readdirSync(DIR)` con `DIR` resuelto a disco), y
 *    · directorios que ABRE POR NOMBRE COMPUESTO (`readFileSync(join(DIR, <no literal>))`),
 *
 *  resolviendo las constantes locales contra el disco. Todo dato que cuelgue DIRECTAMENTE
 *  de uno de esos directorios lo lee la batería de F, se llame como se llame; así que el
 *  selector tiene que devolver, para ese dato, al menos los módulos de F. Si devuelve
 *  «ninguno» —o se deja alguno—, el selector es más permisivo de lo que dice y esto sale
 *  ROJO nombrando el par.
 *
 *  PROBADO EN LAS DOS DIRECCIONES sobre el árbol real (2026-09-05):
 *    · VERDE, la vía cerrada por #404: `test/scene-fixtures.test.ts` enumera `data/scenes`
 *      → sus 3 fixtures seleccionan `contrato-escena` y `scene-validate`.
 *    · ROJO, la vía que queda abierta: `test/contract-sprite-forge.test.ts` (batería de
 *      `contrato-sprite-forge`) abre `data/contract/fixtures/sprite-forge/${nombre}.json`
 *      y sus 5 fixtures salen «ninguno»; `test/fps-atlas-golden.test.ts` abre
 *      `test/fixtures/fps-plans/${name}.json` y `varied.json` sale «ninguno».
 *  O sea: este guion NO puede pasar en verde por no mirar nada — hoy mira 4 directorios,
 *  aprueba uno y suspende dos, y el cuarto no tiene datos que juzgar.
 *
 *  NO mide mutación: no lanza Stryker, ni `npm run mutate`, ni `mutacion -- local`. Solo
 *  lee el árbol y pregunta al propio `leeElDato`. Cero créditos, cero servicios.
 *
 *    node qa/el-selector-ve-lo-que-la-bateria-abre.mjs
 *    node qa/el-selector-ve-lo-que-la-bateria-abre.mjs --verboso   # también lo que aprueba
 *
 *  Verde = ningún dato que una batería abre se resuelve por debajo de esa batería.
 *  Rojo  = hay un dato vivo que el selector descarta y no debería.
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const TMP = join(raiz, "qa", ".tmp");
const VERBOSO = process.argv.includes("--verboso");

const require = createRequire(join(CORE, "package.json"));
/** El mismo `typescript` que usa el selector: si un día no está, se dice en vez de
 *  aprobar sin mirar. */
let ts;
try {
  ts = require("typescript");
} catch {
  console.error(
    "✘ no encuentro `typescript` en nefan-core/node_modules — corre `npm ci` en nefan-core.\n" +
      "  Sin AST este guion no puede comprobar nada, y callarse sería el verde que viene a impedir.",
  );
  process.exit(2);
}

/** Un `tsx -e` en nefan-core que devuelve JSON por stdout. Fail-loud: si el hijo no
 *  contesta JSON, se enseña su salida y se sale con 2 — «no pude medir» no es verde. */
function enCore(codigo, quien) {
  const r = spawnSync("npx", ["tsx", "-e", codigo], {
    cwd: CORE,
    encoding: "utf8",
    timeout: 600000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  const salida = `${r.stdout ?? ""}`;
  const i = salida.indexOf("<<<JSON>>>");
  if (i < 0) {
    console.error(`✘ ${quien}: el hijo no devolvió JSON.\n${salida}\n${r.stderr ?? ""}`);
    process.exit(2);
  }
  return JSON.parse(salida.slice(i + 10));
}

// ── 1 · el alcance real de cada módulo, del propio plan ───────────────────────
const alcance = enCore(
  `import { alcanceDe, leerPlan } from "./scripts/mutation-plan.ts";
   const plan = leerPlan();
   const m = {};
   for (const mod of plan.modulos) for (const f of alcanceDe(mod)) (m[f] ??= []).push(mod.id);
   console.log("<<<JSON>>>" + JSON.stringify(m));`,
  "alcance",
);

// ── 2 · qué directorios ABRE o ENUMERA cada fichero del alcance ───────────────
const API_ENUMERA = new Set(["readdirSync", "readdir", "opendirSync", "opendir", "globSync", "glob"]);
const API_ABRE = new Set(["readFileSync", "readFile", "createReadStream", "openSync", "open"]);
const esCadena = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const nombreLlamado = (n) =>
  ts.isIdentifier(n.expression)
    ? n.expression.text
    : ts.isPropertyAccessExpression(n.expression)
      ? n.expression.name.text
      : "";

/** Los literales seguidos de una expresión, unidos por "/": cubre `"../data/scenes"`,
 *  `join(HERE, "fixtures", "fps-plans")` y `new URL("../data/x", import.meta.url)`. */
function tramosLiterales(n) {
  const out = [];
  let tramo = [];
  const v = (x) => {
    if (esCadena(x)) tramo.push(x.text);
    else {
      if (tramo.length > 0) out.push(tramo.join("/"));
      tramo = [];
      ts.forEachChild(x, v);
    }
  };
  ts.forEachChild(n, v);
  if (tramo.length > 0) out.push(tramo.join("/"));
  if (esCadena(n)) out.push(n.text);
  return out;
}

/** El directorio DEL PAQUETE al que resuelve ese tramo, o undefined. */
function dirDelPaquete(baseDir, tramo) {
  if (!tramo || tramo === "." || tramo === "..") return undefined;
  for (const abs of [resolve(baseDir, tramo), resolve(CORE, tramo)]) {
    const rel = relative(CORE, abs).split("\\").join("/");
    if (rel === "" || rel.startsWith("..")) continue;
    if (existsSync(abs) && statSync(abs).isDirectory()) return rel;
  }
  return undefined;
}

/** {fichero, dir, modo} — un directorio cuyo CONTENIDO lee la batería de `fichero`. */
const puertas = [];
for (const fichero of Object.keys(alcance)) {
  const abs = join(CORE, fichero);
  if (!existsSync(abs)) continue;
  const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.ESNext, true);
  const baseDir = dirname(abs);
  /** const NAME = <algo que resuelve a un directorio del paquete> */
  const constantes = new Map();
  const anota = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      for (const tramo of tramosLiterales(n.initializer)) {
        const d = dirDelPaquete(baseDir, tramo);
        if (d !== undefined) constantes.set(n.name.text, d);
      }
    }
    ts.forEachChild(n, anota);
  };
  anota(sf);

  const añade = (dir, modo) => {
    if (dir !== undefined && !puertas.some((p) => p.fichero === fichero && p.dir === dir && p.modo === modo)) {
      puertas.push({ fichero, dir, modo });
    }
  };
  const visita = (n) => {
    if (ts.isCallExpression(n)) {
      const nombre = nombreLlamado(n);
      const a0 = n.arguments[0];
      if (API_ENUMERA.has(nombre) && a0) {
        if (ts.isIdentifier(a0)) añade(constantes.get(a0.text), "enumera");
        for (const t of tramosLiterales(a0)) añade(dirDelPaquete(baseDir, t), "enumera");
        if (esCadena(a0)) añade(dirDelPaquete(baseDir, a0.text), "enumera");
      }
      // Abrir con el nombre COMPUESTO: `readFileSync(join(DIR, `${x}.json`))`.
      if (API_ABRE.has(nombre) && a0 && ts.isCallExpression(a0)) {
        const interno = nombreLlamado(a0);
        const args = a0.arguments;
        if ((interno === "join" || interno === "resolve") && args.length > 1) {
          const ultimo = args[args.length - 1];
          if (!esCadena(ultimo)) {
            const cabeza = args[0];
            if (ts.isIdentifier(cabeza)) añade(constantes.get(cabeza.text), "compuesto");
          }
        }
      }
    }
    ts.forEachChild(n, visita);
  };
  visita(sf);
}

if (puertas.length < 2) {
  console.error(
    `✘ el oráculo solo ha encontrado ${puertas.length} directorio(s) que una batería abre. ` +
      "Con tan poco no está comprobando nada: revisa el analizador antes de creerte el verde.",
  );
  process.exit(2);
}

// ── 3 · los datos que cuelgan de cada puerta, y qué dice el selector ──────────
const datosDe = (dir) =>
  readdirSync(join(CORE, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith(".ts"))
    .map((e) => `${dir}/${e.name}`)
    .sort();

const pares = [];
for (const p of puertas) for (const dato of datosDe(p.dir)) pares.push({ ...p, dato });

mkdirSync(TMP, { recursive: true });
const entrada = join(TMP, `selector-oracle-${process.pid}.json`);
writeFileSync(entrada, JSON.stringify([...new Set(pares.map((p) => p.dato))]));
const seleccion = enCore(
  `import { readFileSync } from "node:fs";
   import { alcanceDe, leerPlan, leeElDato } from "./scripts/mutation-plan.ts";
   const datos = JSON.parse(readFileSync(${JSON.stringify(entrada)}, "utf8"));
   const plan = leerPlan();
   const alcance = new Map();
   for (const m of plan.modulos) for (const f of alcanceDe(m)) alcance.set(f, [...(alcance.get(f) ?? []), m.id]);
   const out = {};
   for (const d of datos) {
     const ids = new Set();
     for (const [f, xs] of alcance) if (leeElDato(f, d)) xs.forEach((i) => ids.add(i));
     out[d] = [...ids];
   }
   console.log("<<<JSON>>>" + JSON.stringify(out));`,
  "seleccion",
);
rmSync(entrada, { force: true });

// ── 4 · veredicto ─────────────────────────────────────────────────────────────
const fallos = [];
let aprobados = 0;
const porPuerta = new Map();
for (const p of pares) {
  const clave = `${p.fichero} → ${p.dir} (${p.modo})`;
  const faltan = alcance[p.fichero].filter((id) => !(seleccion[p.dato] ?? []).includes(id));
  const e = porPuerta.get(clave) ?? { ok: [], mal: [] };
  if (faltan.length === 0) {
    e.ok.push(p.dato);
    aprobados++;
  } else {
    e.mal.push(`${p.dato} → ${(seleccion[p.dato] ?? []).join(" ") || "NINGUNO"} (falta: ${faltan.join(" ")})`);
  }
  porPuerta.set(clave, e);
}

console.log("\nEl selector contra lo que la batería ABRE de verdad\n");
for (const [clave, e] of [...porPuerta].sort()) {
  if (e.mal.length === 0) {
    if (VERBOSO || e.ok.length > 0) console.log(`  ✔ ${clave} — ${e.ok.length} dato(s) bien vistos`);
    continue;
  }
  console.log(`  ✘ ${clave}`);
  for (const l of e.mal) console.log(`      ${l}`);
  fallos.push(clave);
}

const sinDatos = [...porPuerta].filter(([, e]) => e.ok.length + e.mal.length === 0).length;
console.log(
  `\n  ${porPuerta.size} puerta(s) miradas · ${aprobados} dato(s) bien vistos` +
    (sinDatos > 0 ? ` · ${sinDatos} sin datos que juzgar` : ""),
);
console.log(
  fallos.length === 0
    ? "\n✔ ningún dato que una batería abre se queda por debajo de esa batería"
    : `\n✘ ${fallos.length} directorio(s) con datos que el selector descarta y la batería SÍ lee.` +
        "\n  Un cambio en esos ficheros sale «NO EJECUTA NADA» y su PR pasa sin medir lo que alimentan.",
);
process.exit(fallos.length === 0 ? 0 : 1);
