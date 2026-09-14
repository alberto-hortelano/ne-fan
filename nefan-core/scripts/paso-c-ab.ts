/** PASO C de #443 — cuánto ahorra `tap-runner`, en segundos crudos.
 *
 *  A/B **intercalado** (A,B,A,B,…) y no «todos los A y luego todos los B»:
 *  esta máquina la comparten varios agentes y deriva sola. Entre dos corridas
 *  de CI el mismo módulo se ha movido entre ×0,75 y ×1,14, así que un ahorro
 *  por debajo de esa banda NO es un ahorro, y el orden de las medidas no puede
 *  regalarle la diferencia a ningún brazo.
 *
 *  A = lo que corre HOY en `main`: `testRunner: "command"`, `coverageAnalysis:
 *      "off"`, la batería ENTERA por mutante dentro de un `node --test`.
 *  B = `testRunner: "tap"`, `coverageAnalysis: "perTest"`, un `node <fichero>`
 *      por fichero de la batería y solo los que cubren al mutante.
 *
 *  Lo demás es idéntico a propósito: los mismos objetivos, la misma batería, el
 *  mismo `timeoutMS`, el mismo tope de heap y la MISMA concurrencia (2, la que
 *  concede `mutacion -- local`). Sin eso no se está comparando el runner.
 *
 *  NO escribe en `reports/mutation/`: eso es lo que CI sube como artefacto y
 *  `verificaDescarga` (#420) lee un informe local de ahí como suplantación de
 *  la corrida descargada. Va a `reports/ab/`, que también está gitignorado.
 *
 *  Uso:  npx tsx scripts/paso-c-ab.ts <modulo> [pares]     (por defecto 3)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { coreRoot, leerPlan, moduloPorId, type ModuloMutacion } from "./mutation-plan.js";

const STRYKER = join(coreRoot, "node_modules", ".bin", "stryker");
const DIR = join(coreRoot, "reports", "ab");
const CONCURRENCIA = 2;
/** Los dos diales que el plan declaraba antes de #443, escritos aquí
 *  explícitamente para que el brazo A siga siendo el de `main` aunque la rama
 *  ya no lo diga. */
const HEAP = "--max-old-space-size=1024";
const COMANDO_A = `NODE_OPTIONS=${HEAP} node --import tsx --test --test-concurrency=1`;

const plan = leerPlan();
const base = JSON.parse(readFileSync(join(coreRoot, "stryker.config.json"), "utf8")) as Record<string, unknown>;

const id = process.argv[2];
const pares = Number(process.argv[3] ?? 3);
const modulo: ModuloMutacion = moduloPorId(plan, id);

interface Mutante {
  status: string;
  mutatorName: string;
  replacement?: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}
interface Informe {
  files: Record<string, { mutants: Mutante[] }>;
}

function configDe(variante: "A" | "B", i: number): Record<string, unknown> {
  const { $schema: _s, _comment: _c, thresholds, ...comun } = base as Record<string, unknown> & {
    $schema?: unknown;
    _comment?: unknown;
    thresholds: Record<string, number>;
  };
  const especifico =
    variante === "A"
      ? {
          testRunner: "command",
          coverageAnalysis: "off",
          commandRunner: { command: `${COMANDO_A} ${modulo.tests.join(" ")}` },
          tap: undefined,
        }
      : {
          testRunner: "tap",
          coverageAnalysis: "perTest",
          tap: { testFiles: [...modulo.tests], nodeArgs: [...plan.node_args] },
        };
  return {
    ...comun,
    ...especifico,
    concurrency: CONCURRENCIA,
    mutate: modulo.mutate,
    // Sin `break`: se quiere el NÚMERO, no un veredicto que aborte la medida.
    thresholds: { high: thresholds.high, low: thresholds.low },
    jsonReporter: { fileName: relative(coreRoot, join(DIR, `${id}-${variante}-${i}.json`)) },
    reporters: ["json"],
  };
}

/** La huella de un superviviente, igual que `scripts/mutacion-huella.ts`:
 *  fichero + posición + mutador + reemplazo. El ESTADO no entra, y por eso se
 *  puede ver si son los MISMOS supervivientes y no solo si son otros tantos —
 *  que es la diferencia entre la regla del usuario y mirar el score. */
function resumen(ruta: string): {
  total: number;
  vivos: number;
  score: number;
  cuenta: Record<string, number>;
  huellas: string[];
} {
  const rep = JSON.parse(readFileSync(ruta, "utf8")) as Informe;
  const mut = Object.values(rep.files).flatMap((f) => f.mutants);
  const cuenta: Record<string, number> = {};
  for (const m of mut) cuenta[m.status] = (cuenta[m.status] ?? 0) + 1;
  const esVivo = (s: string) => s === "Survived" || s === "NoCoverage";
  const vivos = mut.filter((m) => esVivo(m.status)).length;
  const detectados = mut.filter((m) => m.status === "Killed" || m.status === "Timeout").length;
  const total = vivos + detectados;
  const huellas: string[] = [];
  for (const [f, datos] of Object.entries(rep.files)) {
    for (const m of datos.mutants) {
      if (!esVivo(m.status)) continue;
      const { start, end } = m.location;
      huellas.push(
        `${f}|${start.line}:${start.column}-${end.line}:${end.column}|${m.mutatorName}|${m.replacement ?? ""}`,
      );
    }
  }
  return { total, vivos, score: total === 0 ? 0 : (detectados / total) * 100, cuenta, huellas: huellas.sort() };
}

function corre(variante: "A" | "B", i: number): { variante: string; i: number; segundos: number } & ReturnType<typeof resumen> {
  mkdirSync(DIR, { recursive: true });
  const cfg = join(DIR, `${id}-${variante}-${i}.config.json`);
  writeFileSync(cfg, `${JSON.stringify(configDe(variante, i), null, 2)}\n`);
  const t0 = Date.now();
  const r = spawnSync(STRYKER, ["run", relative(coreRoot, cfg)], {
    cwd: coreRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const segundos = (Date.now() - t0) / 1000;
  rmSync(cfg, { force: true });
  const res = resumen(join(DIR, `${id}-${variante}-${i}.json`));
  console.log(
    `${new Date().toISOString().slice(11, 19)}  ${variante}  par ${i}  ${segundos.toFixed(1)} s  ` +
      `total ${res.total}  vivos ${res.vivos}  score ${res.score.toFixed(2)}%  exit ${r.status}  ` +
      JSON.stringify(res.cuenta),
  );
  return { variante, i, segundos, ...res };
}

console.log(
  `=== ${id} · ${modulo.mutate.length} objetivo(s) · batería de ${modulo.tests.length} · ` +
    `${pares} pares intercalados · concurrencia ${CONCURRENCIA}`,
);
const filas: ReturnType<typeof corre>[] = [];
for (let i = 1; i <= pares; i++) {
  filas.push(corre("A", i));
  filas.push(corre("B", i));
}

const seg = (v: string) => filas.filter((f) => f.variante === v).map((f) => f.segundos);
const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const a = seg("A");
const b = seg("B");
console.log(`\nA (command): ${a.map((x) => x.toFixed(1)).join(" · ")}  → media ${media(a).toFixed(1)} s`);
console.log(`B (tap):     ${b.map((x) => x.toFixed(1)).join(" · ")}  → media ${media(b).toFixed(1)} s`);
console.log(
  `ahorro medio: ${(100 * (1 - media(b) / media(a))).toFixed(1)} %  (factor B/A = ${(media(b) / media(a)).toFixed(3)})`,
);
console.log(`par a par:    ${a.map((x, i) => `${(100 * (1 - b[i] / x)).toFixed(1)}%`).join(" · ")}`);
console.log(
  `dispersión A: ${(Math.max(...a) / Math.min(...a)).toFixed(3)}×   ` +
    `dispersión B: ${(Math.max(...b) / Math.min(...b)).toFixed(3)}×`,
);

// El score y, más fuerte, el CONJUNTO de supervivientes: el criterio del
// usuario es «0 nuevos y 0 resueltos», no «el mismo número».
const ref = filas[0];
for (const f of filas) {
  const nuevos = f.huellas.filter((h) => !ref.huellas.includes(h));
  const resueltos = ref.huellas.filter((h) => !f.huellas.includes(h));
  console.log(
    `${f.variante}${f.i}: total ${f.total} (ref ${ref.total}) · score ${f.score.toFixed(2)}% · ` +
      `nuevos ${nuevos.length} · resueltos ${resueltos.length}` +
      (nuevos.length ? `\n   NUEVOS: ${nuevos.join("\n           ")}` : "") +
      (resueltos.length ? `\n   RESUELTOS: ${resueltos.join("\n              ")}` : ""),
  );
}
