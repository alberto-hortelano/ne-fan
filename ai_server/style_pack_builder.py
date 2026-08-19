"""Generación de imágenes de un style pack vía Meshy/fal image-to-image.

Compartido por la CLI `tools/build_style_pack.py` (packs base shipped) y los
endpoints `/styles/upload` + `/styles/{id}/complete` (packs de usuario).

Formato de pack (2026-08, refs libres): cada ref del style.json declara
`{id, file, description, gen_scene?, seed?, role?}` y vive en la carpeta de
su vista (overworld/ | proscenium/ | fps/ | characters/). El CONTENIDO de la
imagen a generar es `gen_scene` (prompt EN) o, si falta, la `description` en
español tal cual; el ENCUADRE lo pone el seed de `_plantilla/` (declarado en
`seed` o el default de su vista).

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
from style_packs import REPO_ROOT, ROLE_FPS_SURFACES, ref_folder

ENV_SEED = REPO_ROOT / "nefan-core" / "data" / "styles" / "battlemap-town-style.png"
CHAR_SEED = (
    REPO_ROOT / "nefan-html" / "public" / "sprites" / "y_bot" / "idle"
    / "isometric_30" / "dir_0_frame_000.png"
)
# Plantillas clay three.js (renders de los builders greybox de producción):
# seeds de encuadre por VISTA, con un pool nombrado por carpeta y un
# default.png por vista para refs libres sin seed declarada.
PLANTILLA_DIR = REPO_ROOT / "nefan-core" / "data" / "styles" / "_plantilla"

#: Modelo del repintado de refs de plató: clay → gpt-image-2 vía fal DIRECTO
#: (máxima fidelidad de layout del bench labs/escenografia/greybox — el mismo
#: camino que el repintado in-game del plató en scene_image_generator).
STAGE_AI_MODEL = "gpt-image-2"
#: Modelo de la lámina fps_surfaces: nano-banana-pro vía fal — el ganador del
#: bench labs/fps para swatches de material tileables (mismo modelo que pinta
#: las páginas tile del atlas in-game).
FPS_AI_MODEL = "nano-banana-pro"


def seed_for(ref: dict) -> Path:
    """Seed de encuadre de una ref. `ref.seed` (ruta relativa a _plantilla/)
    manda; sin él, el default de su vista. Personajes usan el frame y_bot.
    Fail-loud si un seed declarado o el default de plató/fps no existen (la
    plantilla ES el encuadre; sin ella el modelo inventa la cámara)."""
    declared = str(ref.get("seed") or "")
    if declared:
        path = PLANTILLA_DIR / declared
        if not path.exists():
            raise FileNotFoundError(f"seed declarado ausente: {path} (ref '{ref.get('id')}')")
        return path
    folder = ref_folder(str(ref.get("file", "")))
    if folder == "characters":
        return CHAR_SEED
    default = PLANTILLA_DIR / folder / "default.png"
    if default.exists():
        return default
    if folder == "overworld":
        return ENV_SEED
    raise FileNotFoundError(
        f"plantilla default de la vista '{folder}' ausente: {default} — "
        "captura las plantillas primero (labs/plantillas/capture.sh)"
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


# Encuadre por VISTA: entornos cenitales en la proyección oblicua única del
# formato 2D; platós a pie de suelo; lámina de materiales; model sheet.
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


def build_prompt(ref: dict, style_token: str, has_style_refs: bool) -> str:
    """Prompt de generación de una ref. El CONTENIDO es `gen_scene` (EN) o la
    `description` (ES) tal cual; el frame lo decide la carpeta de la ref (y
    el role para la lámina). Con refs de estilo del pack, el estilo se calca
    de ellas; sin refs, manda el style_token."""
    scene = str(ref.get("gen_scene") or "").strip() or str(ref.get("description") or "").strip()
    if not scene:
        raise ValueError(f"ref '{ref.get('id')}' sin gen_scene ni description — nada que generar")
    folder = ref_folder(str(ref.get("file", "")))
    is_char = folder == "characters"
    is_stage = folder == "proscenium"
    is_fps = folder == "fps" or str(ref.get("role") or "") == ROLE_FPS_SURFACES
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


def missing_refs(styles_dir: Path, style_id: str) -> list[dict]:
    """Refs declaradas en style.json cuyo archivo no existe aún:
    [{id, view, description}] — lo que el diálogo de coste muestra y
    /complete genera."""
    manifest = json.loads((styles_dir / style_id / "style.json").read_text(encoding="utf-8"))
    out: list[dict] = []
    for ref in manifest.get("refs", []):
        if not (styles_dir / style_id / str(ref.get("file", ""))).exists():
            out.append({
                "id": str(ref.get("id", "")),
                "view": ref_folder(str(ref.get("file", ""))),
                "description": str(ref.get("description", "")),
            })
    return out


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
    (hasta 3). Devuelve {generated: [...ids], cost_usd, skipped: [...]}.
    Fail-loud: cualquier error de la API aborta (no se escribe media imagen).

    - `only`: limita a esos ids de ref.
    - `view`: limita a las refs de esa vista/carpeta
      ("overworld"|"proscenium"|"fps"|"characters").
    - `out_dir` (staging): genera los ids de `only` INCONDICIONALMENTE
      (aunque su imagen exista — es la re-tirada del flujo de aprobación) y
      las escribe ahí, sin tocar pack, cover ni style.json.
    - Modelo por vista: proscenium → fal gpt-image-2 (clay → imagen, camino
      del bench); fps → fal nano-banana-pro; el resto por Meshy `ai_model`.
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
    if view:
        todo = [e for e in todo if ref_folder(str(e["file"])) == view]
    if not todo:
        return {"generated": [], "cost_usd": 0.0, "skipped": []}

    # Referencias de estilo: las imágenes que YA existen en el pack (subidas
    # por el usuario o generadas en pasadas anteriores), priorizando su
    # propia vista (plató↔plató, cenital↔cenital, personaje↔personaje) —
    # mezclar puntos de vista diluye el encuadre del blockout.
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
        for other in ("overworld", "characters", "proscenium", "fps"):
            if other != folder:
                add(other)
        return ordered[: 2 if folder == "proscenium" else 3]

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
        is_stage = folder == "proscenium"
        is_fps = folder == "fps"
        style_paths = style_refs_for(entry)
        seed = seed_for(entry)
        refs = [_to_data_uri(seed)] + [_to_data_uri(p) for p in style_paths]
        prompt = build_prompt(entry, style_token, bool(style_paths))
        if is_stage or is_fps:
            if fal_api is None:
                fal_api = FalImageToImage()
            # Aspect del seed (plató: plantillas del bench 1600×1000 →
            # gpt-image-2 1280×800; fps: rejilla cuadrada 1024).
            with Image.open(seed) as seed_img:
                aspect = seed_img.size
            fal_model = FPS_AI_MODEL if is_fps else STAGE_AI_MODEL
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

    # Cover: si falta, copia de la primera ref cenital disponible (gratis).
    # En staging no se toca (la cover es del pack, no de la tirada).
    if out_dir is None:
        cover_file = str(manifest.get("cover", "cover.jpg"))
        cover_path = pack_dir / cover_file
        if not cover_path.exists():
            for e in entries:
                if ref_folder(str(e["file"])) != "overworld":
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
    view: str | None = None, out_dir: Path | None = None,
) -> dict:
    return asyncio.run(generate_missing(styles_dir, style_id, ai_model, only, log, view, out_dir))
