/** Config del asset-store (S6). Reusa las claves de CONFIG (fuente única,
 *  snapshot en data/runtime_config.json para los servicios no-TS): puertos,
 *  directorios de cache del bloque ai_server y styles_dir de content. Todas
 *  las rutas del snapshot son relativas a la RAÍZ del repo; aquí se resuelven
 *  a absolutas para que el servicio funcione con cualquier cwd. */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "../../src/config.js";

/** nefan-core/services/asset-store → tres niveles arriba = raíz del repo. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface AssetStoreConfig {
  port: number;
  /** Índice SQLite (cache/manifest.sqlite3). */
  dbPath: string;
  /** manifest.json legado — SOLO lo lee la migración one-shot. */
  manifestJsonPath: string;
  /** asset_type → directorio raíz de blobs de ese cache ({dir}/{hash}/...).
   *  Espejo de _cache_dirs_by_type() del ai_server Python. */
  dirsByType: Record<string, string>;
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
    manifestJsonPath: abs(`${ai.cache_root}/manifest.json`),
    dirsByType: {
      texture: abs(ai.texture_cache_dir),
      model: abs(ai.model_cache_dir),
      skin: abs(ai.skin_cache_dir),
      sprite: abs(ai.sprite_cache_dir),
      scene: abs(ai.scene_cache_dir),
      segment: abs(ai.segment_cache_dir),
    },
    spriteSheetsDir: abs(`${ai.cache_root}/sprite_sheets`),
    stylesDir: abs(CONFIG.content.styles_dir),
    cacheMaxBytes: ai.cache_max_bytes,
  };
}
