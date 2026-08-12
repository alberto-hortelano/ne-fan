/** Wrapper over cache/manifest.json. */
import { promises as fs } from "node:fs";
import type { AssetEntry } from "./types.js";

export interface AssetIndexFilter {
  type?: string;
  subtype?: string;
  limit?: number;
}

export class AssetIndex {
  constructor(private manifestPath: string) {}

  async readAll(): Promise<AssetEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.manifestPath, "utf-8");
    } catch (err) {
      // Manifest aún no creado: [] legítimo. Cualquier otro IO (EACCES…) sube.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? (data as AssetEntry[]) : [];
    } catch (err) {
      // Manifest corrupto: NO devolver [] — addEntry lo machacaría con una
      // sola entrada, perdiendo el índice entero. Fail-loud.
      throw new Error(
        `manifest de assets corrupto en ${this.manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  async list(filter: AssetIndexFilter = {}): Promise<AssetEntry[]> {
    let entries = await this.readAll();
    if (filter.type) entries = entries.filter((e) => e.type === filter.type);
    if (filter.subtype) entries = entries.filter((e) => e.subtype === filter.subtype);
    // Newest first.
    entries.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    if (filter.limit && entries.length > filter.limit) {
      entries = entries.slice(0, filter.limit);
    }
    return entries;
  }

  async getByHash(hash: string): Promise<AssetEntry | null> {
    const all = await this.readAll();
    return all.find((e) => e.hash === hash) ?? null;
  }

  /** Append an entry to the manifest. ai_server is the canonical writer; clients
   * use this only for offline indexing (e.g. pre-rendered Mixamo sheets). */
  async addEntry(entry: AssetEntry): Promise<void> {
    const all = await this.readAll();
    all.push(entry);
    await fs.writeFile(this.manifestPath, JSON.stringify(all, null, 2), "utf-8");
  }
}
