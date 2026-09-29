/** EL MEDIDOR SE MIDE, Y EL BRIDGE ARRANCA O LO DICE (#769, tanda BJ).
 *
 *  La QA de la tanda BJ comprobó a mano que los candados nuevos de #769 se
 *  ponen rojos. Esto es la misma prueba, en negativo y repetible:
 *
 *   1. EL UNIVERSO DEL CORE es el árbol entero: un `.ts` en `bridge/` que ningún
 *      test carga, con una función de complejidad 9 (9² + 9 = 90 > 73), pone
 *      ROJO `npm run crap -- --check` y el rojo lo nombra.
 *   2. EL SUELO DEL CORE cuenta lo no cargado: sembrar en `services/` tantas
 *      líneas de código sin cargar como el margen impreso (+30) lo tira del 95.
 *   3. `--apretar` SOLO BAJA O QUITA: con una congelada de scripts SUBIDA a
 *      mano y otra inventada, `--scripts --apretar` deja el fichero byte a byte
 *      como estaba en git.
 *   4. `--apretar` SE NIEGA con una roja delante y no toca el fichero.
 *   5. EL AVISO DE SCRIPTS NOMBRA UN COMANDO QUE FUNCIONA: el `sobran` de
 *      `--scripts` recomienda una orden entre acentos graves; se corre tal cual
 *      en nefan-core y tiene que salir 0. (QA de BJ: decía `npm run crap -- --apretar`,
 *      que en nefan-core sale 2 — ese es el camino del cliente.)
 *   6. EL BRIDGE CON EL PUERTO DEL STATE API OCUPADO sale ≠ 0, dice el puerto y
 *      no deja el gateway escuchando (medio bridge no es un bridge).
 *   7. EL TEST DE ARRANQUE SE PONE ROJO, NO SE CUELGA: sin el oyente de
 *      `connection` en `arranque.ts`, `test/bridge-arranque.test.ts` tiene que
 *      FALLAR dentro de un plazo. (QA de BJ: se colgaba — `primerFrame` espera
 *      sin plazo y el job `nefan-core` de CI no tiene `timeout-minutes`.)
 *
 *  LO QUE NO MIRA: que el juego se comporte igual con el bridge nuevo (eso lo
 *  miden los guiones con navegador: 14, 17, 41, 78, 140, 171, 210…); ni la
 *  cifra de CI del suelo de scripts; ni el hueco entre el `listening` del
 *  gateway y el oyente de `connection` (solo se ve forzando un State API lento).
 *
 *  Necesita `nefan-core/coverage/lcov.info` al día (`npm run coverage`): lo
 *  dice y sale si falta. Cero créditos: no abre partida ni página. Muta
 *  `data/contract/scripts-crap.json` y `bridge/arranque.ts` y siembra dos
 *  ficheros `zz-sonda-230*`; lo restaura todo en `finally` y en SIGINT/SIGTERM,
 *  y se niega a arrancar si ya hay rastro. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "corre crap-score y un test de core en subprocesos, y arranca el bridge contra un puerto ocupado sin motor detrás; no abre partida";
export const sinNavegador = "mide los gates de CRAP y el arranque del bridge desde la línea de órdenes; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const LCOV = join(CORE, "coverage", "lcov.info");
const SCRIPTS_CRAP = join(CORE, "data", "contract", "scripts-crap.json");
const ARRANQUE = join(CORE, "bridge", "arranque.ts");
const SONDA_UNIVERSO = join(CORE, "bridge", "zz-sonda-230.ts");
const SONDA_SUELO = join(CORE, "services", "zz-sonda-230-suelo.ts");
const OYENTE = /^ {2}wss\.on\("connection"/m;
const PLAZO_TEST_MS = 90_000;

function crap(args) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/crap-score.ts", ...args], { cwd: CORE, encoding: "utf8" });
  return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function puertoLibre() {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function escuchable(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once("error", () => ok(false));
    s.listen(port, () => s.close(() => ok(true)));
  });
}

/** Arranca `ws-server.ts` y espera a que salga (o al plazo, que lo mata). */
function bridgeHastaQueSalga(env, plazoMs) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "bridge/ws-server.ts"], {
    cwd: CORE,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: plazoMs,
    killSignal: "SIGKILL",
  });
  const colgado = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  return { status: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}`, colgado };
}

const rastro = () => [SONDA_UNIVERSO, SONDA_SUELO].filter((f) => existsSync(f));

export default async function (ctx) {
  ctx.expect(
    "hay un lcov del core que medir (npm run coverage en nefan-core)",
    existsSync(LCOV),
    `falta ${LCOV}: corre \`npm run coverage\` en nefan-core antes de este guion`,
  );
  if (!existsSync(LCOV)) return;
  const previo = rastro();
  ctx.expect("el árbol viene sin sondas de una corrida anterior", previo.length === 0, `ya existen: ${previo.join(", ")}`);
  if (previo.length) return;

  turnoDeCandados("el-medidor-se-mide");
  const originalScripts = readFileSync(SCRIPTS_CRAP, "utf8");
  const originalArranque = readFileSync(ARRANQUE, "utf8");
  const restaura = () => {
    for (const f of [SONDA_UNIVERSO, SONDA_SUELO]) rmSync(f, { force: true });
    writeFileSync(SCRIPTS_CRAP, originalScripts);
    writeFileSync(ARRANQUE, originalArranque);
  };
  for (const [señal, codigo] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    process.on(señal, () => {
      restaura();
      process.exit(codigo);
    });
  }

  try {
    // ── BASE ───────────────────────────────────────────────────────────────
    const base = crap(["--check"]);
    ctx.expect("base: el core sale VERDE", base.status === 0, base.salida.slice(-600));
    const baseScripts = crap(["--scripts", "--check"]);
    ctx.expect("base: scripts sale VERDE", baseScripts.status === 0, baseScripts.salida.slice(-600));
    if (base.status !== 0 || baseScripts.status !== 0) return;
    const margen = Number(/margen [\d.-]+ puntos ≈ (-?\d+) líneas/.exec(base.salida)?.[1]);
    ctx.expect("base: el core imprime su margen en líneas", Number.isFinite(margen), base.salida.slice(-400));

    // ── 1. universo ────────────────────────────────────────────────────────
    const ifs = Array.from({ length: 8 }, (_, i) => `  if (a === ${i + 1}) return ${i + 1};`).join("\n");
    writeFileSync(SONDA_UNIVERSO, `export function sonda230(a: number): number {\n${ifs}\n  return 0;\n}\n`);
    const u = crap(["--check"]);
    ctx.expect(
      "1 · un fichero del bridge que nadie carga, con CRAP 90, pone ROJO el core y el rojo lo nombra",
      u.status === 1 && u.salida.includes("bridge/zz-sonda-230.ts"),
      `status ${u.status}: ${u.salida.slice(-500)}`,
    );
    rmSync(SONDA_UNIVERSO, { force: true });

    // ── 2. suelo ───────────────────────────────────────────────────────────
    if (Number.isFinite(margen)) {
      const n = Math.max(margen, 0) + 30;
      const cuerpo = Array.from({ length: n }, (_, i) => `t.push(${i});`).join("\n");
      writeFileSync(SONDA_SUELO, `export const t: number[] = [];\n${cuerpo}\n`);
      const s = crap(["--check"]);
      ctx.expect(
        `2 · ${n} líneas sin cargar en services/ tiran el suelo del 95`,
        s.status === 1 && /cobertura de líneas bajó/.test(s.salida),
        `status ${s.status}: ${s.salida.slice(-500)}`,
      );
      rmSync(SONDA_SUELO, { force: true });
    }

    // ── 3. apretar no sube ni añade ────────────────────────────────────────
    const contrato = JSON.parse(originalScripts);
    ctx.expect("la foto de scripts tiene congeladas con las que jugar", contrato.congeladas.length > 0, "congeladas vacía");
    if (contrato.congeladas.length === 0) return;
    const inflado = structuredClone(contrato);
    inflado.congeladas[0].crap += 50;
    inflado.congeladas.push({ fichero: "scripts/zz-inventado-230.ts", funcion: "nada", crap: 100 });
    writeFileSync(SCRIPTS_CRAP, JSON.stringify(inflado, null, 2) + "\n");

    // ── 5. (con la foto inflada delante) el aviso nombra un comando que funciona
    const aviso = crap(["--scripts"]);
    const recomendado = /SOBRAN[^`]*`([^`]+)`/.exec(aviso.salida)?.[1];
    ctx.expect("5 · con congeladas de más, scripts avisa SOBRAN y recomienda un comando", recomendado !== undefined, aviso.salida.slice(-500));
    if (recomendado !== undefined) {
      const r = spawnSync("bash", ["-c", recomendado], { cwd: CORE, encoding: "utf8" });
      writeFileSync(SCRIPTS_CRAP, JSON.stringify(inflado, null, 2) + "\n"); // por si ese comando lo reescribió
      ctx.expect(
        `5 · el comando que recomienda el aviso de scripts («${recomendado}») sale 0 en nefan-core`,
        r.status === 0,
        `sale ${r.status}: ${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-2).join(" | ")}`,
      );
    }

    const a = crap(["--scripts", "--apretar"]);
    const tras = readFileSync(SCRIPTS_CRAP, "utf8");
    ctx.expect(
      "3 · --apretar con una congelada subida y otra inventada deja el fichero byte a byte como en git",
      a.status === 0 && tras === originalScripts,
      `status ${a.status}; ${tras === originalScripts ? "fichero igual" : "EL FICHERO DIFIERE del de git"}: ${a.salida.slice(-400)}`,
    );

    // ── 4. apretar se niega con una roja ───────────────────────────────────
    const conRoja = structuredClone(contrato);
    conRoja.congeladas[0].crap = conRoja.tope + 1;
    const textoConRoja = JSON.stringify(conRoja, null, 2) + "\n";
    writeFileSync(SCRIPTS_CRAP, textoConRoja);
    const n4 = crap(["--scripts", "--apretar"]);
    ctx.expect(
      "4 · --apretar se NIEGA con una roja delante y no toca el fichero",
      n4.status === 1 && /se niega/.test(n4.salida) && readFileSync(SCRIPTS_CRAP, "utf8") === textoConRoja,
      `status ${n4.status}: ${n4.salida.slice(-300)}`,
    );
    writeFileSync(SCRIPTS_CRAP, originalScripts);

    // ── 6. bridge con el State API ocupado ─────────────────────────────────
    const gateway = await puertoLibre();
    const okupa = createServer();
    await new Promise((ok) => okupa.listen(0, "127.0.0.1", ok));
    const ocupado = okupa.address().port;
    try {
      const b = bridgeHastaQueSalga(
        { NEFAN_BRIDGE_PORT: String(gateway), NEFAN_STATE_HTTP_PORT: String(ocupado), NEFAN_SAVES_DIR: join(CORE, "coverage", "zz-saves-230") },
        30_000,
      );
      ctx.expect(
        "6 · el bridge con el State API ocupado SALE (≠ 0) y nombra el puerto",
        !b.colgado && b.status !== 0 && b.salida.includes(`:${ocupado}`),
        b.colgado ? "siguió vivo 30 s con medio bridge" : `status ${b.status}: ${b.salida.slice(-300)}`,
      );
      ctx.expect("6 · …y no deja el gateway escuchando", await escuchable(gateway), `:${gateway} sigue ocupado`);
    } finally {
      await new Promise((ok) => okupa.close(() => ok()));
      rmSync(join(CORE, "coverage", "zz-saves-230"), { recursive: true, force: true });
    }

    // ── 7. el test de arranque se pone rojo, no se cuelga ──────────────────
    ctx.expect("7 · arranque.ts sigue colgando el oyente de connection donde este guion lo busca", OYENTE.test(originalArranque), "¿renombrado? actualiza OYENTE");
    if (OYENTE.test(originalArranque)) {
      writeFileSync(ARRANQUE, originalArranque.replace(OYENTE, "  if (0) wss.on(\"connection\""));
      const t = spawnSync(
        process.execPath,
        ["--import", "tsx", "--test", "--test-isolation=none", "test/bridge-arranque.test.ts"],
        { cwd: CORE, encoding: "utf8", timeout: PLAZO_TEST_MS, killSignal: "SIGKILL" },
      );
      writeFileSync(ARRANQUE, originalArranque);
      const colgado = t.error?.code === "ETIMEDOUT" || t.signal === "SIGKILL";
      ctx.expect(
        `7 · sin el oyente de connection, bridge-arranque.test.ts FALLA en menos de ${PLAZO_TEST_MS / 1000} s (no se cuelga)`,
        !colgado && t.status === 1,
        colgado ? `se COLGÓ ${PLAZO_TEST_MS / 1000} s: en CI el job nefan-core no tiene timeout-minutes` : `status ${t.status}`,
      );
    }
  } finally {
    restaura();
  }

  ctx.expect("no queda ninguna sonda en el árbol", rastro().length === 0, rastro().join(", "));
  ctx.expect("scripts-crap.json y arranque.ts quedan como estaban", readFileSync(SCRIPTS_CRAP, "utf8") === originalScripts && readFileSync(ARRANQUE, "utf8") === originalArranque, "NO SE RESTAURÓ: mira git status");
  const fin = crap(["--check"]);
  ctx.expect("y el core vuelve a salir VERDE", fin.status === 0, fin.salida.slice(-300));
}
