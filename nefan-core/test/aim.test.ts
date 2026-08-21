/** Puntería en primera persona: qué enfila la cámara.
 *
 *  Los criterios salen del comportamiento que el jugador debe ver (etiqueta
 *  del NPC con el que va a hablar, mirilla encendida), no de la implementación:
 *  lo de delante gana a lo cercano, lo de detrás no cuenta nunca, y una
 *  llamada sin dirección de mirada es un error, no un "no hay nada". */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickAimTarget } from "../src/scene/aim.js";

const ORIGIN = { x: 0, z: 0 };
/** Forward hacia −z, el mismo con el que arranca el jugador del cliente 2D. */
const NORTE = { x: 0, z: -1 };
const OPTS = { maxDistanceM: 12, coneRad: (10 * Math.PI) / 180 };

describe("puntería en primera persona", () => {
  it("elige lo que la cámara enfila, no lo más cercano", () => {
    const pick = pickAimTarget(
      ORIGIN,
      NORTE,
      [
        { id: "pegado_al_lado", pos: { x: 1.2, z: 0 } },
        { id: "enfrente", pos: { x: 0, z: -6 } },
      ],
      OPTS,
    );
    assert.equal(pick?.id, "enfrente");
    assert.equal(pick?.distanceM, 6);
    assert.equal(pick?.offAxisRad, 0);
  });

  it("lo que está a la espalda no se apunta jamás", () => {
    assert.equal(
      pickAimTarget(ORIGIN, NORTE, [{ id: "detras", pos: { x: 0, z: 4 } }], OPTS),
      null,
    );
  });

  it("fuera del cono no cuenta, dentro sí — y el cono es angular, no lineal", () => {
    // Mismo desvío lateral (1 m) a dos distancias: a 3 m se sale del cono de
    // 10° (18.4°), a 20 m entraría por ángulo... pero cae por alcance.
    const cerca = pickAimTarget(ORIGIN, NORTE, [{ id: "a", pos: { x: 1, z: -3 } }], OPTS);
    assert.equal(cerca, null, "1 m de desvío a 3 m son 18°: fuera");
    const lejos = pickAimTarget(ORIGIN, NORTE, [{ id: "a", pos: { x: 1, z: -10 } }], OPTS);
    assert.equal(lejos?.id, "a", "1 m de desvío a 10 m son 5.7°: dentro");
  });

  it("el alcance recorta antes que el ángulo", () => {
    assert.equal(
      pickAimTarget(ORIGIN, NORTE, [{ id: "lejos", pos: { x: 0, z: -12.01 } }], OPTS),
      null,
    );
    assert.equal(
      pickAimTarget(ORIGIN, NORTE, [{ id: "justo", pos: { x: 0, z: -12 } }], OPTS)?.id,
      "justo",
    );
  });

  it("a igualdad de ángulo gana el más cercano (el de delante tapa al de detrás)", () => {
    const pick = pickAimTarget(
      ORIGIN,
      NORTE,
      [
        { id: "fondo", pos: { x: 0, z: -9 } },
        { id: "delante", pos: { x: 0, z: -3 } },
      ],
      OPTS,
    );
    assert.equal(pick?.id, "delante");
  });

  it("se apunta a un CUERPO, no a su punto central", () => {
    // NPC a 1,5 m y medio paso a la izquierda: 21° de desviación, muy fuera
    // del cono de 10°, y aun así llena media pantalla. Sin el radio, el
    // nombre del personaje con el que hablas parpadeaba al moverse.
    const centro = [{ id: "npc", pos: { x: -0.55, z: -1.4 } }];
    assert.equal(pickAimTarget(ORIGIN, NORTE, centro, OPTS), null, "sin radio: fuera");
    const cuerpo = [{ id: "npc", pos: { x: -0.55, z: -1.4 }, radiusM: 0.6 }];
    assert.equal(pickAimTarget(ORIGIN, NORTE, cuerpo, OPTS)?.id, "npc", "con radio: dentro");
  });

  it("el radio NO resucita lo que está detrás", () => {
    // A la espalda y pegado: la distancia perpendicular a la línea de mirada
    // es pequeña, pero la línea de mirada va al otro lado.
    assert.equal(
      pickAimTarget(ORIGIN, NORTE, [{ id: "detras", pos: { x: 0.1, z: 0.6 }, radiusM: 2 }], OPTS),
      null,
    );
  });

  it("el forward no necesita venir normalizado", () => {
    const pick = pickAimTarget(ORIGIN, { x: 0, z: -37 }, [{ id: "a", pos: { x: 0, z: -5 } }], OPTS);
    assert.equal(pick?.id, "a");
  });

  it("sin candidatos no hay objetivo", () => {
    assert.equal(pickAimTarget(ORIGIN, NORTE, [], OPTS), null);
  });

  it("un forward nulo es un error, no un 'no hay nada'", () => {
    assert.throws(
      () => pickAimTarget(ORIGIN, { x: 0, z: 0 }, [{ id: "a", pos: { x: 0, z: -5 } }], OPTS),
      /forward nulo/,
    );
  });
});
