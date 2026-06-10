import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import { PluginRegisterError, registerRuntimePlugin } from "../src/plugins/register.js";
import { bindPluginsForResume } from "../src/plugins/loader.js";
import { dispatchPluginEvents } from "../src/plugins/dispatcher.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { COMMERCE_MANIFEST } from "./fixtures/commerce-manifest.js";

const COUNTER_PATH = fileURLToPath(
  new URL("fixtures/games/plugtest/plugins/test_counter.json", import.meta.url),
);

function counterManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(COUNTER_PATH, "utf-8")) as Record<string, unknown>;
}

function freshSession(): { state: NarrativeState; active: Map<string, PluginManifest> } {
  const state = new NarrativeState(new MemorySessionStorage());
  state.startNewSession("tavern_intro");
  return { state, active: new Map() };
}

describe("registerRuntimePlugin", () => {
  it("activates a valid manifest: record with embedded manifest + active registry", () => {
    const { state, active } = freshSession();
    const result = registerRuntimePlugin(state, active, counterManifest());
    assert.match(result.id, /^[0-9a-f]{64}$/);
    assert.equal(result.fixturesPassed, 2);
    const record = state.getPluginRecord(result.id);
    assert.equal(record?.name, "test_counter");
    assert.deepEqual(record?.slice, { count: 0 });
    assert.equal(record?.manifest?.id, result.id, "el manifest va embebido y normalizado");
    assert.equal(active.get(result.id)?.name, "test_counter");
  });

  it("runs projections against the CURRENT state (commerce sees the merchant)", () => {
    const { state, active } = freshSession();
    state.recordSceneLoaded("scene_1", { id: "scene_1" });
    state.recordEntitySpawned("blacksmith_01", "npc", "scene_1", [1, 0, 2], {
      role: "merchant",
      name: "Boris",
      inventory: { iron_sword: 2 },
    });
    const result = registerRuntimePlugin(state, active, COMMERCE_MANIFEST);
    const slice = state.getPluginRecord(result.id)?.slice as {
      markets: Record<string, { name: string }>;
    };
    assert.deepEqual(Object.keys(slice.markets), ["blacksmith_01"]);
    assert.equal(slice.markets.blacksmith_01.name, "Boris");
  });

  it("rejects without an active session", () => {
    const state = new NarrativeState(new MemorySessionStorage());
    assert.throws(
      () => registerRuntimePlugin(state, new Map(), counterManifest()),
      PluginRegisterError,
    );
  });

  it("rejects duplicates, missing fixtures, bad shape, divergent id and static errors", () => {
    const { state, active } = freshSession();
    registerRuntimePlugin(state, active, counterManifest());
    // duplicado
    assert.throws(
      () => registerRuntimePlugin(state, active, counterManifest()),
      (err: unknown) => err instanceof PluginRegisterError && /ya está activo/.test(err.message),
    );
    // sin fixtures (obligatorias en runtime)
    const noFixtures = { ...counterManifest(), name: "sin_fixtures", fixtures: [] };
    assert.throws(
      () => registerRuntimePlugin(state, active, noFixtures),
      (err: unknown) => err instanceof PluginRegisterError && /fixture/.test(err.message),
    );
    // shape inválido
    assert.throws(
      () => registerRuntimePlugin(state, active, { name: "x" }),
      (err: unknown) => err instanceof PluginRegisterError && err.issues.length > 0,
    );
    // id declarado divergente
    const badId = { ...counterManifest(), id: "f".repeat(64) };
    assert.throws(
      () => registerRuntimePlugin(state, active, badId),
      (err: unknown) => err instanceof PluginRegisterError && /computado/.test(err.message),
    );
    // error estático: escribe fuera del slice sin writes
    const sneaky = counterManifest();
    sneaky.name = "sneaky";
    (sneaky.events_consumed as Array<{ do: unknown[] }>)[0].do.push({
      op: "set",
      path: "player.gold",
      value: 0,
    });
    assert.throws(
      () => registerRuntimePlugin(state, active, sneaky),
      (err: unknown) => err instanceof PluginRegisterError && /player\.gold/.test(err.message),
    );
  });

  it("rejects a manifest whose fixture fails, with expected/actual detail", () => {
    const { state, active } = freshSession();
    const broken = counterManifest();
    (broken.fixtures as Array<{ after: { count: number } }>)[0].after.count = 99;
    assert.throws(
      () => registerRuntimePlugin(state, active, broken),
      (err: unknown) => err instanceof PluginRegisterError && /esperado/.test(err.message),
    );
    assert.equal(state.plugins.length, 0, "nada activado tras el rechazo");
  });

  it("survives save → resume (embedded manifest) and keeps dispatching", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("tavern_intro");
    const active1 = new Map<string, PluginManifest>();
    const { id } = registerRuntimePlugin(s1, active1, counterManifest());
    const tick1 = dispatchPluginEvents(s1, active1, [
      { pluginId: id, type: "counter_inc", payload: {} },
    ]);
    assert.equal(tick1.ok, true);
    assert.equal(await s1.save(), true);

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    // Sin manifests en disco: el embebido del save basta para rebindear.
    const active2 = bindPluginsForResume(s2, []);
    assert.equal(active2.get(id)?.name, "test_counter");
    const tick2 = dispatchPluginEvents(s2, active2, [
      { pluginId: id, type: "counter_inc", payload: {} },
    ]);
    assert.equal(tick2.ok, true);
    assert.deepEqual(s2.getPluginRecord(id)?.slice, { count: 2 });
  });
});
