import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { expandScenePrimitives, hasUnexpandedPrimitives } from "../src/scene/scene-expand.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import { createTerrainCollider } from "../src/scene/terrain-collision.js";

/** Escena con el grid YA escrito (muro cerrado con un hueco de puerta al sur)
 *  y un decor pegado al muro.
 *
 *  Ya NO lleva `vegetation_zones`: el expander dejó de estampar entities de
 *  vegetación en el grid y su zona no significaría nada aquí. La masa forestal
 *  se compone como volúmenes del plan — `derive-vegetation` y
 *  `vegetation-density` cubren lo que este fichero cubría de ella.
 *
 *  Y ya no lleva la primitiva de salas (#301): el muro se escribe a mano en el
 *  `terrain`, que es lo que queda cuando nadie lo estampa por ti. Lo que este
 *  fichero prueba del expander es el `attach:"wall"` y la idempotencia; el
 *  perímetro cerrado por construcción lo declara hoy un `building` con
 *  `cutaway` en `volumes`, cuyo anillo de muro vive en el PLAN y no en el
 *  grid ASCII. */
function makeScene(): Record<string, unknown> {
  const fila = (s: string) => s.padEnd(16, "g");
  return {
    scene_id: "taberna_exp",
    scene_description: "Taberna con patio.",
    size: { cols: 16, rows: 12, meters_per_cell: 0.5 },
    // rect [2,1,10,7]: muros en las filas 1 y 7 (cols 2..11), suelo "o"
    // dentro, y un hueco de puerta de 3 celdas (cols 6..8) en el muro sur.
    terrain: [
      fila(""),
      fila("ggWWWWWWWWWW"),
      fila("ggWooooooooW"),
      fila("ggWooooooooW"),
      fila("ggWooooooooW"),
      fila("ggWooooooooW"),
      fila("ggWooooooooW"),
      fila("ggWWWW___WWW"),
      fila(""),
      fila(""),
      fila(""),
      fila(""),
    ],
    terrain_legend: { o: "tarima de madera" },
    entities: [
      { id: "antorcha", kind: "decor", name: "antorcha de pared", cell: [4, 3], footprint: [1, 1], glyph: "i", attach: "wall" },
      { id: "player", kind: "player", name: "Tú", cell: [7, 9], footprint: [1, 1], glyph: "@" },
    ],
    ambient_event: "",
  };
}

describe("expandScenePrimitives", () => {
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

  it("throws fail-loud on a patch that falls outside the tile", () => {
    // El fail-loud del expander sobre la primitiva que SÍ escribe en el grid:
    // un parche que se sale por la derecha (col 124 + 10 chars > 128).
    const bad = {
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "meadow",
      terrain_patches: [{ at: [124, 70], rows: ["oooooooooo"] }],
      entities: [],
    };
    assert.throws(() => expandScenePrimitives(bad), /se sale del tile/);
    // Y sobre una forma imposible: `rows` que no son cadenas.
    const bad2 = { ...bad, terrain_patches: [{ at: [4, 4], rows: [7] }] };
    assert.throws(() => expandScenePrimitives(bad2), /debe ser \{ at: \[col,row\], rows/);
  });

  it("formatDToWorld expands defensively and the walls collide", () => {
    const world = formatDToWorld(makeScene());
    const tg = world.terrain_grid as { grid: string[]; solid_chars: string[] };
    assert.ok(tg.solid_chars.includes("W"));
    const col = createTerrainCollider(tg as never)!;
    // Muro norte: celda (2,1). mpc 0.5, halfW=4, halfD=3 →
    // centro de la celda: x = 2*0.5 - 4 + 0.25 = -2.75 ; z = 1*0.5 - 3 + 0.25 = -2.25
    assert.ok(col.blocksCircle(-2.75, -2.25, 0.1));
    // Hueco de la puerta (col 6, row 7): x = -0.75 ; z = 0.75 → transitable.
    assert.ok(!col.blocksCircle(-0.75, 0.75, 0.1));
  });
});
