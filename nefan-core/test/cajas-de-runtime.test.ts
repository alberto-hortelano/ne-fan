import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cajaQueBloquea,
  cajaQueContiene,
  cajasDeRuntime,
  cajasDeSpawns,
} from "../src/simulation/cajas-de-runtime.js";
import { SPAWN_DE_RUNTIME } from "../src/session/mundo-persistido.js";
import type { EntityRecord } from "../src/narrative/types.js";

function record(
  id: string,
  type: string,
  spawnReason: string,
  pos: [number, number, number],
  data: Record<string, unknown> = {},
): EntityRecord {
  return {
    id,
    type,
    scene_id: "tile_0_0",
    spawned_at: "2026-01-01T00:00:00.000Z",
    spawn_reason: spawnReason,
    spawn_event_id: "",
    position: [...pos],
    data: { name: id, ...data },
    asset_refs: [],
  };
}

/** #583, y lo que decide el ALCANCE del arreglo: no es «la huella de nadie»,
 *  son los spawns de RUNTIME. Lo que declara un tile ya frena a los dos desde
 *  #232 por su volumen derivado, y contarlo otra vez le pondría encima una
 *  caja ciega que taparía sus vanos. */
describe("cajasDeRuntime · de quién es cada caja", () => {
  it("solo el spawn de RUNTIME que ocupa sitio: ni el del tile, ni el npc, ni el item", () => {
    const cajas = cajasDeRuntime([
      record("granero_del_tile", "building", "scene_init", [10, 0, 10]),
      record("tabernero", "npc", SPAWN_DE_RUNTIME, [1, 0, 2]),
      record("bolsa", "item", SPAWN_DE_RUNTIME, [3, 0, 4]),
      record("forja", "building", SPAWN_DE_RUNTIME, [5, 0, 6]),
    ]);
    assert.deepEqual(cajas.map((c) => c.id), ["forja"]);
  });

  it("un `object` de runtime TAMBIÉN ocupa sitio: son las dos clases, no una", () => {
    const cajas = cajasDeRuntime([
      record("carro", "object", SPAWN_DE_RUNTIME, [5, 0, 6]),
      record("cofre", "object", SPAWN_DE_RUNTIME, [9, 0, 9]),
    ]);
    assert.deepEqual(cajas.map((c) => c.id), ["carro", "cofre"]);
  });

  it("la caja está DONDE ESTÁ la entity: x e z, y en ese orden", () => {
    const [caja] = cajasDeRuntime([
      record("forja", "building", SPAWN_DE_RUNTIME, [7, 1.5, -3]),
    ]);
    assert.deepEqual(caja.pos, { x: 7, z: -3 });
  });

  it("mide lo que el motor DECLARÓ, no el defecto de su clase (#532)", () => {
    const [carro] = cajasDeRuntime([
      record("carro", "object", SPAWN_DE_RUNTIME, [0, 0, 0], { footprint: [6, 6] }),
    ]);
    const [cofre] = cajasDeRuntime([
      record("cofre", "object", SPAWN_DE_RUNTIME, [0, 0, 0]),
    ]);
    // 6 celdas × 0,5 m/celda = 3 m; el defecto de `object` son 3 celdas = 1,5 m.
    assert.deepEqual(carro.sizeXZ, { x: 3, z: 3 });
    assert.deepEqual(cofre.sizeXZ, { x: 1.5, z: 1.5 });
  });

  it("el MUERTO no deja caja: lo que no vuelve al mundo no ocupa sitio en él", () => {
    const cajas = cajasDeRuntime([
      record("golem", "building", SPAWN_DE_RUNTIME, [0, 0, 0], {
        combat: { health: 0, max_health: 30 },
      }),
    ]);
    assert.deepEqual(cajas, []);
  });

  it("sin spawns no hay cajas, y un ledger vacío no es un error", () => {
    assert.deepEqual(cajasDeRuntime([]), []);
    assert.deepEqual(cajasDeSpawns([]), []);
  });
});

/** La geometría es la del JUGADOR (`cajaBloquea`, #601) y aquí solo se
 *  comprueba que es esa y que se contesta CON EL ID: quien atraviesa una caja
 *  tiene que poder decir cuál. */
describe("cajasDeRuntime · qué caja contesta", () => {
  const cajas = [
    { id: "forja", pos: { x: 0, z: 0 }, sizeXZ: { x: 4, z: 4 } },
    { id: "carro", pos: { x: 20, z: 0 }, sizeXZ: { x: 3, z: 3 } },
  ];

  it("cajaQueBloquea: entrar desde fuera bloquea, y dice CUÁL", () => {
    const caja = cajaQueBloquea({ x: 5, z: 0 }, { x: 2.4, z: 0 }, 0.5, cajas);
    assert.equal(caja?.id, "forja");
    assert.equal(cajaQueBloquea({ x: 25, z: 0 }, { x: 21.9, z: 0 }, 0.5, cajas)?.id, "carro");
  });

  it("cajaQueBloquea: por donde no hay nada, no hay caja", () => {
    assert.equal(cajaQueBloquea({ x: 10, z: 0 }, { x: 11, z: 0 }, 0.5, cajas), null);
    assert.equal(cajaQueBloquea({ x: 0, z: 0 }, { x: 0, z: 0 }, 0.5, []), null);
  });

  it("SALIR SÍ, ENTRAR NO: al que le cayó una caja encima no se le encierra", () => {
    // Dentro de la forja, hacia fuera: no bloquea (la penetración baja).
    assert.equal(cajaQueBloquea({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.5, cajas), null);
    // …y hacia el centro sí, porque le metería más adentro.
    assert.equal(cajaQueBloquea({ x: 1, z: 0 }, { x: 0.5, z: 0 }, 0.5, cajas)?.id, "forja");
  });

  it("cajaQueContiene: la pregunta de PUNTO, que la de movimiento no contesta", () => {
    assert.equal(cajaQueContiene(0, 0, 0.5, cajas)?.id, "forja");
    assert.equal(cajaQueContiene(20.5, 0.5, 0.5, cajas)?.id, "carro");
    // Fuera es fuera: sin esto «contener» sería verdad en todo el plano.
    assert.equal(cajaQueContiene(10, 10, 0.5, cajas), null);
    // El borde exacto de la caja inflada por el radio cuenta como fuera
    // (2 de media huella + 0,5 de radio = 2,5).
    assert.equal(cajaQueContiene(2.5, 0, 0.5, cajas), null);
    assert.equal(cajaQueContiene(2.49, 0, 0.5, cajas)?.id, "forja");
  });

  it("el RADIO infla la caja también aquí: el cuerpo cuenta", () => {
    assert.equal(cajaQueContiene(2.2, 0, 0.5, cajas)?.id, "forja");
    assert.equal(cajaQueContiene(2.2, 0, 0.1, cajas), null);
  });
});
