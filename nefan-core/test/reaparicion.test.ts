/** DÓNDE VUELVE EL JUGADOR AL MORIR (#241, PR 8 · podado por #538).
 *
 *  Eran seis líneas del `main.ts` del cliente, donde no hay harness, y son la
 *  única regla que decide en qué punto del mundo continúa la partida. Lo que se
 *  afirma es lo que se nota jugando: reaparecer donde caíste, y hacerlo con los
 *  pies en el suelo.
 *
 *  Lo que había debajo —las dos ramas que colgaban de una pregunta de solidez—
 *  murió con #538 y sus tres suites se fueron con ellas: ningún llamante podía
 *  contestar que sí a esa pregunta, así que candaban caminos que el juego no
 *  podía ejecutar. La cobertura que se pierde es la de un camino inexistente;
 *  lo que NO se pierde es que la puerta siga cerrada, y eso lo afirma el caso
 *  de la ARIDAD: el día que alguien quiera volver a decidir la reaparición
 *  mirando el mundo, tendrá que hacerlo con una consulta de PUNTO y poniendo
 *  este test rojo primero. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { puntoDeReaparicion } from "../src/simulation/reaparicion.js";

describe("puntoDeReaparicion · se vuelve donde se cayó", () => {
  it("devuelve exactamente el punto del cadáver, eje por eje", () => {
    // Descentrado y con los dos ejes distintos: cruzarlos o perder uno deja
    // rojo este único aserto.
    assert.deepEqual(puntoDeReaparicion({ x: 12.5, z: -7.25 }), { x: 12.5, y: 0, z: -7.25 });
  });

  it("no hay punto del mundo que no se conserve: ni lejos, ni en el origen", () => {
    assert.deepEqual(puntoDeReaparicion({ x: 500, z: -500 }), { x: 500, y: 0, z: -500 });
    assert.deepEqual(puntoDeReaparicion({ x: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  });
});

describe("puntoDeReaparicion · la base va a cero", () => {
  it("el jugador se apoya en el suelo: `y` es 0 y no viene del punto de entrada", () => {
    // `position.y` es la BASE en la world scene. Un punto con y ≠ 0 entierra al
    // jugador o le deja flotando. Se pregunta con un `y` de entrada que NO es 0
    // para que copiarlo se vea: el tipo no lo declara, pero el cliente pasa un
    // `playerPos` que lo lleva.
    const cadaverEnAlto = { x: 1, y: 9, z: 1 };
    assert.equal(puntoDeReaparicion(cadaverEnAlto).y, 0);
  });
});

describe("puntoDeReaparicion · lo que ya no pregunta", () => {
  it("tiene ARIDAD 1: no vuelve a entrar una consulta de solidez ni el rect del tile", () => {
    // La rama que preguntaba por sólidos murió en #538 por inalcanzable:
    // `collidesAt` es una consulta de MOVIMIENTO y nunca dice «sólido» del
    // punto donde el jugador ya está. Este aserto es la puerta: recablear aquí
    // una consulta que no sea de PUNTO tiene que costar un rojo.
    assert.equal(puntoDeReaparicion.length, 1);
  });
});
