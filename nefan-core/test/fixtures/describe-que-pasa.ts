/**
 * Fixture de `una-suite-que-falla-pone-rojo.test.ts`: la MISMA forma que
 * `describe-que-lanza.ts` sin el `throw`: la línea de npm no puede inventar un rojo.
 */
import { describe, it } from "node:test";

describe("un describe cuyo cuerpo no lanza", () => {
  JSON.parse("{}");
  it("corre y pasa", () => {});
});
