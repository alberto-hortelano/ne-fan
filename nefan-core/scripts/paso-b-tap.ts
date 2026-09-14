/** PASO B de #443 — ¿corre la batería fichero a fichero, SIN `--test`?
 *
 *  No simula lo que hace `tap-runner`: importa SUS PROPIAS funciones
 *  (`buildArguments`, `captureTapResult`) del paquete instalado y las usa sobre
 *  cada fichero de la batería del plan. Así el veredicto es el mismo que dará
 *  el runner de verdad, no una aproximación mía — y si el paquete cambia de
 *  comportamiento, esta medida cambia con él en vez de quedarse mintiendo.
 *
 *  Por qué sin `--test`: `tap-runner` hace `spawn('node', ['-r', hook.cjs,
 *  ...nodeArgs, testFile])`, o sea que ejecuta el fichero DIRECTO. Con `--test`
 *  Node abriría un hijo por fichero y el hook escribiría su
 *  `stryker-output-<pid>.json` con el pid del hijo, que nadie lee: la cobertura
 *  se perdería entera.
 *
 *  Uso:  npx tsx scripts/paso-b-tap.ts              (los ficheros del plan)
 *        npx tsx scripts/paso-b-tap.ts <f> [...]    (unos cuantos)
 *        npx tsx scripts/paso-b-tap.ts --modulos    (el dry run de los 58)
 *
 *  `--modulos` contesta la otra mitad de la pregunta: que Stryker ACEPTE el
 *  config generado de cada módulo y que el dry run del runner nuevo salga con
 *  cobertura. No mide un solo mutante (`--dryRunOnly`), así que cuesta segundos
 *  por módulo y no minutos, y no pasa por `mutate.ts` — no es una corrida.
 */
import childProcess from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { configDe, coreRoot, leerPlan } from "./mutation-plan.js";

/** Lo poco que este script necesita del paquete, que no trae tipos. */
interface ResultadoTap {
  result: { ok: boolean };
  failedTests: { name: string }[];
}
type BuildArguments = (args: string[], hookFile: string, testFile: string) => string[];
type CaptureTapResult = (
  proc: childProcess.ChildProcessWithoutNullStreams,
  forceBail: boolean,
) => Promise<ResultadoTap>;

const pkg = join(coreRoot, "node_modules", "@stryker-mutator", "tap-runner", "dist", "src");
const helper = (await import(join(pkg, "tap-helper.js"))) as {
  buildArguments: BuildArguments;
  captureTapResult: CaptureTapResult;
};
const env = (await import(join(pkg, "setup", "env.cjs"))) as {
  tempTapOutputFileName: (pid: number | undefined) => string;
};
const hookFile = join(pkg, "setup", "hook.cjs");

const plan = leerPlan();
const delPlan = [...new Set(plan.modulos.flatMap((m) => m.tests))].sort();

if (process.argv.includes("--modulos")) {
  // El dry run de los 58: ¿acepta Stryker el config generado y sale del
  // arranque con cobertura? Los configs van a `reports/dry/` y NO a
  // `reports/mutation/`, que es lo que CI sube y `verificaDescarga` vigila.
  const base = JSON.parse(readFileSync(join(coreRoot, "stryker.config.json"), "utf8")) as Record<string, unknown>;
  const dir = join(coreRoot, "reports", "dry");
  mkdirSync(dir, { recursive: true });
  console.log(`modulo\tveredicto\tsegundos\tficheros_de_bateria\tlinea`);
  let fallos = 0;
  for (const m of plan.modulos) {
    const cfg = join(dir, `${m.id}.config.json`);
    const generado = configDe(base, plan, m, 2) as Record<string, unknown>;
    generado.jsonReporter = { fileName: relative(coreRoot, join(dir, `${m.id}.json`)) };
    generado.reporters = ["json"];
    writeFileSync(cfg, `${JSON.stringify(generado, null, 2)}\n`);
    const t0 = Date.now();
    const r = childProcess.spawnSync(join(coreRoot, "node_modules", ".bin", "stryker"), [
      "run",
      relative(coreRoot, cfg),
      "--dryRunOnly",
    ], { cwd: coreRoot, encoding: "utf8" });
    rmSync(cfg, { force: true });
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const inicial = /Initial test run succeeded\. Ran (\d+) tests? in [^\n]*/.exec(salida);
    const bien = r.status === 0 && inicial !== null && Number(inicial[1]) === m.tests.length;
    if (!bien) fallos++;
    console.log(
      `${bien ? "OK  " : "MAL "}\t${m.id}\t${seg}\t${inicial?.[1] ?? "?"}/${m.tests.length}\t` +
        (bien ? inicial[0] : (/ERROR[^\n]*/.exec(salida)?.[0] ?? `exit ${r.status}`)),
    );
  }
  console.log(`\n=== ${plan.modulos.length} módulos, ${fallos} MAL ===`);
  process.exit(fallos === 0 ? 0 : 1);
}

const ficheros = process.argv.slice(2).length > 0 ? process.argv.slice(2) : delPlan;

console.log(`veredicto\tfichero\texit\ttap_ok\tsegundos\tplan_tap\tnode_fail\truido_antes_del_TAP\tnota`);
let malos = 0;
for (const testFile of ficheros) {
  const args = helper.buildArguments([...plan.node_args], hookFile, testFile);
  const t0 = Date.now();
  const proc = childProcess.spawn("node", args, {
    cwd: coreRoot,
    env: { ...process.env, STRYKER_NAMESPACE: "__stryker__" },
  }) as childProcess.ChildProcessWithoutNullStreams;
  // Espejo de la salida: el parser la consume, y sin copia no se puede mirar
  // el TAP crudo para decir DÓNDE empieza.
  let crudo = "";
  proc.stdout.on("data", (c: Buffer) => {
    crudo += c.toString();
  });
  let exit: number | null = null;
  proc.on("exit", (c) => {
    exit = c;
  });
  let resultado: ResultadoTap | null = null;
  let error = "";
  try {
    resultado = await helper.captureTapResult(proc, /* forceBail */ true);
  } catch (err) {
    error = String((err as Error).message).split("\n")[0];
  }
  const seg = ((Date.now() - t0) / 1000).toFixed(2);
  const salida = join(coreRoot, env.tempTapOutputFileName(proc.pid));
  const huboFichero = existsSync(salida);
  if (huboFichero) rmSync(salida);

  const lineas = crudo.split("\n");
  const iCabecera = lineas.indexOf("TAP version 13");
  const ruidoAntes = iCabecera < 0 ? "SIN CABECERA" : String(iCabecera);
  const planTap = /^1\.\.\d+$/m.exec(crudo)?.[0] ?? "SIN PLAN";
  const nodeFail = /^# fail (\d+)$/m.exec(crudo)?.[1] ?? "?";
  const ok = resultado?.result.ok === true;
  // El criterio OPERATIVO es el que usa el runner para clasificar un mutante:
  // exit 0, el parser dice `ok`, y el hook dejó su fichero de cobertura. Que la
  // cabecera TAP no sea la primera línea NO lo rompe —tap-parser ignora lo que
  // esté fuera del protocolo—, pero se cuenta aparte porque es el riesgo.
  const bien = exit === 0 && ok && planTap !== "SIN PLAN" && huboFichero && nodeFail === "0";
  if (!bien) malos++;
  const nota = [
    error ? `THROW: ${error}` : "",
    huboFichero ? "" : "SIN stryker-output",
    resultado?.failedTests.length ? `fallos: ${resultado.failedTests.map((f) => f.name).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join(" ; ");
  console.log(
    `${bien ? "OK  " : "MAL "}\t${testFile}\t${exit}\t${ok}\t${seg}\t${planTap}\t${nodeFail}\t${ruidoAntes}\t${nota}`,
  );
}
console.log(`\n=== ${ficheros.length} ficheros, ${malos} MAL ===`);
process.exit(malos === 0 ? 0 : 1);
