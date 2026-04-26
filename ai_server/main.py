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
from fastapi import FastAPI, Request
from fastapi.responses import Response


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
from sprite_generator import SpriteGenerator
from asset_cache import AssetCache, AssetManifest

import asyncio as _asyncio

# Global instances
llm_client: LLMClient | None = None
texture_gen: TextureGenerator | None = None
model_gen: ModelGenerator | None = None
skin_gen: SkinGenerator | None = None
sprite_gen: SpriteGenerator | None = None
asset_cache: AssetCache | None = None
model_cache: AssetCache | None = None
skin_cache: AssetCache | None = None
sprite_cache: AssetCache | None = None
asset_manifest: AssetManifest | None = None
config: dict = {}
_gpu_lock = _asyncio.Lock()  # Serialize ALL GPU operations


def load_config(config_path: str = "Config/ai_server_config.json") -> dict:
    path = Path(config_path)
    if not path.exists():
        path = Path(__file__).resolve().parent.parent / config_path
    if path.exists():
        print(f"Config loaded from: {path}")
        with open(path) as f:
            return json.load(f)
    return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global llm_client, texture_gen, model_gen, skin_gen, sprite_gen, asset_cache, model_cache, skin_cache, sprite_cache, asset_manifest, config
    config = load_config()

    # Shared manifest sits at the cache root and tracks every asset across types.
    from pathlib import Path as _P
    cache_root = _P(config.get("cache_root", "cache"))
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
        if added_total > 0:
            print(f"AssetManifest: recovered {added_total} pre-existing assets")

    llm_client = LLMClient(
        model=config.get("llm_model", "claude-sonnet-4-5-20250514"),
        asset_manifest=asset_manifest,
    )

    asset_cache = AssetCache(
        cache_dir=config.get("texture_cache_dir", "cache/textures"),
        asset_type="texture",
        manifest=asset_manifest,
    )

    texture_gen = TextureGenerator(
        width=config.get("texture_resolution", 512),
        height=config.get("texture_resolution", 512),
        steps=config.get("texture_steps", 4),
        lazy=config.get("texture_lazy_load", True),
    )

    model_cache = AssetCache(
        cache_dir=config.get("model_cache_dir", "cache/models"),
        asset_type="model",
        manifest=asset_manifest,
    )

    model_gen = ModelGenerator(
        texture_gen_ref=texture_gen,
        lazy=True,
    )

    skin_cache = AssetCache(
        cache_dir=config.get("skin_cache_dir", "cache/skins"),
        asset_type="skin",
        manifest=asset_manifest,
    )

    skin_gen = SkinGenerator(
        texture_gen_ref=texture_gen,
    )

    sprite_cache = AssetCache(
        cache_dir=config.get("sprite_cache_dir", "cache/sprites"),
        asset_type="sprite",
        manifest=asset_manifest,
    )

    sprite_gen = SpriteGenerator(
        texture_gen_ref=texture_gen,
    )

    print(f"\nAI Server ready. HTTP :{config.get('port', 8765)}")
    yield
    llm_client = None
    texture_gen = None
    model_gen = None


app = FastAPI(title="NE-Fan AI Server", lifespan=lifespan)


@app.get("/health")
async def health():
    return {
        "status": "ready" if llm_client else "loading",
        "mode": "narrative",
        "texture_pipeline": "loaded" if (texture_gen and texture_gen.is_loaded) else "lazy",
    }


@app.post("/populate_room")
async def populate_room(request: Request):
    """Accept world state JSON, call Claude API, return structured room data."""
    import asyncio

    world_state = await request.json()
    result = await asyncio.to_thread(llm_client.populate_room, world_state)
    return result


@app.post("/generate_room")
async def generate_room(request: Request):
    """Accept world state JSON, return extended room data for Godot 3D engine."""
    import asyncio

    world_state = await request.json()
    result = await asyncio.to_thread(llm_client.generate_room, world_state)
    return result


@app.post("/generate_scene")
async def generate_scene(request: Request):
    """Accept premise + setting, return outdoor scene JSON for open world."""
    import asyncio

    scene_request = await request.json()
    result = await asyncio.to_thread(llm_client.generate_scene, scene_request)
    return result


@app.post("/generate_texture")
async def generate_texture_endpoint(request: Request):
    """Generate PBR texture set from a prompt. Returns URLs to cached PNGs."""
    import asyncio

    body = await request.json()
    prompt = body.get("prompt", "")
    seed = body.get("seed", -1)

    if not prompt:
        return {"error": "missing prompt"}

    key = asset_cache.hash_key(prompt)

    # Check cache first
    if asset_cache.has_all(prompt, ["albedo", "normal"]):
        return {
            "hash": key,
            "cached": True,
            "albedo_url": f"/cache/albedo/{key}",
            "normal_url": f"/cache/normal/{key}",
        }

    # Generate (serialized — CUDA doesn't support concurrent access)
    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(texture_gen.generate, prompt, seed)
    elapsed_ms = int((time.time() - start) * 1000)

    # Store in cache
    asset_cache.put(prompt, "albedo", result["albedo"])
    asset_cache.put(prompt, "normal", result["normal"])

    return {
        "hash": key,
        "cached": False,
        "albedo_url": f"/cache/albedo/{key}",
        "normal_url": f"/cache/normal/{key}",
        "generation_time_ms": elapsed_ms,
    }


@app.post("/generate_model")
async def generate_model_endpoint(request: Request):
    """Generate a 3D model (GLB) from a prompt."""
    import asyncio

    body = await request.json()
    prompt = body.get("prompt", "")
    scale = body.get("scale", [0.5, 0.5, 0.5])
    seed = body.get("seed", -1)
    quality = body.get("quality", "normal")

    if not prompt:
        return {"error": "missing prompt"}

    key = model_cache.hash_key(prompt)

    # Check cache
    if model_cache.has(prompt, "model"):
        return {
            "hash": key,
            "cached": True,
            "model_url": f"/cache/model/{key}",
        }

    # Generate (serialized with textures via GPU lock)
    start = time.time()
    async with _gpu_lock:
        glb_bytes = await asyncio.to_thread(model_gen.generate, prompt, scale, seed, quality)
    elapsed_ms = int((time.time() - start) * 1000)

    model_cache.put(prompt, "model", glb_bytes)

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
async def analyze_weapon_endpoint(request: Request):
    """Vision-guided weapon orientation. Receives images of a 3D weapon and
    returns grip point + orientation vectors for placement."""
    import asyncio

    body = await request.json()
    images = body.get("images", [])
    weapon_type = body.get("weapon_type", "generic")
    kind = body.get("kind", "weapon_orient")
    context = body.get("context", {})

    if not images:
        return {"error": "missing images"}

    if llm_client is None:
        return {"error": "llm_client unavailable", "fallback": True}

    result = await asyncio.to_thread(
        llm_client.analyze_weapon, images, weapon_type, kind, context
    )

    if result is None:
        return {"error": "vision unavailable", "fallback": True}

    return result


@app.post("/generate_skin")
async def generate_skin_endpoint(request: Request):
    """Generate a character skin variant via img2img on the base Paladin UV."""
    import asyncio

    body = await request.json()
    prompt = body.get("prompt", "")
    strength = body.get("strength", -1)
    gamma = body.get("gamma", 0.35)
    seed = body.get("seed", -1)

    if not prompt:
        return {"error": "missing prompt"}

    key = skin_cache.hash_key(prompt)

    if skin_cache.has(prompt, "skin"):
        return {
            "hash": key,
            "cached": True,
            "skin_url": f"/cache/skin/{key}",
        }

    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(skin_gen.generate, prompt, strength, gamma, seed)
    elapsed_ms = int((time.time() - start) * 1000)

    skin_cache.put(prompt, "skin", result["skin"])

    return {
        "hash": key,
        "cached": False,
        "skin_url": f"/cache/skin/{key}",
        "generation_time_ms": elapsed_ms,
    }


@app.post("/generate_sprite")
async def generate_sprite_endpoint(request: Request):
    """Generate an RGBA sprite PNG from a prompt (image with transparent background).

    Accepts an optional ``angle`` (top_down | isometric_30 | isometric_45 |
    frontal) so 2D-world assets match the projection of pre-rendered Mixamo
    sprite sheets. ``angle`` and ``style_token`` participate in the cache key,
    so the same prompt at different angles cache independently.
    """
    import asyncio

    body = await request.json()
    prompt = body.get("prompt", "")
    width = body.get("width", 512)
    height = body.get("height", 512)
    seed = body.get("seed", -1)
    angle = body.get("angle", "top_down")
    style_token = body.get("style_token") or None

    if not prompt:
        return {"error": "missing prompt"}

    context = {"angle": angle}
    if style_token:
        context["style_token"] = style_token

    key = sprite_cache.hash_key(prompt, context)

    if sprite_cache.has(prompt, "sprite", context):
        return {
            "hash": key,
            "cached": True,
            "sprite_url": f"/cache/sprite/{key}",
            "angle": angle,
        }

    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(
            sprite_gen.generate, prompt, width, height, seed, angle, style_token
        )
    elapsed_ms = int((time.time() - start) * 1000)

    sprite_cache.put(prompt, "sprite", result["sprite"], context=context, subtype_override="sprite_2d")

    return {
        "hash": key,
        "cached": False,
        "sprite_url": f"/cache/sprite/{key}",
        "angle": angle,
        "generation_time_ms": elapsed_ms,
    }


@app.post("/report_player_choice")
async def report_player_choice(request: Request):
    """Forward a player dialogue choice to the narrative engine and return its
    consequences (story_update / spawn_entity / schedule_event). Used by Godot
    when the player picks a numbered option or types a free-text reply."""
    import asyncio
    body = await request.json()
    if llm_client is None:
        return {"consequences": []}
    result = await asyncio.to_thread(
        llm_client.report_player_choice,
        str(body.get("event_id", "")),
        str(body.get("speaker", "")),
        str(body.get("chosen_text", "")),
        str(body.get("free_text", "")),
        body.get("context", {}) if isinstance(body.get("context"), dict) else {},
    )
    return result if isinstance(result, dict) else {"consequences": []}


@app.post("/notify_session")
async def notify_session(request: Request):
    """Godot calls this when the player starts or resumes a narrative session.
    The session metadata is propagated to Claude on the next bridge request."""
    body = await request.json()
    session_id = str(body.get("session_id", ""))
    game_id = str(body.get("game_id", ""))
    is_resume = bool(body.get("is_resume", False))
    if not session_id or not game_id:
        return Response(status_code=400, content="session_id and game_id required")
    if llm_client is not None:
        llm_client.set_session(session_id, game_id, is_resume)
    return {"ok": True, "session_id": session_id, "game_id": game_id, "is_resume": is_resume}


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
    parser.add_argument("--config", default="Config/ai_server_config.json")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
