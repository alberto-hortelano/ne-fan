"""Adaptador de APIs de pago (S5 remote-gen): repintado de escenas/platós
(Meshy i2i / fal gpt-image-2) y sprite sheets skinneados (Meshy + rembg).

Endpoints movidos TAL CUAL desde routers/generation.py (F4). Sin GPU local y
sin estado — escala por concurrencia HTTP (latencias 30-300 s por llamada
remota). Registra sus resultados en el asset-store vía los AssetCache de
`deps`.
"""

import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from asset_paths import SKINNED_SHEETS_DIR, SPRITE_SHEETS_DIR
from deps import deps
from dev_api_cache import DEV_API_CACHE
from request_util import decode_b64_png
from scene_image_generator import SIDES
from sprite_skin_meshy import SpriteSkinMeshy
from style_categories import STYLE_TAG_PATTERN
from style_packs import ZONE_TO_STAGE

logger = logging.getLogger("ai_server")

router = APIRouter()


class SceneImageRequest(BaseModel):
    """Full-scene img2img from the 2D client's schematic capture.

    `image_b64` is the base64-encoded PNG the Canvas renderer exports (terrain
    plate + object rectangles, no characters). The result is a painted top-down
    scene that maps 1:1 onto the same world rectangle.

    `context_sides`: edges of the capture whose outermost strip is REAL,
    already-painted art from an adjacent tile (not schematic). The model is
    instructed to reproduce those strips and continue them seamlessly.

    `blueprint_kind`: "boxes" (legacy schematic: colour zones + object boxes),
    "tile" (clay greybox 3D del tile oblicuo: instrucción de repintado del
    blockout) or "stage" (clay greybox del plató proscenio)."""
    image_b64: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    context_sides: list[str] = Field(default_factory=list)
    blueprint_kind: str = Field(default="boxes", pattern="^(boxes|tile|stage)$")
    # False = el plano NO tiene agua: la instrucción omite las cláusulas de
    # agua (mencionarla en planos secos ceba ríos alucinados — bench
    # 002_repaint_fidelity). Default True = comportamiento clásico.
    has_water: bool = True
    # Estilo del juego: id del pack (congelado en la sesión) y categoría de
    # referencia que el motor narrativo etiquetó para esta escena. Ausentes ⇒
    # referencia global fija de siempre.
    style_id: str = Field(default="", pattern="^[A-Za-z0-9_.-]*$")
    # Zonas de estilo + categorías de plató + alias legacy ("nature"). Patrón
    # derivado de style_categories.py (fuente única, candada contra el TS).
    # Las stage_* solo tienen sentido con blueprint_kind="stage"; una zona en
    # petición stage se mapea a plató (ZONE_TO_STAGE) al resolver.
    style_tag: str = Field(default="", pattern=STYLE_TAG_PATTERN)
    # Clave de layout ESTABLE aportada por el cliente (hash del spec greybox
    # canónico del plató o del tile). El render WebGL no es byte-determinista:
    # sin esta clave, cada arranque hashearía píxeles distintos ⇒ miss.
    # Vacía ⇒ se hashea el PNG (camino legacy "boxes").
    layout_key: str = Field(default="", pattern="^[a-f0-9]{0,64}$")
    @field_validator("context_sides")
    @classmethod
    def _valid_sides(cls, v: list[str]) -> list[str]:
        bad = [s for s in v if s not in SIDES]
        if bad:
            raise ValueError(f"context_sides must be in {SIDES}, got {bad}")
        return v


@router.post("/generate_scene_image")
async def generate_scene_image_endpoint(body: SceneImageRequest):
    """Repaint the client's schematic into a detailed top-down scene (img2img +
    ControlNet canny). Cached by (prompt, layout, strength)."""
    import asyncio
    import hashlib

    if deps.scene_image_gen is None:
        raise HTTPException(status_code=503, detail="deps.scene_image_gen unavailable")

    png = decode_b64_png(body.image_b64)
    # layout_key del cliente (hash del spec del greybox, prefijado para no
    # colisionar con el espacio de hashes de PNG) o hash de los píxeles.
    layout = (
        f"gb:{body.layout_key[:16]}" if body.layout_key
        else hashlib.sha256(png).hexdigest()[:16]
    )
    # `model` is in the key so switching backends/models never serves a stale
    # image cached under a different generator. `sides` covers the (unlikely)
    # case of identical pixels with a different context instruction; empty is
    # dropped from the hash so pre-existing cache entries stay valid.
    context = {
        "layout": layout,
        "kind": "full",
        "model": (
            deps.scene_image_gen._stage_model
            if body.blueprint_kind == "stage"
            else deps.scene_image_gen._model
        ),
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
        if body.blueprint_kind == "stage":
            # Plató: SIEMPRE una categoría stage_* — una zona legacy se mapea
            # (ZONE_TO_STAGE) y sin tag se aplica stage_street. Nunca se
            # resuelve una ref cenital para el repintado ground-level.
            tag = ZONE_TO_STAGE.get(body.style_tag, body.style_tag) or "stage_street"
        else:
            tag = body.style_tag or "settlement"
        style_ref = deps.style_packs.resolve(body.style_id, tag)
        if style_ref is not None:
            context["style"] = f"{style_ref.style_id}/{style_ref.category}:{style_ref.content_hash}"
    # La instrucción difiere por tipo de blueprint: mismo layout con otro kind
    # no debe servir una imagen cacheada bajo la instrucción antigua. "boxes"
    # se omite (como sides vacío) para no invalidar la caché preexistente.
    if body.blueprint_kind != "boxes":
        context["blueprint"] = body.blueprint_kind
    # stage_greybox2: encuadre v3 (ventana anclada al horizonte, clay a aspect
    # nativo sin anamórfico, backdrop en el prompt) — invalida el greybox1.
    # tile_greybox1: la base pasa de SVG rasterizado a render 3D greybox.
    # stage_greybox3: luz convencional (cono frontal, cláusula anti-contraluz).
    if body.blueprint_kind == "stage":
        context["pipeline"] = "stage_greybox3"
    elif body.blueprint_kind == "tile":
        context["pipeline"] = "tile_greybox1"
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


class SurfaceCellSpec(BaseModel):
    """Una celda del atlas de superficies de la vista fps. `desc` es la
    identidad del asset (junto al estilo): celdas con la misma descripción y
    estilo comparten hash y se REUTILIZAN entre escenas."""
    key: str = Field(min_length=1, max_length=96)
    mat: str = Field(min_length=1, max_length=48)
    kind: str = Field(pattern="^(tile|unique)$")
    desc: str = Field(min_length=1, max_length=300)
    base_color: str = Field(pattern="^#[0-9a-fA-F]{6}$")
    world_w: float = 1.0
    world_h: float = 1.0
    hints: list | None = None


class SurfaceAtlasRequest(BaseModel):
    cells: list[SurfaceCellSpec] = Field(min_length=1, max_length=64)
    scene_description: str = Field(min_length=1, max_length=600)
    style_id: str = Field(default="", pattern="^[A-Za-z0-9_.-]*$")
    style_tag: str = Field(default="", pattern=STYLE_TAG_PATTERN)
    # Hash del layout canónico del cliente — solo logging/debug: la caché es
    # POR CELDA (independiente de la escena y del layout).
    layout_key: str = Field(default="", pattern="^[a-f0-9]{0,64}$")
    # true = SOLO resolver contra la librería (gratis, $0): devuelve las
    # celdas ya pintadas y cuántas faltan, sin pintar nada. Es el camino del
    # resume (restaurar arte pagado aunque la generación esté en OFF).
    resolve_only: bool = False


@router.post("/generate_surface_atlas")
async def generate_surface_atlas_endpoint(body: SurfaceAtlasRequest):
    """Atlas de superficies de la vista fps. Resuelve por CELDA contra la
    librería (kind "surface"); pinta solo las que faltan re-empaquetadas
    juntas, ancladas a ≤3 celdas reutilizadas. La librería crece sola: cada
    celda pintada se registra con su descripción como prompt."""
    import asyncio

    from surface_atlas_generator import canonical_hints

    # Estilo: token del pack para el prompt + fragmentación de la librería por
    # estilo (la misma "wall_plaster" en dos estilos son dos assets).
    style_token = ""
    style_key = ""
    style_sheet = None  # lámina fps_surfaces del pack (2ª ref de cada página)
    if body.style_id and deps.style_packs is not None:
        tag = body.style_tag or "settlement"
        style_ref = deps.style_packs.resolve(body.style_id, tag)
        if style_ref is not None:
            style_token = style_ref.style_token
            style_key = f"{style_ref.style_id}:{style_ref.style_token}"
        else:
            style_key = body.style_id
        style_sheet = deps.style_packs.resolve(body.style_id, "fps_surfaces")

    def cell_context(cell: SurfaceCellSpec, ai_model: str) -> dict:
        ctx = {
            "mat": cell.mat,
            "kind": cell.kind,
            "style": style_key,
            "model": ai_model,
            "hints": canonical_hints(cell.hints),
            "pipeline": "surface1",
            "library": "1",
        }
        # Clave CONDICIONAL: sin lámina el contexto es byte-idéntico al
        # histórico (la librería pintada sigue valiendo); añadir la lámina a
        # un estilo invalida SOLO las celdas de ese estilo (repintado con la
        # nueva dirección de arte), y cambiar la lámina vuelve a invalidar.
        if style_sheet is not None:
            ctx["fpsref"] = style_sheet.content_hash
        # Versión del contrato de las celdas ÚNICAS (UNIQUE_RULE del pintor:
        # una celda hero es UNA CARA, nunca el objeto entero). Solo en
        # uniques: invalida los heroes ya pintados como objeto (ruedas
        # dibujadas sobre el carro, 2026-08-16) sin repagar ni una tile.
        if cell.kind != "tile":
            ctx["unique_face_v"] = "2"
        return DEV_API_CACHE.namespace_context(ctx)

    gen = deps.surface_atlas_gen
    resolved: dict[str, dict] = {}
    missing: list[SurfaceCellSpec] = []
    reused_pngs: list[bytes] = []
    for cell in body.cells:
        ai_model = gen._model if cell.kind == "tile" else gen._hero_model
        ctx = cell_context(cell, ai_model)
        key = deps.surface_cache.hash_key(cell.desc, ctx)
        if deps.surface_cache.has(cell.desc, "surface", context=ctx):
            resolved[cell.key] = {"hash": key, "url": f"/cache/surface/{key}", "cached": True}
            if len(reused_pngs) < 3:
                png = deps.surface_cache.get_by_hash(key, "surface")
                if png:
                    reused_pngs.append(png)
        else:
            missing.append(cell)

    if not missing or body.resolve_only:
        return {"cells": resolved, "pages_painted": 0, "cached": not missing,
                "cost_usd": 0.0, "generation_time_ms": 0, "missing": len(missing)}

    print(
        f"SurfaceAtlas: {len(missing)} celdas nuevas de {len(body.cells)} "
        f"(layout={body.layout_key[:12] or '-'} style={style_key or '-'})",
        flush=True,
    )
    try:
        result = await asyncio.to_thread(
            gen.generate,
            [c.model_dump() for c in missing],
            body.scene_description,
            style_token,
            reused_pngs,
            style_sheet.data_uri if style_sheet is not None else "",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"surface atlas generation failed: {e}") from e

    for cell in missing:
        png = result["cells"].get(cell.key)
        if png is None:
            # El packer siempre asigna página a cada celda: que falte una es un
            # bug del pintor — fail-loud, no una celda clay en silencio.
            raise HTTPException(status_code=502, detail=f"surface atlas sin celda {cell.key}")
        ai_model = gen._model if cell.kind == "tile" else gen._hero_model
        ctx = cell_context(cell, ai_model)
        key = deps.surface_cache.put(cell.desc, "surface", png, context=ctx)
        resolved[cell.key] = {"hash": key, "url": f"/cache/surface/{key}", "cached": False}

    # Páginas del atlas a disco para debug (sin manifest: no son assets del
    # LLM — mismo criterio que el blueprint del repintado de escena).
    if body.layout_key:
        for i, page_png in enumerate(result["pages"]):
            page_path = deps.surface_cache.get_path(f"atlas_{body.layout_key[:16]}", f"page{i}")
            page_path.parent.mkdir(parents=True, exist_ok=True)
            page_path.write_bytes(page_png)

    return {
        "cells": resolved,
        "pages_painted": result["pages_painted"],
        "cached": False,
        "cost_usd": result["cost_usd"],
        "generation_time_ms": result["generation_time_ms"],
        "missing": 0,
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
    pipeline validado en labs/skinning; la vía local SD+ControlNet quedó
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
