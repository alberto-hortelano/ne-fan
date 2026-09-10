#!/usr/bin/env node
/** ¿Descarta el selector de mutación un fuente BORRADO solo cuando puede demostrar quién lo
 *  cargaba, y fuerza la completa cuando no?
 *
 *  Vive fuera de `qa/guiones/` por lo mismo que `qa/el-selector-ve-lo-que-la-bateria-abre.mjs`:
 *  `qa/run.mjs` conduce un navegador contra el stack levantado, y aquí no hay nada que un
 *  jugador pueda mirar.
 *
 *  POR QUÉ EXISTE. Hasta #471 un `.ts` que ya no estaba en el árbol forzaba los 42 módulos
 *  («no hay grafo de imports que decir quién lo cargaba»): #448 pagó una corrida completa
 *  por borrar `scripts/gate-snapshots.ts` cuando el resto de su diff seleccionaba 9. Desde
 *  #471 `efectoDeBorrado` (`scripts/afectado.ts`) pregunta a la revisión `antes` del rango
 *  quién lo importaba y solo NO fuerza si todos esos importadores están en el mismo diff (o
 *  se fueron con él). Eso cambia la dirección del riesgo: antes el selector se equivocaba
 *  de MÁS (caro y correcto), ahora puede equivocarse de MENOS — y un borrado que descarta
 *  lo que debía medir sale «NO EJECUTA NADA» y su PR pasa sin medir.
 *
 *  CÓMO LO COMPRUEBA, y por qué no es una copia de `test/afectado.test.ts`: la batería
 *  prueba la regla con un contexto SINTÉTICO (el `Borrado` se inyecta) y la lectura de git
 *  solo contra `HEAD`, donde nada está borrado. Aquí se hace el flujo del usuario de verdad:
 *  un clon superficial del repo en `qa/.tmp/`, commits que BORRAN y RENOMBRAN con git, y el
 *  mismo `afectado --rango` que corre `npm run mutacion -- pendiente`. El sujeto se elige del
 *  plan de hoy —un módulo que muta UN fichero literal, con UNA batería, y cuyo único
 *  importador es esa batería— para que el guion no caduque cuando cambie el plan.
 *
 *  Seis bloques, cuatro de la dirección peligrosa (fuerza) y dos de la que compra tiempo:
 *    1 · borrar el fuente y dejar a su importador fuera del diff  → FUERZA y nombra al importador
 *    2 · `git mv` con importador y plan al día                     → NO fuerza; selecciona el módulo
 *    3 · `git mv` sin tocar al importador (árbol roto)             → FUERZA y nombra al importador
 *    4 · borrar una hoja que nadie importaba ni medía              → NO fuerza, y lo dice
 *    5 · el borrado del bloque 1 por `--ficheros` (sin revisión)   → FUERZA: sin `antes` no hay grafo
 *    6 · auditar `c1..c2` con el árbol ya en c3, donde el importador
 *        que c2 dejó roto se borró después                          → FUERZA igual que con el árbol en c2
 *
 *  PROBADO EN NEGATIVO (2026-09-05, rama `t14/471-fuente-borrado`, roturas a mano en
 *  `efectoDeBorrado`, cada una revertida): `const fuera = vivos;` (el conjunto del diff se
 *  ignora) → cae el bloque 2, que fuerza sin motivo; `if (fuera.length > 1)` (hace falta más
 *  de un importador fuera) → caen 1 y 3; el forzador viejo (todo borrado ⇒ `todos: true` con
 *  «ya no está en el árbol») → caen los cinco primeros: 2 y 4 por forzar, y 1, 3 y 5 porque el
 *  porque ya no nombra al importador ni a la revisión que faltó; sin `--no-renames`
 *  (`SIN_RENOMBRAR = []`) → caen 2 y 3, porque la ruta de origen del `git mv` ni aparece en la
 *  lista; `ctx.existe` en vez de `ctx.sigue` al repartir vivos/idos → cae el 6 (caso G de
 *  QA). Verde con la rama intacta (~10 s).
 *
 *  Juzga el instrumento del ÁRBOL DE TRABAJO (se copian `scripts/` y el plan encima del clon
 *  y se sellan en un commit), así que sirve antes de commitear. El import de DIRECTORIO
 *  (`./x` → `x/index.ts`) dejó de ser el agujero de esta lista el 2026-09-10 (#473): cuando
 *  el borrado es un `index`, `importadoresEn` busca ADEMÁS el nombre de su carpeta, y el caso
 *  H de `qa-471.md` lo ejerce `test/afectado.test.ts` sobre una revisión fabricada con
 *  plumbing — el caso no cabe en el repo porque `Node16` lo rechaza en ESM.
 *
 *  NO mide mutación: no lanza Stryker, ni `npm run mutate`, ni `mutacion -- local`. Cero
 *  créditos, cero servicios. No toca el árbol del repo: todo pasa en el clon, que se borra.
 *
 *    node qa/el-borrado-pregunta-a-antes.mjs
 *    node qa/el-borrado-pregunta-a-antes.mjs --verboso   # también los porqués que aprueba
 *
 *  Verde = las cinco respuestas son las esperadas.  Rojo = el selector descarta un borrado
 *  que debía forzar, o fuerza uno que ya está explicado.  2 = no pude medir.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(raiz, "nefan-core");
const TMP = join(raiz, "qa", ".tmp");
const VERBOSO = process.argv.includes("--verboso");
const CLON = join(TMP, `borrado-${process.pid}`);
const CLON_CORE = join(CLON, "nefan-core");

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

/** git en el clon, fail-loud. */
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

/** Lo que diría `afectado` con esos argumentos: `{todos, ids, efectos}`. Es el mismo camino
 *  que `npm run afectado` y que `mutacion -- pendiente` (`seleccionar` sobre `contextoDe`). */
function seleccion(argv) {
  return enClon(
    `import { contextoDe, ficherosCambiados, seleccionar } from "./scripts/afectado.ts";
     import { leerPlan } from "./scripts/mutation-plan.ts";
     const o = ficherosCambiados(${JSON.stringify(argv)});
     const s = seleccionar(contextoDe(leerPlan(), o.revisiones), o.ficheros);
     console.log("<<<JSON>>>" + JSON.stringify({ todos: s.todos, ids: s.ids, efectos: s.efectos }));`,
    `afectado ${argv.join(" ")}`,
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
// Un ENLACE llamado node_modules no lo tapa el patrón `node_modules/` del .gitignore (con la
// barra solo casa directorios, y para git un enlace es un fichero): sin esto, `git add -A`
// lo commitearía y el `reset --hard` del bloque siguiente se lo llevaría.
writeFileSync(join(CLON, ".git", "info", "exclude"), "nefan-core/node_modules\n", { flag: "a" });
// El INSTRUMENTO que se juzga es el del ÁRBOL DE TRABAJO, no el de HEAD: quien corre esto
// antes de commitear quiere saber si lo que tiene delante deriva bien. Se copian `scripts/` y
// el plan encima del clon y se sella en un commit, que es la base de todos los bloques.
cpSync(join(CORE, "scripts"), join(CLON_CORE, "scripts"), { recursive: true });
cpSync(join(CORE, "data", "contract", "mutation-targets.json"), join(CLON_CORE, "data", "contract", "mutation-targets.json"));
git(["add", "-A", "--", "nefan-core/scripts", "nefan-core/data/contract/mutation-targets.json"]);
git(["commit", "-q", "--allow-empty", "-m", "instrumento del árbol de trabajo"]);
const BASE = git(["rev-parse", "--short", "HEAD"]);

// ── 1 · el sujeto: un módulo con UN fichero literal, UNA batería, y esa batería como único importador
const sujeto = enClon(
  `import { leerPlan } from "./scripts/mutation-plan.ts";
   import { importadoresEn } from "./scripts/afectado.ts";
   const plan = leerPlan();
   let out = null;
   for (const m of plan.modulos) {
     if (m.mutate.length !== 1 || m.tests.length !== 1 || /[*?[{]/.test(m.mutate[0])) continue;
     const imp = importadoresEn("HEAD", m.mutate[0]);
     if (imp.length === 1 && imp[0] === m.tests[0]) { out = { id: m.id, fuente: m.mutate[0], test: m.tests[0] }; break; }
   }
   console.log("<<<JSON>>>" + JSON.stringify(out));`,
  "sujeto",
);
if (!sujeto) noPude("ningún módulo del plan muta UN fichero literal con UNA batería que sea su único importador: elige otro sujeto.");
const { id: MODULO, fuente: FUENTE, test: TEST } = sujeto;
const FUENTE2 = FUENTE.replace(/\.ts$/, "-renombrado.ts");
const base = FUENTE.split("/").pop().replace(/\.ts$/, "");
console.log(`\nEl borrado pregunta a \`antes\` · clon en ${BASE} · sujeto: ${MODULO} (${FUENTE} ← ${TEST})\n`);

// ── 2 · los bloques ───────────────────────────────────────────────────────────
const fallos = [];
const efecto = (s, f) => s.efectos.find((e) => e.fichero === f) ?? { porque: "(sin efecto para ese fichero)", ids: [] };
function bloque(n, titulo, preparar, juzgar) {
  git(["reset", "-q", "--hard", BASE]);
  git(["clean", "-qfd", "--", "nefan-core/src", "nefan-core/test"]);
  const rango = preparar();
  const s = seleccion(rango);
  const problemas = juzgar(s);
  const ok = problemas.length === 0;
  console.log(`  ${ok ? "✔" : "✘"} ${n} · ${titulo}`);
  console.log(`      → ${s.todos ? "COMPLETA" : s.ids.length === 0 ? "NADA" : s.ids.join(" ")}`);
  if (VERBOSO || !ok) for (const e of s.efectos.filter((x) => x.fichero.startsWith(FUENTE.replace(/\.ts$/, "")) || x.fichero.includes("/qa-"))) console.log(`      ${e.fichero}: ${e.porque}`);
  for (const p of problemas) console.log(`      ✘ ${p}`);
  if (!ok) fallos.push(`${n} · ${titulo}`);
}
const commit = (msg) => {
  git(["add", "-A", "--", "nefan-core/src", "nefan-core/test", "nefan-core/data"]);
  git(["commit", "-q", "-m", msg]);
  return git(["rev-parse", "--short", "HEAD"]);
};
const reemplaza = (rel, de, a) => {
  const abs = join(CLON, rel);
  const antes = readFileSync(abs, "utf8");
  if (!antes.includes(de)) noPude(`${rel} no contiene «${de}»: el sujeto no es el que el guion cree`);
  writeFileSync(abs, antes.split(de).join(a));
};

bloque(
  1,
  "borrar el fuente y dejar a su batería fuera del diff FUERZA la completa nombrándola",
  () => {
    git(["rm", "-q", `nefan-core/${FUENTE}`]);
    return ["--rango", `${BASE}..${commit("borra el fuente")}`];
  },
  (s) => {
    const e = efecto(s, FUENTE);
    const p = [];
    if (!s.todos) p.push("no fuerza la completa: el importador sigue en el árbol y NO está en el diff");
    if (!e.porque.includes(TEST) || !/NO está en el diff/.test(e.porque)) p.push(`el porque no nombra a ${TEST} como fuera del diff: «${e.porque}»`);
    return p;
  },
);

bloque(
  2,
  "`git mv` con la batería y el plan al día NO fuerza, y selecciona el módulo",
  () => {
    git(["mv", `nefan-core/${FUENTE}`, `nefan-core/${FUENTE2}`]);
    reemplaza(`nefan-core/${TEST}`, `${base}.js`, `${base}-renombrado.js`);
    reemplaza("nefan-core/data/contract/mutation-targets.json", `"${FUENTE}"`, `"${FUENTE2}"`);
    return ["--rango", `${BASE}..${commit("renombra")}`];
  },
  (s) => {
    const viejo = efecto(s, FUENTE);
    const p = [];
    if (s.todos) p.push(`fuerza la completa por un renombrado con todo al día: ${s.efectos.filter((e) => e.todos).map((e) => `${e.fichero} — ${e.porque}`).join(" · ")}`);
    if (!s.ids.includes(MODULO)) p.push(`no selecciona ${MODULO}, que perdió y ganó un fichero`);
    if (!/todos en este diff/.test(viejo.porque)) p.push(`la ruta vieja no explica que sus importadores están en el diff: «${viejo.porque}»`);
    return p;
  },
);

bloque(
  3,
  "`git mv` SIN tocar a la batería (árbol roto) FUERZA la completa nombrándola",
  () => {
    git(["mv", `nefan-core/${FUENTE}`, `nefan-core/${FUENTE2}`]);
    reemplaza("nefan-core/data/contract/mutation-targets.json", `"${FUENTE}"`, `"${FUENTE2}"`);
    return ["--rango", `${BASE}..${commit("renombra sin importador")}`];
  },
  (s) => {
    const e = efecto(s, FUENTE);
    const p = [];
    if (!s.todos) p.push("no fuerza: la batería sigue importando la ruta vieja y no está en el diff");
    if (!e.porque.includes(TEST)) p.push(`el porque no nombra a ${TEST}: «${e.porque}»`);
    return p;
  },
);

bloque(
  4,
  "borrar una hoja que nadie importaba ni medía NO fuerza, y dice que nadie la cargaba",
  () => {
    const hoja = `nefan-core/${dirname(FUENTE)}/qa-hoja.ts`;
    writeFileSync(join(CLON, hoja), "export const hoja = 1;\n");
    const c1 = commit("nace la hoja");
    git(["rm", "-q", hoja]);
    return ["--rango", `${c1}..${commit("muere la hoja")}`];
  },
  (s) => {
    const e = s.efectos.find((x) => x.fichero.endsWith("qa-hoja.ts")) ?? { porque: "(sin efecto)", todos: false };
    const p = [];
    if (s.todos) p.push("fuerza la completa por una hoja que ninguna batería ejecutaba");
    if (s.ids.length !== 0) p.push(`selecciona ${s.ids.join(" ")} por una hoja sin dueño`);
    if (!/ningún fichero del repo lo importaba/.test(e.porque)) p.push(`el porque no dice que nadie la importaba: «${e.porque}»`);
    return p;
  },
);

bloque(
  5,
  "el mismo borrado por `--ficheros` (sin revisión en la que mirar) FUERZA la completa",
  () => {
    git(["rm", "-q", `nefan-core/${FUENTE}`]);
    commit("borra el fuente");
    return ["--ficheros", `nefan-core/${FUENTE}`];
  },
  (s) => {
    const e = efecto(s, FUENTE);
    const p = [];
    if (!s.todos) p.push("no fuerza: sin `antes` no hay grafo en el que buscar y suponer es la selección corta");
    if (!/`antes`/.test(e.porque)) p.push(`el porque no dice que faltó la revisión: «${e.porque}»`);
    return p;
  },
);

bloque(
  6,
  "auditar `c1..c2` con el árbol en c3 (el importador roto se borró DESPUÉS) FUERZA igual que en c2",
  () => {
    // c1: nace `qa-b` y `qa-a`, que lo importa. c2: se borra `qa-b` y `qa-a`
    // queda fuera del diff, roto. c3: se borra `qa-a`. El mismo `--rango
    // c1..c2` tiene que contestar lo mismo con el árbol en c2 y en c3: «se fue
    // con él» se decide en `despues` (c2), donde `qa-a` seguía.
    const dir = `nefan-core/${dirname(FUENTE)}`;
    writeFileSync(join(CLON, dir, "qa-b.ts"), "export const b = 1;\n");
    writeFileSync(join(CLON, dir, "qa-a.ts"), 'import { b } from "./qa-b.js";\nexport const a = b + 1;\n');
    const c1 = commit("nacen qa-b y qa-a");
    git(["rm", "-q", `${dir}/qa-b.ts`]);
    const c2 = commit("muere qa-b; qa-a queda roto");
    git(["rm", "-q", `${dir}/qa-a.ts`]);
    commit("muere qa-a");
    return ["--rango", `${c1}..${c2}`];
  },
  (s) => {
    const e = s.efectos.find((x) => x.fichero.endsWith("qa-b.ts")) ?? { porque: "(sin efecto)", todos: false };
    const p = [];
    if (!s.todos) p.push("no fuerza: en c2 `qa-a` seguía importando `qa-b` y no está en el diff; que se borrara en c3 no cambia lo que c2 dejó");
    if (!/qa-a\.ts, que NO está en el diff/.test(e.porque)) p.push(`el porque no nombra a qa-a como fuera del diff: «${e.porque}»`);
    return p;
  },
);

limpiar();
console.log(
  fallos.length === 0
    ? `\n✔ los seis borrados contestan lo esperado: fuerza cuando no puede demostrar quién lo cargaba, y solo entonces`
    : `\n✘ ${fallos.length} bloque(s) en rojo:\n  ${fallos.join("\n  ")}\n  Un borrado mal derivado sale «NO EJECUTA NADA» y su PR pasa sin medir lo que tocó.`,
);
process.exit(fallos.length === 0 ? 0 : 1);
