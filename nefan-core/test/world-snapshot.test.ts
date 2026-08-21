/** Snapshot de mundo pre-generado (data/games/{id}/world/): schema y
 *  staleness del módulo puro, replay en start_session (sin motor), escritura
 *  pasiva del bootstrap vivo e independencia del estilo (la clave de
 *  contenido es world_doc_hash + rama, nunca el estilo). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { WorldMapManager } from "../src/world-map/world-map.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
  branchForView,
  deleteWorldSnapshot,
  loadWorldSnapshot,
  worldSnapshotPath,
  worldSnapshotStatus,
  writeWorldSnapshot,
  type WorldSnapshot,
} from "../src/games/world-snapshot.js";
import { routeMessage } from "../bridge/router.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
} from "../src/protocol/messages.js";
import { FIXTURE_GAMES, makeCtx, makeSocket, waitFor } from "./helpers.js";

const GAME = "plugtest";

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Copia el fixture del juego a un gamesDir temporal (los tests de snapshot
 *  escriben en él). El caller borra el dir. */
function tmpGamesDir(): { gamesDir: string; worldDocHash: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-snapshot-games-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  const worldDocHash = hashOf(readFileSync(join(gamesDir, GAME, "world.md"), "utf-8"));
  return { gamesDir, worldDocHash };
}

function makeSnapshot(gameId: string, worldDocHash: string): WorldSnapshot {
  const wm = new WorldMapManager(WorldMapManager.createEmpty());
  wm.upsertPlace({
    id: "aldea",
    kind: "settlement",
    name: "Aldea",
    description: "Una aldea de prueba",
    parent_id: wm.serialize().root_id,
  });
  return {
    schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
    game_id: gameId,
    world_doc_hash: worldDocHash,
    branch: "tile",
    generated_at: "2026-08-18T00:00:00.000Z",
    world_map: wm.serialize(),
    scenes: {
      tile_0_0: {
        room_id: "tile_0_0",
        scene_id: "tile_0_0",
        room_description: "Tile de arranque del snapshot",
        entities: [{ id: "player", kind: "player", cell: [4, 4] }],
      },
      tile_1_0: {
        room_id: "tile_1_0",
        scene_id: "tile_1_0",
        room_description: "Vecino este pre-generado",
      },
    },
    entry_scene_id: "tile_0_0",
  };
}

describe("world-snapshot (módulo puro)", () => {
  it("escribe, carga y borra un snapshot válido; branchForView mapea vistas a ramas", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const snap = makeSnapshot(GAME, worldDocHash);
      writeWorldSnapshot(gamesDir, snap);
      const loaded = loadWorldSnapshot(gamesDir, GAME, "tile", worldDocHash);
      assert.ok(loaded);
      assert.equal(loaded.entry_scene_id, "tile_0_0");
      assert.equal(Object.keys(loaded.scenes).length, 2);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, "tile", worldDocHash), "ready");
      assert.equal(worldSnapshotStatus(gamesDir, GAME, "stage", worldDocHash), "missing");
      assert.equal(deleteWorldSnapshot(gamesDir, GAME, "tile"), true);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, "tile", worldDocHash), "missing");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
    assert.equal(branchForView("overworld"), "tile");
    assert.equal(branchForView("fps"), "tile");
    assert.equal(branchForView("proscenium"), "stage");
  });

  it("world.md editado ⇒ stale (null + status stale); malformado ⇒ throw", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldSnapshot(gamesDir, makeSnapshot(GAME, worldDocHash));
      assert.equal(loadWorldSnapshot(gamesDir, GAME, "tile", hashOf("otro world.md")), null);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, "tile", hashOf("otro world.md")), "stale");

      writeFileSync(worldSnapshotPath(gamesDir, GAME, "tile"), "{no es json", "utf-8");
      assert.throws(
        () => loadWorldSnapshot(gamesDir, GAME, "tile", worldDocHash),
        /malformado/,
      );
      // El listado degrada a stale con warning, nunca tumba el título.
      assert.equal(worldSnapshotStatus(gamesDir, GAME, "tile", worldDocHash), "stale");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("rechaza entry_scene_id fuera de scenes y versiones de schema desconocidas", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const bad = makeSnapshot(GAME, worldDocHash);
      bad.entry_scene_id = "no_existe";
      assert.throws(() => writeWorldSnapshot(gamesDir, bad), /entry_scene_id/);

      const versioned = makeSnapshot(GAME, worldDocHash);
      writeWorldSnapshot(gamesDir, versioned);
      const path = worldSnapshotPath(gamesDir, GAME, "tile");
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      raw.schema_version = 99;
      writeFileSync(path, JSON.stringify(raw), "utf-8");
      assert.throws(() => loadWorldSnapshot(gamesDir, GAME, "tile", worldDocHash), /inválido/);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("world-snapshot en start_session", () => {
  it("con snapshot: replay sin motor (0 llamadas LLM), todas las escenas registradas, la de entrada activa", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldSnapshot(gamesDir, makeSnapshot(GAME, worldDocHash));
      const { ctx, broadcasts, narrative, aiCalls } = makeCtx({ gamesDir });
      const { socket, sent } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);

      assert.equal(sent[0].type, "session_started");
      assert.equal((sent[0] as { ok: boolean }).ok, true);
      // Cero llamadas al motor narrativo: el snapshot cubre el bootstrap.
      assert.equal(aiCalls.scene.length, 0);
      // Escena de entrada difundida por la ruta normal + status ready.
      const sceneEvent = broadcasts.find(
        (m): m is NarrativeEventMessage => m.type === "narrative_event",
      );
      assert.ok(sceneEvent, "scene_init del snapshot difundido");
      const ready = broadcasts.find(
        (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "ready",
      );
      assert.ok(ready, "narrative_status ready");
      // Todas las escenas del snapshot quedan servibles al instante.
      assert.ok(narrative.scenes_loaded["tile_0_0"]);
      assert.ok(narrative.scenes_loaded["tile_1_0"]);
      assert.equal(narrative.world.active_scene_id, "tile_0_0");
      // El world map del snapshot quedó restaurado.
      assert.ok(narrative.worldMap.get("aldea"));
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("la clave de contenido ignora el estilo: mismo snapshot sirve a dos estilos distintos", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldSnapshot(gamesDir, makeSnapshot(GAME, worldDocHash));
      for (const styleId of [undefined, "estilo_test"]) {
        const { ctx, aiCalls } = makeCtx({ gamesDir });
        const { socket } = makeSocket();
        await routeMessage(
          { type: "start_session", requestId: "r1", gameId: GAME, styleId },
          socket,
          ctx,
        );
        assert.equal(aiCalls.scene.length, 0, `estilo ${styleId ?? "(default)"} ⇒ replay`);
      }
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("snapshot stale (world.md editado) ⇒ bootstrap vivo como siempre", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldSnapshot(gamesDir, makeSnapshot(GAME, worldDocHash));
      writeFileSync(join(gamesDir, GAME, "world.md"), "# Otro mundo\n" + "lore ".repeat(200));
      const { ctx, broadcasts, aiCalls } = makeCtx({ gamesDir });
      const { socket } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
      await waitFor(() =>
        broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
      );
      assert.equal(aiCalls.scene.length, 1, "el motor sí corre con snapshot stale");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("escritura pasiva: el bootstrap vivo deja snapshot y el siguiente arranque no llama al motor", async () => {
    const { gamesDir } = tmpGamesDir();
    try {
      const first = makeCtx({ gamesDir, persistWorldSnapshots: true });
      const { socket } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, first.ctx);
      await waitFor(() =>
        first.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
      );
      assert.equal(first.aiCalls.scene.length, 1);
      // El snapshot pasivo quedó en data/games/{id}/world/ (rama tile).
      const snap = JSON.parse(
        readFileSync(worldSnapshotPath(gamesDir, GAME, "tile"), "utf-8"),
      ) as WorldSnapshot;
      assert.equal(snap.entry_scene_id, "tile_0_0");
      assert.equal(Object.keys(snap.scenes).length, 1);

      const second = makeCtx({ gamesDir });
      const s2 = makeSocket();
      await routeMessage(
        { type: "start_session", requestId: "r2", gameId: GAME },
        s2.socket,
        second.ctx,
      );
      assert.equal(second.aiCalls.scene.length, 0, "segundo arranque = replay del snapshot");
      assert.ok(second.narrative.scenes_loaded["tile_0_0"]);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});
