/** Servidor HTTP del asset-store (S6) — el TRANSPORTE de AssetStoreApi
 *  (src/contracts/asset-store.ts), replicando el cable observable del router
 *  FastAPI original (cache_assets.py). Aquí vive solo lo que toca el socket:
 *  el CORS, leer el cuerpo y escribir la respuesta. Qué endpoint contesta una
 *  URL lo decide `casarRuta` (http-wire.ts) sobre el contrato, y qué contesta
 *  cada uno, la tabla de `rutas.ts`.
 *
 *  Desviaciones anunciadas (header del contrato): los endpoints JSON emiten
 *  `ErrorResponse` {ok:false,error} en vez del {detail} de FastAPI; un
 *  `limit` no numérico en /assets es 400 (antes 422 de Pydantic). Los cuerpos
 *  de error de blobs siguen siendo texto plano byte a byte. */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { ErrorResponse } from "../../src/contracts/common.js";
import { AssetStoreApi } from "../../src/contracts/asset-store.js";
// El cable de la ruta vive aparte porque lo COMPARTE el motor falso del bench
// (labs/narrative/fake-ai-server.ts), que antes lo copiaba a mano y se
// desviaba en cuatro casos (#280).
import { casarRuta, parseRequestPath, writeBlob } from "./http-wire.js";
import { RUTAS, type AssetRouteResult, type AssetStoreServerOptions } from "./rutas.js";

export type { AssetStoreServerOptions } from "./rutas.js";

const MAX_BODY_BYTES = 256 * 1024;

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
    // El puerto REAL, no el pedido: con `port: 0` el kernel elige uno y
    // `opts.port` sigue siendo 0, así que la línea anunciaba una URL que no
    // era llamable (medido por QA: escuchaba en 33029 y decía `:0`). Quien
    // lee el log —una persona, un guion de QA, el hijo de un bench— solo
    // tiene esta línea para saber a dónde llamar.
    const escucha = server.address() as AddressInfo | null;
    console.log(`NEFan asset-store listening on http://127.0.0.1:${escucha?.port ?? opts.port}`);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AssetStoreServerOptions,
): Promise<void> {
  const pedido = parseRequestPath(req.url);
  const method = req.method ?? "GET";
  const match = casarRuta(AssetStoreApi, method, pedido);
  if (!match) {
    sendJson(res, 404, { ok: false, error: `no route for ${method} ${pedido.path}` } satisfies ErrorResponse);
    return;
  }
  const result = await RUTAS[match.key](opts, {
    params: match.params,
    query: pedido.query,
    readBody: () => readJson(req),
  });
  emitir(res, result);
}

function emitir(res: ServerResponse, r: AssetRouteResult): void {
  if (r.kind === "blob") writeBlob(res, r.blob);
  else if (r.kind === "text") sendText(res, r.status, r.body);
  else sendJson(res, r.status, r.body);
}

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
