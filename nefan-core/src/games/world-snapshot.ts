/** Snapshot de mundo pre-generado — el contenido de la génesis de un juego
 *  (world map + escenas Format D expandidas + escena de entrada) persistido
 *  como artefacto de primera clase en `data/games/{id}/world/{branch}.json`.
 *
 *  El contenido es 100% independiente del ESTILO visual: su clave de
 *  invalidación es `world_doc_hash` (editar world.md lo deja stale) más la
 *  RAMA de contenido, hoy solo "tile" (el plano continuo, que sirve a
 *  overworld Y fps: la rama "stage" murió con el plató proscenio). Los
 *  assets de imagen por estilo se registran aparte (`world/styles/`).
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
import type { WorldMap } from "../world-map/types.js";

/** Ramas de contenido: la vista fps comparte los tiles del overworld. */
export const WORLD_BRANCHES = ["tile"] as const;
export type WorldBranch = (typeof WORLD_BRANCHES)[number];

export function branchForView(_view: string): WorldBranch {
  return "tile";
}

export const WORLD_SNAPSHOT_SCHEMA_VERSION = 1;

/** Envoltorio validado por zod; el interior (world_map, escenas Format D) ya
 *  fue validado al generarse — aquí `WorldMapManager.fromSerialized` y el
 *  replay son la segunda línea. */
export const WorldSnapshotSchema = z
  .object({
    schema_version: z.literal(WORLD_SNAPSHOT_SCHEMA_VERSION),
    game_id: z.string().regex(SAFE_ID),
    /** sha256 del world.md con el que se generó — distinto = stale. */
    world_doc_hash: z.string().min(1),
    branch: z.enum(WORLD_BRANCHES),
    generated_at: z.string().min(1),
    world_map: z.record(z.string(), z.unknown()),
    /** sceneId → escena Format D EXPANDIDA (expandScenePrimitives ya corrió). */
    scenes: z.record(z.string(), z.record(z.string(), z.unknown())),
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
  branch: WorldBranch;
  generated_at: string;
  world_map: WorldMap;
  scenes: Record<string, Record<string, unknown>>;
  entry_scene_id: string;
}

export function worldSnapshotPath(gamesDir: string, gameId: string, branch: WorldBranch): string {
  if (!SAFE_ID.test(gameId)) {
    throw new Error(`worldSnapshotPath: unsafe gameId "${gameId}"`);
  }
  return join(gamesDir, gameId, "world", `${branch}.json`);
}

/** Carga el snapshot de la rama. Ausente → null. Malformado o de otra versión
 *  de schema → throw (fail-loud: el caller decide si degrada al bootstrap
 *  vivo REPORTÁNDOLO). world_doc_hash distinto del esperado → null + warn
 *  (world.md editado: stale esperable, nunca servir mundo viejo en silencio). */
export function loadWorldSnapshot(
  gamesDir: string,
  gameId: string,
  branch: WorldBranch,
  expectedWorldDocHash: string,
): WorldSnapshot | null {
  const path = worldSnapshotPath(gamesDir, gameId, branch);
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
  if (parsed.data.world_doc_hash !== expectedWorldDocHash) {
    console.warn(
      `world snapshot stale para "${gameId}" (${branch}): world.md cambió ` +
        `desde la generación — se ignora (regenera el mundo desde el título)`,
    );
    return null;
  }
  // El envoltorio va por zod; el world_map lo re-valida
  // WorldMapManager.fromSerialized al restaurarlo (segunda línea).
  return parsed.data as unknown as WorldSnapshot;
}

export function writeWorldSnapshot(gamesDir: string, snapshot: WorldSnapshot): void {
  const parsed = WorldSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new Error(`writeWorldSnapshot: snapshot inválido: ${parsed.error.message.slice(0, 500)}`);
  }
  const path = worldSnapshotPath(gamesDir, snapshot.game_id, snapshot.branch);
  mkdirSync(join(gamesDir, snapshot.game_id, "world"), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

/** Borra el snapshot de la rama (Regenerar mundo). true si existía. */
export function deleteWorldSnapshot(
  gamesDir: string,
  gameId: string,
  branch: WorldBranch,
): boolean {
  const path = worldSnapshotPath(gamesDir, gameId, branch);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Estado del snapshot para el LISTADO del título (games_listed). Degrada por
 *  juego como listGames: un snapshot malformado se reporta como "stale" con
 *  warning en vez de tumbar el listado — cargarlo de verdad (start_session)
 *  sigue siendo fail-loud. */
/** Estado de generación de AMBAS ramas de un juego, para games_listed (los
 *  chips del título). Degrada por juego: cualquier error ⇒ ambas "stale"
 *  con warning (listGames ya filtró los juegos ilegibles). */
export function gameGenerationStatus(
  gamesDir: string,
  gameId: string,
): { tile: "ready" | "stale" | "missing" } {
  try {
    const hash = createHash("sha256")
      .update(loadWorldDoc(gamesDir, gameId), "utf-8")
      .digest("hex");
    return { tile: worldSnapshotStatus(gamesDir, gameId, "tile", hash) };
  } catch (err) {
    console.warn(`gameGenerationStatus("${gameId}"): ${(err as Error).message}`);
    return { tile: "stale" };
  }
}

export function worldSnapshotStatus(
  gamesDir: string,
  gameId: string,
  branch: WorldBranch,
  worldDocHash: string,
): "ready" | "stale" | "missing" {
  try {
    const path = worldSnapshotPath(gamesDir, gameId, branch);
    if (!existsSync(path)) return "missing";
    return loadWorldSnapshot(gamesDir, gameId, branch, worldDocHash) ? "ready" : "stale";
  } catch (err) {
    console.warn(`worldSnapshotStatus("${gameId}", ${branch}): ${(err as Error).message}`);
    return "stale";
  }
}
