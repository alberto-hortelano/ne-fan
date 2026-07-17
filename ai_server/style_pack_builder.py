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
from style_packs import CHARACTER_CATEGORIES, ENV_CATEGORIES, LEGACY_ALIASES, REPO_ROOT

ENV_SEED = REPO_ROOT / "skinning_lab" / "bases" / "battlemap-town-style.png"
CHAR_SEED = (
    REPO_ROOT / "nefan-html" / "public" / "sprites" / "y_bot" / "idle"
    / "isometric_30" / "dir_0_frame_000.png"
)

# Qué debe mostrar la imagen de cada categoría (el estilo lo pone el pack).
# Cada entorno es una ZONA de mundo abierto: escena completa con varios
# elementos y una TRANSICIÓN a la zona vecina, nunca un sujeto aislado — la
# referencia condiciona la composición del repintado, y el material de los
# caminos debe corresponder a la zona (empedrado SOLO en plazas urbanas).
CATEGORY_SCENES: dict[str, str] = {
    "settlement": (
        "a small village and its surroundings: houses with varied roofs "
        "around a market square (cobblestone paving ONLY in the square), "
        "packed-dirt streets leading out, gardens and fences, blending into "
        "plowed fields and a forest edge at the borders"
    ),
    "farmland": (
        "farmland countryside: plowed fields with crop rows, a farmhouse and "
        "a barn, hedges and wooden fences, a packed-dirt road, blending into "
        "open meadow and a forest edge"
    ),
    "forest": (
        "a wild forest with NO buildings: dense tree canopy, a clearing, a "
        "narrow dirt trail (NO paving), a stream with rocks, blending into "
        "open meadow at one side"
    ),
    "wetland": (
        "a swamp with NO buildings: murky water channels, reeds and moss, "
        "twisted trees, plank walkways over the mud, blending into wet "
        "meadow at one side"
    ),
    "desert": (
        "a desert with NO buildings: sand dunes, rocky outcrops, sparse dry "
        "shrubs, a small oasis, a sandy trail, blending into dry steppe at "
        "one side"
    ),
    "snow": (
        "a snowy landscape with NO buildings: snow fields, pine trees, "
        "rocks, a frozen stream, a trodden-snow trail, blending into alpine "
        "meadow at one side"
    ),
    "fortress": (
        "a stone fortress set in open landscape: outer walls with towers and "
        "a gate, an inner courtyard with barracks, and the fields around the "
        "walls with a packed-dirt road leading to the gate"
    ),
    "interior": (
        "the interior of an inhabited building (a tavern or great hall) "
        "shown in cutaway WITHIN its surroundings: no roof, furniture and "
        "floors visible, and the world continuing around the building — "
        "village street, grass, a neighbouring house, a dirt path reaching "
        "its door (never a floor plan floating on a void)"
    ),
    "underground": (
        "a torch-lit dungeon: stone corridors, chambers of different sizes, "
        "stairs, pillars and rubble"
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


# Encuadre por tipo de imagen: entornos en la proyección oblicua única del
# formato 2D; los personajes son un model sheet.
ENV_FRAME = (
    "top-down 2D RPG game map artwork with faked elevation: every vertical "
    "object also paints its SOUTH face below its top, ~25% darker, and a "
    "narrower EAST side face in shadow (buildings show roof plus south wall "
    "with door, trees show canopy plus trunk at their south edge), full "
    "bleed edge to edge, no border, no text, no UI, no characters"
)
CHAR_FRAME = (
    "character model sheet of ONE character: the SAME character drawn three "
    "times full body — front view, three-quarter view and back view, "
    "standing side by side, neutral plain background, no text, no UI"
)


def build_prompt(category: str, style_token: str, has_style_refs: bool) -> str:
    """Prompt de generación de una categoría. Con refs de estilo del usuario,
    el estilo se calca de ellas; sin refs, manda el style_token."""
    category = LEGACY_ALIASES.get(category, category)
    scene = CATEGORY_SCENES[category]
    is_char = category in CHARACTER_CATEGORIES
    frame = CHAR_FRAME if is_char else ENV_FRAME
    if has_style_refs:
        style = (
            "Match the EXACT art style, palette and rendering technique of the "
            "reference images after the first one"
            + (f" ({style_token})" if style_token else "")
        )
    else:
        style = f"Art style: {style_token}"
    action = (
        "Using the FIRST reference image only as body-proportion guide, draw"
        if is_char
        else "Fully REPAINT the first reference image, replacing ALL its content, as"
    )
    return f"{frame}. {action}: {scene}. {style}."


def missing_categories(styles_dir: Path, style_id: str) -> list[str]:
    """Categorías declaradas en style.json cuyo archivo no existe aún. Las
    entradas legacy `perspective: "isometric"` se ignoran (era de dos
    proyecciones)."""
    manifest = json.loads((styles_dir / style_id / "style.json").read_text(encoding="utf-8"))
    out: list[str] = []
    for ref in manifest.get("refs", []):
        if str(ref.get("perspective") or "topdown") == "isometric":
            continue
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
    entries = [
        {
            "category": str(r.get("category", "")),
            "file": str(r.get("file", "")),
        }
        for r in manifest.get("refs", [])
        if str(r.get("perspective") or "topdown") != "isometric"
    ]

    todo = [e for e in entries if e["file"] and not (pack_dir / e["file"]).exists()]
    if only:
        todo = [e for e in todo if e["category"] in only]
    if not todo:
        return {"generated": [], "cost_usd": 0.0, "skipped": []}

    # Referencias de estilo: las imágenes que YA existen en el pack (subidas
    # por el usuario o generadas en pasadas anteriores), priorizando entornos
    # para entornos y personajes para personajes.
    def style_refs_for(category: str) -> list[Path]:
        is_char = category in CHARACTER_CATEGORIES
        prefer = CHARACTER_CATEGORIES if is_char else ENV_CATEGORIES
        others = ENV_CATEGORIES if is_char else CHARACTER_CATEGORIES
        ordered: list[Path] = []

        def add(cats: tuple) -> None:
            for cat in cats:
                for e in entries:
                    if e["category"] != cat:
                        continue
                    path = pack_dir / e["file"]
                    if e["file"] and path.exists() and path not in ordered:
                        ordered.append(path)

        add(prefer)
        add(others)
        return ordered[:3]

    api = MeshyImageToImage()  # lanza si falta MESHY_API_KEY (fail-loud)
    generated: list[str] = []
    cost = 0.0
    for entry in todo:
        category = entry["category"]
        style_paths = style_refs_for(category)
        seed = CHAR_SEED if category in CHARACTER_CATEGORIES else ENV_SEED
        refs = [_to_data_uri(seed)] + [_to_data_uri(p) for p in style_paths]
        prompt = build_prompt(category, style_token, bool(style_paths))
        log(f"StylePackBuilder: {style_id}/{category} ← {len(refs)} refs, model={ai_model}")
        png, _task = await api.run_one(ai_model, prompt, refs)
        out_path = pack_dir / entry["file"]
        img = Image.open(io.BytesIO(png)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        out_path.write_bytes(buf.getvalue())
        generated.append(category)
        cost += MeshyImageToImage.cost_usd(ai_model)
        log(f"StylePackBuilder: escrito {out_path.name} ({img.size[0]}x{img.size[1]})")

    # Cover: si falta, copia del primer entorno disponible (gratis).
    cover_file = str(manifest.get("cover", "cover.jpg"))
    cover_path = pack_dir / cover_file
    if not cover_path.exists():
        for cat in ENV_CATEGORIES:
            for e in entries:
                if e["category"] == cat and (pack_dir / e["file"]).exists():
                    cover_path.write_bytes((pack_dir / e["file"]).read_bytes())
                    log(f"StylePackBuilder: cover ← copia de {e['file']}")
                    break
            else:
                continue
            break

    return {"generated": generated, "cost_usd": round(cost, 2), "skipped": []}


def generate_missing_sync(
    styles_dir: Path, style_id: str, ai_model: str = "nano-banana-pro",
    only: list[str] | None = None, log=print,
) -> dict:
    return asyncio.run(generate_missing(styles_dir, style_id, ai_model, only, log))
