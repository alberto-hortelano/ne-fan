/** Entry del asset-store (S6, :8767): abre el índice SQLite, comprueba que
 *  solo contiene kinds con productor y sirve AssetStoreApi. Arrancar con:
 *  `npx tsx services/asset-store/server.ts` (start.sh lo hace en los presets
 *  que lo necesitan). */
import { resolveServiceUrl } from "../../src/contracts/service-registry.js";
import { loadAssetStoreConfig } from "./config.js";
import { ManifestDb } from "./manifest-db.js";
import { verificarKindsConProductor } from "./kinds-con-productor.js";
import { createAssetStoreServer } from "./http-server.js";

const cfg = loadAssetStoreConfig(process.env);
const db = new ManifestDb(cfg.dbPath);

// Fail-loud inverso (#257): un índice con kinds sin productor no se sirve a
// medias — se dice qué hay y qué script lo purga, y se sale con 1. start.sh
// enseña estas líneas en la terminal cuando el hijo muere antes del /health.
const veredicto = verificarKindsConProductor(db, { dbPath: cfg.dbPath, cacheDir: cfg.cacheDir });
if (!veredicto.ok) {
  console.error(veredicto.mensaje);
  db.close();
  process.exit(1);
}

console.log(`asset-store: índice ${cfg.dbPath} (${db.totalCount()} entradas, ${db.totalBytes()} bytes)`);

const server = createAssetStoreServer({
  port: cfg.port,
  db,
  blobDirs: cfg.blobDirs,
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
