/** Snapshot de mundo pre-generado (data/games/{id}/world/): schema y
 *  staleness del módulo puro, replay en start_session (sin motor), escritura
 *  pasiva del bootstrap vivo e independencia del estilo (la clave de
 *  contenido es world_doc_hash, nunca el estilo). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { WorldMapManager } from "../src/world-map/world-map.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
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
    generated_at: "2026-08-18T00:00:00.000Z",
    world_map: wm.serialize(),
    // Escenas EXPANDIDAS, que es la población que vive en un snapshot: se
    // construyen pasando un tile emitido por `expandScenePrimitives`, la misma
    // función que las escribe en producción. Antes eran garabatos —un tile sin
    // `size` ni `terrain`, con una entity sin `footprint` ni `glyph`— que
    // ningún camino real produce; pasaban porque `scenes` no tenía tipo (#237).
    scenes: {
      tile_0_0: expandScenePrimitives({
        scene_id: "tile_0_0",
        scene_description: "Tile de arranque del snapshot",
        tile: { tx: 0, ty: 0 },
        biome: "grass",
        entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1], glyph: "@" }],
      }),
      tile_1_0: expandScenePrimitives({
        scene_id: "tile_1_0",
        scene_description: "Vecino este pre-generado",
        tile: { tx: 1, ty: 0 },
        biome: "grass",
        entities: [],
      }),
    },
    entry_scene_id: "tile_0_0",
  };
}

describe("world-snapshot (módulo puro)", () => {
  it("escribe, carga y borra un snapshot válido", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const snap = makeSnapshot(GAME, worldDocHash);
      writeWorldSnapshot(gamesDir, snap);
      const loaded = loadWorldSnapshot(gamesDir, GAME, worldDocHash);
      assert.ok(loaded);
      assert.equal(loaded.entry_scene_id, "tile_0_0");
      assert.equal(Object.keys(loaded.scenes).length, 2);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "ready");
      assert.equal(deleteWorldSnapshot(gamesDir, GAME), true);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "missing");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("world.md editado ⇒ stale (null + status stale); malformado ⇒ throw", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldSnapshot(gamesDir, makeSnapshot(GAME, worldDocHash));
      assert.equal(loadWorldSnapshot(gamesDir, GAME, hashOf("otro world.md")), null);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, hashOf("otro world.md")), "stale");

      writeFileSync(worldSnapshotPath(gamesDir, GAME), "{no es json", "utf-8");
      assert.throws(
        () => loadWorldSnapshot(gamesDir, GAME, worldDocHash),
        /malformado/,
      );
      // El listado degrada a stale con warning, nunca tumba el título.
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "stale");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  /** El CABLEADO de #237: `WorldSnapshotSchema.scenes` tipado con
   *  `ExpandedSceneSchema` en vez de `z.record(z.string(), z.unknown())`.
   *
   *  Nace de un hallazgo de QA: la separación de poblaciones se podía revertir
   *  ENTERA —la línea y el import— y `lint`, `build` y los 1629 tests seguían
   *  verdes. O sea que lo único que hacía que la escena que el juego CARGA
   *  tuviera tipo no lo miraba nadie, y es justo la mitad del criterio que
   *  toca el arranque: un snapshot que no carga manda a `start_session` al
   *  bootstrap vivo, que llama al motor y GASTA.
   *
   *  Los tres casos son escenas que el `z.record(z.unknown())` de antes
   *  aceptaba sin rechistar y que `ExpandedSceneSchema` rechaza, así que
   *  desconectar el cableado los pone rojos a los tres. El fichero se escribe
   *  A MANO, sin `writeWorldSnapshot`, porque lo que se prueba es la puerta de
   *  ENTRADA (un snapshot que ya está en disco, escrito por una versión vieja
   *  o a medio expandir). */
  describe("el cableado de las dos poblaciones tiene quien lo mire", () => {
    const expandida = () => expandScenePrimitives({
      scene_id: "tile_0_0",
      scene_description: "Tile de arranque del snapshot",
      tile: { tx: 0, ty: 0 },
      biome: "grass",
      entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1], glyph: "@" }],
    });

    /** Escribe el snapshot SIN pasar por el validador de escritura. */
    const aDisco = (gamesDir: string, worldDocHash: string, escena: Record<string, unknown>): void => {
      const snap = {
        schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
        game_id: GAME,
        world_doc_hash: worldDocHash,
        generated_at: "2026-08-18T00:00:00.000Z",
        world_map: new WorldMapManager(WorldMapManager.createEmpty()).serialize(),
        scenes: { tile_0_0: escena },
        entry_scene_id: "tile_0_0",
      };
      mkdirSync(join(gamesDir, GAME, "world"), { recursive: true });
      writeFileSync(worldSnapshotPath(gamesDir, GAME), JSON.stringify(snap), "utf-8");
    };

    const CASOS: Array<[string, () => Record<string, unknown>]> = [
      ["sin la marca `__expanded` (escena a medio expandir)", () => {
        const e = expandida();
        delete e.__expanded;
        return e;
      }],
      ["sin el grid `terrain` (el cliente no tendría qué pintar)", () => {
        const e = expandida();
        delete e.terrain;
        return e;
      }],
      ["con una clave desconocida dentro de una entity", () => {
        const e = expandida();
        (e.entities as Record<string, unknown>[])[0].health = 60;
        return e;
      }],
    ];

    for (const [que, hacer] of CASOS) {
      it(`loadWorldSnapshot RECHAZA un snapshot ${que}`, () => {
        const { gamesDir, worldDocHash } = tmpGamesDir();
        try {
          aDisco(gamesDir, worldDocHash, hacer());
          assert.throws(
            () => loadWorldSnapshot(gamesDir, GAME, worldDocHash),
            /inválido/,
            "una escena que no es de la población EXPANDIDA no puede entrar por la puerta de carga",
          );
          // Y el mismo snapshot tampoco se puede ESCRIBIR.
          assert.throws(
            () => writeWorldSnapshot(gamesDir, { ...makeSnapshot(GAME, worldDocHash), scenes: { tile_0_0: hacer() } } as WorldSnapshot),
            /inválido/,
          );
        } finally {
          rmSync(gamesDir, { recursive: true, force: true });
        }
      });
    }

    it("y la escena BIEN expandida sí entra (el cableado no rechaza de más)", () => {
      const { gamesDir, worldDocHash } = tmpGamesDir();
      try {
        aDisco(gamesDir, worldDocHash, expandida());
        const cargado = loadWorldSnapshot(gamesDir, GAME, worldDocHash);
        assert.ok(cargado);
        assert.equal(Object.keys(cargado.scenes).length, 1);
      } finally {
        rmSync(gamesDir, { recursive: true, force: true });
      }
    });
  });

  it("rechaza entry_scene_id fuera de scenes y versiones de schema desconocidas", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const bad = makeSnapshot(GAME, worldDocHash);
      bad.entry_scene_id = "no_existe";
      assert.throws(() => writeWorldSnapshot(gamesDir, bad), /entry_scene_id/);

      const versioned = makeSnapshot(GAME, worldDocHash);
      writeWorldSnapshot(gamesDir, versioned);
      const path = worldSnapshotPath(gamesDir, GAME);
      const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      raw.schema_version = 99;
      writeFileSync(path, JSON.stringify(raw), "utf-8");
      assert.throws(() => loadWorldSnapshot(gamesDir, GAME, worldDocHash), /inválido/);
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
      // …y el ready DICE que viene del mundo pre-generado. El guion 05 lo usa
      // para no dar por "rasterizado en vivo" un tile que venía horneado.
      assert.equal(ready.source, "snapshot");
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
      // El snapshot pasivo quedó en data/games/{id}/world/tile.json.
      const snap = JSON.parse(
        readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8"),
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
