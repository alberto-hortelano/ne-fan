"""Proxy transparente /cache/* y /assets* → asset-store (:8767).

Transitorio de F2 para los clientes NO migrados a resolveServiceUrl (siguen
yendo a :8765). Copia método, path, query, body, status y content-type TAL
CUAL: los cuerpos de error en texto plano ("Not found", "Invalid kind")
pasan intactos.

Store caído → 502 {detail: "asset-store unreachable"} (modo de fallo nuevo e
inevitable; informativo en vez de un timeout mudo).
"""
import logging
import os

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

_BASE = (
    os.environ.get("NEFAN_URL_ASSET_STORE") or "http://127.0.0.1:8767"
).rstrip("/")

# Blobs de varios MB (escenas ~3 MB): timeout holgado, cliente compartido.
_client = httpx.AsyncClient(base_url=_BASE, timeout=30.0)

_HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "host"}


async def _forward(request: Request, path: str) -> Response:
    body = await request.body()
    try:
        upstream = await _client.request(
            request.method,
            path,
            params=request.query_params,
            content=body if body else None,
            headers={
                k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP
            },
        )
    except httpx.HTTPError as err:
        logger.error("asset-store proxy: %s %s failed: %s", request.method, path, err)
        return Response(
            status_code=502,
            content='{"detail": "asset-store unreachable"}',
            media_type="application/json",
        )
    return Response(
        status_code=upstream.status_code,
        content=upstream.content,
        media_type=upstream.headers.get("content-type"),
        headers={
            k: v
            for k, v in upstream.headers.items()
            if k.lower() in ("cache-control",)
        },
    )


@router.api_route("/cache/{path:path}", methods=["GET", "POST"])
async def proxy_cache(request: Request, path: str) -> Response:
    return await _forward(request, f"/cache/{path}")


@router.api_route("/assets/{path:path}", methods=["GET"])
async def proxy_assets_sub(request: Request, path: str) -> Response:
    return await _forward(request, f"/assets/{path}")


@router.api_route("/assets", methods=["GET", "POST"])
async def proxy_assets(request: Request) -> Response:
    return await _forward(request, "/assets")
