/** El cierre de GITHUB: lo que habla con `gh` —bajar el artefacto de una corrida,
 *  preguntar por sus jobs, comentar en una PR— y los dos verbos que no hacen otra
 *  cosa: `traer` (VACÍA `reports/mutation/` y baja; se niega si hay informes) y
 *  `cola` (cuánto esperó cada job de una corrida). `repartir` importa `gh` de
 *  aquí para publicar su comentario (#605).
 *
 *  Quién lo mira: nadie, porque hace falta red. `traer` y `cola` llaman a la API
 *  de GitHub, así que ni la batería ni los guiones de `qa/` los ejercen; lo que
 *  decide algo sobre lo que bajan (`verificaDescarga`, `costeDeLaMatriz`,
 *  `veredictoDeCorrida`) vive en `mutacion-huella.ts` con datos sintéticos. Ver
 *  `mutacion.ts`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

import { coreRoot } from "./mutation-plan.js";
import {
  costeDeLaMatriz,
  modulosConInforme,
  veredictoDeCorrida,
  type Corrida,
  type JobDeCI,
  type SujetoDeLaCola,
} from "./mutacion-huella.js";
import { DIR_INFORMES, exigeDescargaLimpia, leerCorrida, medidaDelDirectorio, RUTA_CORRIDA } from "./mutacion-informes.js";
import { nombrePaquete, raizRepo } from "./mutacion-repo.js";

export const WORKFLOW = "mutation.yml";
const ARTEFACTO = "informe-mutacion";

// ── verbo: traer ─────────────────────────────────────────────────────────────

interface RunDeCI {
  databaseId: number;
  headSha: string;
  status: string;
  conclusion: string;
  createdAt: string;
}

export function gh(args: string[], stdin?: string): string {
  const r = spawnSync("gh", args, {
    cwd: raizRepo,
    encoding: "utf8",
    input: stdin,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} falló (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return r.stdout;
}

/** La última corrida terminada del workflow. NO se filtra por `conclusion ==
 *  success` a propósito: `mutate.ts` sale con 1 cuando un módulo baja de su
 *  `break`, así que una medida completa que destape una regresión deja el run en
 *  ROJO. Filtrar por verde rechazaría justo las corridas que traen el hallazgo;
 *  quien decide si la medida sirve es `corrida.json`. */
function ultimaCorrida(): RunDeCI {
  const runs = JSON.parse(
    gh(["run", "list", "--workflow", WORKFLOW, "-L", "20", "--json", "databaseId,headSha,status,conclusion,createdAt"]),
  ) as RunDeCI[];
  const terminadas = runs.filter((r) => r.status === "completed");
  if (terminadas.length === 0) {
    throw new Error(`no hay ninguna corrida terminada de ${WORKFLOW}: lánzala y espera a que acabe.`);
  }
  return terminadas[0];
}

export function traer(argv: readonly string[]): void {
  const pedido = argv.find((a) => /^\d+$/.test(a));
  const run = pedido ? { databaseId: Number(pedido) } : ultimaCorrida();
  const id = String(run.databaseId);

  // Vaciar ANTES de bajar, y no fusionar: un informe de la semana pasada que se
  // quedara aquí se leería como parte de esta foto.
  //
  // PERO NO A CIEGAS, porque lo que se borra es la BASE de una comparación. La
  // huella commiteada guarda `vivos` y `total`, y ahí un `Timeout` es
  // indistinguible de un `Killed` y un `NoCoverage` de un `Survived`: esas tres
  // poblaciones SOLO están en los informes. Bajar la corrida nueva sin apartar
  // los viejos deja a `comparar` sin nada con que juzgar un cambio de
  // instrumento, y recuperarlos cuesta otra descarga — si el artefacto no ha
  // caducado.
  //
  // La primera versión de esto IMPRIMÍA el ritual justo antes del `rmSync`, o
  // sea que quien lo leía ya no podía hacer nada con él: prosa, no guardia (QA,
  // H10). Ahora se NIEGA y dice las dos salidas. El coste es un paso por tanda,
  // y es justo el paso que protege la base.
  mkdirSync(DIR_INFORMES, { recursive: true });
  const viejos = readdirSync(DIR_INFORMES).filter((f) => f.endsWith(".json") && f !== "corrida.json");
  if (viejos.length > 0 && !argv.includes("--sobrescribir")) {
    let previa: string | undefined;
    if (existsSync(RUTA_CORRIDA)) {
      try {
        previa = (JSON.parse(readFileSync(RUTA_CORRIDA, "utf8")) as Partial<Corrida>).run_id;
      } catch (err) {
        // Se dice, no se calla: sin el id, la línea de recuperación no se puede
        // escribir y quien la necesite tiene que ir a buscarlo a mano.
        console.error(`  (el manifiesto que hay aquí no se puede leer: ${(err as Error).message})`);
      }
    }
    throw new Error(
      `en ${relative(coreRoot, DIR_INFORMES)} hay ${viejos.length} informe(s)` +
        `${previa === undefined ? "" : ` de la corrida ${previa}`}, y traer los de ${id} los BORRA.\n` +
        `  Son la base de una comparación: los \`Timeout\` y los \`NoCoverage\` solo viven en los informes,\n` +
        `  la huella commiteada no los guarda. Elige:\n` +
        `    mv reports/mutation reports/mutation-base   (y luego: npm run mutacion -- traer ${id})\n` +
        `    npm run mutacion -- traer ${id} --sobrescribir   (si no los vas a necesitar)\n` +
        `${previa === undefined ? "" : `  Para recuperarlos después: gh run download ${previa} -n ${ARTEFACTO} -D ${nombrePaquete}/reports/mutation-base\n`}`,
    );
  }
  for (const f of readdirSync(DIR_INFORMES)) rmSync(join(DIR_INFORMES, f), { force: true });
  console.log(`Bajando el artefacto "${ARTEFACTO}" de la corrida ${id}…`);
  gh(["run", "download", id, "-n", ARTEFACTO, "-D", relative(raizRepo, DIR_INFORMES)]);

  const corrida = leerCorrida();
  exigeDescargaLimpia(corrida);
  const veredicto = veredictoDeCorrida(corrida, medidaDelDirectorio(DIR_INFORMES));
  const conInforme = modulosConInforme(corrida);
  console.log(
    `\nCorrida ${corrida.run_id} sobre ${corrida.sha.slice(0, 7)} (${corrida.origen}), ${corrida.fecha}\n` +
      `  rango medido desde ${corrida.desde.slice(0, 7)}\n` +
      `  ${conInforme.length} informe(s): ${conInforme.join(", ")}\n` +
      `  ${veredicto.completa ? "COMPLETA" : "INCOMPLETA"} — ${veredicto.porque}\n` +
      `\nSigue con:  npm run mutacion -- repartir\n`,
  );
  if (!veredicto.completa) process.exitCode = 1;
}

// ── verbo: cola (¿cuánto estorba la matriz?) ─────────────────────────────────

/** Cuánto espera una PR normal mientras la matriz ocupa el pool de runners.
 *
 *  NO SE ESTIMA, SE MIDE, y por eso existe este verbo en vez de un número
 *  puesto a ojo en el YAML: `max-parallel` empieza en 6 porque hay que empezar
 *  en algo, y se ajusta con esto. La pregunta es del arquitecto y el umbral es
 *  del usuario, que puede moverlo:
 *
 *    · sobre la corrida de MUTACIÓN → el sobrecoste de partir (N × checkout +
 *      `npm ci` + dry-run), que son minutos de runner y no de reloj, más la
 *      cola INTERNA de la matriz, que es información sobre el dial;
 *    · sobre la corrida de una PR NORMAL lanzada mientras la matriz corre → lo
 *      que esa PR esperó. Si pasa de dos minutos, se baja `max-parallel`: el
 *      reloj de la mutación es diferido y el de una PR no, y el hook
 *      `ci-verde.sh` no deja cerrar una tarea con el CI pendiente.
 *
 *  DE QUÉ CORRIDA SE TRATA NO SE PREGUNTA, SE MIRA: el workflow de la corrida
 *  lo dice la propia API, y por eso no hay flag que ponerle mal. Antes los dos
 *  usos estaban distinguidos SOLO en esta prosa mientras `cabe` y el
 *  `process.exitCode = 1` se aplicaban igual a los dos, y sobre la propia
 *  matriz eso aconsejaba lo contrario del dato (#541).
 *
 *    npm run mutacion -- cola <run-id>
 */
const TOPE_ESPERA_S = 120;

/** El fichero de workflow de una corrida, para saber si es la matriz o es otra
 *  cosa. Sin respuesta no se supone: se lanza. Suponer «es una PR» convertiría
 *  un fallo de `gh` en el veredicto equivocado, que es justo lo que #541
 *  arregla. */
function workflowDeCorrida(id: string): string {
  const run = JSON.parse(gh(["api", `repos/{owner}/{repo}/actions/runs/${id}`])) as { path?: unknown };
  if (typeof run.path !== "string" || run.path === "") {
    throw new Error(`la corrida ${id} no dice de qué workflow es (campo \`path\`): no se puede saber qué mide`);
  }
  return run.path;
}

export function cola(argv: readonly string[]): void {
  const id = argv.find((a) => /^\d+$/.test(a));
  if (!id) throw new Error("falta el id de la corrida: npm run mutacion -- cola <run-id>");
  const sujeto: SujetoDeLaCola = workflowDeCorrida(id).endsWith(`/${WORKFLOW}`) ? "la-matriz" : "una-pr";
  const jobs = JSON.parse(gh(["api", `repos/{owner}/{repo}/actions/runs/${id}/jobs?per_page=100`, "--paginate"]))
    .jobs as JobDeCI[];
  const c = costeDeLaMatriz(jobs, TOPE_ESPERA_S, sujeto);
  const min = (s: number): string => `${(s / 60).toFixed(1)} min`;
  console.log(
    `\nCorrida ${id} · ${c.jobs} job(s) · ${sujeto === "la-matriz" ? `la MATRIZ (${WORKFLOW})` : "una corrida AJENA a la matriz"}\n` +
      `  espera de cola   peor ${min(c.esperaPeor)} (${c.esperaPeorJob}) · mediana ${min(c.esperaMediana)}\n` +
      `  arranque         ${min(c.esperaDeArranque)} — lo que esperó el primer job a que el pool le hiciera sitio\n` +
      `  a la vez         ${c.paralelismoMaximo} job(s) como máximo\n` +
      `  reloj de pared   ${min(c.pared)}\n` +
      `  runner gastado   ${min(c.runner)}\n` +
      `  sobrecoste       ${min(c.sobrecoste)} — lo que se paga por venir partida (N × checkout + npm ci + dry-run)\n`,
  );
  if (sujeto === "la-matriz") {
    // LA COLA INTERNA ES UN DATO, NO UN FALLO. Los jobs que pasan de
    // `max-parallel` esperan a un slot de la propia matriz: bajar el dial los
    // haría esperar MÁS. Lo único que aquí puede ir mal es que la corrida no
    // arrancara, y eso no lo arregla `max-parallel` porque el pool lo tenía
    // otro.
    console.log(
      `  · la cola de ${min(c.esperaPeor)} es INTERNA: con ${c.jobs} jobs y ${c.paralelismoMaximo} a la vez, los\n` +
        `    últimos lotes esperan un slot de esta misma matriz. BAJAR max-parallel la ALARGA; subirlo\n` +
        `    acorta el reloj de pared a costa de ocupar más pool.\n`,
    );
    if (c.cabe) {
      console.log(
        `  ✔ la matriz arrancó en ${min(c.esperaDeArranque)}, dentro del presupuesto de ${min(TOPE_ESPERA_S)}:\n` +
          `    el pool estaba libre y toda la espera se explica sola.\n`,
      );
      return;
    }
    console.log(
      `  ✗ la matriz TARDÓ ${min(c.esperaDeArranque)} en arrancar, por encima del presupuesto de ${min(TOPE_ESPERA_S)}:\n` +
        `    el pool lo tenía otra cosa. Eso NO lo arregla max-parallel — mira qué más corría entonces.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (c.cabe) {
    console.log(`  ✔ el peor job esperó ${min(c.esperaPeor)}, dentro del presupuesto de ${min(TOPE_ESPERA_S)}.\n`);
    return;
  }
  console.log(
    `  ✗ el peor job esperó ${min(c.esperaPeor)}, por encima del presupuesto de ${min(TOPE_ESPERA_S)}.\n` +
      `    BAJA max-parallel en .github/workflows/mutation.yml. El reloj de la mutación es diferido y\n` +
      `    el de una PR no: el hook ci-verde.sh no deja cerrar una tarea con el CI pendiente.\n`,
  );
  process.exitCode = 1;
}
