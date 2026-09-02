/** Config del asset-store (S6). Reusa las claves de CONFIG (fuente única,
 *  snapshot en data/runtime_config.json para los servicios no-TS): puertos,
 *  el directorio de superficies del bloque ai_server y styles_dir de content.
 *  Todas las rutas del snapshot son relativas a la RAÍZ del repo; aquí se
 *  resuelven a absolutas para que el servicio funcione con cualquier cwd. */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "../../src/config.js";

/** nefan-core/services/asset-store → tres niveles arriba = raíz del repo. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface AssetStoreConfig {
  port: number;
  /** Índice SQLite (cache/manifest.sqlite3). */
  dbPath: string;
  /** Raíz de blobs del ÚNICO kind con productor (`surface`): {dir}/{hash}/surface.png.
   *  Es un string y no un mapa por kind a propósito (#257): añadir un kind al
   *  manifest exige tocar esta firma, `AssetKind` y el zod del registro, no
   *  añadir una línea a una tabla. */
  surfaceDir: string;
  /** Almacén paralelo de sprite sheets skineados (sin manifest, a propósito). */
  spriteSheetsDir: string;
  /** Style packs binarios (movidos desde world-state en F2). */
  stylesDir: string;
  /** Techo del prune LRU; <= 0 = sin límite (prune → 400). */
  cacheMaxBytes: number;
}

export function loadAssetStoreConfig(env: Record<string, string | undefined> = {}): AssetStoreConfig {
  const abs = (p: string): string => resolve(REPO_ROOT, p);
  const ai = CONFIG.ai_server;
  return {
    port: Number(env.NEFAN_ASSET_STORE_PORT ?? CONFIG.ports.asset_store),
    dbPath: abs(ai.manifest_db),
    surfaceDir: abs(ai.surface_cache_dir),
    spriteSheetsDir: abs(`${ai.cache_root}/sprite_sheets`),
    stylesDir: abs(CONFIG.content.styles_dir),
    cacheMaxBytes: ai.cache_max_bytes,
  };
}
