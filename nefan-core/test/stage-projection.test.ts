import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  scaleAt,
  stageToView,
  viewToStage,
  worldToStage,
  stageToWorld,
  type StageProjParams,
  type StageBounds,
} from "../src/scene/stage/projection.js";
import { railCamera } from "../src/scene/stage/camera.js";
import { fourthWallAlpha, FOURTH_WALL_FADE_DEFAULTS } from "../src/scene/stage/fade.js";

const P: StageProjParams = {
  focal_m: 12,
  depth_m: 8,
  width_m: 12,
  px_per_m: 10,
  horizon_y: 0,
  ground_y: 100,
};

const B: StageBounds = { minX: -6, maxX: 6, minZ: -4, maxZ: 4 };

describe("proyección proscenio", () => {
  it("scaleAt: 1 en la embocadura, decreciente y monótona, clamp de z negativo", () => {
    assert.equal(scaleAt(P, 0), 1);
    assert.equal(scaleAt(P, -3), 1);
    let prev = 1;
    for (let z = 0.5; z <= P.depth_m; z += 0.5) {
      const s = scaleAt(P, z);
      assert.ok(s < prev, `s(${z})=${s} debería ser < s anterior ${prev}`);
      prev = s;
    }
  });

  it("stageToView proyecta la embocadura a ground_y y converge al horizonte", () => {
    assert.deepEqual(stageToView(P, 0, 0), [0, 100]);
    const [, yFar] = stageToView(P, 0, 1000);
    assert.ok(yFar < 15, `a z enorme la y (${yFar}) se acerca al horizonte`);
  });

  it("viewToStage es la inversa de stageToView sobre el suelo", () => {
    for (const [xs, zs] of [[0, 0], [3.5, 2], [-5, 7.9], [2.25, 0.4]] as const) {
      const [vx, vy] = stageToView(P, xs, zs);
      const back = viewToStage(P, vx, vy);
      assert.ok(back, "el punto debería cortar el suelo");
      assert.ok(Math.abs(back![0] - xs) < 1e-9, `x: ${back![0]} ≈ ${xs}`);
      assert.ok(Math.abs(back![1] - zs) < 1e-9, `z: ${back![1]} ≈ ${zs}`);
    }
  });

  it("viewToStage devuelve null en o sobre el horizonte", () => {
    assert.equal(viewToStage(P, 0, P.horizon_y), null);
    assert.equal(viewToStage(P, 0, P.horizon_y - 5), null);
  });

  it("worldToStage/stageToWorld son inversas y respetan la convención cámara-sur", () => {
    // La embocadura (z mundo = maxZ) es zStage 0; el telón (minZ) es depth.
    assert.deepEqual(worldToStage(B, 0, B.maxZ), [0, 0]);
    assert.deepEqual(worldToStage(B, 0, B.minZ), [0, 8]);
    for (const [x, z] of [[1.5, 2], [-4, -3.5], [0, 0]] as const) {
      const [xs, zs] = worldToStage(B, x, z);
      const [bx, bz] = stageToWorld(B, xs, zs);
      assert.ok(Math.abs(bx - x) < 1e-12 && Math.abs(bz - z) < 1e-12);
    }
  });
});

describe("cámara de raíl", () => {
  const OPTS = { deadZone: 1.5, rate: 6, minX: -10, maxX: 10 };

  it("no se mueve dentro de la zona muerta", () => {
    assert.equal(railCamera(0, 1.4, 0.016, OPTS), 0);
    assert.equal(railCamera(0, -1.4, 0.016, OPTS), 0);
  });

  it("converge hacia el borde de la zona muerta al salir el actor", () => {
    let cam = 0;
    for (let i = 0; i < 300; i++) cam = railCamera(cam, 5, 1 / 60, OPTS);
    assert.ok(Math.abs(cam - 3.5) < 0.01, `cam ${cam} ≈ 5 − deadZone`);
  });

  it("es frame-independent (dos pasos de dt/2 == un paso de dt)", () => {
    const one = railCamera(0, 5, 0.1, OPTS);
    const two = railCamera(railCamera(0, 5, 0.05, OPTS), 5, 0.05, OPTS);
    assert.ok(Math.abs(one - two) < 1e-9, `${one} ≈ ${two}`);
  });

  it("clampa al recorrido del raíl", () => {
    let cam = 9.9;
    for (let i = 0; i < 200; i++) cam = railCamera(cam, 50, 1 / 30, OPTS);
    assert.equal(cam, 10);
  });
});

describe("cuarta pared — fade por proximidad", () => {
  it("alpha mínimo pegado a la embocadura, máximo lejos, monótono", () => {
    const d = FOURTH_WALL_FADE_DEFAULTS;
    // Pegado a la embocadura (z mundo ≈ maxZ).
    assert.equal(fourthWallAlpha(B.maxZ, B), d.minAlpha);
    // Al fondo del plató.
    assert.equal(fourthWallAlpha(B.minZ, B), d.maxAlpha);
    let prev = fourthWallAlpha(B.maxZ, B);
    for (let z = B.maxZ - 0.5; z >= B.minZ; z -= 0.5) {
      const a = fourthWallAlpha(z, B);
      assert.ok(a >= prev);
      prev = a;
    }
  });
});
