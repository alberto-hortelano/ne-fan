/** Un mundo pre-generado cuya ENTRADA no pasa el validador de hoy (#578).
 *
 *  Hasta #578, `start_session` degradaba al bootstrap vivo: el motor SEMBRABA
 *  un mapa nuevo y generaba la entrada sin vecinos, y el write conservaba el
 *  anillo del fichero junto a ese mapa. Con el motor falso los ids coincidían
 *  y no se veía; con uno real, los ocho tiles del anillo quedaban apuntando a
 *  lugares que el mapa nuevo no tenía y su panel «Salidas» salía vacío.
 *
 *  Aquí el motor falso hace lo que haría uno real si se le pide sembrar: un
 *  mapa con OTROS ids (`posada_sembrada`). Así la mezcla se ve si alguien
 *  vuelve a encolar el bootstrap que siembra — probado en negativo, ver
 *  `implementacion.md` de la tanda BE.
 *
 *  Lo que se sujeta, con los criterios de `requisitos.md`:
 *   C1 · UNA petición, `generate_tile{0,0,bootstrap}` SIN `bootstrap_world_map`
 *        y con vecinos; el mapa escrito tiene los mismos lugares; nada cuelga.
 *   C3 · motor caído o fichero que se contradice ⇒ `narrative_status error`,
 *        fichero intacto byte a byte y ninguna siembra.
 *   Y el pre-flight del motor (`tileContextFor`): el (0,0) que falta es
 *   bootstrap aunque haya anillo cargado. */
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
  gameGenerationStatus,
  worldSnapshotPath,
  type WorldSnapshot,
} from "../src/games/world-snapshot.js";
import { escenasSinLugarEnElMapa } from "../src/world-map/entrada-del-fichero.js";
import { tileContextFor } from "../bridge/state-http/scene-routes.js";
import { routeMessage } from "../bridge/router.js";
import type { LlmContext } from "../src/narrative/types.js";
import type { NarrativeEventMessage, ServerMessage } from "../src/protocol/messages.js";
import { FIXTURE_GAMES, fakeBootstrapTile, makeCtx, makeSocket, waitFor } from "./helpers.js";

const GAME = "plugtest";
type NarrativeState = ReturnType<typeof makeCtx>["narrative"];

const ANILLO: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function tmpGamesDir(): { gamesDir: string; worldDocHash: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-entrada-rota-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  const worldDocHash = createHash("sha256")
    .update(readFileSync(join(gamesDir, GAME, "world.md"), "utf-8"), "utf-8")
    .digest("hex");
  return { gamesDir, worldDocHash };
}

/** El mapa del FICHERO: la aldea de partida y el molino, enlazados. */
function mapaDelFichero() {
  const wm = new WorldMapManager(WorldMapManager.createEmpty());
  wm.upsertPlace({ id: "aldea_del_fichero", kind: "settlement", parent_id: "world", name: "Aldea del fichero" });
  wm.upsertPlace({ id: "molino_del_fichero", kind: "settlement", parent_id: "world", name: "Molino del fichero" });
  wm.addLink({ from: "aldea_del_fichero", to: "molino_del_fichero", kind: "road", edge: "east" });
  return JSON.parse(JSON.stringify(wm.serialize()));
}

/** Posada sólida con el posadero dentro: `nace-en-solido` (#289). */
function entradaInjugable(): Record<string, unknown> {
  const s = expandScenePrimitives({
    scene_id: "tile_0_0",
    scene_description: "Una posada sin puerta con el posadero dentro",
    tile: { tx: 0, ty: 0 },
    biome: "grass",
    volumes: [{ id: "posada", label: "posada", type: "building", rect: [52, 20, 24, 16] }],
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] },
      { id: "posadero", kind: "npc", name: "Posadero", cell: [60, 27], footprint: [1, 1] },
    ],
  });
  s.place_id = "aldea_del_fichero";
  return s;
}

/** El anillo, todo atado a la aldea del fichero (o al lugar que se pida). */
function anillo(placeId = "aldea_del_fichero"): Record<string, Record<string, unknown>> {
  const scenes: Record<string, Record<string, unknown>> = {};
  for (const [tx, ty] of ANILLO) {
    const s = expandScenePrimitives({
      scene_id: `tile_${tx}_${ty}`,
      scene_description: `Vecino (${tx},${ty}) pre-generado`,
      tile: { tx, ty },
      biome: "grass",
      entities: [],
    });
    s.place_id = placeId;
    scenes[`tile_${tx}_${ty}`] = s;
  }
  return scenes;
}

function aDisco(gamesDir: string, worldDocHash: string, scenes: Record<string, Record<string, unknown>>): string {
  mkdirSync(join(gamesDir, GAME, "world"), { recursive: true });
  const texto = JSON.stringify({
    schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
    game_id: GAME,
    world_doc_hash: worldDocHash,
    generated_at: "2026-09-24T00:00:00.000Z",
    world_map: mapaDelFichero(),
    scenes,
    entry_scene_id: "tile_0_0",
  });
  writeFileSync(worldSnapshotPath(gamesDir, GAME), texto, "utf-8");
  return texto;
}

const enDisco = (gamesDir: string): string => readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8");

/** Un motor falso que, si le piden SEMBRAR, siembra lo que sembraría uno real:
 *  lugares con otros ids. Así volver al bootstrap que siembra deja huella. */
function motorQueSiembraOtrosIds(narrativeRef: { actual?: NarrativeState }) {
  return {
    async generateScene(ctx: LlmContext) {
      if (ctx.bootstrap_world_map) {
        const wm = narrativeRef.actual!.worldMap;
        wm.upsertPlace({ id: "posada_sembrada", kind: "settlement", parent_id: "world", name: "Posada sembrada" });
        return { ok: true as const, scene: fakeBootstrapTile({ place_id: "posada_sembrada" }) };
      }
      return { ok: true as const, scene: fakeBootstrapTile() };
    },
  };
}

function hayStatus(broadcasts: ServerMessage[], phase: "ready" | "error"): boolean {
  return broadcasts.some((m) => m.type === "narrative_status" && m.phase === phase);
}

/** Silencia el log del bridge durante `fn` y lo devuelve. */
async function conLogCapturado<T>(fn: (log: string[]) => Promise<T>): Promise<T> {
  const { error, warn } = console;
  const log: string[] = [];
  console.error = (...a: unknown[]) => void log.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void log.push(a.map(String).join(" "));
  try {
    return await fn(log);
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

describe("la entrada rota se regenera DENTRO del mapa del fichero (#578)", () => {
  it("C1 · una petición, sin sembrar, con vecinos; el mapa escrito es el del fichero y nada cuelga", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      await conLogCapturado(async () => {
        aDisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anillo() });
        const antes = JSON.parse(enDisco(gamesDir)) as WorldSnapshot;
        const ref: { actual?: NarrativeState } = {};
        const { ctx, broadcasts, aiCalls, narrative } = makeCtx({
          gamesDir,
          persistWorldSnapshots: true,
          ai: motorQueSiembraOtrosIds(ref),
        });
        ref.actual = narrative;
        const { socket } = makeSocket();
        await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
        await waitFor(() => hayStatus(broadcasts, "ready") || hayStatus(broadcasts, "error"));
        assert.ok(!hayStatus(broadcasts, "error"), JSON.stringify(broadcasts.filter((m) => m.type === "narrative_status")));

        // UNA petición, y es la de la entrada, sin sembrar y con vecinos.
        assert.equal(aiCalls.scene.length, 1, "el camino degradado hace exactamente una petición al motor");
        const pedido = aiCalls.scene[0] as LlmContext;
        assert.equal(pedido.bootstrap_world_map, undefined, "se pidió SEMBRAR un mapa: es el bootstrap de antes");
        assert.equal(pedido.generate_tile?.tx, 0);
        assert.equal(pedido.generate_tile?.ty, 0);
        assert.equal(pedido.generate_tile?.bootstrap, true, "la entrada tiene que traer al player");
        assert.deepEqual(
          Object.keys(pedido.generate_tile?.neighbors ?? {}).sort(),
          ["east", "north", "south", "west"],
          "la entrada se pidió sin el anillo como vecinos",
        );
        assert.equal(pedido.generate_tile?.place?.id, "aldea_del_fichero", "el motor no supo qué lugar construir");
        assert.ok(pedido.world_document, "la entrada viaja con el documento del mundo, como el bootstrap");

        // El fichero: el MISMO mapa, el mismo anillo, la entrada nueva atada.
        const despues = JSON.parse(enDisco(gamesDir)) as WorldSnapshot;
        assert.deepEqual(
          Object.keys(despues.world_map.places).sort(),
          Object.keys(antes.world_map.places).sort(),
          "el mapa escrito no es el del fichero",
        );
        assert.deepEqual(escenasSinLugarEnElMapa(despues.scenes, despues.world_map), []);
        assert.equal(despues.scenes["tile_0_0"].place_id, "aldea_del_fichero");
        assert.notDeepEqual(despues.scenes["tile_0_0"], antes.scenes["tile_0_0"], "la entrada sigue siendo la rota");
        for (const [tx, ty] of ANILLO) {
          const id = `tile_${tx}_${ty}`;
          assert.deepEqual(despues.scenes[id], antes.scenes[id], `el vecino ${id} cambió`);
        }

        // Lo que ve el jugador: al llegar a un tile del anillo, ese tile tiene
        // salidas (las de la aldea del fichero, hacia el molino).
        broadcasts.length = 0;
        await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking" }, socket, ctx);
        const evento = broadcasts.find(
          (m): m is NarrativeEventMessage =>
            m.type === "narrative_event" &&
            m.effects?.[0]?.kind === "scene_loaded" &&
            (m.effects[0].scene as { scene_id?: string }).scene_id === "tile_1_0",
        );
        const efecto = evento?.effects?.[0];
        const exits = efecto?.kind === "scene_loaded" ? (efecto.scene as { exits?: { place_id: string }[] }).exits : undefined;
        assert.deepEqual(exits?.map((e) => e.place_id), ["molino_del_fichero"], "el panel «Salidas» del anillo sale vacío");
        assert.equal(aiCalls.scene.length, 1, "llegar al anillo no cuesta ninguna llamada");
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("C3 · el motor falla ⇒ error con motivo, fichero INTACTO y ninguna siembra", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      await conLogCapturado(async (log) => {
        const texto = aDisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anillo() });
        const { ctx, broadcasts, aiCalls } = makeCtx({
          gamesDir,
          persistWorldSnapshots: true,
          ai: { generateScene: async () => ({ ok: false, error: "motor caído" }) },
        });
        const { socket } = makeSocket();
        await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
        await waitFor(() => hayStatus(broadcasts, "error"));
        assert.equal(aiCalls.scene.length, 1, "tras el fallo se volvió a llamar al motor");
        assert.ok(
          aiCalls.scene.every((c) => !(c as LlmContext).bootstrap_world_map),
          "tras el fallo se cayó al bootstrap que siembra",
        );
        assert.ok(!hayStatus(broadcasts, "ready"));
        assert.equal(enDisco(gamesDir), texto, "el fichero cambió tras un fallo del motor");
        assert.match(log.join(" | "), /motor caído/, "la causa técnica no llegó al log del bridge");
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("C3 · el anillo apunta a lugares que su mapa no tiene ⇒ error, CERO llamadas, fichero intacto", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      await conLogCapturado(async (log) => {
        const texto = aDisco(gamesDir, worldDocHash, {
          tile_0_0: entradaInjugable(),
          ...anillo("lugar_que_ya_no_existe"),
        });
        const { ctx, broadcasts, aiCalls } = makeCtx({ gamesDir, persistWorldSnapshots: true });
        const { socket } = makeSocket();
        await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
        await waitFor(() => hayStatus(broadcasts, "error"));
        const error = broadcasts.find((m) => m.type === "narrative_status" && m.phase === "error");
        const alJugador = error && "message" in error ? String(error.message) : "";
        assert.match(alJugador, /Regenera el mundo desde el título/);
        // Los ids internos no son para quien juega (QA de BE, H2): van al log.
        assert.doesNotMatch(alJugador, /lugar_que_ya_no_existe|tile_/);
        assert.match(log.join(" | "), /lugar_que_ya_no_existe/, "el motivo técnico no llegó al log del bridge");
        // Dar tiempo a una cola que no debería existir.
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(aiCalls.scene.length, 0, "se llamó al motor con un fichero que se contradice");
        assert.equal(enDisco(gamesDir), texto);
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("C3 · la entrada vieja declara un lugar que el mapa no tiene ⇒ error y cero llamadas", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      await conLogCapturado(async () => {
        const entrada = entradaInjugable();
        entrada.place_id = "posada_perdida";
        const texto = aDisco(gamesDir, worldDocHash, { tile_0_0: entrada, ...anillo() });
        const { ctx, broadcasts, aiCalls } = makeCtx({ gamesDir, persistWorldSnapshots: true });
        const { socket } = makeSocket();
        await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
        await waitFor(() => hayStatus(broadcasts, "error"));
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(aiCalls.scene.length, 0);
        assert.equal(enDisco(gamesDir), texto);
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("el título dice el remedio de verdad (#578, QA de BE H1)", () => {
  it("entrada rota reparable ⇒ `stale` CON la marca; fichero que se contradice ⇒ `stale` sin ella", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      await conLogCapturado(async () => {
        aDisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anillo() });
        assert.deepEqual(gameGenerationStatus(gamesDir, GAME), { estado: "stale", escenas: null, entradaARegenerar: true });
        aDisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anillo("lugar_que_ya_no_existe") });
        assert.deepEqual(gameGenerationStatus(gamesDir, GAME), { estado: "stale", escenas: null });
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("el pre-flight del motor sabe cuál es el tile de ENTRADA (#578)", () => {
  it("el (0,0) que falta es bootstrap aunque el anillo esté cargado; el resto, no", () => {
    const { narrative } = makeCtx();
    narrative.startNewSession(GAME);
    const t = (tx: number, ty: number) => ({ tile: { tx, ty } });
    assert.equal(tileContextFor(narrative, t(0, 0))?.bootstrap, true, "mundo vacío");
    for (const [id, s] of Object.entries(anillo())) {
      narrative.recordSceneLoaded(id, s, [], { activate: false });
    }
    assert.equal(
      tileContextFor(narrative, t(0, 0))?.bootstrap,
      true,
      "con el anillo cargado, el pre-flight rechazaría el player que el bridge pidió",
    );
    assert.equal(tileContextFor(narrative, t(2, 0))?.bootstrap, false, "un tile normal no es bootstrap");
    narrative.recordSceneLoaded("tile_0_0", expandScenePrimitives(fakeBootstrapTile()));
    assert.equal(tileContextFor(narrative, t(0, 0))?.bootstrap, false, "con la entrada cargada ya no es bootstrap");
  });
});
