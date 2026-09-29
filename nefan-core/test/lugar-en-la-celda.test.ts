/** lugarEnLaCelda — qué place está activo en una celda de un tile (#465, H3).
 *  El rect es la HUELLA del lugar, así que las huellas se anidan (la posada
 *  dentro del pueblo): entre los rects que contienen la celda gana el MÁS
 *  PEQUEÑO, sea cual sea el orden de inserción del mapa. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { lugarEnLaCelda } from "../src/world-map/lugar-en-la-celda.js";
import type { Place } from "../src/world-map/types.js";

type Lugar = Pick<Place, "id" | "anchor">;
const T = { tx: 0, ty: 0 };
const pueblo: Lugar = { id: "pueblo", anchor: { tx: 0, ty: 0, rect: [20, 20, 60, 60] } };
const posada: Lugar = { id: "posada", anchor: { tx: 0, ty: 0, rect: [30, 30, 10, 10] } };
const comarca: Lugar = { id: "comarca", anchor: { tx: 0, ty: 0 } };
const vecino: Lugar = { id: "vecino", anchor: { tx: 1, ty: 0, rect: [0, 0, 128, 128] } };

describe("lugarEnLaCelda — rects anidados", () => {
  it("dentro de los dos rects gana el pequeño, en los DOS órdenes de inserción", () => {
    assert.equal(lugarEnLaCelda([pueblo, posada], T, 35, 35), "posada");
    assert.equal(lugarEnLaCelda([posada, pueblo], T, 35, 35), "posada");
  });

  it("en el grande y fuera del pequeño, el grande", () => {
    assert.equal(lugarEnLaCelda([posada, pueblo], T, 50, 50), "pueblo");
    assert.equal(lugarEnLaCelda([pueblo, posada], T, 50, 50), "pueblo");
  });

  it("los bordes: la primera celda entra, la de col+w / row+h ya no", () => {
    assert.equal(lugarEnLaCelda([posada], T, 30, 30), "posada");
    assert.equal(lugarEnLaCelda([posada], T, 39, 39), "posada");
    assert.equal(lugarEnLaCelda([posada], T, 40, 35), null);
    assert.equal(lugarEnLaCelda([posada], T, 35, 40), null);
    assert.equal(lugarEnLaCelda([posada], T, 29, 35), null);
    assert.equal(lugarEnLaCelda([posada], T, 35, 29), null);
  });

  it("si ningún rect casa, el primer lugar del tile SIN rect (el tile entero)", () => {
    const otraComarca: Lugar = { id: "otra", anchor: { tx: 0, ty: 0 } };
    assert.equal(lugarEnLaCelda([posada, comarca, otraComarca], T, 100, 100), "comarca");
    // …y un rect que casa gana al sin rect aunque vaya DESPUÉS.
    assert.equal(lugarEnLaCelda([comarca, posada], T, 35, 35), "posada");
  });

  it("otro tile, o lugares sin anchor, no cuentan: null", () => {
    assert.equal(lugarEnLaCelda([vecino, { id: "suelto" }], T, 10, 10), null);
    assert.equal(lugarEnLaCelda([vecino], { tx: 0, ty: 1 }, 10, 10), null);
    assert.equal(lugarEnLaCelda([vecino], { tx: 1, ty: 0 }, 10, 10), "vecino");
  });

  it("a igual área, el primero en orden de iteración", () => {
    const a: Lugar = { id: "a", anchor: { tx: 0, ty: 0, rect: [0, 0, 10, 20] } };
    const b: Lugar = { id: "b", anchor: { tx: 0, ty: 0, rect: [0, 0, 20, 10] } };
    assert.equal(lugarEnLaCelda([a, b], T, 5, 5), "a");
    assert.equal(lugarEnLaCelda([b, a], T, 5, 5), "b");
  });

  it("el prompt dice al motor la MISMA regla que se ejerce: la huella más pequeña gana", () => {
    const prompt = readFileSync(
      fileURLToPath(new URL("../data/contract/prompts/tile_instructions.md", import.meta.url)),
      "utf8",
    );
    assert.match(prompt, /where rects overlap, the SMALLEST one is the active place/);
    assert.match(prompt, /FOOTPRINT/);
  });
});
