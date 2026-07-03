import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateScene } from "../src/scene/scene-validate.js";

/** Escena jugable: room con puerta sur, player fuera junto al camino. */
function makeScene(): Record<string, unknown> {
  return {
    scene_id: "taberna_val",
    place_id: "taberna",
    size: { cols: 16, rows: 12, meters_per_cell: 0.5 },
    terrain: Array.from({ length: 12 }, () => "g".repeat(16)),
    terrain_legend: {},
    structures: [
      { type: "room", rect: [2, 1, 10, 7], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 4, width: 2 }] },
    ],
    entities: [
      { id: "barkeep", kind: "npc", name: "Tabernero", cell: [5, 4], footprint: [1, 1], glyph: "n" },
      { id: "player", kind: "player", name: "Tú", cell: [7, 9], footprint: [1, 1], glyph: "@" },
    ],
  };
}

const linkedPlace = () => ({ exists: true, kind: "interior", outgoing_links: 1 });

describe("validateScene", () => {
  it("accepts a playable scene (door + reachable edge + reachable npc)", () => {
    const r = validateScene(makeScene(), linkedPlace);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
    assert.equal(r.stats.border_reachable, true);
    // width 2 pedida → auto-ensanchada a 3 celdas por el expander (mpc 0.5).
    assert.equal(r.stats.doors_total, 3);
    assert.equal(r.stats.doors_reachable, 3);
    assert.equal(r.stats.npcs_reachable, 1);
  });

  it("rejects a sealed room with the player inside (no reachable edge)", () => {
    const s = makeScene();
    (s.structures as Record<string, unknown>[])[0].doors = [];
    (s.entities as Record<string, unknown>[])[1].cell = [5, 4]; // player dentro
    (s.entities as Record<string, unknown>[])[0].cell = [6, 4];
    const r = validateScene(s, linkedPlace);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("borde del mapa")), r.errors.join(" | "));
  });

  it("rejects a player spawned on a wall or on a prop footprint", () => {
    const s1 = makeScene();
    (s1.entities as Record<string, unknown>[])[1].cell = [2, 1]; // muro
    const r1 = validateScene(s1, linkedPlace);
    assert.ok(r1.errors.some((e) => e.includes("spawn del player")), r1.errors.join(" | "));

    const s2 = makeScene();
    (s2.entities as Record<string, unknown>[]).push({ id: "mesa", kind: "prop", name: "mesa", cell: [7, 9], footprint: [2, 2], glyph: "m" });
    const r2 = validateScene(s2, linkedPlace);
    assert.ok(r2.errors.some((e) => e.includes("spawn del player")), r2.errors.join(" | "));
  });

  it("rejects undeclared terrain chars and row/col mismatches", () => {
    const s = makeScene();
    (s.terrain as string[])[0] = "X" + "g".repeat(15);
    const r = validateScene(s, linkedPlace);
    assert.ok(r.errors.some((e) => e.includes('sin declarar') && e.includes('"X"')), r.errors.join(" | "));

    const s2 = makeScene();
    (s2.terrain as string[]).pop();
    const r2 = validateScene(s2, linkedPlace);
    assert.ok(r2.errors.some((e) => e.includes("filas")), r2.errors.join(" | "));
  });

  it("warns (not errors) on an unreachable NPC", () => {
    const s = makeScene();
    // NPC encerrado en una segunda room sin puertas.
    (s.structures as Record<string, unknown>[]).push({ type: "room", rect: [13, 9, 3, 3], doors: [] });
    (s.entities as Record<string, unknown>[])[0].cell = [14, 10];
    const r = validateScene(s, linkedPlace);
    assert.equal(r.ok, true, r.errors.join(" | "));
    assert.ok(r.warnings.some((w) => w.includes("barkeep")), r.warnings.join(" | "));
    assert.equal(r.stats.npcs_reachable, 0);
  });

  it("turns an impossible primitive into a readable error (no throw)", () => {
    const s = makeScene();
    (s.structures as Record<string, unknown>[])[0].rect = [10, 1, 10, 7];
    const r = validateScene(s, linkedPlace);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("se sale del grid")), r.errors.join(" | "));
  });

  it("requires a missing player entity", () => {
    const s = makeScene();
    s.entities = (s.entities as Record<string, unknown>[]).filter((e) => e.kind !== "player");
    const r = validateScene(s, linkedPlace);
    assert.ok(r.errors.some((e) => e.includes('kind "player"')), r.errors.join(" | "));
  });

  it("enforces the exterior link rule via placeContext", () => {
    const rMissing = validateScene(makeScene(), () => ({ exists: false, outgoing_links: 0 }));
    assert.ok(rMissing.errors.some((e) => e.includes("map_upsert_place")), rMissing.errors.join(" | "));

    const rUnlinked = validateScene(makeScene(), () => ({ exists: true, kind: "interior", outgoing_links: 0 }));
    assert.ok(rUnlinked.errors.some((e) => e.includes("map_link")), rUnlinked.errors.join(" | "));

    // Sin placeContext (validación offline) la regla no aplica.
    const rOffline = validateScene(makeScene());
    assert.equal(rOffline.ok, true, rOffline.errors.join(" | "));
  });
});
