import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MARGEN_DE_REAPARICION_PX, rotulosTapados, type CajaDeRotulo } from "../src/scene/rotulos-apilados.js";

/** Una caja como la compone el cliente: ancla en el PIE, centrada, medida en
 *  píxeles CSS. Los números son los del juego real —un rótulo de ~140×20 px a
 *  la altura del horizonte de un lienzo de 1280×720—, no cifras redondas: el
 *  solape que esto criba se mide en una decena de píxeles. */
function caja(id: string, over: Partial<CajaDeRotulo> = {}): CajaDeRotulo {
  return { id, x: 640, y: 360, w: 140, h: 20, depthM: 10, ...over };
}

describe("rotulosTapados — de dos rótulos que se pisan solo se emite uno", () => {
  it("el paseo de ±4,5 px no hace reaparecer el rótulo cada pocos segundos (#591)", () => {
    let anteriores = new Set<string>();
    for (const cruce of [4.5, -4.5, 0, 4.5, -4.5]) {
      anteriores = rotulosTapados([caja("cerca", { x: 400, depthM: 6 }), caja("lejos", { x: 540 - cruce })], anteriores);
      assert.deepEqual([...anteriores], ["lejos"]);
    }
  });

  it("se libera en el mismo frame al dejar seis píxeles libres, por los cuatro lados", () => {
    const centro = caja("cerca", { x: 400, y: 360, depthM: 6 });
    for (const [eje, borde, sentido] of [["x", 540, 1], ["x", 260, -1], ["y", 380, 1], ["y", 340, -1]] as const) {
      for (const margen of [MARGEN_DE_REAPARICION_PX - 0.1, MARGEN_DE_REAPARICION_PX]) {
        const lejos = caja("lejos", { x: 400, y: 360, [eje]: borde + margen * sentido });
        const tapados = rotulosTapados([centro, lejos], new Set(["lejos"]));
        assert.equal(tapados.has("lejos"), margen < MARGEN_DE_REAPARICION_PX, `${eje} ${sentido} ${margen}`);
      }
    }
  });

  it("apuntar al oculto lo devuelve de inmediato; un ausente pierde su memoria", () => {
    const cerca = caja("cerca", { depthM: 6 });
    const lejos = caja("lejos", { focus: true });
    assert.deepEqual([...rotulosTapados([cerca, lejos], new Set(["lejos"]))], ["cerca"]);
    const vacio = rotulosTapados([], new Set(["lejos"]));
    assert.deepEqual([...rotulosTapados([caja("a", { x: 400 }), caja("lejos", { x: 540 })], vacio)], []);
    assert.deepEqual([...rotulosTapados([caja("lejos")], new Set(["lejos"]))], []);
  });
  it("dos cajas que no se tocan se emiten las dos", () => {
    const tapados = rotulosTapados([
      caja("cerca", { x: 400, depthM: 6 }),
      caja("lejos", { x: 900, depthM: 12 }),
    ]);
    assert.deepEqual([...tapados], []);
  });

  it("pegadas por el borde NO se tapan: tocarse no es pisarse", () => {
    // x=400 ocupa [330,470]; x=540 ocupa [470,610]. Comparten exactamente el
    // píxel 470 y ni uno más.
    const tapados = rotulosTapados([
      caja("cerca", { x: 400, depthM: 6 }),
      caja("lejos", { x: 540, depthM: 12 }),
    ]);
    assert.deepEqual([...tapados], []);
  });

  it("de dos que se pisan se ve el del CERCANO, venga en el orden que venga", () => {
    // 11 px de separación vertical: el solape medido entre dos personajes a 8 y
    // 10 m, menos que el alto de la caja.
    const cerca = caja("cerca", { y: 360, depthM: 8.3 });
    const lejos = caja("lejos", { y: 371, depthM: 12.3 });
    assert.deepEqual([...rotulosTapados([cerca, lejos])], ["lejos"]);
    // Y el orden de la lista no decide nada: la trae el mundo, no la cámara.
    assert.deepEqual([...rotulosTapados([lejos, cerca])], ["lejos"]);
  });

  it("…SALVO que el lejano sea el que la mirilla enfila: entonces se calla el cercano", () => {
    const cerca = caja("cerca", { y: 360, depthM: 8.3 });
    const lejos = caja("lejos", { y: 371, depthM: 12.3, focus: true });
    assert.deepEqual([...rotulosTapados([cerca, lejos])], ["cerca"]);
  });

  it("el enfilado gana aunque esté MUCHO más lejos: es a lo que apuntas", () => {
    const tapados = rotulosTapados([
      caja("a", { y: 360, depthM: 3 }),
      caja("b", { y: 366, depthM: 5 }),
      caja("enfilado", { y: 372, depthM: 17, focus: true }),
    ]);
    assert.deepEqual([...tapados].sort(), ["a", "b"]);
  });

  it("entre dos ENFILADOS manda la profundidad (la función no presupone que haya uno solo)", () => {
    const tapados = rotulosTapados([
      caja("lejos", { y: 371, depthM: 12, focus: true }),
      caja("cerca", { y: 360, depthM: 4, focus: true }),
    ]);
    assert.deepEqual([...tapados], ["lejos"]);
  });

  it("cadena de tres: solo TAPA lo colocado, así que el tercero se emite si el hueco del segundo queda libre", () => {
    // a (6 m) tapa a b (10 m); c (14 m) pisa a b pero NO a a. b no está en
    // pantalla: su hueco no puede callar a c.
    const tapados = rotulosTapados([
      caja("a", { y: 360, depthM: 6 }),
      caja("b", { y: 372, depthM: 10 }),
      caja("c", { y: 384, depthM: 14 }),
    ]);
    assert.deepEqual([...tapados], ["b"]);
  });

  it("cadena de tres apiladas de verdad: las dos de detrás se callan", () => {
    const tapados = rotulosTapados([
      caja("a", { y: 360, depthM: 6 }),
      caja("b", { y: 366, depthM: 10 }),
      caja("c", { y: 372, depthM: 14 }),
    ]);
    assert.deepEqual([...tapados].sort(), ["b", "c"]);
  });

  it("el ancla es el PIE de la caja, centrado: dos cajas con la MISMA y no se pisan si su alto no llega", () => {
    // Mismo ancla en x, anclas separadas 24 px en y con cajas de 20: la de
    // arriba ocupa [316,336] y la de abajo [340,360].
    const tapados = rotulosTapados([
      caja("arriba", { y: 336, depthM: 6 }),
      caja("abajo", { y: 360, depthM: 10 }),
    ]);
    assert.deepEqual([...tapados], []);
  });

  it("dos cuerpos a la MISMA profundidad no se cuelan los dos: gana el primero del mundo", () => {
    const tapados = rotulosTapados([
      caja("primero", { depthM: 7 }),
      caja("segundo", { depthM: 7, x: 660 }),
    ]);
    assert.deepEqual([...tapados], ["segundo"]);
  });

  it("una sola caja nunca se tapa a sí misma, y la lista vacía no es un error", () => {
    assert.deepEqual([...rotulosTapados([caja("solo")])], []);
    assert.deepEqual([...rotulosTapados([])], []);
  });

  it("fail-loud: una caja SIN TAMAÑO es una medida que no se hizo, y se dice nombrando el rótulo", () => {
    for (const rota of [{ w: 0 }, { h: 0 }, { w: -3 }, { w: Number.NaN }]) {
      assert.throws(
        () => rotulosTapados([caja("cerca"), caja("sin_medir", rota)]),
        /sin tamaño.*sin_medir|sin_medir.*sin tamaño/s,
        `una caja con ${JSON.stringify(rota)} tiene que lanzar`,
      );
    }
  });

  it("fail-loud: una posición que no es un número tampoco se cuela", () => {
    for (const rota of [{ x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { depthM: Number.NaN }]) {
      assert.throws(
        () => rotulosTapados([caja("mal", rota)]),
        /sin posición finita/,
        `una caja con ${JSON.stringify(rota)} tiene que lanzar`,
      );
    }
  });
});
