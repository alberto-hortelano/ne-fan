/** Aplicación de estilo a un juego (backend): registro persistente por
 *  (vista, estilo), pins del asset-store contra el prune, y los mensajes WS
 *  get_world_snapshot / record_style_application. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { ManifestDb } from "../services/asset-store/manifest-db.js";
import { prune } from "../services/asset-store/prune.js";
import {
  STYLE_APPLICATION_SCHEMA_VERSION,
  listStyleApplications,
  loadStyleApplication,
  styleApplicationPinRef,
  writeStyleApplication,
  type StyleApplicationRecord,
} from "../src/games/style-application.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
  writeWorldSnapshot,
  type WorldSnapshot,
} from "../src/games/world-snapshot.js";
import { WorldMapManager } from "../src/world-map/world-map.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { routeMessage } from "../bridge/router.js";
import type {
  StyleApplicationRecordedMessage,
  WorldSnapshotMessage,
} from "../src/protocol/messages.js";
import { FIXTURE_GAMES, makeCtx, makeSocket } from "./helpers.js";

const GAME = "plugtest";

function tmpGamesDir(): { gamesDir: string; worldDocHash: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-styleapp-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  const worldDocHash = createHash("sha256")
    .update(readFileSync(join(gamesDir, GAME, "world.md"), "utf-8"), "utf-8")
    .digest("hex");
  return { gamesDir, worldDocHash };
}

function makeRecord(worldDocHash: string): StyleApplicationRecord {
  return {
    schema_version: STYLE_APPLICATION_SCHEMA_VERSION,
    game_id: GAME,
    style_id: "estilo_test",
    world_doc_hash: worldDocHash,
    applied_at: "2026-08-18T00:00:00.000Z",
    pinned_hashes: ["aaaa", "bbbb"],
    summary: {
      pack_generated: 2,
      atlas_cells_painted: 10,
      atlas_cells_total: 12,
      skins_painted: 3,
      skins_total: 3,
      cost_usd: 5.5,
    },
    notes: [],
  };
}

function makeSnapshot(worldDocHash: string): WorldSnapshot {
  return {
    schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
    game_id: GAME,
    world_doc_hash: worldDocHash,
    generated_at: "2026-08-18T00:00:00.000Z",
    world_map: new WorldMapManager(WorldMapManager.createEmpty()).serialize(),
    // Escena EXPANDIDA por la función de producción: es la población que vive
    // en un snapshot, y desde #237 `WorldSnapshotSchema` la tipa (antes bastaba
    // con dos campos sueltos que ningún camino real produce).
    scenes: {
      tile_0_0: expandScenePrimitives({
        scene_id: "tile_0_0",
        scene_description: "arranque",
        tile: { tx: 0, ty: 0 },
        biome: "grass",
        entities: [],
      }),
    },
    entry_scene_id: "tile_0_0",
  };
}

describe("pins del asset-store", () => {
  it("pin/unpin y protección en el prune", () => {
    const dir = mkdtempSync(join(tmpdir(), "nefan-pins-"));
    try {
      const db = new ManifestDb(join(dir, "manifest.sqlite3"));
      const blobs = join(dir, "surfaces");
      for (const h of ["h1", "h2"]) {
        mkdirSync(join(blobs, h), { recursive: true });
        writeFileSync(join(blobs, h, "surface.png"), Buffer.alloc(100));
        db.register({ hash: h, type: "surface", subtype: "surface", prompt: "p", size_bytes: 100 });
      }
      db.pin(styleApplicationPinRef(GAME, "estilo_test"), ["h1"]);
      assert.deepEqual([...db.pinnedHashes()], ["h1"]);
      // Presupuesto 0 bytes: sin pin caerían ambos; el pineado sobrevive.
      const summary = prune(db, blobs, 1, null);
      assert.equal(summary.pruned, 2, "sin keep-list ni pins todo poda — baseline");

      // Re-crear y comprobar que el prune real (keep ∪ pins) protege h1.
      for (const h of ["h1", "h2"]) {
        mkdirSync(join(blobs, h), { recursive: true });
        writeFileSync(join(blobs, h, "surface.png"), Buffer.alloc(100));
        db.register({ hash: h, type: "surface", subtype: "surface", prompt: "p", size_bytes: 100 });
      }
      const keep = new Set<string>();
      for (const h of db.pinnedHashes()) keep.add(h);
      const summary2 = prune(db, blobs, 1, keep);
      assert.equal(summary2.pruned, 1, "solo el no pineado");
      assert.equal(db.findByHash("h1").length, 1, "el pineado sigue indexado");

      assert.equal(db.unpin(styleApplicationPinRef(GAME, "estilo_test")), 1);
      assert.equal(db.pinnedHashes().size, 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registro de aplicación de estilo (módulo)", () => {
  it("escribe, carga, lista y marca stale por world_doc_hash", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeStyleApplication(gamesDir, makeRecord(worldDocHash));
      const rec = loadStyleApplication(gamesDir, GAME, "estilo_test");
      assert.equal(rec?.summary.cost_usd, 5.5);
      assert.deepEqual(listStyleApplications(gamesDir, GAME, worldDocHash), [
        { style_id: "estilo_test", status: "ready" },
      ]);
      assert.deepEqual(listStyleApplications(gamesDir, GAME, "otro_hash"), [
        { style_id: "estilo_test", status: "stale" },
      ]);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("WS get_world_snapshot / record_style_application", () => {
  it("devuelve el snapshot vigente con status ready, y missing sin él", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir });
      const s1 = makeSocket();
      await routeMessage(
        { type: "get_world_snapshot", requestId: "w1", gameId: GAME },
        s1.socket,
        bundle.ctx,
      );
      const missing = s1.sent[0] as WorldSnapshotMessage;
      assert.equal(missing.ok, true);
      assert.equal(missing.status, "missing");
      assert.equal(missing.snapshot, null);

      writeWorldSnapshot(gamesDir, makeSnapshot(worldDocHash));
      const s2 = makeSocket();
      await routeMessage(
        { type: "get_world_snapshot", requestId: "w2", gameId: GAME },
        s2.socket,
        bundle.ctx,
      );
      const ready = s2.sent[0] as WorldSnapshotMessage;
      assert.equal(ready.status, "ready");
      assert.equal(
        (ready.snapshot as WorldSnapshot).entry_scene_id,
        "tile_0_0",
      );
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("record_style_application valida con zod y persiste; el registro aparece en games_listed", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir });
      const s1 = makeSocket();
      await routeMessage(
        {
          type: "record_style_application",
          requestId: "r1",
          record: makeRecord(worldDocHash) as unknown as Record<string, unknown>,
        },
        s1.socket,
        bundle.ctx,
      );
      assert.equal((s1.sent[0] as StyleApplicationRecordedMessage).ok, true);
      assert.ok(loadStyleApplication(gamesDir, GAME, "estilo_test"));

      const s2 = makeSocket();
      await routeMessage({ type: "list_games", requestId: "l1" }, s2.socket, bundle.ctx);
      const listed = s2.sent[0] as {
        games: Array<{ game_id: string; styles_applied: Array<{ style_id: string; status: string }> }>;
      };
      const g = listed.games.find((x) => x.game_id === GAME)!;
      assert.deepEqual(g.styles_applied, [
        { style_id: "estilo_test", status: "ready" },
      ]);

      // Registro inválido ⇒ ok:false sin escribir.
      const s3 = makeSocket();
      await routeMessage(
        { type: "record_style_application", requestId: "r2", record: { schema_version: 99 } },
        s3.socket,
        bundle.ctx,
      );
      assert.equal((s3.sent[0] as StyleApplicationRecordedMessage).ok, false);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});
