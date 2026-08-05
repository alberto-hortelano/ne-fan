"""GPU Worker (S4, :8766): generación LOCAL con GPU fuera de narrative-llm.

Start with: python ai_server/gpu_worker_main.py [--port 8766]

Sirve los pipelines de routers/gpu_generation.py (texturas SD1.5+LCM, modelos
Meshy/TripoSG, skins img2img, sprites, LaMa placa/pelado) y /diagnostic/* si
`expose_diagnostic`. El `gpu_lock` de deps NO desaparece con la extracción:
además de serializar CUDA protege la COHERENCIA del pipe SD compartido
(Skin/Sprite/ModelGenerator mutan padding/LoRA/device del pipe de
TextureGenerator y restauran al terminar) — FastAPI async intercala requests.
Escalar = un proceso por GPU (NEFAN_URL_GPU_WORKER apunta a cada uno).

Hook de test/stack-sin-GPU: NEFAN_GPU_MOCK=<dir escribible> instala un
generador de texturas fake (blob estampado con el worker tras un sleep bajo
el gpu_lock, caches bajo <dir> sin registro en el asset-store). Lo usa
tests/test_two_gpu_workers.py para probar el reparto entre dos workers.
"""

import argparse
import logging
import os
import time
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
from asset_paths import SPRITE_SHEETS_DIR
from asset_store_client import AssetStoreClient
from deps import deps
from routers.gpu_generation import router as gpu_generation_router

logger = logging.getLogger("ai_server")


class _MockTextureGen:
    """Generador fake para NEFAN_GPU_MOCK: blob estampado tras un sleep (el
    sleep corre DENTRO del gpu_lock, como la generación real — el test de dos
    workers mide con él la serialización intra-proceso)."""

    is_loaded = True

    def __init__(self, worker_id: str, sleep_s: float) -> None:
        self._worker_id = worker_id
        self._sleep_s = sleep_s

    def generate(self, prompt: str, seed: int = -1) -> dict:
        time.sleep(self._sleep_s)
        stamp = f"MOCK:{self._worker_id}:{prompt}".encode()
        return {"albedo": stamp, "normal": stamp}


def _populate_mock(mock_dir: Path) -> None:
    worker_id = os.environ.get("NEFAN_GPU_WORKER_ID", str(os.getpid()))
    sleep_s = float(os.environ.get("NEFAN_GPU_MOCK_SLEEP", "0.3"))
    # Sin asset-store: caches locales bajo el dir del mock, sin registro.
    deps.asset_cache = AssetCache(cache_dir=str(mock_dir / "textures"), asset_type="texture")
    deps.texture_gen = _MockTextureGen(worker_id, sleep_s)
    logger.info(f"GPU Worker MOCK (worker_id={worker_id}, sleep={sleep_s}s, dir={mock_dir})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    deps.config = load_config()

    mock_dir = os.environ.get("NEFAN_GPU_MOCK", "")
    if mock_dir:
        _populate_mock(Path(mock_dir))
        yield
        deps.texture_gen = None
        return

    # Los pesos son lazy (SD/TripoSG/ControlNet/LaMa cargan al primer uso);
    # aquí solo se instancian los objetos y clientes.
    from controlnet_skin import ControlNetSkinGenerator
    from model_generator import ModelGenerator
    from plate_inpainter import PlateInpainter
    from skin_generator import SkinGenerator
    from sprite_generator import SpriteGenerator
    from texture_generator import TextureGenerator

    deps.asset_manifest = AssetStoreClient()
    logger.info(
        f"AssetStore: {deps.asset_manifest.base_url} "
        f"({deps.asset_manifest.total_count()} entries)"
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

    # peel/plate escriben en cache/scenes con subtype "plate". Compartir el
    # dir con narrative-llm/remote-gen es seguro: escritura atómica
    # (tmp+replace) y registro por POST /assets — cero estado en memoria.
    deps.scene_cache = AssetCache(
        cache_dir=deps.config["scene_cache_dir"],
        asset_type="scene",
        manifest=deps.asset_manifest,
    )

    # Pelado por capas del proscenio: FLUX Fill remoto si hay FAL_KEY; sin
    # ella /peel_scene_layer degrada a LaMa local (gratis, menos guiado).
    # Llamada fal DIRECTA a propósito (no vía remote-gen): el fallback
    # flux→lama re-deriva la clave de caché en local, ver gpu-worker.ts.
    try:
        from fal_client import FalFillClient
        deps.fill_client = FalFillClient()
    except ValueError as e:
        deps.fill_client = None
        logger.info(f"FalFillClient disabled: {e} — peel degradará a LaMa local")

    if deps.config["expose_diagnostic"]:
        from routers.diagnostic import build_diagnostic_router
        app.include_router(build_diagnostic_router(
            sprite_sheets_dir=SPRITE_SHEETS_DIR,
            gpu_lock=deps.gpu_lock,
            skin_gen=deps.skin_gen,
            controlnet_skin_gen=deps.controlnet_skin_gen,
        ))
        logger.info("Diagnostic router mounted at /diagnostic/* (expose_diagnostic=true)")

    logger.info(f"\nGPU Worker ready. HTTP :{load_port('gpu_worker')}")
    yield
    deps.texture_gen = None
    deps.model_gen = None


app = FastAPI(title="NE-Fan GPU Worker", lifespan=lifespan)

# El cliente 2D (vite :3000) le habla DIRECTO desde el navegador (peel, plate,
# sprites). Sin CORS, todo fetch muere en el preflight como "error de red".
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(gpu_generation_router)


@app.get("/health")
async def health():
    """Estado del worker. `model_backend` lo consume el /backend_status de
    narrative-llm (agregación best-effort) — el shape del panel de Godot no
    cambia con la extracción."""
    if deps.model_gen and getattr(deps.model_gen, "_meshy", None):
        model_backend = "meshy"
    elif deps.model_gen and getattr(deps.model_gen, "_triposg_available", False):
        model_backend = "triposg"
    else:
        model_backend = "none"
    return {
        "status": "ready" if deps.texture_gen else "loading",
        "texture_pipeline": "loaded" if (deps.texture_gen and deps.texture_gen.is_loaded) else "lazy",
        "model_backend": model_backend,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="NE-Fan GPU Worker")
    # Default del snapshot (fuente única de puertos: nefan-core/src/config.ts).
    parser.add_argument("--port", type=int, default=load_port("gpu_worker"))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
