"""AI Server: narrative + texture generation for LLM-powered world generation.

Start with: python ai_server/main.py [--port 8765]

Los endpoints viven en routers por dominio (routers/*.py); aquí queda la
carga de entorno/config, el lifespan que puebla `deps`, la app FastAPI y
/health.
"""

import json
import logging
import os
import argparse
from pathlib import Path
from contextlib import asynccontextmanager


def _load_env_file(env_path: Path) -> None:
    """Load .env file into os.environ (simple parser, no python-dotenv dependency)."""
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_env_file = Path(__file__).resolve().parent.parent / ".env"
_load_env_file(_env_file)

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
from texture_generator import TextureGenerator
from model_generator import ModelGenerator
from skin_generator import SkinGenerator
from plate_inpainter import PlateInpainter
from sprite_generator import SpriteGenerator
from controlnet_skin import ControlNetSkinGenerator
from scene_image_generator import SceneImageGenerator
from style_packs import StylePackResolver
from fal_client import FalSamClient
from scene_segmenter import SceneSegmenter
from asset_cache import AssetCache, AssetManifest
from asset_paths import SPRITE_SHEETS_DIR

from deps import deps
from routers.cache_assets import _cache_dirs_by_type
from routers.cache_assets import router as cache_assets_router
from routers.generation import router as generation_router
from routers.narrative import router as narrative_router
from routers.styles import router as styles_router

logger = logging.getLogger("ai_server")


RUNTIME_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "nefan-core" / "data" / "runtime_config.json"
)


def load_config(config_path: Path | None = None) -> dict:
    """Read the snapshot produced by `nefan-core/scripts/dump-config.ts`.

    Fail-loud: a missing file or a missing `ai_server` block is a hard error.
    Regenerate the snapshot via `cd nefan-core && npx tsx scripts/dump-config.ts`
    (or any `npm run build/dev/test` which triggers the pre-hook)."""
    path = Path(config_path) if config_path else RUNTIME_CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"runtime_config.json not found at {path}. "
            "Run `cd nefan-core && npx tsx scripts/dump-config.ts` to regenerate it."
        )
    logger.info(f"Config loaded from: {path}")
    with open(path) as f:
        full = json.load(f)
    ai = full.get("ai_server")
    if not isinstance(ai, dict):
        raise ValueError(
            f"{path} has no `ai_server` block. Update nefan-core/src/config.ts."
        )
    return ai


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.config = load_config()

    # Shared manifest sits at the cache root and tracks every asset across types.
    from pathlib import Path as _P
    cache_root = _P(deps.config["cache_root"])
    manifest_path = cache_root / "manifest.json"
    deps.asset_manifest = AssetManifest(manifest_path)
    logger.info(f"AssetManifest: {manifest_path.resolve()} ({deps.asset_manifest.total_count()} entries)")

    # First-run recovery: scan existing cache directories so previously generated
    # assets become discoverable to the narrative engine.
    if deps.asset_manifest.total_count() == 0:
        added_total = 0
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "textures",
            asset_type="texture",
            subtypes_by_filename={"albedo.png": "albedo", "normal.png": "normal", "roughness.png": "roughness"},
        )
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "models",
            asset_type="model",
            subtypes_by_filename={"model.glb": "model"},
        )
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "skins",
            asset_type="skin",
            subtypes_by_filename={"skin.png": "skin"},
        )
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "sprites",
            asset_type="sprite",
            subtypes_by_filename={"sprite.png": "sprite"},
        )
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "scenes",
            asset_type="scene",
            subtypes_by_filename={"scene.png": "scene"},
        )
        added_total += deps.asset_manifest.scan_directory(
            cache_root / "segments",
            asset_type="segment",
            subtypes_by_filename={"segment.png": "segment"},
        )
        if added_total > 0:
            logger.info(f"AssetManifest: recovered {added_total} pre-existing assets")

    deps.llm_client = LLMClient(
        model=deps.config["llm_model"],
        timeout=float(deps.config["llm_timeout_s"]),
        asset_manifest=deps.asset_manifest,
    )

    deps.asset_cache = AssetCache(
        cache_dir=deps.config["texture_cache_dir"],
        asset_type="texture",
        manifest=deps.asset_manifest,
    )

    deps.texture_gen = TextureGenerator(
        width=deps.config["texture_resolution"],
        height=deps.config["texture_resolution"],
        steps=deps.config["texture_steps"],
        lazy=deps.config["texture_lazy_load"],
    )

    deps.model_cache = AssetCache(
        cache_dir=deps.config["model_cache_dir"],
        asset_type="model",
        manifest=deps.asset_manifest,
    )

    deps.model_gen = ModelGenerator(
        texture_gen_ref=deps.texture_gen,
        lazy=True,
    )

    deps.skin_cache = AssetCache(
        cache_dir=deps.config["skin_cache_dir"],
        asset_type="skin",
        manifest=deps.asset_manifest,
    )

    deps.skin_gen = SkinGenerator(
        texture_gen_ref=deps.texture_gen,
    )
    deps.controlnet_skin_gen = ControlNetSkinGenerator(
        texture_gen_ref=deps.texture_gen,
        default_strength=0.40,
    )
    deps.plate_inpainter = PlateInpainter(
        texture_gen_ref=deps.texture_gen,
    )

    deps.sprite_cache = AssetCache(
        cache_dir=deps.config["sprite_cache_dir"],
        asset_type="sprite",
        manifest=deps.asset_manifest,
    )

    deps.sprite_gen = SpriteGenerator(
        texture_gen_ref=deps.texture_gen,
    )

    deps.scene_cache = AssetCache(
        cache_dir=deps.config["scene_cache_dir"],
        asset_type="scene",
        manifest=deps.asset_manifest,
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

    deps.segment_cache = AssetCache(
        cache_dir=deps.config["segment_cache_dir"],
        asset_type="segment",
        manifest=deps.asset_manifest,
    )

    # El análisis de escena es OPCIONAL: necesita FAL_KEY. Sin ella el server
    # arranca igual; /analyze_scene_image devuelve 503.
    try:
        deps.scene_segmenter = SceneSegmenter(
            fal_client=FalSamClient(
                auto_segment_model=deps.config["auto_segment_model"],
            ),
        )
    except ValueError as e:
        deps.scene_segmenter = None
        logger.info(f"SceneSegmenter disabled: {e} (set FAL_KEY in .env to enable)")

    if deps.config["expose_diagnostic"]:
        from routers.diagnostic import build_diagnostic_router
        app.include_router(build_diagnostic_router(
            sprite_sheets_dir=SPRITE_SHEETS_DIR,
            gpu_lock=deps.gpu_lock,
            skin_gen=deps.skin_gen,
            controlnet_skin_gen=deps.controlnet_skin_gen,
        ))
        logger.info("Diagnostic router mounted at /diagnostic/* (expose_diagnostic=true)")

    # Techo de tamaño del cache (LRU por last_used del manifest). Sin él, el
    # cache crece sin cota (llegó a 340 MB en dev). 0 = sin límite.
    max_cache_bytes = int(deps.config["cache_max_bytes"])
    if max_cache_bytes > 0:
        summary = deps.asset_manifest.prune(_cache_dirs_by_type(), max_cache_bytes)
        if summary["pruned"] > 0:
            logger.info(
                f"AssetManifest: pruned {summary['pruned']} assets "
                f"({summary['freed_bytes'] / 1e6:.1f} MB freed, "
                f"{summary['total_bytes'] / 1e6:.1f} MB remain)"
            )

    logger.info(f"\nAI Server ready. HTTP :{deps.config['port']}")
    yield
    deps.llm_client = None
    deps.texture_gen = None
    deps.model_gen = None


app = FastAPI(title="NE-Fan AI Server", lifespan=lifespan)

# Allow the HTML 2D client (vite dev server on :3000) to call /generate_sprite
# and /cache/sprite/{hash} from the browser. Without this, every fetch fails
# the CORS preflight (OPTIONS) and the renderer never gets a sprite.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers por dominio (importan `deps` directamente, sin ciclos con main).
app.include_router(cache_assets_router)
app.include_router(styles_router)
app.include_router(generation_router)
app.include_router(narrative_router)


@app.get("/health")
async def health():
    cache_total = deps.asset_manifest.total_bytes() if deps.asset_manifest else 0
    cache_max = int(deps.config.get("cache_max_bytes", 0)) if deps.config else 0
    return {
        "status": "ready" if deps.llm_client else "loading",
        "mode": "narrative",
        "texture_pipeline": "loaded" if (deps.texture_gen and deps.texture_gen.is_loaded) else "lazy",
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
