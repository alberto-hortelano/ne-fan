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
  /** Índice SQLite (`cache/manifest.sqlite3`), o el que diga `NEFAN_MANIFEST_DB`. */
  dbPath: string;
  /** Raíz de blobs del ÚNICO kind con productor (`surface`): {dir}/{hash}/surface.png.
   *  Es un string y no un mapa por kind a propósito (#257): añadir un kind al
   *  manifest exige tocar esta firma, `AssetKind` y el zod del registro, no
   *  añadir una línea a una tabla. */
  surfaceDir: string;
  /** Almacén paralelo de sprite sheets skineados (sin manifest, a propósito). */
  spriteSheetsDir: string;
  /** Raíz de `cache/`: la que nombra el fail-loud del arranque al decir qué
   *  archivar, para que índice y almacén se lean juntos (`solo-surface.ts`). */
  cacheDir: string;
  /** Style packs binarios (movidos desde world-state en F2). */
  stylesDir: string;
  /** Techo del prune LRU; <= 0 = sin límite (prune → 400). */
  cacheMaxBytes: number;
}

/** Variable que desplaza el índice del checkout a otro fichero (#391). */
export const ENV_MANIFEST_DB = "NEFAN_MANIFEST_DB";

/** El índice a abrir: `NEFAN_MANIFEST_DB` si está, y si no el del snapshot.
 *
 *  POR QUÉ EXISTE. El único camino de fallo del arranque del asset-store
 *  —negarse a servir un índice con kinds sin productor (`solo-surface.ts`)—
 *  no se podía ejercer sin la DB del checkout: el QA de T4 exportó el árbol
 *  entero a un temporal para plantar la fila ajena y arrancar desde allí. Ese
 *  workaround ES el defecto, y con esta variable el negativo se prueba contra
 *  una DB de usar y tirar (`test/asset-store-server.test.ts`).
 *
 *  Una ruta absoluta pasa intacta; una relativa se resuelve contra la raíz del
 *  repo, igual que las del snapshot. Precedente de nombre y forma:
 *  `NEFAN_GAMES_DIR` / `NEFAN_SAVES_DIR` (`bridge/ws-server.ts`).
 *
 *  Un valor presente pero EN BLANCO no es «sin override»: es una variable mal
 *  puesta, y sin esta guarda (medido) pasan dos cosas malas y distintas —
 *  `""` resuelve a la RAÍZ del repo y muere con «unable to open database
 *  file», que no nombra la causa; `"  "` crea un fichero llamado dos espacios
 *  en la raíz del repo y el store ARRANCA sobre ese índice vacío, callado.
 *  Lo segundo es justo lo que esta variable existe para evitar: servir un
 *  índice que no es el que se pidió.
 *
 *  Es TS-only a propósito: `data/runtime_config.json` es el snapshot para los
 *  servicios que no son TS y `manifest_db` no lo lee ninguno, así que
 *  `start.sh` no tiene que saber nada de esto. */
function rutaDelIndice(env: Record<string, string | undefined>, porDefecto: string): string {
  const crudo = env[ENV_MANIFEST_DB];
  if (crudo !== undefined && crudo.trim() === "") {
    throw new Error(`${ENV_MANIFEST_DB} está puesta pero vacía: quítala o dale la ruta del índice`);
  }
  return crudo ?? porDefecto;
}

export function loadAssetStoreConfig(env: Record<string, string | undefined> = {}): AssetStoreConfig {
  const abs = (p: string): string => resolve(REPO_ROOT, p);
  const ai = CONFIG.ai_server;
  return {
    port: Number(env.NEFAN_ASSET_STORE_PORT ?? CONFIG.ports.asset_store),
    dbPath: abs(rutaDelIndice(env, ai.manifest_db)),
    surfaceDir: abs(ai.surface_cache_dir),
    spriteSheetsDir: abs(`${ai.cache_root}/sprite_sheets`),
    cacheDir: abs(ai.cache_root),
    stylesDir: abs(CONFIG.content.styles_dir),
    cacheMaxBytes: ai.cache_max_bytes,
  };
}
