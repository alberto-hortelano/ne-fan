/** La cola de deuda (`npm run deuda`) tiene un modo de fallo silencioso propio:
 *  quedarse vacía. Un backlog que imprime cero items se lee como "no hay deuda"
 *  y es indistinguible de un glob mal escrito o un report que no se generó —
 *  que es exactamente cómo envejeció `next.md`. Estos tests atan la cola a la
 *  misma fuente que el guardia de fronteras, para que no puedan divergir. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkArchitecture, reportByRule } from "../src/contract/arch/check.js";
import { archConfig, loadArchFiles } from "../scripts/arch-collect.js";
import { bloqueFronteras, enColaDeCrap, unaLinea } from "../scripts/deuda.js";

describe("cola de deuda · fronteras", () => {
  const reports = reportByRule(archConfig, checkArchitecture(archConfig, loadArchFiles()));
  const congeladas = reports.filter((r) => r.rule.severity === "warn");

  it("lista exactamente las violaciones que el guardia tiene congeladas", () => {
    const esperadas = congeladas.reduce((n, r) => n + r.violations.length, 0);
    assert.equal(bloqueFronteras().items.length, esperadas);
  });

  it("no puede quedarse vacía mientras haya deuda congelada", () => {
    // Si algún día se salda toda, este test cae con el cambio que la salda —
    // y esa es la señal de que toca retirar las reglas warn del JSON.
    assert.ok(congeladas.length > 0, "no hay reglas warn: retira este test con ellas");
    assert.ok(bloqueFronteras().items.length > 0);
  });

  it("cada item lleva ubicación fichero:línea, no solo el nombre de la regla", () => {
    for (const item of bloqueFronteras().items) {
      assert.match(item.donde, /^[\w./-]+:\d+$/, `ubicación inservible: ${item.donde}`);
    }
  });
});

describe("cola de deuda · complejidad × cobertura", () => {
  // Datos sintéticos, NO el lcov real: `npm test` corre antes que
  // `npm run coverage` y `coverage/` no se versiona, así que contra datos
  // reales estos tests pasarían en verde sobre una lista vacía. Pasó: la
  // primera versión de este fichero rompió el CI por eso, y el test de las
  // anónimas pasaba en vacío, que es peor que fallar.
  const fila = (name: string, crap: number, coverage: number) => ({
    name,
    startLine: 1,
    endLine: 9,
    complexity: 5,
    file: "src/x.ts",
    coverage,
    crap,
  });

  it("una función con nombre y 0% de cobertura entra aunque su CRAP sea bajo", () => {
    // El caso exacto de `handleTileAnalysis`: CRAP 30,0 con el umbral en > 30.
    const cola = enColaDeCrap([fila("handleTileAnalysis", 30, 0)], 30);
    assert.deepEqual(
      cola.map((f) => f.name),
      ["handleTileAnalysis"],
    );
  });

  it("no lista arrows anónimas sin cubrir: no son un sitio donde alguien pueda actuar", () => {
    const cola = enColaDeCrap([fila("(anónima)", 12, 0)], 30);
    assert.deepEqual(cola, []);
  });

  it("una anónima SÍ entra si es su complejidad la que se dispara", () => {
    // El filtro es solo para la regla de cobertura cero: por CRAP entra igual.
    const cola = enColaDeCrap([fila("(anónima)", 66, 0.11)], 30);
    assert.equal(cola.length, 1);
  });

  it("lo bien cubierto y poco complejo no entra", () => {
    assert.deepEqual(enColaDeCrap([fila("trivial", 5, 1)], 30), []);
  });

  it("el umbral es estricto: justo en el objetivo no entra", () => {
    assert.deepEqual(enColaDeCrap([fila("justa", 30, 0.5)], 30), []);
  });
});

describe("cola de deuda · legibilidad", () => {
  it("colapsa los saltos serializados del detalle", () => {
    assert.equal(unaLinea("catch {\\n  // nada\\n}"), "catch { // nada }");
  });

  it("colapsa también los saltos reales", () => {
    assert.equal(unaLinea("catch {\n  // nada\n}"), "catch { // nada }");
  });

  it("recorta lo largo con puntos suspensivos", () => {
    const out = unaLinea("x".repeat(200), 20);
    assert.equal(out.length, 20);
    assert.ok(out.endsWith("…"));
  });
});
