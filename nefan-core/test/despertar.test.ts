/** EL DESPERTAR (#613, «que decida el motor»): la regla de qué sitio vale
 *  (`validarDespertar`), el contexto que ve el motor (`contextoDeLaMuerte`) y
 *  lo que pinta el cliente mientras está caído (`estadoDelDespertar`). Las
 *  tres son puras; el bridge solo las ata (test del bridge aparte). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MARGEN_DEL_DESPERTAR_M,
  haciaDondeMirar,
  validarDespertar,
  type MundoDelDespertar,
} from "../src/simulation/despertar.js";
import { contextoDeLaMuerte } from "../src/narrative/contexto-de-la-muerte.js";
import {
  cambiaElDespertar,
  elJugadorEsperaDespertar,
  estadoDelDespertar,
} from "../src/protocol/despertar-en-pantalla.js";
import { DeathResolutionSchema } from "../src/contract/model-io/schemas.js";

/** Un mundo de pega: el tile (0,0) de 64 m existe, hay una caja sólida de
 *  4×4 m en el origen y un hostil con radio 10 en (20, 0). */
function mundo(over: Partial<MundoDelDespertar> = {}): MundoDelDespertar {
  return {
    resolverLugar: (id) => (id === "plaza" ? { x: -20, z: -20 } : id === "lejos" ? { x: 500, z: 500 } : null),
    lugaresValidos: () => ["plaza"],
    tileRealizado: (x, z) => Math.abs(x) <= 32 && Math.abs(z) <= 32,
    suelo: { ocupado: (x, z, r) => Math.abs(x) < 2 + r && Math.abs(z) < 2 + r },
    hostiles: [{ id: "bandido", casa: { x: 20, z: 0 }, radio: 10 }],
    margen: MARGEN_DEL_DESPERTAR_M,
    ...over,
  };
}

describe("validarDespertar", () => {
  it("un punto libre, en un tile que existe y lejos de todo hostil, vale tal cual y a ras de suelo", () => {
    const r = validarDespertar({ type: "point", x: -10, z: 10 }, mundo());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.punto, { x: -10, y: 0, z: 10 });
  });

  it("un lugar se resuelve a su punto", () => {
    const r = validarDespertar({ type: "place", place_id: "plaza" }, mundo());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.punto, { x: -20, y: 0, z: -20 });
  });

  it("un lugar que no da punto, o cuyo tile no existe, se rechaza con la lista de los que valen", () => {
    for (const place_id of ["nadie", "lejos"]) {
      const r = validarDespertar({ type: "place", place_id }, mundo());
      assert.equal(r.ok, false, place_id);
      if (!r.ok) assert.match(r.motivo, /Lugares válidos: plaza/);
    }
    const sinLugares = validarDespertar({ type: "place", place_id: "nadie" }, mundo({ lugaresValidos: () => [] }));
    assert.ok(!sinLugares.ok && /ninguno — usa un punto/.test(sinLugares.motivo));
  });

  it("un punto fuera de todo tile, o que no es un número, se rechaza", () => {
    const fuera = validarDespertar({ type: "point", x: 100, z: 0 }, mundo());
    assert.ok(!fuera.ok && /fuera de todo tile/.test(fuera.motivo));
    const nan = validarDespertar({ type: "point", x: Number.NaN, z: 0 }, mundo());
    assert.ok(!nan.ok && /no es un número finito/.test(nan.motivo));
  });

  it("dentro de lo sólido se aparta al sitio libre más cercano: nunca se despierta dentro de un edificio", () => {
    const r = validarDespertar({ type: "point", x: -0.5, z: 0 }, mundo({ hostiles: [] }));
    assert.ok(r.ok);
    if (r.ok) {
      assert.ok(!mundo().suelo.ocupado(r.punto.x, r.punto.z, 0.4), `(${r.punto.x}, ${r.punto.z}) sigue dentro`);
      assert.ok(Math.hypot(r.punto.x + 0.5, r.punto.z) < 3, "y cerca de donde se pidió");
    }
  });

  it("sin sitio libre alrededor se rechaza, y si mirar el punto revienta también", () => {
    const todoSolido = validarDespertar({ type: "point", x: 5, z: 5 }, mundo({ suelo: { ocupado: () => true } }));
    assert.ok(!todoSolido.ok && /no hay sitio libre/.test(todoSolido.motivo));
    const roto = validarDespertar(
      { type: "point", x: 5, z: 5 },
      mundo({ suelo: { ocupado: () => { throw new RangeError("fuera de rango"); } } }),
    );
    assert.ok(!roto.ok && /no se puede mirar: fuera de rango/.test(roto.motivo));
  });

  it("dentro de radio + margen de la CASA de un hostil vivo se rechaza — justo en el borde también", () => {
    const dentro = validarDespertar({ type: "point", x: 12, z: 0 }, mundo());
    assert.ok(!dentro.ok && /"bandido"/.test(dentro.motivo) && /más de 11\.00 m/.test(dentro.motivo));
    const borde = validarDespertar({ type: "point", x: 9, z: 0 }, mundo());
    assert.equal(borde.ok, false, "a 11 m exactos no vale: hace falta MÁS de radio + margen");
    assert.equal(validarDespertar({ type: "point", x: 8.9, z: 0 }, mundo()).ok, true);
  });

  it("un hostil sin radio (engancha desde cualquier sitio) lo rechaza todo, y lo dice", () => {
    const r = validarDespertar(
      { type: "point", x: -10, z: 10 },
      mundo({ hostiles: [{ id: "sin_radio", casa: { x: 0, z: 30 }, radio: Infinity }] }),
    );
    assert.ok(!r.ok && /∞/.test(r.motivo));
  });
});

/** QA S3 de BN: se despertaba conservando la mirada del cadáver, de cara a una
 *  pared. Convención de `Mirada`: `yaw = atan2(dx, dz)`; norte (−z) es π. */
describe("haciaDondeMirar", () => {
  const pared = (sur: boolean) => ({
    // Pared al NORTE del origen (z < −1), y con `sur` también al sur (z > 1).
    ocupado: (_x: number, z: number, r: number) => z - r < -1 || (sur && z + r > 1),
  });
  it("sin lugar, mira al rumbo más despejado: con pared al norte, no mira al norte", () => {
    const yaw = haciaDondeMirar({ x: 0, z: 0 }, pared(false), null);
    assert.ok(Math.cos(yaw) > -1e-9, `no mira hacia la pared del norte (dz < 0), yaw=${yaw}`);
    // Encajonado entre dos paredes (norte y sur), mira a lo largo del pasillo.
    const pasillo = haciaDondeMirar({ x: 0, z: 0 }, pared(true), null);
    assert.ok(Math.abs(Math.cos(pasillo)) < 1e-9, `mira a este u oeste, yaw=${pasillo}`);
  });
  it("todo despejado: el primero del orden, el norte", () => {
    assert.equal(haciaDondeMirar({ x: 0, z: 0 }, { ocupado: () => false }, null), Math.PI);
  });
  it("con lugar, mira al lugar aunque haya más espacio en otro rumbo", () => {
    const yaw = haciaDondeMirar({ x: 0, z: 0 }, pared(false), { x: 10, z: 0 });
    assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-9, `mira al este, yaw=${yaw}`);
  });
  it("el lugar encima no cuenta: mira a lo despejado", () => {
    const yaw = haciaDondeMirar({ x: 0, z: 0 }, pared(false), { x: 0.3, z: 0 });
    assert.ok(Math.cos(yaw) > -1e-9, `no mira a la pared, yaw=${yaw}`);
  });
  it("validarDespertar devuelve esa mirada: en un lugar, hacia el lugar", () => {
    const r = validarDespertar({ type: "place", place_id: "plaza" }, mundo({
      suelo: { ocupado: (x, z, rr) => Math.hypot(x + 20, z + 20) < 1 + rr },
    }));
    assert.ok(r.ok);
    if (r.ok) {
      const haciaLugar = Math.atan2(-20 - r.punto.x, -20 - r.punto.z);
      assert.ok(Math.abs(r.yaw - haciaLugar) < 1e-9, "desde la puerta, mirando al lugar");
    }
  });
});

describe("contextoDeLaMuerte", () => {
  it("da la forma que lee el motor: metros redondeados, lugares por distancia y radio sin infinitos", () => {
    const c = contextoDeLaMuerte({
      cayoEn: { x: 1.23456, z: -2.5 },
      tile: { tx: 0, ty: 0 },
      placeId: "aldea",
      asesino: { id: "bandido", name: "Bandido" },
      hostiles: [
        { id: "bandido", name: "Bandido", pos: { x: 2, z: -2 }, casa: { x: 20, z: 0 }, radio: 10 },
        { id: "lobo", name: "Lobo", pos: { x: 5, z: 5 }, casa: { x: 5, z: 5 }, radio: Infinity },
      ],
      lugares: [
        { place_id: "lejos", name: "Lejos", centro: { x: 30, z: 0 } },
        { place_id: "cerca", name: "Cerca", centro: { x: 4.2, z: -2.5 } },
      ],
      puntoSeguro: { x: -10.004, z: 3 },
      margen: 1,
    });
    assert.deepEqual(c.cayo_en, { x: 1.23, z: -2.5 });
    assert.deepEqual(c.lugares.map((l) => [l.place_id, l.distancia_m]), [["cerca", 2.97], ["lejos", 28.87]]);
    assert.deepEqual(c.hostiles_vivos.map((h) => h.radio_m), [10, null]);
    assert.deepEqual(c.punto_seguro, { x: -10, z: 3 });
    assert.equal(c.place_id, "aldea");
    assert.deepEqual(c.asesino, { id: "bandido", name: "Bandido" });
    assert.equal(c.margen_m, 1);
    assert.equal(contextoDeLaMuerte({ ...base(), puntoSeguro: null }).punto_seguro, null);
  });
});

function base() {
  return {
    cayoEn: { x: 0, z: 0 },
    tile: null,
    placeId: null,
    asesino: null,
    hostiles: [],
    lugares: [],
    puntoSeguro: null,
    margen: 1,
  };
}

describe("estadoDelDespertar", () => {
  it("de pie no hay velo, venga el status que venga", () => {
    assert.deepEqual(estadoDelDespertar(10, { phase: "error", message: "x" }, true), { de: "vivo" });
  });
  it("caído sin motor (fixtures): R reaparece", () => {
    assert.deepEqual(estadoDelDespertar(0, null, false), { de: "sin_motor" });
  });
  it("caído con motor: decidiendo mientras no haya fallo — también antes de que llegue el primer status", () => {
    assert.deepEqual(estadoDelDespertar(0, null, true), { de: "decidiendo" });
    assert.deepEqual(estadoDelDespertar(-3, { phase: "generating" }, true), { de: "decidiendo" });
  });
  it("caído con fallo: el motivo del bridge, o uno por defecto", () => {
    assert.deepEqual(estadoDelDespertar(0, { phase: "error", message: "el motor no responde" }, true), {
      de: "fallo",
      motivo: "el motor no responde",
    });
    const sinMotivo = estadoDelDespertar(0, { phase: "error" }, true);
    assert.ok(sinMotivo.de === "fallo" && sinMotivo.motivo.length > 0);
  });
  it("el cliente se calla el input mientras el frame entregado diga caído", () => {
    assert.equal(elJugadorEsperaDespertar({ playerHp: 0 }), true);
    assert.equal(elJugadorEsperaDespertar({ playerHp: 1 }), false);
  });
});

/** QA de BN, segunda vuelta: rechazar el viaje o el diálogo de un caído NO
 *  cambia el estado del despertar. Pasaba el velo a «fallo» con «R ·
 *  reintentar» mientras el motor seguía decidiendo. */
describe("cambiaElDespertar", () => {
  it("un rechazo no toca el último status: el motor sigue decidiendo", () => {
    const rechazo = { phase: "error", message: "Estás caído: no puedes viajar hasta que despiertes.", rechazo: true as const };
    assert.equal(cambiaElDespertar(rechazo), null);
    // Y encadenado como lo hace el velo: decidiendo + rechazo = decidiendo.
    const ultimo = cambiaElDespertar(rechazo) ?? cambiaElDespertar({ phase: "generating" });
    assert.deepEqual(estadoDelDespertar(0, ultimo, true), { de: "decidiendo" });
  });
  it("el error de la decisión sí cuenta, con su motivo; `generating` también; un latido no", () => {
    assert.deepEqual(cambiaElDespertar({ phase: "error", message: "el motor no responde" }), {
      phase: "error",
      message: "el motor no responde",
    });
    assert.deepEqual(cambiaElDespertar({ phase: "generating", message: "…" }), { phase: "generating" });
    assert.equal(cambiaElDespertar({ phase: "progress" }), null);
  });
});

describe("DeathResolutionSchema", () => {
  it("acepta un lugar o un punto, con las consequences de siempre", () => {
    assert.equal(DeathResolutionSchema.safeParse({ wake: { type: "place", place_id: "plaza" }, consequences: [] }).success, true);
    assert.equal(
      DeathResolutionSchema.safeParse({
        wake: { type: "point", x: 1, z: 2 },
        consequences: [{ type: "dialogue", speaker: "Curandera", text: "Despierta." }, { type: "player_healed", amount: 5 }],
      }).success,
      true,
    );
  });
  it("rechaza un hostil en el despertar, con el motivo para el motor", () => {
    const r = DeathResolutionSchema.safeParse({
      wake: { type: "point", x: 1, z: 2 },
      consequences: [{ type: "spawn_entity", entity_kind: "npc", name: "Bandido", role: "hostile" }],
    });
    assert.equal(r.success, false);
    assert.match(JSON.stringify(r.error?.issues), /no despiertes al jugador con un hostil al lado/);
    assert.equal(
      DeathResolutionSchema.safeParse({
        wake: { type: "point", x: 1, z: 2 },
        consequences: [{ type: "spawn_entity", entity_kind: "npc", name: "Curandera", role: "merchant" }],
      }).success,
      true,
      "un NPC que no es hostil sí cabe",
    );
  });
  it("rechaza un wake sin forma", () => {
    for (const wake of [{ type: "place" }, { type: "point", x: 1 }, { type: "tile", tx: 0 }]) {
      assert.equal(DeathResolutionSchema.safeParse({ wake, consequences: [] }).success, false, JSON.stringify(wake));
    }
  });
});
