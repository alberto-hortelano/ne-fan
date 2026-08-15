/** Superficies del modo FPS: clasificación, layout determinista y el spec
 *  fps del tile. El JSON canónico del layout es el CONTRATO con el pintor
 *  Python (surface_atlas_generator.py) — si cambia aquí, cambia allí. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFpsTileSpec } from "../src/scene/blueprint/fps-spec.js";
import { parseVolumes } from "../src/scene/blueprint/volumes.js";
import {
  MAT_INFO,
  buildLayout,
  canonicalSurfaceLayoutJson,
  classify,
  type SurfacePrim,
} from "../src/scene/greybox/surfaces.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const medievalPlan = () =>
  JSON.parse(
    readFileSync(join(HERE, "..", "..", "labs", "render", "fixtures", "medieval", "plan.json"), "utf-8"),
  ) as { volumes: unknown; biome?: string };

function medievalPrims(): { primsM: SurfacePrim[]; volumes: ReturnType<typeof parseVolumes> } {
  const plan = medievalPlan();
  const parsed = parseVolumes(plan.volumes);
  assert.ok(parsed.ok, "fixture medieval parsea");
  const { primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: plan.biome ?? "grass" }, "test_fps");
  return { primsM, volumes: parsed };
}

describe("surfaces: classify", () => {
  const box = (over: Partial<SurfacePrim>): SurfacePrim => ({
    shape: "box",
    size: [4, 2.5, 4],
    pos: [0, 0, 0],
    color: "#c9b89a",
    cat: "building",
    ...over,
  });

  it("hastiales del gable son MURO, faldones teja (hallazgo del bench)", () => {
    const gable: SurfacePrim = { shape: "gable", size: [4, 2, 4], pos: [0, 2.5, 0], color: "#a05a38", cat: "building" };
    assert.equal(classify(gable, "caps"), "wall_plaster");
    assert.equal(classify(gable, "side"), "roof_tile");
  });

  it("puerta pintada, muros por color, suelo grande vs detalle", () => {
    assert.equal(classify(box({ color: "#2a2018" }), "side"), "door_wood");
    assert.equal(classify(box({ color: "#6b543a" }), "side"), "wall_timber");
    assert.equal(classify(box({ color: "#b3a68e" }), "side"), "wall_stone");
    const suelo = box({ cat: "terrain", size: [64, 0.05, 64], color: "#8d6f4e" });
    assert.equal(classify(suelo, "top"), "ground_dirt");
    const detalle: SurfacePrim = { shape: "polygon", size: [0.01], pos: [0, 0, 0], points: [[0, 0], [1, 0], [1, 1]], color: "#aaa17e", cat: "terrain" };
    assert.equal(classify(detalle, "caps"), null);
  });

  it("mat por-prim: string, objeto con fallthrough y false→clay", () => {
    assert.equal(classify(box({ mat: "stone_floor" }), "top"), "stone_floor");
    assert.equal(classify(box({ mat: { top: "stone_floor" } }), "top"), "stone_floor");
    // clave ausente en el objeto → reglas por defecto
    assert.equal(classify(box({ mat: { top: "stone_floor" } }), "side"), "wall_plaster");
    assert.equal(classify(box({ mat: { side: false } }), "side"), null);
  });

  it("toda clase del catálogo tiene descripción no vacía", () => {
    for (const [mat, info] of Object.entries(MAT_INFO)) {
      assert.ok(info.en.length > 10, `descripción corta en ${mat}`);
    }
  });
});

describe("surfaces: layout", () => {
  it("determinista: dos construcciones dan el mismo JSON canónico", () => {
    const { primsM } = medievalPrims();
    const a = canonicalSurfaceLayoutJson(buildLayout(primsM));
    const b = canonicalSurfaceLayoutJson(buildLayout(primsM));
    assert.equal(a, b);
  });

  it("≤12 celdas por página, tiles primero, rects dentro de página", () => {
    const { primsM } = medievalPrims();
    const layout = buildLayout(primsM);
    assert.ok(layout.pages.length >= 1);
    for (const page of layout.pages) {
      assert.ok(page.cells.length <= 12);
      for (const cell of page.cells) {
        const [x, y, w, h] = cell.rect ?? [0, 0, 0, 0];
        assert.ok(x >= 0 && y >= 0 && x + w <= layout.page_px && y + h <= layout.page_px, cell.key);
      }
    }
    const kinds = layout.pages.flatMap((p) => p.cells.map((c) => c.kind));
    const firstUnique = kinds.indexOf("unique");
    if (firstUnique >= 0) {
      assert.ok(kinds.slice(firstUnique).every((k) => k === "unique"), "tiles antes que uniques");
    }
    // La asignación referencia celdas existentes.
    const keys = new Set(layout.pages.flatMap((p) => p.cells.map((c) => c.key)));
    for (const a of layout.assign) {
      for (const key of Object.values(a.groups)) {
        if (key) assert.ok(keys.has(key), `assign a celda inexistente ${key}`);
      }
    }
  });
});

describe("buildFpsTileSpec", () => {
  it("cierra cutaways, escala a metros y NO muta el plan", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    const taberna = parsed.volumes.find((v) => v.id === "taberna_serrana");
    assert.ok(taberna && taberna.type === "building" && taberna.cutaway === true, "la fixture tiene un cutaway");
    const { spec, primsM } = buildFpsTileSpec({ volumes: parsed.volumes, biome: "dirt" }, "k");
    // No mutación: el plan de entrada conserva su cutaway.
    assert.equal((taberna as { cutaway?: boolean }).cutaway, true);
    // Cerrado: el edificio emite tejado (gable) en el spec fps.
    const tabernaPrims = spec.primitives.filter((p) => p.volId === "vol_taberna_serrana");
    assert.ok(tabernaPrims.some((p) => p.shape === "gable"), "taberna cerrada con tejado");
    // Metros: el suelo base mide 64 m y las alturas quedan en rango humano.
    const floor = primsM.find((p) => p.cat === "terrain" && p.shape === "box");
    assert.ok(floor && Math.abs(floor.size[0] - 64) < 1e-6);
    const wallPrim = primsM.find((p) => p.cat === "building" && p.size[1] > 1);
    assert.ok(wallPrim && wallPrim.size[1] <= 12, "alturas en metros, no celdas");
  });

  it("surface_desc del volumen → celda hero con esa descripción", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    const volumes = parsed.volumes.map((v) =>
      v.id === "taberna_serrana" ? { ...v, surface_desc: "facade with a faded sun mural" } : v,
    );
    const { primsM } = buildFpsTileSpec({ volumes, biome: "dirt" }, "k");
    const layout = buildLayout(primsM);
    const hero = layout.pages.flatMap((p) => p.cells).find((c) => c.heroOf === "vol_taberna_serrana");
    assert.ok(hero, "celda hero de la taberna");
    assert.equal(hero.en, "facade with a faded sun mural");
    assert.equal(hero.kind, "unique");
  });

  it("stagger anti z-fighting: los rasgos ground no comparten y, determinista", () => {
    const plan = medievalPlan();
    const parsed = parseVolumes(plan.volumes);
    assert.ok(parsed.ok);
    // Camino con codo (2 cajas + 3 juntas cilíndricas) + plaza: en el greybox
    // compartido todas las prims de una capa son coplanares exactas.
    const ground = [
      { id: "camino", kind: "path" as const, points: [[20, 20], [80, 20], [80, 80]] as [number, number][], w: 4, material: "dirt" as const },
      { id: "plaza", kind: "area" as const, rect: [30, 30, 20, 20] as [number, number, number, number], material: "cobblestone" as const },
    ];
    const build = () =>
      buildFpsTileSpec({ ground, volumes: parsed.volumes, biome: "dirt" }, "test_fps");
    const { spec, primsM } = build();
    // Rasgos ground = prims terrain|water noShadow en la banda de capas
    // (Y_AREA 0.05 … Y_DECK 0.18 en celdas → índice compartido con el spec).
    const groundIdxs = spec.primitives
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (p.cat === "terrain" || p.cat === "water") && p.noShadow && p.pos[1] >= 0.045 && p.pos[1] <= 0.185)
      .map(({ i }) => i);
    assert.ok(groundIdxs.length >= 6, `camino+plaza emiten ≥6 prims ground (hay ${groundIdxs.length})`);
    const ys = groundIdxs.map((i) => primsM[i].pos[1]);
    assert.equal(new Set(ys).size, ys.length, "ninguna pareja de rasgos ground comparte y exacta");
    // Cada prim sube respecto a su y escalada, poco (stagger mm, no cm por prim).
    for (const i of groundIdxs) {
      const lift = primsM[i].pos[1] - spec.primitives[i].pos[1] * 0.5;
      assert.ok(lift > 0 && lift <= groundIdxs.length * 0.002 + 1e-9, `lift ${lift} en rango`);
    }
    // Las prims NO ground (suelo base, detalle, volúmenes) no se desplazan.
    for (let i = 0; i < spec.primitives.length; i++) {
      if (groundIdxs.includes(i)) continue;
      assert.ok(Math.abs(primsM[i].pos[1] - spec.primitives[i].pos[1] * 0.5) < 1e-9);
    }
    // Determinista: dos builds → mismas y.
    const again = build();
    assert.deepEqual(groundIdxs.map((i) => again.primsM[i].pos[1]), ys);
  });
});
