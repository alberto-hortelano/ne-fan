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
  WorldSnapshotSchema,
  deleteWorldSnapshot,
  escenasQueSobreviven,
  loadWorldSnapshot,
  worldSnapshotPath,
  worldSnapshotStatus,
  writeWorldSnapshot,
  type WorldSnapshot,
} from "../src/games/world-snapshot.js";
import { routeMessage } from "../bridge/router.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusDeSesion,
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
    // `size` ni `terrain`, con una entity sin `footprint`— que
    // ningún camino real produce; pasaban porque `scenes` no tenía tipo (#237).
    scenes: {
      tile_0_0: expandScenePrimitives({
        scene_id: "tile_0_0",
        scene_description: "Tile de arranque del snapshot",
        tile: { tx: 0, ty: 0 },
        biome: "grass",
        entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }],
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
      entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }],
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

    /** El zod es la PUERTA, no un transformador (#237, hallazgo de QA).
     *
     *  `loadWorldSnapshot` devolvía `parsed.data`, así que desde que `scenes`
     *  pasa por `ExpandedSceneSchema` el schema podía reescribir datos de
     *  DISCO en silencio. Dos caminos independientes, los dos medidos:
     *   · un `.trim()` en el schema recortaba `"  tabernero  "`;
     *   · un sub-objeto en modo por defecto (`size`, `tile`) PODA sus claves
     *     desconocidas — y eso no lo arregla quitar ningún `.trim()`.
     *
     *  Este `it` los canda a los dos por el sitio que importa: lo que sale de
     *  la puerta de carga es byte a byte lo que había en el fichero. Se pone
     *  rojo con `return parsed.data`, que es como estaba. */
    it("devuelve EXACTAMENTE lo que hay en disco: la puerta no reescribe", () => {
      const { gamesDir, worldDocHash } = tmpGamesDir();
      try {
        const escena = expandida();
        // Vector 1: string con espacios alrededor (válida, y antes se recortaba).
        (escena.entities as Record<string, unknown>[])[0].description = "  guardia con lanza y capa parda  ";
        // Vector 2: clave desconocida dentro de un sub-objeto en modo por
        // defecto — el schema la acepta y, si el llamador se queda con
        // `parsed.data`, la PIERDE.
        (escena.size as Record<string, unknown>).comentario = "algo que alguien guardó";
        aDisco(gamesDir, worldDocHash, escena);

        const enDisco = JSON.parse(readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8")) as Record<string, unknown>;
        const cargado = loadWorldSnapshot(gamesDir, GAME, worldDocHash);
        assert.ok(cargado);
        assert.deepEqual(
          cargado.scenes,
          (enDisco as { scenes: unknown }).scenes,
          "la ruta de carga ha reescrito el snapshot: el zod valida, no transforma",
        );
      } finally {
        rmSync(gamesDir, { recursive: true, force: true });
      }
    });

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
        (m): m is NarrativeStatusDeSesion =>
          m.type === "narrative_status" && m.kind !== "game_gen" && m.phase === "ready",
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

/** #302 · lo que se carga pasa por `validateScene` o no se sirve.
 *
 *  Lo ESTRUCTURAL ya lo paraba `ExpandedSceneSchema .strict()` (#237, #409):
 *  un campo retirado tumbaba el snapshot. Lo que NO miraba nadie era la
 *  JUGABILIDAD: `scene-validate.ts` se endureció cinco veces entre el 22-08 y
 *  el 04-09 y un snapshot generado bajo el validador viejo se replayeaba
 *  `ready` con un NPC que hoy nace dentro de un muro. Como los snapshots de
 *  `data/games/` están en `.gitignore`, esto no puede recorrer el disco (verde
 *  vacío en CI): el artefacto es SINTÉTICO y se escribe sin pasar por el
 *  validador de escritura (patrón `aDisco`), que es justo la forma de «lo
 *  generó una versión anterior».
 *
 *  El artefacto está BIEN FORMADO a propósito —el primer `it` lo demuestra
 *  con el MISMO zod que aplica la puerta, `WorldSnapshotSchema`—, para que el
 *  rojo de los demás solo pueda venir del bucle de `validateScene` en
 *  `loadWorldSnapshot`. Comentar ese bucle pone rojos los tres que siguen al
 *  primero (probado en negativo el 2026-09-05). */
describe("lo que se carga pasa por validateScene o no se sirve (#302)", () => {
  /** Posada SIN cutaway = huella sólida entera, y el posadero nace dentro:
   *  `nace-en-solido`, la clase de #289 que `checkNpcBodies` juzga SIEMPRE,
   *  con o sin contexto de costuras. */
  const posadaSinPuerta = (tx: number, conPlayer: boolean): Record<string, unknown> =>
    expandScenePrimitives({
      scene_id: `tile_${tx}_0`,
      scene_description: "Una posada sin puerta con el posadero dentro",
      tile: { tx, ty: 0 },
      biome: "grass",
      volumes: [{ id: "posada", label: "posada", type: "building", rect: [52, 20, 24, 16] }],
      entities: [
        ...(conPlayer ? [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }] : []),
        { id: "posadero", kind: "npc", name: "Posadero", cell: [60, 27], footprint: [1, 1] },
      ],
    });

  const sana = (tx: number, conPlayer: boolean): Record<string, unknown> =>
    expandScenePrimitives({
      scene_id: `tile_${tx}_0`,
      scene_description: conPlayer ? "Tile de arranque" : "Vecino este",
      tile: { tx, ty: 0 },
      biome: "grass",
      entities: conPlayer ? [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }] : [],
    });

  const snapshotCon = (worldDocHash: string, scenes: Record<string, Record<string, unknown>>) => ({
    schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
    game_id: GAME,
    world_doc_hash: worldDocHash,
    generated_at: "2026-08-18T00:00:00.000Z",
    world_map: new WorldMapManager(WorldMapManager.createEmpty()).serialize(),
    scenes,
    entry_scene_id: "tile_0_0",
  });

  /** Escribe el snapshot SIN pasar por el validador de escritura. */
  const aDisco = (gamesDir: string, worldDocHash: string, scenes: Record<string, Record<string, unknown>>): void => {
    mkdirSync(join(gamesDir, GAME, "world"), { recursive: true });
    writeFileSync(worldSnapshotPath(gamesDir, GAME), JSON.stringify(snapshotCon(worldDocHash, scenes)), "utf-8");
  };

  it("el artefacto está BIEN FORMADO: la clase que se cierra no la ve el zod de la puerta", () => {
    // El mismo schema que aplica `loadWorldSnapshot` (y `writeWorldSnapshot`):
    // si esto no pasara, los rechazos de abajo serían del gate estructural y
    // no dirían nada de la jugabilidad.
    const r = WorldSnapshotSchema.safeParse(
      snapshotCon("h", { tile_0_0: posadaSinPuerta(0, true), tile_1_0: posadaSinPuerta(1, false) }),
    );
    assert.ok(r.success, r.success ? "" : r.error.message);
  });

  it("escena de ENTRADA injugable ⇒ loadWorldSnapshot lanza nombrando fichero, escena y motivo; el título la ve stale", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    try {
      aDisco(gamesDir, worldDocHash, { tile_0_0: posadaSinPuerta(0, true) });
      assert.throws(
        () => loadWorldSnapshot(gamesDir, GAME, worldDocHash),
        (err: Error) => {
          assert.match(err.message, /injugable/);
          assert.ok(err.message.includes(worldSnapshotPath(gamesDir, GAME)), `sin la ruta del fichero: ${err.message}`);
          assert.match(err.message, /"tile_0_0"/);
          assert.match(err.message, /"posadero".*no transitable/);
          assert.match(err.message, /regenera el mundo desde el título/);
          return true;
        },
      );
      // El chip del título degrada a stale con warning, nunca tumba el listado.
      const warn = console.warn;
      const avisos: string[] = [];
      console.warn = (...args: unknown[]) => void avisos.push(args.map(String).join(" "));
      try {
        assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "stale");
      } finally {
        console.warn = warn;
      }
      assert.match(avisos.join(" | "), /injugable/, "el motivo se reporta, no se traga");
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  /** #451 cambia la GRANULARIDAD de este rechazo, no lo afloja: el tile del
   *  anillo sigue sin pasar el validador de hoy (sin contexto de costuras el
   *  anillo solo pierde la alcanzabilidad, nunca el cuerpo del NPC), pero lo
   *  que se tira es ESE tile y no las ocho escenas buenas de al lado.
   *
   *  Hasta el 2026-09-14 este `it` afirmaba que `loadWorldSnapshot` LANZABA
   *  con un tile del anillo malo. Esa conducta se retira entera: el usuario
   *  eligió «se sirve la entrada y las buenas, y solo se vuelve a pedir el
   *  tile malo». Lo que NO se pierde de cobertura es el juicio: el tile malo
   *  sigue midiéndose con `validateScene` y sigue sin servirse. */
  it("un tile del ANILLO con un NPC en sólido se CRIBA y el resto del mundo se sirve igual (#451)", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const warn = console.warn;
    const avisos: string[] = [];
    console.warn = (...args: unknown[]) => void avisos.push(args.map(String).join(" "));
    try {
      aDisco(gamesDir, worldDocHash, { tile_0_0: sana(0, true), tile_1_0: posadaSinPuerta(1, false) });
      const cribado = loadWorldSnapshot(gamesDir, GAME, worldDocHash);
      assert.ok(cribado, "un anillo malo ya NO tumba el snapshot entero");
      assert.deepEqual(
        Object.keys(cribado.scenes),
        ["tile_0_0"],
        "se sirve la entrada y se criba el tile injugable, ni una cosa ni la otra",
      );
      // El motivo se REPORTA nombrando fichero, escena y causa: el tile no
      // desaparece en silencio, que es lo que separa una criba de un bug.
      const aviso = avisos.join(" | ");
      assert.match(aviso, /CRIBA/);
      assert.ok(aviso.includes(worldSnapshotPath(gamesDir, GAME)), `sin la ruta del fichero: ${aviso}`);
      assert.match(aviso, /"tile_1_0"/);
      assert.match(aviso, /"posadero".*no transitable/);
      // El snapshot SE SIRVE, así que el chip del título lo ve `ready`: lo que
      // queda pendiente es un tile, no el mundo.
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "ready");
      // Y la carga NO reescribe el fichero: el tile malo sigue en disco (se
      // criba otra vez en la carga siguiente) hasta que el motor lo regenere.
      const enDisco = JSON.parse(readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8")) as WorldSnapshot;
      assert.deepEqual(Object.keys(enDisco.scenes).sort(), ["tile_0_0", "tile_1_0"]);

      // Control positivo: la misma forma con el anillo sano entra ENTERA (la
      // criba no rechaza de más, ni por el player de la entrada ni por la
      // falta de player del anillo) y sin un solo aviso.
      avisos.length = 0;
      aDisco(gamesDir, worldDocHash, { tile_0_0: sana(0, true), tile_1_0: sana(1, false) });
      const cargado = loadWorldSnapshot(gamesDir, GAME, worldDocHash);
      assert.ok(cargado);
      assert.equal(Object.keys(cargado.scenes).length, 2);
      assert.equal(avisos.length, 0, `el mundo sano no genera avisos: ${avisos.join(" | ")}`);
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "ready");
    } finally {
      console.warn = warn;
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  /** El caso que el criterio 5 exige medido de punta a punta: el jugador
   *  ENTRA y el tile cribado se le sirve generándolo, no se le niega. */
  it("start_session con el anillo cribado: se replayea sin motor y el tile malo se vuelve a pedir al llegar", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const warn = console.warn;
    console.warn = () => {};
    try {
      aDisco(gamesDir, worldDocHash, {
        tile_0_0: sana(0, true),
        tile_1_0: posadaSinPuerta(1, false),
        tile_0_1: sana(0, false),
      });
      const { ctx, broadcasts, narrative, aiCalls } = makeCtx({ gamesDir });
      const { socket, sent } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
      assert.equal((sent[0] as { ok: boolean }).ok, true);
      // Cero llamadas al motor para entrar: el mundo bueno se sirvió.
      assert.equal(aiCalls.scene.length, 0, "la partida arranca del snapshot, no del motor");
      const ready = broadcasts.find(
        (m): m is NarrativeStatusDeSesion =>
          m.type === "narrative_status" && m.kind !== "game_gen" && m.phase === "ready",
      );
      assert.equal(ready?.source, "snapshot");
      assert.ok(narrative.scenes_loaded["tile_0_0"], "la entrada");
      assert.ok(narrative.scenes_loaded["tile_0_1"], "el vecino bueno");
      assert.equal(
        narrative.scenes_loaded["tile_1_0"],
        undefined,
        "el tile injugable NO se registra: si estuviera, se serviría de caché sin volver a validarse",
      );
      // …y al llegar a él, el bridge lo PIDE al motor (una llamada, la del
      // tile malo): «solo se vuelve a pedir el malo».
      await routeMessage({ type: "request_tile", tx: 1, ty: 0, reason: "blocking" }, socket, ctx);
      await waitFor(() => aiCalls.scene.length === 1);
      assert.equal(aiCalls.scene.length, 1, "el tile cribado se regenera al llegar");
    } finally {
      console.warn = warn;
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("start_session NO lo sirve: ningún `ready` con source snapshot, el bootstrap vivo corre (1 llamada al motor) y el motivo se reporta", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const error = console.error;
    const reportado: string[] = [];
    console.error = (...args: unknown[]) => void reportado.push(args.map(String).join(" "));
    try {
      aDisco(gamesDir, worldDocHash, { tile_0_0: posadaSinPuerta(0, true) });
      const { ctx, broadcasts, aiCalls } = makeCtx({ gamesDir });
      const { socket, sent } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
      await waitFor(() =>
        broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
      );
      assert.equal(sent[0].type, "session_started", "la sesión arranca igual: se degrada, no se deja al jugador sin partida");
      // Estrechado en línea por el discriminante (`kind`), sin predicado de
      // tipo: `source` solo existe en el status DE SESIÓN, no en el de
      // `game_gen`, y así el aserto no depende de qué nombre de la unión
      // importe el fichero (#231b).
      const readyDeSnapshot = broadcasts.find(
        (m) =>
          m.type === "narrative_status" &&
          m.kind !== "game_gen" &&
          m.phase === "ready" &&
          m.source === "snapshot",
      );
      assert.equal(readyDeSnapshot, undefined, "el snapshot injugable se sirvió como ready");
      assert.equal(aiCalls.scene.length, 1, "degradó al bootstrap vivo, que llama al motor");
      assert.match(reportado.join(" | "), /injugable/, "el bridge no se lo traga: lo reporta");
    } finally {
      console.error = error;
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});

/** #451 · la otra mitad, y la que de verdad destruía el mundo.
 *
 *  La carga ya sabía degradar al bootstrap vivo cuando la ENTRADA no pasaba
 *  el validador de hoy. Lo que nadie miraba es lo que pasaba DESPUÉS: al
 *  terminar, `writeSessionSnapshot` reescribía `world/tile.json` con lo que
 *  hubiera en `scenes_loaded` —una escena— y las otras ocho, que estaban
 *  perfectamente bien, dejaban de existir. Ese es el título del issue: «se
 *  tira entero; Continuar lo sustituye por uno de 1».
 *
 *  Se mide por el FICHERO, que es el sujeto: cuántas escenas quedan y cuál es
 *  la de entrada. La política es un parámetro sin defecto (`PoliticaDeSnapshot`),
 *  así que el tercer llamante tendrá que elegir en vez de heredar. */
describe("el anillo bueno no se pierde: la política de escritura del snapshot (#451)", () => {
  /** Las ocho del anillo, todas sanas. */
  const anilloSano = (): Record<string, Record<string, unknown>> => {
    const scenes: Record<string, Record<string, unknown>> = {};
    for (const [tx, ty] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      scenes[`tile_${tx}_${ty}`] = expandScenePrimitives({
        scene_id: `tile_${tx}_${ty}`,
        scene_description: `Vecino (${tx},${ty}) pre-generado`,
        tile: { tx, ty },
        biome: "grass",
        entities: [],
      });
    }
    return scenes;
  };

  /** Posada sólida con el posadero dentro: `nace-en-solido` (#289). */
  const entradaInjugable = (): Record<string, unknown> =>
    expandScenePrimitives({
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

  const escribirADisco = (
    gamesDir: string,
    worldDocHash: string,
    scenes: Record<string, Record<string, unknown>>,
  ): void => {
    mkdirSync(join(gamesDir, GAME, "world"), { recursive: true });
    writeFileSync(
      worldSnapshotPath(gamesDir, GAME),
      JSON.stringify({
        schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
        game_id: GAME,
        world_doc_hash: worldDocHash,
        generated_at: "2026-08-18T00:00:00.000Z",
        world_map: new WorldMapManager(WorldMapManager.createEmpty()).serialize(),
        scenes,
        entry_scene_id: "tile_0_0",
      }),
      "utf-8",
    );
  };

  const leerDeDisco = (gamesDir: string): WorldSnapshot =>
    JSON.parse(readFileSync(worldSnapshotPath(gamesDir, GAME), "utf-8")) as WorldSnapshot;

  it("ENTRADA injugable + 8 buenas ⇒ el bootstrap vivo cura la entrada y CONSERVA el anillo (9 escenas, no 1)", async () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const error = console.error;
    console.error = () => {};
    try {
      escribirADisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anilloSano() });
      const antes = leerDeDisco(gamesDir);
      assert.equal(Object.keys(antes.scenes).length, 9, "el montaje: 9 escenas en disco");

      const { ctx, broadcasts, aiCalls } = makeCtx({ gamesDir, persistWorldSnapshots: true });
      const { socket } = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
      await waitFor(() =>
        broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
      );
      // Decisión (i): la entrada injugable degrada al bootstrap vivo COMO HOY.
      assert.equal(aiCalls.scene.length, 1, "una llamada al motor: la entrada");

      const despues = leerDeDisco(gamesDir);
      assert.equal(
        Object.keys(despues.scenes).length,
        9,
        "el anillo bueno se perdió: el snapshot volvió a quedarse en una escena",
      );
      assert.equal(despues.entry_scene_id, "tile_0_0");
      // La entrada es la NUEVA (la vieja no pasaba el validador; ésta sí), y
      // las otras ocho son las de antes, intactas.
      assert.notDeepEqual(
        despues.scenes["tile_0_0"],
        antes.scenes["tile_0_0"],
        "la entrada tiene que ser la recién generada, no la injugable",
      );
      for (const id of Object.keys(anilloSano())) {
        assert.deepEqual(despues.scenes[id], antes.scenes[id], `el vecino ${id} cambió`);
      }
      // Y el fichero quedó CURADO: la partida siguiente entra sin motor.
      assert.equal(worldSnapshotStatus(gamesDir, GAME, worldDocHash), "ready");
      const segunda = makeCtx({ gamesDir });
      const s2 = makeSocket();
      await routeMessage({ type: "start_session", requestId: "r2", gameId: GAME }, s2.socket, segunda.ctx);
      assert.equal(segunda.aiCalls.scene.length, 0, "la partida siguiente ya no llama al motor");
      assert.equal(Object.keys(segunda.narrative.scenes_loaded).length, 9);
    } finally {
      console.error = error;
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("`escenasQueSobreviven` no conserva lo que no se puede servir: sin fichero, de otro world.md, o que el zod rechaza", () => {
    const { gamesDir, worldDocHash } = tmpGamesDir();
    const warn = console.warn;
    const avisos: string[] = [];
    console.warn = (...args: unknown[]) => void avisos.push(args.map(String).join(" "));
    try {
      assert.deepEqual(escenasQueSobreviven(gamesDir, GAME, worldDocHash), {}, "sin fichero");

      // Contenido de OTRO world.md: conservarlo sería blanquear un stale, que
      // es exactamente lo que la puerta de carga se niega a servir.
      escribirADisco(gamesDir, hashOf("otro world.md"), { tile_0_0: entradaInjugable(), ...anilloSano() });
      assert.deepEqual(escenasQueSobreviven(gamesDir, GAME, worldDocHash), {}, "otro world.md");
      assert.match(avisos.join(" | "), /otro world\.md/);

      // Malformado y estructuralmente inválido: tampoco, y con motivo.
      avisos.length = 0;
      writeFileSync(worldSnapshotPath(gamesDir, GAME), "{no es json", "utf-8");
      assert.deepEqual(escenasQueSobreviven(gamesDir, GAME, worldDocHash), {}, "malformado");
      assert.match(avisos.join(" | "), /malformado/);

      avisos.length = 0;
      const aMedias = anilloSano();
      delete aMedias["tile_1_0"].__expanded;
      escribirADisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...aMedias });
      assert.deepEqual(escenasQueSobreviven(gamesDir, GAME, worldDocHash), {}, "escena a medio expandir");
      assert.match(avisos.join(" | "), /inválido/);

      // Control positivo: el snapshot vigente SÍ se conserva entero — y la
      // entrada INJUGABLE también, porque quién puede servirse lo juzga la
      // carga con el validador del día, no el que escribe.
      escribirADisco(gamesDir, worldDocHash, { tile_0_0: entradaInjugable(), ...anilloSano() });
      assert.equal(Object.keys(escenasQueSobreviven(gamesDir, GAME, worldDocHash)).length, 9);
    } finally {
      console.warn = warn;
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });
});
