/** La escala ÚNICA de veredictos de QA (#331).
 *
 *  El sujeto es `qa/lib/veredictos.mjs`: los dos consumidores (`qa/run.mjs` y
 *  `qa/lib/presets-clasifica.mjs`) importan de ahí, así que lo que aquí se
 *  congela es la semántica compartida — sobre todo la del exit, que es la que
 *  hace que el canal `⊘` de un guion NO sea una vía de escape: un ⊘ degrada la
 *  corrida MÁS que un rojo (2 > 1), con lo que reconvertir un rojo en ⊘
 *  empeora el veredicto por construcción.
 *
 *  Precedente del import cruzado: `test/presets-clasifica.test.ts` ya carga
 *  módulos de `qa/lib` desde aquí. El banco es parte del aparato de este
 *  repositorio, no un tercero.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mod = (await import(join(repoRoot, "qa", "lib", "veredictos.mjs"))) as {
  VERDE: string;
  ROJO: string;
  SIN_MEDIR: string;
  ICONO: Record<string, string>;
  exitDeCorrida: (rojos: number, noMedidos: number) => number;
};
const { VERDE, ROJO, SIN_MEDIR, ICONO, exitDeCorrida } = mod;

describe("veredictos: la escala única", () => {
  it("los tres estados son distintos y cada uno tiene su icono", () => {
    assert.equal(new Set([VERDE, ROJO, SIN_MEDIR]).size, 3);
    assert.equal(ICONO[VERDE], "✔");
    assert.equal(ICONO[ROJO], "✘");
    assert.equal(ICONO[SIN_MEDIR], "⊘");
  });

  it("el ⊘ es EXCLUSIVO de SIN_MEDIR: no hay otro estado con ese icono", () => {
    const conBarra = Object.entries(ICONO).filter(([, i]) => i === "⊘");
    assert.deepEqual(conBarra, [[SIN_MEDIR, "⊘"]]);
  });
});

describe("veredictos: el exit de la corrida", () => {
  it("todo verde → 0", () => {
    assert.equal(exitDeCorrida(0, 0), 0);
  });

  it("hay rojos y todo midió → 1: es el sujeto", () => {
    assert.equal(exitDeCorrida(1, 0), 1);
    assert.equal(exitDeCorrida(7, 0), 1);
  });

  it("algo sin medir → 2, aunque no haya ni un rojo", () => {
    assert.equal(exitDeCorrida(0, 1), 2);
  });

  it("el 2 gana al 1: con algo sin medir, ni los rojos son de fiar", () => {
    assert.equal(exitDeCorrida(5, 1), 2);
  });
});
