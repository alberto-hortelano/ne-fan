import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { MemorySessionStorage } from "../src/narrative/session-storage.js";
import {
  PluginIntegrityError,
  PluginLoadError,
  activatePluginsForNewSession,
  bindPluginsForResume,
  loadGamePluginManifests,
} from "../src/plugins/loader.js";

const FIXTURE_GAMES = fileURLToPath(new URL("fixtures/games", import.meta.url));

/** Crea un juego temporal con los manifests dados (nombre → contenido). */
function tmpGame(manifests: Record<string, unknown>): { gamesDir: string; gameId: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-plugins-"));
  const gameId = "tmpgame";
  const pluginsDir = join(gamesDir, gameId, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  for (const [file, content] of Object.entries(manifests)) {
    writeFileSync(
      join(pluginsDir, file),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return { gamesDir, gameId };
}

function counterManifest(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(FIXTURE_GAMES, "plugtest/plugins/test_counter.json"), "utf-8"),
  ) as Record<string, unknown>;
}

describe("loadGamePluginManifests", () => {
  it("loads and validates the plugtest fixtures in file order", () => {
    const loaded = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    assert.deepEqual(
      loaded.map((lp) => lp.manifest.name),
      ["gold_giver", "test_counter", "test_listener"],
    );
    for (const lp of loaded) {
      assert.match(lp.id, /^[0-9a-f]{64}$/);
      assert.equal(lp.manifest.id, lp.id);
    }
  });

  it("returns [] when the plugins dir does not exist", () => {
    assert.deepEqual(loadGamePluginManifests(FIXTURE_GAMES, "no_such_game"), []);
  });

  it("rejects a manifest whose declared id diverges from the computed one", () => {
    const m = counterManifest();
    m.id = "f".repeat(64);
    const { gamesDir, gameId } = tmpGame({ "bad_id.json": m });
    assert.throws(() => loadGamePluginManifests(gamesDir, gameId), PluginLoadError);
  });

  it("rejects a manifest whose fixture fails", () => {
    const m = counterManifest();
    (m.fixtures as Array<{ after: { count: number } }>)[0].after.count = 99;
    const { gamesDir, gameId } = tmpGame({ "bad_fixture.json": m });
    assert.throws(
      () => loadGamePluginManifests(gamesDir, gameId),
      (err: unknown) => err instanceof PluginLoadError && /fixture\[0\]/.test(err.message),
    );
  });

  it("rejects invalid JSON and invalid schema with the file path in the error", () => {
    const { gamesDir, gameId } = tmpGame({ "broken.json": "{not json" });
    assert.throws(
      () => loadGamePluginManifests(gamesDir, gameId),
      (err: unknown) => err instanceof PluginLoadError && err.file.includes("broken.json"),
    );
    const m = counterManifest();
    delete m.description;
    const t2 = tmpGame({ "noschema.json": m });
    assert.throws(() => loadGamePluginManifests(t2.gamesDir, t2.gameId), PluginLoadError);
  });

  it("rejects effects that write outside slice without `writes` coverage", () => {
    const m = counterManifest();
    (m.events_consumed as Array<{ do: unknown[] }>)[0].do.push({
      op: "set",
      path: "player.gold",
      value: 0,
    });
    // La fixture fallaría también; quitamos fixtures para aislar el error estático.
    m.fixtures = [];
    const { gamesDir, gameId } = tmpGame({ "sneaky.json": m });
    assert.throws(
      () => loadGamePluginManifests(gamesDir, gameId),
      (err: unknown) => err instanceof PluginLoadError && /player\.gold/.test(err.message),
    );
  });

  it("rejects duplicated plugin ids across files", () => {
    const m = counterManifest();
    const { gamesDir, gameId } = tmpGame({ "a.json": m, "b.json": m });
    assert.throws(
      () => loadGamePluginManifests(gamesDir, gameId),
      (err: unknown) => err instanceof PluginLoadError && /duplicado/.test(err.message),
    );
  });
});

describe("activatePluginsForNewSession / bindPluginsForResume", () => {
  function newState() {
    const s = new NarrativeState(new MemorySessionStorage());
    s.startNewSession("plugtest");
    return s;
  }

  it("genesis registers records with initial slices and no embedded manifest", () => {
    const s = newState();
    const loaded = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    const active = activatePluginsForNewSession(s, loaded);
    assert.equal(s.plugins.length, 3);
    assert.equal(active.size, 3);
    const counter = s.plugins.find((p) => p.name === "test_counter");
    assert.deepEqual(counter?.slice, { count: 0 });
    assert.equal(counter?.manifest, undefined);
    assert.ok(counter?.activated_at);
  });

  it("resume binds by id and restores slices from the save", async () => {
    const storage = new MemorySessionStorage();
    const s1 = new NarrativeState(storage);
    s1.startNewSession("plugtest");
    const loaded = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    activatePluginsForNewSession(s1, loaded);
    s1.setPluginSlice(loaded[1].id, { count: 7 }); // test_counter
    await s1.save();

    const s2 = new NarrativeState(storage);
    assert.equal(await s2.loadSession(s1.session_id), true);
    const active = bindPluginsForResume(s2, loadGamePluginManifests(FIXTURE_GAMES, "plugtest"));
    assert.equal(active.size, 3);
    assert.deepEqual(s2.getPluginRecord(loaded[1].id)?.slice, { count: 7 });
  });

  it("resume fails loud when the FS manifest changed (same name, other hash)", () => {
    const s = newState();
    const loaded = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    activatePluginsForNewSession(s, loaded);
    // Simula un save creado con otra versión del manifest de test_counter.
    const rec = s.plugins.find((p) => p.name === "test_counter");
    rec!.id = "e".repeat(64);
    assert.throws(
      () => bindPluginsForResume(s, loaded),
      (err: unknown) =>
        err instanceof PluginIntegrityError &&
        err.pluginName === "test_counter" &&
        err.fsId !== null,
    );
  });

  it("resume fails loud when the manifest file is gone", () => {
    const s = newState();
    s.plugins.push({
      id: "b".repeat(64),
      name: "ghost",
      version: 1,
      slice: {},
      origin: { author: "developer", rationale: "test" },
      activated_at: "2026-01-01T00:00:00Z",
    });
    assert.throws(
      () => bindPluginsForResume(s, loadGamePluginManifests(FIXTURE_GAMES, "plugtest")),
      (err: unknown) => err instanceof PluginIntegrityError && err.fsId === null,
    );
  });

  it("resume ignores FS plugins not present in the save (no genesis on resume)", () => {
    const s = newState(); // save sin plugins
    const active = bindPluginsForResume(s, loadGamePluginManifests(FIXTURE_GAMES, "plugtest"));
    assert.equal(active.size, 0);
    assert.equal(s.plugins.length, 0);
  });

  it("resume keeps AI plugins via their embedded manifest", () => {
    const s = newState();
    const loaded = loadGamePluginManifests(FIXTURE_GAMES, "plugtest");
    s.plugins.push({
      id: loaded[1].id,
      name: "test_counter",
      version: 1,
      slice: { count: 1 },
      origin: { author: "narrative_engine", rationale: "emergido en runtime" },
      activated_at: "2026-01-01T00:00:00Z",
      manifest: loaded[1].manifest,
    });
    // Sin manifests en FS: el embebido basta.
    const active = bindPluginsForResume(s, []);
    assert.equal(active.size, 1);
    assert.equal(active.get(loaded[1].id)?.name, "test_counter");
  });
});
