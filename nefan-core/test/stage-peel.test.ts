import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeStage, type StageScenePlan } from "../src/scene/stage/compose.js";
import { peelPlanFor, paintableVolumeLayers, STAGE_PEEL_VERSION } from "../src/scene/stage/peel.js";

/** Plató INTERIOR con 3 volúmenes a profundidades distintas (mesa cerca,
 *  barril medio, muro lejos) + cuarta pared y paredes laterales (encuadre,
 *  fuera del plan de pelado). */
function makePlan(): StageScenePlan {
  return {
    size: { cols: 32, rows: 20, meters_per_cell: 0.5 },
    stage: {
      exits: [
        { id: "n", edge: "north", to_place_id: "fuera", zone: [14, 0, 4, 2], kind: "door", label: "Puerta" },
      ],
      backdrop: { description: "Pared de piedra con chimenea" },
      fourth_wall: { present: true },
    },
    volumes: [
      { id: "muro_fondo", label: "muro de piedra", type: "wall", points: [[4, 4], [28, 4]], h: 5 },
      { id: "barril", label: "barril", type: "prop", at: [20, 10], shape: "cylinder", h: 2 },
      { id: "mesa", label: "mesa de roble", type: "prop", rect: [8, 15, 5, 2], shape: "box", h: 2 },
    ],
  };
}

describe("peelPlanFor", () => {
  const stage = composeStage(makePlan(), "peel_test");
  const plan = peelPlanFor(stage, { backdrop: "Pared de piedra con chimenea" });

  it("pela de CERCA a LEJOS (z ascendente) solo los volúmenes", () => {
    assert.equal(plan.version, STAGE_PEEL_VERSION);
    assert.deepEqual(
      plan.steps.map((s) => s.layerId),
      ["vol_mesa", "vol_barril", "vol_muro_fondo"],
    );
    // Bastidores y cuarta pared NUNCA en el plan.
    assert.ok(!plan.steps.some((s) => s.layerId.startsWith("wing_") || s.layerId === "fourth_wall"));
  });

  it("behind_labels: cada paso ve lo que queda detrás, el último solo el fondo", () => {
    assert.deepEqual(plan.steps[0].behindLabels, ["barril", "muro de piedra"]);
    assert.deepEqual(plan.steps[1].behindLabels, ["muro de piedra"]);
    assert.deepEqual(plan.steps[2].behindLabels, []);
  });

  it("los prompts llevan lo declarado detrás, el backdrop y las negativas duras", () => {
    assert.match(plan.steps[0].prompt, /barril, muro de piedra/);
    assert.match(plan.steps[0].prompt, /Pared de piedra con chimenea/);
    assert.match(plan.steps[2].prompt, /ONLY the empty ground/);
    for (const s of plan.steps) assert.match(s.prompt, /Do NOT invent any new object/);
  });

  it("el plan NO transporta máscaras: cada paso referencia una capa real y la máscara sale de segmentar lo pintado", () => {
    for (const s of plan.steps) {
      assert.ok(!("maskSvg" in s), "prohibido: máscara desde el SVG declarado de la capa");
      assert.ok(stage.layers.some((l) => l.id === s.layerId));
      assert.ok(s.label.length > 0);
    }
  });

  it("paintableVolumeLayers excluye encuadre y placa", () => {
    const kinds = new Set(paintableVolumeLayers(stage).map((l) => l.kind));
    assert.ok([...kinds].every((k) => k === "prop" || k === "wall"));
    // Las paredes laterales de interior son kind "wing" y las capas de
    // volumen llevan label.
    const wings = stage.layers.filter((l) => l.kind === "wing");
    assert.equal(wings.length, 2);
    const mesa = stage.layers.find((l) => l.id === "vol_mesa")!;
    assert.equal(mesa.label, "mesa de roble");
  });
});
