/** `npm run mutate` — la corrida de mutación, un config por módulo.
 *
 *  Antes era un solo `stryker run` con una batería fija de ocho ficheros de
 *  test por cada uno de los 1684 mutantes, la mayoría de los cuales ni siquiera
 *  importaba el fichero mutado. Aquí se corre módulo a módulo con la batería de
 *  cada uno (ver `mutation-plan.ts`).
 *
 *  QUIÉN DECIDE LA CONCURRENCIA: este fichero, y por eso no está en
 *  `stryker.config.json`. La concurrencia no es una propiedad del repositorio
 *  sino de la máquina que mide, y ponerla a un número fijo fue exactamente el
 *  accidente del 2026-08-23: `concurrency: 10` en el config × hasta 15 procesos
 *  que `node --test` arranca por su cuenta (uno por fichero de test, por
 *  defecto `availableParallelism() - 1`) = **hasta 130 procesos node sobre 16
 *  núcleos**. Load average medido: 129 → 140, la máquina inusable para la
 *  persona que la estaba usando, y la propia medida inflada por el
 *  context-switching. Con `--test-concurrency=1` en el comando del plan, cada
 *  worker de Stryker gasta un proceso de test a la vez y el total simultáneo
 *  vuelve a ser ≈ la concurrencia que se pida aquí.
 *
 *  Uso:
 *    npm run mutate -- --cambiado        # SOLO lo que el diff puede haber roto
 *    npm run mutate                      # todos los módulos del plan
 *    npm run mutate -- world-map         # solo esos (por id)
 *    npm run mutate -- --ids             # los ids en JSON (matriz de CI)
 *
 *    NEFAN_MUTATE_CONCURRENCY=15 npm run mutate   # la máquina es toda tuya
 *
 *  `--cambiado` es la vía normal de trabajo y delega en `scripts/afectado.ts`:
 *  la corrida completa deja de ser lo que se corre por costumbre y pasa a ser
 *  lo que se corre cuando hace falta (la nocturna, o cuando el selector dice
 *  que ante la duda hay que medirlo todo). Admite las mismas señas que el
 *  selector — `--desde <ref>`, `--rango <a>..<b>` — y ANTES de medir imprime
 *  qué va a correr, qué se salta y por qué: una selección que no se explica es
 *  indistinguible de una que se ha quedado ciega.
 *
 *  Un módulo que baja de su `break` NO corta la corrida: se anota y se sigue,
 *  para que una sola corrida deje medidos todos los módulos y el artefacto de
 *  CI esté completo. El código de salida es 1 si alguno falló.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative } from "node:path";

import { contextoDe, ficherosCambiados, seleccionar } from "./afectado.js";
import {
  concurrenciaDe,
  configDe,
  coreRoot,
  leerPlan,
  moduloPorId,
  resumenDeMutantes,
  rutaInforme,
  type ModuloMutacion,
  type PlanMutacion,
} from "./mutation-plan.js";

const BASE = join(coreRoot, "stryker.config.json");
const STRYKER = join(coreRoot, "node_modules", ".bin", "stryker");
/** Los configs generados van a `reports/` (gitignorado) y NO a
 *  `reports/mutation/`, que es lo que CI sube como artefacto y lo que
 *  `deuda.ts` lee: un config colado ahí se leería como un informe. */
const DIR_CONFIGS = join(coreRoot, "reports", "stryker");

interface Resultado {
  id: string;
  ok: boolean;
  segundos: number;
  total: number;
  vivos: number;
  score: number;
}

function resumenDelInforme(id: string): { total: number; vivos: number; score: number } {
  const ruta = rutaInforme(id);
  // Sin informe no se inventa un cero: se devuelve vacío y la tabla lo enseña
  // como 0 mutantes, que es lo que ha pasado — la corrida no dejó medida.
  if (!existsSync(ruta)) return { total: 0, vivos: 0, score: 0 };
  const rep = JSON.parse(readFileSync(ruta, "utf8")) as {
    files: Record<string, { mutants: { status: string }[] }>;
  };
  return resumenDeMutantes(Object.values(rep.files).flatMap((f) => f.mutants));
}

function corre(plan: PlanMutacion, modulo: ModuloMutacion, concurrencia: number): Resultado {
  const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, unknown>;
  const cfg = join(DIR_CONFIGS, `${modulo.id}.config.json`);
  mkdirSync(DIR_CONFIGS, { recursive: true });
  writeFileSync(cfg, `${JSON.stringify(configDe(base, plan, modulo, concurrencia), null, 2)}\n`);

  // El informe viejo se borra ANTES: si esta corrida se cae, `npm run deuda`
  // tiene que decir "sin datos", no enseñar el veredicto de la semana pasada.
  const informe = rutaInforme(modulo.id);
  mkdirSync(dirname(informe), { recursive: true });
  rmSync(informe, { force: true });

  const t0 = Date.now();
  const r = spawnSync(STRYKER, ["run", relative(coreRoot, cfg)], { cwd: coreRoot, stdio: "inherit" });
  const segundos = (Date.now() - t0) / 1000;
  const { total, vivos, score } = resumenDelInforme(modulo.id);
  return { id: modulo.id, ok: r.status === 0, segundos, total, vivos, score };
}

/** Qué módulos se van a correr, y por qué. Con `--cambiado` la respuesta la da
 *  el selector, que además IMPRIME su razonamiento: si sale vacía no se corre
 *  nada, y eso tiene que verse — no ponerse verde en silencio. */
function aCorrer(plan: PlanMutacion, argv: readonly string[]): ModuloMutacion[] {
  if (argv.includes("--cambiado")) {
    const origen = ficherosCambiados(argv);
    const sel = seleccionar(contextoDe(plan, origen.revisiones), origen.ficheros);
    console.log(
      `Selección desde ${origen.descripcion}: ${sel.ids.length} de ${plan.modulos.length} módulos` +
        `${sel.todos ? " (corrida completa: el selector no puede descartar nada)" : ""}.`,
    );
    for (const e of sel.efectos.filter((x) => x.todos || x.ids.length > 0)) {
      console.log(`  ${e.fichero} → ${e.todos ? "TODOS" : e.ids.join(", ")}: ${e.porque}`);
    }
    if (sel.ids.length === 0) {
      console.log(
        "Nada que medir: ningún módulo carga nada de lo que ha cambiado (`npm run afectado` lo detalla).",
      );
    }
    return sel.ids.map((id) => moduloPorId(plan, id));
  }
  // `--desde` y `--rango` son señas del selector: sin `--cambiado` no hacen
  // nada, y dejar que se ignoren en silencio sería medir otra cosa de la que
  // se ha pedido y no enterarse.
  for (const flag of ["--desde", "--rango"]) {
    if (argv.includes(flag)) throw new Error(`${flag} solo tiene sentido con --cambiado`);
  }
  const ids = argv.filter((a) => !a.startsWith("-"));
  return ids.length > 0 ? ids.map((id) => moduloPorId(plan, id)) : plan.modulos;
}

function main(): void {
  const argv = process.argv.slice(2);
  const plan = leerPlan();
  if (argv.includes("--ids")) {
    console.log(JSON.stringify(plan.modulos.map((m) => m.id)));
    return;
  }
  const modulos = aCorrer(plan, argv);
  if (modulos.length === 0) return;

  const nucleos = availableParallelism();
  const concurrencia = concurrenciaDe(nucleos, process.env.NEFAN_MUTATE_CONCURRENCY);
  console.log(
    `Concurrencia: ${concurrencia} mutantes a la vez sobre ${nucleos} núcleos ` +
      `(un proceso de test por worker; NEFAN_MUTATE_CONCURRENCY para cambiarlo).`,
  );

  const resultados: Resultado[] = [];
  for (const m of modulos) {
    console.log(`\n━━ ${m.id} · ${m.mutate.join(" ")} · batería de ${m.tests.length} test(s)\n`);
    resultados.push(corre(plan, m, concurrencia));
  }

  console.log("\n╔═ Mutación por módulo ═══════════════════════════════════════════");
  let mutantes = 0;
  let reloj = 0;
  for (const r of resultados) {
    const suelo = moduloPorId(plan, r.id).break;
    const marca = r.ok ? "ok " : "✗  ";
    // Sin informe NO se pinta un score de 0: un cero se lee como "medido y
    // malísimo", y lo que ha pasado es que no hay medida. Pasó de verdad al
    // estrenar el reparto: un test de la batería importaba un fichero de fuera
    // del paquete y Stryker moría en el dry run sin llegar a mutar nada.
    const veredicto =
      r.total === 0
        ? "SIN INFORME — la corrida no dejó medida"
        : `${String(r.total).padStart(5)} mutantes · ${String(r.vivos).padStart(4)} vivos · ` +
          `score ${r.score.toFixed(1).padStart(5)}% (break ${suelo})`;
    console.log(`║ ${marca} ${r.id.padEnd(22)} ${veredicto} · ${r.segundos.toFixed(0)}s`);
    mutantes += r.total;
    reloj += r.segundos;
  }
  console.log(`╚═ ${mutantes} mutantes en ${(reloj / 60).toFixed(1)} min de reloj\n`);

  const fallados = resultados.filter((r) => !r.ok);
  if (fallados.length > 0) {
    console.error(`Módulos por debajo de su break (o caídos): ${fallados.map((r) => r.id).join(", ")}`);
    process.exitCode = 1;
  }
}

main();
