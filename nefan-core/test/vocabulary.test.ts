/** Vocabulario canónico del mundo: módulo puro (schema/staleness), endpoint
 *  POST /vocabulary del State API (tool vocabulary_set) e inyección de
 *  world_vocabulary en los turnos de tile. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  WORLD_VOCABULARY_SCHEMA_VERSION,
  loadWorldVocabulary,
  worldVocabularyPath,
  writeWorldVocabulary,
  type WorldVocabulary,
} from "../src/games/vocabulary.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { routeMessage } from "../bridge/router.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import type { LlmContext } from "../src/narrative/types.js";
import type { SessionStartedMessage } from "../src/protocol/messages.js";
import { FIXTURE_GAMES, makeCtx, makeNarrativeState, makeSocket } from "./helpers.js";

const GAME = "plugtest";

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function tmpGamesDir(): { gamesDir: string; worldDocHash: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-vocab-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  const worldDocHash = hashOf(readFileSync(join(gamesDir, GAME, "world.md"), "utf-8"));
  return { gamesDir, worldDocHash };
}

function makeVocab(worldDocHash: string): WorldVocabulary {
  return {
    schema_version: WORLD_VOCABULARY_SCHEMA_VERSION,
    game_id: GAME,
    world_doc_hash: worldDocHash,
    generated_at: "2026-08-18T00:00:00.000Z",
    entries: [
      {
        id: "fachada_encalada",
        kind: "surface",
        desc: "whitewashed plaster over dark timber framing, weathered near the base",
      },
      {
        id: "guardia_del_puerto",
        kind: "character",
        desc: "stocky harbor guard in a salt-stained gambeson with a boarding axe",
        roles: ["guard"],
      },
    ],
  };
}

describe("world vocabulary (módulo puro)", () => {
  it("escribe y carga; stale con world.md editado; ids duplicados rechazados", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldVocabulary(gamesDir, makeVocab(worldDocHash));
      const loaded = loadWorldVocabulary(gamesDir, GAME, worldDocHash);
      assert.equal(loaded?.entries.length, 2);
      assert.equal(loadWorldVocabulary(gamesDir, GAME, hashOf("otro")), null);

      const dup = makeVocab(worldDocHash);
      dup.entries.push({ ...dup.entries[0] });
      assert.throws(() => writeWorldVocabulary(gamesDir, dup), /duplicado/);

      writeFileSync(worldVocabularyPath(gamesDir, GAME), "{roto", "utf-8");
      assert.throws(() => loadWorldVocabulary(gamesDir, GAME, worldDocHash), /malformado/);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("POST /vocabulary (State API)", () => {
  it("persiste el vocabulario del juego de la sesión activa con su world_doc_hash", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const { narrative } = makeNarrativeState();
    narrative.startNewSession(GAME);
    narrative.setWorldInfo({
      name: "Juego de pruebas",
      description: "d".repeat(120),
      style_id: "estilo_test",
      style_token: "test token",
      world_doc_hash: worldDocHash,
      render_mode: "vector",
      character_mode: "vector",
      combat_system: "standard",
      view: "overworld",
    });
    let mutations = 0;
    const server: Server = createStateHttpServer({
      port: 0,
      narrative,
      npcDirector: new NpcDirector(narrative),
      gamesDir,
      onMutation: () => {
        mutations++;
      },
      onProgress: () => {},
    });
    await new Promise<void>((res) => server.once("listening", () => res()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${baseUrl}/vocabulary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: makeVocab(worldDocHash).entries }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; count: number; game_id: string };
      assert.deepEqual(body, { ok: true, game_id: GAME, count: 2 });
      assert.ok(mutations >= 1, "onMutation disparado (mutated)");
      const onDisk = loadWorldVocabulary(gamesDir, GAME, worldDocHash);
      assert.equal(onDisk?.entries[0].id, "fachada_encalada");

      // Entradas inválidas ⇒ 400, sin escribir.
      const bad = await fetch(`${baseUrl}/vocabulary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ id: "x", kind: "surface", desc: "corta" }] }),
      });
      assert.equal(bad.status, 400);
    } finally {
      server.close();
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("world_vocabulary en turnos de tile", () => {
  it("request_tile adjunta el vocabulario vigente al contexto del motor", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      writeWorldVocabulary(gamesDir, makeVocab(worldDocHash));
      const bundle = makeCtx({
        gamesDir,
        ai: {
          generateScene: async (llmCtx: LlmContext) => ({
            ok: true,
            scene: {
              tile: {
                tx: llmCtx.generate_tile?.tx ?? 0,
                ty: llmCtx.generate_tile?.ty ?? 0,
              },
              biome: "grass",
              scene_description: "campo",
              entities: llmCtx.bootstrap_world_map
                ? [{ id: "player", kind: "player", cell: [64, 64], footprint: [1, 1], glyph: "@" }]
                : [],
              ambient_event: "",
            },
          }),
        },
      });
      const { socket, sent } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, bundle.ctx);
      assert.equal((sent[0] as SessionStartedMessage).ok, true);
      // Sembrar el tile activo para que request_tile del vecino tenga costura.
      bundle.narrative.recordSceneLoaded(
        "tile_0_0",
        expandScenePrimitives({
          tile: { tx: 0, ty: 0 },
          scene_id: "tile_0_0",
          biome: "grass",
          scene_description: "origen",
          entities: [],
        }),
      );
      const calls = bundle.aiCalls.scene.length;
      await routeMessage(
        { type: "request_tile", tx: 1, ty: 0, reason: "blocking", edge: "east" },
        socket,
        bundle.ctx,
      );
      // Drenar la cola.
      await new Promise((r) => setTimeout(r, 20));
      const tileCall = bundle.aiCalls.scene[calls] as LlmContext;
      assert.ok(tileCall, "el motor recibió la petición del tile");
      assert.equal(tileCall.world_vocabulary?.length, 2);
      assert.equal(tileCall.world_vocabulary?.[0].id, "fachada_encalada");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});
