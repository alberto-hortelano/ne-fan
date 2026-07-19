"""Generación de assets por IA: escenas, texturas, modelos, skins y sprites.

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
Incluye /backend_status y /analyze_weapon porque comparten el mismo dominio
(estado y visión de los backends generativos).
"""

import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from asset_paths import SKINNED_SHEETS_DIR, SPRITE_SHEETS_DIR
from deps import deps
from dev_api_cache import DEV_API_CACHE
from llm_client import NarrativeUnavailable
from plate_inpainter import PLATE_ALGO
from scene_image_generator import SIDES
from scene_segmenter import crop_sprite, scene_rgb_from_png
from sprite_skin_meshy import SpriteSkinMeshy

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
    # False = el plano NO tiene agua: la instrucción omite las cláusulas de
    # agua (mencionarla en planos secos ceba ríos alucinados — bench
    # 002_repaint_fidelity). Default True = comportamiento clásico.
    has_water: bool = True
    # Estilo del juego: id del pack (congelado en la sesión) y categoría de
    # referencia que el motor narrativo etiquetó para esta escena. Ausentes ⇒
    # referencia global fija de siempre.
    style_id: str = Field(default="", pattern="^[A-Za-z0-9_.-]*$")
    # Zonas de estilo (espejo de style-categories.ts; "nature" = legacy).
    style_tag: str = Field(
        default="",
        pattern="^(settlement|farmland|forest|wetland|desert|snow|fortress|interior|underground|nature)?$",
    )
    @field_validator("context_sides")
    @classmethod
    def _valid_sides(cls, v: list[str]) -> list[str]:
        bad = [s for s in v if s not in SIDES]
        if bad:
            raise ValueError(f"context_sides must be in {SIDES}, got {bad}")
        return v


class AnalyzeSceneRequest(BaseModel):
    """Mundo derivado de la imagen: segmentación automática completa + visión
    clasifica cada región (solid/tall). El cliente deriva de la respuesta la
    colisión y los occluders del tile. `context` viaja al modelo de visión
    (p. ej. scene_description del tile)."""
    image_b64: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)


class ScenePlateRequest(BaseModel):
    """Placa de fondo del tile: la imagen de escena + la máscara unión de los
    segmentos `tall` recortados (blanco = hueco). El inpainting local rellena
    los huecos continuando solo el suelo, sin añadir nada — la capa base que
    el fade por proximidad de los cutouts revela detrás de un objeto alto."""
    image_b64: str = Field(min_length=1)
    mask_b64: str = Field(min_length=1)


@router.post("/generate_scene")
async def generate_scene(body: GenerateSceneRequest):
    """Accept the LlmContext from the bridge, return open-world scene JSON."""
    import asyncio

    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable")

    try:
        return await asyncio.to_thread(
            deps.llm_client.generate_scene, body.model_dump(exclude_none=True)
        )
    except NarrativeUnavailable as e:
        # 504 para timeout (el modelo puede seguir escribiendo; el reintento
        # del mismo tile recupera la respuesta tardía), 503 para el resto.
        status = 504 if "timeout" in str(e).lower() else 503
        raise HTTPException(status_code=status, detail=str(e)) from e


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


@router.get("/backend_status")
async def backend_status_endpoint():
    """Report the state of optional backends. Used by Godot's ServiceSettings panel."""
    import asyncio

    # Meshy 3D
    if deps.model_gen and getattr(deps.model_gen, "_meshy", None):
        meshy_status = {"state": "ready", "message": "API key configurada"}
    elif deps.model_gen and getattr(deps.model_gen, "_triposg_available", False):
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
    if not deps.llm_client:
        vision_status = {"state": "down", "message": "LLM client no disponible"}
    else:
        bridge = await asyncio.to_thread(deps.llm_client.get_bridge_status)
        has_api: bool = deps.llm_client.has_api_fallback()

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


@router.post("/analyze_weapon")
async def analyze_weapon_endpoint(body: AnalyzeWeaponRequest):
    """Vision-guided weapon orientation. Receives images of a 3D weapon and
    returns grip point + orientation vectors for placement.

    Errors are surfaced as HTTPException (4xx/5xx) instead of 200 with an
    `error` field in the body — same fail-loud contract that
    `/report_player_choice` already uses, see next.md §2.1."""
    import asyncio

    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable")

    result = await asyncio.to_thread(
        deps.llm_client.analyze_weapon, body.images, body.weapon_type, body.kind, body.context
    )

    if result is None:
        raise HTTPException(status_code=503, detail="vision unavailable")

    return result


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


@router.post("/generate_scene_image")
async def generate_scene_image_endpoint(body: SceneImageRequest):
    """Repaint the client's schematic into a detailed top-down scene (img2img +
    ControlNet canny). Cached by (prompt, layout, strength)."""
    import asyncio
    import hashlib

    if deps.scene_image_gen is None:
        raise HTTPException(status_code=503, detail="deps.scene_image_gen unavailable")

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    # `model` is in the key so switching backends/models never serves a stale
    # image cached under a different generator. `sides` covers the (unlikely)
    # case of identical pixels with a different context instruction; empty is
    # dropped from the hash so pre-existing cache entries stay valid.
    context = {
        "layout": layout,
        "kind": "full",
        "model": deps.scene_image_gen._model,
        "sides": "+".join(sorted(body.context_sides)),
        # Transformación server-side del esquema antes del modelo (prestretch
        # a cuadrado, bench 002): mismo layout + mismo modelo generan píxeles
        # distintos, así que va en la clave para no servir imágenes del
        # pipeline anterior. v2 (bench 003): la instrucción añade las cláusulas
        # de rol de la ref de estilo — invalida las escenas que calcaban la
        # composición de la ref.
        "pipeline": "prestretch2",
    }
    # Estilo del juego: resolver la referencia del pack. Si el pack no tiene
    # imagen utilizable se degrada a la global — y la clave de cache NO lleva
    # estilo, para no fragmentar el cache preexistente.
    style_ref = None
    if body.style_id and deps.style_packs is not None:
        style_ref = deps.style_packs.resolve(body.style_id, body.style_tag or "settlement")
        if style_ref is not None:
            context["style"] = f"{style_ref.style_id}/{style_ref.category}:{style_ref.content_hash}"
    # La instrucción difiere por tipo de blueprint: mismo layout con otro kind
    # no debe servir una imagen cacheada bajo la instrucción antigua. "boxes"
    # se omite (como sides vacío) para no invalidar la caché preexistente.
    if body.blueprint_kind != "boxes":
        context["blueprint"] = body.blueprint_kind
    # En modo dev-cache la imagen viene de la última respuesta Meshy (rancia):
    # namespacear la clave para no contaminar el cache real de este layout.
    context = DEV_API_CACHE.namespace_context(context)
    key = deps.scene_cache.hash_key(body.prompt, context)

    if deps.scene_cache.has(body.prompt, "scene", context):
        return {"hash": key, "cached": True, "scene_url": f"/cache/scene/{key}"}
    # Un miss regenera (~$0.2): dejar rastro de la clave para poder diagnosticar
    # misses inesperados (p. ej. capturas no deterministas del cliente).
    print(f"SceneImage: cache miss key={key} context={context}", flush=True)

    # No deps.gpu_lock: scene generation runs remotely on Meshy (no local GPU), so
    # holding the lock would needlessly block texture/3D GPU work for ~30s.
    start = time.time()
    # 502 explícito: un crash del backend remoto subiría como 500 sin pasar por
    # el CORSMiddleware y el navegador lo enmascara como error de red.
    try:
        result = await asyncio.to_thread(
            deps.scene_image_gen.generate_full, png, body.prompt,
            body.context_sides, body.blueprint_kind,
            style_ref.data_uri if style_ref else None,
            style_ref.style_token if style_ref else "",
            body.has_water,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"scene image generation failed: {e}") from e
    elapsed_ms = int((time.time() - start) * 1000)

    deps.scene_cache.put(body.prompt, "scene", result["scene"], context=context)
    # Guardar también el schematic de entrada (el blueprint que pintó el cliente
    # desde la escena del motor narrativo) para inspección/debug. Directo a disco
    # sin registrar en el manifest: no es un asset reusable por el LLM.
    blueprint_path = deps.scene_cache.get_path(key, "blueprint")
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


@router.post("/analyze_scene_image")
async def analyze_scene_image_endpoint(body: AnalyzeSceneRequest):
    """Mundo derivado de la imagen: auto-segmenta TODA la escena (SAM2),
    clasifica cada región por visión (Claude vía MCP, fallback API) y devuelve
    solo los elementos jugables: `solid` (colisión) y/o `tall` (occluder con
    z-index), cada uno con su sprite recortado de los píxeles originales.
    Cacheado por (layout de imagen, modelos) — el resume es determinista."""
    import asyncio
    import hashlib

    if deps.scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="deps.scene_segmenter unavailable — set FAL_KEY in .env to enable scene analysis",
        )
    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable — vision required")

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    ctx = DEV_API_CACHE.namespace_context({
        "layout": layout,
        "sam_model": deps.scene_segmenter._fal.auto_segment_model,
        "vision_model": deps.llm_client.model,
        # La visión ORDENA regiones contra el plan (element_id) y el servidor
        # fusiona las partes de un mismo objeto: los análisis cacheados del
        # formato anterior (fragmentados) no valen. v2: la silueta de los
        # elementos tall confirmados se refina con SAM2 box prompt.
        "schema": "element_id_v2",
    })
    key = deps.segment_cache.hash_key("analysis", ctx)
    cached = deps.segment_cache.get_by_hash(key, "analysis")
    if cached is not None:
        return json.loads(cached)

    # Fase 1: segmentación automática + overlay numerado (fal → 502 en fallo).
    try:
        analysis = await asyncio.to_thread(deps.scene_segmenter.analyze_regions, png)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"scene auto-segmentation failed: {e}") from e
    regions = analysis["regions"]
    if not regions:
        result = {"segments": [], "discarded": 0}
        deps.segment_cache.put("analysis", "analysis", json.dumps(result).encode(),
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
        deps.llm_client.classify_scene_segments, images, vision_context,
    )
    if classified is None:
        raise HTTPException(
            status_code=503,
            detail="scene classification unavailable — no MCP listener and no API client, or invalid response",
        )

    # Merge por índice: solo solid/tall generan sprite (el resto es suelo).
    # Las regiones que la VISIÓN asignó al mismo elemento declarado
    # (element_id) son partes de un mismo objeto (las ventanas y la puerta de
    # un bloque): se FUSIONAN en un solo segmento — unión de máscaras, un
    # sprite. La agrupación la decide el modelo de visión, no una heurística.
    import numpy as np

    scene_rgb = scene_rgb_from_png(png)
    by_index = {r["index"]: r for r in regions}
    segments_out: list[dict] = []
    discarded = 0
    groups: dict[str, list[dict]] = {}
    for cls in classified["segments"]:
        region = by_index.get(cls["index"])
        if region is None:
            continue  # índice extra inventado — el validador ya exigió los reales
        if not (cls["solid"] or cls["tall"]):
            discarded += 1
            continue
        element_id = cls.get("element_id")
        if element_id:
            groups.setdefault(element_id, []).append(cls)
            continue
        sprite = crop_sprite(scene_rgb, region["mask"], region["bbox_xyxy"])
        sprite_hash = hashlib.sha256(sprite["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = deps.segment_cache.put(sprite_hash, "segment", sprite["sprite_png_bytes"])
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

    # Refinado de siluetas: el auto-segment NO produce máscaras de objetos
    # grandes compuestos — el cuerpo de un edificio no está entre sus máscaras
    # (solo ventanas/paneles), así que la unión de partes no es la silueta.
    # Para cada elemento TALL que la visión CONFIRMÓ (le asignó partes), se
    # pide a SAM2 la silueta con box prompt: caja = unión del bbox declarado
    # del plan y del bbox observado de las partes (cubre la deriva del pintor
    # sin umbrales). La visión decide identidad; SAM solo extrae la silueta.
    # Máscara vacía o fallo de fal ⇒ conservar la unión de partes (log).
    expected_raw = body.context.get("expected_elements")
    expected_by_id = {
        str(e.get("id")): e
        for e in (expected_raw if isinstance(expected_raw, list) else [])
        if isinstance(e, dict) and e.get("id") and isinstance(e.get("bbox_px"), list)
    }

    def group_mask_and_bbox(parts: list[dict]):
        mask = None
        for cls in parts:
            m = by_index[cls["index"]]["mask"]
            mask = m if mask is None else np.logical_or(mask, m)
        ys, xs = np.where(mask)
        return mask, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)

    refine_ids = [
        eid for eid, parts in groups.items()
        if eid in expected_by_id and any(c["tall"] for c in parts)
    ]
    refined: dict[str, object] = {}
    if refine_ids:
        h, w = scene_rgb.shape[:2]
        boxes = []
        for eid in refine_ids:
            _, (px0, py0, px1, py1) = group_mask_and_bbox(groups[eid])
            ex, ey, ew, eh = (int(v) for v in expected_by_id[eid]["bbox_px"])
            x0 = max(0, min(px0, ex))
            y0 = max(0, min(py0, ey))
            x1 = min(w, max(px1, ex + ew))
            y1 = min(h, max(py1, ey + eh))
            boxes.append((x0, y0, x1, y1))
        try:
            from scene_segmenter import _mask_from_fal, _to_data_uri
            import io as io_mod
            from PIL import Image as PILImage

            buf = io_mod.BytesIO()
            PILImage.fromarray(scene_rgb).save(buf, "PNG")
            mask_pngs, _cached = DEV_API_CACHE.through_sync(
                "fal_segment_boxes",
                lambda: deps.scene_segmenter._fal.segment_boxes(
                    _to_data_uri(buf.getvalue()), boxes
                ),
            )
            for eid, png in zip(refine_ids, mask_pngs, strict=True):
                m = _mask_from_fal(png, w, h)
                if m.any():
                    refined[eid] = m
                else:
                    print(f"analyze_scene: silueta VACÍA para '{eid}' — se conserva la unión de partes", flush=True)
        except Exception as e:
            print(f"analyze_scene: refinado de siluetas falló ({e}) — uniones de partes", flush=True)

    for element_id, parts in groups.items():
        mask, bbox = group_mask_and_bbox(parts)
        if element_id in refined:
            mask = refined[element_id]
            ys, xs = np.where(mask)
            bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        sprite = crop_sprite(scene_rgb, mask, bbox)
        sprite_hash = hashlib.sha256(sprite["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = deps.segment_cache.put(sprite_hash, "segment", sprite["sprite_png_bytes"])
        segments_out.append({
            "id": f"el_{element_id}",
            "element_id": element_id,
            "label": parts[0]["label"],
            # El objeto es sólido/alto si CUALQUIERA de sus partes lo es (la
            # visión puede marcar una ventana no-tall dentro de un bloque tall).
            "solid": any(c["solid"] for c in parts),
            "tall": any(c["tall"] for c in parts),
            "sprite_url": f"/cache/segment/{sprite_key}",
            "image_bbox": sprite["image_bbox"],
            "img_w": sprite["img_w"],
            "img_h": sprite["img_h"],
        })

    result = {"segments": segments_out, "discarded": discarded}
    deps.segment_cache.put("analysis", "analysis", json.dumps(result).encode(),
                      context=ctx, subtype_override="analysis")
    logger.info(
        f"analyze_scene: {len(groups)} declarados (visión), "
        f"{len(segments_out) - len(groups)} añadidos, {discarded} suelo "
        f"(de {len(regions)} regiones)"
    )
    return result


@router.post("/review_scene_image")
async def review_scene_image_endpoint(body: AnalyzeSceneRequest):
    """Revisión por VISIÓN del tile repintado (kind MCP image_review): el
    motor señala con cajas imprecisas los objetos que el modelo de imagen
    INVENTÓ; SAM2 (box prompt) recorta su silueta exacta y de ella sale la
    línea de contacto con el suelo (colisión que sigue la inclinación
    pintada). keep → sprite/occluder + contacto; remove → recorte para que el
    cliente lo tape con la placa. Cacheado por layout — resume determinista."""
    import asyncio
    import base64 as b64mod
    import hashlib

    from image_review import bottom_contour, mask_bbox
    from image_review import mask_from_png as mask_from_fal_png

    if deps.scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="deps.scene_segmenter unavailable — set FAL_KEY in .env to enable image review",
        )
    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable — vision required")

    png = _decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    ctx = DEV_API_CACHE.namespace_context({
        "layout": layout,
        "vision_model": deps.llm_client.model,
        "schema": "image_review_v1",
    })
    key = deps.segment_cache.hash_key("image_review", ctx)
    cached = deps.segment_cache.get_by_hash(key, "analysis")
    if cached is not None:
        return json.loads(cached)

    review = await asyncio.to_thread(
        deps.llm_client.review_scene_image,
        b64mod.b64encode(png).decode(),
        body.context,
    )
    if review is None:
        raise HTTPException(
            status_code=503,
            detail="image review unavailable — no MCP listener or invalid response",
        )

    import numpy as np  # noqa: F401 — dependencia de scene_segmenter ya presente

    scene_rgb = scene_rgb_from_png(png)
    h, w = scene_rgb.shape[:2]
    extras = review["extras"]
    boxes: list[tuple[int, int, int, int]] = []
    for e in extras:
        x, y, bw, bh = e["box_px"]
        boxes.append((
            max(0, int(x)), max(0, int(y)),
            min(w, int(x + bw)), min(h, int(y + bh)),
        ))

    masks: list = [None] * len(extras)
    if boxes:
        try:
            from scene_segmenter import _to_data_uri
            import io as io_mod
            from PIL import Image as PILImage

            buf = io_mod.BytesIO()
            PILImage.fromarray(scene_rgb).save(buf, "PNG")
            mask_pngs, _cached = DEV_API_CACHE.through_sync(
                "fal_segment_boxes_review",
                lambda: deps.scene_segmenter._fal.segment_boxes(
                    _to_data_uri(buf.getvalue()), boxes
                ),
            )
            masks = [mask_from_fal_png(p, (w, h)) for p in mask_pngs]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"image review segmentation failed: {e}") from e

    extras_out: list[dict] = []
    for i, e in enumerate(extras):
        mask = masks[i]
        if mask is None or not mask.any() or mask.sum() < 30:
            logger.info(f"image_review: '{e['label']}' sin silueta útil — se omite")
            continue
        bbox = mask_bbox(mask)
        sprite = crop_sprite(scene_rgb, mask, bbox)
        sprite_hash = hashlib.sha256(sprite["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = deps.segment_cache.put(sprite_hash, "segment", sprite["sprite_png_bytes"])
        entry = {
            "id": f"extra_{i}",
            "label": e["label"],
            "action": e["action"],
            "sprite_url": f"/cache/segment/{sprite_key}",
            "image_bbox": sprite["image_bbox"],
            "img_w": sprite["img_w"],
            "img_h": sprite["img_h"],
        }
        if e["action"] == "keep":
            entry.update({
                "tall": e["tall"],
                "solid": e["solid"],
                "h": e["h"],
                "depth_cells": e["depth_cells"],
                "contact_px": bottom_contour(mask),
            })
        extras_out.append(entry)

    result = {"extras": extras_out}
    deps.segment_cache.put("image_review", "analysis", json.dumps(result).encode(),
                      context=ctx, subtype_override="analysis")
    logger.info(
        f"image_review: {len(extras_out)} extras procesados "
        f"({sum(1 for x in extras_out if x['action'] == 'remove')} removes)"
    )
    return result


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

    image_png = _decode_b64_png(body.image_b64)
    mask_png = _decode_b64_png(body.mask_b64)
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


@router.post("/skin_sprite_sheet")
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
    if style_id and deps.style_packs is not None:
        style_ref = deps.style_packs.resolve(style_id, f"character_{style_role}")
    style_key = f"{style_ref.style_id}:{style_ref.content_hash}" if style_ref else ""

    sheet_dir = SPRITE_SHEETS_DIR / model / anim / angle
    if not (sheet_dir / "meta.json").exists():
        raise HTTPException(status_code=404, detail=f"sheet not found: {model}/{anim}/{angle}")

    if deps.sprite_skin_gen is None:
        try:
            deps.sprite_skin_gen = SpriteSkinMeshy(
                SPRITE_SHEETS_DIR, SKINNED_SHEETS_DIR, deps.config["sprite_skin_model"]
            )
        except ValueError as e:
            # MESHY_API_KEY ausente o modelo desconocido: el cliente degrada a
            # la base y_bot (una entrada de error-log, sin reintentos).
            raise HTTPException(status_code=503, detail=f"sprite skin no disponible: {e}") from e

    key = _skin_sheet_key(model, anim, angle, prompt, deps.sprite_skin_gen.ai_model, style_key)
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
            meta = await deps.sprite_skin_gen.skin_anim(
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
        logger.info(
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
