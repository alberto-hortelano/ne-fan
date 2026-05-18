import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { MapTriggerEvaluator } from "../src/world-map/map-triggers.js";

function makeSetup() {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("g");
  s.worldMap.upsertPlace({ id: "robledo", kind: "settlement", parent_id: "world", name: "Robledo" });
  const evaluator = new MapTriggerEvaluator(s);
  return { s, evaluator };
}

describe("MapTriggerEvaluator.evaluateEnter", () => {
  it("fires player_entered triggers on every entry", () => {
    const { s, evaluator } = makeSetup();
    s.worldMap.addTrigger("robledo", {
      id: "guards",
      when: { type: "player_entered" },
      consequences: [{ type: "story_update", delta: "Los guardias te miran." }],
    });
    assert.equal(evaluator.evaluateEnter("robledo").length, 1);
    assert.equal(evaluator.evaluateEnter("robledo").length, 1); // again
  });

  it("fires first_visit triggers once and stamps fired_at", () => {
    const { s, evaluator } = makeSetup();
    s.worldMap.addTrigger("robledo", {
      id: "arrival",
      when: { type: "first_visit" },
      consequences: [{ type: "story_update", delta: "Llegas a Robledo." }],
    });
    const first = evaluator.evaluateEnter("robledo");
    assert.equal(first.length, 1);
    assert.ok(first[0].fired_at);
    assert.equal(evaluator.evaluateEnter("robledo").length, 0); // no re-fire
  });

  it("ignores player_left and player_near triggers on enter", () => {
    const { s, evaluator } = makeSetup();
    s.worldMap.addTrigger("robledo", {
      id: "leave",
      when: { type: "player_left" },
      consequences: [],
    });
    s.worldMap.addTrigger("robledo", {
      id: "near",
      when: { type: "player_near", radius: 5 },
      consequences: [],
    });
    assert.equal(evaluator.evaluateEnter("robledo").length, 0);
  });

  it("returns nothing for an unknown place", () => {
    const { evaluator } = makeSetup();
    assert.deepEqual(evaluator.evaluateEnter("atlantis"), []);
  });
});

describe("MapTriggerEvaluator.evaluateLeave", () => {
  it("fires only player_left triggers", () => {
    const { s, evaluator } = makeSetup();
    s.worldMap.addTrigger("robledo", {
      id: "leave",
      when: { type: "player_left" },
      consequences: [{ type: "story_update", delta: "Dejas Robledo atrás." }],
    });
    s.worldMap.addTrigger("robledo", {
      id: "enter",
      when: { type: "player_entered" },
      consequences: [],
    });
    const fired = evaluator.evaluateLeave("robledo");
    assert.equal(fired.length, 1);
    assert.equal(fired[0].id, "leave");
  });
});
