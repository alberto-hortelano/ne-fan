/** repair_game_world: CURAR el mundo pre-generado sin regenerarlo (#577).
 *
 *  Lo que se mide aquí es la diferencia con `generate_game`, que es toda la
 *  razón de que este mensaje exista: la cura pide al motor SOLO las escenas
 *  que la puerta de carga criba hoy (una llamada por escena, no nueve), no
 *  toca el registro de aplicaciones de estilo (arte ya pagado) y escribe con
 *  `conserva-el-mundo-en-disco`, así que lo que no consigue arreglar vuelve
 *  ROTO al fichero y el chip del título sigue avisando.
 *
 *  El motor es el mismo fake de `game-gen.test.ts` en espíritu: 0 créditos. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { routeMessage } from "../bridge/router.js";
import type { SceneGenOutcome } from "../bridge/scene-gen-queue.js";
import type { NarrativeAiClient } from "../bridge/context.js";
import { loadWorldDoc } from "../src/games/loader.js";
import {
  WORLD_SNAPSHOT_SCHEMA_VERSION,
  worldSnapshotPath,
  type WorldSnapshot,
} from "../src/games/world-snapshot.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { WorldMapManager } from "../src/world-map/world-map.js";
import type { LlmContext } from "../src/narrative/types.js";
import type {
  GameWorldRepairedMessage,
  NarrativeStatusMessage,
} from "../src/protocol/messages.js";
import { FIXTURE_GAMES, makeCtx, makeSocket, waitFor } from "./helpers.js";

const GAME = "plugtest";
const ENTRADA = "tile_0_0";

function tmpGamesDir(): { gamesDir: string; worldDocHash: string } {
  const gamesDir = mkdtempSync(join(tmpdir(), "nefan-repair-"));
  cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
  const worldDocHash = createHash("sha256")
    .update(loadWorldDoc(gamesDir, GAME), "utf-8")
    .digest("hex");
  return { gamesDir, worldDocHash };
}

/** Un tile jugable. `conPlayer` marca la escena de ENTRADA. */
const sana = (tx: number, conPlayer = false): Record<string, unknown> =>
  expandScenePrimitives({
    scene_id: `tile_${tx}_0`,
    scene_description: conPlayer ? "El claro donde empieza todo" : "Un prado con un seto",
    tile: { tx, ty: 0 },
    biome: "grass",
    entities: conPlayer
      ? [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }]
      : [],
  });

/** Un tile que el validador de HOY criba: el posadero nace dentro del sólido
 *  de la posada (`nace-en-solido`, #289) — la misma clase que usa el guion 127
 *  contra el mundo de verdad. */
const posadaSinPuerta = (tx: number): Record<string, unknown> =>
  expandScenePrimitives({
    scene_id: `tile_${tx}_0`,
    scene_description: "Una posada sin puerta con el posadero dentro",
    tile: { tx, ty: 0 },
    biome: "grass",
    volumes: [{ id: "posada", label: "posada", type: "building", rect: [52, 20, 24, 16] }],
    entities: [{ id: "posadero", kind: "npc", name: "Posadero", cell: [60, 27], footprint: [1, 1] }],
  });

function aDisco(
  gamesDir: string,
  worldDocHash: string,
  scenes: Record<string, Record<string, unknown>>,
  generatedAt = "2026-09-01T00:00:00.000Z",
): WorldSnapshot {
  const mapa = new WorldMapManager(WorldMapManager.createEmpty());
  mapa.upsertPlace({
    id: "aldea",
    kind: "settlement",
    name: "Aldea del Test",
    description: "Sembrada por la génesis anterior",
    parent_id: mapa.serialize().root_id,
  });
  const snap = {
    schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
    game_id: GAME,
    world_doc_hash: worldDocHash,
    generated_at: generatedAt,
    world_map: mapa.serialize(),
    scenes,
    entry_scene_id: ENTRADA,
  } as unknown as WorldSnapshot;
  mkdirSync(join(gamesDir, GAME, "world"), { recursive: true });
  writeFileSync(worldSnapshotPath(gamesDir, GAME), JSON.stringify(snap, null, 2) + "\n", "utf-8");
  // Se devuelve lo que quedó EN DISCO y no el objeto de memoria: comparar los
  // dos lados de la cura tiene que ser fichero contra fichero. El objeto de
  // memoria trae claves con `undefined` que `JSON.stringify` no escribe, y un
  // `deepEqual` contra él fallaría por eso y no por una diferencia real.
  return leer(gamesDir);
}

const leer = (gamesDir: string): WorldSnapshot =>
  JSON.parse(readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8")) as WorldSnapshot;

/** Fake del motor para la CURA: solo puede llegarle `generate_tile` (aquí no
 *  hay bootstrap ni realize_place). `falla` dice qué coordenadas rechaza, y
 *  `alGenerar` es el hueco donde un test simula un takeover. */
function motorFake(
  bundle: ReturnType<typeof makeCtx>,
  opts: { falla?: Array<[number, number]>; alGenerar?: () => void } = {},
) {
  const aiClient: NarrativeAiClient = {
    ...bundle.ctx.aiClient,
    async generateScene(llmCtx: LlmContext) {
      bundle.aiCalls.scene.push(llmCtx);
      opts.alGenerar?.();
      if (!llmCtx.generate_tile) {
        throw new Error("la cura no puede pedir bootstrap ni realize_place: solo tiles cribados");
      }
      const { tx, ty } = llmCtx.generate_tile;
      if (opts.falla?.some(([x, y]) => x === tx && y === ty)) {
        return { ok: false, error: "boom del bench" };
      }
      return {
        ok: true,
        scene: {
          tile: { tx, ty },
          biome: "grass",
          scene_description: "prado curado",
          entities: [],
        },
      };
    },
  };
  (bundle.ctx as { aiClient: NarrativeAiClient }).aiClient = aiClient;
}

async function curar(bundle: ReturnType<typeof makeCtx>) {
  const { socket, sent } = makeSocket();
  await routeMessage({ type: "repair_game_world", requestId: "c1", gameId: GAME }, socket, bundle.ctx);
  const resp = sent.find((m) => m.type === "game_world_repaired") as GameWorldRepairedMessage;
  assert.ok(resp, "respuesta game_world_repaired recibida");
  if (!resp.ok) return { resp, final: null };
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

describe("repair_game_world · curar el mundo cribado", () => {
  it("pide al motor SOLO lo cribado (1 llamada, no 3), lo escribe, y el resto del fichero no se toca", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const antes = aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: sana(1),
        tile_2_0: posadaSinPuerta(2),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { resp, final } = await curar(bundle);
      assert.equal(resp.ok, true);
      assert.equal(resp.queued, "queued");
      assert.equal(final?.phase, "ready", final?.message);

      // LA medida de #577: una llamada por escena cribada, no las nueve de
      // «Regenerar mundo». El RECUENTO va en el aserto además del número de
      // llamadas, y no es redundante: `generateTileScene` devuelve "exists"
      // para un tile ya cargado, así que apuntar a las tres escenas del
      // fichero costaría igualmente UNA llamada al motor — el mensaje es lo
      // que distingue «curar lo cribado» de «pedir el mundo entero».
      assert.equal(bundle.aiCalls.scene.length, 1);
      assert.match(final?.message ?? "", /curado: 1 de 1 escena\(s\), 3 en el fichero/);
      assert.doesNotMatch(final?.message ?? "", /Fallos parciales/);
      const pedido = (bundle.aiCalls.scene[0] as LlmContext).generate_tile;
      assert.deepEqual([pedido?.tx, pedido?.ty], [2, 0]);
      // Y el motor lo pide CON SU VECINDARIO: sin registrar antes las escenas
      // servibles en la sesión efímera, el tile nacería sin costuras que casar
      // y el validador lo rechazaría — la cura no curaría nada.
      assert.deepEqual(pedido?.neighbors?.west?.tile, [1, 0]);
      assert.equal(pedido?.neighbors?.west?.scene_id, "tile_1_0");

      const despues = leer(gamesDir);
      assert.deepEqual(Object.keys(despues.scenes).sort(), [ENTRADA, "tile_1_0", "tile_2_0"]);
      // El tile curado ya no es el roto…
      assert.notDeepEqual(despues.scenes["tile_2_0"], antes.scenes["tile_2_0"]);
      // …y las otras dos salen BYTE A BYTE como estaban: una cura que
      // reescribiera el mundo entero saldría igual de verde sin este aserto.
      assert.deepEqual(despues.scenes[ENTRADA], antes.scenes[ENTRADA]);
      assert.deepEqual(despues.scenes["tile_1_0"], antes.scenes["tile_1_0"]);
      // Y el world_map tampoco se mueve: la cura no siembra lugares.
      assert.deepEqual(despues.world_map, antes.world_map);
      assert.notEqual(despues.generated_at, antes.generated_at, "el fichero es nuevo");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("el tile curado se genera SIN historia: `story_so_far` vacío, como en la génesis", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: posadaSinPuerta(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      // Una crónica de la partida ANTERIOR viva en el singleton: si la cura
      // no abriera sesión efímera propia, el motor la vería y el tile nacería
      // dentro de una historia que no es la suya.
      bundle.narrative.startNewSession(GAME);
      bundle.narrative.appendStory("El herrero juró vengarse de la casa Vela.");
      assert.notEqual(bundle.narrative.story_so_far, "");

      const { final } = await curar(bundle);
      assert.equal(final?.phase, "ready", final?.message);
      const visto = bundle.aiCalls.scene[0] as LlmContext;
      assert.equal(visto.story_so_far, "");
      assert.deepEqual(visto.recent_dialogues, []);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("NO repaga el arte: la aplicación de estilo sigue registrada (al revés que regenerar)", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const { STYLE_APPLICATION_SCHEMA_VERSION, writeStyleApplication, loadStyleApplication } =
        await import("../src/games/style-application.js");
      writeStyleApplication(gamesDir, {
        schema_version: STYLE_APPLICATION_SCHEMA_VERSION,
        game_id: GAME,
        style_id: "estilo_test",
        world_doc_hash: worldDocHash,
        applied_at: "2026-09-01T00:00:00.000Z",
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
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: posadaSinPuerta(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "ready", final?.message);
      // El contraste directo con `game-gen.test.ts` («un snapshot nuevo
      // invalida las aplicaciones de estilo»): ahí este registro tiene que
      // desaparecer, y aquí tiene que SEGUIR. Es la mitad del valor de #577 —
      // el remedio que había cuesta nueve llamadas Y el arte.
      assert.ok(
        loadStyleApplication(gamesDir, GAME, "estilo_test"),
        "curar el mundo no puede invalidar el arte ya pagado",
      );
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("lo que NO se cura vuelve ROTO al fichero: `ready` con fallos parciales y el chip sigue avisando", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const antes = aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: posadaSinPuerta(1),
        tile_2_0: posadaSinPuerta(2),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle, { falla: [[2, 0]] });
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "ready", final?.message);
      assert.match(final?.message ?? "", /Fallos parciales/);
      assert.match(final?.message ?? "", /tile_2_0/);

      const despues = leer(gamesDir);
      // ÉSTE es el fallo que más se parece a un acierto: con
      // `reemplaza-el-mundo` la escena que no se pudo curar DESAPARECERÍA del
      // fichero, el recuento del título pasaría de «2 de 3 escenas» a
      // «✓ generado» 2/2 y el jugador perdería el único aviso que tiene de que
      // su mundo va a costar llamadas al motor.
      assert.deepEqual(Object.keys(despues.scenes).sort(), [ENTRADA, "tile_1_0", "tile_2_0"]);
      assert.deepEqual(
        despues.scenes["tile_2_0"],
        antes.scenes["tile_2_0"],
        "la que falló tiene que volver IDÉNTICA, rota",
      );
      const { gameGenerationStatus } = await import("../src/games/world-snapshot.js");
      assert.deepEqual(gameGenerationStatus(gamesDir, GAME), {
        estado: "ready",
        escenas: { servibles: 2, total: 3 },
      });
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("si NO se cura ninguna, `error` y el fichero no se toca: un `generated_at` nuevo sin contenido nuevo es una mentira", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const antes = aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: posadaSinPuerta(1),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle, { falla: [[1, 0]] });
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "error");
      assert.match(final?.message ?? "", /No se pudo curar ninguna/);
      const despues = leer(gamesDir);
      assert.equal(despues.generated_at, antes.generated_at, "el fichero no se reescribió");
      assert.deepEqual(despues.scenes, antes.scenes);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("un takeover de sesión aborta sin escribir: el fichero queda intacto", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      const antes = aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: posadaSinPuerta(1),
        tile_2_0: posadaSinPuerta(2),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      // Otro start_session pisa la sesión mientras el motor contesta la
      // PRIMERA escena: lo que venga después ya no es de este mundo.
      motorFake(bundle, {
        alGenerar: () => {
          if (bundle.aiCalls.scene.length === 1) bundle.narrative.startNewSession(GAME);
        },
      });
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "error");
      assert.match(final?.message ?? "", /la sesión activa cambió/);
      assert.equal(bundle.aiCalls.scene.length, 1, "la segunda escena ya no se pide");
      const despues = leer(gamesDir);
      assert.equal(despues.generated_at, antes.generated_at);
      assert.deepEqual(despues.scenes, antes.scenes);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("sin nada cribado NO se encola nada: se contesta que no hay nada que curar", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: sana(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { resp } = await curar(bundle);
      assert.equal(resp.ok, false);
      assert.match(resp.error ?? "", /no tiene ninguna escena cribada/);
      assert.equal(bundle.ctx.sceneGen.current, null, "no se encoló ningún job");
      assert.equal(bundle.aiCalls.scene.length, 0);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("sin mundo pre-generado tampoco: el motivo dice que hay que generarlo, no «falló»", async () => {
    const { gamesDir } = tmpGamesDir();
    try {
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { resp } = await curar(bundle);
      assert.equal(resp.ok, false);
      assert.match(resp.error ?? "", /no tiene mundo pre-generado que curar/);
      assert.equal(bundle.ctx.sceneGen.current, null);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("si la escritura falla, la cura dice `error`: nunca `ready` sin fichero", async () => {
    // La mejora que #577 obligó a hacer: `writeSessionSnapshot` tragaba el
    // fallo de disco en un `console.warn` y devolvía `void`, así que un job
    // que no pudo guardar nada habría contestado «curado» igual. Aquí el
    // directorio del mundo se deja sin permiso de escritura, que es la forma
    // real de ese fallo (disco lleno, permisos, montaje de solo lectura).
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const fichero = worldSnapshotPath(gamesDir, GAME);
    try {
      const antes = aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: posadaSinPuerta(1),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      // Sobre el FICHERO y no sobre su directorio: reescribir uno que ya
      // existe solo pide permiso en el fichero, así que un `chmod 0500` al
      // directorio dejaba pasar la escritura y el test salía verde midiendo
      // otra cosa.
      chmodSync(fichero, 0o400);
      const { final } = await curar(bundle);
      chmodSync(fichero, 0o600);
      assert.equal(final?.phase, "error", final?.message);
      assert.match(final?.message ?? "", /NO se pudo guardar/);
      assert.match(final?.message ?? "", /el fichero sigue como estaba/);
      assert.deepEqual(leer(gamesDir), antes);
    } finally {
      chmodSync(fichero, 0o600);
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("la sesión efímera se descarta SIEMPRE: el bridge vuelve a no tener partida", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: posadaSinPuerta(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "ready", final?.message);
      // Si esto se olvidara, el State API dejaría de dar 409 a las mutadoras
      // del motor y las escribiría en un mundo de nadie.
      assert.equal(bundle.narrative.session_id, "");
      assert.equal((await bundle.ctx.sessionStorage.list()).length, 0, "ningún save efímero");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("la partida SIGUIENTE ya no paga el tile curado: cero llamadas al motor", async () => {
    // El final del recorrido de #577, medido donde el jugador lo nota.
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, {
        [ENTRADA]: sana(0, true),
        tile_1_0: sana(1),
        tile_2_0: posadaSinPuerta(2),
      });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      const { final } = await curar(bundle);
      assert.equal(final?.phase, "ready", final?.message);

      const play = makeCtx({ gamesDir });
      const { socket } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, play.ctx);
      assert.equal(play.aiCalls.scene.length, 0, "el mundo curado se replayea entero, sin motor");
      assert.equal(Object.keys(play.narrative.scenes_loaded).length, 3);
      assert.ok(play.narrative.hasTile(2, 0), "el tile que antes se cribaba ya se sirve");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

describe("repair_game_world abandonado o a destiempo", () => {
  it("la barra del título no se queda girando: error kind game_gen si el job se abandona", async () => {
    // Mismo modo de fallo que en `generate_game`: un takeover vacía la cola y
    // nadie más difunde kind "game_gen", así que sin este aviso la línea de la
    // tarjeta gira para siempre.
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: posadaSinPuerta(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      let soltar!: () => void;
      bundle.ctx.sceneGen.enqueue({
        key: "bloqueo",
        blocking: true,
        run: () =>
          new Promise<SceneGenOutcome>((r) => {
            soltar = () => r({ delivered: false, motivo: "bloqueo de test: no difunde nada" });
          }),
      });
      const { socket } = makeSocket();
      await routeMessage(
        { type: "repair_game_world", requestId: "c1", gameId: GAME },
        socket,
        bundle.ctx,
      );
      assert.deepEqual(bundle.ctx.sceneGen.pending, [`curar:${GAME}`]);
      bundle.ctx.sceneGen.abandonAll();
      await waitFor(
        () =>
          bundle.broadcasts.some(
            (m) => m.type === "narrative_status" && m.kind === "game_gen" && m.phase === "error",
          ),
        1000,
      ).catch(() => assert.fail("la cura abandonada no avisó: la línea gira para siempre"));
      soltar();
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("si el mundo se cura mientras el job espera en la cola, NO se reescribe sobre una foto vieja", async () => {
    // El job vuelve a leer el fichero dentro de la cola. Sin eso curaría
    // contra lo que vio el handler y sobreescribiría un mundo que ya no es
    // ése — el peor desenlace posible para el único artefacto del juego.
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: posadaSinPuerta(1) });
      const bundle = makeCtx({ gamesDir, persistWorldSnapshots: true });
      motorFake(bundle);
      let soltar!: () => void;
      bundle.ctx.sceneGen.enqueue({
        key: "bloqueo",
        blocking: true,
        run: () =>
          new Promise<SceneGenOutcome>((r) => {
            soltar = () => r({ delivered: false, motivo: "bloqueo de test" });
          }),
      });
      const { socket, sent } = makeSocket();
      await routeMessage(
        { type: "repair_game_world", requestId: "c1", gameId: GAME },
        socket,
        bundle.ctx,
      );
      assert.equal((sent.find((m) => m.type === "game_world_repaired") as GameWorldRepairedMessage).ok, true);
      // Otro escritor deja el mundo entero sano mientras el job espera.
      const sano = aDisco(gamesDir, worldDocHash, { [ENTRADA]: sana(0, true), tile_1_0: sana(1) });
      soltar();
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
      assert.equal(final.phase, "error");
      assert.match(final.message ?? "", /no tiene ninguna escena cribada/);
      assert.equal(bundle.aiCalls.scene.length, 0, "no se le pidió nada al motor");
      assert.deepEqual(leer(gamesDir), sano, "el fichero de quien llegó antes queda intacto");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});
