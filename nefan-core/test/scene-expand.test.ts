import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandScenePrimitives, hasUnexpandedPrimitives } from "../src/scene/scene-expand.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";

/** Escena estilo ejemplo del prompt: grid de hierba con una room + puerta sur,
 *  camino como feature y zona de vegetación al sur. */
function makeScene(): Record<string, unknown> {
  return {
    scene_id: "taberna_exp",
    scene_description: "Taberna con patio.",
    size: { cols: 16, rows: 12, meters_per_cell: 0.5 },
    terrain: Array.from({ length: 12 }, () => "g".repeat(16)),
    terrain_legend: {},
    structures: [
      { type: "room", rect: [2, 1, 10, 7], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 4, width: 2 }] },
    ],
    vegetation_zones: [
      { type: "pino", area: [0, 9, 16, 3], density: 0.2 },
    ],
    entities: [
      { id: "antorcha", kind: "decor", name: "antorcha de pared", cell: [4, 3], footprint: [1, 1], glyph: "i", attach: "wall" },
      { id: "player", kind: "player", name: "Tú", cell: [7, 9], footprint: [1, 1], glyph: "@" },
    ],
    ambient_event: "",
  };
}

describe("expandScenePrimitives", () => {
  it("stamps a closed wall perimeter with floor and door gaps", () => {
    const out = expandScenePrimitives(makeScene());
    const grid = out.terrain as string[];
    // rect [2,1,10,7]: muros en row 1 y row 7, cols 2..11.
    assert.equal(grid[1].slice(2, 12), "WWWWWWWWWW");
    // Interior de suelo.
    assert.equal(grid[3].slice(3, 11), "oooooooo");
    // Puerta sur: at=4 width=2 pedida, auto-ensanchada a 3 celdas (mpc 0.5 ⇒
    // hueco mínimo ~1.1 m para el jugador) → cols 6-8 de la fila 7.
    assert.equal(grid[7].slice(2, 12), "WWWW___WWW");
    // Laterales.
    assert.equal(grid[4][2], "W");
    assert.equal(grid[4][11], "W");
    // Fuera del rect sigue siendo hierba.
    assert.equal(grid[0], "g".repeat(16));
    assert.equal(out.__expanded, true);
  });

  it("auto-declares the wall char solid in the legend", () => {
    const out = expandScenePrimitives(makeScene());
    const legend = out.terrain_legend as Record<string, { name: string; solid?: boolean }>;
    assert.equal(legend.W.solid, true);
  });

  it("is idempotent (a second expansion is a no-op)", () => {
    const once = expandScenePrimitives(makeScene());
    const twice = expandScenePrimitives(once);
    assert.equal(twice, once);
    assert.equal(hasUnexpandedPrimitives(once), false);
  });

  it("scatters deterministic vegetation outside rooms and doors", () => {
    const a = expandScenePrimitives(makeScene());
    const b = expandScenePrimitives(makeScene());
    const treesA = (a.entities as Record<string, unknown>[]).filter((e) => e.kind === "tree");
    const treesB = (b.entities as Record<string, unknown>[]).filter((e) => e.kind === "tree");
    assert.ok(treesA.length > 0, "la zona 16x3 con density 0.2 debe plantar árboles");
    assert.deepEqual(treesA, treesB, "misma seed (scene_id) → mismo scatter");
    const grid = a.terrain as string[];
    for (const t of treesA) {
      const [c, r] = t.cell as [number, number];
      assert.ok(r >= 9 && r < 12, `árbol ${t.id} fuera del área`);
      assert.equal(grid[r][c], "g", `árbol ${t.id} sobre celda no-hierba`);
      assert.ok(!(c === 7 && r === 9), "no planta sobre el player");
    }
  });

  it("snaps attach:wall decor to the nearest wall cell", () => {
    const out = expandScenePrimitives(makeScene());
    const torch = (out.entities as Record<string, unknown>[]).find((e) => e.id === "antorcha")!;
    const [c, r] = torch.cell as [number, number];
    const grid = out.terrain as string[];
    assert.equal(grid[r][c], "W", `la antorcha debe quedar sobre un muro, quedó en (${c},${r})="${grid[r][c]}"`);
  });

  it("throws fail-loud on a rect outside the grid or an impossible door", () => {
    const bad1 = { ...makeScene(), structures: [{ type: "room", rect: [10, 1, 10, 7] }] };
    assert.throws(() => expandScenePrimitives(bad1), /se sale del grid/);
    const bad2 = { ...makeScene(), structures: [{ type: "room", rect: [2, 1, 10, 7], doors: [{ side: "south", at: 9, width: 2 }] }] };
    assert.throws(() => expandScenePrimitives(bad2), /no cabe en el lado/);
    const bad3 = { ...makeScene(), vegetation_zones: [{ type: "pino", area: [0, 9, 16, 3], density: 2 }] };
    assert.throws(() => expandScenePrimitives(bad3), /density/);
  });

  it("formatDToWorld expands defensively and the walls collide", () => {
    const world = formatDToWorld(makeScene());
    const tg = world.terrain_grid as { grid: string[]; solid_chars: string[] };
    assert.ok(tg.solid_chars.includes("W"));
    const col = createTerrainCollider(tg as never)!;
    // Muro norte de la room: celda (2,1). mpc 0.5, halfW=4, halfD=3 →
    // centro de la celda: x = 2*0.5 - 4 + 0.25 = -2.75 ; z = 1*0.5 - 3 + 0.25 = -2.25
    assert.ok(col.blocksCircle(-2.75, -2.25, 0.1));
    // Hueco de la puerta (col 6, row 7): x = -0.75 ; z = 0.75 → transitable.
    assert.ok(!col.blocksCircle(-0.75, 0.75, 0.1));
  });
});
