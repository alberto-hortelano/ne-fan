"""Adaptador de APIs de pago (S5 remote-gen): atlas de superficies de la vista
fps (fal gpt-image-2) y sprite sheets skinneados (Meshy + rembg).

Endpoints movidos TAL CUAL desde routers/generation.py (F4). Sin GPU local y
sin estado — escala por concurrencia HTTP (latencias 30-300 s por llamada
remota). Registra sus resultados en el asset-store vía los AssetCache de
`deps`.
"""

import json
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from asset_paths import SKINNED_SHEETS_DIR, SPRITE_SHEETS_DIR
from deps import deps
from dev_api_cache import DEV_API_CACHE
from sprite_skin_meshy import SpriteSkinMeshy, hero_key

logger = logging.getLogger("ai_server")

router = APIRouter()


class SurfaceCellSpec(BaseModel):
    """Una celda del atlas de superficies de la vista fps. `desc` es la
    identidad del asset (junto al estilo): celdas con la misma descripción y
    estilo comparten hash y se REUTILIZAN entre escenas."""
    key: str = Field(min_length=1, max_length=96)
    mat: str = Field(min_length=1, max_length=48)
    kind: str = Field(pattern="^(tile|unique)$")
    desc: str = Field(min_length=1, max_length=300)
    # Ref de cara del pack (faces/, surface_ref del motor) — solo celdas
    # unique: guía como imagen la página que pinta esta celda. Vacía o no
    # resuelta ⇒ celda sin ref. (Pydantic ignora campos extra: un cliente
    # nuevo contra un server viejo degrada en silencio a sin-ref — aceptable,
    # monorepo con deploy conjunto.)
    ref: str = Field(default="", max_length=64, pattern="^[A-Za-z0-9_.-]*$")
    base_color: str = Field(pattern="^#[0-9a-fA-F]{6}$")
    world_w: float = 1.0
    world_h: float = 1.0
    hints: list | None = None


class SurfaceAtlasRequest(BaseModel):
    cells: list[SurfaceCellSpec] = Field(min_length=1, max_length=64)
    scene_description: str = Field(min_length=1, max_length=600)
    style_id: str = Field(default="", pattern="^[A-Za-z0-9_.-]*$")
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

    from surface_atlas_generator import surface_cell_context

    # Estilo: token del pack para el prompt + fragmentación de la librería
    # por estilo (la misma "wall_plaster" en dos estilos son dos assets), la
    # lámina fps_surfaces y las refs temáticas de CARA elegidas por el motor
    # (surface_ref por celda unique).
    style_token = ""
    style_key = ""
    style_sheet = None  # lámina fps_surfaces del pack
    if body.style_id and deps.style_packs is not None:
        style_token = deps.style_packs.style_token(body.style_id)
        style_key = f"{body.style_id}:{style_token}" if style_token else body.style_id
        style_sheet = deps.style_packs.resolve_sheet(body.style_id)

    # Resolver cada ref de cara distinta UNA vez. Una ref que no resuelve
    # (id desconocido, imagen ausente, sin pack) deja sus celdas SIN ref en
    # TODO (contexto, packer, prompt) — warning, nunca otra imagen ni romper
    # la página (el fail-loud contra el catálogo vive en narrative-mcp).
    ref_ids = sorted({c.ref for c in body.cells if c.ref and c.kind != "tile"})
    cell_refs: dict = {}
    for rid in ref_ids:
        r = (
            deps.style_packs.resolve_face(body.style_id, rid)
            if body.style_id and deps.style_packs is not None
            else None
        )
        if r is not None:
            cell_refs[rid] = r
        else:
            print(f"SurfaceAtlas WARNING: ref de cara '{rid}' no resuelta — celdas sin ref", flush=True)

    def cell_context(cell: SurfaceCellSpec, ai_model: str) -> dict:
        ref = cell_refs.get(cell.ref) if cell.ref else None
        return DEV_API_CACHE.namespace_context(
            surface_cell_context(
                cell.mat, cell.kind, cell.hints, ai_model, style_key,
                style_sheet_hash=style_sheet.content_hash if style_sheet is not None else "",
                cell_ref_hash=ref.content_hash if ref is not None else "",
            )
        )

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
        # Las refs no resueltas se limpian de las celdas (el packer agrupa
        # por `ref`: una ref muerta no debe fragmentar páginas).
        missing_dicts = []
        for c in missing:
            d = c.model_dump()
            if d.get("ref") and d["ref"] not in cell_refs:
                d["ref"] = ""
            missing_dicts.append(d)
        result = await asyncio.to_thread(
            gen.generate,
            missing_dicts,
            body.scene_description,
            style_token,
            reused_pngs,
            style_sheet.data_uri if style_sheet is not None else "",
            {rid: r.data_uri for rid, r in cell_refs.items()},
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
    from sprite_skin_meshy import ANIM_PROFILES, ATLAS_MAX_CELLS, DEFAULT_PROFILE
    base_meta = SPRITE_SHEETS_DIR / model / anim / angle / "meta.json"
    base_stamp = str(int(base_meta.stat().st_mtime)) if base_meta.exists() else "0"
    n_kf, fps = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
    payload = "\n".join(
        [model, anim, angle, prompt.strip().lower(), base_stamp, ai_model, f"kf{n_kf}@{fps}",
         # El plan de lotes cambia el layout de los atlas: otro techo de
         # celdas debe regenerar, no servir el cache del layout viejo.
         f"pack{ATLAS_MAX_CELLS}",
         # v2 (2026-08-18): pose-lock en los prompts (atlas + hero sin
         # T-pose) + validación anti-eco. Los sheets v1 tenían idles en
         # T-pose/turnaround y ecos en clay cacheados — regenerar, no servir.
         "skinprompt_v2",
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
    # Estilo del juego (opcional): pack + ref de personaje elegida por el
    # motor para este NPC ("style_role" es el nombre legacy del campo en el
    # wire; hoy transporta el id de la ref de characters/ — commoner/noble/
    # warrior en los packs migrados). Vacío o desconocido ⇒ primera ref de
    # characters/ del manifest. Sin pack o sin imagen ⇒ sin ref.
    style_id = str(body.get("style_id", "")).strip()
    style_role = str(body.get("style_role", "")).strip()

    if not (model and prompt):
        raise HTTPException(status_code=400, detail="missing model or prompt")

    style_ref = None
    if style_id and deps.style_packs is not None:
        style_ref = deps.style_packs.resolve_character(style_id, style_role)
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
    cached = out_meta_path.exists()
    if cached:
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

    # Hero-shot de identidad: el pipeline ya lo pagó para fijar la cara del
    # personaje antes de repintar sus frames. Se anuncia aquí para que el
    # cliente pueda usarlo de retrato en el diálogo; NUNCA se genera desde
    # este punto (si no está en disco, el cliente cae al busto del sprite).
    hero_k = hero_key(prompt, model, deps.sprite_skin_gen.ai_model, style_key, angle)
    hero_exists = (SKINNED_SHEETS_DIR / "heroes" / f"{hero_k}.png").exists()

    return {
        "ok": True,
        "hash": key,
        "cached": cached,
        "meta": meta,
        "frame_urls": frame_urls,
        "hero_key": hero_k,
        "hero_url": f"/cache/sprite_hero/{hero_k}" if hero_exists else None,
        "generation_time_ms": elapsed_ms,
    }
