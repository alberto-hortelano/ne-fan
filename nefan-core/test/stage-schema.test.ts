import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseStage, MAX_STAGE_EXITS } from "../src/scene/stage/schema.js";

const validExit = (over: Record<string, unknown> = {}) => ({
  id: "puerta_cocina",
  edge: "north",
  to_place_id: "posada_cocina",
  zone: [14, 0, 4, 2],
  kind: "door",
  label: "Puerta a la cocina",
  ...over,
});

const validStage = (over: Record<string, unknown> = {}) => ({
  exits: [validExit()],
  ...over,
});

describe("parseStage", () => {
  it("acepta un stage mínimo (solo exits)", () => {
    const r = parseStage(validStage());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.stage.exits.length, 1);
      assert.equal(r.stage.exits[0].edge, "north");
    }
  });

  it("acepta el stage completo (focal, backdrop, cuarta pared, tarimas)", () => {
    const r = parseStage(
      validStage({
        focal_m: 10,
        backdrop: { description: "Pared de piedra con chimenea encendida" },
        fourth_wall: { present: true, doors: [{ col: 10, w: 6 }] },
        platforms: [{ rect: [2, 2, 6, 3], h: 0.6, label: "tarima del bardo" }],
      }),
    );
    assert.equal(r.ok, true);
  });

  it("rechaza un stage sin exits", () => {
    const r = parseStage({ exits: [] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /exits/);
  });

  it("rechaza claves desconocidas (strict)", () => {
    const r = parseStage(validStage({ camara: "norte" }));
    assert.equal(r.ok, false);
  });

  it("rechaza un edge fuera del enum", () => {
    const r = parseStage({ exits: [validExit({ edge: "arriba" })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /exits/);
  });

  it("rechaza ids de exit duplicados", () => {
    const r = parseStage({ exits: [validExit(), validExit({ zone: [0, 4, 2, 2], edge: "west" })] });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /duplicado/);
  });

  it("rechaza más de MAX_STAGE_EXITS salidas", () => {
    const exits = Array.from({ length: MAX_STAGE_EXITS + 1 }, (_, i) =>
      validExit({ id: `exit_${i}`, to_place_id: `place_${i}` }),
    );
    const r = parseStage({ exits });
    assert.equal(r.ok, false);
  });

  it("rechaza una zone que no sea [col,row,w,h] positivo", () => {
    assert.equal(parseStage({ exits: [validExit({ zone: [1, 2, 3] })] }).ok, false);
    assert.equal(parseStage({ exits: [validExit({ zone: [1, 2, 0, 3] })] }).ok, false);
    assert.equal(parseStage({ exits: [validExit({ zone: [-1, 2, 3, 3] })] }).ok, false);
  });
});
