/** Servidor HTTP del asset-store (S6) — implementa AssetStoreApi
 *  (src/contracts/asset-store.ts) replicando el cable observable del router
 *  FastAPI original (cache_assets.py). Desde #257 el índice y el lector de
 *  blobs solo conocen el kind `surface`: `GET /cache/{otro}/{hash}` es 400 y
 *  `POST /assets` con otro type no pasa el zod.
 *
 *  Desviaciones anunciadas (header del contrato): los endpoints JSON emiten
 *  `ErrorResponse` {ok:false,error} en vez del {detail} de FastAPI; un
 *  `limit` no numérico en /assets es 400 (antes 422 de Pydantic). Los cuerpos
 *  de error de blobs siguen siendo texto plano byte a byte. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

import type { ErrorResponse } from "../../src/contracts/common.js";
import type {
  AssetByHashResponse,
  AssetListResponse,
  AssetPinResponse,
  AssetRegisterResponse,
  AssetUnpinResponse,
  CachePruneResponse,
} from "../../src/contracts/asset-store.js";
import {
  AssetPinRequestSchema,
  AssetRegisterRequestSchema,
} from "../../src/contracts/request-schemas.js";
import { formatZodError } from "../../src/contract/model-io/validate.js";
import type { ManifestDb } from "./manifest-db.js";
import { readBlob, readSpriteHero, readSpriteSheetFrame, readStyleFile } from "./blob-store.js";
// El cable de la ruta de estilos vive aparte porque lo COMPARTE el motor falso
// del bench (labs/narrative/fake-ai-server.ts), que antes lo copiaba a mano y
// se desviaba en cuatro casos (#280). Aquí no cambia nada observable: son las
// mismas líneas, en un sitio donde se pueden importar.
import { matchStylesRoute, parseRequestPath, writeBlob } from "./http-wire.js";
import { fetchKeepList, prune } from "./prune.js";

export interface AssetStoreServerOptions {
  port: number;
  db: ManifestDb;
  /** Raíz de blobs de `surface` — ver AssetStoreConfig.surfaceDir. */
  surfaceDir: string;
  spriteSheetsDir: string;
  stylesDir: string;
  cacheMaxBytes: number;
  /** Base del world-state para la keep-list del prune (resolveServiceUrl). */
  worldStateUrl: string;
}

const MAX_BODY_BYTES = 256 * 1024;

export interface AssetStoreHealthResponse {
  ok: true;
  total_count: number;
  total_bytes: number;
}

export function createAssetStoreServer(opts: AssetStoreServerOptions): Server {
  const server = createServer((req, res) => {
    // Espejo del CORSMiddleware(allow_origins=["*"]) de los FastAPI del
    // stack: el cliente corre en localhost:3000 y pide los blobs con
    // crossOrigin="anonymous" (necesita acceso a píxeles — sin la cabecera,
    // Chrome bloquea la respuesta y el decode() revienta en EncodingError).
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        // DELETE: unpin del batch de estilos desde el navegador (/assets/pin/{ref}).
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }
    void handle(req, res, opts).catch((err) => {
      sendJson(res, 500, { ok: false, error: String((err as Error)?.message ?? err) } satisfies ErrorResponse);
    });
  });
  server.listen(opts.port, "127.0.0.1", () => {
    console.log(`NEFan asset-store listening on http://127.0.0.1:${opts.port}`);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AssetStoreServerOptions,
): Promise<void> {
  const { db } = opts;
  const { path, parts, query } = parseRequestPath(req.url);
  const method = req.method ?? "GET";

  // ── GET /health (nuevo, aditivo — probe del launcher y del ai_server) ──
  if (method === "GET" && path === "/health") {
    sendJson(res, 200, {
      ok: true,
      total_count: db.totalCount(),
      total_bytes: db.totalBytes(),
    } satisfies AssetStoreHealthResponse);
    return;
  }

  // ── POST /cache/prune ──
  if (method === "POST" && path === "/cache/prune") {
    if (opts.cacheMaxBytes <= 0) {
      sendJson(res, 400, {
        ok: false,
        error: "cache_max_bytes is 0 (no limit configured)",
      } satisfies ErrorResponse);
      return;
    }
    const keepRes = await fetchKeepList(opts.worldStateUrl);
    if (!keepRes.ok) {
      // Sin keep-list no se puede saber qué assets referencian los saves; los
      // saves post-F2 referencian por hash, así que podar sin ella borraría
      // assets en uso (resume con texturas rotas). Se ABORTA en vez de podar
      // a ciegas — mejor no liberar espacio que corromper una partida. La
      // causa real (timeout, DNS, 500, JSON corrupto) viaja al log Y al 503:
      // quien depura el prune no tiene otra traza.
      console.warn(`asset-store prune: keep-list no disponible (${keepRes.error}) — prune ABORTADO`);
      sendJson(res, 503, {
        ok: false,
        error: `keep-list unavailable (${keepRes.error}): prune aborted to avoid deleting in-use assets`,
      } satisfies ErrorResponse);
      return;
    }
    const keep = keepRes.keep;
    // Protegidos = referenciados por saves vivos ∪ pineados (aplicaciones de
    // estilo a juegos: assets pre-generados sin save que los referencie aún).
    for (const h of db.pinnedHashes()) keep.add(h);
    const summary = prune(db, opts.surfaceDir, opts.cacheMaxBytes, keep);
    sendJson(res, 200, { ok: true, ...summary } satisfies CachePruneResponse);
    return;
  }

  // ── POST /assets/pin · DELETE /assets/pin/{ref} ──
  if (method === "POST" && path === "/assets/pin") {
    const parsed = AssetPinRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      sendJson(res, 400, { ok: false, error: formatZodError(parsed.error) } satisfies ErrorResponse);
      return;
    }
    db.pin(parsed.data.ref, parsed.data.hashes);
    sendJson(res, 200, {
      ok: true,
      ref: parsed.data.ref,
      pinned: parsed.data.hashes.length,
    } satisfies AssetPinResponse);
    return;
  }
  if (method === "DELETE" && parts[0] === "assets" && parts[1] === "pin" && parts.length === 3) {
    const ref = decodeURIComponent(parts[2]);
    const removed = db.unpin(ref);
    sendJson(res, 200, { ok: true, ref, removed } satisfies AssetUnpinResponse);
    return;
  }

  // ── GET /cache/sprite_hero/{key} ──
  // Antes del catch-all de /cache/{kind}/{hash}: tiene tres segmentos y
  // caería ahí como un "kind" inexistente.
  if (method === "GET" && parts[0] === "cache" && parts[1] === "sprite_hero" && parts.length === 3) {
    writeBlob(res, readSpriteHero(opts.spriteSheetsDir, parts[2]));
    return;
  }

  // ── GET /cache/sprite_sheet/{hash}/{filename} ──
  if (method === "GET" && parts[0] === "cache" && parts[1] === "sprite_sheet" && parts.length === 4) {
    writeBlob(res, readSpriteSheetFrame(opts.spriteSheetsDir, parts[2], parts[3]));
    return;
  }

  // ── GET /assets ──
  if (method === "GET" && path === "/assets") {
    const assetType = query.get("asset_type") ?? undefined;
    const rawLimit = query.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      sendJson(res, 400, { ok: false, error: `invalid limit "${rawLimit}"` } satisfies ErrorResponse);
      return;
    }
    sendJson(res, 200, {
      assets: db.listAssets(assetType, limit),
      total: db.totalCount(),
    } satisfies AssetListResponse);
    return;
  }

  // ── GET /assets/by_hash/{hash} ──
  if (method === "GET" && parts[0] === "assets" && parts[1] === "by_hash" && parts.length === 3) {
    const hash = parts[2];
    const matches = db.findByHash(hash);
    if (matches.length === 0) {
      // 404 TEXTO PLANO, como el Response(content="Not found") de FastAPI.
      sendText(res, 404, "Not found");
      return;
    }
    db.touch(hash);
    // Un solo kind, una sola forma de URL: el arranque garantiza que no hay
    // filas de otro type (solo-surface.ts), así que no hay cascada que hacer.
    const enriched = matches.map((m) => ({ ...m, cache_url: `/cache/${m.type}/${hash}` }));
    sendJson(res, 200, { matches: enriched } satisfies AssetByHashResponse);
    return;
  }

  // ── POST /assets (registro remoto — sustituye la escritura in-process) ──
  if (method === "POST" && path === "/assets") {
    // Borde de entrada: espejo zod del contrato (request-schemas.ts, con
    // guardia de deriva) en vez del predicado a mano.
    const parsed = AssetRegisterRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      sendJson(res, 400, {
        ok: false,
        error: `body requires { hash, type, subtype, prompt, size_bytes, extra? } — ${formatZodError(parsed.error)}`,
      } satisfies ErrorResponse);
      return;
    }
    // created_at lo estampa el store (como _now() en register()); duplicado
    // (mismo hash+type+subtype) = éxito idempotente, igual que el return
    // silencioso del Python. NO se verifica el blob en disco: hay entradas
    // legítimas sin blob propio (analysis, bbox legadas).
    db.register(parsed.data);
    sendJson(res, 200, { ok: true } satisfies AssetRegisterResponse);
    return;
  }

  // ── GET /cache/{kind}/{hash} — solo kind=surface; el resto 400 (blob-store.ts) ──
  if (method === "GET" && parts[0] === "cache" && parts.length === 3) {
    const result = readBlob(opts.surfaceDir, parts[1], parts[2]);
    if (result.touched) db.touch(result.touched);
    writeBlob(res, result);
    return;
  }

  // ── GET /styles/{style_id}/{file} (movido desde world-state en F2). El
  //    file admite una subcarpeta de rol (faces/fachada.jpg) ──
  const estilo = matchStylesRoute(method, parts);
  if (estilo) {
    writeBlob(res, readStyleFile(opts.stylesDir, estilo.styleId, estilo.file));
    return;
  }

  sendJson(res, 404, { ok: false, error: `no route for ${method} ${path}` } satisfies ErrorResponse);
}

// ── Helpers ──

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, msg: string): void {
  const payload = Buffer.from(msg, "utf-8");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": payload.byteLength,
  });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
