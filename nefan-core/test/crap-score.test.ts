/** El medidor de deuda también se mide.
 *
 *  Un cálculo de complejidad equivocado no se nota: produce una tabla con
 *  pinta de correcta y ordena mal la lista de trabajo. Estos casos fijan la
 *  definición de McCabe que usamos y el reparto de cobertura por rango — que
 *  ya dio un artefacto (una función con una arrow en su primera línea salía
 *  con 0% de cobertura) cuando se repartía "de una función a la siguiente". */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { functionsOf, lineHitsFromLcov, crap } from "../scripts/crap-score.js";

const cx = (code: string, name?: string): number => {
  const fns = functionsOf(code);
  const f = name ? fns.find((x) => x.name === name) : fns[0];
  assert.ok(f, `no se encontró la función ${name ?? "(primera)"} en:\n${code}`);
  return f.complexity;
};

describe("complejidad ciclomática", () => {
  it("una función sin ramas vale 1", () => {
    assert.equal(cx("function f() { return 1; }"), 1);
  });

  it("cada if suma 1", () => {
    assert.equal(cx("function f(a) { if (a) return 1; if (!a) return 2; return 3; }"), 3);
  });

  it("los bucles y el catch suman", () => {
    assert.equal(cx("function f(xs) { for (const x of xs) {} while (0) {} try {} catch {} }"), 4);
  });

  it("los operadores de cortocircuito suman: cada uno es una rama sin recorrer", () => {
    assert.equal(cx("function f(a, b, c) { return a && b || c; }"), 3);
    assert.equal(cx("function f(a, b) { return a ?? b; }"), 2);
  });

  it("el ternario suma", () => {
    assert.equal(cx("function f(a) { return a ? 1 : 2; }"), 2);
  });

  it("un case con cuerpo suma; el fallthrough vacío no", () => {
    assert.equal(cx("function f(x) { switch (x) { case 1: case 2: return 1; default: return 0; } }"), 2);
  });

  it("una función anidada NO suma a la de fuera: cada una se mide sola", () => {
    const code = "function fuera(a) { const dentro = (b) => (b ? 1 : 2); return a ? dentro(a) : 0; }";
    assert.equal(cx(code, "fuera"), 2);
    assert.equal(cx(code, "dentro"), 2);
  });

  it("el rango de una función abarca su cuerpo entero, arrows internas incluidas", () => {
    const code = ["function f(xs) {", "  const g = (x) => x + 1;", "  return xs.map(g);", "}"].join("\n");
    const f = functionsOf(code).find((x) => x.name === "f");
    assert.ok(f);
    assert.equal(f.startLine, 1);
    assert.equal(f.endLine, 4);
  });
});

describe("lectura del lcov", () => {
  it("indexa los hits por fichero y línea", () => {
    const lcov = ["TN:", "SF:src/a.ts", "DA:1,5", "DA:2,0", "end_of_record", "SF:src/b.ts", "DA:9,1", "end_of_record"].join("\n");
    const m = lineHitsFromLcov(lcov);
    assert.equal(m.get("src/a.ts")?.get(1), 5);
    assert.equal(m.get("src/a.ts")?.get(2), 0);
    assert.equal(m.get("src/b.ts")?.get(9), 1);
  });
});

describe("fórmula CRAP", () => {
  it("con cobertura total, el CRAP es la complejidad: probado no es deuda", () => {
    assert.equal(crap(30, 1), 30);
  });

  it("sin cobertura, la complejidad pesa al cuadrado", () => {
    assert.equal(crap(10, 0), 110);
  });

  it("es monótono: menos cobertura, más CRAP", () => {
    assert.ok(crap(10, 0.5) > crap(10, 0.9));
  });
});
