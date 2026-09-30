/** Volumen `custom` (composición 3D libre del motor): schema fail-loud,
 *  una prim por pieza EN ORDEN (contrato con el hero fps por pieza),
 *  huella/colisión desde las piezas y celdas de atlas por pieza. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { volumeCollisionGrid } from "../src/scene/blueprint/collision.js";
import { volumeFootprint } from "../src/scene/blueprint/footprint.js";
import { parseVolumes, type CustomVolume } from "../src/scene/blueprint/volumes.js";
import { volumePrimsForTile, customPartTop, customPartAabb } from "../src/scene/greybox/volume-prims.js";
import { buildLayout } from "../src/scene/greybox/surfaces.js";
import { TILE_CELLS, TILE_MPC, tileWorldRect } from "../src/scene/tile.js";

const CARRETA = {
  id: "carreta",
  label: "carreta entoldada",
  type: "custom",
  at: [72, 74],
  angle: -9,
  parts: [
    { shape: "box", size: [6, 1.6, 3], pos: [0, 1.1, 0], color: "#77572f", desc: "weathered cart bed" },
    { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [-1.8, 0, 1.5], rotX: 1.5708, color: "#4a3a26" },
    { shape: "cylinder", rBottom: 0.9, h: 0.3, pos: [1.8, 0, 1.5], rotX: 1.5708, color: "#4a3a26" },
    {
      shape: "cylinder", rBottom: 1.5, rTop: 1.5, h: 5.6, pos: [2.8, 1.5, 0], rotZ: 1.5708,
      scale: [0.72, 1, 0.95], color: "#8a7d63", desc: "waxed canvas wagon tilt",
    },
  ],
};

function carreta(): CustomVolume {
  const parsed = parseVolumes([CARRETA]);
  assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
  return parsed.volumes[0] as CustomVolume;
}

describe("custom: schema", () => {
  it("acepta la carreta compuesta y expone parts tal cual", () => {
    const v = carreta();
    assert.equal(v.parts.length, 4);
    assert.deepEqual(v.parts[3].scale, [0.72, 1, 0.95]);
  });

  it("rechaza con ruta: parts vacío, dims faltantes por shape, campo desconocido", () => {
    const vacio = parseVolumes([{ ...CARRETA, id: "x", parts: [] }]);
    assert.equal(vacio.ok, false);
    const sinDim = parseVolumes([
      { ...CARRETA, id: "y", parts: [{ shape: "cylinder", h: 3 }] },
    ]);
    assert.equal(sinDim.ok, false);
    assert.match(!sinDim.ok ? sinDim.error : "", /rBottom/);
    const desconocido = parseVolumes([
      { ...CARRETA, id: "z", parts: [{ shape: "sphere", r: 1, displace: 2 }] },
    ]);
    assert.equal(desconocido.ok, false);
  });

  // Ver prism-volume.test.ts: `tall` se retiró con el occluder de la oblicua.
  it("rechaza `tall`, retirado con la vista oblicua", () => {
    const conTall = parseVolumes([{ ...CARRETA, id: "t", tall: true }]);
    assert.equal(conTall.ok, false, "un custom con `tall` tiene que fallar");
    assert.match(!conTall.ok ? conTall.error : "", /tall/);
  });
});

describe("custom: prims", () => {
  it("una prim POR pieza y EN ORDEN, con volId, rot compuesta y scale", () => {
    const v = carreta();
    const prims = volumePrimsForTile(v, []);
    assert.equal(prims.length, 4, "una prim por pieza");
    assert.ok(prims.every((p) => p.volId === "vol_carreta"));
    assert.equal(prims[0].shape, "box");
    assert.equal(prims[3].shape, "cylinder");
    assert.deepEqual(prims[3].scale, [0.72, 1, 0.95]);
    assert.equal(prims[1].rotX, 1.5708);
    assert.equal(prims[3].rotZ, 1.5708, "el toldo tumba su eje a X con rotZ");
    // rotY del conjunto (angle −9°) compuesta en cada pieza.
    const angleRad = (-9 * Math.PI) / 180;
    assert.ok(Math.abs((prims[0].rotY ?? 0) - angleRad) < 1e-9);
    // El offset local rota alrededor de `at`.
    const [ox, oz] = [-1.8, 1.5];
    const ca = Math.cos(angleRad);
    const sa = Math.sin(angleRad);
    assert.ok(Math.abs(prims[1].pos[0] - (72 + ox * ca + oz * sa)) < 1e-9);
    assert.ok(Math.abs(prims[1].pos[2] - (74 + (-ox * sa + oz * ca))) < 1e-9);
  });

  it("pos.y = base del AABB tras rotación: rueda a y:0 apoya tangente (lift=r)", () => {
    const v = carreta();
    const prims = volumePrimsForTile(v, []);
    // Rueda rotX 90° declarada a y:0 → el builder la levanta su radio (0.9)
    // para que el AABB apoye en el suelo (el renderer pivota en el origen).
    assert.ok(Math.abs(prims[1].pos[1] - 0.9) < 1e-3, `rueda: ${prims[1].pos[1]}`);
    // Toldo rotZ 90° con scale x 0.72: lift = r·sx = 1.5·0.72 = 1.08.
    assert.ok(Math.abs(prims[3].pos[1] - (1.5 + 1.08)) < 1e-3, `toldo: ${prims[3].pos[1]}`);
    // Piezas sin rotX/rotZ no cambian (lift 0) — estabilidad de hashes.
    assert.equal(prims[0].pos[1], 1.1);
    // customPartTop cuenta el diámetro de la rueda tumbada, no su h.
    assert.ok(Math.abs(customPartTop(v.parts[1]) - 1.8) < 1e-3);
  });

  it("huella = AABB de las piezas y colisión estampada (solid default)", () => {
    const v = carreta();
    const fp = volumeFootprint(v);
    assert.ok(fp[0] < 72 && fp[2] > 72 && fp[1] < 74 && fp[3] > 74, `huella alrededor de at: ${fp}`);
    assert.ok(fp[2] - fp[0] >= 6, "cubre al menos el ancho de la caja");
    const grid = volumeCollisionGrid([v], tileWorldRect(0, 0));
    assert.ok(grid, "colisiona");
    // solid:false → sin colisión.
    const pasable = { ...v, solid: false };
    assert.equal(volumeCollisionGrid([pasable], tileWorldRect(0, 0)), null);
  });

  it("fps: pieza con desc → celda hero propia (hero_<vol>_p<i>); sin desc → clay", () => {
    const v = carreta();
    const { primsM } = buildFpsTileSpec({ volumes: [v], biome: "dirt" }, "k");
    const layout = buildLayout(primsM);
    const keys = new Set(layout.pages.flatMap((p) => p.cells.map((c) => c.key)));
    assert.ok(keys.has("hero_vol_carreta_p0"), "celda de la caja");
    assert.ok(keys.has("hero_vol_carreta_p3"), "celda del toldo");
    assert.equal(keys.has("hero_vol_carreta_p1"), false, "la rueda sin desc no genera celda");
    const byKey = new Map(layout.pages.flatMap((p) => p.cells).map((c) => [c.key, c]));
    assert.equal(byKey.get("hero_vol_carreta_p3")?.en, "waxed canvas wagon tilt");
    // Las ruedas quedan en clay (mat false → sin celda asignada).
    const wheelIdx = primsM.findIndex((p) => p.volId === "vol_carreta" && p.shape === "cylinder" && !p.heroCells);
    assert.ok(wheelIdx >= 0);
    const wheelAssign = layout.assign[wheelIdx];
    assert.ok(Object.values(wheelAssign.groups).every((g) => g === null), "rueda 100% clay");
  });

  it("el spec del tile con un custom sigue siendo determinista", () => {
    const v = carreta();
    const a = buildFpsTileSpec({ volumes: [v], biome: "dirt" }, "k");
    const b = buildFpsTileSpec({ volumes: [v], biome: "dirt" }, "k");
    assert.deepEqual(a.primsM, b.primsM);
  });

  it("cono, esfera y cilindro con rTop: la forma declarada, apoyada en el suelo y dentro de lo que colisiona", () => {
    // Una pieza de cada forma redonda que admite el zod, con y sin `seg`, y
    // una sin `pos` ni `color` (se planta en el `at` con el color de clay).
    const parsed = parseVolumes([{
      id: "altar", label: "altar de piezas", type: "custom", at: [60, 60],
      parts: [
        { shape: "cone", r: 2, h: 3, pos: [-5, 0, 0] },
        { shape: "cone", r: 1, h: 2, seg: 6, pos: [5, 0, 0] },
        { shape: "sphere", r: 1.5, pos: [0, 0, 5] },
        { shape: "sphere", r: 1, seg: 8, pos: [0, 0, -5] },
        { shape: "cylinder", rBottom: 1, rTop: 2, h: 3 },
      ],
    }]);
    assert.ok(parsed.ok, !parsed.ok ? parsed.error : "");
    const v = parsed.volumes[0] as CustomVolume;
    const prims = volumePrimsForTile(v, []);
    // Tamaños con el contrato de GreyboxPrimitive: cone [r, h, seg],
    // sphere [r, seg?], cylinder [rBottom, h, rTop]. El cono sin seg lleva
    // uno fijo (el renderer no debe decidir la facetación de una pieza).
    assert.deepEqual(prims.map((p) => [p.shape, p.size]), [
      ["cone", [2, 3, 12]],
      ["cone", [1, 2, 6]],
      ["sphere", [1.5]],
      ["sphere", [1, 8]],
      ["cylinder", [1, 3, 2]],
    ]);
    assert.deepEqual(prims[4].pos, [60, 0, 60], "sin pos: en el at, apoyada");
    assert.match(prims[4].color, /^#[0-9a-f]{6}$/i, "sin color: el clay por defecto");
    const altura = [3, 2, 3, 2, 3];
    const radio = [2, 1, 1.5, 1, 2]; // el cilindro abre hacia arriba: manda rTop
    v.parts.forEach((p, i) => {
      const { min, max } = customPartAabb(p, 0);
      assert.ok(Math.abs(min[1]) < 1e-9, `pieza ${i} apoya en y=0 (${min[1]})`);
      assert.ok(Math.abs(max[1] - altura[i]) < 1e-9, `pieza ${i} alta ${altura[i]} (${max[1]})`);
      for (const k of [0, 2]) {
        assert.ok(Math.abs(max[k] - radio[i]) < 1e-9 && Math.abs(min[k] + radio[i]) < 1e-9, `pieza ${i} eje ${k}: ±${radio[i]}`);
      }
      // Lo que se pinta de la pieza (su AABB en planta) colisiona entero, con
      // la pieza SOLA: la huella del conjunto es el AABB de todas y taparía
      // a una pieza que no aportara la suya.
      const grid = volumeCollisionGrid([{ ...v, parts: [p] }], tileWorldRect(0, 0))!;
      const [px, , pz] = prims[i].pos;
      for (const u of [px + min[0] * 0.98, px + max[0] * 0.98]) {
        for (const w of [pz + min[2] * 0.98, pz + max[2] * 0.98]) {
          assert.equal(grid.grid[Math.floor(w)][Math.floor(u)], "S", `pieza ${i}: (${u.toFixed(2)},${w.toFixed(2)}) sin colisión`);
        }
      }
    });
  });

  it("las celdas locales admiten margen: TILE_CELLS es el tope del at", () => {
    assert.equal(TILE_CELLS, 128);
    assert.equal(TILE_MPC, 0.5);
  });
});
