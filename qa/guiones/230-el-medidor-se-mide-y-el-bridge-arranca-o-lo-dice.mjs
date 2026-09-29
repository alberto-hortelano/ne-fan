/** EL BRIDGE ARRANCA O LO DICE (#769, tanda BJ).
 *
 *  La QA de la tanda BJ comprobó a mano que los candados nuevos de #769 se
 *  ponen rojos. Esto es la parte de esa prueba que solo se ve DESDE FUERA del
 *  proceso de test, en negativo y repetible:
 *
 *   6. EL BRIDGE CON EL PUERTO DEL STATE API OCUPADO sale ≠ 0, dice el puerto y
 *      no deja el gateway escuchando (medio bridge no es un bridge).
 *   7. EL TEST DE ARRANQUE SE PONE ROJO, NO SE CUELGA: sin el oyente de
 *      `connection` en `arranque.ts` —o con un `cerrar()` que se deja el State
 *      API— `test/bridge-arranque.test.ts` tiene que FALLAR dentro de un plazo.
 *      (QA de BJ: se colgaba; en CI eso era un runner parado horas.)
 *
 *  DÓNDE FUERON LOS APARTADOS 1-5 (universo y suelo del core, `--apretar` que
 *  solo baja, su negativa y la orden que recomienda el aviso de scripts): la
 *  primera versión los medía aquí con el `coverage/lcov.info` real, y el job
 *  `candados-headless` de CI no lo tiene. Generarlo allí eran 3-5 min más por
 *  PR (medido: el paso `npm run coverage` del job `nefan-core` tardó 189, 256 y
 *  332 s en las tres últimas corridas de main) para repetir la pasada que el
 *  job `nefan-core` ya hace. Se miden ahora en `npm test`, con datos sintéticos,
 *  en `test/crap-del-cliente.test.ts` («el CLI de crap · lo que antes solo
 *  medía el guion 230»), y el camino verde con el lcov real lo siguen
 *  corriendo `crap --check` y `crap -- --scripts --check` en `nefan-core`. La
 *  numeración se conserva para que `qa.md` siga apuntando bien.
 *
 *  LO QUE NO MIRA: que el juego se comporte igual con el bridge nuevo (eso lo
 *  miden los guiones con navegador: 14, 17, 41, 78, 140, 171, 210…); ni el
 *  hueco entre el `listening` del gateway y el oyente de `connection` (lo mide
 *  `bridge-arranque.test.ts` reteniendo el `listen` del State API).
 *
 *  Cero créditos: no abre partida ni página ni necesita lcov. Muta
 *  `bridge/arranque.ts`; lo restaura en `finally` y en SIGINT/SIGTERM. */

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { turnoDeCandados } from "../lib/turno-exclusivo.mjs";

export const sinMotor = "corre un test de core en un subproceso y arranca el bridge contra un puerto ocupado sin motor detrás; no abre partida";
export const sinNavegador = "mide el arranque del bridge desde la línea de órdenes; no hay cliente que conducir";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CORE = join(RAIZ, "nefan-core");
const ARRANQUE = join(CORE, "bridge", "arranque.ts");
const OYENTE = /^ {2}wss\.on\("connection"/m;
const CIERRE = "await Promise.all([cerrarServidor(wss), cerrarServidor(stateApi)]);";
const PLAZO_TEST_MS = 90_000;

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

/** El test de arranque con `arranque.ts` saboteado: tiene que FALLAR, no colgarse. */
function testDeArranqueCon(sabotaje, original) {
  writeFileSync(ARRANQUE, sabotaje);
  try {
    const t = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "--test-isolation=none", "test/bridge-arranque.test.ts"],
      { cwd: CORE, encoding: "utf8", timeout: PLAZO_TEST_MS, killSignal: "SIGKILL" },
    );
    return { colgado: t.error?.code === "ETIMEDOUT" || t.signal === "SIGKILL", status: t.status };
  } finally {
    writeFileSync(ARRANQUE, original);
  }
}

export default async function (ctx) {
  turnoDeCandados("el-medidor-se-mide");
  const originalArranque = readFileSync(ARRANQUE, "utf8");
  const restaura = () => writeFileSync(ARRANQUE, originalArranque);
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
    // ── 6. bridge con el State API ocupado ─────────────────────────────────
    const gateway = await puertoLibre();
    const okupa = createServer();
    await new Promise((ok) => okupa.listen(0, "127.0.0.1", ok));
    const ocupado = okupa.address().port;
    const saves = join(CORE, "coverage", "zz-saves-230");
    try {
      const b = bridgeHastaQueSalga(
        { NEFAN_BRIDGE_PORT: String(gateway), NEFAN_STATE_HTTP_PORT: String(ocupado), NEFAN_SAVES_DIR: saves },
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
      rmSync(saves, { recursive: true, force: true });
    }

    // ── 7. el test de arranque se pone rojo, no se cuelga ──────────────────
    ctx.expect("7 · arranque.ts sigue colgando el oyente de connection donde este guion lo busca", OYENTE.test(originalArranque), "¿renombrado? actualiza OYENTE");
    if (OYENTE.test(originalArranque)) {
      const r = testDeArranqueCon(originalArranque.replace(OYENTE, '  if (0) wss.on("connection"'), originalArranque);
      ctx.expect(
        `7 · sin el oyente de connection, bridge-arranque.test.ts FALLA en menos de ${PLAZO_TEST_MS / 1000} s (no se cuelga)`,
        !r.colgado && r.status === 1,
        r.colgado ? `se COLGÓ ${PLAZO_TEST_MS / 1000} s` : `status ${r.status}`,
      );
    }
    ctx.expect("7 · arranque.ts sigue cerrando los dos servidores donde este guion lo busca", originalArranque.includes(CIERRE), "¿reescrito? actualiza CIERRE");
    if (originalArranque.includes(CIERRE)) {
      const r = testDeArranqueCon(originalArranque.replace(CIERRE, "await cerrarServidor(wss);"), originalArranque);
      ctx.expect(
        `7 · con un cerrar() que se deja el State API, bridge-arranque.test.ts FALLA en menos de ${PLAZO_TEST_MS / 1000} s`,
        !r.colgado && r.status === 1,
        r.colgado ? `se COLGÓ ${PLAZO_TEST_MS / 1000} s` : `status ${r.status}`,
      );
    }
  } finally {
    restaura();
  }

  ctx.expect("arranque.ts queda como estaba", readFileSync(ARRANQUE, "utf8") === originalArranque, "NO SE RESTAURÓ: mira git status");
  const verde = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/bridge-arranque.test.ts"], {
    cwd: CORE,
    encoding: "utf8",
    timeout: PLAZO_TEST_MS,
    killSignal: "SIGKILL",
  });
  ctx.expect("y el test de arranque vuelve a salir VERDE", verde.status === 0, `${verde.stdout ?? ""}${verde.stderr ?? ""}`.slice(-300));
}
