/** End-to-end del ciclo F3+F4 sin WebSocket: génesis → consequence
 *  plugin_event → dispatcher → save → resume (bind) → segundo evento.
 *  Equivale a lo que hace el bridge en start_session/dialogue_choice/
 *  resume_session, con MemorySessionStorage en lugar de FS+WS. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { dispatchConsequences } from "../src/narrative/consequence-handler.js";
import {
  activatePluginsForNewSession,
  bindPluginsForResume,
  loadGamePluginManifests,
} from "../src/plugins/loader.js";
import { dispatchPluginEvents } from "../src/plugins/dispatcher.js";
import type { Consequence } from "../src/narrative/types.js";

const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));

describe("plugin system end-to-end (F3+F4)", () => {
  it("genesis → plugin_event consequence → tick → save → resume → second tick", async () => {
    const storage = new MemorySessionStorage();

    // start_session
    const s1 = new NarrativeState(storage);
    s1.startNewSession("plugtest");
    const loaded1 = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    const active1 = activatePluginsForNewSession(s1, loaded1);
    const counterId = loaded1.find((l) => l.manifest.name === "test_counter")!.id;
    const listenerId = loaded1.find((l) => l.manifest.name === "test_listener")!.id;
    s1.recordSceneLoaded("scene_1", { id: "scene_1" });

    // dialogue_choice: se registra la elección y el LLM devuelve una
    // consequence plugin_event (mismo flujo que el case del bridge).
    const eventId = s1.recordDialogueEvent("Boris", "¿Compras?", ["Sí", "No"], 0, "");
    const consequences: Consequence[] = [
      { type: "story_update", delta: "El mostrador cruje." },
      { type: "plugin_event", plugin_id: counterId, event_type: "counter_inc", payload: {} },
    ];
    const dispatched = dispatchConsequences(s1, eventId, consequences);
    assert.equal(dispatched.pluginEvents.length, 1);
    // La consequence queda auditada en dialogue_history aunque el efecto lo
    // aplique el tick de plugins.
    const recorded = s1.dialogue_history.flatMap((d) => d.narrative_consequences);
    assert.ok(recorded.some((c) => c.type === "plugin_event"));

    const tick1 = dispatchPluginEvents(s1, active1, dispatched.pluginEvents);
    assert.equal(tick1.ok, true);
    assert.equal(tick1.effects.length, 2); // counter + listener
    assert.equal(await s1.save(), true);

    // resume_session en un proceso nuevo
    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    const active2 = bindPluginsForResume(s2, loadGamePluginManifests(FIXTURE_GAMES, "plugtest"));
    assert.deepEqual(s2.getPluginRecord(counterId)?.slice, { count: 1 });

    // Segundo evento tras el resume: los contadores continúan.
    const tick2 = dispatchPluginEvents(s2, active2, [
      { pluginId: counterId, type: "counter_inc", payload: {} },
    ]);
    assert.equal(tick2.ok, true);
    assert.deepEqual(s2.getPluginRecord(counterId)?.slice, { count: 2 });
    assert.deepEqual(s2.getPluginRecord(listenerId)?.slice, { last_seen: 2, times: 2 });

    // El save final persiste el segundo tick.
    assert.equal(await s2.save(), true);
    const s3 = new NarrativeState(storage);
    assert.equal(await s3.loadSession(s1.session_id), true);
    assert.deepEqual(s3.getPluginRecord(listenerId)?.slice, { last_seen: 2, times: 2 });
  });
});
