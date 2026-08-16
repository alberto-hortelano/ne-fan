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

from meshy_client import FalImageToImage, MeshyImageToImage
from spend_tracker import SPEND
from style_packs import (
    CHARACTER_CATEGORIES,
    ENV_CATEGORIES,
    FPS_CATEGORIES,
    LEGACY_ALIASES,
    REPO_ROOT,
    STAGE_CATEGORIES,
)

ENV_SEED = REPO_ROOT / "nefan-core" / "data" / "styles" / "battlemap-town-style.png"
CHAR_SEED = (
    REPO_ROOT / "nefan-html" / "public" / "sprites" / "y_bot" / "idle"
    / "isometric_30" / "dir_0_frame_000.png"
)
# Plantillas clay three.js (renders de los builders greybox de producción):
# seed de encuadre por categoría. Las de plató son OBLIGATORIAS (fail-loud);
# las oblicuas sustituyen al battlemap cuando existen (transición suave).
PLANTILLA_DIR = REPO_ROOT / "nefan-core" / "data" / "styles" / "_plantilla"
STAGE_SEED_DIR = PLANTILLA_DIR / "proscenio"
OBLIQUE_SEED_DIR = PLANTILLA_DIR / "oblicua"
FPS_SEED_DIR = PLANTILLA_DIR / "fps"

#: Modelo del repintado de refs de plató: clay → gpt-image-2 vía fal DIRECTO
#: (máxima fidelidad de layout del bench labs/escenografia/greybox — el mismo
#: camino que el repintado in-game del plató en scene_image_generator).
STAGE_AI_MODEL = "gpt-image-2"
#: Modelo de la lámina fps_surfaces: nano-banana-pro vía fal — el ganador del
#: bench labs/fps para swatches de material tileables (mismo modelo que pinta
#: las páginas tile del atlas in-game).
FPS_AI_MODEL = "nano-banana-pro"


def seed_for(category: str) -> Path:
    """Seed de encuadre de una categoría. Plató sin plantilla clay = error
    (la plantilla ES el encuadre; sin ella el modelo inventa la cámara)."""
    if category in CHARACTER_CATEGORIES:
        return CHAR_SEED
    if category in FPS_CATEGORIES:
        path = FPS_SEED_DIR / f"{category}.png"
        if not path.exists():
            raise FileNotFoundError(
                f"plantilla de rejilla fps ausente: {path} — regenerarla con "
                "ai_server/tools/gen_fps_seed.py"
            )
        return path
    if category in STAGE_CATEGORIES:
        path = STAGE_SEED_DIR / f"{category}.png"
        if not path.exists():
            raise FileNotFoundError(
                f"plantilla clay de plató ausente: {path} — captura las "
                "plantillas primero (labs/plantillas/capture.sh)"
            )
        return path
    clay = OBLIQUE_SEED_DIR / f"{category}.png"
    return clay if clay.exists() else ENV_SEED

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
    # Lámina de materiales de la vista fps: 12 swatches (uno por celda de la
    # rejilla del seed). Redactada en clave medieval — un pack de otra
    # ambientación la sustituye con `scene` (mismos 12 huecos, sus materiales).
    "fps_surfaces": (
        "twelve different flat material swatches, one per grid cell, covering "
        "the world's most common surfaces: whitewashed plaster wall, rough "
        "fieldstone masonry, weathered wooden planks, clay roof tiles, packed "
        "dirt ground, cobblestone paving, short grass, forest floor with leaf "
        "litter, thatch, dark rock, aged plaster with exposed brick, worn "
        "metal fittings"
    ),
    "character_commoner": "a common villager in simple, worn work clothes",
    "character_noble": "a richly dressed noble with fine fabrics and jewelry",
    "character_warrior": "an armed warrior with period-appropriate armor and weapons",
    # ── Categorías de PLATÓ (vista proscenio, nivel de suelo) ───────────────
    # Escenas canónicas en clave medieval, destiladas de las seis bases del
    # bench labs/escenografia. Un pack de otra ambientación las sustituye con
    # `scene` por ref (acero_neon: interior de nave en vez de taberna).
    "stage_street": (
        "a curved main street: arcaded facades and varied house fronts on "
        "both sides, a cart with barrels, a tower rising above the bend"
    ),
    "stage_plaza": (
        "a market square: church front, a stone fountain, market stalls "
        "with awnings, houses closing the far side"
    ),
    "stage_interior": (
        "the common room of a tavern: timber beams, a stone hearth with "
        "fire, wooden tables and benches, a counter, a staircase"
    ),
    "stage_nature": (
        "a forest clearing: a stream crossed by a wooden footbridge, "
        "mossy rocks, dense tree mass closing the background"
    ),
    "stage_harbor": (
        "a river dock: a wooden treadwheel crane, a moored barge, a toll "
        "hut, nets and crates along the quay"
    ),
    "stage_gate": (
        "a walled city gate seen from outside: gatehouse with two towers, "
        "a raised portcullis, the road leading in, fields at the sides"
    ),
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
# Lámina fps_surfaces: mismas reglas duras que el atlas de superficies
# in-game (surface_atlas_generator.RULES) — swatches planos a 90°, nunca
# escenas dentro de una celda.
FPS_FRAME = (
    "a TEXTURE ATLAS SHEET for a retro first-person 3D game: a grid of "
    "rectangular cells on a plain neutral grey background, each cell one "
    "FLAT MATERIAL SWATCH seen straight-on at exactly 90 degrees, filling "
    "its rectangle edge to edge. NEVER paint a scene, an object, a horizon "
    "or a floor meeting a wall inside a cell. The grey gutter between cells "
    "stays plain grey. Flat even lighting, albedo only: no cast shadows, no "
    "perspective. No text, no numbers, no borders, no watermark"
)
# Plató: nivel de suelo, cámara al sur mirando al norte (convención del
# proscenio). Sin vocabulario teatral — el modelo pinta cortinas/marcos si se
# le insinúa un escenario (lección de la versión SVG del compositor).
STAGE_FRAME = (
    "eye-level ground view of a game location: camera standing at the south "
    "edge looking north, natural single-source daylight with consistent "
    "shadows, full bleed edge to edge, no borders, no letterboxing, no "
    "curtains, no frames, no people, no text, no UI"
)
# La plantilla clay fija cámara/perspectiva pero es referencia NO estricta:
# el contenido lo manda la escena del estilo (a diferencia del repintado
# in-game, que sí exige siluetas exactas).
STAGE_ACTION = (
    "The first reference image is an untextured 3D blockout: keep its CAMERA "
    "HEIGHT, perspective and horizon line exactly, but freely redesign the "
    "scene content itself, painting"
)


def build_prompt(
    category: str, style_token: str, has_style_refs: bool,
    scene_override: str | None = None,
) -> str:
    """Prompt de generación de una categoría. Con refs de estilo del usuario,
    el estilo se calca de ellas; sin refs, manda el style_token.
    `scene_override` (campo `scene` del ref en style.json) sustituye el
    CONTENIDO canónico de la categoría — CATEGORY_SCENES está redactado en
    clave medieval y un pack de otra ambientación necesita sus propias
    escenas (mismo encuadre y reglas de zona)."""
    category = LEGACY_ALIASES.get(category, category)
    scene = scene_override or CATEGORY_SCENES[category]
    is_char = category in CHARACTER_CATEGORIES
    is_stage = category in STAGE_CATEGORIES
    is_fps = category in FPS_CATEGORIES
    frame = (
        CHAR_FRAME if is_char
        else STAGE_FRAME if is_stage
        else FPS_FRAME if is_fps
        else ENV_FRAME
    )
    if has_style_refs:
        style = (
            "Match the EXACT art style, palette and rendering technique of the "
            "reference images after the first one"
            + (f" ({style_token})" if style_token else "")
        )
    else:
        style = f"Art style: {style_token}"
    if is_char:
        action = "Using the FIRST reference image only as body-proportion guide, draw"
    elif is_stage:
        action = STAGE_ACTION
    elif is_fps:
        action = (
            "Repaint the first reference image keeping its grid layout EXACTLY "
            "(same cells, same gutter): fill each grey cell with"
        )
    else:
        action = "Fully REPAINT the first reference image, replacing ALL its content, as"
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


def _view_of(category: str) -> str:
    """Vista de una categoría (espejo de viewForCategory en TS): el namespace
    manda — stage_* es proscenium, fps_* es fps, el resto (zonas y
    personajes) overworld."""
    if category.startswith("stage_"):
        return "proscenium"
    if category.startswith("fps_"):
        return "fps"
    return "overworld"


async def generate_missing(
    styles_dir: Path,
    style_id: str,
    ai_model: str = "nano-banana-pro",
    only: list[str] | None = None,
    log=print,
    view: str | None = None,
    out_dir: Path | None = None,
) -> dict:
    """Genera las imágenes que faltan de un pack y actualiza la cover.

    Las imágenes YA presentes del pack se usan como referencias de estilo
    (hasta 3). Devuelve {generated: [...], cost_usd, skipped: [...]}.
    Fail-loud: cualquier error de la API aborta (no se escribe media imagen).

    - `view`: limita a las refs de esa vista ("overworld"|"proscenium").
    - `out_dir` (staging): genera las categorías de `only`
      INCONDICIONALMENTE (aunque su imagen exista — es la re-tirada del flujo
      de aprobación) y las escribe ahí, sin tocar pack, cover ni style.json.
    - Modelo por categoría: las de plató van SIEMPRE por fal gpt-image-2
      (clay → imagen, camino del bench); el resto por Meshy `ai_model`.
    """
    pack_dir = styles_dir / style_id
    manifest_path = pack_dir / "style.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    style_token = str(manifest.get("style_token", ""))
    entries = [
        {
            "category": str(r.get("category", "")),
            "file": str(r.get("file", "")),
            "scene": str(r.get("scene") or ""),
        }
        for r in manifest.get("refs", [])
        if str(r.get("perspective") or "topdown") != "isometric"
    ]

    if out_dir is not None:
        if not only:
            raise ValueError("out_dir (staging) requiere `only` — la re-tirada es por categorías explícitas")
        todo = [e for e in entries if e["category"] in only]
    else:
        todo = [e for e in entries if e["file"] and not (pack_dir / e["file"]).exists()]
        if only:
            todo = [e for e in todo if e["category"] in only]
    if view:
        todo = [e for e in todo if _view_of(e["category"]) == view]
    if not todo:
        return {"generated": [], "cost_usd": 0.0, "skipped": []}

    # Referencias de estilo: las imágenes que YA existen en el pack (subidas
    # por el usuario o generadas en pasadas anteriores), priorizando su propia
    # familia (plató↔plató, entorno↔entorno, personaje↔personaje).
    def style_refs_for(category: str) -> list[Path]:
        if category in CHARACTER_CATEGORIES:
            prefer: tuple = CHARACTER_CATEGORIES
            others: tuple = ENV_CATEGORIES
        elif category in STAGE_CATEGORIES:
            # Plató: primero refs de plató aprobadas; después entornos (solo
            # aportan paleta/técnica — la cámara la fija el clay). Máx 2 para
            # no diluir el blockout en gpt-image-2/edit.
            prefer = STAGE_CATEGORIES
            others = ENV_CATEGORIES
        else:
            prefer = ENV_CATEGORIES
            others = CHARACTER_CATEGORIES
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
        return ordered[: 2 if category in STAGE_CATEGORIES else 3]

    # Clientes por modelo, creados solo si esta tirada los usa (cada uno
    # falla-loud por su clave: MESHY_API_KEY / FAL_KEY).
    meshy_api: MeshyImageToImage | None = None
    fal_api: FalImageToImage | None = None
    dest_dir = out_dir if out_dir is not None else pack_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    generated: list[str] = []
    cost = 0.0
    for entry in todo:
        category = entry["category"]
        is_stage = category in STAGE_CATEGORIES
        is_fps = category in FPS_CATEGORIES
        style_paths = style_refs_for(category)
        seed = seed_for(category)
        refs = [_to_data_uri(seed)] + [_to_data_uri(p) for p in style_paths]
        prompt = build_prompt(category, style_token, bool(style_paths), entry["scene"] or None)
        if is_stage or is_fps:
            if fal_api is None:
                fal_api = FalImageToImage()
            # Aspect del seed (plató: plantillas del bench 1600×1000 →
            # gpt-image-2 1280×800; fps: rejilla cuadrada 1024).
            with Image.open(seed) as seed_img:
                aspect = seed_img.size
            fal_model = FPS_AI_MODEL if is_fps else STAGE_AI_MODEL
            log(f"StylePackBuilder: {style_id}/{category} ← {len(refs)} refs, model={fal_model} (fal)")
            png, _task = await fal_api.run_one(prompt, refs, ai_model=fal_model, aspect=aspect)
            per_image = FalImageToImage.COST_USD.get(fal_model, 0.17)
            cost += per_image
            SPEND.add(per_image, f"style {style_id}/{category}", "remote-gen")
        else:
            if meshy_api is None:
                meshy_api = MeshyImageToImage()
            log(f"StylePackBuilder: {style_id}/{category} ← {len(refs)} refs, model={ai_model}")
            png, _task = await meshy_api.run_one(ai_model, prompt, refs)
            per_image = MeshyImageToImage.cost_usd(ai_model)
            cost += per_image
            SPEND.add(per_image, f"style {style_id}/{category}", "remote-gen")
        out_path = dest_dir / entry["file"]
        img = Image.open(io.BytesIO(png)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        out_path.write_bytes(buf.getvalue())
        generated.append(category)
        log(f"StylePackBuilder: escrito {out_path} ({img.size[0]}x{img.size[1]})")

    # Cover: si falta, copia del primer entorno disponible (gratis). En
    # staging no se toca (la cover es del pack, no de la tirada).
    if out_dir is None:
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
    view: str | None = None, out_dir: Path | None = None,
) -> dict:
    return asyncio.run(generate_missing(styles_dir, style_id, ai_model, only, log, view, out_dir))
