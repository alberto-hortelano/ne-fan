"""Estilos de usuario: subida de packs de referencia y completado por IA.

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
Único cambio funcional respecto al move: se corrigen dos erratas que dejó el
paso a `deps` (PR-2.1) — `from deps.style_packs import ...` (módulo
inexistente, los /styles/* devolvían 500) y un `config` sin definir en el
cálculo del coste por imagen.
"""

import base64
import io
import json

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from deps import deps
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES

router = APIRouter()


class StyleUploadRequest(BaseModel):
    """Subida de un estilo de usuario: nombre + imágenes por categoría en
    base64 (JSON, no multipart — evita la dependencia python-multipart).
    Cada imagen: {category, image_b64}."""
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=500)
    style_token: str = Field(default="", max_length=300)
    images: list[dict] = Field(min_length=1, max_length=12)


class StyleCompleteRequest(BaseModel):
    """Confirmación explícita del usuario para generar las categorías que
    faltan (coste real en créditos Meshy)."""
    confirm: bool = False


_STYLE_CATEGORIES = (*ENV_CATEGORIES, *CHARACTER_CATEGORIES)


def default_manifest_refs() -> list[dict]:
    """Los 12 refs canónicos de un pack: las 9 zonas (proyección oblicua
    única) más los 3 personajes (model sheets)."""
    refs: list[dict] = []
    for c in (*ENV_CATEGORIES, *CHARACTER_CATEGORIES):
        refs.append({"category": c, "file": f"{c}.jpg", "tags": []})
    return refs


@router.post("/styles/upload")
async def styles_upload(body: StyleUploadRequest):
    """Crea data/styles/user_{slug}/ con las imágenes subidas y devuelve qué
    categorías faltan + coste estimado de completarlas. NO genera nada aún:
    la generación requiere confirmación explícita (/styles/{id}/complete)."""
    import re as _re
    import unicodedata

    from style_pack_builder import missing_categories
    from style_packs import _styles_dir_from_config

    styles_dir = _styles_dir_from_config()
    base = "user_" + (_re.sub(
        r"[^a-z0-9]+", "_",
        unicodedata.normalize("NFD", body.name.lower()).encode("ascii", "ignore").decode(),
    ).strip("_")[:40] or "estilo")
    style_id = base
    i = 2
    while (styles_dir / style_id).exists():
        style_id = f"{base}_{i}"
        i += 1

    pack_dir = styles_dir / style_id
    pack_dir.mkdir(parents=True)
    uploaded: list[str] = []
    for img in body.images:
        category = str(img.get("category", ""))
        if category not in _STYLE_CATEGORIES:
            raise HTTPException(status_code=422, detail=f"invalid category: {category}")
        if category in uploaded:
            raise HTTPException(status_code=422, detail=f"duplicate category: {category}")
        b64 = str(img.get("image_b64", ""))
        if "," in b64[:64]:  # tolerar data URIs
            b64 = b64.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"bad base64 for {category}") from e
        if len(raw) > 12 * 1024 * 1024:
            raise HTTPException(status_code=422, detail=f"image too large for {category} (>12MB)")
        try:
            pil = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"not a decodable image: {category}") from e
        w, h = pil.size
        scale = min(1.0, 1024 / max(w, h))
        if scale < 1.0:
            pil = pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        pil.save(pack_dir / f"{category}.jpg", "JPEG", quality=90)
        uploaded.append(category)

    manifest = {
        "style_id": style_id,
        "name": body.name,
        "description": body.description or f"Estilo subido por el jugador: {body.name}.",
        "style_token": body.style_token
            or f"consistent hand-crafted art style of the reference images ({body.name})",
        "cover": "cover.jpg",
        "refs": default_manifest_refs(),
    }
    (pack_dir / "style.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Cover provisional: la primera imagen subida (se sobreescribe al completar
    # si aparece un entorno mejor).
    (pack_dir / "cover.jpg").write_bytes((pack_dir / f"{uploaded[0]}.jpg").read_bytes())

    from meshy_client import MeshyImageToImage
    missing = missing_categories(styles_dir, style_id)
    per_image = MeshyImageToImage.cost_usd(deps.config["sprite_skin_model"]) if deps.config else 0.18
    return {
        "style_id": style_id,
        "uploaded": uploaded,
        "missing": missing,
        "cost_per_image_usd": per_image,
        "estimated_cost_usd": round(len(missing) * per_image, 2),
    }


@router.post("/styles/{style_id}/complete")
async def styles_complete(style_id: str, body: StyleCompleteRequest):
    """Genera las categorías que faltan de un pack de usuario usando sus
    imágenes como referencia de estilo. Requiere confirm=true (coste real)."""
    import re as _re

    from style_pack_builder import generate_missing, missing_categories
    from style_packs import _styles_dir_from_config

    if not _re.fullmatch(r"[A-Za-z0-9_.-]+", style_id):
        raise HTTPException(status_code=422, detail="invalid style_id")
    if not body.confirm:
        raise HTTPException(status_code=422, detail="confirm=true required (esta llamada gasta créditos)")
    styles_dir = _styles_dir_from_config()
    if not (styles_dir / style_id / "style.json").exists():
        raise HTTPException(status_code=404, detail=f"style not found: {style_id}")
    missing = missing_categories(styles_dir, style_id)
    if not missing:
        return {"generated": [], "cost_usd": 0.0, "message": "pack ya completo"}
    try:
        result = await generate_missing(styles_dir, style_id, deps.config["sprite_skin_model"])
    except ValueError as e:
        raise HTTPException(status_code=503, detail=f"Meshy no disponible: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"style generation failed: {e}") from e
    return result
