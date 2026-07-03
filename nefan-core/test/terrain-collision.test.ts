import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createTerrainCollider } from "../src/scene/terrain-collision.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";

/** Interior de taberna estilo del ejemplo del prompt: borde W sólido con
 *  puerta "_" al sur, suelo "o". 8×6 celdas, mpc 0.5 ⇒ 4m × 3m, origen en el
 *  centro (halfW=2, halfD=1.5). */
function makeGrid() {
  return {
    grid: [
      "WWWWWWWW",
      "WooooooW",
      "WooooooW",
      "WooooooW",
      "WooooooW",
      "WWW__WWW",
    ],
    cols: 8,
    rows: 6,
    meters_per_cell: 0.5,
    solid_chars: ["W"],
  };
}

describe("createTerrainCollider", () => {
  it("returns null without grid or without solid chars", () => {
    assert.equal(createTerrainCollider(undefined), null);
    assert.equal(createTerrainCollider(null), null);
    assert.equal(createTerrainCollider({ ...makeGrid(), solid_chars: [] }), null);
    // Grid sin ninguna celda del char sólido → null (nada que bloquear).
    assert.equal(
      createTerrainCollider({ ...makeGrid(), grid: ["oooooooo", "oooooooo", "oooooooo", "oooooooo", "oooooooo", "oooooooo"] }),
      null,
    );
  });

  it("throws fail-loud on an inconsistent grid", () => {
    assert.throws(() => createTerrainCollider({ ...makeGrid(), rows: 9 }), /inconsistente/);
    assert.throws(() => createTerrainCollider({ ...makeGrid(), meters_per_cell: 0 }), /inconsistente/);
  });

  it("marks wall cells solid and floor/door cells walkable", () => {
    const col = createTerrainCollider(makeGrid())!;
    assert.ok(col.isSolidCell(0, 0)); // esquina NW
    assert.ok(col.isSolidCell(7, 5)); // esquina SE
    assert.ok(!col.isSolidCell(3, 3)); // suelo interior
    assert.ok(!col.isSolidCell(3, 5)); // puerta "_"
    assert.ok(!col.isSolidCell(-1, 2)); // fuera del grid → no sólido
    assert.ok(!col.isSolidCell(3, 99));
  });

  it("blocksCircle: a point inside a wall blocks, the room centre does not", () => {
    const col = createTerrainCollider(makeGrid())!;
    // Celda (0,0) va de mundo (-2,-1.5) a (-1.5,-1). Su centro:
    assert.ok(col.blocksCircle(-1.75, -1.25, 0.1));
    // Centro de la sala (0,0 mundo): celdas de suelo alrededor.
    assert.ok(!col.blocksCircle(0, 0, 0.4));
  });

  it("blocksCircle: the player radius reaches into the wall before the point does", () => {
    const col = createTerrainCollider(makeGrid())!;
    // El muro oeste ocupa x ∈ [-2, -1.5]. Un punto en x=-1.3 no lo toca…
    assert.ok(!col.blocksCircle(-1.3, 0, 0.1));
    // …pero con radio 0.4 el AABB llega a x=-1.7, dentro del muro.
    assert.ok(col.blocksCircle(-1.3, 0, 0.4));
  });

  it("blocksCircle: a diameter wider than one cell cannot slip between corners", () => {
    // Franja sólida de 1 celda entre dos pasillos: radio 0.4 (diámetro 0.8 >
    // mpc 0.5) centrado sobre la franja debe chocar aunque sus 4 esquinas
    // cayeran fuera; el bucle por celdas cubiertas lo garantiza.
    const col = createTerrainCollider({
      grid: ["ooo", "oWo", "ooo"],
      cols: 3,
      rows: 3,
      meters_per_cell: 0.5,
      solid_chars: ["W"],
    })!;
    assert.ok(col.blocksCircle(0, 0, 0.4)); // celda central del grid 3×3
  });

  it("blocksMove: allows walking OUT of a wall you already overlap, never deeper in", () => {
    const col = createTerrainCollider(makeGrid())!;
    // Origen penetrando el muro oeste (x=-1.6 solapa la celda col 0, x∈[-2,-1.5]).
    // Salir hacia el este (alejándose del muro) NO bloquea…
    assert.ok(!col.blocksMove(-1.6, 0, -1.3, 0, 0.4));
    // …y desde fuera, entrar al muro bloquea.
    assert.ok(col.blocksMove(-1.0, 0, -1.3, 0, 0.4));
    // blocksCircle (posición absoluta) sigue viendo la penetración.
    assert.ok(col.blocksCircle(-1.6, 0, 0.4));
  });

  it("integrates with formatDToWorld: W and w solid by default, legend can override", () => {
    const scene = formatDToWorld({
      scene_id: "s",
      size: { cols: 4, rows: 2, meters_per_cell: 1 },
      terrain: ["Wgwg", "gggg"],
      terrain_legend: { W: { name: "muro", solid: true } },
      entities: [],
    });
    const tg = scene.terrain_grid as { solid_chars: string[]; legend: Record<string, string> };
    assert.deepEqual(tg.solid_chars, ["W", "w"]);
    assert.equal(tg.legend.W, "muro");
    const col = createTerrainCollider(tg as never)!;
    assert.ok(col.isSolidCell(0, 0)); // W
    assert.ok(col.isSolidCell(2, 0)); // w agua
    assert.ok(!col.isSolidCell(1, 0)); // g
  });

  it("legend heuristic: legacy string value naming a wall becomes solid", () => {
    const scene = formatDToWorld({
      scene_id: "s",
      size: { cols: 2, rows: 1, meters_per_cell: 1 },
      terrain: ["Mg"],
      terrain_legend: { M: "muralla derruida" },
      entities: [],
    });
    const tg = scene.terrain_grid as { solid_chars: string[] };
    assert.ok(tg.solid_chars.includes("M"));
  });

  it("legend can un-solid a default char (solid: false)", () => {
    const scene = formatDToWorld({
      scene_id: "s",
      size: { cols: 2, rows: 1, meters_per_cell: 1 },
      terrain: ["wg"],
      terrain_legend: { w: { name: "vado poco profundo", solid: false } },
      entities: [],
    });
    const tg = scene.terrain_grid as { solid_chars: string[] };
    assert.ok(!tg.solid_chars.includes("w"));
    assert.ok(tg.solid_chars.includes("W"));
  });
});
