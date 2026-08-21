/** Caracterización de `validateScene`: la red bajo el refactor por pasadas.
 *
 *  `validateScene` NO le habla a un humano: sus mensajes viajan al motor
 *  narrativo en el pre-flight de `narrative_respond` (vía `POST
 *  /scene/validate`), que re-responde sobre el mismo request leyéndolos. Por
 *  eso el TEXTO de cada error y el ORDEN en que salen son contrato, no
 *  detalle interno: cambiar «el spawn del player no es transitable» por otra
 *  frase, o emitir el aviso de costura antes que el de chars, cambia lo que
 *  el juego le pide al motor sin que ningún test de comportamiento se entere.
 *
 *  Este fichero congela la salida COMPLETA (`ok`, `errors` en orden,
 *  `warnings`, `stats`) de un corpus que ejerce las ocho pasadas —una a una y
 *  cuatro a la vez— contra `test/fixtures/scene-validate-golden.json`.
 *
 *  Si salta: NO regeneres el JSON para ponerlo verde. El diff te está
 *  diciendo exactamente qué le has cambiado al motor. Si el cambio es
 *  deliberado (una comprobación nueva, un mensaje mejor), edita el golden en
 *  el MISMO commit y dilo en la PR; si no lo es, el refactor ha movido
 *  comportamiento. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateScene, type SceneValidationResult } from "../src/scene/scene-validate.js";
import { casosDeValidacion } from "./fixtures/scene-validate-corpus.js";

const GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/scene-validate-golden.json", import.meta.url)), "utf-8"),
) as { casos: Record<string, SceneValidationResult> };

describe("validateScene — caracterización (texto y orden son contrato con el motor)", () => {
  const casos = casosDeValidacion();

  it("el golden y el corpus cubren exactamente los mismos casos", () => {
    assert.deepEqual(
      casos.map((c) => c.name).sort(),
      Object.keys(GOLDEN.casos).sort(),
      "un caso del corpus sin entrada en el golden (o al revés): regenera la entrada que falte a mano y revísala",
    );
  });

  for (const caso of casos) {
    it(`${caso.name} · ${caso.cubre}`, () => {
      const esperado = GOLDEN.casos[caso.name];
      assert.ok(esperado, `sin entrada en el golden para "${caso.name}"`);
      const real = validateScene(caso.scene(), caso.ctx);
      // Errores y avisos primero y por separado: son lo que lee el motor, y
      // un deepEqual del objeto entero los esconde detrás del primer stat.
      assert.deepEqual(real.errors, esperado.errors, `errores de "${caso.name}" (texto y ORDEN son contrato)`);
      assert.deepEqual(real.warnings, esperado.warnings, `avisos de "${caso.name}"`);
      assert.equal(real.ok, esperado.ok, `veredicto de "${caso.name}"`);
      assert.deepEqual(real.stats, esperado.stats, `telemetría de "${caso.name}"`);
    });
  }
});
