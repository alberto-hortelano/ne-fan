import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGreyboxSpec,
  canonicalGreyboxJson,
  expectedElementsFromGreybox,
  volumeHeightM,
  GREYBOX_EYE_M,
  STAGE_GREYBOX_VERSION,
  type GreyboxSpec,
} from "../src/scene/stage/greybox.js";
import { composeStage, volumeFootprintCells, type StageScenePlan } from "../src/scene/stage/compose.js";
import { stageToViewAt, stageToView } from "../src/scene/stage/projection.js";
import { STAGE_RENDER_SIZE } from "../src/scene/stage/segments.js";

/** Mismo plan interior que stage-compose.test.ts (12×8 m). */
function interiorPlan(): StageScenePlan {
  return {
    size: { cols: 24, rows: 16, meters_per_cell: 0.5 },
    stage: {
      exits: [
        { id: "puerta_cocina", edge: "north", to_place_id: "posada_cocina",
          zone: [10, 0, 4, 2], kind: "opening", label: "Puerta a la cocina" },
        { id: "salida_calle", edge: "south", to_place_id: "calle_mayor",
          zone: [14, 14, 5, 2], kind: "opening", label: "Salida a la calle" },
        { id: "puerta_este", edge: "east", to_place_id: "patio",
          zone: [22, 6, 2, 4], kind: "opening", label: "Puerta al patio" },
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

function exteriorPlan(): StageScenePlan {
  const p = interiorPlan();
  p.stage.fourth_wall = undefined;
  p.size = { cols: 48, rows: 24, meters_per_cell: 0.5 };
  p.stage.exits = [
    { id: "camino_norte", edge: "north", to_place_id: "bosque",
      zone: [20, 0, 6, 2], kind: "opening", label: "Camino al bosque" },
    { id: "salida_sur", edge: "south", to_place_id: "plaza",
      zone: [20, 22, 6, 2], kind: "opening", label: "Hacia la plaza" },
  ];
  p.volumes.push({
    id: "casa_alta", label: "casa alta", type: "building",
    rect: [4, 4, 10, 8], wall_h: 8,
  });
  p.biome = "grass";
  return p;
}

/** Proyección de referencia: pinhole estándar reimplementado con la cámara
 *  del spec (posición + focal en unidades de vista), sin three.js. Un punto
 *  de mundo (x, y, z) proyecta sobre el plano focal a
 *  (F·x/(camZ−z), horizon − F·(y−eye)/(camZ−z)) en unidades de vista. */
function referenceProject(spec: GreyboxSpec, x: number, y: number, zWorld: number): [number, number] {
  const [camX, camY, camZ] = spec.camera.pos;
  const F = spec.proj.px_per_m * spec.camera.retreat_m;
  const dist = camZ - zWorld;
  return [
    ((x - camX) * F) / dist,
    spec.proj.horizon_y - ((y - camY) * F) / dist,
  ];
}

describe("buildGreyboxSpec", () => {
  it("es determinista: mismo plan + seedKey ⇒ mismo canónico", () => {
    const a = canonicalGreyboxJson(buildGreyboxSpec(interiorPlan(), "posada_salon"));
    const b = canonicalGreyboxJson(buildGreyboxSpec(interiorPlan(), "posada_salon"));
    assert.equal(a, b);
    assert.ok(a.includes(`"greybox_version":${STAGE_GREYBOX_VERSION}`));
  });

  it("seedKey distinto ⇒ variación sembrada (luces/fondo)", () => {
    const a = canonicalGreyboxJson(buildGreyboxSpec(exteriorPlan(), "plato_a"));
    const b = canonicalGreyboxJson(buildGreyboxSpec(exteriorPlan(), "plato_b"));
    assert.notEqual(a, b);
  });

  it("la cámara del spec equivale EXACTAMENTE a la proyección declarada", () => {
    for (const plan of [interiorPlan(), exteriorPlan()]) {
      const spec = buildGreyboxSpec(plan, "equiv");
      const depth = spec.proj.depth_m;
      const rectMaxZ = spec.camera.pos[2] - spec.camera.retreat_m;
      for (const [xS, zS, h] of [
        [0, 0, 0], [3, 2, 0], [-4, depth, 0], [2.5, depth / 2, 1.7],
        [-3, 1, 3], [5, depth - 0.5, 6],
      ] as [number, number, number][]) {
        const [evx, evy] = stageToViewAt(spec.proj, xS, zS, h);
        // Mundo: xStage == x centrado; zStage = maxZ − zWorld.
        const [rvx, rvy] = referenceProject(spec, xS, h, rectMaxZ - zS);
        assert.ok(Math.abs(evx - rvx) < 1e-6, `vx en (${xS},${zS},${h}): ${evx} vs ${rvx}`);
        assert.ok(Math.abs(evy - rvy) < 1e-6, `vy en (${xS},${zS},${h}): ${evy} vs ${rvy}`);
      }
      // stageToViewAt con h=0 == stageToView (suelo).
      const [gx, gy] = stageToView(spec.proj, 2, 3);
      const [ax, ay] = stageToViewAt(spec.proj, 2, 3, 0);
      assert.equal(gx, ax);
      assert.equal(gy, ay);
    }
  });

  it("altura de ojos coherente con el proj emitido (por modo)", () => {
    for (const [plan, expected] of [
      [interiorPlan(), 1.8],
      [exteriorPlan(), GREYBOX_EYE_M],
    ] as const) {
      const spec = buildGreyboxSpec(plan, "eye");
      const eye = (spec.proj.ground_y - spec.proj.horizon_y) / spec.proj.px_per_m;
      assert.ok(Math.abs(eye - expected) < 1e-9, `eye ${eye} vs ${expected}`);
      assert.equal(spec.camera.eye_m, eye);
      assert.equal(spec.camera.pos[1], eye);
    }
    // La cámara interior SIEMPRE bajo el techo (3.2 m) — a la altura del
    // techo lo vería de canto y el frame quedaría negro por encima.
    assert.ok(buildGreyboxSpec(interiorPlan(), "eye").camera.eye_m < 3.2);
  });

  it("manifest: mismos ids vol_* que las capas del compositor, cajas dentro del cuadrado", () => {
    const plan = interiorPlan();
    const spec = buildGreyboxSpec(plan, "posada_salon");
    const composed = composeStage(plan, "posada_salon");
    const volLayerIds = composed.layers.filter((l) => l.id.startsWith("vol_")).map((l) => l.id).sort();
    const manifestIds = spec.manifest.map((m) => m.id).sort();
    assert.deepEqual(manifestIds, volLayerIds);
    for (const m of spec.manifest) {
      const [x, y, w, h] = m.box_px;
      assert.ok(x >= 0 && y >= 0 && x + w <= STAGE_RENDER_SIZE && y + h <= STAGE_RENDER_SIZE, m.id);
      assert.ok(w > 0 && h > 0, `caja no vacía en ${m.id}`);
    }
  });

  it("manifest: huellas == volumeFootprintCells en metros de mundo", () => {
    const plan = interiorPlan();
    const spec = buildGreyboxSpec(plan, "fp");
    const mpc = plan.size.meters_per_cell;
    const rect = { minX: -6, minZ: -4 };
    for (const v of plan.volumes) {
      const fp = volumeFootprintCells(v)!;
      const m = spec.manifest.find((x) => x.id === `vol_${v.id}`)!;
      assert.deepEqual(m.footprintWorld, [
        rect.minX + fp[0] * mpc,
        rect.minZ + fp[1] * mpc,
        rect.minX + (fp[0] + fp[2]) * mpc,
        rect.minZ + (fp[1] + fp[3]) * mpc,
      ]);
      assert.ok(Math.abs(m.hM - volumeHeightM(v, mpc)) < 1e-9);
    }
  });

  it("interior: sin cielo, aspect fijo del encuadre, techo hasta cámara, vanos tallados", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "posada_salon");
    assert.equal(spec.sky, null);
    assert.equal(spec.fog, null);
    // v2: encuadre de cámara real — aspect FIJO (el prestretch a cuadrado
    // queda acotado; el recorte ceñido de v1 deformaba ×3-5).
    assert.ok(Math.abs(spec.view_box.width / spec.view_box.height - 2.0) < 1e-9, "aspect 2.0");
    // El techo cubre desde la pared del fondo hasta la cámara (banda superior
    // del frame sin vacío negro).
    const ceiling = spec.primitives.find((p) => p.pos[1] === 3.2 && p.size[2] > spec.proj.depth_m);
    assert.ok(ceiling, "techo extendido hacia la cámara");
    // El vano este parte la pared lateral: al menos 2 segmentos de pared en x=+6.
    const eastSegs = spec.primitives.filter(
      (p) => p.shape === "box" && Math.abs(p.pos[0] - 6) < 1e-6 && p.size[1] === 3.2,
    );
    assert.ok(eastSegs.length >= 2, `pared este partida por el vano (${eastSegs.length})`);
  });

  it("exterior: cielo + niebla + colinas, y el view_box cubre el edificio alto", () => {
    const plan = exteriorPlan();
    const spec = buildGreyboxSpec(plan, "pueblo");
    assert.ok(spec.sky && spec.fog);
    const casa = spec.manifest.find((m) => m.id === "vol_casa_alta")!;
    // La caja del edificio no toca el borde superior (el view_box se amplió).
    assert.ok(casa.box_px[1] > 0, "top del edificio dentro del encuadre");
  });

  it("expectedElementsFromGreybox conserva el contrato de pistas", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "hints");
    const els = expectedElementsFromGreybox(spec);
    assert.equal(els.length, spec.manifest.length);
    for (const e of els) {
      assert.ok(e.id.startsWith("vol_"));
      assert.equal(e.tall, true);
      assert.equal(e.solid, true);
    }
  });

  it("canónico estable ante floats: redondeo a 1e-4", () => {
    const spec = buildGreyboxSpec(interiorPlan(), "round");
    const canon = canonicalGreyboxJson(spec);
    // Ningún número con más de 4 decimales sobrevive al canónico.
    assert.ok(!/\d\.\d{5,}/.test(canon), "floats largos en el canónico");
  });
});
