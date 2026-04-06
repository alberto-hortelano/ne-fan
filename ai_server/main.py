"""AI Server: narrative + texture generation for LLM-powered world generation.

Start with: python ai_server/main.py [--port 8765]
"""

import json
import time
import argparse
from pathlib import Path
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response

from llm_client import LLMClient
from texture_generator import TextureGenerator
from model_generator import ModelGenerator
from skin_generator import SkinGenerator
from sprite_generator import SpriteGenerator
from asset_cache import AssetCache

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
    global llm_client, texture_gen, model_gen, skin_gen, sprite_gen, asset_cache, model_cache, skin_cache, sprite_cache, config
    config = load_config()

    llm_client = LLMClient(
        model=config.get("llm_model", "claude-sonnet-4-5-20250514"),
    )

    asset_cache = AssetCache(
        cache_dir=config.get("texture_cache_dir", "cache/textures"),
    )

    texture_gen = TextureGenerator(
        width=config.get("texture_resolution", 512),
        height=config.get("texture_resolution", 512),
        steps=config.get("texture_steps", 4),
        lazy=config.get("texture_lazy_load", True),
    )

    model_cache = AssetCache(
        cache_dir=config.get("model_cache_dir", "cache/models"),
    )

    model_gen = ModelGenerator(
        texture_gen_ref=texture_gen,
        lazy=True,
    )

    skin_cache = AssetCache(
        cache_dir=config.get("skin_cache_dir", "cache/skins"),
    )

    skin_gen = SkinGenerator(
        texture_gen_ref=texture_gen,
    )

    sprite_cache = AssetCache(
        cache_dir=config.get("sprite_cache_dir", "cache/sprites"),
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
    """Generate an RGBA sprite PNG from a prompt (image with transparent background)."""
    import asyncio

    body = await request.json()
    prompt = body.get("prompt", "")
    width = body.get("width", 512)
    height = body.get("height", 512)
    seed = body.get("seed", -1)

    if not prompt:
        return {"error": "missing prompt"}

    key = sprite_cache.hash_key(prompt)

    if sprite_cache.has(prompt, "sprite"):
        return {
            "hash": key,
            "cached": True,
            "sprite_url": f"/cache/sprite/{key}",
        }

    start = time.time()
    async with _gpu_lock:
        result = await asyncio.to_thread(sprite_gen.generate, prompt, width, height, seed)
    elapsed_ms = int((time.time() - start) * 1000)

    sprite_cache.put(prompt, "sprite", result["sprite"])

    return {
        "hash": key,
        "cached": False,
        "sprite_url": f"/cache/sprite/{key}",
        "generation_time_ms": elapsed_ms,
    }


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
