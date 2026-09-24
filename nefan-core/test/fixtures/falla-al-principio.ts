/**
 * Fixture de `ejercicio-de-bateria.test.ts`: el test que cae es el PRIMERO y
 * detrás pasan muchos, así que su `not ok` queda lejos de la cola del TAP —
 * la forma exacta del rojo de #751, que `stdout.slice(-2000)` dejaba sin nombre.
 * NO es `*.test.ts`: el glob de `npm test` no lo recoge; el test lo corre a
 * propósito.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("una batería con el rojo arriba", () => {
  it("el primero cae", () => {
    assert.equal(1, 2, "el primero cae con este mensaje");
  });
  for (let i = 0; i < 40; i++) {
    it(`relleno que pasa número ${i}, con un nombre largo para alargar el TAP`, () => {});
  }
});
