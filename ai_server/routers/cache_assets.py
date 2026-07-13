"""Cache y assets: sirve blobs cacheados, manifest indexado y toggle dev.

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
OJO al orden de registro: /cache/{map_type}/{hash_key} se declara ANTES de
/cache/check/{hash_key}, igual que estaban en main.py — Starlette resuelve
por orden de registro (primer match completo gana) y este orden es parte del
contrato HTTP observable.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from asset_paths import SKINNED_SHEETS_DIR
from deps import deps
from dev_api_cache import DEV_API_CACHE

router = APIRouter()


def _cache_dirs_by_type() -> dict[str, Path]:
    """asset_type → raíz del cache de ese tipo (el blob vive en {dir}/{hash})."""
    return {
        "texture": Path(deps.config["texture_cache_dir"]),
        "model": Path(deps.config["model_cache_dir"]),
        "skin": Path(deps.config["skin_cache_dir"]),
        "sprite": Path(deps.config["sprite_cache_dir"]),
        "scene": Path(deps.config["scene_cache_dir"]),
        "segment": Path(deps.config["segment_cache_dir"]),
    }


def _touch_asset(hash_key: str) -> None:
    """Marca un asset como usado para el LRU del prune (no-op sin manifest)."""
    if deps.asset_manifest is not None:
        deps.asset_manifest.touch(hash_key)


class DevApiCacheRequest(BaseModel):
    enabled: bool


@router.get("/dev/api_cache")
async def dev_api_cache_status():
    """Estado del cache de modo dev (toggle de la top bar del cliente 2D):
    on/off + último payload guardado por canal de API."""
    return DEV_API_CACHE.status()


@router.post("/dev/api_cache")
async def dev_api_cache_toggle(body: DevApiCacheRequest):
    """Enciende/apaga el modo dev: con él activo, cada API de IA de pago
    (Meshy i2i, Meshy 3D, fal) devuelve su última respuesta cacheada en vez
    de llamar de verdad. Persiste en disco (sobrevive reinicios)."""
    DEV_API_CACHE.set_enabled(body.enabled)
    return DEV_API_CACHE.status()


@router.post("/cache/prune")
async def prune_cache():
    """Fuerza una pasada de eviction LRU hasta bajar de cache_max_bytes."""
    if deps.asset_manifest is None:
        raise HTTPException(status_code=503, detail="manifest not ready")
    max_cache_bytes = int(deps.config["cache_max_bytes"])
    if max_cache_bytes <= 0:
        raise HTTPException(status_code=400, detail="cache_max_bytes is 0 (no limit configured)")
    summary = deps.asset_manifest.prune(_cache_dirs_by_type(), max_cache_bytes)
    return {"ok": True, **summary}


@router.get("/cache/sprite_sheet/{hash_key}/{filename}")
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


@router.get("/assets")
async def list_assets(asset_type: str | None = None, limit: int = 50):
    """List indexed assets from the shared manifest. Used by the narrative engine
    to discover what's already been generated and avoid re-generation."""
    if deps.asset_manifest is None:
        return {"assets": [], "total": 0}
    return {
        "assets": deps.asset_manifest.list_assets(asset_type=asset_type, limit=limit),
        "total": deps.asset_manifest.total_count(),
    }


@router.get("/assets/by_hash/{hash_key}")
async def asset_by_hash(hash_key: str):
    """Look up all manifest entries for a specific hash (may include several
    subtypes — e.g. a texture has both albedo and normal)."""
    if deps.asset_manifest is None:
        return Response(status_code=404, content="No manifest")
    matches = deps.asset_manifest.find_by_hash(hash_key)
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


@router.get("/cache/sprite/{hash_key}")
async def get_cached_sprite(hash_key: str):
    """Serve a cached sprite PNG (RGBA with transparency)."""
    data = deps.sprite_cache.get_by_hash(hash_key, "sprite")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/skin/{hash_key}")
async def get_cached_skin(hash_key: str):
    """Serve a cached skin PNG."""
    data = deps.skin_cache.get_by_hash(hash_key, "skin")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/scene/{hash_key}")
async def get_cached_scene(hash_key: str):
    """Serve a cached scene background PNG (full or outpainted)."""
    data = deps.scene_cache.get_by_hash(hash_key, "scene")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/plate/{hash_key}")
async def get_cached_plate(hash_key: str):
    """Serve a cached scene background plate (scene minus tall objects)."""
    data = deps.scene_cache.get_by_hash(hash_key, "plate")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/segment/{hash_key}")
async def get_cached_segment(hash_key: str):
    """Serve a cached occluder sprite PNG (RGBA cutout from the scene image)."""
    data = deps.segment_cache.get_by_hash(hash_key, "segment")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/model/{hash_key}")
async def get_cached_model(hash_key: str):
    """Serve a cached GLB model."""
    data = deps.model_cache.get_by_hash(hash_key, "model")
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="model/gltf-binary")


@router.get("/cache/{map_type}/{hash_key}")
async def get_cached_asset(map_type: str, hash_key: str):
    """Serve a cached texture PNG."""
    if map_type not in ("albedo", "normal", "roughness"):
        return Response(status_code=400, content="Invalid map type")

    data = deps.asset_cache.get_by_hash(hash_key, map_type)
    if data is None:
        return Response(status_code=404, content="Not found")
    _touch_asset(hash_key)
    return Response(content=data, media_type="image/png")


@router.get("/cache/check/{hash_key}")
async def check_cache(hash_key: str):
    """Check if a texture set is cached."""
    cache_dir = deps.asset_cache.cache_dir / hash_key
    if not cache_dir.exists():
        return {"exists": False, "maps": []}
    maps = [f.stem for f in cache_dir.iterdir() if f.suffix == ".png"]
    return {"exists": bool(maps), "maps": maps}
