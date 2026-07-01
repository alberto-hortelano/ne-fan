"""AI Server: narrative + texture generation for LLM-powered world generation.

Start with: python ai_server/main.py [--port 8765]
"""

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
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
from controlnet_skin import ControlNetSkinGenerator, seed_for
from scene_image_generator import SceneImageGenerator, SIDES
from fal_client import FalSamClient
from scene_segmenter import SceneSegmenter
from asset_cache import AssetCache, AssetManifest

import asyncio as _asyncio

# Global instances
llm_client: LLMClient | None = None
texture_gen: TextureGenerator | None = None
model_gen: ModelGenerator | None = None
skin_gen: SkinGenerator | None = None
controlnet_skin_gen: ControlNetSkinGenerator | None = None
sprite_gen: SpriteGenerator | None = None
scene_image_gen: SceneImageGenerator | None = None
scene_segmenter: SceneSegmenter | None = None
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
    global llm_client, texture_gen, model_gen, skin_gen, sprite_gen, asset_cache, model_cache, skin_cache, sprite_cache, scene_cache, segment_cache, asset_manifest, config, controlnet_skin_gen, scene_image_gen, scene_segmenter
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

    segment_cache = AssetCache(
        cache_dir=config["segment_cache_dir"],
        asset_type="segment",
        manifest=asset_manifest,
    )

    # Occluder segmentation is OPTIONAL: it needs FAL_KEY. If the user hasn't
    # added it yet the server still starts; /segment_scene_image returns 503.
    try:
        scene_segmenter = SceneSegmenter(
            fal_client=FalSamClient(
                segment_model=config["segment_model"],
                discover_model=config["discover_model"],
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
    """/generate_scene accepts two request shapes:
    - the bridge's LlmContext (nefan-core/src/narrative/types.ts):
      session_id, game_id, world, player + extras
    - ScenarioRunner's load_game bypass: premise, setting, scene_id,
      scene_description
    Extra fields pass through to the narrative engine untouched so the TS
    side can add context without a lockstep deploy; the validator only
    enforces that one complete shape is present."""
    model_config = ConfigDict(extra="allow")

    # LlmContext shape
    session_id: str | None = None
    game_id: str | None = None
    world: dict | None = None
    player: dict | None = None
    # ScenarioRunner bypass shape
    premise: str | None = None
    scene_id: str | None = None

    @model_validator(mode="after")
    def _require_one_shape(self) -> "GenerateSceneRequest":
        is_context = bool(
            self.session_id and self.game_id
            and self.world is not None and self.player is not None
        )
        is_bypass = bool(self.premise and self.scene_id)
        if not (is_context or is_bypass):
            raise ValueError(
                "expected either an LlmContext (session_id, game_id, world, player) "
                "or a ScenarioRunner payload (premise, scene_id)"
            )
        return self


class AnalyzeWeaponRequest(BaseModel):
    images: list[str] = Field(min_length=1)
    weapon_type: str = "generic"
    kind: str = "weapon_orient"
    context: dict = Field(default_factory=dict)


class SceneImageRequest(BaseModel):
    """Full-scene img2img from the 2D client's schematic capture.

    `image_b64` is the base64-encoded PNG the Canvas renderer exports (terrain
    plate + object rectangles, no characters). The result is a painted top-down
    scene that maps 1:1 onto the same world rectangle."""
    image_b64: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    strength: float = 0.85
    seed: int = -1
    # Tuning knobs (dev). guidance ~6 for SDXL. controlnet_scale holds the
    # layout (~0.5 = furniture/structures land on the boxes but with artistic
    # freedom; higher hugs the boxes tighter, lower strays more).
    guidance: float = 6.0
    controlnet_scale: float = 0.5


class OutpaintSceneRequest(BaseModel):
    """Extend an existing scene image outward on one side. `side` is in image
    space (left=minX, right=maxX, top=minZ, bottom=maxZ)."""
    image_b64: str = Field(min_length=1)
    side: str = Field(min_length=1)
    expand_px: int = 256
    prompt: str = ""
    seed: int = -1


class Occluder(BaseModel):
    """A known scene object to cut out of the generated image. `box_px` is its
    approximate pixel box in the scene image: [x_min, y_min, x_max, y_max]."""
    id: str = Field(min_length=1)
    box_px: list[int] = Field(min_length=4, max_length=4)


class SegmentSceneRequest(BaseModel):
    """Cut occluder sprites out of an AI-painted scene image (SAM via fal.ai).

    `image_b64` is the same scene PNG the client is displaying; `occluders` are
    the known building/prop objects with their pixel boxes. Returns one cropped
    RGBA sprite per occluder for the client to depth-sort against the player."""
    image_b64: str = Field(min_length=1)
    occluders: list[Occluder] = Field(min_length=1)


# Default vocabulary of solid dark-fantasy props the image model tends to invent.
# Each concept is one SAM3 open-vocab call; keep the list focused (cost + noise).
_DISCOVER_CONCEPTS = [
    "statue", "barrel", "crate", "urn", "brazier",
    "well", "cauldron", "tombstone", "stone pillar", "boulder",
]


class DiscoverSceneRequest(BaseModel):
    """Phase 3: open-vocabulary discovery of props the image model invented that
    were NOT in the schematic. `known_boxes` are the pixel boxes of objects we
    already handle ([x_min,y_min,x_max,y_max]) so they are filtered out. Returns
    new objects (sprite + footprint) for the client to give occlusion + collision."""
    image_b64: str = Field(min_length=1)
    known_boxes: list[list[int]] = Field(default_factory=list)
    concepts: list[str] | None = None


@app.get("/health")
async def health():
    return {
        "status": "ready" if llm_client else "loading",
        "mode": "narrative",
        "texture_pipeline": "loaded" if (texture_gen and texture_gen.is_loaded) else "lazy",
    }


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
        raise HTTPException(status_code=503, detail=str(e))


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

    key = model_cache.hash_key(body.prompt)

    # Check cache
    if model_cache.has(body.prompt, "model"):
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

    model_cache.put(body.prompt, "model", glb_bytes)

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
            vision_status = api_or_down("bridge error: %s" % bridge["error"])
        elif bridge.get("listener_active"):
            ago: float = bridge.get("last_listen_seconds_ago", -1)
            vision_status = {
                "state": "ready",
                "message": "MCP listener activo (último listen hace %.0fs)" % max(ago, 0),
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
        raise HTTPException(status_code=400, detail=f"invalid base64 image: {e}")


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
    # image cached under a different generator.
    context = {"layout": layout, "kind": "full", "model": scene_image_gen._model}
    key = scene_cache.hash_key(body.prompt, context)

    if scene_cache.has(body.prompt, "scene", context):
        return {"hash": key, "cached": True, "scene_url": f"/cache/scene/{key}"}

    # No _gpu_lock: scene generation runs remotely on Meshy (no local GPU), so
    # holding the lock would needlessly block texture/3D GPU work for ~30s.
    start = time.time()
    result = await asyncio.to_thread(
        scene_image_gen.generate_full, png, body.prompt, body.strength,
        body.seed, body.guidance, body.controlnet_scale,
    )
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


@app.post("/outpaint_scene_image")
async def outpaint_scene_image_endpoint(body: OutpaintSceneRequest):
    """Extend an existing scene image outward on one side via SD inpaint.
    Cached by (prompt, base layout, side, expand_px)."""
    import asyncio
    import hashlib

    if scene_image_gen is None:
        raise HTTPException(status_code=503, detail="scene_image_gen unavailable")
    if body.side not in SIDES:
        raise HTTPException(
            status_code=422, detail=f"side must be one of {SIDES}, got {body.side!r}"
        )

    png = _decode_b64_png(body.image_b64)
    base_layout = hashlib.sha256(png).hexdigest()[:16]
    context = {
        "layout": base_layout,
        "kind": "outpaint",
        "side": body.side,
        "expand_px": body.expand_px,
        "model": scene_image_gen._model,
    }
    key = scene_cache.hash_key(body.prompt, context)

    if scene_cache.has(body.prompt, "scene", context):
        return {"hash": key, "cached": True, "scene_url": f"/cache/scene/{key}"}

    start = time.time()
    result = await asyncio.to_thread(
        scene_image_gen.outpaint,
        png, body.side, body.expand_px, body.prompt, body.seed,
    )
    elapsed_ms = int((time.time() - start) * 1000)

    scene_cache.put(body.prompt, "scene", result["scene"], context=context)

    return {
        "hash": key,
        "cached": False,
        "scene_url": f"/cache/scene/{key}",
        "side": result["side"],
        "expand_px": result["expand_px"],
        "width": result["width"],
        "height": result["height"],
        "generation_time_ms": elapsed_ms,
    }


@app.post("/segment_scene_image")
async def segment_scene_image_endpoint(body: SegmentSceneRequest):
    """Segment known occluders (buildings/props) out of the scene image so the
    client can depth-sort them against the player. One fal SAM call per occluder;
    each cropped RGBA sprite is cached by (scene layout, occluder id, box, model)."""
    import asyncio
    import hashlib

    if scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="scene_segmenter unavailable — set FAL_KEY in .env to enable occluder segmentation",
        )

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    model = scene_segmenter._fal.model

    # Split occluders into cache hits (served straight away) and misses (segment).
    segments: list[dict] = []
    misses: list[dict] = []
    keys: dict[str, str] = {}
    for occ in body.occluders:
        box_str = ",".join(str(v) for v in occ.box_px)
        context = {"scene": layout, "box": box_str, "model": model}
        key = segment_cache.hash_key(occ.id, context)
        keys[occ.id] = key
        if segment_cache.has(occ.id, "segment", context):
            bbox_meta = segment_cache.get_by_hash(key, "bbox")
            if bbox_meta is not None:
                segments.append({"id": occ.id, "key": key, "bbox_json": bbox_meta})
                continue
        misses.append({"id": occ.id, "box_px": occ.box_px, "context": context, "key": key})

    if misses:
        produced = await asyncio.to_thread(
            scene_segmenter.segment_occluders,
            png,
            [{"id": m["id"], "box_px": m["box_px"]} for m in misses],
        )
        by_id = {p["id"]: p for p in produced}
        for m in misses:
            p = by_id.get(m["id"])
            if p is None:
                continue  # empty mask — segmenter logged the skip
            ctx = m["context"]
            segment_cache.put(m["id"], "segment", p["sprite_png_bytes"], context=ctx)
            # Persist the placement metadata alongside the sprite so cache hits
            # can answer without re-segmenting. Stored as a `bbox` map in the same
            # hash dir (AssetCache forces a .png suffix; the bytes are JSON).
            bbox_json = json.dumps({
                "image_bbox": p["image_bbox"], "img_w": p["img_w"], "img_h": p["img_h"],
            }).encode()
            segment_cache.put(m["id"], "bbox", bbox_json, context=ctx, subtype_override="bbox")
            segments.append({"id": m["id"], "key": m["key"], "bbox_json": bbox_json})

    result = []
    for s in segments:
        meta = json.loads(s["bbox_json"])
        result.append({
            "id": s["id"],
            "sprite_url": f"/cache/segment/{s['key']}",
            "image_bbox": meta["image_bbox"],
            "img_w": meta["img_w"],
            "img_h": meta["img_h"],
        })
    return {"segments": result}


@app.post("/discover_scene_objects")
async def discover_scene_objects_endpoint(body: DiscoverSceneRequest):
    """Discover props the image model invented (SAM3 open-vocab) and return them
    as new objects (sprite + footprint) so the client can give them occlusion +
    collision. Cached by (scene layout, concept set, model)."""
    import asyncio
    import hashlib

    if scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="scene_segmenter unavailable — set FAL_KEY in .env to enable discovery",
        )

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    concepts = body.concepts or _DISCOVER_CONCEPTS
    model = scene_segmenter._fal.discover_model
    ctx = {"layout": layout, "concepts": ",".join(concepts), "model": model}
    key = segment_cache.hash_key("discovery", ctx)

    cached = segment_cache.get_by_hash(key, "discovery")
    if cached is not None:
        return {"discovered": json.loads(cached)}

    produced = await asyncio.to_thread(
        scene_segmenter.discover_objects, png, body.known_boxes, concepts,
    )

    discovered = []
    for p in produced:
        sprite_hash = hashlib.sha256(p["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = segment_cache.put(sprite_hash, "segment", p["sprite_png_bytes"])
        discovered.append({
            "id": p["id"],
            "sprite_url": f"/cache/segment/{sprite_key}",
            "image_bbox": p["image_bbox"],
            "img_w": p["img_w"],
            "img_h": p["img_h"],
            "score": p["score"],
            "concept": p["concept"],
        })

    segment_cache.put("discovery", "discovery", json.dumps(discovered).encode(),
                      context=ctx, subtype_override="discovery")
    return {"discovered": discovered}


# Where the HTML 2D client serves Mixamo sprite sheets from. Resolved relative
# to the project root so the ai_server can read them off disk and run img2img
# over each frame.
SPRITE_SHEETS_DIR = Path(__file__).resolve().parent.parent / "nefan-html" / "public" / "sprites"
SKINNED_SHEETS_DIR = Path(__file__).resolve().parent.parent / "cache" / "sprite_sheets"


def _skin_sheet_key(model: str, anim: str, angle: str, prompt: str) -> str:
    """Hash that invalidates whenever the underlying Mixamo sheet is
    re-rendered. Including the base meta.json mtime guarantees the skinned
    cache rebuilds on top of the latest frames; otherwise a re-render of the
    base would silently keep the stale skinned variant alive.
    """
    import hashlib
    base_meta = SPRITE_SHEETS_DIR / model / anim / angle / "meta.json"
    base_stamp = str(int(base_meta.stat().st_mtime)) if base_meta.exists() else "0"
    payload = "\n".join([model, anim, angle, prompt.strip().lower(), base_stamp])
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


@app.post("/skin_sprite_sheet")
async def skin_sprite_sheet_endpoint(request: Request):
    """Apply img2img with `prompt` to every frame of a pre-rendered Mixamo
    sheet at `nefan-html/public/sprites/{model}/{anim}/{angle}/` and serve the
    resulting frames from `/cache/sprite_sheet/{hash}/dir_D_frame_FFF.png`.

    Body: {model, anim, angle, prompt, strength?, gamma?}
    Returns: {ok, hash, meta, frame_urls: [[url, ...], ...]}
    """
    import asyncio
    from PIL import Image
    import io

    body = await request.json()
    model = str(body.get("model", "")).strip()
    anim = str(body.get("anim", "idle")).strip()
    angle = str(body.get("angle", "isometric_30")).strip()
    prompt = str(body.get("prompt", "")).strip()
    # 0.40 is the strength sweet spot we landed on with ControlNet+canny:
    # high enough to repaint clothing/skin, low enough that the silhouette
    # the canny edges encode still drives the result. Tuned alongside
    # controlnet_scale=0.5 in ControlNetSkinGenerator.
    strength = float(body.get("strength", 0.40))

    if not (model and prompt):
        return {"ok": False, "error": "missing model or prompt"}

    sheet_dir = SPRITE_SHEETS_DIR / model / anim / angle
    meta_path = sheet_dir / "meta.json"
    if not meta_path.exists():
        return {"ok": False, "error": f"sheet not found: {model}/{anim}/{angle}"}

    with open(meta_path) as f:
        meta = json.load(f)

    key = _skin_sheet_key(model, anim, angle, prompt)
    out_dir = SKINNED_SHEETS_DIR / key
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build the URL list eagerly so the client can start downloading frames
    # the moment they hit disk. Each cached frame is reused on subsequent
    # requests with the same (model, anim, angle, prompt) tuple.
    directions = int(meta.get("directions", 1))
    frame_count = int(meta.get("frame_count", 1))
    frame_urls: list[list[str]] = []

    def frame_path(d: int, f: int) -> Path:
        return out_dir / f"dir_{d}_frame_{f:03d}.png"

    def src_path(d: int, f: int) -> Path:
        return sheet_dir / f"dir_{d}_frame_{f:03d}.png"

    # ControlNet (canny) anchors the silhouette across every frame, and the
    # seed is derived from (model, anim, prompt) so the same character is
    # sampled for every frame instead of re-rolling clothing 116 times.
    seed = seed_for(prompt, salt=f"{model}|{anim}|{angle}")

    def render_one(src: Path, dst: Path) -> None:
        base = Image.open(src).convert("RGBA")
        png_bytes = controlnet_skin_gen.generate_to_bytes(
            base, prompt, seed=seed, strength=strength
        )
        dst.write_bytes(png_bytes)

    start = time.time()
    async with _gpu_lock:
        for d in range(directions):
            row: list[str] = []
            for f in range(frame_count):
                dst = frame_path(d, f)
                if not dst.exists():
                    src = src_path(d, f)
                    if not src.exists():
                        continue
                    await asyncio.to_thread(render_one, src, dst)
                row.append(f"/cache/sprite_sheet/{key}/dir_{d}_frame_{f:03d}.png")
            frame_urls.append(row)
    elapsed_ms = int((time.time() - start) * 1000)

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
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        # validate_narrative_reaction raised: LLM returned invalid payload.
        raise HTTPException(
            status_code=422,
            detail=f"narrative engine returned invalid response: {e}",
        )
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail=f"narrative engine returned non-dict result: {type(result).__name__}",
        )
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
    return Response(content=data, media_type="image/png")


@app.get("/cache/skin/{hash_key}")
async def get_cached_skin(hash_key: str):
    """Serve a cached skin PNG."""
    data = skin_cache.get_by_hash(hash_key, "skin")
    if data is None:
        return Response(status_code=404, content="Not found")
    return Response(content=data, media_type="image/png")



@app.get("/cache/scene/{hash_key}")
async def get_cached_scene(hash_key: str):
    """Serve a cached scene background PNG (full or outpainted)."""
    data = scene_cache.get_by_hash(hash_key, "scene")
    if data is None:
        return Response(status_code=404, content="Not found")
    return Response(content=data, media_type="image/png")


@app.get("/cache/segment/{hash_key}")
async def get_cached_segment(hash_key: str):
    """Serve a cached occluder sprite PNG (RGBA cutout from the scene image)."""
    data = segment_cache.get_by_hash(hash_key, "segment")
    if data is None:
        return Response(status_code=404, content="Not found")
    return Response(content=data, media_type="image/png")


@app.get("/cache/model/{hash_key}")
async def get_cached_model(hash_key: str):
    """Serve a cached GLB model."""
    data = model_cache.get_by_hash(hash_key, "model")
    if data is None:
        return Response(status_code=404, content="Not found")
    return Response(content=data, media_type="model/gltf-binary")


@app.get("/cache/{map_type}/{hash_key}")
async def get_cached_asset(map_type: str, hash_key: str):
    """Serve a cached texture PNG."""
    if map_type not in ("albedo", "normal", "roughness"):
        return Response(status_code=400, content="Invalid map type")

    data = asset_cache.get_by_hash(hash_key, map_type)
    if data is None:
        return Response(status_code=404, content="Not found")

    return Response(content=data, media_type="image/png")


@app.get("/cache/check/{hash_key}")
async def check_cache(hash_key: str):
    """Check if a texture set is cached."""
    from pathlib import Path
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
