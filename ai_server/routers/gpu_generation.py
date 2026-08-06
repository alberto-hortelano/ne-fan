"""Generación LOCAL con GPU (S4 gpu-worker): texturas PBR, modelos 3D, skins,
sprites e inpainting LaMa (placa + pelado de capas).

Endpoints movidos TAL CUAL desde routers/generation.py (F3). El estado runtime
viene de `deps`; el `gpu_lock` serializa el acceso a CUDA y protege la
COHERENCIA del pipe SD compartido (Skin/Sprite/ModelGenerator mutan padding,
LoRA y device del pipe de TextureGenerator y restauran al terminar).

Este módulo NO debe importar llm_client (el gpu-worker no habla con el MCP).
"""

import logging
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deps import deps
from dev_api_cache import DEV_API_CACHE
from plate_inpainter import PLATE_ALGO
from request_util import decode_b64_png

logger = logging.getLogger("ai_server")

router = APIRouter()


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


class PeelLayerRequest(BaseModel):
    """Pelado de UNA capa del plató (proscenio): la imagen actual del plató +
    la máscara del elemento SEGMENTADO de la imagen (SAM2 — nunca una silueta
    declarada; blanco = hueco) + el prompt de lo que hay detrás. Backend:
    "lama" (default para el plató — LaMa local, cero invención, el hueco queda
    tapado por su recorte; bench labs/stage 003-005: FLUX reinventa el mueble
    dentro de su propio hueco), "flux" (FLUX Fill guiado por prompt) o "auto"
    (flux si hay FAL_KEY, si no lama). Cacheado por hash (imagen, máscara,
    prompt, algo): el resume es determinista y gratis."""
    image_b64: str = Field(min_length=1)
    mask_b64: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    backend: str = Field(default="auto", pattern="^(auto|lama|flux)$")


class ScenePlateRequest(BaseModel):
    """Placa de fondo del tile: la imagen de escena + la máscara unión de los
    segmentos `tall` recortados (blanco = hueco). El inpainting local rellena
    los huecos continuando solo el suelo, sin añadir nada — la capa base que
    el fade por proximidad de los cutouts revela detrás de un objeto alto."""
    image_b64: str = Field(min_length=1)
    mask_b64: str = Field(min_length=1)


@router.post("/generate_texture")
async def generate_texture_endpoint(body: TextureRequest):
    """Generate PBR texture set from a prompt. Returns URLs to cached PNGs."""
    import asyncio

    key = deps.asset_cache.hash_key(body.prompt)

    # Check cache first
    if deps.asset_cache.has_all(body.prompt, ["albedo", "normal"]):
        return {
            "hash": key,
            "cached": True,
            "albedo_url": f"/cache/albedo/{key}",
            "normal_url": f"/cache/normal/{key}",
        }

    # Generate (serialized — CUDA doesn't support concurrent access)
    start = time.time()
    async with deps.gpu_lock:
        result = await asyncio.to_thread(deps.texture_gen.generate, body.prompt, body.seed)
    elapsed_ms = int((time.time() - start) * 1000)

    # Store in cache
    deps.asset_cache.put(body.prompt, "albedo", result["albedo"])
    deps.asset_cache.put(body.prompt, "normal", result["normal"])

    return {
        "hash": key,
        "cached": False,
        "albedo_url": f"/cache/albedo/{key}",
        "normal_url": f"/cache/normal/{key}",
        "generation_time_ms": elapsed_ms,
    }


@router.post("/generate_model")
async def generate_model_endpoint(body: ModelRequest):
    """Generate a 3D model (GLB) from a prompt."""
    import asyncio

    # namespace_context: en modo dev-cache el GLB deriva de una respuesta
    # rancia de Meshy — no debe pisar el slot real de este prompt.
    model_ctx = DEV_API_CACHE.namespace_context()
    key = deps.model_cache.hash_key(body.prompt, model_ctx)

    # Check cache
    if deps.model_cache.has(body.prompt, "model", model_ctx):
        return {
            "hash": key,
            "cached": True,
            "model_url": f"/cache/model/{key}",
        }

    # Generate (serialized with textures via GPU lock)
    start = time.time()
    async with deps.gpu_lock:
        glb_bytes = await asyncio.to_thread(
            deps.model_gen.generate, body.prompt, body.scale, body.seed, body.quality
        )
    elapsed_ms = int((time.time() - start) * 1000)

    deps.model_cache.put(body.prompt, "model", glb_bytes, model_ctx)

    return {
        "hash": key,
        "cached": False,
        "model_url": f"/cache/model/{key}",
        "generation_time_ms": elapsed_ms,
    }


@router.post("/generate_skin")
async def generate_skin_endpoint(body: SkinRequest):
    """Generate a character skin variant via img2img on the base Paladin UV."""
    import asyncio

    key = deps.skin_cache.hash_key(body.prompt)

    if deps.skin_cache.has(body.prompt, "skin"):
        return {
            "hash": key,
            "cached": True,
            "skin_url": f"/cache/skin/{key}",
        }

    start = time.time()
    async with deps.gpu_lock:
        result = await asyncio.to_thread(
            deps.skin_gen.generate, body.prompt, body.strength, body.gamma, body.seed
        )
    elapsed_ms = int((time.time() - start) * 1000)

    deps.skin_cache.put(body.prompt, "skin", result["skin"])

    return {
        "hash": key,
        "cached": False,
        "skin_url": f"/cache/skin/{key}",
        "generation_time_ms": elapsed_ms,
    }


@router.post("/generate_sprite")
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

    key = deps.sprite_cache.hash_key(body.prompt, context)

    if deps.sprite_cache.has(body.prompt, "sprite", context):
        return {
            "hash": key,
            "cached": True,
            "sprite_url": f"/cache/sprite/{key}",
            "angle": body.angle,
        }

    start = time.time()
    async with deps.gpu_lock:
        result = await asyncio.to_thread(
            deps.sprite_gen.generate, body.prompt, body.width, body.height,
            body.seed, body.angle, body.style_token,
        )
    elapsed_ms = int((time.time() - start) * 1000)

    deps.sprite_cache.put(
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


@router.post("/peel_scene_layer")
async def peel_scene_layer_endpoint(body: PeelLayerRequest):
    """Pelado de una capa del plató: rellena el hueco de la máscara con lo
    declarado detrás. La máscara se dilata (±8 px) antes del relleno y el
    resultado se compone DURO sobre la imagen original (fuera de la máscara
    dilatada, ni un píxel cambia — lección del experimento de julio)."""
    import asyncio
    import hashlib
    import io

    from PIL import Image, ImageFilter

    image_png = decode_b64_png(body.image_b64)
    mask_png = decode_b64_png(body.mask_b64)

    if body.backend == "flux":
        if deps.fill_client is None:
            raise HTTPException(status_code=503, detail="backend flux pedido pero sin fill_client (FAL_KEY)")
        use_flux = True
    elif body.backend == "lama":
        if deps.plate_inpainter is None:
            raise HTTPException(status_code=503, detail="backend lama pedido pero sin plate_inpainter")
        use_flux = False
    else:
        use_flux = deps.fill_client is not None
        if not use_flux and deps.plate_inpainter is None:
            raise HTTPException(status_code=503, detail="ni fill_client (FAL_KEY) ni plate_inpainter disponibles")

    # Máscara dilatada ±16 px: cubre el anti-alias del borde y traga patas
    # finas/halos que la segmentación deja fuera (bench labs/stage 004→005) —
    # el hueco queda TAPADO por su recorte, el halo extra no se ve.
    mask_img = Image.open(io.BytesIO(mask_png)).convert("L")
    for _ in range(4):
        mask_img = mask_img.filter(ImageFilter.MaxFilter(9))
    buf = io.BytesIO()
    mask_img.save(buf, format="PNG")
    dilated_png = buf.getvalue()

    algo = "fluxfill1" if use_flux else f"lama_{PLATE_ALGO}"
    ctx = DEV_API_CACHE.namespace_context({
        "layout": hashlib.sha256(image_png).hexdigest()[:16],
        "mask": hashlib.sha256(dilated_png).hexdigest()[:16],
        "algo": algo,
    })
    key = deps.scene_cache.hash_key(body.prompt, ctx)
    if deps.scene_cache.get_by_hash(key, "plate") is not None:
        return {"hash": key, "cached": True, "peeled_url": f"/cache/plate/{key}", "backend": algo}

    start = time.time()
    filled: bytes
    if use_flux:
        try:
            filled = await asyncio.to_thread(
                deps.fill_client.fill, image_png, dilated_png, body.prompt
            )
        except Exception as e:
            # Sin saldo / fallo remoto: degradar a LaMa local con SU clave de
            # caché (nunca cachear un relleno LaMa bajo la clave flux).
            if deps.plate_inpainter is None:
                raise HTTPException(status_code=502, detail=f"fal fill falló y no hay LaMa: {e}") from e
            print(f"peel_scene_layer: fal fill falló ({e}) — fallback LaMa", flush=True)
            algo = f"lama_{PLATE_ALGO}"
            ctx["algo"] = algo
            key = deps.scene_cache.hash_key(body.prompt, ctx)
            if deps.scene_cache.get_by_hash(key, "plate") is not None:
                return {"hash": key, "cached": True, "peeled_url": f"/cache/plate/{key}", "backend": algo}
            async with deps.gpu_lock:
                filled = await asyncio.to_thread(deps.plate_inpainter.generate, image_png, dilated_png)
    else:
        async with deps.gpu_lock:
            filled = await asyncio.to_thread(deps.plate_inpainter.generate, image_png, dilated_png)

    # Composite duro: el relleno solo dentro de la máscara dilatada.
    base = Image.open(io.BytesIO(image_png)).convert("RGB")
    fill_img = Image.open(io.BytesIO(filled)).convert("RGB")
    if fill_img.size != base.size:
        fill_img = fill_img.resize(base.size, Image.LANCZOS)
    composed = Image.composite(fill_img, base, mask_img)
    out = io.BytesIO()
    composed.save(out, format="PNG")
    peeled = out.getvalue()
    elapsed_ms = int((time.time() - start) * 1000)

    deps.scene_cache.put(body.prompt, "plate", peeled, context=ctx, subtype_override="plate")
    return {
        "hash": key,
        "cached": False,
        "peeled_url": f"/cache/plate/{key}",
        "backend": algo,
        "generation_time_ms": elapsed_ms,
    }


@router.post("/inpaint_scene_plate")
async def inpaint_scene_plate_endpoint(body: ScenePlateRequest):
    """Placa de fondo: inpainting LOCAL (SD 1.5, sin créditos) de los huecos
    que dejan los objetos altos recortados de la imagen de escena. Devuelve la
    escena sin los objetos — lo que realmente hay debajo. Cacheado por hash de
    (imagen, máscara): el resume es determinista y gratis."""
    import asyncio
    import hashlib

    if deps.plate_inpainter is None:
        raise HTTPException(status_code=503, detail="deps.plate_inpainter unavailable")

    image_png = decode_b64_png(body.image_b64)
    mask_png = decode_b64_png(body.mask_b64)
    ctx = DEV_API_CACHE.namespace_context({
        "layout": hashlib.sha256(image_png).hexdigest()[:16],
        "mask": hashlib.sha256(mask_png).hexdigest()[:16],
        "algo": PLATE_ALGO,
    })
    key = deps.scene_cache.hash_key("plate", ctx)
    if deps.scene_cache.get_by_hash(key, "plate") is not None:
        return {"hash": key, "cached": True, "plate_url": f"/cache/plate/{key}"}

    start = time.time()
    async with deps.gpu_lock:
        plate = await asyncio.to_thread(deps.plate_inpainter.generate, image_png, mask_png)
    elapsed_ms = int((time.time() - start) * 1000)

    deps.scene_cache.put("plate", "plate", plate, context=ctx, subtype_override="plate")
    return {
        "hash": key,
        "cached": False,
        "plate_url": f"/cache/plate/{key}",
        "generation_time_ms": elapsed_ms,
    }
