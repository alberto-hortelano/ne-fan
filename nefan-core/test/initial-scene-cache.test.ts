import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InitialSceneCache } from "../src/dev/initial-scene-cache.js";
import { WorldMapManager } from "../src/world-map/world-map.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "scene-cache-"));
}

function sampleScene(): Record<string, unknown> {
  return {
    room_id: "robledo_plaza",
    scene_description: "Plaza con piedra húmeda",
    place_id: "robledo",
    entities: [],
  };
}

describe("InitialSceneCache", () => {
  it("returns null when no entry exists", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      assert.equal(cache.has("toledo_1200"), false);
      assert.equal(cache.get("toledo_1200"), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips scene + world map by gameId", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const wm = WorldMapManager.createEmpty("Mundo");
      const mgr = new WorldMapManager(wm);
      mgr.upsertPlace({
        id: "robledo",
        kind: "settlement",
        parent_id: "world",
        name: "Robledo",
      });

      cache.set("toledo_1200", sampleScene(), mgr.serialize());

      assert.equal(cache.has("toledo_1200"), true);
      const got = cache.get("toledo_1200");
      assert.ok(got);
      assert.equal(got.game_id, "toledo_1200");
      assert.equal(got.schema_version, 1);
      assert.equal(got.scene.room_id, "robledo_plaza");
      assert.equal(got.world_map.places["robledo"]?.name, "Robledo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("snapshot is decoupled from later mutations of the inputs", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const scene = sampleScene();
      const mgr = new WorldMapManager(WorldMapManager.createEmpty("Mundo"));
      cache.set("toledo_1200", scene, mgr.serialize());

      // Mutate the originals — must not bleed into the on-disk snapshot.
      (scene as Record<string, unknown>).room_id = "MUTATED";
      mgr.upsertPlace({
        id: "leaked",
        kind: "settlement",
        parent_id: "world",
        name: "Leaked",
      });

      const got = cache.get("toledo_1200");
      assert.ok(got);
      assert.equal(got.scene.room_id, "robledo_plaza");
      assert.equal(got.world_map.places["leaked"], undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clear() removes a single gameId without touching others", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const mgr = new WorldMapManager(WorldMapManager.createEmpty("Mundo"));
      cache.set("a", sampleScene(), mgr.serialize());
      cache.set("b", sampleScene(), mgr.serialize());
      cache.clear("a");
      assert.equal(cache.has("a"), false);
      assert.equal(cache.has("b"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clear() with no argument removes every entry", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const mgr = new WorldMapManager(WorldMapManager.createEmpty("Mundo"));
      cache.set("a", sampleScene(), mgr.serialize());
      cache.set("b", sampleScene(), mgr.serialize());
      cache.clear();
      assert.deepEqual(cache.list(), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe gameIds to prevent path traversal", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const mgr = new WorldMapManager(WorldMapManager.createEmpty("Mundo"));
      assert.throws(
        () => cache.set("../escape", sampleScene(), mgr.serialize()),
        /unsafe gameId/,
      );
      assert.throws(() => cache.has("with spaces"), /unsafe gameId/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on schema_version mismatch with an actionable message", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      // Write a file with a wrong schema_version directly.
      writeFileSync(
        join(dir, "old_game.json"),
        JSON.stringify({
          schema_version: 999,
          game_id: "old_game",
          scene: {},
          world_map: WorldMapManager.createEmpty("X"),
          cached_at: new Date().toISOString(),
        }),
      );
      assert.throws(() => cache.get("old_game"), /schema mismatch.*Delete/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("list() returns the gameIds of cached entries", () => {
    const dir = makeTempDir();
    try {
      const cache = new InitialSceneCache(dir);
      const mgr = new WorldMapManager(WorldMapManager.createEmpty("Mundo"));
      cache.set("toledo_1200", sampleScene(), mgr.serialize());
      cache.set("dragon_origins", sampleScene(), mgr.serialize());
      const names = cache.list().sort();
      assert.deepEqual(names, ["dragon_origins", "toledo_1200"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      // existsSync only as a sanity guard that rmSync cleaned up.
      assert.equal(existsSync(dir), false);
    }
  });
});
