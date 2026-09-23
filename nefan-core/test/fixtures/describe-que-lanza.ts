/**
 * Fixture de `una-suite-que-falla-pone-rojo.test.ts`: un `describe` cuyo CUERPO
 * lanza, como lanzaría un contrato roto leído ahí. NO es `*.test.ts`: el glob de
 * `npm test` no lo recoge; el test lo corre a propósito.
 */
import { describe, it } from "node:test";

describe("un describe cuyo cuerpo lanza", () => {
  JSON.parse("{roto");
  it("nunca llega a correr", () => {});
});
