"""Estilos de usuario: subida de packs de referencia y completado por IA.

Formato de pack de refs LIBRES (2026-08): cada imagen subida declara su
CARPETA (surfaces/faces/characters), que es su rol, y una descripción en
español (lo que leerá el motor narrativo para elegirla) más un id opcional.
El pack declara `tags` temáticos que lo casan con juegos compatibles.

Además de lo subido, el manifest declara un STARTER mínimo por carpeta (solo
en las carpetas donde el usuario no subió nada): esas refs "declaradas sin
archivo" son lo que `/styles/{id}/missing` presupuesta y
`/styles/{id}/complete` genera con confirmación. El starter cubre las TRES
carpetas porque las tres son obligatorias para que el pack cargue
(StyleManifestSchema): un pack sin lámina pintaría superficies grises sin
avisar.
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
from style_packs import REF_FOLDERS, ref_folder

router = APIRouter()

_SAFE_ID = re.compile(r"[A-Za-z0-9_.-]+")


class StyleUploadImage(BaseModel):
    """Una imagen del pack: carpeta + descripción libre (+ id opcional). La
    CARPETA es el rol del contenido dentro del pack, no una vista de mundo (el
    juego tiene una sola y no se elige): surfaces/ es la lámina de materiales,
    faces/ una cara del mundo, characters/ un model sheet.
    En base64 (JSON, no multipart — evita la dependencia python-multipart)."""
    folder: str = Field(pattern="^(" + "|".join(REF_FOLDERS) + ")$")
    description: str = Field(default="", max_length=300)
    image_b64: str = Field(min_length=1)
    id: str = Field(default="", max_length=60)


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


#: Starter mínimo por carpeta: refs genéricas declaradas SIN archivo cuando
#: el usuario no subió ninguna imagen de esa carpeta. `gen_scene` en EN
#: (contenido para el builder); `description` en ES (lo que lee el motor).
#: Las tres carpetas tienen starter porque las tres son obligatorias.
STARTER_REFS: dict[str, list[dict]] = {
    "surfaces": [
        {
            "id": "fps_surfaces",
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
    "faces": [
        {
            "id": "fachada",
            "description": (
                "el frente de un edificio habitado del mundo, visto de cara"
            ),
            "gen_scene": (
                "the front face of an inhabited building of this world seen "
                "straight-on: its wall material, a door and a window or two"
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
}


def _starter_file(folder: str, entry: dict) -> str:
    """Archivo de una ref de starter. La lámina conserva el nombre
    `surfaces.jpg` que ya tienen los packs shipped; el resto va por id."""
    if folder == "surfaces":
        return "surfaces/surfaces.jpg"
    return f"{folder}/{entry['id']}.jpg"


@router.post("/styles/upload")
async def styles_upload(body: StyleUploadRequest):
    """Crea data/styles/user_{slug}/ con las imágenes subidas (cada una en su
    carpeta) y devuelve qué refs declaradas faltan + coste estimado de
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
    laminas = [img for img in body.images if img.folder == "surfaces"]
    if len(laminas) > 1:
        raise HTTPException(
            status_code=422,
            detail="más de una lámina de materiales: surfaces/ admite exactamente una imagen",
        )

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
        if not description and img.folder != "surfaces":
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
        file = _starter_file(img.folder, {"id": ref_id})
        (pack_dir / img.folder).mkdir(exist_ok=True)
        pil.save(pack_dir / file, "JPEG", quality=90)
        refs.append({
            "id": ref_id,
            "file": file,
            "description": description or STARTER_REFS["surfaces"][0]["description"],
        })
        uploaded.append(ref_id)

    # Starter: solo en carpetas sin ninguna imagen subida (mínimo viable — el
    # fallback primera-de-carpeta hace el resto). Las tres carpetas son
    # obligatorias, así que el starter las cubre todas: un pack al que le
    # falte una no carga.
    folders_uploaded = {ref_folder(str(r["file"])) for r in refs}
    for folder, starters in STARTER_REFS.items():
        if folder in folders_uploaded:
            continue
        for entry in starters:
            if entry["id"] in seen_ids:
                continue
            refs.append({**entry, "file": _starter_file(folder, entry)})
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
    ([{id, folder, description}]) y coste estimado de generarlas. NO gasta
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
