/** Pluggable storage for narrative sessions. */
import { promises as fs } from "node:fs";
import { resolve, dirname } from "node:path";
import type { SessionData, SessionMetadata } from "./types.js";

export interface SessionStorage {
  read(sessionId: string): Promise<SessionData | null>;
  write(sessionId: string, data: SessionData): Promise<void>;
  delete(sessionId: string): Promise<boolean>;
  list(): Promise<SessionMetadata[]>;
  exists(sessionId: string): Promise<boolean>;
}

/** Stores sessions on the local filesystem under {root}/{session_id}/state.json. */
export class FsSessionStorage implements SessionStorage {
  constructor(private root: string) {}

  private pathFor(sessionId: string): string {
    return resolve(this.root, sessionId, "state.json");
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await fs.access(this.pathFor(sessionId));
      return true;
    } catch {
      return false;
    }
  }

  async read(sessionId: string): Promise<SessionData | null> {
    try {
      const text = await fs.readFile(this.pathFor(sessionId), "utf-8");
      return JSON.parse(text) as SessionData;
    } catch {
      return null;
    }
  }

  async write(sessionId: string, data: SessionData): Promise<void> {
    const path = this.pathFor(sessionId);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(data, null, "\t"), "utf-8");
  }

  async delete(sessionId: string): Promise<boolean> {
    try {
      await fs.rm(resolve(this.root, sessionId), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<SessionMetadata[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const result: SessionMetadata[] = [];
    for (const name of entries) {
      const data = await this.read(name);
      if (!data) continue;
      let summary = data.story_so_far ?? "";
      if (summary.length > 80) summary = summary.slice(0, 77) + "...";
      result.push({
        session_id: data.session_id || name,
        game_id: data.game_id || "?",
        updated_at: data.updated_at || "",
        summary,
        scene_count: Object.keys(data.scenes_loaded ?? {}).length,
        entity_count: (data.entities ?? []).length,
      });
    }
    result.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    return result;
  }
}

/** In-memory storage for tests and ephemeral sessions. */
export class MemorySessionStorage implements SessionStorage {
  private store = new Map<string, SessionData>();

  async exists(sessionId: string): Promise<boolean> {
    return this.store.has(sessionId);
  }

  async read(sessionId: string): Promise<SessionData | null> {
    const data = this.store.get(sessionId);
    return data ? structuredClone(data) : null;
  }

  async write(sessionId: string, data: SessionData): Promise<void> {
    this.store.set(sessionId, structuredClone(data));
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.store.delete(sessionId);
  }

  async list(): Promise<SessionMetadata[]> {
    const result: SessionMetadata[] = [];
    for (const data of this.store.values()) {
      let summary = data.story_so_far ?? "";
      if (summary.length > 80) summary = summary.slice(0, 77) + "...";
      result.push({
        session_id: data.session_id,
        game_id: data.game_id,
        updated_at: data.updated_at,
        summary,
        scene_count: Object.keys(data.scenes_loaded ?? {}).length,
        entity_count: (data.entities ?? []).length,
      });
    }
    result.sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
    return result;
  }
}
