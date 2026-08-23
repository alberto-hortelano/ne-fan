/** generate_game: pre-generación del mundo en sesión efímera, snapshot
 *  persistido y replay en start_session. En la rama TILE la pre-generación es
 *  el bootstrap + el anillo 3×3 y nada más: los places se realizan al viajar
 *  a ellos (antes se pre-realizaban como escenas SUELTAS, la variante
 *  retirada en el issue #172).
 *  El fake de generateScene actúa como el motor: siembra el world map por el
 *  mismo camino que las map tools (escribe en ctx.narrative.worldMap). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { routeMessage } from "../bridge/router.js";
import type { NarrativeAiClient } from "../bridge/context.js";
import { worldSnapshotPath, type WorldSnapshot } from "../src/games/world-snapshot.js";
import type { LlmContext } from "../src/narrative/types.js";
import type {
  GameGeneratedMessage,
  NarrativeStatusMessage,
} from "../src/protocol/messages.js";
import { FIXTURE_GAMES, makeCtx, makeSocket, waitFor } from "./helpers.js";

const GAME = "plugtest";

function tmpGamesDir(): string {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-gamegen-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  return gamesDir;
}

/** Tile Format D mínimo que pasa la validación server-side. */
function tileScene(withPlayer: boolean): Record<string, unknown> {
  return {
    biome: "grass",
    scene_description: "campo pre-generado",
    entities: withPlayer
      ? [{ id: "player", kind: "player", cell: [64, 64], footprint: [1, 1], glyph: "@" }]
      : [],
    ambient_event: "",
  };
}

/** Fake del motor: bootstrap siembra el world map (equivale a las map tools),
 *  generate_tile responde tiles válidos, realize_place una escena simple. */
function motorFake(bundle: ReturnType<typeof makeCtx>, opts: { failTile?: [number, number] } = {}) {
  const aiClient: NarrativeAiClient = {
    ...bundle.ctx.aiClient,
    async generateScene(llmCtx: LlmContext) {
      bundle.aiCalls.scene.push(llmCtx);
      if (llmCtx.bootstrap_world_map) {
        const wm = bundle.ctx.narrative.worldMap;
        const root = wm.serialize().root_id;
        wm.upsertPlace({
          id: "aldea",
          kind: "settlement",
          name: "Aldea del Test",
          description: "Asentamiento sembrado por el fake",
          parent_id: root,
        });
        wm.upsertPlace({
          id: "molino",
          kind: "site",
          name: "Molino Viejo",
          description: "Sitio sembrado por el fake",
          parent_id: "aldea",
        });
        // `place_id` es obligatorio en el bootstrap: es lo que ata la escena
        // inicial al mapa que el motor acaba de sembrar. Sin él el bridge lo
        // rechaza en vez de dejar al jugador con el panel «Salidas» vacío
        // (issue #172). Un motor que no lo declare no pre-genera nada.
        return { ok: true, scene: { tile: { tx: 0, ty: 0 }, place_id: "aldea", ...tileScene(true) } };
      }
      if (llmCtx.generate_tile) {
        const { tx, ty } = llmCtx.generate_tile;
        if (opts.failTile && tx === opts.failTile[0] && ty === opts.failTile[1]) {
          return { ok: false, error: "boom del bench" };
        }
        return { ok: true, scene: { tile: { tx, ty }, ...tileScene(false) } };
      }
      if (llmCtx.realize_place) {
        // En un mundo de plano continuo NADIE debe pedir realize_place
        // durante la génesis: la escena que salía de aquí era una suelta.
        throw new Error(
          `realize_place("${llmCtx.realize_place.id}") en la rama tile: los places se realizan al viajar`,
        );
      }
      throw new Error("petición inesperada al fake del motor");
    },
  };
  (bundle.ctx as { aiClient: NarrativeAiClient }).aiClient = aiClient;
}

async function runGenerate(bundle: ReturnType<typeof makeCtx>) {
  const { socket, sent } = makeSocket();
  await routeMessage(
    { type: "generate_game", requestId: "g1", gameId: GAME },
    socket,
    bundle.ctx,
  );
  // El handler suscribe al socket (progreso del título): la respuesta convive
  // con los broadcasts — localizarla por tipo, no por posición.
  const resp = sent.find((m) => m.type === "game_generated") as GameGeneratedMessage;
  assert.ok(resp, "respuesta game_generated recibida");
  await waitFor(() =>
    bundle.broadcasts.some(
      (m) =>
        m.type === "narrative_status" &&
        m.kind === "game_gen" &&
        (m.phase === "ready" || m.phase === "error"),
    ),
  );
  const final = bundle.broadcasts.findLast(
    (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.kind === "game_gen",
  )!;
  return { resp, final };
}

describe("generate_game", () => {
  it("genera bootstrap + anillo (sin pre-realizar places), escribe el snapshot, borra el save efímero y el siguiente start_session replayea", async () => {
    const gamesDir = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { resp, final } = await runGenerate(bundle);
      assert.equal(resp.ok, true);
      assert.equal(resp.queued, "queued");
      assert.equal(final.phase, "ready");

      // 1 bootstrap + 8 vecinos = 9 llamadas al motor. Los places NO se
      // pre-realizan en la rama tile (el fake lanza si alguien lo intenta).
      assert.equal(bundle.aiCalls.scene.length, 9);
      const snap = JSON.parse(
        readFileSync(worldSnapshotPath(gamesDir, GAME, "tile"), "utf-8"),
      ) as WorldSnapshot;
      assert.equal(snap.entry_scene_id, "tile_0_0");
      assert.equal(Object.keys(snap.scenes).length, 9);
      assert.ok(snap.scenes["tile_1_1"], "vecino del anillo en el snapshot");
      assert.equal(snap.scenes["realized_aldea"], undefined, "ningún place pre-realizado");
      assert.ok(
        (snap.world_map as { places: Record<string, unknown> }).places["aldea"],
        "world map sembrado en el snapshot",
      );
      // El save efímero no sobrevive; el snapshot es el único artefacto.
      assert.equal((await bundle.ctx.sessionStorage.list()).length, 0);
      assert.equal(bundle.narrative.session_id, "");

      // start_session con snapshot: cero llamadas al motor, todo servible.
      const play = makeCtx({ gamesDir });
      const { socket } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, play.ctx);
      assert.equal(play.aiCalls.scene.length, 0);
      assert.equal(Object.keys(play.narrative.scenes_loaded).length, 9);
      assert.equal(play.narrative.world.active_scene_id, "tile_0_0");
      assert.ok(play.narrative.hasTile(1, 0), "el anillo se sirve por request_tile sin LLM");
      // El world map sembrado por el motor SÍ viaja en el snapshot. El lugar
      // de PARTIDA queda realizado —es el tile de arranque, y ese vínculo es
      // lo que da salidas al panel del jugador—; los demás no, y se realizan
      // al viajar a ellos.
      assert.ok(play.narrative.worldMap.get("aldea"), "place del world map replayado");
      assert.equal(play.narrative.worldMap.get("aldea")?.realized_scene_id, "tile_0_0");
      assert.equal(play.narrative.worldMap.get("molino")?.realized_scene_id, undefined);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("un vecino fallido no tira la génesis: snapshot parcial + fallo reportado en el status final", async () => {
    const gamesDir = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle, { failTile: [1, 0] });
      const { final } = await runGenerate(bundle);
      assert.equal(final.phase, "ready");
      assert.match(final.message ?? "", /Fallos parciales/);
      assert.match(final.message ?? "", /\(1,0\)/);
      const snap = JSON.parse(
        readFileSync(worldSnapshotPath(gamesDir, GAME, "tile"), "utf-8"),
      ) as WorldSnapshot;
      assert.equal(Object.keys(snap.scenes).length, 8, "todo menos el vecino fallido");
      assert.equal(snap.scenes["tile_1_0"], undefined);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("un snapshot nuevo invalida las aplicaciones de estilo del juego", async () => {
    const gamesDir = tmpGamesDir();
    try {
      const { STYLE_APPLICATION_SCHEMA_VERSION, writeStyleApplication, loadStyleApplication } =
        await import("../src/games/style-application.js");
      writeStyleApplication(gamesDir, {
        schema_version: STYLE_APPLICATION_SCHEMA_VERSION,
        game_id: GAME,
        style_id: "estilo_test",
        world_doc_hash: "hash_viejo",
        applied_at: "2026-08-18T00:00:00.000Z",
        pinned_hashes: [],
        summary: {
          pack_generated: 0,
          atlas_cells_painted: 0,
          atlas_cells_total: 0,
          skins_painted: 0,
          skins_total: 0,
          cost_usd: 0,
        },
        notes: [],
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      await runGenerate(bundle);
      assert.equal(
        loadStyleApplication(gamesDir, GAME, "estilo_test"),
        null,
        "el registro de estilo del mundo regenerado se borra",
      );
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("juego inexistente ⇒ ok:false sin encolar nada", async () => {
    const bundle = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "generate_game", requestId: "g1", gameId: "no_existe" },
      socket,
      bundle.ctx,
    );
    const resp = sent[0] as GameGeneratedMessage;
    assert.equal(resp.ok, false);
    assert.equal(bundle.ctx.sceneGen.current, null);
  });

  it("games_listed expone el estado del contenido pre-generado", async () => {
    const gamesDir = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const before = makeSocket();
      await routeMessage({ type: "list_games", requestId: "l0" }, before.socket, bundle.ctx);
      const listedBefore = before.sent[0] as { games: Array<{ game_id: string; generation: string }> };
      const gBefore = listedBefore.games.find((g) => g.game_id === GAME)!;
      assert.equal(gBefore.generation, "missing");

      await runGenerate(bundle);
      const after = makeSocket();
      await routeMessage({ type: "list_games", requestId: "l1" }, after.socket, bundle.ctx);
      const listedAfter = after.sent[0] as typeof listedBefore;
      const gAfter = listedAfter.games.find((g) => g.game_id === GAME)!;
      assert.equal(gAfter.generation, "ready");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("generate_game abandonado", () => {
  it("la barra del título no se queda girando: error kind game_gen", async () => {
    // Un takeover (otro start_session, otra pre-generación) vacía la cola. Sin
    // aviso, la tarjeta del juego se queda en "generando" para siempre: nadie
    // más difunde kind "game_gen", y el título trata `error` como final.
    const bundle = makeCtx({ gamesDir: FIXTURE_GAMES });
    let soltar!: () => void;
    bundle.ctx.sceneGen.enqueue({
      key: "bloqueo",
      blocking: true,
      run: () => new Promise<void>((r) => { soltar = r; }),
    });
    const { socket } = makeSocket();
    await routeMessage({ type: "generate_game", requestId: "g1", gameId: GAME }, socket, bundle.ctx);
    assert.deepEqual(bundle.ctx.sceneGen.pending, [`gamegen:${GAME}`]);

    bundle.ctx.sceneGen.abandonAll();
    await waitFor(
      () =>
        bundle.broadcasts.some(
          (m) => m.type === "narrative_status" && m.kind === "game_gen" && m.phase === "error",
        ),
      1000,
    ).catch(() => assert.fail("la pre-generación abandonada no avisó: la tarjeta gira para siempre"));
    soltar();
  });
});
