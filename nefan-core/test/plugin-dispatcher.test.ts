import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  activatePluginsForNewSession,
  loadGamePluginManifests,
} from "../src/plugins/loader.js";
import {
  MAX_EMITS_PER_TICK,
  dispatchPluginEvents,
} from "../src/plugins/dispatcher.js";
import type { PluginManifest } from "../src/plugins/types.js";

const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));

function activeSession(gameId: string): {
  state: NarrativeState;
  manifests: Map<string, PluginManifest>;
  idOf: (name: string) => string;
} {
  const state = new NarrativeState(new MemorySessionStorage());
  state.startNewSession(gameId);
  const loaded = loadGamePluginManifests(FIXTURE_GAMES, gameId);
  const manifests = activatePluginsForNewSession(state, loaded);
  const idOf = (name: string) => {
    const lp = loaded.find((l) => l.manifest.name === name);
    assert.ok(lp, `plugin ${name} no encontrado`);
    return lp.id;
  };
  return { state, manifests, idOf };
}

describe("dispatchPluginEvents", () => {
  it("counter chain: counter_inc updates the counter and the listener hears counter_changed", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_counter"), type: "counter_inc", payload: {} },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(state.getPluginRecord(idOf("test_counter"))?.slice, { count: 1 });
    // El listener procesó el counter_changed emitido (nivel 3, mismo tick).
    assert.deepEqual(state.getPluginRecord(idOf("test_listener"))?.slice, {
      last_seen: 1,
      times: 1,
    });
    // Un plugin_applied por aplicación: counter + listener.
    assert.deepEqual(
      result.effects.map((e) => [e.pluginId, e.eventType]),
      [
        [idOf("test_counter"), "counter_inc"],
        [idOf("test_listener"), "counter_changed"],
      ],
    );
    assert.deepEqual(result.effects[0].emitted, [
      { type: "counter_changed", payload: { count: 1 } },
    ]);
    assert.ok(result.effects[0].changedPaths.includes(`plugins.${idOf("test_counter")}.slice`));
  });

  it("an event without `when` match leaves state untouched", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    // counter_changed sin emisor: sólo lo consume el listener; el counter no.
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_listener"), type: "counter_changed", payload: { count: 9 } },
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(state.getPluginRecord(idOf("test_counter"))?.slice, { count: 0 });
    assert.deepEqual(state.getPluginRecord(idOf("test_listener"))?.slice, {
      last_seen: 9,
      times: 1,
    });
  });

  it("unknown plugin id aborts with state intact", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: "f".repeat(64), type: "counter_inc", payload: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "unknown_plugin");
    assert.deepEqual(state.getPluginRecord(idOf("test_counter"))?.slice, { count: 0 });
  });

  it("type not consumed by the addressed plugin aborts", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("test_counter"), type: "give_gold", payload: { amount: 5 } },
    ]);
    // El type existe (gold_giver lo consume) pero el plugin direccionado no.
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "not_consumed");
  });

  it("external writes land on NarrativeState.player when authorized", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    state.player.gold = 10;
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("gold_giver"), type: "give_gold", payload: { amount: 25 } },
    ]);
    assert.equal(result.ok, true);
    assert.equal(state.player.gold, 35);
    assert.deepEqual(state.getPluginRecord(idOf("gold_giver"))?.slice, { total_given: 25 });
    const fx = result.effects[0];
    assert.ok(fx.changedPaths.includes("player.gold"));
  });

  it("a DSL error (inc over missing payload) aborts transactionally", () => {
    const { state, manifests, idOf } = activeSession("plugtest");
    state.player.gold = 10;
    // amount ausente ⇒ inc con operando undefined ⇒ DslError ⇒ abort.
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("gold_giver"), type: "give_gold", payload: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "dsl_error");
    assert.equal(state.player.gold, 10);
    assert.deepEqual(state.getPluginRecord(idOf("gold_giver"))?.slice, { total_given: 0 });
  });

  it("ping/pong cycle hits the emit limit and aborts with a trace, state intact", () => {
    const { state, manifests, idOf } = activeSession("plugcycle");
    const result = dispatchPluginEvents(state, manifests, [
      { pluginId: idOf("cycle_a"), type: "ping", payload: {} },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "emit_limit_exceeded");
    if (result.error?.code === "emit_limit_exceeded") {
      assert.equal(result.error.limit, MAX_EMITS_PER_TICK);
      assert.ok(result.error.trace.length > MAX_EMITS_PER_TICK);
    }
    assert.deepEqual(state.getPluginRecord(idOf("cycle_a"))?.slice, { n: 0 });
    assert.deepEqual(state.getPluginRecord(idOf("cycle_b"))?.slice, { n: 0 });
  });

  it("no events ⇒ ok with no effects", () => {
    const { state, manifests } = activeSession("plugtest");
    assert.deepEqual(dispatchPluginEvents(state, manifests, []), { ok: true, effects: [] });
  });
});
