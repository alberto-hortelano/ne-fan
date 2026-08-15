/** Índice SQLite del asset-store — sustituye a cache/manifest.json (lista
 *  JSON reescrita ENTERA en cada registro bajo un lock de proceso).
 *
 *  Semánticas portadas 1:1 de ai_server/asset_cache.py (AssetManifest):
 *  - register = INSERT OR IGNORE por (hash, type, subtype) — el Python hace
 *    dedupe y return silencioso, nunca actualiza la entrada existente.
 *  - list_assets = reverse + collapse por (hash, type) quedándose con la
 *    entrada MÁS RECIENTE por orden de inserción (rowid).
 *  - touch = last_used en TODAS las entradas del hash, con debounce de 60 s
 *    por hash (hoy el debounce era del persist y los últimos ≤60 s se perdían
 *    en shutdown; aquí cada write es durable — mejora estricta).
 *  - prune agrupa por (type, hash) con last = max(last_used|created_at)
 *    lexicográfico (ISO-8601 UTC ordena cronológicamente).
 *
 *  Invariante de concurrencia: este proceso es el ÚNICO que abre el fichero
 *  .sqlite3; DatabaseSync es síncrono y las escrituras se serializan en el
 *  event loop — la cola HTTP del proceso ES la serialización.
 */
import { DatabaseSync } from "node:sqlite";

export interface ManifestEntryRow {
  hash: string;
  type: string;
  subtype: string;
  prompt: string;
  created_at: string;
  size_bytes: number;
  extra: Record<string, unknown>;
  last_used?: string;
}

export interface AssetSummaryRow {
  hash: string;
  type: string;
  subtype: string;
  prompt: string;
  created_at: string;
}

export interface PruneGroup {
  type: string;
  hash: string;
  size: number;
  last: string;
}

const TOUCH_DEBOUNCE_MS = 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

export class ManifestDb {
  private db: DatabaseSync;
  private lastTouch = new Map<string, number>();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS assets (
        id         INTEGER PRIMARY KEY,
        hash       TEXT NOT NULL,
        type       TEXT NOT NULL,
        subtype    TEXT NOT NULL,
        prompt     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        extra      TEXT NOT NULL DEFAULT '{}',
        last_used  TEXT,
        UNIQUE (hash, type, subtype)
      );
      CREATE INDEX IF NOT EXISTS idx_assets_type_hash ON assets(type, hash);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  /** Registro normal (POST /assets): created_at lo estampa el store, igual
   *  que hacía AssetManifest.register con _now(). Duplicado = no-op. */
  register(e: {
    hash: string;
    type: string;
    subtype: string;
    prompt: string;
    size_bytes: number;
    extra?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO assets (hash, type, subtype, prompt, created_at, size_bytes, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.hash, e.type, e.subtype, e.prompt, nowIso(), e.size_bytes, JSON.stringify(e.extra ?? {}));
  }

  /** Import de la migración/recovery: conserva created_at y last_used. */
  importEntry(e: ManifestEntryRow): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO assets (hash, type, subtype, prompt, created_at, size_bytes, extra, last_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.hash,
        e.type,
        e.subtype,
        e.prompt,
        e.created_at,
        e.size_bytes,
        JSON.stringify(e.extra ?? {}),
        e.last_used ?? null,
      );
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** `assetType` admite lista CSV ("texture,model,surface") — la librería del
   *  motor narrativo pide varios tipos reutilizables en una sola consulta. */
  listAssets(assetType?: string, limit = 50): AssetSummaryRow[] {
    const types = (assetType ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const typeFilter = types.length
      ? `type IN (${types.map(() => "?").join(",")})`
      : "1=1";
    const rows = this.db
      .prepare(
        `SELECT hash, type, subtype, prompt, created_at FROM (
           SELECT hash, type, subtype, prompt, created_at,
                  ROW_NUMBER() OVER (PARTITION BY hash, type ORDER BY id DESC) AS rn,
                  id
           FROM assets
           WHERE ${typeFilter}
         ) WHERE rn = 1 ORDER BY id DESC LIMIT ?`,
      )
      .all(...types, limit) as unknown as AssetSummaryRow[];
    return rows;
  }

  findByHash(hash: string): ManifestEntryRow[] {
    const rows = this.db
      .prepare(
        `SELECT hash, type, subtype, prompt, created_at, size_bytes, extra, last_used
         FROM assets WHERE hash = ? ORDER BY id`,
      )
      .all(hash) as unknown as Array<Omit<ManifestEntryRow, "extra"> & { extra: string; last_used: string | null }>;
    return rows.map((r) => {
      const entry: ManifestEntryRow = {
        hash: r.hash,
        type: r.type,
        subtype: r.subtype,
        prompt: r.prompt,
        created_at: r.created_at,
        size_bytes: r.size_bytes,
        extra: JSON.parse(r.extra) as Record<string, unknown>,
      };
      // last_used solo si existe — el JSON del manifest legado omitía la clave.
      if (r.last_used != null) entry.last_used = r.last_used;
      return entry;
    });
  }

  touch(hash: string): void {
    const now = Date.now();
    const last = this.lastTouch.get(hash) ?? 0;
    if (now - last < TOUCH_DEBOUNCE_MS) return;
    this.lastTouch.set(hash, now);
    this.db.prepare(`UPDATE assets SET last_used = ? WHERE hash = ?`).run(nowIso(), hash);
  }

  totalBytes(): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM assets`).get() as {
      total: number;
    };
    return row.total;
  }

  totalCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM assets`).get() as { n: number };
    return row.n;
  }

  /** Grupos (type, hash) con tamaño agregado y último uso — la unidad de
   *  eviction del prune LRU. */
  pruneGroups(): PruneGroup[] {
    return this.db
      .prepare(
        `SELECT type, hash, SUM(size_bytes) AS size,
                MAX(COALESCE(last_used, created_at, '')) AS last
         FROM assets GROUP BY type, hash`,
      )
      .all() as unknown as PruneGroup[];
  }

  deleteGroup(type: string, hash: string): void {
    this.db.prepare(`DELETE FROM assets WHERE type = ? AND hash = ?`).run(type, hash);
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  integrityCheck(): string {
    const row = this.db.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
    return row.integrity_check;
  }

  close(): void {
    this.db.close();
  }
}
