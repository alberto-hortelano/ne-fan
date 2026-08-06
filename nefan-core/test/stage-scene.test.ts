import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeStageScene } from "../src/scene/stage/scene.js";
import { canonicalGreyboxJson, type StageScenePlan } from "../src/scene/stage/greybox.js";
import { exitZoneAt, spawnPointForEntry } from "../src/scene/stage/entry.js";

/** Plató interior 24×16 celdas a 0.5 m (12×8 m): salida norte a la cocina,
 *  salida sur (embocadura) a la calle, mesa y barril como volúmenes. */
function makePlan(): StageScenePlan {
  return {
    size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
    stage: {
      exits: [
        { id: "puerta_cocina", edge: "north", to_place_id: "posada_cocina",
          zone: [10, 0, 4, 2], kind: "door", label: "Puerta a la cocina" },
        { id: "salida_calle", edge: "south", to_place_id: "calle_mayor",
          zone: [14, 14, 5, 2], kind: "opening", label: "Salida a la calle" },
      ],
      backdrop: { description: "Pared con chimenea encendida" },
      fourth_wall: { present: true, doors: [{ col: 14, w: 5 }] },
    },
    volumes: [
      { id: "mesa_grande", label: "mesa grande", type: "prop", rect: [6, 8, 4, 2], shape: "box", h: 2 },
      { id: "barril", label: "barril", type: "prop", at: [18, 5], shape: "cylinder", h: 2 },
    ],
  };
}

describe("composeStageScene", () => {
  it("es determinista (mismo plan + seedKey ⇒ misma escena y mismo canónico del spec)", () => {
    const a = composeStageScene(makePlan(), "posada_salon");
    const b = composeStageScene(makePlan(), "posada_salon");
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(canonicalGreyboxJson(a.spec), canonicalGreyboxJson(b.spec));
  });

  it("proj y view_box son EXACTAMENTE los del spec greybox (proyección única)", () => {
    const c = composeStageScene(makePlan(), "posada_salon");
    assert.equal(c.proj, c.spec.proj);
    assert.equal(c.view_box, c.spec.view_box);
  });

  it("exits en metros de mundo (escena centrada en el origen)", () => {
    const c = composeStageScene(makePlan(), "posada_salon");
    // Escena 12×8 m ⇒ rect [−6..6, −4..4]. zone [10,0,4,2] a 0.5 m/celda:
    const norte = c.exits.find((e) => e.id === "puerta_cocina")!;
    assert.deepEqual(norte.rect, { minX: -1, minZ: -4, maxX: 1, maxZ: -3 });
    const sur = c.exits.find((e) => e.id === "salida_calle")!;
    assert.deepEqual(sur.rect, { minX: 1, minZ: 3, maxX: 3.5, maxZ: 4 });
  });

  it("bounds jugables = rect de la escena con inset", () => {
    const c = composeStageScene(makePlan(), "posada_salon");
    assert.ok(c.bounds.minX > -6 && c.bounds.maxX < 6);
    assert.ok(c.bounds.minZ > -4 && c.bounds.maxZ < 4);
  });

  it("items: espejo 1:1 del manifest, con huella en mundo y z dentro del plató", () => {
    const c = composeStageScene(makePlan(), "posada_salon");
    assert.equal(c.items.length, c.spec.manifest.length);
    const mesa = c.items.find((i) => i.id === "vol_mesa_grande");
    assert.ok(mesa, "item de la mesa presente");
    // rect celdas [6,8,4,2] a 0.5 m ⇒ mundo [−3, 0] .. [−1, 1].
    assert.deepEqual(mesa!.footprint, [-3, 0, -1, 1]);
    assert.ok(mesa!.z > 0 && mesa!.z < 8, `z de plató ${mesa!.z} en (0, depth)`);
    assert.ok(mesa!.hM > 0);
  });

  it("items ordenados de fondo a frente (z descendente)", () => {
    const c = composeStageScene(makePlan(), "posada_salon");
    for (let i = 1; i < c.items.length; i++) {
      assert.ok(c.items[i].z <= c.items[i - 1].z, `items ordenados por z desc en ${i}`);
    }
  });

  it("rechaza un size inválido (fail-loud)", () => {
    const plan = makePlan();
    plan.size = { cols: 0, rows: 16, meters_per_cell: 0.5 };
    assert.throws(() => composeStageScene(plan, "x"), /size inválido/);
  });
});

describe("exitZoneAt / spawnPointForEntry", () => {
  const c = composeStageScene(makePlan(), "posada_salon");

  it("detecta la zona pisada y devuelve null fuera", () => {
    // Centro de la puerta norte: [0, −3.5].
    const hit = exitZoneAt(c, 0, -3.5);
    assert.equal(hit?.id, "puerta_cocina");
    assert.equal(exitZoneAt(c, 0, 0), null);
  });

  it("spawn de entrada: fuera de la zona, hacia el interior, dentro de bounds", () => {
    const p = spawnPointForEntry(c, "posada_cocina")!;
    assert.ok(p, "hay salida de vuelta a la cocina");
    // La puerta norte llega hasta z=−3; el spawn queda más al interior (z mayor).
    assert.ok(p.z > -3, `z ${p.z} hacia el interior`);
    assert.equal(exitZoneAt(c, p.x, p.z), null, "el spawn NO pisa la zona (no re-dispara)");
    assert.ok(p.x >= c.bounds.minX && p.x <= c.bounds.maxX);
    assert.ok(p.z >= c.bounds.minZ && p.z <= c.bounds.maxZ);
  });

  it("spawn por la embocadura (edge sur): hacia el interior (z menor)", () => {
    const p = spawnPointForEntry(c, "calle_mayor")!;
    assert.ok(p.z < 3, `z ${p.z} por dentro de la zona sur`);
    assert.equal(exitZoneAt(c, p.x, p.z), null);
  });

  it("place desconocido ⇒ null (el caller degrada a __player_start)", () => {
    assert.equal(spawnPointForEntry(c, "no_existe"), null);
  });
});
