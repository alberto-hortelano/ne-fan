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
 *  Corre una vez quieta (`×1`, el control, por el mismo camino de código) y N
 *  veces frenada (`×N`), y pone las razones al lado de los colores. El entregable
 *  no es el color del guion: es **la pareja** color + razón sim/pared, porque un
 *  rojo sin su razón no se distingue de un rojo cualquiera.
 *
 *  ## Por qué se niega a salir verde sin haber frenado nada
 *
 *  Si no baja **ni la media ni la cola** —la razón sim/pared por un lado, el
 *  frame más largo por otro—, esta herramienta **sale con error**. Un reproductor
 *  que no reproduce se lee como prueba de que no hay defecto, y eso es peor que
 *  no tenerlo: con `--factor 1` dice que no reprodujo nada en vez de firmar un
 *  verde. Los dos umbrales y la magnitud viven en `qa/lib/carga.mjs`, que es
 *  donde los mide `nefan-core/test/carga-sintetica.test.ts`.
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
 *  ## El color de un guion bajo carga es una FRECUENCIA, no un desenlace
 *
 *  Medido en dos árboles sobre el 91, con carga real en todas: a **×20 sale rojo
 *  4 de 8 veces**; a **×40, 5 de 6**. Ni siquiera ×40 es un desenlace. Así que
 *  este reproductor no dice «se rompió»: dice **«rojo en R de N corridas
 *  frenadas»**, y `--repeticiones N` existe para que ese número sea una medida.
 *  El dial por defecto es **×40** y no ×20 porque la frecuencia sube, no porque
 *  el rojo pase a ser seguro: un reproductor intermitente que además imprime un
 *  verde tranquilizador es peor que uno lento.
 *
 *  ## Lo que este instrumento NO puede decir: de QUIÉN es el rojo
 *
 *  Un rojo bajo carga **no es, por sí solo, un rojo de #545**. Medido: el guion
 *  75 se pone rojo a ×20 y el aserto que cae es un CONTADOR contaminado por la
 *  vida ambiental — familia **#496/#497**. Así que clasifica en TRES y lo dice,
 *  sin atribuir nunca:
 *
 *   · **presupuesto** — el texto del fallo lleva una espera expirada.
 *     Compatible con #545, **no probado**.
 *   · **comportamiento** (#609) — no lleva esa firma, pero el guion DECLARÓ una
 *     TASA (`ctx.expectTasa`) que CAYÓ, con la razón sim/pared hundida en las
 *     corridas rojas: *compatible con #545 por comportamiento, sin firma de
 *     presupuesto*. Es lo que le faltaba al caso medido del 93 —razón 0,262,
 *     cuatro velocidades a 0,38-0,63 de lo esperado y ni un «ms» en sus
 *     asertos—, que salía «no atribuible» teniendo todo delante.
 *   · **sin-firma** — ninguna de las dos: **no atribuible**, que es la defensa
 *     que nació de #496/#497 y no se afloja. El rojo del 75 —un CONTADOR que
 *     sube— cae aquí, y no por cómo esté redactado: `ctx.expectTasa` pide la
 *     cantidad y sus SEGUNDOS DE PARED por separado, y un contador no tiene
 *     denominador de pared que darle. Con la lista de tasas vacía, la rama de
 *     `comportamiento` es inalcanzable.
 *
 *  Las dos primeras patas solas NO bastan y está medido: bajo `--factor 20` la
 *  razón se hunde también para el 75, así que «rojo nuevo + razón hundida»
 *  cambiaría una mentira por la contraria. La decisión sigue siendo de quien lee.
 *
 *  ## Uso
 *
 *    node qa/bajo-carga.mjs 91
 *    node qa/bajo-carga.mjs 91 --factor 40 --repeticiones 5
 *    node qa/bajo-carga.mjs 41 42 46 --sin-quieto
 *    node qa/bajo-carga.mjs 80 --concurrente 2
 *
 *    --factor N        cuánto se frena el hilo principal (1 = sin frenar).
 *                      Defecto 40; techo 100, porque el cero de más que todo el
 *                      mundo teclea alguna vez es una tarde en una máquina
 *                      compartida (medido: ×40 son 134-224 s por corrida)
 *    --repeticiones N  N corridas frenadas EN SERIE, para que la frecuencia sea
 *                      una medida y no una impresión
 *    --umbral R        razón sim/pared por debajo de la cual la carga es real.
 *                      El MISMO listón juzga la carga y sostiene la tercera
 *                      categoría de la clasificación (#609): un solo número
 *    --sin-quieto      salta la corrida de control (hay que tenerla ya medida)
 *    --concurrente K   K corridas frenadas A LA VEZ. **Bandera explícita**: es
 *                      el escenario real de la batería, pero ocupa la máquina y
 *                      deja de ser un dial. Solo para confirmar que el rojo
 *                      sintético es el mismo rojo de la batería.
 *
 *  Las cuatro opciones numéricas son **fail-loud**: un `--umbral abc` paraba en
 *  `NaN` y hacía pasar por buena cualquier medida, incluida la de `--factor 1`.
 *
 *  Salida:
 *    0  la carga fue real y está medida (el guion cambie o no de color)
 *    1  la carga NO fue real: no se ha reproducido nada
 *    2  no se pudo medir, o la corrida de CONTROL ya venía frenada
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
  FACTOR_MAXIMO,
  UMBRAL_DE_CARGA_REAL,
  comparaCorridas,
  juzgaElControl,
  juzgaLaCarga,
  lineaDeMedida,
  opcionNumerica,
  razonDeLaMedida,
  veredictoDelReproductor,
} from "./lib/carga.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const args = process.argv.slice(2);
const CON_VALOR = new Set(["--factor", "--umbral", "--concurrente", "--repeticiones"]);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const SIN_QUIETO = args.includes("--sin-quieto");
const FILTROS = args.filter((a, i) => !a.startsWith("--") && !CON_VALOR.has(args[i - 1]));

// LAS CUATRO opciones numéricas por el MISMO validador fail-loud. `--umbral` se
// quedó fuera la primera vez y eso bastó: `Number("abc") = NaN`, `razon > NaN`
// siempre false, y toda corrida pasaba por «carga real», incluida la de
// `--factor 1` que existe para negarse (H-2 de QA).
let FACTOR, UMBRAL, CONCURRENTE, REPETICIONES;
try {
  FACTOR = opcionNumerica("--factor", opt("--factor"), { min: 1, max: FACTOR_MAXIMO, porDefecto: 40 });
  UMBRAL = opcionNumerica("--umbral", opt("--umbral"), { min: 0.01, max: 0.999, porDefecto: UMBRAL_DE_CARGA_REAL });
  CONCURRENTE = opcionNumerica("--concurrente", opt("--concurrente"), { min: 1, max: 8, entero: true, porDefecto: 1 });
  REPETICIONES = opcionNumerica("--repeticiones", opt("--repeticiones"), { min: 1, max: 20, entero: true, porDefecto: 1 });
} catch (e) {
  console.error(`❌ ${e.message}`);
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
    (REPETICIONES > 1 ? ` · ${REPETICIONES} repeticiones` : "") +
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

// ── 2 · las corridas frenadas ─────────────────────────────────────────────
// En PLURAL desde la vuelta de QA: el defecto de #545 es probabilístico (medido:
// el 91 a ×20 sale rojo 1 de cada 5) y un desenlace binario sobre una muestra es
// una impresión. `--repeticiones N` van EN SERIE, una detrás de otra, porque el
// punto de este instrumento es no ocupar la máquina; en paralelo solo va lo que
// pide `--concurrente`, que es otra pregunta.
const cargadas = [];
for (let rep = 0; rep < REPETICIONES; rep++) {
  const sufijo = REPETICIONES > 1 ? ` ${rep + 1}/${REPETICIONES}` : "";
  console.log(`\n· corrida BAJO CARGA (×${FACTOR})${sufijo}`);
  const tanda =
    CONCURRENTE === 1
      ? [await lanzar(`carga×${FACTOR}${sufijo && `·${rep + 1}`}`, FACTOR, join(TMP, `carga-${rep}.json`), { soloUna: true })]
      : await Promise.all(
          Array.from({ length: CONCURRENTE }, (_, i) =>
            lanzar(`carga×${FACTOR}·${rep + 1}#${i + 1}`, FACTOR, join(TMP, `carga-${rep}-${i + 1}.json`), {
              soloUna: false,
            }),
          ),
        );
  cargadas.push(...tanda);
}

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

// ── 4 · el color, antes y después, CON SU FRECUENCIA ──────────────────────
// Se comparan TODAS las frenadas, no la primera: el color de un guion bajo carga
// es una frecuencia y no un desenlace, y quedarse con una muestra es la forma
// más rápida de hacer desaparecer una intermitencia.
// El umbral se ENHEBRA (#609): la tercera rama de la clasificación mira la
// razón sim/pared de las corridas rojas, y con el listón por defecto aquí y el
// de `--umbral` en el juicio de la carga, la misma corrida se juzgaría con dos
// listones distintos.
const comparacion = quieta
  ? comparaCorridas(quieta.medida?.guiones, cargadas.map((r) => r.medida?.guiones), { umbral: UMBRAL })
  : [];
if (comparacion.length) {
  console.log(`\n${"─".repeat(78)}\ncolor antes y después`);
  console.log(`  ${col("guion", 40)} ${col("quieto", 8)} ${col(`×${FACTOR}`, 14)} ${col("rojas", 8)} cambio`);
  for (const c of comparacion) {
    const colores = c.cargados.map((e) => ICONO[e] ?? "—").join("");
    console.log(
      `  ${col(c.nombre.slice(0, 38), 40)} ${col(ICONO[c.quieto] ?? "—", 8)} ${col(colores, 14)} ` +
        `${col(`${c.rojas}/${c.corridas}`, 8)} ${c.cambio}${c.firma ? ` · ${c.firma}` : ""}`,
    );
  }
  for (const c of comparacion) {
    if (c.cambio === "igual-verde") continue;
    console.log(`\n  ${c.nombre} · ${c.cambio}`);
    for (const f of c.fallosQuieto) console.log(`    quieto ✘ ${f}`);
    for (const f of c.fallosCargado) console.log(`    ×${FACTOR} ✘ ${f}`);
  }
}

// ── 5 · el veredicto del REPRODUCTOR, que no es el de los guiones ─────────
// De las medidas del control se juzga la de VENTANA MÁS LARGA: es la única que
// puede decir algo de la máquina. Con `80 75` la primera es la del 80, que dura
// dos segundos, y una razón sobre 1,9 s no es una razón.
const medidaDelControl = medidasDe(quieta ?? {})
  .map((g) => g.carga)
  .sort((a, b) => (b?.paredMs ?? 0) - (a?.paredMs ?? 0))[0];
const control = quieta ? juzgaElControl({ medida: medidaDelControl ?? null, umbral: UMBRAL }) : null;
if (control?.aviso) console.log(`\n  ⚠ ${control.aviso}`);
const v = veredictoDelReproductor({ juicios, comparacion, control });
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
