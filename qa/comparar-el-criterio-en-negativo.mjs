/** El criterio de adopción de #443, ejercido contra el VERBO real.
 *
 *  Qué es y qué NO es. No es un candado del ingeniero: es el reproductor de QA
 *  de la PR 1 de la tanda D. Corre `npm run mutacion -- comparar` sobre corridas
 *  de ENSAYO fabricadas desde `reports/mutation-base/` y afirma, una por una,
 *  las propiedades que la decisión de #443 necesita que sean ciertas — la
 *  decisión es «se cambia de runner o no», y quien la toma solo tiene delante la
 *  salida de este verbo.
 *
 *  POR QUÉ NO VIVE EN `qa/guiones/`: ahí `qa/run.mjs` globa guiones de
 *  NAVEGADOR con firma `default async (ctx)`. Esto es headless y no abre nada.
 *  El sitio de la casa para esto es la raíz de `qa/`, como
 *  `mutacion-cableado-en-negativo.mjs`.
 *
 *  CÓMO SE LEE. Cada línea es una propiedad. 🟢 = el verbo la cumple; 🔴 = no la
 *  cumple y es un hallazgo de `qa-1.md` con su número.
 *
 *  NACIÓ DISCRIMINANDO, y esa es su credencial: el 2026-09-14 salía **9 en verde
 *  y 5 en rojo** (H1, H2, H3, H4 y H5), o sea que ni era un no-op ni un guion
 *  escrito contra la implementación que ya había. Las cinco se cerraron en la
 *  vuelta de correcciones de la misma PR —el conjunto lo fija la HUELLA y no la
 *  corrida, `NoCoverage` pasa a ser condición, el bloque del reloj distingue
 *  `vivo→T` de `killed→T` y saca al que se fue del denominador, y `--timeouts`
 *  falla fuerte— y hoy salen las 14 en verde. Ni una propiedad se tocó para
 *  conseguirlo: lo que cambió fue el verbo.
 *
 *  NO ENTRA EN `candados-headless` y no es olvido: necesita
 *  `reports/mutation-base/`, que son 141 MB gitignorados. Bajarlos en cada PR
 *  cuesta la descarga, y el artefacto caduca — el día que expirara, el job se
 *  pondría rojo por un motivo que no es del código. Corrida local, documentada
 *  en `qa/README.md`.
 *
 *  QUÉ TOCA. Solo `nefan-core/reports/mutation/`, que es material descargado y
 *  no versionado: lo aparta al empezar y lo devuelve en el `finally`.
 *  `reports/mutation-base/` es la BASE y solo se LEE. No escribe en el árbol
 *  versionado, no llama a `gh`, no gasta un crédito y no abre un navegador.
 *
 *  CÓMO SE CORRE:  node qa/comparar-el-criterio-en-negativo.mjs
 *  Salida 0 = todas las propiedades se cumplen. Salida 1 = quedan hallazgos.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const CORE = join(raiz, "nefan-core");
const BASE = join(CORE, "reports", "mutation-base");
const INFORMES = join(CORE, "reports", "mutation");
const APARTADO = join(CORE, "reports", "mutation-qa-apartado");

/** El ancla de la corrida base: su sha y su `desde`. Se leen del manifiesto
 *  para que este guion no lleve un hash escrito a mano que caduque. */
if (!existsSync(join(BASE, "corrida.json"))) {
  console.error(
    `No está la corrida base en ${BASE}.\n` +
      `  Es de donde salen TODAS las corridas de ensayo de aquí, y sin ella no hay nada que comparar:\n` +
      `    gh run download 34816474906 -n informe-mutacion -D nefan-core/reports/mutation-base`,
  );
  process.exit(2);
}
const CORRIDA_BASE = JSON.parse(readFileSync(join(BASE, "corrida.json"), "utf8"));

const npm = (argv) =>
  spawnSync("npm", ["run", "--silent", "mutacion", "--", ...argv], {
    cwd: CORE,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });

/** Fabrica una corrida de ensayo y corre `comparar` sobre ella.
 *
 *  `edita` recibe el informe ya parseado de cada módulo y lo muta en sitio; así
 *  el ensayo se escribe diciendo QUÉ transición se simula («este Killed pasa a
 *  Survived»), que es el lenguaje en el que está escrito el criterio. */
function comparar({ ids, edita = () => {}, origen = "explicito", pedidos, timeouts = BASE, run = "999900" }) {
  rmSync(INFORMES, { recursive: true, force: true });
  mkdirSync(INFORMES, { recursive: true });
  for (const id of ids) {
    const informe = JSON.parse(readFileSync(join(BASE, `${id}.json`), "utf8"));
    edita(informe, id);
    writeFileSync(join(INFORMES, `${id}.json`), JSON.stringify(informe));
  }
  const m = npm([
    "manifiesto",
    "--origen", origen,
    "--pedidos", (pedidos ?? ids).join(" "),
    "--sha", CORRIDA_BASE.sha,
    "--desde", CORRIDA_BASE.desde,
    "--run", run,
  ]);
  if (m.status !== 0) throw new Error(`el manifiesto de ensayo no se pudo escribir:\n${m.stderr}`);
  const r = npm(timeouts === null ? ["comparar"] : ["comparar", "--timeouts", timeouts]);
  return { exit: r.status, salida: `${r.stdout}${r.stderr}` };
}

/** Cambia los `n` primeros mutantes de un estado a otro, y se queja si no había
 *  tantos: un ensayo que no simula lo que dice es un verde que no comprueba. */
const mueve = (informe, fichero, de, a, n = 1) => {
  const ms = informe.files[fichero].mutants;
  let c = 0;
  for (const m of ms) if (m.status === de && c < n) { m.status = a; c += 1; }
  if (c !== n) throw new Error(`${fichero}: se pedían ${n} mutantes en ${de} y hay ${c}`);
};

const resultados = [];
const propiedad = (nombre, hallazgo, fn) => {
  let ok = false;
  let detalle;
  try {
    ({ ok, detalle } = fn());
  } catch (err) {
    detalle = `el ensayo reventó: ${err.message}`;
  }
  resultados.push({ nombre, hallazgo, ok, detalle });
  console.log(`${ok ? "🟢 cumple" : "🔴 NO    "}  ${nombre}`);
  if (detalle) console.log(`          ${detalle}`);
};

const DERIVE = "src/scene/blueprint/derive.ts";
const GAME_STORE = "src/store/game-store.ts";
const PLAN_COLL = "src/scene/blueprint/plan-collision.ts";
const modulos = () => JSON.parse(readFileSync(join(BASE, "corrida.json"), "utf8")).modulos_pedidos;

const habia = existsSync(INFORMES);
if (habia) { rmSync(APARTADO, { recursive: true, force: true }); renameSync(INFORMES, APARTADO); }
try {
  console.log("\nEl criterio de adopción de #443, contra el verbo real\n");

  // ── lo que ya funciona ────────────────────────────────────────────────────
  propiedad("la corrida base contra sí misma ADOPTA, y sobre los 87 ficheros", null, () => {
    const r = comparar({ ids: modulos(), origen: "rango", run: "999950" });
    return {
      ok: r.exit === 0 && /comparables\s+: 87 fichero/.test(r.salida) && /SE PUEDE ADOPTAR/.test(r.salida),
      detalle: /comparables\s+: (\d+)/.exec(r.salida)?.[0] ?? "no imprimió `comparables`",
    };
  });

  propiedad("el verbo NO deja rastro: ni huella, ni tag, ni árbol", null, () => {
    const foto = () => [
      spawnSync("git", ["status", "--porcelain"], { cwd: raiz, encoding: "utf8" }).stdout,
      spawnSync("git", ["rev-parse", "mutacion-ultima"], { cwd: raiz, encoding: "utf8" }).stdout,
      readFileSync(join(CORE, "data", "contract", "mutacion-huella.json"), "utf8").length,
    ].join("|");
    const antes = foto();
    comparar({ ids: ["blueprint-plan"], run: "999951" });
    return { ok: antes === foto(), detalle: antes === foto() ? "" : "el árbol cambió tras correr `comparar`" };
  });

  for (const [nombre, ensayo, espera] of [
    ["NUEVOS", { ids: ["blueprint-derive"], edita: (i) => mueve(i, DERIVE, "Killed", "Survived", 2) }, /NUEVOS/],
    ["RESUELTOS", { ids: ["store"], edita: (i) => mueve(i, GAME_STORE, "Survived", "Killed", 2) }, /RESUELTOS/],
    // Los dos de abajo llevan `store` de acompañante A PROPÓSITO: con
    // `blueprint-plan` solo (un fichero) el ensayo dejaría 0 comparables y el
    // rojo saldría por la condición EQUIVOCADA — verde por el motivo que no es
    // se lee igual que verde.
    ["INCOMPARABLES", { ids: ["blueprint-plan", "store"], edita: (i, id) => { if (id === "blueprint-plan") i.files[PLAN_COLL].mutants.splice(0, 1); } }, /1 fichero\(s\) INCOMPARABLES/],
    ["SIN BASE", { ids: ["blueprint-plan", "store"], edita: (i, id) => { if (id === "blueprint-plan") { i.files["src/config.ts"] = i.files[PLAN_COLL]; delete i.files[PLAN_COLL]; } } }, /1 fichero\(s\) SIN BASE/],
  ]) {
    propiedad(`${nombre} > 0 tumba la adopción y lo dice`, null, () => {
      const r = comparar({ ...ensayo, run: `9999${nombre.length}2` });
      return { ok: r.exit !== 0 && espera.test(r.salida), detalle: /⇒ .*/.exec(r.salida)?.[0]?.slice(0, 110) ?? "" };
    });
  }

  propiedad("CERO comparables no es un verde", null, () => {
    const r = comparar({
      ids: ["blueprint-plan"],
      edita: (i) => { i.files["src/config.ts"] = i.files[PLAN_COLL]; delete i.files[PLAN_COLL]; },
      run: "999956",
    });
    return { ok: r.exit !== 0 && /NI UN fichero/.test(r.salida), detalle: "" };
  });

  propiedad("una corrida INCOMPLETA no adopta aunque nada se mueva", null, () => {
    const r = comparar({ ids: ["blueprint-plan"], pedidos: ["blueprint-plan", "scene-validate"], origen: "rango", run: "999957" });
    return { ok: r.exit !== 0 && /INCOMPLETA/.test(r.salida), detalle: "" };
  });

  propiedad("Timeout → vivo tiene columna propia y además sale como NUEVO", null, () => {
    const r = comparar({ ids: ["blueprint-derive"], edita: (i) => mueve(i, DERIVE, "Timeout", "Survived", 2), run: "999958" });
    const fila = /blueprint-derive\s+\d+\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(r.salida);
    return { ok: r.exit !== 0 && fila?.[2] === "2", detalle: `T→vivo = ${fila?.[2] ?? "?"} (se esperaba 2)` };
  });

  // ── los hallazgos: propiedades que la decisión necesita y HOY no se cumplen ─
  propiedad(
    "una corrida que mide una FRACCIÓN de la huella no puede decir «SE PUEDE ADOPTAR»",
    "H1",
    () => {
      const r = comparar({ ids: ["blueprint-plan"], run: "999960" });
      const n = /comparables\s+: (\d+)/.exec(r.salida)?.[1];
      return {
        ok: r.exit !== 0,
        detalle: `un módulo de 55 (${n} fichero de 87, 38 mutantes de 12.841) → exit ${r.exit}: ${/⇒ .*/.exec(r.salida)?.[0]?.slice(0, 80)}`,
      };
    },
  );

  propiedad("un superviviente que pasa a NoCoverage no puede ser invisible", "H2", () => {
    const r = comparar({ ids: ["store"], edita: (i) => mueve(i, GAME_STORE, "Survived", "NoCoverage", 20), run: "999961" });
    return {
      ok: r.exit !== 0,
      detalle: `20 supervivientes dejan de ser ejercidos por ningún test → exit ${r.exit} (${/⇒ ([^\n—]*)/.exec(r.salida)?.[1]?.trim()})`,
    };
  });

  propiedad("vivo → Timeout se distingue de killed → Timeout en el bloque del reloj", "H3", () => {
    const vivo = comparar({ ids: ["blueprint-derive"], edita: (i) => mueve(i, DERIVE, "Survived", "Timeout", 3), run: "999962" });
    const killed = comparar({ ids: ["blueprint-derive"], edita: (i) => mueve(i, DERIVE, "Killed", "Timeout", 3), run: "999963" });
    const fila = (s) => /blueprint-derive\s+(\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+)/.exec(s)?.[1];
    return {
      ok: fila(vivo.salida) !== fila(killed.salida),
      detalle: `vivo→T: «${fila(vivo.salida)}» · killed→T: «${fila(killed.salida)}» — iguales = el bloque no sabe de dónde vino el RESUELTO`,
    };
  });

  propiedad("un Timeout que SALE del denominador no se rotula «T→detectado»", "H4", () => {
    const r = comparar({ ids: ["blueprint-derive"], edita: (i) => mueve(i, DERIVE, "Timeout", "RuntimeError", 3), run: "999964" });
    const fila = /blueprint-derive\s+\d+\s+\d+\s+(\d+)/.exec(r.salida);
    return {
      ok: fila?.[1] === "0",
      detalle: `T→detectado = ${fila?.[1]} — la leyenda dice «lo mata ahora un test… no es hallazgo de nadie», y no lo mató nadie: desapareció`,
    };
  });

  propiedad("`--timeouts` a un directorio que no existe falla fuerte", "H5", () => {
    const r = comparar({ ids: ["blueprint-derive"], timeouts: join(CORE, "reports", "no-existe-jamas"), run: "999965" });
    const ceros = /TOTAL\s+0\s+0\s+0\s+0\s+0\s+0/.test(r.salida);
    return { ok: !ceros, detalle: ceros ? "imprime una tabla de CEROS, que se lee «no se movió ningún Timeout»" : "" };
  });
} finally {
  rmSync(INFORMES, { recursive: true, force: true });
  if (habia) renameSync(APARTADO, INFORMES);
}

const rojos = resultados.filter((r) => !r.ok);
console.log(`\n${"─".repeat(70)}`);
console.log(`Propiedades comprobadas : ${resultados.length}`);
console.log(`Se cumplen              : ${resultados.length - rojos.length}`);
console.log(`NO se cumplen           : ${rojos.length}${rojos.length ? ` → ${rojos.map((r) => r.hallazgo ?? r.nombre).join(", ")}` : ""}`);
if (rojos.length === 0) console.log("\n✔ el criterio de adopción sostiene la decisión de #443");
else console.log("\n✗ quedan hallazgos abiertos: ver docs/agents/2026-09-14-el-reloj-y-la-bateria/qa-1.md");
process.exit(rojos.length === 0 ? 0 : 1);
