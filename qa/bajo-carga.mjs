#!/usr/bin/env node
/** EL REPRODUCTOR BAJO CARGA SINTÉTICA (#545).
 *
 *  ## Para qué existe
 *
 *  #545 nace de una varianza sin dueño: el mismo commit, el mismo árbol y sin
 *  una edición en vuelo dio 92/92 dos veces y 91/92 la tercera, con el guion 91
 *  rojo. La batería es la red de seguridad de todo lo que se mergea aquí, así
 *  que una red que puede mentir una vez de cada tres no sirve en ninguna de las
 *  dos direcciones.
 *
 *  La crítica identificó **48 guiones de 129** con el mismo patrón —esperar por
 *  RELOJ DE PARED a que el juego progrese— pero los identificó **leyendo**, sin
 *  un solo rojo reproducido. Un arreglo sobre eso no se puede juzgar: no hay
 *  contra qué. Esta herramienta es lo que falta antes de arreglar nada.
 *
 *  ## Qué hace, exactamente
 *
 *  Abre el guion **por el camino de siempre** (`qa/run.mjs`: su stack, su
 *  preset sin créditos, su disco efímero, su guardarraíl de gasto) y le frena el
 *  hilo principal a la página con `Emulation.setCPUThrottlingRate` por CDP. No
 *  toca ni un guion, ni un aserto, ni el juego.
 *
 *  Corre DOS veces: una quieta (`×1`, el control, por el mismo camino de código)
 *  y otra frenada (`×N`), y pone las dos al lado. El entregable no es el color
 *  del guion: es **la pareja** color + razón sim/pared, porque un rojo sin su
 *  razón no se distingue de un rojo cualquiera.
 *
 *  ## Por qué se niega a salir verde sin haber frenado nada
 *
 *  Si la carga no baja la razón sim/pared, esta herramienta **sale con error**.
 *  Un reproductor que no reproduce se lee como prueba de que no hay defecto, y
 *  eso es peor que no tenerlo: con `--factor 1` dice que no reprodujo nada en
 *  vez de firmar un verde. El umbral y la magnitud viven en `qa/lib/carga.mjs`,
 *  que es donde los mide `nefan-core/test/carga-sintetica.test.ts`.
 *
 *  ## Lo que NO se usa como palanca, y por qué
 *
 *  **`NEFAN_QA_GPU=0` (SwiftShader) no.** Medido en `qa/lib/navegador.mjs:1-23`
 *  en esta máquina: `gpu-process` al **791 % de CPU** y load **25 sobre 16**.
 *  Reproducir el defecto así sería quitarles la máquina a los demás agentes, que
 *  es justo lo que esta tanda existe para no hacer. El throttling de CDP frena
 *  **un solo renderer** y no sube el load: por eso esta herramienta se puede
 *  correr con alguien delante.
 *
 *  Aun así, cargar la máquina a propósito es el punto Y el peligro, así que
 *  imprime el `uptime` antes y después: si esta herramienta subiera el load,
 *  quedaría escrito en su propia salida.
 *
 *  ## Uso
 *
 *    node qa/bajo-carga.mjs 91 --factor 20
 *    node qa/bajo-carga.mjs 41 42 46 --factor 20 --sin-quieto
 *    node qa/bajo-carga.mjs 80 --factor 20 --concurrente 2
 *
 *    --factor N       cuánto se frena el hilo principal (1 = sin frenar)
 *    --umbral R       razón sim/pared por debajo de la cual la carga es real
 *    --sin-quieto     salta la corrida de control (hay que tenerla ya medida)
 *    --concurrente K  K corridas frenadas A LA VEZ. **Bandera explícita**: es
 *                     el escenario real de la batería, pero ocupa la máquina y
 *                     deja de ser un dial. Solo para confirmar que el rojo
 *                     sintético es el mismo rojo de la batería.
 *
 *  Salida:
 *    0  la carga fue real y está medida (el guion cambie o no de color)
 *    1  la carga NO fue real: no se ha reproducido nada
 *    2  no se pudo medir
 *
 *  Cero créditos: `qa/run.mjs` levanta `e2e-sin-creditos` y ejerce su
 *  guardarraíl de gasto para todos los guiones.
 *
 *  FUERA del job `candados-headless`: abre Chromium y levanta un stack.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UMBRAL_DE_CARGA_REAL,
  comparaCorridas,
  juzgaLaCarga,
  lineaDeMedida,
  razonDeLaMedida,
  veredictoDelReproductor,
} from "./lib/carga.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const args = process.argv.slice(2);
const CON_VALOR = new Set(["--factor", "--umbral", "--concurrente"]);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const FACTOR = Number(opt("--factor", "20"));
const UMBRAL = Number(opt("--umbral", String(UMBRAL_DE_CARGA_REAL)));
const CONCURRENTE = Number(opt("--concurrente", "1"));
const SIN_QUIETO = args.includes("--sin-quieto");
const FILTROS = args.filter((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1]));

if (!Number.isFinite(FACTOR) || FACTOR < 1) {
  console.error(`❌ --factor ${opt("--factor", "")} no es un factor de frenado (≥ 1)`);
  process.exit(2);
}
if (!Number.isFinite(CONCURRENTE) || CONCURRENTE < 1 || !Number.isInteger(CONCURRENTE)) {
  console.error(`❌ --concurrente ${opt("--concurrente", "")} no es un número de corridas (entero ≥ 1)`);
  process.exit(2);
}
if (!FILTROS.length) {
  console.error(
    "❌ sin guion: esto frena UNA página a propósito, y frenar los 129 guiones no es una medida,\n" +
      "   es una tarde. Di qué guion se reproduce, p. ej. `node qa/bajo-carga.mjs 91 --factor 20`.",
  );
  process.exit(2);
}

const TMP = mkdtempSync(join(tmpdir(), "nefan-bajo-carga-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

/** Dónde se queda la SALIDA ENTERA de las dos corridas.
 *
 *  No es un lujo: el diagnóstico de por qué un guion cambió de color vive en
 *  sus `ctx.log` —qué posición tenía el jugador, dónde cayó el spawn, qué midió
 *  cada sonda—, y un reproductor que tira ese scrollback obliga a repetir la
 *  corrida cara para leerlo. Va bajo `qa/capturas/`, que es donde ya vive la
 *  evidencia de la batería y está gitignorado. */
const SELLO = new Date().toISOString().replace(/[:.]/g, "-");
const REGISTRO = join(here, "capturas", "bajo-carga", `${SELLO}-${FILTROS.join("_")}`);
mkdirSync(REGISTRO, { recursive: true });

const carga = () => {
  const [m1, m5] = readFileSync("/proc/loadavg", "utf8").split(" ");
  return `load ${m1} (5 min: ${m5})`;
};

/** Una corrida de la batería, con su factor y su volcado de medida.
 *
 *  El entorno se hereda para que `--url`, `NEFAN_GAMES_DIR` y compañía sigan
 *  funcionando; lo que se pone aquí es la carga y el fichero donde volcarla.
 *  Con varias corridas a la vez se QUITA `NEFAN_PORT_OFFSET`: con él puesto,
 *  `qa/run.mjs` no elige bloque (ni reserva su lock) y las K corridas se
 *  pelearían por los mismos puertos — que es exactamente el fallo #501 que el
 *  lock por usuario vino a cerrar. */
function lanzar(etiqueta, factor, jsonPath, { soloUna }) {
  const env = { ...process.env, NEFAN_QA_CPU_FACTOR: String(factor), NEFAN_QA_CARGA_JSON: jsonPath };
  if (!soloUna) delete env.NEFAN_PORT_OFFSET;
  const proc = spawn("node", ["qa/run.mjs", ...FILTROS], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  const recoger = (b) => {
    salida += b;
    if (process.env.QA_VERBOSE) process.stdout.write(`[${etiqueta}] ${b}`);
  };
  proc.stdout.on("data", recoger);
  proc.stderr.on("data", recoger);
  const t0 = Date.now();
  return new Promise((res) =>
    proc.on("exit", (code) => {
      const ms = Date.now() - t0;
      const log = join(REGISTRO, `${etiqueta.replace(/[^\w×#-]/g, "_")}.log`);
      writeFileSync(log, salida);
      console.log(`  · ${etiqueta} terminó con ${code} en ${(ms / 1000).toFixed(1)} s · ${log}`);
      let medida = null;
      try {
        medida = JSON.parse(readFileSync(jsonPath, "utf8"));
      } catch {
        // Sin volcado no hay medida, y eso NO es «no hubo carga»: es que la
        // corrida no llegó a escribirlo (murió antes, o se quedó sin guiones).
        // Se dice con su salida, que es donde está el motivo de verdad.
        console.log(`  ⊘ ${etiqueta} no dejó medida en ${jsonPath}`);
        console.log(
          salida
            .split("\n")
            .slice(-15)
            .map((l) => `      ${l}`)
            .join("\n"),
        );
      }
      return res({ etiqueta, code, salida, ms, medida });
    }),
  );
}

const ICONO = { verde: "✔", rojo: "✘", "sin-medir": "⊘" };
const col = (s, n) => String(s).padEnd(n);

console.log(
  `▶ reproductor bajo carga · guion(es) ${FILTROS.join(" ")} · factor ×${FACTOR} · umbral ${UMBRAL}` +
    (CONCURRENTE > 1 ? ` · ${CONCURRENTE} corridas A LA VEZ` : ""),
);
console.log(`  antes: ${carga()}`);

// ── 1 · el control, quieto ────────────────────────────────────────────────
// Va por el MISMO camino (sesión CDP incluida, factor 1) para que la diferencia
// entre las dos corridas sea la carga y no el camino.
let quieta = null;
if (!SIN_QUIETO) {
  console.log("\n· corrida de CONTROL (×1, sin frenar)");
  quieta = await lanzar("quieto", 1, join(TMP, "quieto.json"), { soloUna: true });
}

// ── 2 · la corrida frenada ────────────────────────────────────────────────
console.log(`\n· corrida BAJO CARGA (×${FACTOR})`);
const cargadas =
  CONCURRENTE === 1
    ? [await lanzar(`carga×${FACTOR}`, FACTOR, join(TMP, "carga.json"), { soloUna: true })]
    : await Promise.all(
        Array.from({ length: CONCURRENTE }, (_, i) =>
          lanzar(`carga×${FACTOR}#${i + 1}`, FACTOR, join(TMP, `carga-${i + 1}.json`), { soloUna: false }),
        ),
      );

console.log(`\n  después: ${carga()}`);

// ── 3 · la medida, que es el entregable ───────────────────────────────────
const medidasDe = (r) => (r?.medida?.guiones ?? []).filter((g) => g.carga);
const juicios = [];
console.log(`\n${"─".repeat(78)}\nrazón sim/pared por corrida (lo que dice si la carga fue REAL)`);
for (const r of [...(quieta ? [quieta] : []), ...cargadas]) {
  const factor = r.medida?.factor ?? null;
  const g = medidasDe(r);
  if (!g.length) {
    console.log(`  ⊘ ${r.etiqueta}: ninguna medida de carga`);
    if (r !== quieta) juicios.push({ medido: false, real: false, razon: null, motivo: `${r.etiqueta}: sin medida` });
    continue;
  }
  for (const x of g) console.log(`  ${col(r.etiqueta, 14)} ${col(x.nombre.slice(0, 34), 36)} ${lineaDeMedida(x.carga, factor)}`);
  // El juicio de «¿fue real la carga?» solo se le pide a las corridas FRENADAS:
  // el control existe para salir con razón ≈ 1, así que exigirle lo contrario
  // sería exigirle que fallase.
  if (r !== quieta) {
    for (const x of g) {
      const j = juzgaLaCarga({ factor, medida: x.carga, umbral: UMBRAL });
      juicios.push({ ...j, motivo: `${r.etiqueta} · ${x.nombre}: ${j.motivo}` });
    }
  }
}

// ── 4 · el color, antes y después ─────────────────────────────────────────
// Se compara contra la PRIMERA corrida frenada; las demás (`--concurrente`)
// salen con su color al lado, sin promediarse: promediar dos corridas de una
// intermitencia es la forma más rápida de hacerla desaparecer.
const comparacion = quieta
  ? comparaCorridas(quieta.medida?.guiones, cargadas[0].medida?.guiones)
  : [];
if (comparacion.length) {
  console.log(`\n${"─".repeat(78)}\ncolor antes y después`);
  console.log(`  ${col("guion", 40)} ${col("quieto", 10)} ${col(`×${FACTOR}`, 10)} cambio`);
  for (const c of comparacion) {
    console.log(
      `  ${col(c.nombre.slice(0, 38), 40)} ${col(ICONO[c.quieto] ?? "—", 10)} ${col(ICONO[c.cargado] ?? "—", 10)} ${c.cambio}`,
    );
  }
  for (const c of comparacion) {
    if (c.cambio === "igual") continue;
    console.log(`\n  ${c.nombre} · ${c.cambio}`);
    for (const f of c.fallosQuieto) console.log(`    quieto ✘ ${f}`);
    for (const f of c.fallosCargado) console.log(`    ×${FACTOR} ✘ ${f}`);
  }
}
if (cargadas.length > 1) {
  console.log(`\n  las ${cargadas.length} corridas frenadas, guion a guion:`);
  for (const r of cargadas) {
    for (const g of r.medida?.guiones ?? []) {
      console.log(`    ${col(r.etiqueta, 18)} ${col(g.nombre.slice(0, 38), 40)} ${ICONO[g.estado] ?? "—"}`);
    }
  }
}

// ── 5 · el veredicto del REPRODUCTOR, que no es el de los guiones ─────────
const v = veredictoDelReproductor({ juicios, comparacion });
console.log(`\n${"─".repeat(78)}`);
console.log(`  la salida entera de las dos corridas: ${REGISTRO}`);
console.log(`${v.exit === 0 ? "✔" : v.exit === 1 ? "✘" : "⊘"} ${v.titulo}`);
for (const d of v.detalle) console.log(`  · ${d}`);
if (v.exit === 1) {
  console.log(
    "\n  Un reproductor que no reproduce se lee como prueba de que no hay defecto.\n" +
      "  Sube `--factor` hasta que la razón sim/pared baje; lo que NO se hace es\n" +
      "  bajar el umbral para que salga verde, ni meter carga con `NEFAN_QA_GPU=0`\n" +
      "  (SwiftShader: 791 % de CPU y load 25/16 medidos — es quitarle la máquina a los demás).",
  );
}
if (!quieta && v.exit === 0) {
  console.log(
    "  (sin corrida de control: el color de arriba no se ha comparado con nada — `--sin-quieto`)",
  );
}
process.exit(v.exit);
