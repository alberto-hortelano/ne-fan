import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FsSessionStorage } from "../src/narrative/session-storage.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "nefan-session-storage-"));
  roots.push(root);
  return root;
}

after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

describe("FsSessionStorage fail-loud", () => {
  it("read returns null for a missing session", async () => {
    const storage = new FsSessionStorage(await makeRoot());
    assert.equal(await storage.read("no_such_session"), null);
  });

  it("exists returns false for a missing session", async () => {
    const storage = new FsSessionStorage(await makeRoot());
    assert.equal(await storage.exists("no_such_session"), false);
  });

  it("read throws on corrupt JSON instead of returning null", async () => {
    const root = await makeRoot();
    const storage = new FsSessionStorage(root);
    await fs.mkdir(join(root, "broken"), { recursive: true });
    await fs.writeFile(join(root, "broken", "state.json"), "{not valid json", "utf-8");
    await assert.rejects(() => storage.read("broken"), /Corrupt session file for "broken"/);
  });

  it("list returns [] when the saves root does not exist yet", async () => {
    const storage = new FsSessionStorage(join(tmpdir(), "nefan-does-not-exist-xyz"));
    assert.deepEqual(await storage.list(), []);
  });

  it("list skips a corrupt session but keeps the healthy ones", async () => {
    const root = await makeRoot();
    const storage = new FsSessionStorage(root);
    await fs.mkdir(join(root, "broken"), { recursive: true });
    await fs.writeFile(join(root, "broken", "state.json"), "{not valid json", "utf-8");
    await fs.mkdir(join(root, "healthy"), { recursive: true });
    await fs.writeFile(
      join(root, "healthy", "state.json"),
      JSON.stringify({
        session_id: "healthy",
        game_id: "toledo_1200",
        updated_at: "2026-01-01T00:00:00Z",
        story_so_far: "",
        scenes_loaded: {},
        entities: [],
      }),
      "utf-8",
    );
    const sessions = await storage.list();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].session_id, "healthy");
  });
});
