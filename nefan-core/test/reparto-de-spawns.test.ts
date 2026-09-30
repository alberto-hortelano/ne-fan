/** El reparto de lo que el motor pone en UN turno (#524).
 *
 *  Lo que se afirma no son tres números sino una PROPIEDAD: entre dos cosas
 *  cualesquiera del mismo turno queda el hueco que hace falta para pasar,
 *  midan lo que midan. Los números concretos van detrás, y son los que el
 *  crítico midió del reparto viejo — para que el rojo, si llega, diga cuánto
 *  se ha perdido y no solo que algo cambió.
 *
 *  POR QUÉ NO BASTA UN CASO: un turno de UNA sola cosa da 0 con el reparto
 *  nuevo y con el viejo, así que no distingue una regla de su contraria. En
 *  esta casa ese verde ha aparecido cinco veces (`feedback_verde_que_no_
 *  comprueba.md`), así que aquí se mide con varias, de tamaños distintos y con
 *  el edificio grande de por medio. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  anclaDentroDelTile,
  HOLGURA_ENTRE_SPAWNS_M,
  mediaAnchura,
  repartirEnElTurno,
  type CuerpoDelTurno,
} from "../src/narrative/reparto-de-spawns.js";
import { PLAYER_RADIUS_M } from "../src/scene/terrain-collision.js";

/** El reparto VIEJO, escrito aquí para poder comparar: 1,8 m fijos alternando
 *  lado, sin mirar el tamaño. No es código de producción —se retiró con este
 *  módulo—, es la referencia contra la que se miden las cifras del issue. */
function repartoViejo(n: number): number[] {
  return Array.from({ length: n }, (_, i) => {
    const paso = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? 1 : -1);
    return paso * 1.8;
  });
}

/** El hueco LIBRE entre las caras de dos cuerpos ya colocados. Negativo = se
 *  solapan, que es lo que pasaba con dos edificios. */
function huecoEntre(cuerpos: readonly CuerpoDelTurno[], x: readonly number[], i: number, j: number): number {
  return Math.abs(x[i] - x[j]) - mediaAnchura(cuerpos[i]) - mediaAnchura(cuerpos[j]);
}

/** LA PROPIEDAD, sobre todos los pares. */
function afirmaQueNadieSeToca(cuerpos: readonly CuerpoDelTurno[], etiqueta: string): number[] {
  const x = repartirEnElTurno(cuerpos);
  assert.equal(x.length, cuerpos.length, `${etiqueta}: falta el sitio de alguien`);
  for (let i = 0; i < cuerpos.length; i++) {
    for (let j = i + 1; j < cuerpos.length; j++) {
      const hueco = huecoEntre(cuerpos, x, i, j);
      assert.ok(
        hueco >= HOLGURA_ENTRE_SPAWNS_M - 1e-9,
        `${etiqueta}: entre ${cuerpos[i].kind}[${i}] y ${cuerpos[j].kind}[${j}] quedan ` +
          `${hueco.toFixed(2)} m y hacen falta ${HOLGURA_ENTRE_SPAWNS_M} (posiciones ${JSON.stringify(x)})`,
      );
    }
  }
  return x;
}

describe("repartirEnElTurno — la separación mira la HUELLA, no un número fijo (#524)", () => {
  it("el hueco entre caras es el cuerpo del jugador y un palmo, y eso no es un número a ojo", () => {
    assert.equal(HOLGURA_ENTRE_SPAWNS_M, 2 * PLAYER_RADIUS_M + 0.2);
    assert.ok(
      HOLGURA_ENTRE_SPAWNS_M > 2 * PLAYER_RADIUS_M,
      "con exactamente el ancho del jugador las dos cajas infladas se tocan y el pasillo no se cruza",
    );
  });

  it("EL PRIMERO no se mueve: un turno de una sola cosa cae donde siempre", () => {
    // Y se dice aquí para que quede claro que este caso NO mide el reparto:
    // el viejo daba lo mismo. Los que miden son los de abajo.
    assert.deepEqual(repartirEnElTurno([{ kind: "object" }]), [0]);
    assert.deepEqual(repartirEnElTurno([{ kind: "building" }]), [0]);
    assert.deepEqual(repartirEnElTurno([]), []);
  });

  it("LOS TRES CASOS QUE EL CRÍTICO MIDIÓ, con su cifra de antes y la de ahora", () => {
    // 1 · dos `object` (1,5 m de lado): 1,8 − 0,75 − 0,75 = 0,3 m de hueco. El
    //     cuerpo del jugador mide 0,8: el pasillo existía y no se cruzaba.
    const dosObjetos: CuerpoDelTurno[] = [{ kind: "object" }, { kind: "object" }];
    assert.equal(huecoEntre(dosObjetos, repartoViejo(2), 0, 1).toFixed(2), "0.30");
    const objetos = afirmaQueNadieSeToca(dosObjetos, "dos object");
    assert.equal(huecoEntre(dosObjetos, objetos, 0, 1).toFixed(2), "1.00");

    // 2 · dos `building` (4 m de lado, media huella 2): se SOLAPAN. La cifra
    //     del crítico —0,4 m— es la del par que cae a los DOS lados (+1,8 y
    //     −1,8, o sea 3,6 m entre centros); el par vecino, que es el que un
    //     turno de dos produce, se solapaba 2,2 m. Se miden las dos, porque
    //     las dos son ciertas y la peor es la que más se ve.
    const dosEdificios: CuerpoDelTurno[] = [{ kind: "building" }, { kind: "building" }];
    assert.equal(huecoEntre(dosEdificios, repartoViejo(2), 0, 1).toFixed(2), "-2.20", "vecinos");
    const tresEdificios: CuerpoDelTurno[] = [...dosEdificios, { kind: "building" }];
    assert.equal(huecoEntre(tresEdificios, repartoViejo(3), 1, 2).toFixed(2), "-0.40", "los de los dos lados");
    const edificios = afirmaQueNadieSeToca(dosEdificios, "dos building");
    assert.equal(huecoEntre(dosEdificios, edificios, 0, 1).toFixed(2), "1.00");
    afirmaQueNadieSeToca(tresEdificios, "tres building");

    // 3 · un `npc` junto a un `building`: 1,8 contra 2 m de media huella. El
    //     personaje aparecía DENTRO de la caja del edificio.
    const npcYEdificio: CuerpoDelTurno[] = [{ kind: "building" }, { kind: "npc" }];
    assert.ok(huecoEntre(npcYEdificio, repartoViejo(2), 0, 1) < 0, "antes: el npc dentro del edificio");
    const mixto = afirmaQueNadieSeToca(npcYEdificio, "building + npc");
    assert.equal(huecoEntre(npcYEdificio, mixto, 0, 1).toFixed(2), "1.00");
  });

  it("y con las huellas DECLARADAS, que es donde el número fijo se rompía más", () => {
    // Un carro de [6,6] mide 3 m y un granero de [20,14], diez: con 1,8 m
    // fijos no había reparto que valiera. El error del número fijo crece con
    // lo que el motor declare, que es el argumento entero de esta PR.
    const turno: CuerpoDelTurno[] = [
      { kind: "building", footprint: [20, 14] },
      { kind: "object", footprint: [6, 6] },
      { kind: "npc" },
      { kind: "item", footprint: [2, 2] },
    ];
    const x = afirmaQueNadieSeToca(turno, "granero + carro + npc + bolsa");
    assert.deepEqual(x[0], 0, "el primero sigue cayendo donde siempre");
    assert.ok(x[1] > 0 && x[2] < 0, "alternan lado: el pasillo del medio queda libre por los dos");
    // El granero mide 10 m de lado, así que su vecino no puede estar a menos
    // de 5 + 1 + 1,5 = 7,5 m de su centro. Con el reparto viejo estaba a 1,8.
    assert.equal(x[1], 7.5);
  });

  it("cuatro del mismo tamaño se reparten a los DOS lados, sin apilarse en uno", () => {
    const cuatro: CuerpoDelTurno[] = Array.from({ length: 4 }, () => ({ kind: "object" }));
    const x = afirmaQueNadieSeToca(cuatro, "cuatro object");
    assert.equal(x[0], 0, "el primero, en el sitio de siempre");
    assert.equal(x.filter((v) => v > 0).length, 2, "dos a un lado");
    assert.equal(x.filter((v) => v < 0).length, 1, "y uno al otro: alternan empezando por la derecha");
    // Los números, para que se vea la regla: el primero ocupa de −0,75 a 0,75,
    // así que el segundo va a 0,75 + 1 + 0,75 = 2,5. Y el CUARTO se apoya en el
    // BORDE del segundo (3,25) y no en su centro: 3,25 + 1 + 0,75 = 5. Con el
    // número fijo el cuarto caía a 3,6 m, dentro de lo que ya ocupaba el otro.
    assert.deepEqual(x, [0, 2.5, -2.5, 5]);
  });

  it("la media anchura de un `npc` es el radio con el que lo mueve el SIMULADOR, no una caja inventada", () => {
    assert.equal(mediaAnchura({ kind: "npc" }), 0.5);
    assert.equal(mediaAnchura({ kind: "object" }), 0.75);
    assert.equal(mediaAnchura({ kind: "object", footprint: [6, 6] }), 1.5);
    assert.equal(mediaAnchura({ kind: "item" }), 0.25);
    // El lado MAYOR, no el del eje lateral: el reparto va perpendicular al
    // forward del jugador y las cajas están alineadas con el mundo.
    assert.equal(mediaAnchura({ kind: "building", footprint: [4, 20] }), 5);
  });

  it("un kind que nadie sabe medir no se reparte a ojo: se rompe", () => {
    // `huellaEnMetros` es fail-loud y aquí no se tapa. Inventar una anchura
    // sería volver al número fijo por otra puerta.
    assert.throws(() => repartirEnElTurno([{ kind: "object" }, { kind: "dragon" }]), /dragon/);
  });
});

/** El ancla de un hint, metida en el tile (tanda CB). Cada caso afirma la
 *  coordenada EXACTA y no solo «dentro»: «dentro» lo cumple también un ancla
 *  pegada al centro, y eso no es lo que se pide. */
describe("anclaDentroDelTile — el grupo entero cae en el tile", () => {
  const TILE = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };
  const NORTE = { x: 0, z: -1 };

  it("un ancla ya dentro no se mueve", () => {
    assert.deepEqual(anclaDentroDelTile({ x: 5, z: -7 }, TILE, NORTE, 0, 1.5), { x: 5, z: -7 });
  });

  for (const [lado, ancla, esperado] of [
    ["norte", { x: 0, z: -40 }, { x: 0, z: -30.5 }],
    ["sur", { x: 0, z: 40 }, { x: 0, z: 30.5 }],
    ["este", { x: 40, z: 0 }, { x: 30.5, z: 0 }],
    ["oeste", { x: -40, z: 0 }, { x: -30.5, z: 0 }],
  ] as const) {
    it(`fuera por el ${lado}: vuelve a margen del borde`, () => {
      assert.deepEqual(anclaDentroDelTile(ancla, TILE, NORTE, 0, 1.5), esperado);
    });
  }

  it("en la esquina con reparto lateral: el lateral solo reserva en el eje perpendicular al forward", () => {
    // Mirando al norte el lateral va en X: X reserva 1,5 + 3; Z solo 1,5.
    assert.deepEqual(anclaDentroDelTile({ x: 31, z: -31 }, TILE, NORTE, 3, 1.5), { x: 27.5, z: -30.5 });
  });

  it("forward en diagonal: cada eje reserva la PROYECCIÓN del lateral que le toca", () => {
    // sep = [fwd.z·lat, 0, −fwd.x·lat] → X ocupa |fwd.z|·ext = 8, Z |fwd.x|·ext = 6.
    // Con los ejes cambiados saldría (25, −23): distinto a propósito.
    assert.deepEqual(
      anclaDentroDelTile({ x: 40, z: -40 }, TILE, { x: 0.6, z: -0.8 }, 10, 1),
      { x: 23, z: -25 },
    );
    assert.deepEqual(
      anclaDentroDelTile({ x: -40, z: 40 }, TILE, { x: -0.6, z: 0.8 }, 10, 1),
      { x: -23, z: 25 },
    );
  });

  it("en un tile que no está en el origen", () => {
    const t = { minX: 32, minZ: -96, maxX: 96, maxZ: -32 };
    assert.deepEqual(anclaDentroDelTile({ x: 20, z: -100 }, t, NORTE, 0, 2), { x: 34, z: -94 });
  });

  it("un grupo que cabe JUSTO tiene ancla (el centro); uno que no cabe lanza, diciendo el eje", () => {
    assert.deepEqual(anclaDentroDelTile({ x: 9, z: 0 }, TILE, NORTE, 0, 32), { x: 0, z: 0 });
    assert.throws(() => anclaDentroDelTile({ x: 0, z: 0 }, TILE, NORTE, 40, 1.5), (e: unknown) =>
      e instanceof RangeError && /en x/.test(e.message));
    assert.throws(() => anclaDentroDelTile({ x: 0, z: 0 }, TILE, { x: 1, z: 0 }, 40, 1.5), (e: unknown) =>
      e instanceof RangeError && /en z/.test(e.message));
  });
});
