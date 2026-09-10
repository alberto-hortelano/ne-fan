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
from pydantic import BaseModel

from deps import deps
from style_packs import LAMINA, REF_FOLDERS, STYLE_UPLOAD, ref_folder

router = APIRouter()

#: Las reglas de la subida NO se escriben aquí: se leen del snapshot que vuelca
#: nefan-core desde src/contracts/style-upload.ts (ver style_packs.py). Los
#: límites y los MOTIVOS son los mismos que comprueba el título antes de subir,
#: así que el jugador lee la misma frase la cace quien la cace.
_LIMITES = STYLE_UPLOAD["limites"]
_MOTIVOS = STYLE_UPLOAD["motivos"]
_SAFE_ID = re.compile(STYLE_UPLOAD["ref_id_pattern"])


class StyleUploadImage(BaseModel):
    """Una imagen del pack: carpeta + descripción libre (+ id opcional). La
    CARPETA es el rol del contenido dentro del pack, no una vista de mundo (el
    juego tiene una sola y no se elige): surfaces/ es la lámina de materiales,
    faces/ una cara del mundo, characters/ un model sheet.
    En base64 (JSON, no multipart — evita la dependencia python-multipart).

    Sin `Field(...)`: los LÍMITES no son del wire, son del contrato compartido y
    los aplica `validar_subida` con el motivo que también enseña el título. Con
    la mitad aquí (que era como estaba) el mismo cuerpo daba un 422 estructurado
    de Pydantic o un motivo en español según qué regla incumpliera."""
    folder: str = ""
    description: str = ""
    image_b64: str = ""
    id: str = ""


class StyleUploadRequest(BaseModel):
    """Subida de un estilo de usuario."""
    name: str = ""
    description: str = ""
    style_token: str = ""
    tags: list[str] = []
    images: list[StyleUploadImage] = []


class StyleCompleteRequest(BaseModel):
    """Confirmación explícita del usuario para generar las refs que faltan
    (coste real en créditos)."""
    confirm: bool = False


def _ref(n: int, img_id: str) -> str:
    """Cómo se nombra la imagen n en un motivo — espejo de `refDeImagen` del
    zod: su id si quien sube lo declaró y, si no, su POSICIÓN, que es lo único
    que las dos puntas pueden decir igual (el título no deriva ids)."""
    return img_id if img_id else f"la imagen {n + 1}"


def _motivo(clave: str, ref: str = "") -> str:
    return str(_MOTIVOS[clave]).replace("{ref}", ref)


def validar_subida(body: StyleUploadRequest) -> tuple[list[str], list[str]]:
    """Las reglas de `POST /styles/upload`: las MISMAS que el zod de
    `nefan-core/src/contracts/style-upload.ts` (leídas de su snapshot) y en el
    MISMO orden, para que un cuerpo con un solo fallo dé el mismo motivo en los
    dos procesos.

    Devuelve (etiquetas normalizadas, id de cada imagen) para que el escritor no
    vuelva a derivarlos. Fail-loud con 422 y ANTES de crear el directorio del
    pack: hasta la PR 7 de #241 la mitad de estas comprobaciones vivían dentro
    del bucle que ya había hecho `mkdir` y guardado las imágenes anteriores.

    Lo que NO está aquí, porque exige los BYTES y solo puede mirarlo este
    proceso: que el base64 decodifique, que pese menos de 12 MB y que PIL sepa
    abrir la imagen."""
    # UN LÍMITE, UNA FRASE (#536): el mínimo y el máximo de nombre, etiquetas e
    # imágenes tienen motivo propio, así que quien sube trece imágenes lee
    # «Demasiadas imágenes» y no «Sube al menos una imagen (máximo 12)». El
    # orden de las ramas es el del `superRefine` del zod, para que un cuerpo con
    # un solo fallo dé el MISMO motivo en los dos procesos.
    if len(body.name.strip()) < _LIMITES["nombre"]["min"]:
        raise HTTPException(status_code=422, detail=_motivo("nombre_corto"))
    if len(body.name.strip()) > _LIMITES["nombre"]["max"]:
        raise HTTPException(status_code=422, detail=_motivo("nombre_largo"))
    if len(body.description.strip()) > _LIMITES["descripcion_del_pack_max"]:
        raise HTTPException(status_code=422, detail=_motivo("descripcion_del_pack"))
    if len(body.style_token.strip()) > _LIMITES["style_token_max"]:
        raise HTTPException(status_code=422, detail=_motivo("style_token"))

    tags = [t.strip() for t in body.tags if t.strip()]
    if len(tags) < _LIMITES["tags"]["min"]:
        raise HTTPException(status_code=422, detail=_motivo("sin_etiquetas"))
    if len(tags) > _LIMITES["tags"]["max"]:
        raise HTTPException(status_code=422, detail=_motivo("demasiadas_etiquetas"))
    if len(body.images) < _LIMITES["imagenes"]["min"]:
        raise HTTPException(status_code=422, detail=_motivo("sin_imagenes"))
    if len(body.images) > _LIMITES["imagenes"]["max"]:
        raise HTTPException(status_code=422, detail=_motivo("demasiadas_imagenes"))
    if len([i for i in body.images if i.folder == LAMINA]) > _LIMITES["laminas_max"]:
        raise HTTPException(status_code=422, detail=_motivo("mas_de_una_lamina"))

    ref_ids: list[str] = []
    seen: set[str] = set()
    for n, img in enumerate(body.images):
        ref = _ref(n, img.id)
        if img.folder not in REF_FOLDERS:
            raise HTTPException(status_code=422, detail=_motivo("carpeta", ref))
        if not img.image_b64:
            raise HTTPException(status_code=422, detail=_motivo("imagen_vacia", ref))
        # El id que no viene se DERIVA de la descripción, y por eso este proceso
        # comprueba duplicados que el título no puede ver: él no deriva.
        ref_id = img.id or _slug(img.description, f"ref_{n + 1}")
        if len(ref_id) > _LIMITES["ref_id_max"] or not _SAFE_ID.fullmatch(ref_id):
            raise HTTPException(status_code=422, detail=_motivo("id_invalido", ref_id))
        if ref_id in seen:
            raise HTTPException(status_code=422, detail=_motivo("id_duplicado", ref_id))
        seen.add(ref_id)
        description = img.description.strip()
        if len(description) > _LIMITES["descripcion_de_imagen_max"]:
            raise HTTPException(status_code=422, detail=_motivo("descripcion_de_imagen", ref))
        if not description and img.folder != LAMINA:
            raise HTTPException(status_code=422, detail=_motivo("sin_descripcion", ref))
        ref_ids.append(ref_id)
    return tags, ref_ids


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


if set(STARTER_REFS) != set(REF_FOLDERS):
    raise RuntimeError(
        "STARTER_REFS no cubre exactamente las carpetas del pack "
        f"({sorted(STARTER_REFS)} vs {sorted(REF_FOLDERS)}): las tres son obligatorias para que "
        "un pack cargue, así que una carpeta nueva en nefan-core necesita su starter aquí."
    )


def _starter_file(folder: str, entry: dict) -> str:
    """Archivo de una ref de starter. La lámina conserva el nombre
    `surfaces.jpg` que ya tienen los packs shipped; el resto va por id."""
    if folder == LAMINA:
        return f"{LAMINA}/{LAMINA}.jpg"
    return f"{folder}/{entry['id']}.jpg"


@router.post("/styles/upload")
async def styles_upload(body: StyleUploadRequest):
    """Crea data/styles/user_{slug}/ con las imágenes subidas (cada una en su
    carpeta) y devuelve qué refs declaradas faltan + coste estimado de
    completarlas. NO genera nada aún: la generación requiere confirmación
    explícita (/styles/{id}/complete)."""
    from style_pack_builder import missing_refs
    from style_packs import _styles_dir_from_config

    # Todo lo que se puede rechazar SIN mirar los bytes, antes de crear nada.
    tags, ref_ids = validar_subida(body)
    name = body.name.strip()

    styles_dir = _styles_dir_from_config()
    base = "user_" + _slug(name, "estilo")
    style_id = base
    i = 2
    while (styles_dir / style_id).exists():
        style_id = f"{base}_{i}"
        i += 1

    pack_dir = styles_dir / style_id
    pack_dir.mkdir(parents=True)
    refs: list[dict] = []
    seen_ids: set[str] = set(ref_ids)
    uploaded: list[str] = []
    for n, img in enumerate(body.images):
        ref_id = ref_ids[n]
        description = img.description.strip()
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
            "description": description or STARTER_REFS[LAMINA][0]["description"],
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
        "name": name,
        "description": body.description.strip() or f"Estilo subido por el jugador: {name}.",
        "style_token": body.style_token.strip()
            or f"consistent hand-crafted art style of the reference images ({name})",
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
