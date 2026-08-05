/** Entry del asset-store (S6, :8767): abre el índice SQLite, migra el
 *  manifest.json legado si la tabla está vacía (idempotente) y sirve
 *  AssetStoreApi. Arrancar con: `npx tsx services/asset-store/server.ts`
 *  (start.sh lo hace en los presets que lo necesitan). */
import { resolveServiceUrl } from "../../src/contracts/service-registry.js";
import { loadAssetStoreConfig } from "./config.js";
import { ManifestDb } from "./manifest-db.js";
import { migrateManifest } from "./migrate-manifest.js";
import { createAssetStoreServer } from "./http-server.js";

const cfg = loadAssetStoreConfig(process.env);
const db = new ManifestDb(cfg.dbPath);

if (db.totalCount() === 0) {
  const s = migrateManifest(db, cfg.manifestJsonPath, cfg.dirsByType);
  console.log(
    `asset-store: migración inicial — ${s.imported} entradas importadas de manifest.json, ` +
      `${s.recovered} recuperadas de disco`,
  );
}

console.log(`asset-store: índice ${cfg.dbPath} (${db.totalCount()} entradas, ${db.totalBytes()} bytes)`);

const server = createAssetStoreServer({
  port: cfg.port,
  db,
  dirsByType: cfg.dirsByType,
  spriteSheetsDir: cfg.spriteSheetsDir,
  stylesDir: cfg.stylesDir,
  cacheMaxBytes: cfg.cacheMaxBytes,
  worldStateUrl: resolveServiceUrl("world-state", process.env),
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
