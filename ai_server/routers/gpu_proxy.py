"""Proxy transparente de los endpoints GPU → gpu-worker (:8766).

Transitorio de F3 e indefinido para los clientes que NO resuelven URLs por
servicio: Godot (ai_client.gd, texture_cache.gd y model_loader.gd hardcodean
:8765) y el AiClient del bridge (base narrative-llm). Copia método, path,
query, body, status y content-type TAL CUAL — mismo patrón que asset_proxy.

gpu-worker caído → 502 {detail: "gpu-worker unreachable"} (modo de fallo
nuevo e inevitable; informativo en vez de un timeout mudo).
"""
import logging
import os

import httpx
from fastapi import APIRouter, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

GPU_WORKER_URL = (
    os.environ.get("NEFAN_URL_GPU_WORKER") or "http://127.0.0.1:8766"
).rstrip("/")

# Generaciones lentas (texturas ~1 s con pesos cargados pero la PRIMERA carga
# SD tarda ~30 s; un modelo Meshy puede tardar minutos): timeout muy holgado.
_client = httpx.AsyncClient(base_url=GPU_WORKER_URL, timeout=600.0)

_HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "content-length", "host"}

_GPU_ENDPOINTS = (
    "/generate_texture",
    "/generate_model",
    "/generate_skin",
    "/generate_sprite",
)


async def fetch_gpu_worker_health() -> dict | None:
    """GET /health del gpu-worker, best-effort (para /backend_status)."""
    try:
        r = await _client.get("/health", timeout=2.0)
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError):
        return None


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
        logger.error("gpu-worker proxy: %s %s failed: %s", request.method, path, err)
        return Response(
            status_code=502,
            content='{"detail": "gpu-worker unreachable"}',
            media_type="application/json",
        )
    return Response(
        status_code=upstream.status_code,
        content=upstream.content,
        media_type=upstream.headers.get("content-type"),
    )


def _make_handler(path: str):
    async def handler(request: Request) -> Response:
        return await _forward(request, path)
    return handler


for _ep in _GPU_ENDPOINTS:
    router.add_api_route(_ep, _make_handler(_ep), methods=["POST"])
