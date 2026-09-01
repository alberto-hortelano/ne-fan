/** Puntería en primera persona: qué enfila la cámara.
 *
 *  Los criterios salen del comportamiento que el jugador debe ver (etiqueta
 *  del NPC con el que va a hablar, mirilla encendida), no de la implementación:
 *  lo de delante gana a lo cercano, lo de detrás no cuenta nunca, mirar al
 *  suelo NO es mirar a quien tienes delante, y una llamada sin dirección de
 *  mirada es un error, no un "no hay nada". */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickAimTarget, pickNearestTarget } from "../src/scene/aim.js";

/** El ojo del jugador: 1,6 m sobre el suelo (EYE_M de la vista fps). */
const OJO = { x: 0, y: 1.6, z: 0 };
/** Forward hacia −z, el mismo con el que arranca el jugador del cliente. */
const NORTE = { x: 0, y: 0, z: -1 };
const OPTS = { maxDistanceM: 12, coneRad: (10 * Math.PI) / 180 };

/** Punto de mira de un personaje a ras de suelo: a la altura del ojo, que es
 *  donde se le mira. Los tests que no hablan de altura lo usan para que la
 *  geometría siga siendo la horizontal de siempre. */
const aLaVista = (x: number, z: number) => ({ x, y: OJO.y, z });

describe("puntería en primera persona", () => {
  it("elige lo que la cámara enfila, no lo más cercano", () => {
    const pick = pickAimTarget(
      OJO,
      NORTE,
      [
        { id: "pegado_al_lado", pos: aLaVista(1.2, 0) },
        { id: "enfrente", pos: aLaVista(0, -6) },
      ],
      OPTS,
    );
    assert.equal(pick?.id, "enfrente");
    assert.equal(pick?.distanceM, 6);
    assert.equal(pick?.offAxisRad, 0);
  });

  it("lo que está a la espalda no se apunta jamás", () => {
    assert.equal(
      pickAimTarget(OJO, NORTE, [{ id: "detras", pos: aLaVista(0, 4) }], OPTS),
      null,
    );
  });

  it("fuera del cono no cuenta, dentro sí — y el cono es angular, no lineal", () => {
    // Mismo desvío lateral (1 m) a dos distancias: a 3 m se sale del cono de
    // 10° (18.4°), a 20 m entraría por ángulo... pero cae por alcance.
    const cerca = pickAimTarget(OJO, NORTE, [{ id: "a", pos: aLaVista(1, -3) }], OPTS);
    assert.equal(cerca, null, "1 m de desvío a 3 m son 18°: fuera");
    const lejos = pickAimTarget(OJO, NORTE, [{ id: "a", pos: aLaVista(1, -10) }], OPTS);
    assert.equal(lejos?.id, "a", "1 m de desvío a 10 m son 5.7°: dentro");
  });

  it("el alcance recorta antes que el ángulo", () => {
    assert.equal(
      pickAimTarget(OJO, NORTE, [{ id: "lejos", pos: aLaVista(0, -12.01) }], OPTS),
      null,
    );
    assert.equal(
      pickAimTarget(OJO, NORTE, [{ id: "justo", pos: aLaVista(0, -12) }], OPTS)?.id,
      "justo",
    );
  });

  it("a igualdad de ángulo gana el más cercano (el de delante tapa al de detrás)", () => {
    const pick = pickAimTarget(
      OJO,
      NORTE,
      [
        { id: "fondo", pos: aLaVista(0, -9) },
        { id: "delante", pos: aLaVista(0, -3) },
      ],
      OPTS,
    );
    assert.equal(pick?.id, "delante");
  });

  it("se apunta a un CUERPO, no a su punto central", () => {
    // NPC a 1,5 m y medio paso a la izquierda: 21° de desviación, muy fuera
    // del cono de 10°, y aun así llena media pantalla. Sin el radio, el
    // nombre del personaje con el que hablas parpadeaba al moverse.
    const centro = [{ id: "npc", pos: aLaVista(-0.55, -1.4) }];
    assert.equal(pickAimTarget(OJO, NORTE, centro, OPTS), null, "sin radio: fuera");
    const cuerpo = [{ id: "npc", pos: aLaVista(-0.55, -1.4), radiusM: 0.6 }];
    assert.equal(pickAimTarget(OJO, NORTE, cuerpo, OPTS)?.id, "npc", "con radio: dentro");
  });

  it("el radio NO resucita lo que está detrás", () => {
    // A la espalda y pegado: la distancia perpendicular a la línea de mirada
    // es pequeña, pero la línea de mirada va al otro lado.
    assert.equal(
      pickAimTarget(OJO, NORTE, [{ id: "detras", pos: aLaVista(0.1, 0.6), radiusM: 2 }], OPTS),
      null,
    );
  });

  it("el forward no necesita venir normalizado", () => {
    const pick = pickAimTarget(OJO, { x: 0, y: 0, z: -37 }, [{ id: "a", pos: aLaVista(0, -5) }], OPTS);
    assert.equal(pick?.id, "a");
  });

  it("sin candidatos no hay objetivo", () => {
    assert.equal(pickAimTarget(OJO, NORTE, [], OPTS), null);
  });

  it("un forward nulo es un error, no un 'no hay nada'", () => {
    assert.throws(
      () => pickAimTarget(OJO, { x: 0, y: 0, z: 0 }, [{ id: "a", pos: aLaVista(0, -5) }], OPTS),
      /forward nulo/,
    );
  });

  // ── La vista dejó de ser de yaw puro ──────────────────────────────────────

  it("mirando al suelo NO se apunta a quien tienes delante", () => {
    // Es el caso que obligó a pasar de la proyección horizontal a la dirección
    // real de cámara: el jugador mira sus botas (−45°) y el NPC a 6 m seguía
    // con el nombre encendido y la mirilla dada.
    const npc = [{ id: "tabernero", pos: { x: 0, y: 1.0, z: -6 }, radiusM: 0.6, halfHeightM: 0.9 }];
    assert.equal(pickAimTarget(OJO, NORTE, npc, OPTS)?.id, "tabernero", "de frente: apuntado");
    const alSuelo = { x: 0, y: -1, z: -1 };
    assert.equal(pickAimTarget(OJO, alSuelo, npc, OPTS), null, "mirando abajo: nadie");
  });

  it("mirando al cielo tampoco", () => {
    const npc = [{ id: "tabernero", pos: { x: 0, y: 1.0, z: -6 }, radiusM: 0.6, halfHeightM: 0.9 }];
    assert.equal(pickAimTarget(OJO, { x: 0, y: 1, z: -1 }, npc, OPTS), null);
  });

  it("un cuerpo se INTERPONE en la mirada aunque su centro quede alto o bajo", () => {
    // Mirar a los pies de quien tienes a dos pasos sigue siendo mirarle: la
    // línea de mirada le atraviesa. Con pitch esto pasa constantemente.
    const npc = [{ id: "npc", pos: { x: 0, y: 1.0, z: -2 }, radiusM: 0.6, halfHeightM: 0.9 }];
    // 34° hacia abajo: 17° fuera del cono de 10°, así que si entra es por
    // cuerpo. La mirada le pasa por las rodillas.
    const alSuelo = { x: 0, y: -1, z: -1.5 };
    assert.equal(pickAimTarget(OJO, alSuelo, npc, OPTS)?.id, "npc");
  });

  it("el cuerpo es un elipsoide DE PIE, no una bola", () => {
    // Mismo candidato, misma mirada: con media altura de persona entra, y
    // tratado como esfera de su propia anchura, no. Declarar la altura no es
    // decoración — es lo que distingue un cuerpo de una canica.
    const mirada = { x: 0, y: -1, z: -1.5 };
    const conAltura = [{ id: "npc", pos: { x: 0, y: 1.0, z: -2 }, radiusM: 0.4, halfHeightM: 0.9 }];
    const comoBola = [{ id: "npc", pos: { x: 0, y: 1.0, z: -2 }, radiusM: 0.4 }];
    assert.equal(pickAimTarget(OJO, mirada, conAltura, OPTS)?.id, "npc");
    assert.equal(pickAimTarget(OJO, mirada, comoBola, OPTS), null);
  });

  it("una altura de cuerpo nula no cuela un objetivo imposible", () => {
    // Caso inválido: halfHeightM 0 no puede volver infinita la compresión ni
    // convertir en objetivo lo que la mirada no toca.
    const npc = [{ id: "npc", pos: { x: 3, y: 1.6, z: -1 }, radiusM: 0.6, halfHeightM: 0 }];
    assert.equal(pickAimTarget(OJO, NORTE, npc, OPTS), null);
  });

  it("el alcance se mide en 3D: lo que está alto queda más lejos", () => {
    // Un candidato justo en el borde del alcance horizontal, pero 5 m por
    // encima, está a 13 m del ojo: fuera.
    const alto = [{ id: "campanario", pos: { x: 0, y: 6.6, z: -12 } }];
    assert.equal(pickAimTarget(OJO, { x: 0, y: 5, z: -12 }, alto, OPTS), null);
  });
});

/** La hermana de proximidad: con qué puede TRATAR el jugador aquí.
 *
 *  Vive en el mismo fichero que `pickAimTarget` porque son dos criterios de «a
 *  qué me refiero» y separados es como divergen; y los asertos de aquí son los
 *  que fijan su diferencia, que es deliberada: mirar es angular, interactuar es
 *  de proximidad. */
describe("pickNearestTarget · con qué se puede tratar aquí", () => {
  const ALCANCE = { maxDistanceM: 2.5 };
  /** Los pies del jugador: la proximidad se mide en el suelo, no desde el ojo. */
  const ORIGEN = { x: 0, y: 0, z: 0 };

  it("gana el más cercano dentro del alcance", () => {
    const npcs = [
      { id: "lejos", pos: { x: 0, y: 0, z: -2 } },
      { id: "cerca", pos: { x: 0, y: 0, z: -1 } },
    ];
    assert.equal(pickNearestTarget(ORIGEN, npcs, ALCANCE)?.id, "cerca");
  });

  it("fuera del alcance no hay nadie con quien tratar", () => {
    const npcs = [{ id: "lejos", pos: { x: 0, y: 0, z: -3 } }];
    assert.equal(pickNearestTarget(ORIGEN, npcs, ALCANCE), null);
  });

  it("el borde exacto del alcance SÍ cuenta", () => {
    const npcs = [{ id: "justo", pos: { x: 0, y: 0, z: -2.5 } }];
    assert.equal(pickNearestTarget(ORIGEN, npcs, ALCANCE)?.id, "justo");
  });

  it("NO es angular: se habla con quien tienes al lado sin girarse", () => {
    // La diferencia con `pickAimTarget`, escrita como aserto: el mismo NPC a la
    // espalda no se MIRA y sí se puede saludar. Girarse para hablar sería
    // fricción sin ganancia.
    const detras = [{ id: "vecino", pos: { x: 0, y: 1.6, z: 1 } }];
    assert.equal(pickAimTarget(ORIGEN, NORTE, detras, OPTS), null);
    assert.equal(pickNearestTarget(ORIGEN, detras, ALCANCE)?.id, "vecino");
  });

  it("se mide en el SUELO: subirse a un cajón no te aleja", () => {
    const encima = [{ id: "en_el_cajon", pos: { x: 0, y: 40, z: -1 } }];
    assert.equal(pickNearestTarget(ORIGEN, encima, ALCANCE)?.id, "en_el_cajon");
  });

  it("con la lista vacía no hay nada, y no es un error", () => {
    assert.equal(pickNearestTarget(ORIGEN, [], ALCANCE), null);
  });

  it("a igualdad exacta gana el PRIMERO: el rótulo no puede parpadear", () => {
    const gemelos = [
      { id: "a", pos: { x: 1, y: 0, z: 0 } },
      { id: "b", pos: { x: -1, y: 0, z: 0 } },
    ];
    assert.equal(pickNearestTarget(ORIGEN, gemelos, ALCANCE)?.id, "a");
    assert.equal(pickNearestTarget(ORIGEN, [...gemelos].reverse(), ALCANCE)?.id, "b");
  });

  it("devuelve la distancia, que es lo que decide si se ofrece la acción", () => {
    const npcs = [{ id: "x", pos: { x: 3, y: 0, z: 4 } }];
    assert.equal(pickNearestTarget(ORIGEN, npcs, { maxDistanceM: 10 })?.distanceM, 5);
  });
});
