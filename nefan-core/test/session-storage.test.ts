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

  it("rechaza session ids que se escapan del directorio de saves (path traversal)", async () => {
    const root = await makeRoot();
    const storage = new FsSessionStorage(root);
    // Un canario fuera de saves/ que un delete con traversal borraría.
    const canaryDir = await fs.mkdtemp(join(tmpdir(), "nefan-canary-"));
    roots.push(canaryDir);
    await fs.writeFile(join(canaryDir, "keep.txt"), "no me borres", "utf-8");
    for (const evil of ["..", "../..", `../${canaryDir.split("/").pop()}`]) {
      await assert.rejects(() => storage.delete(evil), /unsafe session id/);
      await assert.rejects(() => storage.read(evil), /unsafe session id/);
      await assert.rejects(() => storage.write(evil, {} as never), /unsafe session id/);
    }
    // El canario sigue intacto.
    assert.equal(await fs.readFile(join(canaryDir, "keep.txt"), "utf-8"), "no me borres");
  });

  it("delete devuelve false si no existe pero propaga errores reales", async () => {
    const storage = new FsSessionStorage(await makeRoot());
    assert.equal(await storage.delete("no_existe"), false);
  });

  it("write es atómico: no deja state.json a medias ante un fallo de serialización", async () => {
    const root = await makeRoot();
    const storage = new FsSessionStorage(root);
    const data = { session_id: "s", game_id: "g", updated_at: "t", story_so_far: "",
      scenes_loaded: {}, entities: [] } as never;
    await storage.write("s", data);
    const back = await storage.read("s");
    assert.equal((back as { session_id: string }).session_id, "s");
    // No queda tmp huérfano tras un write correcto.
    const files = await fs.readdir(join(root, "s"));
    assert.deepEqual(files.filter((f) => f.endsWith(".tmp")), []);
  });

  it("list expone los modos de gráficos del world (badges del title screen)", async () => {
    const root = await makeRoot();
    const storage = new FsSessionStorage(root);
    await fs.mkdir(join(root, "s1"), { recursive: true });
    await fs.writeFile(
      join(root, "s1", "state.json"),
      JSON.stringify({
        session_id: "s1",
        game_id: "toledo_1200",
        updated_at: "2026-01-01T00:00:00Z",
        story_so_far: "",
        scenes_loaded: {},
        entities: [],
        world: { render_mode: "vector", character_mode: "image" },
      }),
      "utf-8",
    );
    const [meta] = await storage.list();
    assert.equal(meta.render_mode, "vector");
    assert.equal(meta.character_mode, "image");
    // Save antiguo sin world: sin campos, sin inventar.
    await fs.mkdir(join(root, "viejo"), { recursive: true });
    await fs.writeFile(
      join(root, "viejo", "state.json"),
      JSON.stringify({
        session_id: "viejo", game_id: "g", updated_at: "2025-01-01T00:00:00Z",
        story_so_far: "", scenes_loaded: {}, entities: [],
      }),
      "utf-8",
    );
    const metas = await storage.list();
    const old = metas.find((m) => m.session_id === "viejo")!;
    assert.equal(old.render_mode, undefined);
    assert.equal(old.character_mode, undefined);
  });
});
