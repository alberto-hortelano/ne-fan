"""Generación de imágenes de un style pack vía Meshy image-to-image.

Compartido por la CLI `tools/build_style_pack.py` (packs base shipped) y los
endpoints `/styles/upload` + `/styles/{id}/complete` (packs de usuario).

Dos modos de dirección de arte:
- Pack con imágenes subidas: las imágenes del usuario van como referencias de
  ESTILO (2ª..4ª ref) y el prompt exige calcar su estilo.
- Pack solo-texto (packs base): el estilo sale del `style_token` del
  style.json; la referencia aporta el ENCUADRE (mapa top-down / personaje).

Los seeds de encuadre son assets ya validados del repo: el battlemap global
para entornos y el frame base de y_bot para personajes.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
from pathlib import Path

from PIL import Image

from meshy_client import MeshyImageToImage
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES, REPO_ROOT

ENV_SEED = REPO_ROOT / "skinning_lab" / "bases" / "battlemap-town-style.png"
CHAR_SEED = (
    REPO_ROOT / "nefan-html" / "public" / "sprites" / "y_bot" / "idle"
    / "isometric_30" / "dir_0_frame_000.png"
)

# Qué debe mostrar la imagen de cada categoría (el estilo lo pone el pack).
CATEGORY_SCENES: dict[str, str] = {
    "nature": (
        "a wild natural landscape with NO buildings: forest edge, a stream, "
        "rocks, meadows and scattered trees"
    ),
    "settlement": (
        "a small village: several houses, dirt streets, a market square, "
        "fences and gardens"
    ),
    "fortress": (
        "a stone fortress: outer walls with towers, a gate, an inner "
        "courtyard with barracks"
    ),
    "interior": (
        "the interior floor plan of an inhabited building (a tavern or great "
        "hall): furniture, floors, walls drawn in cutaway with no roof"
    ),
    "underground": (
        "a torch-lit dungeon: stone corridors, chambers, stairs, pillars and "
        "rubble"
    ),
    "character_commoner": "a common villager in simple, worn work clothes",
    "character_noble": "a richly dressed noble with fine fabrics and jewelry",
    "character_warrior": "an armed warrior with period-appropriate armor and weapons",
}


def _to_data_uri(path: Path, long_side: int = 1024) -> str:
    img = Image.open(path).convert("RGB")
    w, h = img.size
    scale = min(1.0, long_side / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def build_prompt(category: str, style_token: str, has_style_refs: bool) -> str:
    """Prompt de generación de una categoría. Con refs de estilo del usuario,
    el estilo se calca de ellas; sin refs, manda el style_token."""
    scene = CATEGORY_SCENES[category]
    is_char = category in CHARACTER_CATEGORIES
    frame = (
        "full body character reference, single character, isometric 3/4 view, "
        "neutral plain background, no text, no UI"
        if is_char
        else "top-down 2D RPG game map artwork, flat overhead view, full bleed "
        "edge to edge, no border, no text, no UI, no characters"
    )
    if has_style_refs:
        style = (
            "Match the EXACT art style, palette and rendering technique of the "
            "reference images after the first one"
            + (f" ({style_token})" if style_token else "")
        )
    else:
        style = f"Art style: {style_token}"
    action = (
        "Redraw the FIRST reference image as"
        if is_char
        else "Fully REPAINT the first reference image, replacing ALL its content, as"
    )
    return f"{frame}. {action}: {scene}. {style}."


def missing_categories(styles_dir: Path, style_id: str) -> list[str]:
    """Categorías declaradas en style.json cuyo archivo no existe aún."""
    manifest = json.loads((styles_dir / style_id / "style.json").read_text(encoding="utf-8"))
    out: list[str] = []
    for ref in manifest.get("refs", []):
        if not (styles_dir / style_id / str(ref.get("file", ""))).exists():
            out.append(str(ref.get("category")))
    return out


async def generate_missing(
    styles_dir: Path,
    style_id: str,
    ai_model: str = "nano-banana-pro",
    only: list[str] | None = None,
    log=print,
) -> dict:
    """Genera las imágenes que faltan de un pack y actualiza la cover.

    Las imágenes YA presentes del pack se usan como referencias de estilo
    (hasta 3). Devuelve {generated: [...], cost_usd, skipped: [...]}.
    Fail-loud: cualquier error de la API aborta (no se escribe media imagen).
    """
    pack_dir = styles_dir / style_id
    manifest_path = pack_dir / "style.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    style_token = str(manifest.get("style_token", ""))
    refs_by_cat = {str(r["category"]): str(r["file"]) for r in manifest.get("refs", [])}

    todo = missing_categories(styles_dir, style_id)
    if only:
        todo = [c for c in todo if c in only]
    if not todo:
        return {"generated": [], "cost_usd": 0.0, "skipped": []}

    # Referencias de estilo: las imágenes que YA existen en el pack (subidas
    # por el usuario o generadas en pasadas anteriores), priorizando entornos
    # para entornos y personajes para personajes.
    def style_refs_for(category: str) -> list[Path]:
        is_char = category in CHARACTER_CATEGORIES
        prefer = CHARACTER_CATEGORIES if is_char else ENV_CATEGORIES
        others = ENV_CATEGORIES if is_char else CHARACTER_CATEGORIES
        paths: list[Path] = []
        for cat in (*prefer, *others):
            file = refs_by_cat.get(cat)
            if file and (pack_dir / file).exists():
                paths.append(pack_dir / file)
        return paths[:3]

    api = MeshyImageToImage()  # lanza si falta MESHY_API_KEY (fail-loud)
    generated: list[str] = []
    cost = 0.0
    for category in todo:
        style_paths = style_refs_for(category)
        seed = CHAR_SEED if category in CHARACTER_CATEGORIES else ENV_SEED
        refs = [_to_data_uri(seed)] + [_to_data_uri(p) for p in style_paths]
        prompt = build_prompt(category, style_token, has_style_refs=bool(style_paths))
        log(f"StylePackBuilder: {style_id}/{category} ← {len(refs)} refs, model={ai_model}")
        png, _task = await api.run_one(ai_model, prompt, refs)
        out_path = pack_dir / refs_by_cat[category]
        img = Image.open(io.BytesIO(png)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        out_path.write_bytes(buf.getvalue())
        generated.append(category)
        cost += MeshyImageToImage.cost_usd(ai_model)
        log(f"StylePackBuilder: escrito {out_path.name} ({img.size[0]}x{img.size[1]})")

    # Cover: si falta, copia del primer entorno disponible (sin coste extra).
    cover_file = str(manifest.get("cover", "cover.jpg"))
    cover_path = pack_dir / cover_file
    if not cover_path.exists():
        for cat in ENV_CATEGORIES:
            file = refs_by_cat.get(cat)
            if file and (pack_dir / file).exists():
                cover_path.write_bytes((pack_dir / file).read_bytes())
                log(f"StylePackBuilder: cover ← copia de {file}")
                break

    return {"generated": generated, "cost_usd": round(cost, 2), "skipped": []}


def generate_missing_sync(
    styles_dir: Path, style_id: str, ai_model: str = "nano-banana-pro",
    only: list[str] | None = None, log=print,
) -> dict:
    return asyncio.run(generate_missing(styles_dir, style_id, ai_model, only, log))
