import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import type { Consequence } from "../src/narrative/types.js";

function makeState() {
  const s = new NarrativeState(new MemorySessionStorage());
  s.startNewSession("game");
  s.recordSceneLoaded("scene_1", { id: "scene_1" });
  return s;
}

describe("dispatchConsequences", () => {
  it("emits ambient message when consequences are empty", () => {
    const s = makeState();
    const r = dispatchConsequences(s, "evt_1", []);
    assert.equal(r.injectedDialogue, false);
    assert.equal(r.effects.length, 1);
    assert.equal(r.effects[0].kind, "ambient_message");
  });

  it("dialogue consequence becomes show_dialogue effect", () => {
    const s = makeState();
    const cs: Consequence[] = [
      { type: "dialogue", speaker: "Aldo", text: "Hola", choices: ["a", "b"] },
    ];
    const r = dispatchConsequences(s, "evt_1", cs);
    assert.equal(r.injectedDialogue, true);
    assert.equal(r.effects[0].kind, "show_dialogue");
    if (r.effects[0].kind === "show_dialogue") {
      assert.equal(r.effects[0].speaker, "Aldo");
      assert.equal(r.effects[0].text, "Hola");
    }
  });

  it("story_update appends to story_so_far", () => {
    const s = makeState();
    const cs: Consequence[] = [{ type: "story_update", delta: "Algo cambia" }];
    dispatchConsequences(s, "evt_1", cs);
    assert.equal(s.story_so_far, "Algo cambia");
  });

  it("spawn_entity records on state and emits effect with resolved position", () => {
    const s = makeState();
    s.recordDialogueEvent("Aldo", "?", [], -1); // event_id evt_0001
    const cs: Consequence[] = [
      {
        type: "spawn_entity",
        entity_kind: "npc",
        description: "guard",
        position_hint: "near_player",
        name: "Marcus",
      },
    ];
    const r = dispatchConsequences(s, "evt_0001", cs, {
      playerPosition: [10, 0, 5],
      playerForward: [0, 0, -1],
      generateEntityId: () => "narr_npc_test",
    });
    assert.equal(s.entities.length, 1);
    assert.equal(s.entities[0].id, "narr_npc_test");
    assert.equal(s.entities[0].type, "npc");
    assert.deepEqual(s.entities[0].position, [10, 0, 0]); // player + fwd*5
    assert.equal(r.effects[0].kind, "spawn_entity");
    if (r.effects[0].kind === "spawn_entity") {
      assert.equal(r.effects[0].name, "Marcus");
      assert.equal(r.effects[0].entityKind, "npc");
    }
  });

  it("schedule_event emits stub effect", () => {
    const s = makeState();
    const cs: Consequence[] = [
      { type: "schedule_event", description: "ambush", trigger: "timer:60" },
    ];
    const r = dispatchConsequences(s, "evt_1", cs);
    assert.equal(r.effects[0].kind, "schedule_event");
  });

  it("records every consequence on the matching dialogue event", () => {
    const s = makeState();
    const eventId = s.recordDialogueEvent("a", "b", [], -1);
    const cs: Consequence[] = [
      { type: "story_update", delta: "x" },
      { type: "schedule_event", description: "y" },
    ];
    dispatchConsequences(s, eventId, cs);
    assert.equal(s.dialogue_history[0].narrative_consequences.length, 2);
  });
});
