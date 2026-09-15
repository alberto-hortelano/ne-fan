/** UNOS MUTANTES CON NOMBRE, medidos por su huella y solo ellos.
 *
 *  Para qué existe: #597 preguntaba si 26 mutantes concretos —los que
 *  `tap-runner` devolvía como `RuntimeError` y `command` mataba— vuelven a
 *  salir `Killed`. Cinco vivían en un módulo que cabe en `tope_local`; los
 *  otros 21 viven en módulos de 484, 507 y 375 mutantes, que `permisoLocal`
 *  rechaza con razón. Medirlos exigía acotar `mutate` a mano, y eso se hizo dos
 *  veces (ingeniero y QA) con dos instrumentos distintos escritos para la
 *  ocasión. Una medida que no se puede repetir es una cifra, no una prueba.
 *
 *  NO ES UNA PUERTA TRASERA AL TOPE. Mide los mutantes que se le nombran, no un
 *  módulo: si el recorte acaba midiendo más de `tope_local`, sale con error
 *  diciendo el número. Para medir un módulo entero está
 *  `npm run mutacion -- pendiente` y la autorización de una persona.
 *
 *  EL GOTCHA QUE CUESTA DOS CORRIDAS: el `mutate` de Stryker acota por LÍNEAS y
 *  solo coge los mutantes CONTENIDOS ENTEROS en el rango.
 *    · `fichero:97:61-99:13` (con columnas) no selecciona nada;
 *    · `fichero:125-125` se salta el `ObjectLiteral` que empieza en 125 y
 *      termina en 164;
 *    · `fichero:125-164` sí, y se trae de paso a los vecinos de esas líneas.
 *  Por eso el rango se deriva del INICIO Y EL FINAL que el informe base
 *  guarda, y por eso el resultado se casa por huella completa y no por cuenta:
 *  los vecinos entran, y hay que poder distinguirlos.
 *
 *  Escribe en `reports/ab/acotados/` y NUNCA en `reports/mutation/`: eso es lo
 *  que CI sube como artefacto y lo que `verificaDescarga` (#420) lee como
 *  suplantación de una corrida descargada.
 *
 *  Uso:
 *    npx tsx scripts/mutantes-acotados.ts <modulo> <fichero:línea:col> [...]
 *    npx tsx scripts/mutantes-acotados.ts <modulo> --de <fichero.json>
 *    … --base <dir>     (por defecto reports/mutation-base)
 *
 *  `--de` lee un JSON con `[{fichero, linea, columna}]`, que es lo cómodo
 *  cuando la lista sale de un issue. Salida: una línea por mutante pedido con
 *  su estado ANTES (en la base) y AHORA, y exit 1 si alguno no se midió o
 *  sobrevivió.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { coreRoot, leerPlan, moduloPorId } from "./mutation-plan.js";

const STRYKER = join(coreRoot, "node_modules", ".bin", "stryker");
const DIR = join(coreRoot, "reports", "ab", "acotados");
/** La misma que concede `npm run mutacion -- local`: esta máquina la comparte
 *  gente, y el techo medido son dos procesos de test. */
const CONCURRENCIA = 2;

interface Mutante {
  status: string;
  mutatorName: string;
  replacement?: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}
interface Informe {
  files: Record<string, { mutants: Mutante[] }>;
}
interface Pedido {
  fichero: string;
  linea: number;
  columna: number;
}

function uso(motivo: string): never {
  console.error(`\n${motivo}\n`);
  console.error("  npx tsx scripts/mutantes-acotados.ts <modulo> <fichero:línea:columna> [...]");
  console.error("  npx tsx scripts/mutantes-acotados.ts <modulo> --de <fichero.json>  [--base <dir>]\n");
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (nombre: string): string | undefined => {
  const i = argv.indexOf(nombre);
  return i === -1 ? undefined : argv[i + 1];
};
const dirBase = flag("--base") ?? join(coreRoot, "reports", "mutation-base");
const deFichero = flag("--de");
const posicionales = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const id = posicionales[0];
if (id === undefined) uso("falta el módulo: sin él no hay batería con la que matar nada");

const pedidos: Pedido[] =
  deFichero !== undefined
    ? (JSON.parse(readFileSync(deFichero, "utf8")) as Pedido[])
    : posicionales.slice(1).map((coord) => {
        const [fichero, linea, columna] = coord.split(":");
        if (fichero === undefined || linea === undefined || columna === undefined) {
          uso(`"${coord}" no es una coordenada: hace falta fichero:línea:columna, la del informe`);
        }
        return { fichero, linea: Number(linea), columna: Number(columna) };
      });
if (pedidos.length === 0) uso("no se ha nombrado ni un mutante: esto mide lo que se le nombra, no un módulo");

const plan = leerPlan();
const modulo = moduloPorId(plan, id);
if (pedidos.length > plan.tope_local) {
  console.error(
    `\n⛔ ${pedidos.length} mutantes pedidos contra un tope_local de ${plan.tope_local}: esto no es un ` +
      `recorte, es un módulo. Pídelo: npm run mutacion -- pendiente\n`,
  );
  process.exit(1);
}

// ── de dónde salen los rangos: el informe base, que ya tiene inicio Y final ──
const rutaBase = join(dirBase, `${id}.json`);
if (!existsSync(rutaBase)) {
  console.error(
    `\n⛔ no hay informe base en ${rutaBase}: sin él no se sabe dónde EMPIEZA y dónde ACABA cada mutante, y ` +
      `un rango de una sola línea se salta los multilínea en silencio (que es lo que el runner no sabía leer).\n`,
  );
  process.exit(1);
}
const base = JSON.parse(readFileSync(rutaBase, "utf8")) as Informe;
const huella = (f: string, m: Mutante): string =>
  `${f}:${m.location.start.line}:${m.location.start.column}-${m.location.end.line}:${m.location.end.column}`;
/** La clave lleva MUTADOR Y REEMPLAZO además de la posición, y no es purismo:
 *  dos mutantes distintos comparten sitio a menudo (un `ConditionalExpression` y
 *  un `LogicalOperator` sobre la misma expresión), y con la posición sola se
 *  colapsan. Casando por posición se lee un cambio de estado que no existe —
 *  pasó el 2026-09-15 con `arch-cierre`: un «Timeout → Killed» fantasma que con
 *  la huella completa resultó ser `cambios: 0`. */
const clave = (f: string, m: Mutante): string => `${huella(f, m)} ${m.mutatorName} => ${m.replacement ?? ""}`;

const enBase = new Map<string, { huella: string; estado: string; mutador: string; reemplazo: string }>();
const rangos = new Set<string>();
const sinBase: string[] = [];
for (const p of pedidos) {
  const ms = (base.files[p.fichero]?.mutants ?? []).filter(
    (m) => m.location.start.line === p.linea && m.location.start.column === p.columna,
  );
  if (ms.length === 0) {
    sinBase.push(`${p.fichero}:${p.linea}:${p.columna}`);
    continue;
  }
  for (const m of ms) {
    enBase.set(clave(p.fichero, m), {
      huella: huella(p.fichero, m),
      estado: m.status,
      mutador: m.mutatorName,
      reemplazo: m.replacement ?? "",
    });
    rangos.add(`${p.fichero}:${m.location.start.line}-${m.location.end.line}`);
  }
}
if (sinBase.length > 0) {
  console.error(`\n⛔ la base no tiene estos mutantes (${sinBase.join(", ")}): ¿otra corrida, u otro código?\n`);
  process.exit(1);
}

// ── el permiso, ANTES de gastar la máquina ───────────────────────────────────
//
// `permisoLocal` rechaza un módulo por su coste ANTES de medirlo, y este
// recorte tiene que poder hacer lo mismo: un guardia que solo se entera al
// final ya se ha comido la CPU que venía a proteger. El coste se estima con la
// MISMA regla con la que Stryker selecciona —mutantes de la base contenidos
// enteros en el rango—, así que no es un proxy: es la cuenta.
const dentroDelRango = (f: string, m: Mutante): boolean =>
  [...rangos].some((r) => {
    const [fichero, tramo] = [r.slice(0, r.lastIndexOf(":")), r.slice(r.lastIndexOf(":") + 1)];
    const [desde, hasta] = tramo.split("-").map(Number);
    return fichero === f && m.location.start.line >= desde && m.location.end.line <= hasta;
  });
const estimados = Object.entries(base.files).reduce(
  (n, [f, info]) => n + info.mutants.filter((m) => dentroDelRango(f, m)).length,
  0,
);
if (estimados > plan.tope_local) {
  console.error(
    `\n⛔ los rangos de estos ${enBase.size} mutantes arrastran ≈${estimados} mutantes de la base (los ` +
      `vecinos de esas líneas), por encima del tope_local de ${plan.tope_local}. NO se mide aquí: acota más, ` +
      `o pídelo — npm run mutacion -- pendiente\n`,
  );
  process.exit(1);
}

// ── medir ────────────────────────────────────────────────────────────────────
const cfgBase = JSON.parse(readFileSync(join(coreRoot, "stryker.config.json"), "utf8")) as Record<string, unknown>;
const { $schema: _s, _comment: _c, thresholds, ...comun } = cfgBase as Record<string, unknown> & {
  $schema?: unknown;
  _comment?: unknown;
  thresholds: Record<string, number>;
};
mkdirSync(DIR, { recursive: true });
const salida = join(DIR, `${id}.json`);
const rutaCfg = join(DIR, `${id}.config.json`);
writeFileSync(
  rutaCfg,
  `${JSON.stringify(
    {
      ...comun,
      tap: { testFiles: [...modulo.tests], nodeArgs: [...plan.node_args] },
      concurrency: CONCURRENCIA,
      mutate: [...rangos],
      // Sin `break`: se quiere el ESTADO de unos mutantes, no un veredicto de
      // módulo — el suelo habla de la población entera y aquí no está entera.
      thresholds: { high: thresholds.high, low: thresholds.low },
      jsonReporter: { fileName: relative(coreRoot, salida) },
      reporters: ["json"],
    },
    null,
    2,
  )}\n`,
);
console.log(
  `=== ${id} · batería de ${modulo.tests.length} · ${enBase.size} mutantes pedidos · ` +
    `${rangos.size} rango(s) · concurrencia ${CONCURRENCIA}`,
);
const t0 = Date.now();
const r = spawnSync(STRYKER, ["run", relative(coreRoot, rutaCfg)], {
  cwd: coreRoot,
  stdio: ["ignore", "ignore", "inherit"],
});
const segundos = ((Date.now() - t0) / 1000).toFixed(1);

const informe = JSON.parse(readFileSync(salida, "utf8")) as Informe;
const ahora = new Map<string, string>();
const cuenta: Record<string, number> = {};
for (const [f, info] of Object.entries(informe.files)) {
  for (const m of info.mutants) {
    ahora.set(clave(f, m), m.status);
    cuenta[m.status] = (cuenta[m.status] ?? 0) + 1;
  }
}
const medidos = ahora.size;

let mal = 0;
for (const [k, { huella: h, estado, mutador, reemplazo }] of enBase) {
  const st = ahora.get(k) ?? "NO MEDIDO";
  const detectado = st === "Killed" || st === "Timeout";
  if (!detectado) mal++;
  console.log(
    `    ${detectado ? "✔" : "✘"} ${h}  ${mutador} => ${JSON.stringify(reemplazo).slice(0, 24)}  ` +
      `base=${estado}  ahora=${st}`,
  );
}
console.log(
  `\n    ${segundos} s · exit ${r.status} · medidos ${medidos} de ≈${estimados} estimados ` +
    `(${enBase.size} pedidos + ${medidos - enBase.size} vecinos del rango) · ${JSON.stringify(cuenta)}`,
);
// El mismo tope, ahora sobre lo que DE VERDAD se midió. La estimación de
// arriba sale de la base y el código de hoy puede haber crecido, así que esto
// es el respaldo: si el recorte se trajo medio módulo, se dice — aunque a estas
// alturas la máquina ya lo haya pagado.
if (medidos > plan.tope_local) {
  console.error(
    `\n⛔ el recorte midió ${medidos} mutantes (se estimaban ${estimados}), por encima del tope_local de ` +
      `${plan.tope_local}: eso ya no es «unos cuantos con nombre», y la estimación se quedó corta. Acota ` +
      `más, o pídelo: npm run mutacion -- pendiente\n`,
  );
  process.exit(1);
}
console.log(mal === 0 ? `\nLOS ${enBase.size} DETECTADOS` : `\n${mal} SIN DETECTAR`);
process.exit(mal === 0 ? 0 : 1);
