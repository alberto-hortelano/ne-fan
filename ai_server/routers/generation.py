"""Generación narrativa y visión: escenas LLM, análisis/review de imagen.

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
Incluye /backend_status y /analyze_weapon porque comparten el mismo dominio
(estado y visión de los backends generativos). Los pipelines GPU locales
viven en routers/gpu_generation.py (F3) y los de APIs de pago (repintado,
sprite sheets skinneados) en routers/remote_generation.py (F4).
"""

import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from deps import deps
from dev_api_cache import DEV_API_CACHE
from llm_client import NarrativeUnavailable
from request_util import decode_b64_png
from scene_segmenter import crop_sprite, scene_rgb_from_png

logger = logging.getLogger("ai_server")

router = APIRouter()


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


class AnalyzeSceneRequest(BaseModel):
    """Mundo derivado de la imagen: segmentación automática completa + visión
    clasifica cada región (solid/tall). El cliente deriva de la respuesta la
    colisión y los occluders del tile. `context` viaja al modelo de visión
    (p. ej. scene_description del tile)."""
    image_b64: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)


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


@router.get("/backend_status")
async def backend_status_endpoint():
    """Report the state of optional backends. Used by Godot's ServiceSettings panel."""
    import asyncio

    from routers.gpu_proxy import GPU_WORKER_URL, fetch_gpu_worker_health

    # Meshy 3D vive en el gpu-worker desde F3: agregación best-effort de su
    # /health (timeout 2 s). El shape del panel de Godot no cambia.
    worker = await fetch_gpu_worker_health()
    backend = worker.get("model_backend") if worker else None
    if backend == "meshy":
        meshy_status = {"state": "ready", "message": "API key configurada"}
    elif backend == "triposg":
        meshy_status = {
            "state": "fallback",
            "message": "Meshy no configurado (usando TripoSG local)",
        }
    elif backend == "none":
        meshy_status = {
            "state": "down",
            "message": "no disponible (define MESHY_API_KEY en .env)",
        }
    else:
        meshy_status = {
            "state": "down",
            "message": f"gpu-worker no disponible ({GPU_WORKER_URL})",
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

    png = decode_b64_png(body.image_b64)
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

    png = decode_b64_png(body.image_b64)
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


class StageReviewRequest(BaseModel):
    """/review_stage_image — inventario por visión del plató repintado
    (proscenio). `context.expected_elements` lleva las PISTAS declaradas
    [{id, label, box_px, tall, solid}]; la visión responde con las cajas
    REALES pintadas. Los recortes salen SIEMPRE de segmentar la imagen —
    jamás de siluetas declaradas."""

    image_b64: str = Field(min_length=1)
    context: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_expected(self) -> "StageReviewRequest":
        expected = self.context.get("expected_elements", [])
        if not isinstance(expected, list):
            raise ValueError("context.expected_elements must be a list")
        for i, e in enumerate(expected):
            if not isinstance(e, dict) or not isinstance(e.get("id"), str) or not e["id"]:
                raise ValueError(f"expected_elements[{i}] needs a non-empty string id")
            if not isinstance(e.get("label"), str) or not e["label"]:
                raise ValueError(f"expected_elements[{i}] needs a non-empty string label")
        return self


@router.post("/review_stage_image")
async def review_stage_image_endpoint(body: StageReviewRequest):
    """Inventario COMPLETO del plató repintado (kind MCP stage_review): la
    visión casa cada elemento DECLARADO con su caja REAL pintada (found) o lo
    marca missing, y añade los extras inventados; SAM2 (box prompt) extrae la
    máscara de la IMAGEN por item → sprite + máscara full-frame + línea de
    contacto pintada. El cliente deriva de ahí recortes, z, oclusión y
    colisión. Cacheado por layout+expected — resume determinista."""
    import asyncio
    import base64 as b64mod
    import hashlib
    import io as io_mod

    import numpy as np
    from PIL import Image as PILImage

    from image_review import bottom_contour, mask_bbox
    from image_review import mask_from_png as mask_from_fal_png
    from scene_segmenter import _to_data_uri

    if deps.scene_segmenter is None:
        raise HTTPException(
            status_code=503,
            detail="deps.scene_segmenter unavailable — set FAL_KEY in .env to enable stage review",
        )
    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable — vision required")

    png = decode_b64_png(body.image_b64)
    layout = hashlib.sha256(png).hexdigest()[:16]
    expected_req: list[dict] = body.context.get("expected_elements", [])
    expected_by_id = {e["id"]: e for e in expected_req}
    if len(expected_by_id) != len(expected_req):
        raise HTTPException(status_code=422, detail="expected_elements has duplicate ids")
    ctx = DEV_API_CACHE.namespace_context({
        "layout": layout,
        "vision_model": deps.llm_client.model,
        # v2: floor con trapecio lateral (left/right_wall_px + left/right_front_px).
        "schema": "stage_review_v2",
        # A diferencia del review oblicuo, las pistas SÍ entran en la clave:
        # otro plató (u otro plan) sobre la misma imagen no comparte entrada.
        "expected": hashlib.sha256(
            json.dumps(expected_req, sort_keys=True).encode()
        ).hexdigest()[:16],
    })
    key = deps.segment_cache.hash_key("stage_review", ctx)
    cached = deps.segment_cache.get_by_hash(key, "analysis")
    if cached is not None:
        return json.loads(cached)

    review = await asyncio.to_thread(
        deps.llm_client.review_stage_image,
        b64mod.b64encode(png).decode(),
        body.context,
    )
    if review is None:
        raise HTTPException(
            status_code=503,
            detail="stage review unavailable — no MCP listener or invalid response",
        )

    scene_rgb = scene_rgb_from_png(png)
    h, w = scene_rgb.shape[:2]

    # Inventario unificado: expected found (siempre keep, tall/solid de la
    # pista declarada) + extras (keep/remove de la visión).
    missing = [e["id"] for e in review["expected"] if e["status"] == "missing"]
    items: list[dict] = []
    for e in review["expected"]:
        if e["status"] != "found":
            continue
        hint = expected_by_id[e["id"]]
        items.append({
            "id": e["id"],
            "label": hint["label"],
            "source": "expected",
            "action": "keep",
            "box_px": e["box_px"],
            "tall": bool(hint.get("tall", True)),
            "solid": bool(hint.get("solid", True)),
        })
    for i, x in enumerate(review["extras"]):
        items.append({"id": f"extra_{i}", "source": "extra", **x})

    boxes: list[tuple[int, int, int, int]] = []
    for it in items:
        bx, by, bw, bh = it["box_px"]
        boxes.append((
            max(0, int(bx)), max(0, int(by)),
            min(w, int(bx + bw)), min(h, int(by + bh)),
        ))

    masks: list = []
    if boxes:
        try:
            buf = io_mod.BytesIO()
            PILImage.fromarray(scene_rgb).save(buf, "PNG")
            # Canal DEV_API_CACHE propio: through_sync cachea por canal (la
            # última llamada) — compartirlo con el review oblicuo emparejaría
            # máscaras con el item equivocado en silencio.
            mask_pngs, _cached = DEV_API_CACHE.through_sync(
                "fal_segment_boxes_stage",
                lambda: deps.scene_segmenter._fal.segment_boxes(
                    _to_data_uri(buf.getvalue()), boxes
                ),
            )
            masks = [
                mask_from_fal_png(p, (w, h))
                for _it, p in zip(items, mask_pngs, strict=True)
            ]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"stage review segmentation failed: {e}") from e

    items_out: list[dict] = []
    for it, mask in zip(items, masks, strict=True):
        if mask is None or not mask.any() or mask.sum() < 30:
            if it["source"] == "expected":
                logger.info(f"stage_review: '{it['label']}' found pero sin silueta útil — pasa a missing")
                missing.append(it["id"])
            else:
                logger.info(f"stage_review: extra '{it['label']}' sin silueta útil — se omite")
            continue
        bbox = mask_bbox(mask)
        sprite = crop_sprite(scene_rgb, mask, bbox)
        sprite_hash = hashlib.sha256(sprite["sprite_png_bytes"]).hexdigest()[:16]
        sprite_key = deps.segment_cache.put(sprite_hash, "segment", sprite["sprite_png_bytes"])
        # Máscara L full-frame: la del PELADO del cliente (blanco = elemento).
        mask_buf = io_mod.BytesIO()
        PILImage.fromarray((mask.astype(np.uint8) * 255), "L").save(mask_buf, "PNG")
        mask_png = mask_buf.getvalue()
        mask_key = deps.segment_cache.put(
            hashlib.sha256(mask_png).hexdigest()[:16], "segment", mask_png
        )
        entry = {
            "id": it["id"],
            "label": it["label"],
            "source": it["source"],
            "action": it["action"],
            "sprite_url": f"/cache/segment/{sprite_key}",
            "mask_url": f"/cache/segment/{mask_key}",
            "image_bbox": sprite["image_bbox"],
            "img_w": sprite["img_w"],
            "img_h": sprite["img_h"],
        }
        if it["action"] == "keep":
            entry.update({
                "tall": it["tall"],
                "solid": it["solid"],
                "contact_px": bottom_contour(mask),
            })
            if it["source"] == "extra":
                entry["h"] = it.get("h", 2.0)
                entry["depth_cells"] = it.get("depth_cells", 2.0)
        items_out.append(entry)

    result = {"items": items_out, "missing": missing, "floor": review["floor"]}
    deps.segment_cache.put("stage_review", "analysis", json.dumps(result).encode(),
                           context=ctx, subtype_override="analysis")
    logger.info(
        f"stage_review: {len(items_out)} items ({len(missing)} missing, "
        f"{sum(1 for x in items_out if x['source'] == 'extra')} extras)"
    )
    return result
