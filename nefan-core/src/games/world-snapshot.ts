/** Snapshot de mundo pre-generado — el contenido de la génesis de un juego
 *  (world map + escenas Format D expandidas + escena de entrada) persistido
 *  como artefacto de primera clase en `data/games/{id}/world/tile.json`.
 *
 *  "tile" es la FORMA del contenido (el plano continuo de 64 m), no el
 *  nombre de una vista: no hay eje de vistas que elegir, y el fichero se
 *  llama así porque eso es lo que hay dentro. El contenido es 100%
 *  independiente del ESTILO visual: su clave de invalidación es
 *  `world_doc_hash` (editar world.md lo deja stale). Los assets de imagen
 *  por estilo se registran aparte (`world/styles/`).
 *
 *  Lo escriben el bootstrap vivo (pasivamente, al terminar) y el job
 *  `generate_game` (anillo 3×3 + places clave); lo consume `start_session`
 *  replayéandolo por la ruta normal (recordSceneLoaded + broadcastScene).
 *  Sustituye al viejo InitialSceneCache dev-only. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { createHash } from "node:crypto";

import { SAFE_ID, loadWorldDoc } from "./loader.js";
import { ExpandedSceneSchema } from "../contract/model-io/scene-schema.js";
import { validateScene } from "../scene/scene-validate.js";
import type { WorldMap } from "../world-map/types.js";

/** v2: muere el eje de vistas — el snapshot ya no declara `branch` (había
 *  una sola rama viva y su valor era siempre "tile"). */
export const WORLD_SNAPSHOT_SCHEMA_VERSION = 2;

/** Envoltorio validado por zod. Las escenas pasan aquí el gate ESTRUCTURAL
 *  (`ExpandedSceneSchema .strict()`); el de JUGABILIDAD (`validateScene`) lo
 *  aplica `loadWorldSnapshot` escena a escena, porque «ya se validó al
 *  generarse» no vale: el validador se endurece y el snapshot no se entera.
 *  `WorldMapManager.fromSerialized` re-valida el world_map al restaurarlo. */
export const WorldSnapshotSchema = z
  .object({
    schema_version: z.literal(WORLD_SNAPSHOT_SCHEMA_VERSION),
    game_id: z.string().regex(SAFE_ID),
    /** sha256 del world.md con el que se generó — distinto = stale. */
    world_doc_hash: z.string().min(1),
    generated_at: z.string().min(1),
    world_map: z.record(z.string(), z.unknown()),
    /** sceneId → escena Format D EXPANDIDA. Hasta #237 el valor era
     *  `z.record(z.string(), z.unknown())`: la frontera entre las dos
     *  poblaciones existía en el dato (`__expanded`) y estaba VACÍA en el
     *  tipo, así que un snapshot con escenas a medio expandir pasaba el gate
     *  y reventaba después, al pintar. `ExpandedSceneSchema` es el único
     *  schema que describe esta población — el otro (`EmittedSceneSchema`)
     *  describe la contraria y rechaza toda escena expandida por diseño. */
    scenes: z.record(z.string(), ExpandedSceneSchema),
    entry_scene_id: z.string().min(1),
  })
  .strict()
  .superRefine((snap, ctx) => {
    if (!(snap.entry_scene_id in snap.scenes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `entry_scene_id "${snap.entry_scene_id}" no está en scenes`,
      });
    }
  });

export interface WorldSnapshot {
  schema_version: number;
  game_id: string;
  world_doc_hash: string;
  generated_at: string;
  world_map: WorldMap;
  scenes: Record<string, Record<string, unknown>>;
  entry_scene_id: string;
}

export function worldSnapshotPath(gamesDir: string, gameId: string): string {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`worldSnapshotPath: unsafe gameId "${gameId}"`);
  }
  return join(gamesDir, gameId, "world", "tile.json");
}

/** Carga el snapshot del juego. Ausente → null. Malformado, de otra versión
 *  de schema o con una escena INJUGABLE → throw (fail-loud: el caller decide
 *  si degrada al bootstrap vivo REPORTÁNDOLO). world_doc_hash distinto del
 *  esperado → null + warn (world.md editado: stale esperable, nunca servir
 *  mundo viejo en silencio). */
export function loadWorldSnapshot(
  gamesDir: string,
  gameId: string,
  expectedWorldDocHash: string,
): WorldSnapshot | null {
  const path = worldSnapshotPath(gamesDir, gameId);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`world snapshot malformado (${path}): ${(err as Error).message}`, {
      cause: err,
    });
  }
  const parsed = WorldSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `world snapshot inválido (${path}): ${parsed.error.message.slice(0, 500)} — ` +
        `bórralo o regenera el mundo desde el título`,
    );
  }
  // Se devuelve `raw`, lo que había EN DISCO, y NO `parsed.data`: el zod es la
  // PUERTA, no un transformador. Devolver la salida del parseo reescribía el
  // snapshot en silencio por dos caminos independientes, los dos medidos:
  //   · una `description` de `"  tabernero  "` volvía sin espacios (lo cazó QA);
  //   · un sub-objeto en modo por defecto —`size`, `tile`— PODA sus claves
  //     desconocidas, y eso no lo arregla quitar ningún `.trim()`.
  // Arreglar solo el primero habría dejado el segundo abierto, así que la
  // regla va donde vale para los dos: quien valida no se queda con el
  // resultado. Es lo que hace `validateContract` en todo el resto de la casa.
  const snapshot = raw as WorldSnapshot;
  if (snapshot.world_doc_hash !== expectedWorldDocHash) {
    console.warn(
      `world snapshot stale para "${gameId}": world.md cambió desde la ` +
        `generación — se ignora (regenera el mundo desde el título)`,
    );
    return null;
  }
  // Lo que se carga pasa por el validador de JUGABILIDAD o no se sirve (#302).
  // El zod de arriba dice que la escena está bien FORMADA; esto dice que se
  // puede recorrer con un cuerpo. Va DESPUÉS del hash para no pagar el
  // flood-fill por un snapshot que ya es stale, y va aquí —la única puerta de
  // carga— y no en el replay del bridge, para que el chip del título y
  // `start_session` digan lo mismo con un solo código. `scene-validate.ts` se
  // endureció cinco veces entre el 22-08 y el 04-09: un snapshot generado bajo
  // el validador viejo seguía replayéandose `ready` con un NPC que hoy no cabe.
  // Sin contexto de costuras (`required_crossings: []`, sin `entry`), los
  // tiles del anillo salen con aviso `no-verificado` y NO se rechazan por
  // alcanzabilidad; lo que sí se juzga siempre es el cuerpo de cada NPC
  // (`checkNpcBodies`, #289) y el spawn del jugador en la escena de entrada.
  for (const [id, scene] of Object.entries(snapshot.scenes)) {
    const check = validateScene(scene, {
      required_crossings: [],
      bootstrap: id === snapshot.entry_scene_id,
    });
    if (!check.ok) {
      throw new Error(
        `world snapshot injugable (${path}): la escena "${id}" no pasa el validador de hoy: ` +
          `${check.errors.join(" · ")} — regenera el mundo desde el título`,
      );
    }
  }
  // El world_map lo re-valida WorldMapManager.fromSerialized al restaurarlo
  // (segunda línea).
  return snapshot;
}

export function writeWorldSnapshot(gamesDir: string, snapshot: WorldSnapshot): void {
  const parsed = WorldSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new Error(`writeWorldSnapshot: snapshot inválido: ${parsed.error.message.slice(0, 500)}`);
  }
  const path = worldSnapshotPath(gamesDir, snapshot.game_id);
  mkdirSync(join(gamesDir, snapshot.game_id, "world"), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

/** Borra el snapshot del juego (Regenerar mundo). true si existía. */
export function deleteWorldSnapshot(gamesDir: string, gameId: string): boolean {
  const path = worldSnapshotPath(gamesDir, gameId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Estado del contenido pre-generado de un juego, para games_listed (los
 *  chips del título). Degrada por juego: cualquier error ⇒ "stale" con
 *  warning en vez de tumbar el listado (listGames ya filtró los juegos
 *  ilegibles) — cargarlo de verdad (start_session) sigue siendo fail-loud. */
export function gameGenerationStatus(
  gamesDir: string,
  gameId: string,
): "ready" | "stale" | "missing" {
  try {
    const hash = createHash("sha256")
      .update(loadWorldDoc(gamesDir, gameId), "utf-8")
      .digest("hex");
    return worldSnapshotStatus(gamesDir, gameId, hash);
  } catch (err) {
    console.warn(`gameGenerationStatus("${gameId}"): ${(err as Error).message}`);
    return "stale";
  }
}

export function worldSnapshotStatus(
  gamesDir: string,
  gameId: string,
  worldDocHash: string,
): "ready" | "stale" | "missing" {
  try {
    const path = worldSnapshotPath(gamesDir, gameId);
    if (!existsSync(path)) return "missing";
    return loadWorldSnapshot(gamesDir, gameId, worldDocHash) ? "ready" : "stale";
  } catch (err) {
    console.warn(`worldSnapshotStatus("${gameId}"): ${(err as Error).message}`);
    return "stale";
  }
}
