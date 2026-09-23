/**
 * Fixture de `una-suite-que-falla-pone-rojo.test.ts`: la MISMA forma que
 * `describe-que-lanza.ts` sin el `throw`. El reporter no puede poner rojo esto.
 */
import { describe, it } from "node:test";

describe("un describe cuyo cuerpo no lanza", () => {
  JSON.parse("{}");
  it("corre y pasa", () => {});
});
