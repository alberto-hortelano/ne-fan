"""Estado runtime del ai_server — sustituye a los 18 globals de main.py.

Un único objeto `deps` (singleton de proceso) que el lifespan de FastAPI
puebla al arrancar y los endpoints/routers leen. Ventajas sobre los globals:
un solo home tipado, sin sentencias `global`, y los routers por dominio
(routers/*.py) pueden importarlo sin ciclos con main.py. Los tests pueden
sustituir atributos individuales por fakes.

Las anotaciones son strings a propósito: importar aquí los generadores
arrastraría torch/diffusers al import de cualquier módulo que solo quiera
leer `deps.config`.
"""
import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from asset_cache import AssetCache
    from asset_store_client import AssetStoreClient
    from controlnet_skin import ControlNetSkinGenerator
    from llm_client import LLMClient
    from model_generator import ModelGenerator
    from plate_inpainter import PlateInpainter
    from scene_image_generator import SceneImageGenerator
    from scene_segmenter import SceneSegmenter
    from fal_client import FalFillClient
    from skin_generator import SkinGenerator
    from sprite_generator import SpriteGenerator
    from sprite_skin_meshy import SpriteSkinMeshy
    from style_packs import StylePackResolver
    from texture_generator import TextureGenerator


class Deps:
    llm_client: "LLMClient | None" = None
    texture_gen: "TextureGenerator | None" = None
    model_gen: "ModelGenerator | None" = None
    skin_gen: "SkinGenerator | None" = None
    controlnet_skin_gen: "ControlNetSkinGenerator | None" = None
    plate_inpainter: "PlateInpainter | None" = None
    sprite_skin_gen: "SpriteSkinMeshy | None" = None
    sprite_gen: "SpriteGenerator | None" = None
    scene_image_gen: "SceneImageGenerator | None" = None
    scene_segmenter: "SceneSegmenter | None" = None
    # Pelado por capas del proscenio (FLUX Fill remoto). None = sin FAL_KEY;
    # /peel_scene_layer degrada a LaMa local (plate_inpainter).
    fill_client: "FalFillClient | None" = None
    style_packs: "StylePackResolver | None" = None
    asset_cache: "AssetCache | None" = None
    model_cache: "AssetCache | None" = None
    skin_cache: "AssetCache | None" = None
    sprite_cache: "AssetCache | None" = None
    scene_cache: "AssetCache | None" = None
    segment_cache: "AssetCache | None" = None
    # Cliente HTTP del asset-store (F2) — conserva el nombre histórico porque
    # AssetCache/llm_client lo consumen por duck typing (register/list_assets).
    asset_manifest: "AssetStoreClient | None" = None
    config: dict = {}

    def __init__(self) -> None:
        # Serializa TODAS las operaciones de GPU (sin concurrencia CUDA).
        self.gpu_lock = asyncio.Lock()


deps = Deps()
