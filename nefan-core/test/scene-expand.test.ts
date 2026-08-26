import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandScenePrimitives, hasUnexpandedPrimitives } from "../src/scene/scene-expand.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";

/** Escena estilo ejemplo del prompt: grid de hierba con una room + puerta sur
 *  y un decor pegado al muro.
 *
 *  Ya NO lleva `vegetation_zones`: el expander dejó de estampar entities de
 *  vegetación en el grid (esta tanda) y su zona no significaría nada aquí. La
 *  masa forestal se compone como volúmenes del plan — `derive-vegetation` y
 *  `vegetation-density` cubren lo que este fichero cubría de ella. */
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
