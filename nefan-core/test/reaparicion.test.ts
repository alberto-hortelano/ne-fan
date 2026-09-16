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
import type { Vec3 } from "../src/types.js";

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
    // punto donde el jugador ya está. Éste es el aserto BARATO de la puerta, y
    // NO basta solo: ver el de abajo, que es el que la cierra.
    assert.equal(puntoDeReaparicion.length, 1);
  });

  it("un argumento de MÁS ni se llama ni mueve el punto — que es lo que la aridad NO ve", () => {
    // `Function.length` deja de contar en el primer parámetro con valor por
    // defecto, así que el aserto de arriba deja pasar la forma MÁS probable de
    // que la consulta vuelva: añadirla como opcional, que es como se añade un
    // parámetro sin tocar al llamante. Medido por QA el 2026-09-16 sobre este
    // mismo árbol: con `solido: (…) => boolean = () => false` y `main.ts`
    // recableado, `npm run verify` daba 2847/2847 en VERDE y la aridad seguía
    // diciendo 1. Lo que sí lo caza es un espía que grita «sólido»: si algo de
    // fuera del punto decide, o se le llama, o el punto devuelto cambia.
    let llamadas = 0;
    const espia = (): boolean => {
      llamadas++;
      return true;
    };
    const rectDeOtroSitio = { minX: 32, minZ: 32, maxX: 96, maxZ: 96 };
    const conArgumentosDeMas = puntoDeReaparicion as unknown as (
      pos: { x: number; z: number },
      ...deMas: unknown[]
    ) => Vec3;
    assert.deepEqual(conArgumentosDeMas({ x: 12.5, z: -7.25 }, espia, rectDeOtroSitio), {
      x: 12.5,
      y: 0,
      z: -7.25,
    });
    assert.equal(llamadas, 0, "la consulta de solidez entró y se llamó: la puerta está abierta");
    // Lo que este par NO cubre, dicho para que nadie lo cuente de más: una
    // inyección a nivel de MÓDULO (un `setSolidoProvider()`, un import desde
    // core) no tiene forma de parámetro y pasaría por delante de los dos.
  });
});
