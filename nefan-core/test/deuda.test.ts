/** La cola de deuda (`npm run deuda`) tiene un modo de fallo silencioso propio:
 *  quedarse vacía. Un backlog que imprime cero items se lee como "no hay deuda"
 *  y es indistinguible de un glob mal escrito o un report que no se generó —
 *  que es exactamente cómo envejeció `next.md`. Estos tests atan la cola a la
 *  misma fuente que el guardia de fronteras, para que no puedan divergir. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkArchitecture, reportByRule } from "../src/contract/arch/check.js";
import { archConfig, loadArchFiles } from "../scripts/arch-collect.js";
import { bloqueFronteras, unaLinea } from "../scripts/deuda.js";

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
