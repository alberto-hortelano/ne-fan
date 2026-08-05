/** Migración one-shot cache/manifest.json → SQLite, idempotente.
 *
 *  - Importa las entradas EN ORDEN DE ARRAY (rowid ascendente = orden de
 *    inserción actual) para que list_assets devuelva exactamente lo mismo.
 *  - INSERT OR IGNORE + UNIQUE(hash,type,subtype): re-ejecutar no duplica.
 *  - Importa TODO, incluidos los subtypes sin writer actual (bbox, billboard,
 *    render, discovery, backdrop — residuos de módulos eliminados):
 *    find_by_hash los devuelve hoy y el total del prune los cuenta; una purga
 *    sería una decisión aparte post-F2, no un efecto lateral de migrar.
 *  - manifest.json NO se toca (rollback = volver a leerlo desde ai_server).
 *  - Recovery scan (port del bloque de ai_server/main.py): SOLO si tras el
 *    import la tabla sigue vacía — misma condición que hoy (count == 0).
 *
 *  Standalone: `npx tsx services/asset-store/migrate-manifest.ts`
 *  (usa las rutas de la config; el server también la ejecuta al arrancar si
 *  la tabla está vacía).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ManifestDb, ManifestEntryRow } from "./manifest-db.js";

export interface MigrationSummary {
  imported: number;
  ignored: number;
  recovered: number;
}

/** Mapa filename → subtype por tipo, espejo del recovery de ai_server/main.py. */
const RECOVERY_SUBTYPES: Record<string, Record<string, string>> = {
  texture: { "albedo.png": "albedo", "normal.png": "normal", "roughness.png": "roughness" },
  model: { "model.glb": "model" },
  skin: { "skin.png": "skin" },
  sprite: { "sprite.png": "sprite" },
  scene: { "scene.png": "scene" },
  segment: { "segment.png": "segment" },
};

export function migrateManifest(
  db: ManifestDb,
  manifestJsonPath: string,
  dirsByType: Record<string, string>,
): MigrationSummary {
  const summary: MigrationSummary = { imported: 0, ignored: 0, recovered: 0 };

  if (existsSync(manifestJsonPath)) {
    let entries: unknown;
    try {
      entries = JSON.parse(readFileSync(manifestJsonPath, "utf-8"));
    } catch (err) {
      // Fail-loud: un manifest corrupto no debe migrarse a medias en silencio.
      throw new Error(`manifest.json ilegible (${manifestJsonPath}): ${(err as Error).message}`, {
        cause: err,
      });
    }
    if (!Array.isArray(entries)) {
      throw new Error(`manifest.json no es un array (${manifestJsonPath})`);
    }
    const before = db.totalCount();
    db.transaction(() => {
      for (const raw of entries as Array<Record<string, unknown>>) {
        db.importEntry({
          hash: String(raw.hash ?? ""),
          type: String(raw.type ?? ""),
          subtype: String(raw.subtype ?? ""),
          prompt: String(raw.prompt ?? ""),
          created_at: String(raw.created_at ?? ""),
          size_bytes: Number(raw.size_bytes ?? 0),
          extra: (raw.extra as Record<string, unknown>) ?? {},
          ...(typeof raw.last_used === "string" ? { last_used: raw.last_used } : {}),
        } as ManifestEntryRow);
      }
    });
    const after = db.totalCount();
    summary.imported = after - before;
    summary.ignored = (entries as unknown[]).length - summary.imported;
    if (summary.imported > 0) {
      db.setMeta("imported_at", new Date().toISOString());
      db.setMeta("imported_source", manifestJsonPath);
    }
  }

  // First-run recovery: solo con índice vacío (assets previos al manifest).
  if (db.totalCount() === 0) {
    for (const [assetType, byFilename] of Object.entries(RECOVERY_SUBTYPES)) {
      const root = dirsByType[assetType];
      if (!root || !existsSync(root)) continue;
      for (const hashDir of readdirSync(root)) {
        const dirPath = join(root, hashDir);
        if (!statSync(dirPath).isDirectory()) continue;
        for (const file of readdirSync(dirPath)) {
          const subtype = byFilename[file];
          if (!subtype) continue;
          let size: number;
          try {
            size = statSync(join(dirPath, file)).size;
          } catch {
            size = 0; // igual que el Python: stat fallido → 0, la entrada entra
          }
          db.importEntry({
            hash: hashDir,
            type: assetType,
            subtype,
            prompt: "", // desconocido — el fichero es anterior al manifest
            created_at: new Date().toISOString(),
            size_bytes: size,
            extra: { recovered: true },
          });
          summary.recovered += 1;
        }
      }
    }
  }

  return summary;
}

// ── CLI standalone ──
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadAssetStoreConfig } = await import("./config.js");
  const { ManifestDb } = await import("./manifest-db.js");
  const cfg = loadAssetStoreConfig(process.env);
  const db = new ManifestDb(cfg.dbPath);
  const s = migrateManifest(db, cfg.manifestJsonPath, cfg.dirsByType);
  console.log(
    `migrate-manifest: ${s.imported} importadas, ${s.ignored} ya presentes, ` +
      `${s.recovered} recuperadas de disco → ${cfg.dbPath} (${db.totalCount()} filas)`,
  );
  db.close();
}
