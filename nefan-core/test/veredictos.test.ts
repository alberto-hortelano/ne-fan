/** La escala ÚNICA de veredictos de QA (#331).
 *
 *  El sujeto es `qa/lib/veredictos.mjs`: los dos consumidores (`qa/run.mjs` y
 *  `qa/lib/presets-clasifica.mjs`) importan de ahí, así que lo que aquí se
 *  congela es la semántica compartida — sobre todo la del exit, que es la que
 *  hace que el canal `⊘` de un guion NO sea una vía de escape: un ⊘ degrada la
 *  corrida MÁS que un rojo (2 > 1), con lo que reconvertir un rojo en ⊘
 *  empeora el veredicto por construcción.
 *
 *  El import cruzado es la regla, no un precedente (#357): la dirección es
 *  test → banco (`el-banco-no-entra-en-produccion`, arch-rules.json) y todo
 *  módulo de `qa/lib` tiene un test que lo importe o una exención escrita
 *  (`test/qa-lib-tiene-quien-lo-mire.test.ts`). El banco es parte del aparato
 *  de este repositorio, no un tercero.
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
  SIN_AFIRMAR: string;
  veredictoDeGuion: (r: { fallos: string[]; afirmaciones: number }) => { estado: string; fallos: string[] };
};
const { VERDE, ROJO, SIN_MEDIR, ICONO, exitDeCorrida, SIN_AFIRMAR, veredictoDeGuion } = mod;

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

describe("veredictos: el verde de un guion exige haber AFIRMADO algo (#639)", () => {
  it("limpio y sin un solo aserto NO es verde: es rojo, y dice por qué", () => {
    const v = veredictoDeGuion({ fallos: [], afirmaciones: 0 });
    assert.equal(v.estado, ROJO);
    assert.deepEqual(v.fallos, [SIN_AFIRMAR]);
  });

  it("es ROJO y no SIN_MEDIR: el ⊘ se declara con su motivo, esto es un defecto del guion", () => {
    assert.notEqual(veredictoDeGuion({ fallos: [], afirmaciones: 0 }).estado, SIN_MEDIR);
  });

  it("la frase dice la salida, no solo el reproche: nombra `ctx.sinMedir`", () => {
    assert.match(SIN_AFIRMAR, /ctx\.sinMedir/);
  });

  it("limpio habiendo afirmado una vez sigue siendo verde (el caso de los 142)", () => {
    assert.deepEqual(veredictoDeGuion({ fallos: [], afirmaciones: 1 }), { estado: VERDE, fallos: [] });
  });

  it("afirmar y fallar es afirmar: con fallos NO se le cuelga encima un segundo diagnóstico falso", () => {
    // Un guion que revienta en la primera línea acumula el `ERROR: …` del
    // runner y cero asertos. Su causa es esa, no «no afirmó nada».
    const v = veredictoDeGuion({ fallos: ["ERROR: la página murió"], afirmaciones: 0 });
    assert.equal(v.estado, ROJO);
    assert.deepEqual(v.fallos, ["ERROR: la página murió"]);
  });

  it("no muta la lista de fallos que recibe: el runner la sigue usando", () => {
    const fallos: string[] = [];
    veredictoDeGuion({ fallos, afirmaciones: 0 });
    assert.deepEqual(fallos, []);
  });

  it("fail-loud: sin la cuenta de asertos no se inventa un veredicto", () => {
    for (const malo of [undefined, null, -1, 1.5, "3", NaN]) {
      assert.throws(
        () => veredictoDeGuion({ fallos: [], afirmaciones: malo as unknown as number }),
        /entero/,
        `afirmaciones = ${String(malo)} tendría que reventar`,
      );
    }
    assert.throws(() => veredictoDeGuion({ fallos: undefined as unknown as string[], afirmaciones: 1 }), /fallos/);
  });
});
