"""Adaptador de APIs de pago (S5 remote-gen): atlas de superficies de la vista
fps (fal gpt-image-2) y sprite sheets de personaje (sprite-forge).

El atlas de superficies se genera AQUÍ. Los sprite sheets de personaje ya no:
los produce **sprite-forge**, un servicio aparte (repo propio) al que ne-fan
llama por HTTP. Lo que se queda de este lado es lo que es semántica de ne-fan —
resolver la ref de personaje del style pack, guardar lo generado en
`cache/sprite_sheets/` y apuntar el gasto—, porque sprite-forge devuelve
imágenes y no guarda nada de lo que genera.

Sin GPU local y sin estado — escala por concurrencia HTTP (latencias 30-300 s
por llamada remota). Registra sus resultados en el asset-store vía los
AssetCache de `deps`.
"""

import base64
import json
import logging
import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from asset_paths import SKINNED_SHEETS_DIR
from deps import deps
from dev_api_cache import DEV_API_CACHE
from spend_tracker import SPEND

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


def _sprite_forge_url() -> str:
    """Dónde vive sprite-forge. El servicio es un proceso aparte (otro repo):
    ne-fan es UN consumidor suyo, no su dueño."""
    return str(deps.config.get("sprite_forge_url", "http://127.0.0.1:8770")).rstrip("/")


async def _forge(path: str, payload: dict, timeout: float = 900.0) -> dict:
    """Una llamada a sprite-forge. Fail-loud: su error sube con SU causa.

    Envolver un fallo del servicio en un 502 genérico borra justo lo que el
    cliente necesita para saber si le falta un asset, una clave o un modelo.
    """
    url = f"{_sprite_forge_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=timeout, write=timeout, pool=10)) as c:
            res = await c.post(url, json=payload)
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=503,
            detail=f"sprite-forge no responde en {url}: {type(e).__name__}: {e}",
        ) from e
    if res.status_code >= 400:
        detail = ""
        try:
            detail = str(res.json().get("detail", ""))
        except Exception:  # noqa: BLE001 - el cuerpo puede no ser JSON
            detail = res.text[:300]
        # Un 4xx del servicio es culpa de lo que PEDIMOS (un ángulo que no
        # existe, un modelo que ese despliegue no tiene) y se propaga tal cual:
        # convertirlo en 502 le diría al cliente "se rompió el de arriba" cuando
        # el que se equivocó es él, y le haría reintentar en vez de corregir.
        # Un 5xx sí es del servicio y sale como 502; el 503 (sin clave de imagen,
        # sin worker) se conserva porque el cliente ya sabe degradar a la base.
        status = res.status_code if 400 <= res.status_code < 500 else 502
        if res.status_code == 503:
            status = 503
        raise HTTPException(status_code=status, detail=f"sprite-forge {path}: {detail}")
    return res.json()


# Última `base_key` conocida de cada `{model}/{anim}/{angle}`. Existe por una
# razón concreta: la clave del sheet vestido cuelga de la identidad de la hoja
# base, y esa identidad la da sprite-forge. Sin este índice, un servicio caído
# escondería arte YA PAGADO que está en disco — el jugador vería a todos los
# NPC en maniquí y el retrato del diálogo en blanco, teniendo los ficheros ahí.
_BASE_KEYS_INDEX = SKINNED_SHEETS_DIR / "_base_keys.json"


def _leer_bases() -> dict:
    try:
        return json.loads(_BASE_KEYS_INDEX.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        # Un índice corrupto no puede tumbar el endpoint: se dice y se sigue
        # como si estuviera vacío (el peor caso es una llamada de más).
        logger.warning(f"índice de base_keys ilegible ({e}); se ignora")
        return {}


def _apuntar_base(triple: str, base_key: str) -> None:
    idx = _leer_bases()
    if idx.get(triple) == base_key:
        return
    idx[triple] = base_key
    _BASE_KEYS_INDEX.parent.mkdir(parents=True, exist_ok=True)
    _BASE_KEYS_INDEX.write_text(json.dumps(idx, indent=2, sort_keys=True))


def _skin_sheet_key(
    base_key: str, model: str, anim: str, angle: str, prompt: str, ai_model: str, style_key: str
) -> str:
    """Clave del sheet VESTIDO en la caché de ne-fan.

    `base_key` viene de sprite-forge y es el hash de la hoja base CON su
    configuración (incluido el contenido de los FBX): si la base cambia, esto
    cambia. Antes se usaba el mtime del meta.json de la hoja en disco, que
    dependía de cuándo se había renderizado en ESTA máquina.

    El triple `{model}/{anim}/{angle}` va ADEMÁS, aunque hoy `base_key` ya lo
    codifique: esta clave no debe depender de cómo componga la suya el servicio.
    El día que allí cambie la receta, aquí no se puede empezar a servir el
    `walk` de un personaje cuando alguien pide su `run`.
    """
    import hashlib

    payload = "\n".join(
        [base_key, model, anim, angle, prompt.strip().lower(), ai_model, style_key,
         # v3 (2026-08-24): las hojas las produce sprite-forge y la clave pasa a
         # colgar de su base_key. Los sheets v2 se derivaban de otra cadena.
         "skinforge_v3",
         # En modo dev-cache los frames derivan de una respuesta rancia: clave
         # aparte para no contaminar el cache real de este prompt.
         DEV_API_CACHE.namespace_suffix()]
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def hero_key(prompt: str, model: str, angle: str, ai_model: str, style_key: str = "") -> str:
    """Clave del hero-shot de identidad de un personaje (16 hex).

    Función de MÓDULO a propósito: el retrato del diálogo consulta si el hero ya
    existe, y una consulta de solo lectura no puede exigir credenciales de nadie.

    **NO lleva la animación, y es lo único que importa de esta clave.** El
    hero-shot existe para que las tres animaciones de un personaje sean la MISMA
    persona: se paga una vez y las demás lo heredan. Colgarlo de la identidad de
    la hoja base —que incluye el hash del clip— le daba a `idle`, `walk` y `run`
    tres heroes distintos: el triple de coste y, peor, tres caras para el mismo
    NPC. `model` y `angle` sí van: el hero se pinta sobre un fotograma suyo.
    """
    import hashlib

    payload = "\n".join(
        [prompt.strip().lower(), model, angle, ai_model, style_key,
         "heroforge_v3", DEV_API_CACHE.namespace_suffix()]
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


@router.post("/skin_sprite_sheet")
async def skin_sprite_sheet_endpoint(request: Request):
    """Adaptador: viste una anim de un personaje llamando a **sprite-forge**.

    Lo que hace aquí y no allí, porque es semántica de ne-fan y no del servicio:
    resolver la ref de personaje del style pack del juego, guardar lo generado en
    `cache/sprite_sheets/{key}` y apuntar el gasto. sprite-forge devuelve
    IMÁGENES —no guarda lo que genera— y el que guarda es quien llama.

    Body: {model, anim, angle, prompt, style_id?, style_role?}
    Returns: {ok, hash, cached, meta, frame_urls, hero_key, hero_url,
              generation_time_ms} — el wire NO cambia: el meta es el del sheet
    VESTIDO (keyframes reducidos + fps de perfil), no el de la base.
    """
    body = await request.json()
    model = str(body.get("model", "")).strip()
    anim = str(body.get("anim", "idle")).strip()
    # `angle` es OBLIGATORIO. Tenía por defecto el de una vista retirada en
    # agosto, así que una petición sin ángulo cruzaba medio sistema para acabar
    # en un 404 sin explicación.
    angle = str(body.get("angle", "")).strip()
    prompt = str(body.get("prompt", "")).strip()
    # Estilo del juego (opcional): pack + ref de personaje elegida por el motor
    # para este NPC ("style_role" es el nombre legacy del campo en el wire; hoy
    # transporta el id de la ref de characters/). Vacío o desconocido ⇒ primera
    # ref de characters/ del manifest. Sin pack o sin imagen ⇒ sin ref.
    style_id = str(body.get("style_id", "")).strip()
    style_role = str(body.get("style_role", "")).strip()

    if not (model and prompt):
        raise HTTPException(status_code=400, detail="missing model or prompt")
    if not angle:
        raise HTTPException(status_code=400, detail="missing angle")

    style_ref = None
    if style_id and deps.style_packs is not None:
        style_ref = deps.style_packs.resolve_character(style_id, style_role)
    style_key = f"{style_ref.style_id}:{style_ref.content_hash}" if style_ref else ""
    references = (
        [{"image": style_ref.data_uri, "note": "estilo del juego"}] if style_ref else []
    )
    style_note = style_ref.style_token if style_ref else ""
    ai_model = str(deps.config["sprite_skin_model"])

    # La hoja base es GRATIS y determinista: se pide su identidad sin frames
    # (format=none) para colgar de ella las dos claves de caché.
    triple = f"{model}/{anim}/{angle}"
    solo_cache = False
    try:
        base = await _forge(
            "/sheets",
            {"model": model, "anims": [anim], "angle": angle, "format": "none"},
            timeout=300.0,
        )
        base_key = base["sheets"][0]["base_key"]
        _apuntar_base(triple, base_key)
    except HTTPException as e:
        # Si el servicio no está, todavía se puede servir lo YA PAGADO: la
        # última identidad conocida de esta hoja basta para encontrarlo en
        # disco. Lo que no se puede es generar nada nuevo, y eso se dice abajo
        # con el error original.
        if e.status_code != 503:
            raise
        base_key = _leer_bases().get(triple)
        if not base_key:
            raise
        solo_cache = True
        logger.warning(
            f"sprite-forge no responde; se sirve {triple} desde caché con la última "
            f"identidad conocida ({base_key}) — sin verificar la hoja base"
        )

    key = _skin_sheet_key(base_key, model, anim, angle, prompt, ai_model, style_key)
    out_dir = SKINNED_SHEETS_DIR / key
    out_meta_path = out_dir / "meta.json"
    hero_k = hero_key(prompt, model, angle, ai_model, style_key)
    hero_path = SKINNED_SHEETS_DIR / "heroes" / f"{hero_k}.png"

    start = time.time()
    cached = out_meta_path.exists()
    if cached:
        # meta.json se escribe el ÚLTIMO: su presencia garantiza que todos los
        # frames están en disco.
        with open(out_meta_path) as f:
            meta = json.load(f)
    elif solo_cache:
        # No está en caché y no hay servicio: no hay nada que servir, y se dice
        # con la causa real en vez de con un sheet a medias.
        raise HTTPException(
            status_code=503,
            detail=(
                f"sprite-forge no responde y \"{prompt[:40]}\" no está en la caché de "
                f"{triple}: no se puede generar"
            ),
        )
    else:
        # 1. Identidad del personaje: UNA llamada, reutilizada por todas sus
        #    anims. Es una salida del servicio y la guarda ne-fan.
        if not hero_path.exists():
            ident = await _forge(
                "/identity",
                {"model": model, "anim": anim, "angle": angle, "prompt": prompt,
                 "references": references, "style_note": style_note, "ai_model": ai_model},
            )
            hero_path.parent.mkdir(parents=True, exist_ok=True)
            hero_path.write_bytes(base64.b64decode(ident["image"]))
            if ident.get("cost_usd"):
                SPEND.add(float(ident["cost_usd"]), f"hero: {prompt[:50]}", "remote-gen")

        # 2. La anim vestida. Todo-o-nada: si falla, no se escribe meta.json.
        skinned = await _forge(
            "/skins",
            {"base": {"model": model, "anim": anim, "angle": angle},
             "prompt": prompt,
             "identity": base64.b64encode(hero_path.read_bytes()).decode("ascii"),
             "references": references, "style_note": style_note, "ai_model": ai_model},
        )
        meta = skinned["meta"]
        meta.setdefault("skin", {})["base_key"] = base_key
        out_dir.mkdir(parents=True, exist_ok=True)
        for d, fila in enumerate(skinned["frames"]):
            for f, b64 in enumerate(fila):
                (out_dir / f"dir_{d}_frame_{f:03d}.png").write_bytes(base64.b64decode(b64))
        out_meta_path.write_text(json.dumps(meta, indent=2))
        if skinned.get("cost_usd"):
            SPEND.add(float(skinned["cost_usd"]), f"skin {anim}: {prompt[:44]}", "remote-gen")
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
        "cached": cached,
        "meta": meta,
        "frame_urls": frame_urls,
        "hero_key": hero_k,
        "hero_url": f"/cache/sprite_hero/{hero_k}" if hero_path.exists() else None,
        "generation_time_ms": elapsed_ms,
    }


@router.get("/sprite_catalog")
async def sprite_catalog_endpoint():
    """Qué ofrece el sprite-forge de este despliegue: modelos, animaciones,
    ángulos y **cuántas llamadas de imagen cuesta vestir cada anim**.

    Existe para que el cliente deje de espejar a mano ese número. Lo llevaba
    escrito como una suma en un comentario —una llamada de identidad más los
    lotes de cada anim—, y es justo el número que se le enseña al usuario ANTES
    de gastar: en cuanto alguien retocase un perfil de keyframes, mentiría. Y el
    planificador que lo calcula ya no vive en este repo.
    """
    url = f"{_sprite_forge_url()}/catalog"
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            res = await c.get(url)
            res.raise_for_status()
            return res.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=503, detail=f"sprite-forge no responde en {url}: {type(e).__name__}: {e}"
        ) from e
