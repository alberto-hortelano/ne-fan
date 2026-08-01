import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeStage, STAGE_COMPOSER_VERSION, type StageScenePlan } from "../src/scene/stage/compose.js";
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

describe("composeStage", () => {
  it("es determinista byte a byte (mismo plan + seedKey)", () => {
    const a = composeStage(makePlan(), "posada_salon");
    const b = composeStage(makePlan(), "posada_salon");
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.stage_composer_version, STAGE_COMPOSER_VERSION);
  });

  it("seedKey distinto ⇒ arte distinto (detalle procedural sembrado)", () => {
    const plan = makePlan();
    plan.stage.fourth_wall = undefined; // exterior: suelo con moteado sembrado
    const a = composeStage(plan, "plato_a");
    const b = composeStage(plan, "plato_b");
    assert.notEqual(a.svg, b.svg);
  });

  it("capas de fondo a frente: backdrop primero, cuarta pared última (z=0)", () => {
    const c = composeStage(makePlan(), "posada_salon");
    assert.equal(c.layers[0].id, "backdrop");
    const last = c.layers[c.layers.length - 1];
    assert.equal(last.kind, "fourth_wall");
    assert.equal(last.z, 0);
    for (let i = 1; i < c.layers.length; i++) {
      assert.ok(c.layers[i].z <= c.layers[i - 1].z, `capas ordenadas por z desc en ${i}`);
    }
  });

  it("cada capa es un SVG standalone con el viewBox común", () => {
    const c = composeStage(makePlan(), "posada_salon");
    for (const l of c.layers) {
      assert.ok(l.svg.startsWith("<svg xmlns="), `capa ${l.id} standalone`);
      assert.ok(l.svg.includes("viewBox="), `capa ${l.id} con viewBox`);
    }
  });

  it("exits en metros de mundo (escena centrada en el origen)", () => {
    const c = composeStage(makePlan(), "posada_salon");
    // Escena 12×8 m ⇒ rect [−6..6, −4..4]. zone [10,0,4,2] a 0.5 m/celda:
    const norte = c.exits.find((e) => e.id === "puerta_cocina")!;
    assert.deepEqual(norte.rect, { minX: -1, minZ: -4, maxX: 1, maxZ: -3 });
    const sur = c.exits.find((e) => e.id === "salida_calle")!;
    assert.deepEqual(sur.rect, { minX: 1, minZ: 3, maxX: 3.5, maxZ: 4 });
  });

  it("bounds jugables = rect de la escena con inset", () => {
    const c = composeStage(makePlan(), "posada_salon");
    assert.ok(c.bounds.minX > -6 && c.bounds.maxX < 6);
    assert.ok(c.bounds.minZ > -4 && c.bounds.maxZ < 4);
  });

  it("los volúmenes producen capas con huella en mundo y z dentro del plató", () => {
    const c = composeStage(makePlan(), "posada_salon");
    const mesa = c.layers.find((l) => l.id === "vol_mesa_grande");
    assert.ok(mesa, "capa de la mesa presente");
    assert.ok(mesa!.footprint, "con huella");
    const [minX, minZ, maxX, maxZ] = mesa!.footprint!;
    // rect celdas [6,8,4,2] a 0.5 m ⇒ mundo [−3, 0] .. [−1, 1].
    assert.deepEqual([minX, minZ, maxX, maxZ], [-3, 0, -1, 1]);
    assert.ok(mesa!.z > 0 && mesa!.z < 8, `z de plató ${mesa!.z} en (0, depth)`);
  });

  it("una salida norte pinta su hueco de puerta en el backdrop", () => {
    const c = composeStage(makePlan(), "posada_salon");
    const backdrop = c.layers.find((l) => l.id === "backdrop")!;
    assert.ok(backdrop.svg.includes("#171219"), "hueco oscuro de la puerta en el telón");
  });

  it("la cuarta pared abre hueco también para exits sur no declarados como puerta", () => {
    const plan = makePlan();
    plan.stage.fourth_wall = { present: true }; // sin doors declaradas
    const c = composeStage(plan, "posada_salon");
    const fw = c.layers.find((l) => l.kind === "fourth_wall")!;
    // La zona del exit sur [14,14,5,2] ⇒ hueco en x mundo [1, 3.5] ⇒ vista [10, 35].
    assert.ok(fw.svg.length > 200);
    assert.ok(fw.svg.includes('x1="10"') || fw.svg.includes('x1="35"'), "marco del hueco del exit sur presente");
  });

  it("sin fourth_wall no hay capa fourth_wall", () => {
    const plan = makePlan();
    plan.stage.fourth_wall = undefined;
    const c = composeStage(plan, "posada_salon");
    assert.equal(c.layers.some((l) => l.kind === "fourth_wall"), false);
  });

  it("rechaza un size inválido (fail-loud)", () => {
    const plan = makePlan();
    plan.size = { cols: 0, rows: 16, meters_per_cell: 0.5 };
    assert.throws(() => composeStage(plan, "x"), /size inválido/);
  });
});

describe("exitZoneAt / spawnPointForEntry", () => {
  const c = composeStage(makePlan(), "posada_salon");

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

describe("composeStage — salidas por kind (nada simbólico)", () => {
  function exteriorPlan(kind: "door" | "opening"): StageScenePlan {
    return {
      size: { cols: 64, rows: 24, meters_per_cell: 0.5 },
      biome: "meadow",
      stage: {
        exits: [
          { id: "oeste", edge: "west", to_place_id: "bosque", zone: [0, 8, 2, 12], kind, label: "Al oeste" },
          { id: "norte", edge: "north", to_place_id: "colinas", zone: [28, 0, 8, 2], kind, label: "Al norte" },
        ],
      },
      volumes: [],
    };
  }

  it("un opening lateral abre HUECO en el bastidor (sin arco de puerta)", () => {
    const c = composeStage(exteriorPlan("opening"), "prado");
    const wing = c.layers.find((l) => l.id === "wing_west")!;
    assert.ok(!wing.svg.includes("#0d0a10"), "sin vano de puerta pintado");
    // El suelo continúa fuera de plano (tono del suelo oscurecido presente).
    assert.ok(wing.svg.split("<polygon").length > 2, "hueco con aire + suelo");
  });

  it("un door lateral pinta su arco", () => {
    const c = composeStage(exteriorPlan("door"), "prado");
    const wing = c.layers.find((l) => l.id === "wing_west")!;
    assert.ok(wing.svg.includes("#0d0a10"), "vano de puerta presente");
  });

  it("un opening norte exterior pinta camino al horizonte, no puerta", () => {
    const c = composeStage(exteriorPlan("opening"), "prado");
    const backdrop = c.layers.find((l) => l.id === "backdrop")!;
    assert.ok(!backdrop.svg.includes("#171219"), "sin vano oscuro de puerta");
  });

  it("un door norte sigue pintando la puerta con marco", () => {
    const c = composeStage(exteriorPlan("door"), "prado");
    const backdrop = c.layers.find((l) => l.id === "backdrop")!;
    assert.ok(backdrop.svg.includes("#171219"), "vano de puerta presente");
  });
});
