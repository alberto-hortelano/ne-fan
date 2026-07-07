"""AI Server: narrative + texture generation for LLM-powered world generation.

Start with: python ai_server/main.py [--port 8765]
"""

import base64
import io
import json
import os
import time
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

import logging

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _SilenceHealthcheckFilter(logging.Filter):
    """Drop uvicorn access log entries for noisy polling endpoints."""

    _SILENCED = ("/health", "/backend_status")

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(path in msg for path in self._SILENCED)


logging.getLogger("uvicorn.access").addFilter(_SilenceHealthcheckFilter())

from llm_client import LLMClient, NarrativeUnavailable
from texture_generator import TextureGenerator
from model_generator import ModelGenerator
from skin_generator import SkinGenerator
from sprite_generator import SpriteGenerator
from controlnet_skin import ControlNetSkinGenerator
from dev_api_cache import DEV_API_CACHE
from sprite_skin_meshy import SpriteSkinMeshy
from scene_image_generator import SceneImageGenerator, SIDES
from style_packs import StylePackResolver
from PIL import Image
from fal_client import FalSamClient
from scene_segmenter import SceneSegmenter, crop_sprite, scene_rgb_from_png
from asset_cache import AssetCache, AssetManifest

import asyncio as _asyncio

# Global instances
llm_client: LLMClient | None = None
texture_gen: TextureGenerator | None = None
model_gen: ModelGenerator | None = None
skin_gen: SkinGenerator | None = None
controlnet_skin_gen: ControlNetSkinGenerator | None = None
sprite_skin_gen: "SpriteSkinMeshy | None" = None
sprite_gen: SpriteGenerator | None = None
scene_image_gen: SceneImageGenerator | None = None
scene_segmenter: SceneSegmenter | None = None
style_packs: "StylePackResolver | None" = None
asset_cache: AssetCache | None = None
model_cache: AssetCache | None = None
skin_cache: AssetCache | None = None
sprite_cache: AssetCache | None = None
scene_cache: AssetCache | None = None
segment_cache: AssetCache | None = None
asset_manifest: AssetManifest | None = None
config: dict = {}
_gpu_lock = _asyncio.Lock()  # Serialize ALL GPU operations


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
    print(f"Config loaded from: {path}")
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
    global llm_client, texture_gen, model_gen, skin_gen, sprite_gen, asset_cache, model_cache, skin_cache, sprite_cache, scene_cache, segment_cache, asset_manifest, config, controlnet_skin_gen, scene_image_gen, scene_segmenter, style_packs
    config = load_config()

    # Shared manifest sits at the cache root and tracks every asset across types.
    from pathlib import Path as _P
    cache_root = _P(config["cache_root"])
    manifest_path = cache_root / "manifest.json"
    asset_manifest = AssetManifest(manifest_path)
    print(f"AssetManifest: {manifest_path.resolve()} ({asset_manifest.total_count()} entries)")

    # First-run recovery: scan existing cache directories so previously generated
    # assets become discoverable to the narrative engine.
    if asset_manifest.total_count() == 0:
        added_total = 0
        added_total += asset_manifest.scan_directory(
            cache_root / "textures",
            asset_type="texture",
            subtypes_by_filename={"albedo.png": "albedo", "normal.png": "normal", "roughness.png": "roughness"},
        )
        added_total += asset_manifest.scan_directory(
            cache_root / "models",
            asset_type="model",
            subtypes_by_filename={"model.glb": "model"},
        )
        added_total += asset_manifest.scan_directory(
            cache_root / "skins",
            asset_type="skin",
            subtypes_by_filename={"skin.png": "skin"},
        )
        added_total += asset_manifest.scan_directory(
            cache_root / "sprites",
            asset_type="sprite",
            subtypes_by_filename={"sprite.png": "sprite"},
        )
        added_total += asset_manifest.scan_directory(
            cache_root / "scenes",
            asset_type="scene",
            subtypes_by_filename={"scene.png": "scene"},
        )
        added_total += asset_manifest.scan_directory(
            cache_root / "segments",
            asset_type="segment",
            subtypes_by_filename={"segment.png": "segment"},
        )
        if added_total > 0:
            print(f"AssetManifest: recovered {added_total} pre-existing assets")

    llm_client = LLMClient(
        model=config["llm_model"],
        timeout=float(config["llm_timeout_s"]),
        asset_manifest=asset_manifest,
    )

    asset_cache = AssetCache(
        cache_dir=config["texture_cache_dir"],
        asset_type="texture",
        manifest=asset_manifest,
    )

    texture_gen = TextureGenerator(
        width=config["texture_resolution"],
        height=config["texture_resolution"],
        steps=config["texture_steps"],
        lazy=config["texture_lazy_load"],
    )

    model_cache = AssetCache(
        cache_dir=config["model_cache_dir"],
        asset_type="model",
        manifest=asset_manifest,
    )

    model_gen = ModelGenerator(
        texture_gen_ref=texture_gen,
        lazy=True,
    )

    skin_cache = AssetCache(
        cache_dir=config["skin_cache_dir"],
        asset_type="skin",
        manifest=asset_manifest,
    )

    skin_gen = SkinGenerator(
        texture_gen_ref=texture_gen,
    )
    controlnet_skin_gen = ControlNetSkinGenerator(
        texture_gen_ref=texture_gen,
        default_strength=0.40,
    )

    sprite_cache = AssetCache(
        cache_dir=config["sprite_cache_dir"],
        asset_type="sprite",
        manifest=asset_manifest,
    )

    sprite_gen = SpriteGenerator(
        texture_gen_ref=texture_gen,
    )

    scene_cache = AssetCache(
        cache_dir=config["scene_cache_dir"],
        asset_type="scene",
        manifest=asset_manifest,
    )

    _repo_root = Path(__file__).resolve().parent.parent
    scene_image_gen = SceneImageGenerator(
        style_image_path=str(_repo_root / config["scene_style_image"]),
        model=config["scene_model"],
    )
    # Packs de estilo por juego (imágenes de referencia por categoría).
    # Degradación esperable si aún no hay packs: resolve() devuelve None y las
    # peticiones usan la referencia global de arriba.
    style_packs = StylePackResolver()

    segment_cache = AssetCache(
        cache_dir=config["segment_cache_dir"],
        asset_type="segment",
        manifest=asset_manifest,
    )

    # El análisis de escena es OPCIONAL: necesita FAL_KEY. Sin ella el server
    # arranca igual; /analyze_scene_image devuelve 503.
    try:
        scene_segmenter = SceneSegmenter(
            fal_client=FalSamClient(
                auto_segment_model=config["auto_segment_model"],
            ),
        )
    except ValueError as e:
        scene_segmenter = None
        print(f"SceneSegmenter disabled: {e} (set FAL_KEY in .env to enable)", flush=True)

    if config["expose_diagnostic"]:
        from routers.diagnostic import build_diagnostic_router
        app.include_router(build_diagnostic_router(
            sprite_sheets_dir=SPRITE_SHEETS_DIR,
            gpu_lock=_gpu_lock,
            skin_gen=skin_gen,
            controlnet_skin_gen=controlnet_skin_gen,
        ))
        print("Diagnostic router mounted at /diagnostic/* (expose_diagnostic=true)")

    # Techo de tamaño del cache (LRU por last_used del manifest). Sin él, el
    # cache crece sin cota (llegó a 340 MB en dev). 0 = sin límite.
    max_cache_bytes = int(config["cache_max_bytes"])
    if max_cache_bytes > 0:
        summary = asset_manifest.prune(_cache_dirs_by_type(), max_cache_bytes)
        if summary["pruned"] > 0:
            print(
                f"AssetManifest: pruned {summary['pruned']} assets "
                f"({summary['freed_bytes'] / 1e6:.1f} MB freed, "
                f"{summary['total_bytes'] / 1e6:.1f} MB remain)"
            )

    print(f"\nAI Server ready. HTTP :{config['port']}")
    yield
    llm_client = None
    texture_gen = None
    model_gen = None


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


# ── Request models ──
# Pydantic models replace the previous `await request.json()` + body.get(...)
# pattern so missing / wrong-type fields are rejected at the boundary with a
# 422 and a structured detail, matching the fail-loud contract of
# /report_player_choice. See next.md §2.2.

class TextureRequest(BaseModel):
    prompt: str = Field(min_length=1)
    seed: int = -1


class ModelRequest(BaseModel):
    prompt: str = Field(min_length=1)
    scale: list[float] = Field(default_factory=lambda: [0.5, 0.5, 0.5])
    seed: int = -1
    quality: str = "normal"


class SkinRequest(BaseModel):
    prompt: str = Field(min_length=1)
    strength: float = -1
    gamma: float = 0.35
    seed: int = -1


class SpriteRequest(BaseModel):
    prompt: str = Field(min_length=1)
    width: int = 512
    height: int = 512
    seed: int = -1
    angle: str = "top_down"
    style_token: str | None = None


class NotifySessionRequest(BaseModel):
    session_id: str = Field(min_length=1)
    game_id: str = Field(min_length=1)
    is_resume: bool = False


class ReportPlayerChoiceRequest(BaseModel):
    event_id: str = Field(min_length=1)
    speaker: str = ""
    chosen_text: str = ""
    free_text: str = ""
    context: dict = Field(default_factory=dict)


class GenerateSceneRequest(BaseModel):
    """/generate_scene takes the bridge's LlmContext
    (nefan-core/src/narrative/types.ts): session_id, game_id, world, player
    + extras. Extra fields pass through to the narrative engine untouched so
    the TS side can add context without a lockstep deploy; the validator only
    enforces that the shape is complete."""
    model_config = ConfigDict(extra="allow")

    session_id: str | None = None
    game_id: str | None = None
    world: dict | None = None
    player: dict | None = None

    @model_validator(mode="after")
    def _require_context(self) -> "GenerateSceneRequest":
        is_context = bool(
            self.session_id and self.game_id
            and self.world is not None and self.player is not None
        )
        if not is_context:
            raise ValueError(
                "expected an LlmContext (session_id, game_id, world, player)"
            )
        return self


class DevelopWorldRequest(BaseModel):
    """Borrador de mundo del jugador (textarea o archivo .md/.txt) que el
    motor narrativo desarrolla contra la plantilla de 10 secciones."""
    draft_text: str = Field(min_length=20, max_length=64_000)


class StyleUploadRequest(BaseModel):
    """Subida de un estilo de usuario: nombre + imágenes por categoría en
    base64 (JSON, no multipart — evita la dependencia python-multipart)."""
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=500)
    style_token: str = Field(default="", max_length=300)
    images: list[dict] = Field(min_length=1, max_length=9)


class StyleCompleteRequest(BaseModel):
    """Confirmación explícita del usuario para generar las categorías que
    faltan (coste real en créditos Meshy)."""
    confirm: bool = False


class AnalyzeWeaponRequest(BaseModel):
    images: list[str] = Field(min_length=1)
    weapon_type: str = "generic"
    kind: str = "weapon_orient"
    context: dict = Field(default_factory=dict)


class SceneImageRequest(BaseModel):
    """Full-scene img2img from the 2D client's schematic capture.

    `image_b64` is the base64-encoded PNG the Canvas renderer exports (terrain
    plate + object rectangles, no characters). The result is a painted top-down
    scene that maps 1:1 onto the same world rectangle.

    `context_sides`: edges of the capture whose outermost strip is REAL,
    already-painted art from an adjacent tile (not schematic). The model is
    instructed to reproduce those strips and continue them seamlessly.

    `blueprint_kind`: "boxes" (legacy schematic: colour zones + object boxes)
    or "svg" (rich map_svg blueprint: the instruction asks for a full painterly
    REPAINT with cutaway buildings instead of the box legend)."""
    image_b64: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    context_sides: list[str] = Field(default_factory=list)
    blueprint_kind: str = Field(default="boxes", pattern="^(boxes|svg)$")
    # Estilo del juego: id del pack (congelado en la sesión) y categoría de
    # referencia que el motor narrativo etiquetó para esta escena. Ausentes ⇒
    # referencia global fija de siempre.
    style_id: str = Field(default="", pattern="^[A-Za-z0-9_.-]*$")
    style_tag: str = Field(default="", pattern="^(nature|settlement|fortress|interior|underground)?$")
    # Perspectiva congelada de la sesión: cambia la leyenda de la instrucción
    # (cenital con caras / isométrica 2:1) y entra en la clave de caché.
    perspective: str = Field(default="topdown", pattern="^(topdown|isometric)$")

    @field_validator("context_sides")
    @classmethod
    def _valid_sides(cls, v: list[str]) -> list[str]:
        bad = [s for s in v if s not in SIDES]
        if bad:
            raise ValueError(f"context_sides must be in {SIDES}, got {bad}")
        return v


class ReviewBlueprintRequest(BaseModel):
    """Revisión por visión del blueprint antes de generar (tecla R del cliente).

    `image_b64` es el mismo PNG del schematic que iría a Meshy; `scene` es la
    escena Format D que lo produjo. Claude (vía MCP) devuelve
    { approved, issues, fixes? } con overrides parciales."""
    scene_id: str = Field(min_length=1)
    image_b64: str = Field(min_length=1)
    scene: dict


class AnalyzeSceneRequest(BaseModel):
    """Mundo derivado de la imagen: segmentación automática completa + visión
    clasifica cada región (solid/tall). El cliente deriva de la respuesta la
    colisión y los occluders del tile. `context` viaja al modelo de visión
    (p. ej. scene_description del tile)."""
    image_b64: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)


def _cache_dirs_by_type() -> dict[str, Path]:
    """asset_type → raíz del cache de ese tipo (el blob vive en {dir}/{hash})."""
    return {
        "texture": Path(config["texture_cache_dir"]),
        "model": Path(config["model_cache_dir"]),
        "skin": Path(config["skin_cache_dir"]),
        "sprite": Path(config["sprite_cache_dir"]),
        "scene": Path(config["scene_cache_dir"]),
        "segment": Path(config["segment_cache_dir"]),
    }


def _touch_asset(hash_key: str) -> None:
    """Marca un asset como usado para el LRU del prune (no-op sin manifest)."""
    if asset_manifest is not None:
        asset_manifest.touch(hash_key)


class DevApiCacheRequest(BaseModel):
    enabled: bool


@app.get("/dev/api_cache")
async def dev_api_cache_status():
    """Estado del cache de modo dev (toggle de la top bar del cliente 2D):
    on/off + último payload guardado por canal de API."""
    return DEV_API_CACHE.status()


@app.post("/dev/api_cache")
async def dev_api_cache_toggle(body: DevApiCacheRequest):
    """Enciende/apaga el modo dev: con él activo, cada API de IA de pago
    (Meshy i2i, Meshy 3D, fal) devuelve su última respuesta cacheada en vez
    de llamar de verdad. Persiste en disco (sobrevive reinicios)."""
    DEV_API_CACHE.set_enabled(body.enabled)
    return DEV_API_CACHE.status()


@app.get("/health")
async def health():
    cache_total = asset_manifest.total_bytes() if asset_manifest else 0
    cache_max = int(config.get("cache_max_bytes", 0)) if config else 0
    return {
        "status": "ready" if llm_client else "loading",
        "mode": "narrative",
        "texture_pipeline": "loaded" if (texture_gen and texture_gen.is_loaded) else "lazy",
        "cache_total_bytes": cache_total,
        "cache_max_bytes": cache_max,
        "cache_over_limit": bool(cache_max and cache_total > cache_max),
    }


@app.post("/cache/prune")
async def prune_cache():
    """Fuerza una pasada de eviction LRU hasta bajar de cache_max_bytes."""
    if asset_manifest is None:
        raise HTTPException(status_code=503, detail="manifest not ready")
    max_cache_bytes = int(config["cache_max_bytes"])
    if max_cache_bytes <= 0:
        raise HTTPException(status_code=400, detail="cache_max_bytes is 0 (no limit configured)")
    summary = asset_manifest.prune(_cache_dirs_by_type(), max_cache_bytes)
    return {"ok": True, **summary}


@app.post("/generate_scene")
async def generate_scene(body: GenerateSceneRequest):
    """Accept the LlmContext from the bridge, return open-world scene JSON."""
    import asyncio

    if llm_client is None:
        raise HTTPException(status_code=503, detail="llm_client unavailable")

    try:
        return await asyncio.to_thread(
            llm_client.generate_scene, body.model_dump(exclude_none=True)
        )
    except NarrativeUnavailable as e:
        # 504 para timeout (el modelo puede seguir escribiendo; el reintento
        # del mismo tile recupera la respuesta tardía), 503 para el resto.
        status = 504 if "timeout" in str(e).lower() else 503
        raise HTTPException(status_code=status, detail=str(e)) from e


@app.post("/generate_texture")
async def generate_texture_endpoint(body: TextureRequest):
    """Generate PBR texture set from a prompt. Returns URLs to cached PNGs."""
    import asyncio

    key = asset_cache.hash_key(body.prompt)

    # Check cache first
    if asset_cache.has_all(body.prompt, ["albedo", "normal"]):
        return {
            "hash": key,
            "cached": True,
            "albedo_url": f"/cache/albedo/{key}",
            "normal_url": f"/cache/normal/{key}",
        }

    # Generate (serialized — CUDA doesn't support concurrent access)
    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(texture_gen.generate, body.prompt, body.seed)
    elapsed_ms = int((time.time() - start) * 1000)

    # Store in cache
    asset_cache.put(body.prompt, "albedo", result["albedo"])
    asset_cache.put(body.prompt, "normal", result["normal"])

    return {
        "hash": key,
        "cached": False,
        "albedo_url": f"/cache/albedo/{key}",
        "normal_url": f"/cache/normal/{key}",
        "generation_time_ms": elapsed_ms,
    }


@app.post("/generate_model")
async def generate_model_endpoint(body: ModelRequest):
    """Generate a 3D model (GLB) from a prompt."""
    import asyncio

    # namespace_context: en modo dev-cache el GLB deriva de una respuesta
    # rancia de Meshy — no debe pisar el slot real de este prompt.
    model_ctx = DEV_API_CACHE.namespace_context()
    key = model_cache.hash_key(body.prompt, model_ctx)

    # Check cache
    if model_cache.has(body.prompt, "model", model_ctx):
        return {
            "hash": key,
            "cached": True,
            "model_url": f"/cache/model/{key}",
        }

    # Generate (serialized with textures via GPU lock)
    start = time.time()
    async with _gpu_lock:
        glb_bytes = await asyncio.to_thread(
            model_gen.generate, body.prompt, body.scale, body.seed, body.quality
        )
    elapsed_ms = int((time.time() - start) * 1000)

    model_cache.put(body.prompt, "model", glb_bytes, model_ctx)

    return {
        "hash": key,
        "cached": False,
        "model_url": f"/cache/model/{key}",
        "generation_time_ms": elapsed_ms,
    }


@app.get("/backend_status")
async def backend_status_endpoint():
    """Report the state of optional backends. Used by Godot's ServiceSettings panel."""
    import asyncio

    # Meshy 3D
    if model_gen and getattr(model_gen, "_meshy", None):
        meshy_status = {"state": "ready", "message": "API key configurada"}
    elif model_gen and getattr(model_gen, "_triposg_available", False):
        meshy_status = {
            "state": "fallback",
            "message": "Meshy no configurado (usando TripoSG local)",
        }
    else:
        meshy_status = {
            "state": "down",
            "message": "no disponible (define MESHY_API_KEY en .env)",
        }

    # AI Vision (MCP bridge listener preferred, direct API as fallback)
    if not llm_client:
        vision_status = {"state": "down", "message": "LLM client no disponible"}
    else:
        bridge = await asyncio.to_thread(llm_client.get_bridge_status)
        has_api: bool = llm_client.has_api_fallback()

        def api_or_down(down_msg: str) -> dict:
            if has_api:
                return {"state": "fallback", "message": "API directa (sin listener MCP)"}
            return {"state": "down", "message": down_msg}

        if not bridge.get("connected"):
            vision_status = api_or_down("bridge no conectado (¿narrative-mcp arrancado?)")
        elif bridge.get("error"):
            vision_status = api_or_down(f"bridge error: {bridge['error']}")
        elif bridge.get("listener_active"):
            ago: float = bridge.get("last_listen_seconds_ago", -1)
            vision_status = {
                "state": "ready",
                "message": f"MCP listener activo (último listen hace {max(ago, 0):.0f}s)",
            }
        else:
            vision_status = api_or_down("no hay Claude Code escuchando narrative_listen")

    return {
        "meshy_3d": meshy_status,
        "ai_vision": vision_status,
    }


@app.post("/analyze_weapon")
async def analyze_weapon_endpoint(body: AnalyzeWeaponRequest):
    """Vision-guided weapon orientation. Receives images of a 3D weapon and
    returns grip point + orientation vectors for placement.

    Errors are surfaced as HTTPException (4xx/5xx) instead of 200 with an
    `error` field in the body — same fail-loud contract that
    `/report_player_choice` already uses, see next.md §2.1."""
    import asyncio

    if llm_client is None:
        raise HTTPException(status_code=503, detail="llm_client unavailable")

    result = await asyncio.to_thread(
        llm_client.analyze_weapon, body.images, body.weapon_type, body.kind, body.context
    )

    if result is None:
        raise HTTPException(status_code=503, detail="vision unavailable")

    return result


@app.post("/generate_skin")
async def generate_skin_endpoint(body: SkinRequest):
    """Generate a character skin variant via img2img on the base Paladin UV."""
    import asyncio

    key = skin_cache.hash_key(body.prompt)

    if skin_cache.has(body.prompt, "skin"):
        return {
            "hash": key,
            "cached": True,
            "skin_url": f"/cache/skin/{key}",
        }

    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(
            skin_gen.generate, body.prompt, body.strength, body.gamma, body.seed
        )
    elapsed_ms = int((time.time() - start) * 1000)

    skin_cache.put(body.prompt, "skin", result["skin"])

    return {
        "hash": key,
        "cached": False,
        "skin_url": f"/cache/skin/{key}",
        "generation_time_ms": elapsed_ms,
    }


@app.post("/generate_sprite")
async def generate_sprite_endpoint(body: SpriteRequest):
    """Generate an RGBA sprite PNG from a prompt (image with transparent background).

    Accepts an optional ``angle`` (top_down | isometric_30 | isometric_45 |
    frontal) so 2D-world assets match the projection of pre-rendered Mixamo
    sprite sheets. ``angle`` and ``style_token`` participate in the cache key,
    so the same prompt at different angles cache independently.
    """
    import asyncio

    context = {"angle": body.angle}
    if body.style_token:
        context["style_token"] = body.style_token

    key = sprite_cache.hash_key(body.prompt, context)

    if sprite_cache.has(body.prompt, "sprite", context):
        return {
            "hash": key,
            "cached": True,
            "sprite_url": f"/cache/sprite/{key}",
            "angle": body.angle,
        }

    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(
            sprite_gen.generate, body.prompt, body.width, body.height,
            body.seed, body.angle, body.style_token,
        )
    elapsed_ms = int((time.time() - start) * 1000)

    sprite_cache.put(
        body.prompt, "sprite", result["sprite"],
        context=context, subtype_override="sprite_2d",
    )

    return {
        "hash": key,
        "cached": False,
        "sprite_url": f"/cache/sprite/{key}",
        "angle": body.angle,
        "generation_time_ms": elapsed_ms,
    }


def _decode_b64_png(image_b64: str) -> bytes:
    """Decode a base64 PNG (optionally a `data:image/png;base64,` URL) to bytes.
    Fail-loud: a malformed payload is a 400, not a silent empty image."""
    import base64
    raw = image_b64
    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")
    try:
        return base64.b64decode(raw, validate=True)
    except (ValueError, base64.binascii.Error) as e:
        raise HTTPException(status_code=400, detail=f"invalid base64 image: {e}") from e


@app.post("/generate_scene_image")
async def generate_scene_image_endpoint(body: SceneImageRequest):
    """Repaint the client's schematic into a detailed top-down scene (img2img +
    ControlNet canny). Cached by (prompt, layout, strength)."""
    import asyncio
    import hashlib

    if scene_image_gen is None:
        raise HTTPException(status_code=503, detail="scene_image_gen unavailable")

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    # `model` is in the key so switching backends/models never serves a stale
    # image cached under a different generator. `sides` covers the (unlikely)
    # case of identical pixels with a different context instruction; empty is
    # dropped from the hash so pre-existing cache entries stay valid.
    context = {
        "layout": layout,
        "kind": "full",
        "model": scene_image_gen._model,
        "sides": "+".join(sorted(body.context_sides)),
    }
    # Estilo del juego: resolver la referencia del pack. Si el pack no tiene
    # imagen utilizable se degrada a la global — y la clave de cache NO lleva
    # estilo, para no fragmentar el cache preexistente.
    style_ref = None
    if body.style_id and style_packs is not None:
        style_ref = style_packs.resolve(body.style_id, body.style_tag or "settlement")
        if style_ref is not None:
            context["style"] = f"{style_ref.style_id}/{style_ref.category}:{style_ref.content_hash}"
    # La instrucción difiere por tipo de blueprint: mismo layout con otro kind
    # no debe servir una imagen cacheada bajo la instrucción antigua. "boxes"
    # se omite (como sides vacío) para no invalidar la caché preexistente.
    if body.blueprint_kind != "boxes":
        context["blueprint"] = body.blueprint_kind
    # Perspectiva: misma captura con otra leyenda no debe servir una imagen
    # cacheada. "topdown" se omite para no invalidar caché preexistente.
    if body.perspective != "topdown":
        context["perspective"] = body.perspective
    # En modo dev-cache la imagen viene de la última respuesta Meshy (rancia):
    # namespacear la clave para no contaminar el cache real de este layout.
    context = DEV_API_CACHE.namespace_context(context)
    key = scene_cache.hash_key(body.prompt, context)

    if scene_cache.has(body.prompt, "scene", context):
        return {"hash": key, "cached": True, "scene_url": f"/cache/scene/{key}"}

    # No _gpu_lock: scene generation runs remotely on Meshy (no local GPU), so
    # holding the lock would needlessly block texture/3D GPU work for ~30s.
    start = time.time()
    # 502 explícito: un crash del backend remoto subiría como 500 sin pasar por
    # el CORSMiddleware y el navegador lo enmascara como error de red.
    try:
        result = await asyncio.to_thread(
            scene_image_gen.generate_full, png, body.prompt,
            body.context_sides, body.blueprint_kind,
            style_ref.data_uri if style_ref else None,
            style_ref.style_token if style_ref else "",
            body.perspective,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"scene image generation failed: {e}") from e
    elapsed_ms = int((time.time() - start) * 1000)

    scene_cache.put(body.prompt, "scene", result["scene"], context=context)
    # Guardar también el schematic de entrada (el blueprint que pintó el cliente
    # desde la escena del motor narrativo) para inspección/debug. Directo a disco
    # sin registrar en el manifest: no es un asset reusable por el LLM.
    blueprint_path = scene_cache.get_path(key, "blueprint")
    blueprint_path.parent.mkdir(parents=True, exist_ok=True)
    blueprint_path.write_bytes(png)

    return {
        "hash": key,
        "cached": False,
        "scene_url": f"/cache/scene/{key}",
        "width": result["width"],
        "height": result["height"],
        "generation_time_ms": elapsed_ms,
    }


@app.post("/analyze_scene_image")
async def analyze_scene_image_endpoint(body: AnalyzeSceneRequest):
    """Mundo derivado de la imagen: auto-segmenta TODA la escena (SAM2),
    clasifica cada región por visión (Claude vía MCP, fallback API) y devuelve
    solo los elementos jugables: `solid` (colisión) y/o `tall` (occluder con
    z-index), cada uno con su sprite recortado de los píxeles originales.
    Cacheado por (layout de imagen, modelos) — el resume es determinista."""
    import asyncio
    import hashlib

    if scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="scene_segmenter unavailable — set FAL_KEY in .env to enable scene analysis",
        )
    if llm_client is None:
        raise HTTPException(status_code=503, detail="llm_client unavailable — vision required")

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    ctx = DEV_API_CACHE.namespace_context({
        "layout": layout,
        "sam_model": scene_segmenter._fal.auto_segment_model,
        "vision_model": llm_client.model,
    })
    key = segment_cache.hash_key("analysis", ctx)
    cached = segment_cache.get_by_hash(key, "analysis")
    if cached is not None:
        return json.loads(cached)

    # Fase 1: segmentación automática + overlay numerado (fal → 502 en fallo).
    try:
        analysis = await asyncio.to_thread(scene_segmenter.analyze_regions, png)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"scene auto-segmentation failed: {e}") from e
    regions = analysis["regions"]
    if not regions:
        result = {"segments": [], "discarded": 0}
        segment_cache.put("analysis", "analysis", json.dumps(result).encode(),
                          context=ctx, subtype_override="analysis")
        return result

    # Fase 2: clasificación por visión (escena original + overlay numerado).
    import base64 as b64mod
    vision_context = {
        "regions": [{"index": r["index"], "bbox": list(r["bbox_xyxy"])} for r in regions],
        **body.context,
    }
    images = [
        {"view": "scene", "media_type": "image/png",
         "data_b64": b64mod.b64encode(png).decode()},
        {"view": "overlay", "media_type": "image/png",
         "data_b64": b64mod.b64encode(analysis["overlay_png"]).decode()},
    ]
    classified = await asyncio.to_thread(
        llm_client.classify_scene_segments, images, vision_context,
    )
    if classified is None:
        raise HTTPException(
            status_code=503,
            detail="scene classification unavailable — no MCP listener and no API client, or invalid response",
        )

    # Merge por índice: solo solid/tall generan sprite (el resto es suelo).
    scene_rgb = scene_rgb_from_png(png)
    by_index = {r["index"]: r for r in regions}
    segments_out: list[dict] = []
    discarded = 0
    for cls in classified["segments"]:
        region = by_index.get(cls["index"])
        if region is None:
            continue  # índice extra inventado — el validador ya exigió los reales
        if not (cls["solid"] or cls["tall"]):
            discarded += 1
            continue
        sprite = crop_sprite(scene_rgb, region["mask"], region["bbox_xyxy"])
        sprite_hash = hashlib.sha256(sprite["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = segment_cache.put(sprite_hash, "segment", sprite["sprite_png_bytes"])
        segments_out.append({
            "id": f"seg_{cls['index']}",
            "label": cls["label"],
            "solid": cls["solid"],
            "tall": cls["tall"],
            "sprite_url": f"/cache/segment/{sprite_key}",
            "image_bbox": sprite["image_bbox"],
            "img_w": sprite["img_w"],
            "img_h": sprite["img_h"],
        })

    result = {"segments": segments_out, "discarded": discarded}
    segment_cache.put("analysis", "analysis", json.dumps(result).encode(),
                      context=ctx, subtype_override="analysis")
    print(f"analyze_scene: {len(segments_out)} jugables, {discarded} suelo "
          f"(de {len(regions)} regiones)", flush=True)
    return result


# Where the HTML 2D client serves Mixamo sprite sheets from. Resolved relative
# to the project root so the ai_server can read them off disk and run img2img
# over each frame.
SPRITE_SHEETS_DIR = Path(__file__).resolve().parent.parent / "nefan-html" / "public" / "sprites"
SKINNED_SHEETS_DIR = Path(__file__).resolve().parent.parent / "cache" / "sprite_sheets"


def _skin_sheet_key(
    model: str, anim: str, angle: str, prompt: str, ai_model: str, style_key: str = ""
) -> str:
    """Hash that invalidates whenever the underlying Mixamo sheet is
    re-rendered. Including the base meta.json mtime guarantees the skinned
    cache rebuilds on top of the latest frames; otherwise a re-render of the
    base would silently keep the stale skinned variant alive. The Meshy model
    and the keyframe profile are part of the key: cambiar de nano-banana-2 a
    -pro (o retunear ANIM_PROFILES) debe regenerar, no servir el cache viejo.
    """
    import hashlib
    from sprite_skin_meshy import ANIM_PROFILES, DEFAULT_PROFILE
    base_meta = SPRITE_SHEETS_DIR / model / anim / angle / "meta.json"
    base_stamp = str(int(base_meta.stat().st_mtime)) if base_meta.exists() else "0"
    n_kf, fps = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
    payload = "\n".join(
        [model, anim, angle, prompt.strip().lower(), base_stamp, ai_model, f"kf{n_kf}@{fps}",
         style_key,
         # En modo dev-cache los frames derivan de una respuesta rancia: clave
         # aparte para no contaminar el cache real de este prompt.
         DEV_API_CACHE.namespace_suffix()]
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


@app.post("/skin_sprite_sheet")
async def skin_sprite_sheet_endpoint(request: Request):
    """Skinnea una anim de un sheet Mixamo con el prompt del personaje vía
    Meshy (hero-shot de identidad + atlas de keyframes por dirección — el
    pipeline validado en skinning_lab; la vía local SD+ControlNet quedó
    descartada) y sirve los frames desde
    `/cache/sprite_sheet/{hash}/dir_D_frame_FFF.png`.

    Body: {model, anim, angle, prompt}
    Returns: {ok, hash, meta, frame_urls: [[url, ...], ...]} — OJO: el meta
    devuelto es el del sheet SKINNEADO (keyframes reducidos + fps de perfil),
    no el del base. El cliente reproduce con este meta.
    """
    global sprite_skin_gen

    body = await request.json()
    model = str(body.get("model", "")).strip()
    anim = str(body.get("anim", "idle")).strip()
    angle = str(body.get("angle", "isometric_30")).strip()
    prompt = str(body.get("prompt", "")).strip()
    # Estilo del juego (opcional): pack + rol del personaje para elegir la
    # referencia (commoner/noble/warrior). Sin pack o sin imagen ⇒ sin ref.
    style_id = str(body.get("style_id", "")).strip()
    style_role = str(body.get("style_role", "commoner")).strip() or "commoner"

    if not (model and prompt):
        raise HTTPException(status_code=400, detail="missing model or prompt")
    if style_role not in ("commoner", "noble", "warrior"):
        raise HTTPException(status_code=400, detail=f"invalid style_role: {style_role}")

    style_ref = None
    if style_id and style_packs is not None:
        style_ref = style_packs.resolve(style_id, f"character_{style_role}")
    style_key = f"{style_ref.style_id}:{style_ref.content_hash}" if style_ref else ""

    sheet_dir = SPRITE_SHEETS_DIR / model / anim / angle
    if not (sheet_dir / "meta.json").exists():
        raise HTTPException(status_code=404, detail=f"sheet not found: {model}/{anim}/{angle}")

    if sprite_skin_gen is None:
        try:
            sprite_skin_gen = SpriteSkinMeshy(
                SPRITE_SHEETS_DIR, SKINNED_SHEETS_DIR, config["sprite_skin_model"]
            )
        except ValueError as e:
            # MESHY_API_KEY ausente o modelo desconocido: el cliente degrada a
            # la base y_bot (una entrada de error-log, sin reintentos).
            raise HTTPException(status_code=503, detail=f"sprite skin no disponible: {e}") from e

    key = _skin_sheet_key(model, anim, angle, prompt, sprite_skin_gen.ai_model, style_key)
    out_dir = SKINNED_SHEETS_DIR / key
    out_meta_path = out_dir / "meta.json"

    start = time.time()
    if out_meta_path.exists():
        # meta.json se escribe el ÚLTIMO (skin_anim es todo-o-nada): su
        # presencia garantiza que todos los frames están en disco.
        with open(out_meta_path) as f:
            meta = json.load(f)
    else:
        try:
            meta = await sprite_skin_gen.skin_anim(
                model, anim, angle, prompt, out_dir,
                style_uri=style_ref.data_uri if style_ref else "",
                style_key=style_key,
                style_token=style_ref.style_token if style_ref else "",
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Meshy sprite skin failed ({model}/{anim}): {type(e).__name__}: {e}",
            ) from e
        print(
            f"SpriteSkin: {model}/{anim} ← \"{prompt[:40]}\" "
            f"({meta['directions']} dirs × {meta['frame_count']} kf, "
            f"${meta['skin']['cost_usd']}, {int(time.time() - start)}s)"
        )
    elapsed_ms = int((time.time() - start) * 1000)

    frame_urls = [
        [
            f"/cache/sprite_sheet/{key}/dir_{d}_frame_{f:03d}.png"
            for f in range(int(meta["frame_count"]))
        ]
        for d in range(int(meta["directions"]))
    ]

    return {
        "ok": True,
        "hash": key,
        "meta": meta,
        "frame_urls": frame_urls,
        "generation_time_ms": elapsed_ms,
    }


@app.get("/cache/sprite_sheet/{hash_key}/{filename}")
async def get_skinned_sheet_frame(hash_key: str, filename: str):
    """Serve a single frame of a skinned sprite sheet."""
    # Tight path validation — only the canonical filename pattern is allowed.
    import re
    if not re.fullmatch(r"dir_\d+_frame_\d{3}\.png", filename):
        return Response(status_code=400, content="Invalid filename")
    path = SKINNED_SHEETS_DIR / hash_key / filename
    if not path.exists():
        return Response(status_code=404, content="Not found")
    return Response(content=path.read_bytes(), media_type="image/png")


@app.post("/develop_world")
async def develop_world_endpoint(body: DevelopWorldRequest):
    """Desarrolla el borrador de mundo de un jugador (kind MCP develop_world).
    Sin backend LLM o sin listener: 503 fail-loud (no hay fallback scripted)."""
    import asyncio

    if llm_client is None:
        raise HTTPException(status_code=503, detail="LLM backend not initialised")
    styles = style_packs.list_styles() if style_packs is not None else []
    result = await asyncio.to_thread(llm_client.develop_world, body.draft_text, styles)
    if result is None:
        raise HTTPException(
            status_code=503,
            detail="develop_world unavailable: no MCP listener (arranca Claude Code con narrative_listen) o timeout",
        )
    game = result.get("game") if isinstance(result.get("game"), dict) else result
    required = ("game_id", "title", "description", "world_brief", "world_md")
    missing = [k for k in required if not isinstance(game.get(k), str) or not game.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"develop_world response missing fields: {missing}",
        )
    return {"game": {
        "game_id": game["game_id"],
        "title": game["title"],
        "description": game["description"],
        "style_id": str(game.get("style_id", "")),
        "world_brief": game["world_brief"],
        "world_md": game["world_md"],
    }}


_STYLE_CATEGORIES = (
    "nature", "settlement", "fortress", "interior", "underground",
    "character_commoner", "character_noble", "character_warrior",
)


@app.post("/styles/upload")
async def styles_upload(body: StyleUploadRequest):
    """Crea data/styles/user_{slug}/ con las imágenes subidas y devuelve qué
    categorías faltan + coste estimado de completarlas. NO genera nada aún:
    la generación requiere confirmación explícita (/styles/{id}/complete)."""
    import re as _re
    import unicodedata

    from style_pack_builder import missing_categories
    from style_packs import _styles_dir_from_config

    styles_dir = _styles_dir_from_config()
    base = "user_" + (_re.sub(
        r"[^a-z0-9]+", "_",
        unicodedata.normalize("NFD", body.name.lower()).encode("ascii", "ignore").decode(),
    ).strip("_")[:40] or "estilo")
    style_id = base
    i = 2
    while (styles_dir / style_id).exists():
        style_id = f"{base}_{i}"
        i += 1

    pack_dir = styles_dir / style_id
    pack_dir.mkdir(parents=True)
    uploaded: list[str] = []
    for img in body.images:
        category = str(img.get("category", ""))
        if category not in _STYLE_CATEGORIES:
            raise HTTPException(status_code=422, detail=f"invalid category: {category}")
        if category in uploaded:
            raise HTTPException(status_code=422, detail=f"duplicate category: {category}")
        b64 = str(img.get("image_b64", ""))
        if "," in b64[:64]:  # tolerar data URIs
            b64 = b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"bad base64 for {category}") from e
        if len(raw) > 12 * 1024 * 1024:
            raise HTTPException(status_code=422, detail=f"image too large for {category} (>12MB)")
        try:
            pil = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"not a decodable image: {category}") from e
        w, h = pil.size
        scale = min(1.0, 1024 / max(w, h))
        if scale < 1.0:
            pil = pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        pil.save(pack_dir / f"{category}.jpg", "JPEG", quality=90)
        uploaded.append(category)

    manifest = {
        "style_id": style_id,
        "name": body.name,
        "description": body.description or f"Estilo subido por el jugador: {body.name}.",
        "style_token": body.style_token
            or f"consistent hand-crafted art style of the reference images ({body.name})",
        "cover": "cover.jpg",
        "refs": [{"category": c, "file": f"{c}.jpg", "tags": []} for c in _STYLE_CATEGORIES],
    }
    (pack_dir / "style.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Cover provisional: la primera imagen subida (se sobreescribe al completar
    # si aparece un entorno mejor).
    (pack_dir / "cover.jpg").write_bytes((pack_dir / f"{uploaded[0]}.jpg").read_bytes())

    from meshy_client import MeshyImageToImage
    missing = missing_categories(styles_dir, style_id)
    per_image = MeshyImageToImage.cost_usd(config["sprite_skin_model"]) if config else 0.18
    return {
        "style_id": style_id,
        "uploaded": uploaded,
        "missing": missing,
        "cost_per_image_usd": per_image,
        "estimated_cost_usd": round(len(missing) * per_image, 2),
    }


@app.post("/styles/{style_id}/complete")
async def styles_complete(style_id: str, body: StyleCompleteRequest):
    """Genera las categorías que faltan de un pack de usuario usando sus
    imágenes como referencia de estilo. Requiere confirm=true (coste real)."""
    import re as _re

    from style_pack_builder import generate_missing, missing_categories
    from style_packs import _styles_dir_from_config

    if not _re.fullmatch(r"[A-Za-z0-9_.-]+", style_id):
        raise HTTPException(status_code=422, detail="invalid style_id")
    if not body.confirm:
        raise HTTPException(status_code=422, detail="confirm=true required (esta llamada gasta créditos)")
    styles_dir = _styles_dir_from_config()
    if not (styles_dir / style_id / "style.json").exists():
        raise HTTPException(status_code=404, detail=f"style not found: {style_id}")
    missing = missing_categories(styles_dir, style_id)
    if not missing:
        return {"generated": [], "cost_usd": 0.0, "message": "pack ya completo"}
    try:
        result = await generate_missing(styles_dir, style_id, config["sprite_skin_model"])
    except ValueError as e:
        raise HTTPException(status_code=503, detail=f"Meshy no disponible: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"style generation failed: {e}") from e
    return result


@app.post("/report_player_choice")
async def report_player_choice(body: ReportPlayerChoiceRequest):
    """Forward a player dialogue choice to the narrative engine and return its
    consequences. No silent fallback: if there is no LLM backend or the LLM
    produces an invalid response, this endpoint returns HTTP 503 / 422 so the
    bridge surfaces the error to the client."""
    import asyncio
    if llm_client is None:
        raise HTTPException(
            status_code=503,
            detail="ai_server has no llm_client configured — no MCP listener, no API key",
        )
    try:
        result = await asyncio.to_thread(
            llm_client.report_player_choice,
            body.event_id,
            body.speaker,
            body.chosen_text,
            body.free_text,
            body.context,
        )
    except NarrativeUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        # validate_narrative_reaction raised: LLM returned invalid payload.
        raise HTTPException(
            status_code=422,
            detail=f"narrative engine returned invalid response: {e}",
        ) from e
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail=f"narrative engine returned non-dict result: {type(result).__name__}",
        )
    return result


@app.post("/review_scene_blueprint")
async def review_scene_blueprint(body: ReviewBlueprintRequest):
    """Pide a Claude (vía MCP) que MIRE el blueprint pintado y lo compare con la
    escena Format D antes de gastar créditos de generación. Devuelve
    { approved, issues, fixes? }. Fail-loud: sin listener MCP → 503; timeout →
    504; respuesta inválida del LLM → 422. Nunca 200 con error."""
    import asyncio
    if llm_client is None:
        raise HTTPException(
            status_code=503,
            detail="ai_server has no llm_client configured — no MCP listener",
        )
    # El bloque de imagen MCP exige base64 puro; aceptar también data URLs.
    image_b64 = body.image_b64
    if image_b64.startswith("data:"):
        _, _, image_b64 = image_b64.partition(",")
    try:
        result = await asyncio.to_thread(
            llm_client.review_blueprint,
            image_b64,
            body.scene,
            {"scene_id": body.scene_id},
        )
    except NarrativeUnavailable as e:
        status = 504 if "timeout" in str(e).lower() else 503
        raise HTTPException(status_code=status, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=f"blueprint review returned invalid response: {e}",
        ) from e
    return result


@app.post("/notify_session")
async def notify_session(body: NotifySessionRequest):
    """Godot calls this when the player starts or resumes a narrative session.
    The session metadata is propagated to Claude on the next bridge request."""
    if llm_client is not None:
        llm_client.set_session(body.session_id, body.game_id, body.is_resume)
    return {
        "ok": True,
        "session_id": body.session_id,
        "game_id": body.game_id,
        "is_resume": body.is_resume,
    }


@app.get("/assets")
async def list_assets(asset_type: str | None = None, limit: int = 50):
    """List indexed assets from the shared manifest. Used by the narrative engine
    to discover what's already been generated and avoid re-generation."""
    if asset_manifest is None:
        return {"assets": [], "total": 0}
    return {
        "assets": asset_manifest.list_assets(asset_type=asset_type, limit=limit),
        "total": asset_manifest.total_count(),
    }


@app.get("/assets/by_hash/{hash_key}")
async def asset_by_hash(hash_key: str):
    """Look up all manifest entries for a specific hash (may include several
    subtypes — e.g. a texture has both albedo and normal)."""
    if asset_manifest is None:
        return Response(status_code=404, content="No manifest")
    matches = asset_manifest.find_by_hash(hash_key)
    if not matches:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    enriched = []
    for m in matches:
        entry = dict(m)
        atype = m.get("type", "")
        subtype = m.get("subtype", "")
        if atype == "texture":
            entry["cache_url"] = f"/cache/{subtype}/{hash_key}"
        elif atype == "model":
            entry["cache_url"] = f"/cache/model/{hash_key}"
        elif atype == "skin":
            entry["cache_url"] = f"/cache/skin/{hash_key}"
        elif atype == "sprite":
            entry["cache_url"] = f"/cache/sprite/{hash_key}"
        enriched.append(entry)
    return {"matches": enriched}


@app.get("/cache/sprite/{hash_key}")
async def get_cached_sprite(hash_key: str):
    """Serve a cached sprite PNG (RGBA with transparency)."""
    data = sprite_cache.get_by_hash(hash_key, "sprite")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@app.get("/cache/skin/{hash_key}")
async def get_cached_skin(hash_key: str):
    """Serve a cached skin PNG."""
    data = skin_cache.get_by_hash(hash_key, "skin")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")



@app.get("/cache/scene/{hash_key}")
async def get_cached_scene(hash_key: str):
    """Serve a cached scene background PNG (full or outpainted)."""
    data = scene_cache.get_by_hash(hash_key, "scene")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@app.get("/cache/segment/{hash_key}")
async def get_cached_segment(hash_key: str):
    """Serve a cached occluder sprite PNG (RGBA cutout from the scene image)."""
    data = segment_cache.get_by_hash(hash_key, "segment")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@app.get("/cache/model/{hash_key}")
async def get_cached_model(hash_key: str):
    """Serve a cached GLB model."""
    data = model_cache.get_by_hash(hash_key, "model")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="model/gltf-binary")


@app.get("/cache/{map_type}/{hash_key}")
async def get_cached_asset(map_type: str, hash_key: str):
    """Serve a cached texture PNG."""
    if map_type not in ("albedo", "normal", "roughness"):
        return Response(status_code=400, content="Invalid map type")

    data = asset_cache.get_by_hash(hash_key, map_type)
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@app.get("/cache/check/{hash_key}")
async def check_cache(hash_key: str):
    """Check if a texture set is cached."""
    cache_dir = asset_cache.cache_dir / hash_key
    if not cache_dir.exists():
        return {"exists": False, "maps": []}
    maps = [f.stem for f in cache_dir.iterdir() if f.suffix == ".png"]
    return {"exists": bool(maps), "maps": maps}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NE-Fan AI Server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
