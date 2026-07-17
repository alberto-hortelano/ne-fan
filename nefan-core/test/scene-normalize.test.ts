import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatDToWorld } from "../src/scene/scene-normalize.js";

/** A minimal but valid Map Format D scene: 10×6 grid (meters_per_cell 2 ⇒
 *  20m × 12m), one building, one npc, one player start. */
function makeFormatD(): Record<string, unknown> {
  return {
    scene_id: "taberna_test",
    scene_description: "Una taberna de prueba.",
    size: { cols: 10, rows: 6, meters_per_cell: 2 },
    terrain: [
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
      "gggggggggg",
    ],
    entities: [
      { id: "tavern", kind: "building", name: "Taberna", cell: [2, 1], footprint: [4, 2], glyph: "H", texture_hash: "abc" },
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [3, 2], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [5, 5], footprint: [1, 1], glyph: "@" },
    ],
    ambient_event: "El fuego crepita.",
  };
}

describe("formatDToWorld", () => {
  it("es idempotente: una world scene ya normalizada pasa intacta", () => {
    const w = formatDToWorld(makeFormatD());
    assert.equal(formatDToWorld(w), w, "misma referencia, sin re-normalizar");
  });

  it("es idempotente también para tiles (conservan `tile` pero no `biome`)", () => {
    const w = formatDToWorld({
      tile: { tx: 0, ty: 0 },
      scene_id: "tile_0_0",
      biome: "grass",
      scene_description: "campo",
      terrain_features: [],
      entities: [],
      ambient_event: "",
    });
    assert.ok(Array.isArray(w.objects), "primera pasada normaliza");
    // Sin la guarda __format_d, esta segunda pasada re-entraría en la
    // expansión de tile (tile presente, biome ya consumido) y lanzaría.
    assert.equal(formatDToWorld(w), w);
  });

  it("converts size to centred world dimensions", () => {
    const w = formatDToWorld(makeFormatD());
    assert.deepEqual(w.dimensions, { width: 20, depth: 12, height: 3 });
  });

  it("places a building object at its footprint centre in metres", () => {
    const w = formatDToWorld(makeFormatD());
    const objects = w.objects as Record<string, unknown>[];
    assert.equal(objects.length, 1);
    const tavern = objects[0];
    // cell [2,1] footprint [4,2], mpc 2, halfW 10, halfD 6
    // x = (2 + 4/2)*2 - 10 = -2 ; z = (1 + 2/2)*2 - 6 = -2
    assert.deepEqual(tavern.position, [-2, 0, -2]);
    // Altura default por kind: building 2.5 m (KIND_DEFAULT_HEIGHT).
    assert.deepEqual(tavern.scale, [8, 2.5, 4]);
    assert.equal(tavern.category, "building");
    assert.equal(tavern.description, "Taberna");
    assert.equal(tavern.texture_hash, "abc");
  });

  it("extracts npcs and the player start", () => {
    const w = formatDToWorld(makeFormatD());
    const npcs = w.npcs as Record<string, unknown>[];
    assert.equal(npcs.length, 1);
    assert.equal(npcs[0].id, "barkeep");
    // player cell [5,5]: x = (5+0.5)*2 - 10 = 1 ; z = (5+0.5)*2 - 6 = 5
    assert.deepEqual(w.__player_start, { x: 1, z: 5 });
  });

  it("maps tree kind to prop category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "oak", kind: "tree", name: "Roble", cell: [0, 0], footprint: [1, 1], glyph: "T" });
    const w = formatDToWorld(d);
    const oak = (w.objects as Record<string, unknown>[]).find((o) => o.id === "oak");
    assert.equal(oak?.category, "prop");
    // El default de altura sale del KIND (tree → 4 m), no de la category.
    assert.equal((oak?.scale as number[])[1], 4);
  });

  it("respeta la altura explícita `h` (metros) y recorta valores disparatados", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push(
      { id: "torre", kind: "building", name: "Torre", cell: [7, 0], footprint: [2, 2], glyph: "t", h: 6.5 },
      { id: "megalito", kind: "prop", name: "Megalito", cell: [0, 3], footprint: [1, 1], glyph: "M", h: 999 },
    );
    const w = formatDToWorld(d);
    const objs = w.objects as Record<string, unknown>[];
    assert.equal((objs.find((o) => o.id === "torre")?.scale as number[])[1], 6.5);
    // Techo duro de 20 m (MAX_ENTITY_HEIGHT_M).
    assert.equal((objs.find((o) => o.id === "megalito")?.scale as number[])[1], 20);
  });

  it("un `h` inválido cae al default por kind (tolerante, como shape)", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push(
      { id: "caja", kind: "prop", name: "Caja", cell: [0, 3], footprint: [1, 1], glyph: "c", h: -2 },
      { id: "gema", kind: "item", name: "Gema", cell: [1, 3], footprint: [1, 1], glyph: "g", h: "alta" },
      { id: "cartel", kind: "decor", name: "Cartel", cell: [2, 3], footprint: [1, 1], glyph: "i" },
    );
    const w = formatDToWorld(d);
    const objs = w.objects as Record<string, unknown>[];
    assert.equal((objs.find((o) => o.id === "caja")?.scale as number[])[1], 1);
    assert.equal((objs.find((o) => o.id === "gema")?.scale as number[])[1], 0.5);
    assert.equal((objs.find((o) => o.id === "cartel")?.scale as number[])[1], 0.5);
  });

  it("keeps decor kind as its own walkable category", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[]).push({ id: "torch", kind: "decor", name: "antorcha de pared", cell: [1, 0], footprint: [1, 1], glyph: "i" });
    const w = formatDToWorld(d);
    const torch = (w.objects as Record<string, unknown>[]).find((o) => o.id === "torch");
    assert.equal(torch?.category, "decor");
  });

  it("normalizes an object-form legend to plain names and emits solid_chars", () => {
    const d = makeFormatD();
    d.terrain_legend = { W: { name: "muro de piedra", solid: true }, o: "tablones" };
    const w = formatDToWorld(d);
    const tg = w.terrain_grid as { legend: Record<string, string>; solid_chars: string[] };
    assert.equal(tg.legend.W, "muro de piedra");
    assert.equal(tg.legend.o, "tablones");
    assert.deepEqual(tg.solid_chars, ["W", "w"]);
  });

  it("returns a non-Format-D payload unchanged", () => {
    const legacy = { room_id: "crypt", dimensions: { width: 10, height: 4, depth: 8 }, surfaces: {}, objects: [] };
    assert.equal(formatDToWorld(legacy), legacy);
  });

  it("throws fail-loud on a malformed entity (missing cell)", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0] = { id: "broken", kind: "building", name: "X", footprint: [1, 1] };
    assert.throws(() => formatDToWorld(d), /missing cell/);
  });

  it("throws on an invalid kind", () => {
    const d = makeFormatD();
    (d.entities as Record<string, unknown>[])[0] = { id: "x", kind: "dragon", name: "X", cell: [0, 0], footprint: [1, 1] };
    assert.throws(() => formatDToWorld(d), /invalid kind/);
  });
});
