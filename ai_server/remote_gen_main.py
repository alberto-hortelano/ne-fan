"""Remote-Gen (S5, :8768): adaptador de APIs de pago fuera de narrative-llm.

Start with: python ai_server/remote_gen_main.py [--port 8768]

Sirve el repintado de escenas/platós (Meshy i2i / fal gpt-image-2,
routers/remote_generation.py), los sprite sheets skinneados, los style packs
(routers/styles.py), la segmentación SAM2 (/segment — la única llamada fal
SAM del stack, consumida por narrative-llm) y el toggle del DEV_API_CACHE
(GET/POST /dev/api_cache — el flag lo ven los otros procesos releyendo
state.json). Sin GPU local y sin estado: escala por concurrencia HTTP
(latencias 30-300 s por llamada remota).
"""

import argparse
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from config_snapshot import load_config, load_env_file, load_port

load_env_file()

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


class _SilenceHealthcheckFilter(logging.Filter):
    """Drop uvicorn access log entries for noisy polling endpoints."""

    _SILENCED = ("/health",)

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(path in msg for path in self._SILENCED)


logging.getLogger("uvicorn.access").addFilter(_SilenceHealthcheckFilter())

from asset_cache import AssetCache
from asset_store_client import AssetStoreClient
from deps import deps
from routers.cache_assets import router as cache_assets_router
from routers.remote_generation import router as remote_generation_router
from routers.segment import router as segment_router
from routers.styles import router as styles_router

logger = logging.getLogger("ai_server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from fal_client import FalSamClient
    from scene_image_generator import SceneImageGenerator
    from style_packs import StylePackResolver

    deps.config = load_config()

    deps.asset_manifest = AssetStoreClient()
    logger.info(
        f"AssetStore: {deps.asset_manifest.base_url} "
        f"({deps.asset_manifest.total_count()} entries)"
    )

    # Compartir cache/scenes con narrative-llm/gpu-worker es seguro: escritura
    # atómica (tmp+replace) y registro por POST /assets — cero estado en RAM.
    deps.scene_cache = AssetCache(
        cache_dir=deps.config["scene_cache_dir"],
        asset_type="scene",
        manifest=deps.asset_manifest,
    )

    # Librería de superficies de la vista fps: cada celda es un asset
    # reutilizable entre escenas (hash por descripción+estilo).
    deps.surface_cache = AssetCache(
        cache_dir=deps.config["surface_cache_dir"],
        asset_type="surface",
        manifest=deps.asset_manifest,
    )
    from surface_atlas_generator import SurfaceAtlasGenerator

    deps.surface_atlas_gen = SurfaceAtlasGenerator(
        model=deps.config["surface_model"],
        hero_model=deps.config["surface_hero_model"],
    )

    _repo_root = Path(__file__).resolve().parent.parent
    deps.scene_image_gen = SceneImageGenerator(
        style_image_path=str(_repo_root / deps.config["scene_style_image"]),
        model=deps.config["scene_model"],
    )
    # Packs de estilo por juego (imágenes de referencia por categoría).
    # Degradación esperable si aún no hay packs: resolve() devuelve None y las
    # peticiones usan la referencia global de arriba.
    deps.style_packs = StylePackResolver()

    # /segment es OPCIONAL: necesita FAL_KEY. Sin ella el server arranca
    # igual y el endpoint devuelve 503 (narrative-llm lo reporta en su 503).
    try:
        deps.fal_sam = FalSamClient(
            auto_segment_model=deps.config["auto_segment_model"],
        )
    except ValueError as e:
        deps.fal_sam = None
        logger.info(f"/segment disabled: {e} (set FAL_KEY in .env to enable)")

    # sprite_skin_gen sigue siendo lazy: se construye en el primer
    # /skin_sprite_sheet (necesita MESHY_API_KEY; sin ella, 503 ahí).

    logger.info(f"\nRemote-Gen ready. HTTP :{load_port('remote_gen')}")
    yield
    if deps.asset_manifest is not None:
        deps.asset_manifest.close()


app = FastAPI(title="NE-Fan Remote-Gen", lifespan=lifespan)

# El cliente 2D (vite :3000) le habla DIRECTO desde el navegador (repintados,
# sheets, styles, toggle dev). Sin CORS todo fetch muere en el preflight.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(remote_generation_router)
app.include_router(styles_router)
app.include_router(segment_router)
app.include_router(cache_assets_router)


@app.get("/health")
async def health():
    return {
        "status": "ready" if deps.scene_image_gen else "loading",
        "segment_available": deps.fal_sam is not None,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="NE-Fan Remote-Gen")
    # Default del snapshot (fuente única de puertos: nefan-core/src/config.ts).
    parser.add_argument("--port", type=int, default=load_port("remote_gen"))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
