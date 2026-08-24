"""AI Server: narrative + texture generation for LLM-powered world generation.

Start with: python ai_server/main.py [--port 8765]

Los endpoints viven en routers por dominio (routers/*.py); aquí queda la
carga de entorno/config, el lifespan que puebla `deps`, la app FastAPI y
/health.
"""

import logging
import argparse
from contextlib import asynccontextmanager

from config_snapshot import load_config, load_env_file

load_env_file()

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


class _SilenceHealthcheckFilter(logging.Filter):
    """Drop uvicorn access log entries for noisy polling endpoints."""

    _SILENCED = ("/health", "/backend_status")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(path in msg for path in self._SILENCED)


logging.getLogger("uvicorn.access").addFilter(_SilenceHealthcheckFilter())

from llm_client import LLMClient
from style_packs import StylePackResolver
from asset_store_client import AssetStoreClient

from deps import deps
from routers.asset_proxy import router as asset_proxy_router
from routers.generation import router as generation_router
from routers.narrative import router as narrative_router

logger = logging.getLogger("ai_server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.config = load_config()

    # F2: el índice de assets vive en el asset-store (:8767, SQLite). Este
    # cliente sustituye a AssetManifest con la misma superficie (duck typing:
    # AssetCache.put y llm_client no cambian). El recovery scan y la
    # migración del manifest.json legado son del STORE (services/asset-store/
    # migrate-manifest.ts), no de ai_server.
    deps.asset_manifest = AssetStoreClient()
    logger.info(
        f"AssetStore: {deps.asset_manifest.base_url} "
        f"({deps.asset_manifest.total_count()} entries)"
    )

    deps.llm_client = LLMClient(
        model=deps.config["llm_model"],
        timeout=float(deps.config["llm_timeout_s"]),
        asset_manifest=deps.asset_manifest,
    )

    # F4: los pipelines de APIs de pago viven en remote-gen (:8768). Este
    # proceso solo conserva lo narrativo y la visión — la generación local
    # con GPU se retiró entera con el gpu-worker (#199).
    #
    # Packs de estilo por juego: /develop_world los LISTA para el motor
    # narrativo (narrative.py). Lector FS sin claves — coexiste con la
    # instancia de remote-gen sin conflicto (cache por mtime).
    deps.style_packs = StylePackResolver()

    # Techo de tamaño del cache: el prune corre en el asset-store (LRU con
    # keep-list de world-state). Best-effort aquí — el arranque de ai_server
    # no depende de que el store esté ya arriba.
    max_cache_bytes = int(deps.config["cache_max_bytes"])
    if max_cache_bytes > 0:
        summary = deps.asset_manifest.prune()
        if summary["pruned"] > 0:
            logger.info(
                f"AssetStore: pruned {summary['pruned']} assets "
                f"({summary['freed_bytes'] / 1e6:.1f} MB freed, "
                f"{summary['total_bytes'] / 1e6:.1f} MB remain)"
            )

    logger.info(f"\nAI Server ready. HTTP :{deps.config['port']}")
    yield
    # Cortar el canal MCP ANTES de soltar la referencia: sin esto, el hilo de
    # run_forever(reconnect=5) sigue reconectando a narrative-mcp mientras el
    # proceso drena y compite con el ai_server que lo reemplaza.
    if deps.llm_client is not None:
        deps.llm_client.close()
    deps.llm_client = None
    if deps.remote_gen is not None:
        deps.remote_gen.close()
    deps.remote_gen = None


app = FastAPI(title="NE-Fan AI Server", lifespan=lifespan)

# Allow the HTML client (vite dev server on :3000) to call this server from
# the browser. Without this, every fetch fails the CORS preflight (OPTIONS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers por dominio (importan `deps` directamente, sin ciclos con main).
# asset_proxy reenvía /cache|/assets al asset-store (:8767).
# El repintado, /styles y el toggle /dev/api_cache viven en remote-gen
# (:8768) — sin proxy: sus únicos clientes (HTML) resuelven por serviceUrl.
app.include_router(asset_proxy_router)
app.include_router(generation_router)
app.include_router(narrative_router)


@app.get("/health")
async def health():
    cache_total = deps.asset_manifest.total_bytes() if deps.asset_manifest else 0
    cache_max = int(deps.config.get("cache_max_bytes", 0)) if deps.config else 0
    return {
        "status": "ready" if deps.llm_client else "loading",
        "mode": "narrative",
        "cache_total_bytes": cache_total,
        "cache_max_bytes": cache_max,
        "cache_over_limit": bool(cache_max and cache_total > cache_max),
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="NE-Fan AI Server")
    # Default del snapshot (fuente única de puertos: nefan-core/src/config.ts).
    parser.add_argument("--port", type=int, default=int(load_config()["port"]))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
