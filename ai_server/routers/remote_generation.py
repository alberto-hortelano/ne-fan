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
import os
import time
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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
    """Una llamada POST a sprite-forge (la que gasta o la que renderiza)."""
    return await _forge_http("POST", path, payload, timeout)


async def _forge_http(
    metodo: str, path: str, payload: dict | None = None, timeout: float = 900.0
) -> dict:
    """Una llamada a sprite-forge. Fail-loud: su error sube con SU causa.

    Envolver un fallo del servicio en un 502 genérico borra justo lo que el
    cliente necesita para saber si le falta un asset, una clave o un modelo.

    El método es un parámetro porque el adaptador necesita `GET /catalog` en el
    mismo camino caliente que los POST (el perfil de repintado entra en la clave
    del sheet, ver `_skin_sheet_key`) y la política de traducción de errores
    —incluido el 503 del que el llamante sabe degradar— tiene que ser UNA. Con
    dos copias, la de `GET` se habría quedado sin la degradación y un servicio
    caído habría dejado de servir arte ya pagado.
    """
    url = f"{_sprite_forge_url()}{path}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=timeout, write=timeout, pool=10)) as c:
            res = await c.request(metodo, url, json=payload)
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


# Lo último que se sabe de cada `{model}/{anim}/{angle}`: su `base_key` y su
# perfil de repintado. Existe por una razón concreta: la clave del sheet vestido
# cuelga de las dos cosas y las dos las da sprite-forge. Sin este índice, un
# servicio caído escondería arte YA PAGADO que está en disco — el jugador vería
# a todos los NPC en maniquí y el retrato del diálogo en blanco, teniendo los
# ficheros ahí.
#
# Forma de cada entrada: `{"base_key": str, "perfil": {"keyframes": int,
# "play_fps": float}}`. El perfil entró el 2026-09-03 (#375) y con él cambió el
# formato del fichero. Pre-producción, cero compatibilidad: un índice con la
# forma anterior se trata como AUSENTE y se dice — no se parsea a medias ni se
# le rellena el perfil con el de por defecto del servicio. Lo que este índice
# promete es servir exactamente el arte ya pagado; prometerlo con un perfil
# adivinado da una clave que no es la de nadie y sirve un 503 disfrazado de
# cache-miss.
_BASE_KEYS_INDEX = SKINNED_SHEETS_DIR / "_base_keys.json"


def _entrada_valida(v: object) -> bool:
    """¿Tiene esta entrada la forma viva? (`base_key` + perfil completo)."""
    if not isinstance(v, dict):
        return False
    perfil = v.get("perfil")
    if not isinstance(v.get("base_key"), str) or not v["base_key"] or not isinstance(perfil, dict):
        return False
    kf, fps = perfil.get("keyframes"), perfil.get("play_fps")
    return _keyframes_valido(kf) and _play_fps_valido(fps)


def _keyframes_valido(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


def _play_fps_valido(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def _leer_bases() -> dict:
    try:
        idx = json.loads(_BASE_KEYS_INDEX.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        # Un índice corrupto no puede tumbar el endpoint: se dice y se sigue
        # como si estuviera vacío (el peor caso es una llamada de más).
        logger.warning(f"índice de base_keys ilegible ({e}); se ignora")
        return {}
    if not isinstance(idx, dict):
        logger.warning("índice de base_keys ilegible (no es un objeto); se ignora")
        return {}
    viejas = [t for t, v in idx.items() if not _entrada_valida(v)]
    if viejas:
        # El fichero ENTERO, no las entradas malas: se escribe de una pieza
        # (`_apuntar_base` lo relee y lo vuelca completo), así que uno mezclado
        # no lo ha escrito nadie.
        #
        # RADIO DEL DAÑO, que conviene tener escrito porque es la propiedad más
        # cara de esta zona: al rechazarlo se pierden TAMBIÉN las entradas
        # buenas que hubiera, y la siguiente petición vuelca el fichero con una
        # sola. O sea que tras el cambio de formato, con el servicio caído, solo
        # es alcanzable el arte de los triples que se hayan vuelto a pedir UNA
        # vez con el servicio arriba; el índice se repuebla personaje a
        # personaje según se juegan. Es el precio de no adivinar un perfil, y es
        # el correcto: una entrada inventada apunta a arte que no existe, que es
        # peor que no tener entrada.
        #
        # La causa se dice tal cual es. «Forma anterior» solo cuando la entrada
        # es la `base_key` a secas de antes de #375; una entrada con perfil
        # inválido (keyframes 0, play_fps string, un booleano) NO es una
        # migración pendiente y mandar a buscarla es media hora perdida.
        crudas = sum(1 for t in viejas if not isinstance(idx[t], dict))
        causa = (
            f"{crudas} con la forma anterior a #375 (la base_key a secas)"
            if crudas == len(viejas)
            else f"{crudas} con la forma anterior a #375 y {len(viejas) - crudas} con perfil inválido"
            if crudas
            else f"{len(viejas)} con perfil inválido"
        )
        logger.warning(
            f"índice de base_keys inservible: {causa}, de {len(idx)} entradas; se ignora "
            f"ENTERO (también las buenas) y se reconstruye al vuelo"
        )
        return {}
    return idx


def _apuntar_base(triple: str, base_key: str, perfil: tuple[int, float]) -> None:
    entrada = {"base_key": base_key, "perfil": {"keyframes": perfil[0], "play_fps": perfil[1]}}
    idx = _leer_bases()
    if idx.get(triple) == entrada:
        return
    idx[triple] = entrada
    _BASE_KEYS_INDEX.parent.mkdir(parents=True, exist_ok=True)
    # Escritura ATÓMICA (temporal en el mismo directorio + os.replace), el
    # equivalente del patrón de la caché de hojas de sprite-forge
    # (sheet-cache.mjs): un `write_text` directo que muriera a medias dejaba el
    # fichero truncado, `_leer_bases` lo trata como vacío, y el arte YA PAGADO
    # se volvía inalcanzable justo en el único escenario para el que este
    # índice existe — sprite-forge caído.
    tmp = _BASE_KEYS_INDEX.with_name(f"._base_keys.{os.getpid()}.tmp")
    try:
        tmp.write_text(json.dumps(idx, indent=2, sort_keys=True))
        os.replace(tmp, _BASE_KEYS_INDEX)
    finally:
        tmp.unlink(missing_ok=True)


def _skin_sheet_key(
    base_key: str, model: str, anim: str, angle: str, prompt: str, ai_model: str,
    style_key: str, perfil: tuple[int, float]
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

    **El perfil de repintado `(keyframes, play_fps)` va aquí y NO en `base_key`**
    (#375, 2026-09-03). Es lo que decide qué fotogramas se pintan y a qué
    velocidad se reproducen, o sea el arte vestido; sin él, cambiar el perfil de
    una anim en `nefan-core/data/sprite-set.json` producía un repintado distinto
    con la MISMA clave y se servía el arte viejo en silencio. En `base_key` no
    va porque la hoja BASE no depende del perfil —el repintado elige índices
    *sobre* la hoja completa— y ensuciarla repagaría arte que no ha cambiado.
    Es el perfil EFECTIVO (el de `GET /catalog`, ya mergeado con el de por
    defecto del servicio), no el declarado: ver `_perfil_efectivo`.

    **Decisión sobre `version` (#369-R7), con su coste:** `base_key` lleva la
    versión de sprite-forge (`CAMPOS_CLAVE` en su `src/base-key.mjs`), así que
    un bump de versión del renderizador de hojas mueve esta clave y REPAGA los
    `/skins` de cada personaje (~16 llamadas de imagen por NPC). Se deja como
    está: `base_key` es la identidad de la hoja base y quién la mueve lo decide
    el servicio que la produce, no su consumidor — filtrar aquí campos de una
    identidad ajena es exactamente el espejo que se deriva y acaba sirviendo el
    sheet de otra hoja. El coste queda escrito: rehacer una hoja base cuesta
    ~9 s y cero euros en sprite-forge, pero repintarla cuesta dinero en ne-fan,
    así que la mitigación (que el bump sea una decisión consciente y no un
    efecto de versionar) es del otro repo, #369-R7, fuera de esta tanda.
    """
    import hashlib

    # `float()` normaliza: un `play_fps: 4` del set y un `4.0` son el MISMO
    # perfil y no pueden dar dos claves — sería un repago por escribir el JSON
    # de otra manera.
    perfil_txt = f"{int(perfil[0])}kf@{float(perfil[1])}fps"
    payload = "\n".join(
        [base_key, model, anim, angle, prompt.strip().lower(), ai_model, style_key, perfil_txt,
         # v3 (2026-08-24): las hojas las produce sprite-forge y la clave pasa a
         # colgar de su base_key. Los sheets v2 se derivaban de otra cadena.
         # NO se bumpea a v4 al entrar el perfil (2026-09-03): el literal existe
         # para invalidar cuando la clave NO se movería sola, y un campo nuevo en
         # el payload ya la mueve entera. Bumpear además insinuaría que el campo
         # no basta.
         "skinforge_v3",
         # En modo dev-cache los frames derivan de una respuesta rancia: clave
         # aparte para no contaminar el cache real de este prompt.
         DEV_API_CACHE.namespace_suffix()]
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


async def _perfil_efectivo(anim: str) -> tuple[int, float]:
    """El perfil de repintado que sprite-forge va a APLICAR a esta anim.

    Se pregunta a `GET /catalog` —gratis, solo disco— y no se lee de
    `nefan-core/data/sprite-set.json`, que es el mismo fichero que sprite-forge
    tiene abierto: el catálogo publica el perfil YA MERGEADO con el de por
    defecto del servicio y relee el set en CADA petición, así que es lo único
    que dice lo que `/skins` hará de verdad. Leer el JSON aquí obligaría a
    espejar `perfilDe` (merge campo a campo) y `keyframeIndices` (los keyframes
    colapsan cuando se piden más que fotogramas tiene el ciclo): un espejo que
    deriva, y cuando derive servirá arte con la clave equivocada, que es el
    fallo que esta función existe para cerrar.

    Fail-loud: sin perfil no hay clave honesta, y una clave adivinada sirve el
    arte de otro perfil sin decirlo. Un 502 con la causa es la única salida.
    """
    cat = await _forge_http("GET", "/catalog", timeout=30.0)
    anims = cat.get("animations")
    if not isinstance(anims, list):
        raise HTTPException(
            status_code=502,
            detail=f'sprite-forge /catalog no trae "animations": sin perfil para "{anim}"',
        )
    entrada = next((a for a in anims if isinstance(a, dict) and a.get("id") == anim), None)
    if entrada is None:
        raise HTTPException(
            status_code=502,
            detail=(
                f'sprite-forge no conoce la anim "{anim}" en su catálogo: no se puede '
                f"saber con qué perfil la repintaría"
            ),
        )
    if entrada.get("skin_plan_error"):
        raise HTTPException(
            status_code=502,
            detail=f'sprite-forge no puede repintar "{anim}": {entrada["skin_plan_error"]}',
        )
    kf, fps = entrada.get("keyframes"), entrada.get("play_fps")
    if not _keyframes_valido(kf) or not _play_fps_valido(fps):
        raise HTTPException(
            status_code=502,
            detail=(
                f'sprite-forge publica "{anim}" sin perfil de repintado utilizable '
                f"(keyframes={kf!r}, play_fps={fps!r})"
            ),
        )
    return (kf, float(fps))


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


# ── El arte de personaje en el índice del asset-store (#376) ──────────────────
#
# Los dos kinds del arte más caro del juego. Hasta septiembre de 2026 vivían en
# un almacén paralelo: ni fila, ni prompt, ni dueño. El sheet al menos guardaba
# su procedencia en `meta.json` (`skin.prompt`); el hero-shot es un PNG desnudo
# llamado por un hash y **su prompt no se guardaba en ningún sitio**, o sea que
# no se podía regenerar con un modelo mejor — que es para lo que existe la
# descripción (#293, «la descripción es la procedencia»).
KIND_HERO = "sprite_hero"
KIND_SHEET = "sprite_sheet"


def _peso_en_disco(p: Path) -> int:
    """Bytes de un fichero o de un directorio entero (el sheet son N frames)."""
    if p.is_file():
        return p.stat().st_size
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def registrar_arte_de_personaje(
    *,
    hero_k: str,
    sheet_key: str,
    prompt: str,
    model: str,
    anim: str,
    angle: str,
    ai_model: str,
    style_key: str,
    base_key: str,
    perfil: tuple[int, float],
    raiz: Path | None = None,
    manifest=None,
) -> None:
    """Apunta en el índice del asset-store el hero-shot y el sheet de un personaje.

    ÚNICO ESCRITOR, y se llama en LOS DOS CAMINOS del endpoint —recién generado
    y cache-hit—. El cache-hit no es un detalle: es el camino por el que pasa
    todo el arte que ya estaba pagado antes de que este índice existiera, así
    que registrar solo al generar habría dejado fuera precisamente lo que #376
    denuncia. Es idempotente (el store hace `INSERT OR IGNORE`), así que
    apuntarlo en cada servida no cuesta nada más que un POST local.

    **UNA petición, no dos.** Va por `POST /assets/character`, que registra el
    hero y sus sheets en la MISMA transacción y pina las filas bajo un `ref`
    que deriva el store de `hero_key`. La primera forma de #376 hacía dos
    `register()` con un `character_ref` por fila, y tenía dos grietas que el QA
    midió: un sheet podía declarar el ref de OTRO personaje (soltar A se
    llevaba los frames de B), y si el segundo POST fallaba quedaba un hero
    pineado sin sus frames — que es literalmente lo que prohíbe el criterio de
    cierre del issue. Aquí el ref no es un campo y la pareja es atómica.

    **Pineado, no evictable.** No existe keep-list de arte de personaje
    (`entity.asset_refs` es `[]` y no lo rellena ningún llamante), así que una
    fila sin pin la podría evictar el prune por LRU y con ella se iría la skin
    de un NPC vivo: indexarlo evictable sería empeorar, no arreglar. El unpin
    llega con esa keep-list.

    **Fail-loud.** `register_character` lanza si el store no contesta, y aquí no
    se atrapa. No es celo: los frames y el hero-shot los SIRVE ese mismo
    proceso (`/cache/sprite_sheet/…`, `/cache/sprite_hero/…`), así que un 200
    con el store caído devolvería URLs muertas — un cache-hit «bueno» que en
    pantalla es un maniquí. Mejor decirlo.

    El `extra` lleva lo que hace falta para volver a pedir EXACTAMENTE este
    arte: el triple, el modelo de imagen, el estilo, la identidad de la hoja
    base y el perfil de repintado. El prompt va donde va la procedencia, que es
    la columna `prompt` de la fila.
    """
    raiz = raiz if raiz is not None else SKINNED_SHEETS_DIR
    store = manifest if manifest is not None else deps.asset_manifest
    if store is None:
        raise RuntimeError(
            "no hay cliente del asset-store: el arte de personaje se pagaría sin "
            "dueño y su procedencia se perdería (deps.asset_manifest sin poblar)"
        )

    comun = {"model": model, "angle": angle, "ai_model": ai_model, "style_key": style_key}
    hero_path = raiz / "heroes" / f"{hero_k}.png"
    hero = None
    if hero_path.exists():
        hero = {"prompt": prompt, "size_bytes": _peso_en_disco(hero_path), "extra": dict(comun)}
    else:
        # Puede pasar de verdad: un sheet servido desde caché cuyo hero se
        # archivó (los heroes que la clave viva ya no nombra, ver
        # `ai_server/tools/arte_de_personaje.py`). Registrar una fila cuyo blob
        # no existe sería la mentira contraria.
        logger.warning(
            f"sheet {sheet_key} sin hero en disco ({hero_path.name}): se indexa el "
            f"sheet sin su hero-shot"
        )
    sheets = [{
        "hash": sheet_key,
        "prompt": prompt,
        "size_bytes": _peso_en_disco(raiz / sheet_key),
        "extra": {**comun, "anim": anim, "base_key": base_key,
                  "keyframes": perfil[0], "play_fps": perfil[1]},
    }]
    store.register_character(hero_k, hero=hero, sheets=sheets)


class SkinSpriteSheetRequest(BaseModel):
    """Una anim de un personaje, vestida por sprite-forge.

    ERA EL ÚNICO ENDPOINT DEL ai_server SIN MODELO (#366): leía `request.json()`
    y sacaba seis `str(body.get(...))`, así que un campo mal escrito se
    convertía en `""` y viajaba. Los dos que importan se atajaban con un
    `HTTPException(400)` a mano; los otros cuatro, no — `styel_id` en vez de
    `style_id` era un personaje pintado sin el estilo del juego, sin una sola
    queja y con la factura pagada.

    `strip_whitespace` va en TODOS los campos porque el endpoint hacía
    `.strip()` en los seis, y `min_length=1` DESPUÉS del recorte: así un
    `angle: "  "` es 422 y no un `""` que cruza medio sistema para morir en un
    404 sin explicación.
    """

    # `extra="forbid"` AQUÍ y no en `SurfaceCellSpec`, que documenta lo
    # contrario tres pantallas más arriba. No es una incoherencia: allí un
    # campo que el server viejo no conoce degrada a una celda sin ref, que se
    # ve y no cuesta nada; aquí un `styel_id` mal escrito paga un personaje
    # entero pintado sin el estilo del juego. La aceptación de #366 dice
    # «ausente O MAL ESCRITO», y para un campo opcional la única forma de
    # cumplirlo es esta. Los dos únicos clientes (`sprite-renderer.ts` y
    # `style-apply.ts`) mandan exactamente estos seis campos.
    model_config = ConfigDict(extra="forbid")

    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    """Modelo base sobre el que se repinta (p. ej. `y_bot`)."""
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    """Descripción del personaje: es la procedencia del arte, no una etiqueta."""
    angle: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    """OBLIGATORIO. Tenía por defecto el de una vista retirada en agosto."""
    anim: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)] = "idle"
    # Estilo del juego (opcional): pack + ref de personaje elegida por el motor
    # para este NPC ("style_role" es el nombre legacy del campo en el wire; hoy
    # transporta el id de la ref de characters/). Vacío o desconocido ⇒ primera
    # ref de characters/ del manifest. Sin pack o sin imagen ⇒ sin ref.
    style_id: Annotated[str, StringConstraints(strip_whitespace=True)] = ""
    style_role: Annotated[str, StringConstraints(strip_whitespace=True)] = ""


@router.post("/skin_sprite_sheet")
async def skin_sprite_sheet_endpoint(body: SkinSpriteSheetRequest):
    """Adaptador: viste una anim de un personaje llamando a **sprite-forge**.

    Lo que hace aquí y no allí, porque es semántica de ne-fan y no del servicio:
    resolver la ref de personaje del style pack del juego, guardar lo generado en
    `cache/sprite_sheets/{key}` y apuntar el gasto. sprite-forge devuelve
    IMÁGENES —no guarda lo que genera— y el que guarda es quien llama.

    Body: `SkinSpriteSheetRequest` (un campo ausente o mal escrito es 422
    estructurado, no un `""` que viaja hasta el modelo).
    Returns: {ok, hash, cached, meta, frame_urls, hero_key, hero_url,
              generation_time_ms} — el wire NO cambia: el meta es el del sheet
    VESTIDO (keyframes reducidos + fps de perfil), no el de la base.
    """
    model = body.model
    anim = body.anim
    angle = body.angle
    prompt = body.prompt
    style_id = body.style_id
    style_role = body.style_role

    style_ref = None
    if style_id and deps.style_packs is not None:
        style_ref = deps.style_packs.resolve_character(style_id, style_role)
    style_key = f"{style_ref.style_id}:{style_ref.content_hash}" if style_ref else ""
    references = (
        [{"image": style_ref.data_uri, "note": "estilo del juego"}] if style_ref else []
    )
    style_note = style_ref.style_token if style_ref else ""
    ai_model = str(deps.config["sprite_skin_model"])

    # Lo que la clave del sheet vestido necesita de sprite-forge, y las dos
    # cosas son GRATIS (`/sheets format=none` es determinista y sin frames;
    # `/catalog` solo mira el disco): la identidad de la hoja base y el perfil
    # de repintado con el que la va a vestir.
    triple = f"{model}/{anim}/{angle}"
    solo_cache = False
    try:
        base = await _forge(
            "/sheets",
            {"model": model, "anims": [anim], "angle": angle, "format": "none"},
            timeout=300.0,
        )
        base_key = base["sheets"][0]["base_key"]
        perfil = await _perfil_efectivo(anim)
        _apuntar_base(triple, base_key, perfil)
    except HTTPException as e:
        # Si el servicio no está, todavía se puede servir lo YA PAGADO: lo
        # último que se supo de esta hoja —su identidad y su perfil— basta para
        # encontrarlo en disco. Lo que no se puede es generar nada nuevo, y eso
        # se dice abajo con el error original. Un 502 (el catálogo contesta pero
        # no sabe repintar esta anim) NO es degradable: no hay nada que servir
        # con una clave que no se puede componer.
        #
        # Se DESCARTA la `base_key` recién obtenida cuando `/sheets` contestó y
        # el que se cayó fue `/catalog`, y es deliberado: la pareja
        # (identidad, perfil) tiene que salir del mismo sitio o se compone una
        # clave que no existió nunca. Hoy las dos coinciden; el día que difieran
        # —un bump de `version` en sprite-forge, o sea #369-R7— servir lo del
        # índice es servir el arte que se pagó, que es lo que este camino
        # promete. Generar con la base nueva es el otro camino, y ese exige el
        # servicio entero en pie.
        if e.status_code != 503:
            raise
        apunte = _leer_bases().get(triple)
        if not apunte:
            raise
        base_key = apunte["base_key"]
        perfil = (apunte["perfil"]["keyframes"], apunte["perfil"]["play_fps"])
        solo_cache = True
        logger.warning(
            f"sprite-forge no responde; se sirve {triple} desde caché con lo último "
            f"conocido (base {base_key}, perfil {perfil[0]}kf@{perfil[1]}fps) — sin "
            f"verificar la hoja base"
        )

    key = _skin_sheet_key(base_key, model, anim, angle, prompt, ai_model, style_key, perfil)
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

    # El arte queda con dueño ANTES de contestar, venga de generarse o de la
    # caché (#376). Va aquí, después del if/elif/else, para que no haya un
    # camino de salida que devuelva URLs de arte sin fila: registrar solo al
    # generar dejaba fuera todo lo ya pagado, que es la mitad del issue.
    try:
        registrar_arte_de_personaje(
            hero_k=hero_k, sheet_key=key, prompt=prompt, model=model, anim=anim,
            angle=angle, ai_model=ai_model, style_key=style_key, base_key=base_key,
            perfil=perfil,
        )
    except RuntimeError as e:
        # El store es quien SIRVE estos frames: si no contesta, las URLs que
        # devolveríamos están muertas. Un 502 con la causa, no un 200 bonito.
        raise HTTPException(
            status_code=502,
            detail=f"el arte de {model}/{anim} no se ha podido indexar en el asset-store: {e}",
        ) from e

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
