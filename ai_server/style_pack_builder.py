"""Generación de imágenes de un style pack vía Meshy/fal image-to-image.

Compartido por la CLI `tools/build_style_pack.py` (packs base shipped) y los
endpoints `/styles/upload` + `/styles/{id}/complete` (packs de usuario).

Formato de pack (2026-08, refs libres): cada ref del style.json declara
`{id, file, description, gen_scene?, seed?}` y vive en una carpeta de ROL del
pack (surfaces/ = lámina de materiales | faces/ = caras del mundo |
characters/ = model sheets). El CONTENIDO de la imagen a generar es
`gen_scene` (prompt EN) o, si falta, la `description` en español tal cual; el
ENCUADRE lo pone el seed de `_plantilla/` (declarado en `seed` o el default de
su carpeta).

Dos modos de dirección de arte:
- Pack con imágenes ya presentes: van como referencias de ESTILO (2ª..4ª
  ref) y el prompt exige calcar su estilo.
- Pack solo-texto: el estilo sale del `style_token` del style.json.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
from pathlib import Path

from PIL import Image

from meshy_client import FalImageToImage, MeshyImageToImage
from spend_tracker import SPEND
from style_packs import REF_FOLDERS, REPO_ROOT, ref_folder

CHAR_SEED = (
    REPO_ROOT / "nefan-html" / "public" / "sprites" / "y_bot" / "idle"
    / "frontal_8" / "dir_0_frame_000.png"
)
# Plantillas clay three.js (renders de los builders greybox de producción):
# seeds de encuadre por ROL, con un default.png por carpeta para las refs
# libres que no declaran `seed`.
PLANTILLA_DIR = REPO_ROOT / "nefan-core" / "data" / "styles" / "_plantilla"

#: Modelo de la lámina de materiales (surfaces/): nano-banana-pro vía fal —
#: el ganador del bench labs/fps para swatches de material tileables (mismo
#: modelo que pinta las páginas tile del atlas in-game).
SHEET_AI_MODEL = "nano-banana-pro"
#: Modelo de las refs temáticas de CARA (faces/): composiciones, no swatches.
FACE_AI_MODEL = "gpt-image-2"


def seed_for(ref: dict) -> Path:
    """Seed de encuadre de una ref. `ref.seed` (ruta relativa a _plantilla/)
    manda; sin él, el default.png de su carpeta. Personajes usan el frame
    y_bot. Fail-loud si un seed declarado o el default de la carpeta no
    existen (la plantilla ES el encuadre; sin ella el modelo inventa la
    cámara)."""
    declared = str(ref.get("seed") or "")
    if declared:
        path = PLANTILLA_DIR / declared
        if not path.exists():
            raise FileNotFoundError(f"seed declarado ausente: {path} (ref '{ref.get('id')}')")
        return path
    folder = ref_folder(str(ref.get("file", "")))
    if folder == "characters":
        return CHAR_SEED
    # surfaces/ y faces/ tienen cada una SU default y no son intercambiables:
    # la rejilla de swatches de la lámina es un seed nefasto para una fachada.
    default = PLANTILLA_DIR / folder / "default.png"
    if default.exists():
        return default
    raise FileNotFoundError(
        f"plantilla default de la carpeta '{folder}' ausente: {default} — "
        "declara `seed` en la ref o restaura la plantilla en _plantilla/"
    )


def _to_data_uri(path: Path, long_side: int = 1024) -> str:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    scale = min(1.0, long_side / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# Encuadre por ROL: lámina de materiales, cara del mundo, model sheet.
CHAR_FRAME = (
    "character model sheet of ONE character: the SAME character drawn three "
    "times full body — front view, three-quarter view and back view, "
    "standing side by side, neutral plain background, no text, no UI"
)
# Lámina de materiales (surfaces/): mismas reglas duras que el atlas de
# superficies in-game (surface_atlas_generator.RULES) — swatches planos a
# 90°, nunca escenas dentro de una celda.
SHEET_FRAME = (
    "a TEXTURE ATLAS SHEET for a retro first-person 3D game: a grid of "
    "rectangular cells on a plain neutral grey background, each cell one "
    "FLAT MATERIAL SWATCH seen straight-on at exactly 90 degrees, filling "
    "its rectangle edge to edge. NEVER paint a scene, an object, a horizon "
    "or a floor meeting a wall inside a cell. The grey gutter between cells "
    "stays plain grey. Flat even lighting, albedo only: no cast shadows, no "
    "perspective. No text, no numbers, no borders, no watermark"
)
# Ref temática de CARA (carpeta faces/): ilustración de UNA cara completa a
# 90° — guía las celdas hero del atlas (surface_ref del motor). Nunca el
# SHEET_FRAME de rejilla: eso es solo la lámina de surfaces/.
FACE_FRAME = (
    "a single flat game texture of ONE architectural face seen straight-on "
    "at exactly 90 degrees: the surface parallel to the image plane, filling "
    "the frame edge to edge, full bleed — no sky, no ground line, no "
    "horizon, no surroundings, no perspective, flat even lighting, albedo "
    "only, no text, no borders, no watermark, no characters"
)



def build_prompt(ref: dict, style_token: str, has_style_refs: bool) -> str:
    """Prompt de generación de una ref. El CONTENIDO es `gen_scene` (EN) o la
    `description` (ES) tal cual; el frame lo decide la CARPETA de la ref, que
    es su rol. Con refs de estilo del pack, el estilo se calca de ellas; sin
    refs, manda el style_token."""
    scene = str(ref.get("gen_scene") or "").strip() or str(ref.get("description") or "").strip()
    if not scene:
        raise ValueError(f"ref '{ref.get('id')}' sin gen_scene ni description — nada que generar")
    folder = ref_folder(str(ref.get("file", "")))
    if not folder:
        raise ValueError(
            f"ref '{ref.get('id')}': file '{ref.get('file')}' fuera de las carpetas del pack"
        )
    frame = {
        "characters": CHAR_FRAME,
        "surfaces": SHEET_FRAME,
        "faces": FACE_FRAME,
    }[folder]
    if has_style_refs:
        style = (
            "Match the EXACT art style, palette and rendering technique of the "
            "reference images after the first one"
            + (f" ({style_token})" if style_token else "")
        )
    else:
        style = f"Art style: {style_token}"
    action = {
        "characters": "Using the FIRST reference image only as body-proportion guide, draw",
        "surfaces": (
            "Repaint the first reference image keeping its grid layout EXACTLY "
            "(same cells, same gutter): fill each grey cell with"
        ),
        "faces": "Using the FIRST reference image only as framing guide, paint",
    }[folder]
    return f"{frame}. {action}: {scene}. {style}."


def missing_refs(styles_dir: Path, style_id: str) -> list[dict]:
    """Refs declaradas en style.json cuyo archivo no existe aún:
    [{id, folder, description}] — lo que el diálogo de coste muestra y
    /complete genera."""
    manifest = json.loads((styles_dir / style_id / "style.json").read_text(encoding="utf-8"))
    out: list[dict] = []
    for ref in manifest.get("refs", []):
        if not (styles_dir / style_id / str(ref.get("file", ""))).exists():
            out.append({
                "id": str(ref.get("id", "")),
                "folder": ref_folder(str(ref.get("file", ""))),
                "description": str(ref.get("description", "")),
            })
    return out


async def generate_missing(
    styles_dir: Path,
    style_id: str,
    ai_model: str = "nano-banana-pro",
    only: list[str] | None = None,
    log=print,
    folder_only: str | None = None,
    out_dir: Path | None = None,
) -> dict:
    """Genera las imágenes que faltan de un pack y actualiza la cover.

    Las imágenes YA presentes del pack se usan como referencias de estilo
    (hasta 3). Devuelve {generated: [...ids], cost_usd, skipped: [...]}.
    Fail-loud: cualquier error de la API aborta (no se escribe media imagen).

    - `only`: limita a esos ids de ref.
    - `folder_only`: limita a las refs de esa carpeta del pack
      ("surfaces"|"faces"|"characters").
    - `out_dir` (staging): genera los ids de `only` INCONDICIONALMENTE
      (aunque su imagen exista — es la re-tirada del flujo de aprobación) y
      las escribe ahí, sin tocar pack, cover ni style.json.
    - Modelo por carpeta: surfaces/ (lámina) → fal nano-banana-pro; faces/ →
      fal gpt-image-2; characters/ por Meshy `ai_model`.
    """
    pack_dir = styles_dir / style_id
    manifest_path = pack_dir / "style.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    style_token = str(manifest.get("style_token", ""))
    entries: list[dict] = [r for r in manifest.get("refs", []) if str(r.get("file", ""))]

    if out_dir is not None:
        if not only:
            raise ValueError("out_dir (staging) requiere `only` — la re-tirada es por refs explícitas")
        todo = [e for e in entries if str(e.get("id")) in only]
    else:
        todo = [e for e in entries if not (pack_dir / str(e["file"])).exists()]
        if only:
            todo = [e for e in todo if str(e.get("id")) in only]
    if folder_only:
        todo = [e for e in todo if ref_folder(str(e["file"])) == folder_only]
    if not todo:
        return {"generated": [], "cost_usd": 0.0, "skipped": []}

    # Referencias de estilo: las imágenes que YA existen en el pack (subidas
    # por el usuario o generadas en pasadas anteriores), priorizando su
    # propia carpeta (cara↔cara, personaje↔personaje) — mezclar puntos de
    # vista diluye el encuadre del blockout.
    def style_refs_for(ref: dict) -> list[Path]:
        folder = ref_folder(str(ref["file"]))
        ordered: list[Path] = []

        def add(want_folder: str) -> None:
            for e in entries:
                if ref_folder(str(e["file"])) != want_folder:
                    continue
                path = pack_dir / str(e["file"])
                if path.exists() and path not in ordered:
                    ordered.append(path)

        add(folder)
        for other in REF_FOLDERS:
            if other != folder:
                add(other)
        return ordered[:3]

    # Clientes por modelo, creados solo si esta tirada los usa (cada uno
    # falla-loud por su clave: MESHY_API_KEY / FAL_KEY).
    meshy_api: MeshyImageToImage | None = None
    fal_api: FalImageToImage | None = None
    dest_dir = out_dir if out_dir is not None else pack_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    generated: list[str] = []
    cost = 0.0
    for entry in todo:
        ref_id = str(entry.get("id", ""))
        folder = ref_folder(str(entry["file"]))
        style_paths = style_refs_for(entry)
        seed = seed_for(entry)
        refs = [_to_data_uri(seed)] + [_to_data_uri(p) for p in style_paths]
        prompt = build_prompt(entry, style_token, bool(style_paths))
        if folder in ("surfaces", "faces"):
            if fal_api is None:
                fal_api = FalImageToImage()
            # Aspect del seed (rejilla y cara son cuadradas de 1024).
            with Image.open(seed) as seed_img:
                aspect = seed_img.size
            fal_model = SHEET_AI_MODEL if folder == "surfaces" else FACE_AI_MODEL
            log(f"StylePackBuilder: {style_id}/{ref_id} ← {len(refs)} refs, model={fal_model} (fal)")
            png, _task = await fal_api.run_one(prompt, refs, ai_model=fal_model, aspect=aspect)
            per_image = FalImageToImage.COST_USD.get(fal_model, 0.17)
            cost += per_image
            SPEND.add(per_image, f"style {style_id}/{ref_id}", "remote-gen")
        else:
            if meshy_api is None:
                meshy_api = MeshyImageToImage()
            log(f"StylePackBuilder: {style_id}/{ref_id} ← {len(refs)} refs, model={ai_model}")
            png, _task = await meshy_api.run_one(ai_model, prompt, refs)
            per_image = MeshyImageToImage.cost_usd(ai_model)
            cost += per_image
            SPEND.add(per_image, f"style {style_id}/{ref_id}", "remote-gen")
        out_path = dest_dir / str(entry["file"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img = Image.open(io.BytesIO(png)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        out_path.write_bytes(buf.getvalue())
        generated.append(ref_id)
        log(f"StylePackBuilder: escrito {out_path} ({img.size[0]}x{img.size[1]})")

    # Cover: si falta, copia de la primera ref de CARA disponible (gratis) —
    # es la que enseña de verdad cómo pinta este estilo el mundo que se juega.
    # En staging no se toca (la cover es del pack, no de la tirada).
    if out_dir is None:
        cover_file = str(manifest.get("cover", "cover.jpg"))
        cover_path = pack_dir / cover_file
        if not cover_path.exists():
            for e in entries:
                if ref_folder(str(e["file"])) != "faces":
                    continue
                src = pack_dir / str(e["file"])
                if src.exists():
                    cover_path.write_bytes(src.read_bytes())
                    log(f"StylePackBuilder: cover ← copia de {e['file']}")
                    break

    return {"generated": generated, "cost_usd": round(cost, 2), "skipped": []}


def generate_missing_sync(
    styles_dir: Path, style_id: str, ai_model: str = "nano-banana-pro",
    only: list[str] | None = None, log=print,
    folder_only: str | None = None, out_dir: Path | None = None,
) -> dict:
    return asyncio.run(
        generate_missing(styles_dir, style_id, ai_model, only, log, folder_only, out_dir)
    )
