/** Servidor HTTP del asset-store (S6) — implementa AssetStoreApi
 *  (src/contracts/asset-store.ts) replicando el cable observable del router
 *  FastAPI original (cache_assets.py), incluido el ORDEN de matching:
 *  /cache/{kind}/{hash} captura kind="check" ANTES de que ninguna ruta
 *  /cache/check exista → 400 "Invalid map type" (ruta muerta preservada).
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
  AssetRegisterRequest,
  AssetRegisterResponse,
  CachePruneResponse,
} from "../../src/contracts/asset-store.js";
import type { ManifestDb } from "./manifest-db.js";
import { readBlob, readSpriteSheetFrame, readStyleFile, type BlobResult } from "./blob-store.js";
import { fetchKeepList, prune } from "./prune.js";

export interface AssetStoreServerOptions {
  port: number;
  db: ManifestDb;
  dirsByType: Record<string, string>;
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
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const parts = path.split("/").filter(Boolean);

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
    const keep = await fetchKeepList(opts.worldStateUrl);
    if (keep === null) {
      console.warn(
        "asset-store prune: world-state sin respuesta — prune SIN keep-list (status quo pre-F2)",
      );
    }
    const summary = prune(db, opts.dirsByType, opts.cacheMaxBytes, keep);
    sendJson(res, 200, { ok: true, ...summary } satisfies CachePruneResponse);
    return;
  }

  // ── GET /cache/sprite_sheet/{hash}/{filename} ──
  if (method === "GET" && parts[0] === "cache" && parts[1] === "sprite_sheet" && parts.length === 4) {
    sendBlob(res, readSpriteSheetFrame(opts.spriteSheetsDir, parts[2], parts[3]));
    return;
  }

  // ── GET /assets ──
  if (method === "GET" && path === "/assets") {
    const assetType = url.searchParams.get("asset_type") ?? undefined;
    const rawLimit = url.searchParams.get("limit");
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
    const enriched = matches.map((m) => {
      const cacheUrl =
        m.type === "texture"
          ? `/cache/${m.subtype}/${hash}`
          : m.type === "model" || m.type === "skin" || m.type === "sprite"
            ? `/cache/${m.type}/${hash}`
            : undefined;
      // scene/segment (y subtypes huérfanos) van SIN cache_url, como hoy.
      return cacheUrl === undefined ? m : { ...m, cache_url: cacheUrl };
    });
    sendJson(res, 200, { matches: enriched } satisfies AssetByHashResponse);
    return;
  }

  // ── POST /assets (registro remoto — sustituye la escritura in-process) ──
  if (method === "POST" && path === "/assets") {
    const body = (await readJson(req)) as Partial<AssetRegisterRequest> | undefined;
    const invalid =
      !body ||
      typeof body.hash !== "string" ||
      !body.hash ||
      typeof body.type !== "string" ||
      !body.type ||
      typeof body.subtype !== "string" ||
      !body.subtype ||
      typeof body.prompt !== "string" ||
      typeof body.size_bytes !== "number" ||
      body.size_bytes < 0 ||
      (body.extra !== undefined && (typeof body.extra !== "object" || body.extra === null));
    if (invalid) {
      sendJson(res, 400, {
        ok: false,
        error: "body requires { hash, type, subtype, prompt, size_bytes, extra? }",
      } satisfies ErrorResponse);
      return;
    }
    // created_at lo estampa el store (como _now() en register()); duplicado
    // (mismo hash+type+subtype) = éxito idempotente, igual que el return
    // silencioso del Python. NO se verifica el blob en disco: hay entradas
    // legítimas sin blob propio (analysis, bbox legadas).
    db.register({
      hash: body.hash!,
      type: body.type!,
      subtype: body.subtype!,
      prompt: body.prompt!,
      size_bytes: body.size_bytes!,
      extra: body.extra as Record<string, unknown> | undefined,
    });
    sendJson(res, 200, { ok: true } satisfies AssetRegisterResponse);
    return;
  }

  // ── GET /cache/{kind}/{hash} — cascada específicas→catch-all (captura
  //    también kind="check": ruta muerta preservada, ver blob-store.ts) ──
  if (method === "GET" && parts[0] === "cache" && parts.length === 3) {
    const result = readBlob(opts.dirsByType, parts[1], parts[2]);
    if (result.touched) db.touch(result.touched);
    sendBlob(res, result);
    return;
  }

  // ── GET /styles/{style_id}/{file} (movido desde world-state en F2) ──
  if (method === "GET" && parts[0] === "styles" && parts.length === 3) {
    const r = readStyleFile(opts.stylesDir, parts[1], parts[2]);
    res.writeHead(r.status, {
      "Content-Type": r.contentType,
      "Content-Length": r.body.byteLength,
      ...(r.cacheControl ? { "Cache-Control": r.cacheControl } : {}),
    });
    res.end(r.body);
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

function sendBlob(res: ServerResponse, r: BlobResult): void {
  res.writeHead(r.status, {
    "Content-Type": r.contentType,
    "Content-Length": r.body.byteLength,
    ...(r.cacheControl ? { "Cache-Control": r.cacheControl } : {}),
  });
  res.end(r.body);
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
