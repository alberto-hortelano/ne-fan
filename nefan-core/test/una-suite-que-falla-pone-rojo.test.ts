/**
 * Una suite que falla pone rojo `npm test` y `npm run coverage` (#697).
 *
 * Si el CUERPO de un `describe` lanza (un `JSON.parse` de un contrato roto, un
 * `readFileSync` de un fichero que falta, un helper que valida y lanza…), el
 * build tiene que quedar rojo. Lo hace el propio `node --test` desde v24.15.0
 * —antes salía con 0 y la suite desaparecía del resumen—, y por eso `engines`
 * declara `>=24.15` (bisección con binarios oficiales, 2026-09-23 y 2026-09-24:
 * 24.11.1 y 24.14.1 salen 0; 24.15.0 y 26.10.0 salen 1). Esto canda que las dos
 * entradas de npm lo siguen cumpliendo, corriendo su línea de comandos REAL (la
 * de `package.json`, no una copia) con el glob sustituido por una fixture:
 *
 * - sobre un `describe` que lanza → EXIT ≠ 0 y la suite nombrada con `✖`;
 * - sobre la misma forma sin el `throw` → EXIT 0 y sin avisos de Node.
 *
 * En un Node anterior a 24.15 los dos asertos de «lanza» salen ROJOS: ese es el
 * candado del suelo de `engines`, que npm por sí solo solo avisa.
 *
 * Ojo: Node cuenta la suite en el CÓDIGO DE SALIDA, no en el resumen (`ℹ fail 0`
 * también en Node 26). Quien decida por `ℹ fail N` sigue sin verla; por eso
 * aquí se mira `status`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLOB = "test/*.test.ts";
const LANZA = "test/fixtures/describe-que-lanza.ts";
const PASA = "test/fixtures/describe-que-pasa.ts";
const NOMBRE_ROTA = "✖ un describe cuyo cuerpo lanza";

const scripts = (JSON.parse(readFileSync(join(CORE, "package.json"), "utf8")) as { scripts: Record<string, string> })
  .scripts;

/** La línea REAL de un script con su glob sustituido por `fixture`. Exige que el
 *  glob aparezca UNA vez: si alguien lo parte o lo cambia, esto no sabría qué
 *  está corriendo y lo dice. */
function lineaSobre(script: "test" | "coverage", fixture: string): string {
  const linea = scripts[script];
  assert.ok(linea, `package.json no tiene scripts.${script}`);
  assert.equal(linea.split(GLOB).length - 1, 1, `scripts.${script} debe nombrar "${GLOB}" una sola vez: ${linea}`);
  return linea.replace(GLOB, fixture);
}

/** Corre la línea como la correría npm. Sin `NODE_TEST_CONTEXT`: este proceso
 *  es hijo de un `node --test` y la hereda, y con ella el `node --test` de
 *  dentro se porta como hijo (reporta al padre por el canal serializado y NO
 *  pasa por los reporters de la línea), así que mediría otra cosa. */
function corre(linea: string): { status: number | null; salida: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NEFAN_TEST_CONCURRENCY: "1" };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync("sh", ["-c", linea], { cwd: CORE, encoding: "utf8", env });
  return { status: r.status, salida: `${r.stdout}${r.stderr}` };
}

/** `coverage` escribe `coverage/lcov.info`: se desvía a un temporal para no pisar
 *  la medida de verdad. */
function conLcovTemporal<T>(fn: (lcov: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nefan-suite-roja-"));
  try {
    return fn(join(dir, "lcov.info"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lineaDeCoverage(fixture: string, lcov: string): string {
  const linea = lineaSobre("coverage", fixture);
  assert.ok(linea.includes("coverage/lcov.info"), `scripts.coverage ya no escribe coverage/lcov.info: ${linea}`);
  return linea.replace("coverage/lcov.info", lcov);
}

/** Lo que Node escribe en stderr cuando algo de la cadena (tsx, un reporter) usa
 *  una API en retirada: el `module.register()` de tsx < 4.22 sacaba un DEP0205
 *  por proceso en Node 26. */
const AVISOS = /DeprecationWarning|ExperimentalWarning|MaxListenersExceededWarning/;

describe("una suite que falla pone rojo las entradas de npm al runner (#697)", () => {
  it("npm test: un describe cuyo cuerpo lanza sale ≠ 0 y se nombra", () => {
    const r = corre(lineaSobre("test", LANZA));
    assert.notEqual(r.status, 0, r.salida);
    assert.ok(r.salida.includes(NOMBRE_ROTA), r.salida);
  });

  it("npm test: la misma forma sin el throw sale 0 y sin avisos de Node", () => {
    const r = corre(lineaSobre("test", PASA));
    assert.equal(r.status, 0, r.salida);
    assert.ok(!r.salida.includes("✖"), r.salida);
    assert.ok(!AVISOS.test(r.salida), r.salida);
  });

  it("npm run coverage: un describe cuyo cuerpo lanza sale ≠ 0 y se nombra", () => {
    conLcovTemporal((lcov) => {
      const r = corre(lineaDeCoverage(LANZA, lcov));
      assert.notEqual(r.status, 0, r.salida);
      assert.ok(r.salida.includes(NOMBRE_ROTA), r.salida);
    });
  });

  it("npm run coverage: la misma forma sin el throw sale 0 y sin avisos de Node", () => {
    conLcovTemporal((lcov) => {
      const r = corre(lineaDeCoverage(PASA, lcov));
      assert.equal(r.status, 0, r.salida);
      assert.ok(!AVISOS.test(r.salida), r.salida);
    });
  });
});
