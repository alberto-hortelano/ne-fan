/**
 * Una suite que falla pone rojo `npm test` y `npm run coverage` (#697).
 *
 * `node --test` v24 sale con 0 cuando el CUERPO de un `describe` lanza: la
 * suite desaparece del resumen y el build queda verde. Lo arregla el reporter
 * `la-suite-que-falla-pone-rojo.ts`; esto canda que las dos entradas de npm lo
 * llevan, corriendo su línea de comandos REAL (la de `package.json`, no una
 * copia) con el glob sustituido por una fixture:
 *
 * - sobre un `describe` que lanza → EXIT ≠ 0 y la suite nombrada;
 * - sobre la misma forma sin el `throw` → EXIT 0 (el reporter no inventa rojos);
 * - la línea de `test` SIN el reporter → EXIT 0. Es el hecho que justifica el
 *   reporter: el día que Node lo arregle este aserto se pone rojo y el reporter
 *   sobra.
 *
 * La tercera entrada al runner, el `corre()` de `qa/contrato-candados-en-negativo.mjs`,
 * se canda en el propio arnés: su invariante de fixture rompe un contrato leído
 * solo en el cuerpo de un `describe` y sale VERDE si el reporter falta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIJO_SUITE_ROTA } from "./la-suite-que-falla-pone-rojo.js";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLOB = "test/*.test.ts";
const REPORTER = "--test-reporter=./test/la-suite-que-falla-pone-rojo.ts --test-reporter-destination=stdout";
const LANZA = "test/fixtures/describe-que-lanza.ts";
const PASA = "test/fixtures/describe-que-pasa.ts";

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

describe("una suite que falla pone rojo las entradas de npm al runner (#697)", () => {
  it("npm test lleva el reporter", () => {
    assert.ok(scripts.test?.includes(REPORTER), `scripts.test sin «${REPORTER}»: ${scripts.test}`);
  });

  it("npm test: un describe cuyo cuerpo lanza sale ≠ 0 y se nombra", () => {
    const r = corre(lineaSobre("test", LANZA));
    assert.notEqual(r.status, 0, r.salida);
    assert.ok(r.salida.includes(`${PREFIJO_SUITE_ROTA} un describe cuyo cuerpo lanza`), r.salida);
  });

  it("npm test: la misma forma sin el throw sale 0", () => {
    const r = corre(lineaSobre("test", PASA));
    assert.equal(r.status, 0, r.salida);
    assert.ok(!r.salida.includes(PREFIJO_SUITE_ROTA), r.salida);
  });

  it("npm run coverage: un describe cuyo cuerpo lanza sale ≠ 0 y se nombra", () => {
    conLcovTemporal((lcov) => {
      const r = corre(lineaDeCoverage(LANZA, lcov));
      assert.notEqual(r.status, 0, r.salida);
      assert.ok(r.salida.includes(`${PREFIJO_SUITE_ROTA} un describe cuyo cuerpo lanza`), r.salida);
    });
  });

  it("npm run coverage: la misma forma sin el throw sale 0 y sin avisos de listeners", () => {
    conLcovTemporal((lcov) => {
      const r = corre(lineaDeCoverage(PASA, lcov));
      assert.equal(r.status, 0, r.salida);
      assert.ok(!r.salida.includes("MaxListenersExceededWarning"), r.salida);
    });
  });

  it("sin el reporter, Node sigue saliendo con 0 (si esto se pone rojo, el reporter sobra)", () => {
    const linea = lineaSobre("test", LANZA);
    assert.ok(linea.includes(REPORTER));
    const r = corre(linea.replace(REPORTER, ""));
    assert.equal(
      r.status,
      0,
      `node --test ya sale ≠ 0 cuando un describe lanza: retirar test/la-suite-que-falla-pone-rojo.ts\n${r.salida}`,
    );
  });
});
