"""Estilos de usuario: subida de packs de referencia y completado por IA.

Formato de pack de refs LIBRES (2026-08): cada imagen subida declara su
vista (overworld/proscenium/fps/characters), una descripción en español (lo
que leerá el motor narrativo para elegirla) y opcionalmente un id y el rol
`fps_surfaces` (lámina de materiales). El pack declara `tags` temáticos que
lo casan con juegos compatibles.

Además de lo subido, el manifest declara un STARTER mínimo por vista (solo
en las vistas donde el usuario no subió nada): esas refs "declaradas sin
archivo" son lo que `/styles/{id}/missing` presupuesta y
`/styles/{id}/complete` genera con confirmación. Proscenium no se
auto-declara (los platós solo entran si el usuario sube al menos uno — la
vista no se ofrece sin refs, mismo criterio de coste que siempre).
"""

import base64
import io
import json
import re
import unicodedata

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from deps import deps
from style_packs import ROLE_FPS_SURFACES, ref_folder

router = APIRouter()

_SAFE_ID = re.compile(r"[A-Za-z0-9_.-]+")


class StyleUploadImage(BaseModel):
    """Una imagen del pack: vista + descripción libre (+ id y rol opcionales).
    En base64 (JSON, no multipart — evita la dependencia python-multipart)."""
    view: str = Field(pattern="^(overworld|proscenium|fps|characters)$")
    description: str = Field(default="", max_length=300)
    image_b64: str = Field(min_length=1)
    id: str = Field(default="", max_length=60)
    role: str = Field(default="", pattern=f"^({ROLE_FPS_SURFACES})?$")


class StyleUploadRequest(BaseModel):
    """Subida de un estilo de usuario."""
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=500)
    style_token: str = Field(default="", max_length=300)
    tags: list[str] = Field(min_length=1, max_length=8)
    images: list[StyleUploadImage] = Field(min_length=1, max_length=12)


class StyleCompleteRequest(BaseModel):
    """Confirmación explícita del usuario para generar las refs que faltan
    (coste real en créditos)."""
    confirm: bool = False


def _slug(text: str, fallback: str) -> str:
    s = re.sub(
        r"[^a-z0-9]+", "_",
        unicodedata.normalize("NFD", text.lower()).encode("ascii", "ignore").decode(),
    ).strip("_")[:40]
    return s or fallback


#: Starter mínimo por vista: refs genéricas declaradas SIN archivo cuando el
#: usuario no subió ninguna imagen de esa vista. `gen_scene` en EN (contenido
#: para el builder); `description` en ES (lo que lee el motor al elegir).
STARTER_REFS: dict[str, list[dict]] = {
    "overworld": [
        {
            "id": "asentamiento",
            "description": "un asentamiento habitado del mundo con sus alrededores",
            "gen_scene": (
                "a small inhabited settlement of this world and its "
                "surroundings, blending into the wild terrain at the edges"
            ),
        },
        {
            "id": "naturaleza",
            "description": "terreno natural del mundo sin edificios",
            "gen_scene": (
                "wild natural terrain of this world with NO buildings: "
                "vegetation, rocks, a narrow trail, a stream"
            ),
        },
        {
            "id": "interior",
            "description": (
                "el interior de un edificio habitado visto en corte, con el "
                "mundo continuando alrededor"
            ),
            "gen_scene": (
                "the interior of an inhabited building shown in cutaway WITHIN "
                "its surroundings: no roof, furniture and floors visible, the "
                "world continuing around the building"
            ),
        },
    ],
    "characters": [
        {
            "id": "personaje",
            "description": "una persona corriente del mundo con ropa de diario",
            "gen_scene": "an ordinary person of this world in everyday clothes",
        },
    ],
    "fps": [
        {
            "id": "fps_surfaces",
            "role": ROLE_FPS_SURFACES,
            "description": (
                "lámina de doce muestras planas de los materiales más comunes "
                "del mundo"
            ),
            "gen_scene": (
                "twelve different flat material swatches, one per grid cell, "
                "covering the world's most common wall, floor, roof and ground "
                "surfaces"
            ),
        },
    ],
    # proscenium: sin starter — declarar platós dispararía el coste de
    # /complete para todo el mundo; solo entran los subidos.
}


def _starter_file(view: str, entry: dict) -> str:
    if entry.get("role") == ROLE_FPS_SURFACES:
        return "fps/surfaces.jpg"
    return f"{view}/{entry['id']}.jpg"


@router.post("/styles/upload")
async def styles_upload(body: StyleUploadRequest):
    """Crea data/styles/user_{slug}/ con las imágenes subidas (en la carpeta
    de su vista) y devuelve qué refs declaradas faltan + coste estimado de
    completarlas. NO genera nada aún: la generación requiere confirmación
    explícita (/styles/{id}/complete)."""
    from style_pack_builder import missing_refs
    from style_packs import _styles_dir_from_config

    styles_dir = _styles_dir_from_config()
    base = "user_" + _slug(body.name, "estilo")
    style_id = base
    i = 2
    while (styles_dir / style_id).exists():
        style_id = f"{base}_{i}"
        i += 1

    tags = [t.strip() for t in body.tags if t.strip()]
    if not tags:
        raise HTTPException(status_code=422, detail="tags vacíos: declara al menos una etiqueta temática")
    laminas = [img for img in body.images if img.role == ROLE_FPS_SURFACES]
    if len(laminas) > 1:
        raise HTTPException(status_code=422, detail="más de una lámina fps_surfaces")
    for img in laminas:
        if img.view != "fps":
            raise HTTPException(status_code=422, detail="la lámina fps_surfaces debe ir en la vista fps")

    pack_dir = styles_dir / style_id
    pack_dir.mkdir(parents=True)
    refs: list[dict] = []
    seen_ids: set[str] = set()
    uploaded: list[str] = []
    for n, img in enumerate(body.images):
        ref_id = img.id or _slug(img.description, f"ref_{n + 1}")
        if not _SAFE_ID.fullmatch(ref_id):
            raise HTTPException(status_code=422, detail=f"id inválido: {ref_id}")
        if ref_id in seen_ids:
            raise HTTPException(status_code=422, detail=f"id duplicado: {ref_id}")
        seen_ids.add(ref_id)
        description = img.description.strip()
        if not description and img.role != ROLE_FPS_SURFACES:
            raise HTTPException(status_code=422, detail=f"ref {ref_id} sin descripción")
        b64 = img.image_b64
        if "," in b64[:64]:  # tolerar data URIs
            b64 = b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"bad base64 for {ref_id}") from e
        if len(raw) > 12 * 1024 * 1024:
            raise HTTPException(status_code=422, detail=f"image too large for {ref_id} (>12MB)")
        try:
            pil = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"not a decodable image: {ref_id}") from e
        w, h = pil.size
        scale = min(1.0, 1024 / max(w, h))
        if scale < 1.0:
            pil = pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        file = f"{img.view}/{ref_id}.jpg" if img.role != ROLE_FPS_SURFACES else "fps/surfaces.jpg"
        (pack_dir / img.view).mkdir(exist_ok=True)
        pil.save(pack_dir / file, "JPEG", quality=90)
        entry: dict = {
            "id": ref_id,
            "file": file,
            "description": description or STARTER_REFS["fps"][0]["description"],
        }
        if img.role:
            entry["role"] = img.role
        refs.append(entry)
        uploaded.append(ref_id)

    # Starter: solo en vistas sin ninguna imagen subida (mínimo viable — el
    # fallback primera-de-vista hace el resto). La lámina fps se declara si
    # no la subieron (una sola imagen, mejora el atlas).
    views_uploaded = {ref_folder(str(r["file"])) for r in refs}
    has_lamina = any(r.get("role") == ROLE_FPS_SURFACES for r in refs)
    for view, starters in STARTER_REFS.items():
        for entry in starters:
            if entry.get("role") == ROLE_FPS_SURFACES:
                if has_lamina:
                    continue
            elif view in views_uploaded:
                continue
            if entry["id"] in seen_ids:
                continue
            refs.append({**entry, "file": _starter_file(view, entry)})
            seen_ids.add(entry["id"])

    manifest = {
        "style_id": style_id,
        "name": body.name,
        "description": body.description or f"Estilo subido por el jugador: {body.name}.",
        "style_token": body.style_token
            or f"consistent hand-crafted art style of the reference images ({body.name})",
        "cover": "cover.jpg",
        "tags": tags,
        "refs": refs,
    }
    (pack_dir / "style.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Cover provisional: la primera imagen subida (se sobreescribe al completar
    # si aparece un entorno mejor).
    first = next((r for r in refs if (pack_dir / str(r["file"])).exists()), None)
    if first:
        (pack_dir / "cover.jpg").write_bytes((pack_dir / str(first["file"])).read_bytes())

    from meshy_client import MeshyImageToImage
    missing = missing_refs(styles_dir, style_id)
    per_image = MeshyImageToImage.cost_usd(deps.config["sprite_skin_model"]) if deps.config else 0.18
    return {
        "style_id": style_id,
        "uploaded": uploaded,
        "missing": missing,
        "cost_per_image_usd": per_image,
        "estimated_cost_usd": round(len(missing) * per_image, 2),
    }


@router.get("/styles/{style_id}/missing")
async def styles_missing(style_id: str):
    """Dry-run del completado de un pack: refs declaradas sin imagen
    ([{id, view, description}]) y coste estimado de generarlas. NO gasta
    nada — es la mitad "estimación" del flujo upload→complete, reutilizable
    para cualquier pack (también los shipped). Sirve al diálogo de coste de
    "aplicar estilo a un juego"."""
    from style_pack_builder import missing_refs
    from style_packs import _styles_dir_from_config

    if not _SAFE_ID.fullmatch(style_id):
        raise HTTPException(status_code=422, detail="invalid style_id")
    styles_dir = _styles_dir_from_config()
    if not (styles_dir / style_id / "style.json").exists():
        raise HTTPException(status_code=404, detail=f"style not found: {style_id}")

    from meshy_client import MeshyImageToImage
    missing = missing_refs(styles_dir, style_id)
    per_image = MeshyImageToImage.cost_usd(deps.config["sprite_skin_model"]) if deps.config else 0.18
    return {
        "style_id": style_id,
        "missing": missing,
        "cost_per_image_usd": per_image,
        "estimated_cost_usd": round(len(missing) * per_image, 2),
    }


@router.post("/styles/{style_id}/complete")
async def styles_complete(style_id: str, body: StyleCompleteRequest):
    """Genera las refs declaradas que faltan de un pack usando sus imágenes
    como referencia de estilo. Requiere confirm=true (coste real)."""
    from style_pack_builder import generate_missing, missing_refs
    from style_packs import _styles_dir_from_config

    if not _SAFE_ID.fullmatch(style_id):
        raise HTTPException(status_code=422, detail="invalid style_id")
    if not body.confirm:
        raise HTTPException(status_code=422, detail="confirm=true required (esta llamada gasta créditos)")
    styles_dir = _styles_dir_from_config()
    if not (styles_dir / style_id / "style.json").exists():
        raise HTTPException(status_code=404, detail=f"style not found: {style_id}")
    missing = missing_refs(styles_dir, style_id)
    if not missing:
        return {"generated": [], "cost_usd": 0.0, "message": "pack ya completo"}
    try:
        result = await generate_missing(styles_dir, style_id, deps.config["sprite_skin_model"])
    except ValueError as e:
        raise HTTPException(status_code=503, detail=f"Meshy no disponible: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"style generation failed: {e}") from e
    return result
