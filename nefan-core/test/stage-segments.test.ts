import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeStage, type StageScenePlan } from "../src/scene/stage/compose.js";
import { stageToView, worldToStage } from "../src/scene/stage/projection.js";
import {
  expectedElementsFor,
  pxToView,
  contactToPose,
  footprintFromContact,
  matchInventory,
  peelStepsFromInventory,
  collisionGridFromCutouts,
  reconstructionDiff,
  STAGE_RENDER_SIZE,
  type StageReviewItem,
} from "../src/scene/stage/segments.js";

/** Plató de referencia: 32×20 celdas × 0.5 m = 16×10 m, con mesa/barril/muro. */
function makePlan(): StageScenePlan {
  return {
    size: { cols: 32, rows: 20, meters_per_cell: 0.5 },
    stage: {
      exits: [
        { id: "n", edge: "north", to_place_id: "fuera", zone: [14, 0, 4, 2], kind: "door", label: "Puerta" },
      ],
      backdrop: { description: "Pared de piedra" },
      fourth_wall: { present: true },
    },
    volumes: [
      { id: "muro_fondo", label: "muro de piedra", type: "wall", points: [[4, 4], [28, 4]], h: 5 },
      { id: "barril", label: "barril", type: "prop", at: [20, 10], shape: "cylinder", h: 2 },
      { id: "mesa", label: "mesa de roble", type: "prop", rect: [8, 15, 5, 2], shape: "box", h: 2 },
    ],
  };
}

const stage = composeStage(makePlan(), "segments_test");
const rect = { minX: -8, minZ: -5, maxX: 8, maxZ: 5 };

/** Proyecta un punto de mundo a píxel del cuadrado (ida del pipeline). */
function worldToPx(x: number, z: number): [number, number] {
  const [xs, zs] = worldToStage(rect, x, z);
  const [vx, vy] = stageToView(stage.proj, xs, zs);
  const vb = stage.view_box;
  return [
    ((vx - vb.minX) / vb.width) * STAGE_RENDER_SIZE,
    ((vy - vb.minY) / vb.height) * STAGE_RENDER_SIZE,
  ];
}

describe("expectedElementsFor", () => {
  it("un expected por volumen pintable, con caja en píxeles del cuadrado", () => {
    const expected = expectedElementsFor(stage);
    assert.deepEqual(
      expected.map((e) => e.id).sort(),
      ["vol_barril", "vol_mesa", "vol_muro_fondo"],
    );
    for (const e of expected) {
      assert.ok(e.label.length > 0);
      const [x, y, w, h] = e.box_px;
      assert.ok(w > 0 && h > 0);
      assert.ok(x >= 0 && y >= 0 && x + w <= STAGE_RENDER_SIZE && y + h <= STAGE_RENDER_SIZE);
      assert.equal(e.solid, true); // los tres volúmenes tienen huella
    }
  });
});

describe("pxToView / contactToPose", () => {
  it("round-trip mundo → px → pose recupera la z de plató", () => {
    // Línea de contacto sintética: el frente de la mesa a zMundo = 2.5
    // (celda 15 de 20 ⇒ zStage = maxZ − z = 2.5).
    const zWorld = 2.5;
    const contactPx: [number, number][] = [];
    for (let x = -3; x <= -0.5; x += 0.25) contactPx.push(worldToPx(x, zWorld));
    const pose = contactToPose(stage.proj, stage.view_box, rect, contactPx);
    assert.ok(pose, "pose derivable");
    const [, zsEsperada] = worldToStage(rect, 0, zWorld);
    assert.ok(Math.abs(pose.z - zsEsperada) < 0.05, `z=${pose.z} ≈ ${zsEsperada}`);
    // Los contactos desproyectados vuelven al mundo original.
    for (const [wx, wz] of pose.contactWorld) {
      assert.ok(Math.abs(wz - zWorld) < 0.05);
      assert.ok(wx > -3.2 && wx < -0.3);
    }
  });

  it("contacto inclinado: la mediana ignora los extremos que muerden al vecino", () => {
    const pts: [number, number][] = [];
    for (let x = -2; x <= 2; x += 0.25) pts.push(worldToPx(x, 1.0));
    // Tres puntos basura (el borde de la máscara pisó un objeto más lejano).
    pts.push(worldToPx(2.2, 4.5), worldToPx(2.4, 4.5), worldToPx(2.6, 4.5));
    const pose = contactToPose(stage.proj, stage.view_box, rect, pts);
    assert.ok(pose);
    const [, zsEsperada] = worldToStage(rect, 0, 1.0);
    assert.ok(Math.abs(pose.z - zsEsperada) < 0.1, `mediana robusta: ${pose.z} ≈ ${zsEsperada}`);
  });

  it("menos de 3 puntos válidos (sobre el horizonte) → null", () => {
    // vy en el horizonte ⇒ viewToStage null.
    const vb = stage.view_box;
    const yHorizonPx = ((stage.proj.horizon_y - vb.minY) / vb.height) * STAGE_RENDER_SIZE;
    const pts: [number, number][] = [
      [100, yHorizonPx - 5],
      [110, yHorizonPx - 5],
      ...[worldToPx(0, 0)],
    ];
    assert.equal(contactToPose(stage.proj, vb, rect, pts), null);
  });
});

describe("footprintFromContact", () => {
  it("extrusión hacia el norte: minZ = contacto − depth (zMundo decreciente)", () => {
    const contact: [number, number][] = [
      [-2, 1.0],
      [-1, 1.02],
      [0, 0.98],
      [1, 1.0],
    ];
    const fp = footprintFromContact(contact, 1.5);
    assert.equal(fp.maxZ, 1.0); // mediana del contacto (borde sur, cara vista)
    assert.equal(fp.minZ, -0.5); // extruido al norte
    assert.equal(fp.minX, -2);
    assert.equal(fp.maxX, 1);
  });
});

describe("matchInventory", () => {
  const item = (id: string, source: "expected" | "extra"): StageReviewItem => ({
    id,
    label: id,
    source,
    action: "keep",
    image_bbox: [0, 0, 10, 10],
    img_w: 1024,
    img_h: 1024,
  });

  it("separa matched/extras/missing", () => {
    const inv = matchInventory(
      ["vol_mesa", "vol_barril", "vol_muro_fondo"],
      [item("vol_mesa", "expected"), item("extra_0", "extra")],
    );
    assert.deepEqual([...inv.matched.keys()], ["vol_mesa"]);
    assert.equal(inv.extras.length, 1);
    assert.deepEqual(inv.missing, ["vol_barril", "vol_muro_fondo"]);
  });

  it("fail-loud: expected desconocido o duplicado", () => {
    assert.throws(() => matchInventory(["vol_mesa"], [item("vol_fantasma", "expected")]));
    assert.throws(() =>
      matchInventory(["vol_mesa"], [item("vol_mesa", "expected"), item("vol_mesa", "expected")]),
    );
  });
});

describe("peelStepsFromInventory", () => {
  const item = (id: string, action: "keep" | "remove"): StageReviewItem => ({
    id,
    label: id,
    source: "extra",
    action,
    image_bbox: [0, 0, 10, 10],
    img_w: 1024,
    img_h: 1024,
  });

  it("ordena por z PINTADA (un elemento recolocado cambia de plano)", () => {
    // La mesa declarada lejos se pintó CERCA (z pequeña) — debe pelarse antes.
    const steps = peelStepsFromInventory([
      { item: item("mesa_recolocada", "keep"), z: 1.2 },
      { item: item("barril", "keep"), z: 4.0 },
      { item: item("muro", "keep"), z: 8.0 },
    ]);
    assert.deepEqual(
      steps.map((s) => s.itemId),
      ["mesa_recolocada", "barril", "muro"],
    );
    assert.deepEqual(steps[0].behindLabels, ["barril", "muro"]);
    assert.deepEqual(steps[2].behindLabels, []);
    assert.match(steps[2].prompt, /ONLY the empty stage floor/);
  });

  it("items sin pose van al final y los remove no aparecen en behindLabels", () => {
    const steps = peelStepsFromInventory([
      { item: item("mancha_remove", "remove"), z: null },
      { item: item("mesa", "keep"), z: 2.0 },
    ]);
    assert.deepEqual(
      steps.map((s) => s.itemId),
      ["mesa", "mancha_remove"],
    );
    assert.deepEqual(steps[0].behindLabels, []); // el remove no guía rellenos
  });
});

describe("collisionGridFromCutouts", () => {
  it("banda [contacto − depth, contacto] siguiendo la polilínea", () => {
    const { grid, warnings } = collisionGridFromCutouts(
      [
        {
          id: "mesa",
          label: "mesa",
          contactWorld: [
            [-2, 1.0],
            [0, 1.0],
            [1, 1.0],
          ],
          depthM: 1.0,
        },
      ],
      rect,
      [],
    );
    assert.equal(warnings.length, 0);
    assert.equal(grid.cols, 32);
    assert.equal(grid.rows, 20);
    // Celda bajo el contacto (x=0, z=1.0): col = (0−(−8))/0.5 = 16, row = (1−(−5))/0.5 = 12.
    assert.equal(grid.grid[11][16], "S"); // dentro de la banda (z=0.75)
    assert.equal(grid.grid[12][16], "S"); // contacto
    assert.equal(grid.grid[14][16], "."); // al sur del contacto: libre
    assert.equal(grid.grid[12][26], "."); // lejos en x: libre
  });

  it("limpia las celdas que invaden una zona de salida y lo reporta", () => {
    const exits = [
      {
        id: "puerta",
        edge: "north" as const,
        to_place_id: "fuera",
        kind: "door" as const,
        label: "Puerta",
        rect: { minX: -1, minZ: 0, maxX: 1, maxZ: 1.5 },
      },
    ];
    const { grid, warnings } = collisionGridFromCutouts(
      [{ id: "caja", label: "caja", contactWorld: [[-0.5, 1.0], [0.5, 1.0]], depthM: 1.0 }],
      rect,
      exits,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /puerta/);
    // La zona de la salida queda limpia.
    assert.equal(grid.grid[12][16], ".");
  });
});

describe("reconstructionDiff", () => {
  const W = 64;
  const H = 64;
  const img = (fill: number): Uint8ClampedArray => {
    const a = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      a[i * 4] = fill;
      a[i * 4 + 1] = fill;
      a[i * 4 + 2] = fill;
      a[i * 4 + 3] = 255;
    }
    return a;
  };

  it("imágenes idénticas → diff 0; parche alterado → hot block localizado", () => {
    const a = img(100);
    const same = reconstructionDiff(a, img(100), W, H);
    assert.equal(same.meanDiff, 0);
    assert.equal(same.hotBlocks.length, 0);

    const b = img(100);
    for (let y = 32; y < 48; y++) {
      for (let x = 0; x < 16; x++) {
        const p = (y * W + x) * 4;
        b[p] = 250;
        b[p + 1] = 250;
        b[p + 2] = 250;
      }
    }
    const diff = reconstructionDiff(a, b, W, H);
    assert.ok(diff.hotBlocks.length > 0);
    assert.equal(diff.hotBlocks[0].y, 32);
    assert.equal(diff.hotBlocks[0].x, 0);
  });

  it("la zona excluida (halos de inpaint) no computa", () => {
    const a = img(100);
    const b = img(100);
    const exclude = new Uint8Array(W * H);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        b[p] = 255;
        exclude[y * W + x] = 1;
      }
    }
    const diff = reconstructionDiff(a, b, W, H, exclude);
    assert.equal(diff.meanDiff, 0);
    assert.equal(diff.hotBlocks.length, 0);
  });
});
