/** Lectura de blobs del cache content-addressed + estáticos de style packs.
 *
 *  Replica el CABLE observable de ai_server/routers/cache_assets.py: los
 *  errores de blobs son TEXTO PLANO ("Not found", "Invalid kind", "Invalid
 *  filename"), no JSON — los clientes solo miran el status pero el cuerpo se
 *  preserva igual. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { ASSET_KIND } from "../../src/contracts/asset-store.js";
import { SAFE_ID } from "../../src/games/loader.js";

export interface BlobResult {
  status: number;
  contentType: string;
  body: Buffer;
  /** Hash a tocar (LRU) si el blob se sirvió. */
  touched?: string;
  cacheControl?: string;
}

const text = (status: number, msg: string): BlobResult => ({
  status,
  contentType: "text/plain; charset=utf-8",
  body: Buffer.from(msg, "utf-8"),
});

/** GET /cache/{kind}/{hash}. El único kind con productor es `surface`
 *  (#257): cualquier otro —incluidos los siete que este store sirvió hasta
 *  septiembre de 2026 y `check`, que nunca fue una ruta— es 400 texto plano.
 *  El blob vive en {surfaceDir}/{hash}/surface.png. */
export function readBlob(surfaceDir: string, kind: string, hash: string): BlobResult {
  if (kind !== ASSET_KIND) return text(400, "Invalid kind");
  const path = join(surfaceDir, hash, `${ASSET_KIND}.png`);
  if (!existsSync(path)) return text(404, "Not found");
  return { status: 200, contentType: "image/png", body: readFileSync(path), touched: hash };
}

const SHEET_FRAME_RE = /^dir_\d+_frame_\d{3}\.png$/;

/** GET /cache/sprite_sheet/{hash}/{filename} — almacén paralelo SIN manifest
 *  (deliberado) y sin touch, como hoy. */
export function readSpriteSheetFrame(
  spriteSheetsDir: string,
  hash: string,
  filename: string,
): BlobResult {
  if (!SHEET_FRAME_RE.test(filename)) return text(400, "Invalid filename");
  const path = join(spriteSheetsDir, hash, filename);
  if (!existsSync(path)) return text(404, "Not found");
  return { status: 200, contentType: "image/png", body: readFileSync(path) };
}

/** Los heroes se nombran por su hash de 16 hex (`hero_key` del adaptador de
 *  sprite-forge, ai_server/routers/remote_generation.py). */
const HERO_KEY_RE = /^[0-9a-f]{16}$/;

/** GET /cache/sprite_hero/{key} — hero-shot de identidad del pipeline de
 *  skins (cache/sprite_sheets/heroes/{key}.png): la imagen que fija la cara
 *  del personaje antes de repintar sus frames, y que el cliente reusa como
 *  retrato en el diálogo. Mismo almacén paralelo que los frames: sin
 *  manifest y sin touch, y por tanto FUERA del prune (que solo recorre
 *  surfaceDir) — si algún día los sprite sheets entran en el manifest,
 *  heroes y frames necesitarán pin a la vez. */
export function readSpriteHero(spriteSheetsDir: string, key: string): BlobResult {
  if (!HERO_KEY_RE.test(key)) return text(400, "Invalid filename");
  const path = join(spriteSheetsDir, "heroes", `${key}.png`);
  if (!existsSync(path)) return text(404, "Not found");
  return { status: 200, contentType: "image/png", body: readFileSync(path) };
}

const STYLE_FILE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** GET /styles/{style_id}/{file} — port literal de serveStyleFile del State
 *  API (movido aquí en F2). Errores en JSON ErrorResponse, como emitía el
 *  server Node original. */
export function readStyleFile(
  stylesDir: string,
  styleId: string,
  file: string,
): { status: number; contentType: string; body: Buffer; cacheControl?: string; json?: boolean } {
  const ext = extname(file).toLowerCase();
  const mime = STYLE_FILE_MIME[ext];
  // El file admite UNA subcarpeta (formato de packs por vista:
  // faces/fachada.jpg); cada segmento debe pasar SAFE_ID.
  const segments = file.split("/");
  const safeFile = segments.length <= 2 && segments.every((s) => SAFE_ID.test(s));
  // SAFE_ID admite puntos (".." lo pasa), pero new URL(...) ya normaliza
  // %2e%2e/.. en el pathname antes de llegar aquí — el check de styleId es
  // defensa en profundidad por si el routing cambiara de parser.
  if (!SAFE_ID.test(styleId) || !safeFile || !mime || file.includes("..") || styleId.includes("..")) {
    return {
      status: 400,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ ok: false, error: "expected GET /styles/{style_id}/{file.(jpg|png|webp|json)}" }),
      ),
      json: true,
    };
  }
  const path = join(stylesDir, styleId, file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return {
      status: 404,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ ok: false, error: `style file not found: ${styleId}/${file}` })),
      json: true,
    };
  }
  return {
    status: 200,
    contentType: mime,
    body: readFileSync(path),
    // Las tarjetas del título se re-piden en cada visita; las imágenes de un
    // pack solo cambian al regenerar el estilo.
    cacheControl: "max-age=300",
  };
}
