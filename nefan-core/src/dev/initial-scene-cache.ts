/** Dev-only cache of `start_session` bootstrap.
 *
 * When the player begins a fresh game the narrative engine spends ~90 s on the
 * initial world-map bootstrap + first scene. During development the same
 * `gameId` produces conceptually the same starting state every time, so we
 * persist (scene + world_map) by `gameId` and replay it on the next session.
 *
 * Gated by `CONFIG.dev.cache_initial_scene` — off by default. The on-disk
 * snapshot is gitignored; delete the file (or the directory) to invalidate.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorldMap } from "../world-map/types.js";

const SCHEMA_VERSION = 1;
const SAFE_GAME_ID = /^[A-Za-z0-9_.-]+$/;

export interface CachedBootstrap {
  schema_version: number;
  game_id: string;
  scene: Record<string, unknown>;
  world_map: WorldMap;
  cached_at: string;
}

export class InitialSceneCache {
  constructor(private readonly cacheDir: string) {}

  has(gameId: string): boolean {
    return existsSync(this.pathFor(gameId));
  }

  get(gameId: string): CachedBootstrap | null {
    const path = this.pathFor(gameId);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as CachedBootstrap;
    if (parsed.schema_version !== SCHEMA_VERSION) {
      throw new Error(
        `InitialSceneCache: schema mismatch for "${gameId}" ` +
          `(file=${parsed.schema_version}, code=${SCHEMA_VERSION}). ` +
          `Delete ${path} to invalidate.`,
      );
    }
    return parsed;
  }

  set(gameId: string, scene: Record<string, unknown>, worldMap: WorldMap): void {
    mkdirSync(this.cacheDir, { recursive: true });
    const entry: CachedBootstrap = {
      schema_version: SCHEMA_VERSION,
      game_id: gameId,
      // Deep-copy via JSON so later mutations on the in-memory scene (e.g.
      // broadcastScene attaching `exits`) don't bleed into the snapshot.
      scene: JSON.parse(JSON.stringify(scene)) as Record<string, unknown>,
      world_map: JSON.parse(JSON.stringify(worldMap)) as WorldMap,
      cached_at: new Date().toISOString(),
    };
    writeFileSync(this.pathFor(gameId), JSON.stringify(entry, null, 2));
  }

  clear(gameId?: string): void {
    if (!existsSync(this.cacheDir)) return;
    if (gameId !== undefined) {
      const path = this.pathFor(gameId);
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    for (const f of readdirSync(this.cacheDir)) {
      if (f.endsWith(".json")) unlinkSync(join(this.cacheDir, f));
    }
  }

  list(): string[] {
    if (!existsSync(this.cacheDir)) return [];
    return readdirSync(this.cacheDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
  }

  private pathFor(gameId: string): string {
    if (!SAFE_GAME_ID.test(gameId)) {
      throw new Error(
        `InitialSceneCache: refusing unsafe gameId "${gameId}" ` +
          `(must match ${SAFE_GAME_ID})`,
      );
    }
    return join(this.cacheDir, `${gameId}.json`);
  }
}
