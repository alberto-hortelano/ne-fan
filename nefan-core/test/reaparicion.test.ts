/** DÓNDE VUELVE EL JUGADOR AL MORIR (#241, PR 8).
 *
 *  Eran seis líneas del `main.ts` del cliente, donde no hay harness, y son la
 *  única regla que decide en qué punto del mundo continúa la partida. Los
 *  asertos de aquí son los que se notan jugando: reaparecer donde caíste,
 *  reaparecer en medio del tile cuando el sitio donde caíste está ocupado, y no
 *  quedarse sin punto cuando todavía no hay tile bajo los pies.
 *
 *  Los tres escalones se afirman por SEPARADO y con el mismo mundo delante:
 *  invertir la pregunta de solidez cambia dos casos a la vez, así que un solo
 *  aserto no distinguiría el original del mutante. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { puntoDeReaparicion } from "../src/simulation/reaparicion.js";
import type { WorldRect } from "../src/scene/tile.js";

const LIBRE = (): boolean => false;
const TODO_SOLIDO = (): boolean => true;

/** El tile (0,0) del mundo continuo: 64 m centrados en el origen. Su centro es
 *  el origen, así que para poder distinguir «centro del tile» de «origen del
 *  mundo» los casos usan un tile que NO está centrado ahí. */
const TILE_1_1: WorldRect = { minX: 32, minZ: 32, maxX: 96, maxZ: 96 };

describe("puntoDeReaparicion · el sitio libre gana", () => {
  it("si donde cayó no hay nada sólido, reaparece exactamente ahí", () => {
    assert.deepEqual(puntoDeReaparicion({ x: 12.5, z: -7.25 }, LIBRE, TILE_1_1), {
      x: 12.5,
      y: 0,
      z: -7.25,
    });
  });

  it("la pregunta de solidez se hace en el punto del cadáver, no en otro", () => {
    // Sólido solo en (5, 5): si la función preguntase por el origen, o por el
    // centro del tile, este caso saldría «libre» y devolvería (5,5).
    const soloAhi = (x: number, z: number): boolean => x === 5 && z === 5;
    assert.deepEqual(puntoDeReaparicion({ x: 5, z: 5 }, soloAhi, TILE_1_1), { x: 64, y: 0, z: 64 });
    assert.deepEqual(puntoDeReaparicion({ x: 5, z: 6 }, soloAhi, TILE_1_1), { x: 5, y: 0, z: 6 });
  });
});

describe("puntoDeReaparicion · ocupado: el centro del tile de debajo", () => {
  it("el centro es la media de las dos parejas, cada eje con la suya", () => {
    // minX/maxX dan la X y minZ/maxZ la Z: un rect NO cuadrado y descentrado
    // deja rojo cualquier cruce de ejes o cualquier `/ 2` que se pierda.
    const rect: WorldRect = { minX: 10, minZ: -40, maxX: 30, maxZ: 40 };
    assert.deepEqual(puntoDeReaparicion({ x: 11, z: 11 }, TODO_SOLIDO, rect), { x: 20, y: 0, z: 0 });
  });

  it("el tile de debajo manda aunque el cadáver esté en un borde", () => {
    assert.deepEqual(puntoDeReaparicion({ x: 32, z: 95.9 }, TODO_SOLIDO, TILE_1_1), {
      x: 64,
      y: 0,
      z: 64,
    });
  });
});

describe("puntoDeReaparicion · sin tile bajo los pies: el origen", () => {
  it("ocupado y sin rect devuelve el origen del mundo, a dos metros al sur", () => {
    assert.deepEqual(puntoDeReaparicion({ x: 500, z: -500 }, TODO_SOLIDO, null), { x: 0, y: 0, z: 2 });
  });

  it("sin tile pero con el sitio libre sigue mandando el sitio libre", () => {
    // El orden de los escalones: la ausencia de tile no puede teletransportar
    // al que murió en campo abierto.
    assert.deepEqual(puntoDeReaparicion({ x: 500, z: -500 }, LIBRE, null), { x: 500, y: 0, z: -500 });
  });
});

describe("puntoDeReaparicion · la base va a cero", () => {
  it("los tres escalones devuelven y = 0: el jugador se apoya en el suelo", () => {
    // `position.y` es la BASE en la world scene. Un punto con y ≠ 0 entierra al
    // jugador o le deja flotando, y ninguno de los tres caminos puede hacerlo.
    for (const p of [
      puntoDeReaparicion({ x: 1, z: 1 }, LIBRE, TILE_1_1),
      puntoDeReaparicion({ x: 1, z: 1 }, TODO_SOLIDO, TILE_1_1),
      puntoDeReaparicion({ x: 1, z: 1 }, TODO_SOLIDO, null),
    ]) {
      assert.equal(p.y, 0);
    }
  });
});

describe("puntoDeReaparicion · lo que NO promete", () => {
  it("el centro del tile no se vuelve a preguntar: es la conducta que tenía el cliente", () => {
    // Documentado en el módulo y afirmado aquí para que un cambio de conducta
    // no pueda entrar de tapadillo: con TODO sólido, el punto que devuelve
    // está ocupado. Se sale de él por la regla «salir sí, entrar no» de
    // `pasoDelJugador`, no por esta función.
    const p = puntoDeReaparicion({ x: 40, z: 40 }, TODO_SOLIDO, TILE_1_1);
    assert.deepEqual(p, { x: 64, y: 0, z: 64 });
    assert.equal(TODO_SOLIDO(), true, "el punto devuelto sigue siendo sólido y la función no lo mira");
  });
});
