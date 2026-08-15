/** Lectura de blobs del cache content-addressed + estáticos de style packs.
 *
 *  Replica el CABLE observable de ai_server/routers/cache_assets.py: los
 *  errores de blobs son TEXTO PLANO ("Not found", "Invalid map type",
 *  "Invalid filename"), no JSON — los clientes solo miran el status pero el
 *  cuerpo se preserva igual. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

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

/** kind → [asset_type (dir), filename, content-type]. Espejo de la cascada
 *  específicas→catch-all del router FastAPI (plate sale del cache de scene;
 *  model es GLB; el catch-all solo admite mapas de textura). */
const KIND_TABLE: Record<string, { type: string; filename: string; contentType: string }> = {
  sprite: { type: "sprite", filename: "sprite.png", contentType: "image/png" },
  skin: { type: "skin", filename: "skin.png", contentType: "image/png" },
  scene: { type: "scene", filename: "scene.png", contentType: "image/png" },
  plate: { type: "scene", filename: "plate.png", contentType: "image/png" },
  segment: { type: "segment", filename: "segment.png", contentType: "image/png" },
  model: { type: "model", filename: "model.glb", contentType: "model/gltf-binary" },
  surface: { type: "surface", filename: "surface.png", contentType: "image/png" },
};

const TEXTURE_MAPS = new Set(["albedo", "normal", "roughness"]);

/** GET /cache/{kind}/{hash}. OJO: kind="check" cae aquí a propósito — en
 *  FastAPI /cache/{map_type}/{hash} se registra ANTES que /cache/check/{hash},
 *  así que /cache/check/{h} SIEMPRE respondió 400 "Invalid map type". Contrato
 *  observable preservado (ver checkHash en contracts/asset-store.ts). */
export function readBlob(
  dirsByType: Record<string, string>,
  kind: string,
  hash: string,
): BlobResult {
  let type: string;
  let filename: string;
  let contentType: string;
  const known = KIND_TABLE[kind];
  if (known) {
    ({ type, filename, contentType } = known);
  } else if (TEXTURE_MAPS.has(kind)) {
    type = "texture";
    filename = `${kind}.png`;
    contentType = "image/png";
  } else {
    return text(400, "Invalid map type");
  }
  const root = dirsByType[type];
  const path = root ? join(root, hash, filename) : "";
  if (!path || !existsSync(path)) return text(404, "Not found");
  return { status: 200, contentType, body: readFileSync(path), touched: hash };
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
  const safeFile = SAFE_ID.test(file); // sin "/": solo [A-Za-z0-9_.-]
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
