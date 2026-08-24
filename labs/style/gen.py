#!/usr/bin/env python3
"""Bench de generación de referencias de estilo vía fal.ai (gpt-image-2).

Bench de generación de imágenes de referencia de estilo — el mismo patrón de
style packs: cada run es un subdir auto-contenido en runs/ con los PNG, un
manifest.json que asocia el prompt EXACTO a cada imagen, y un index.html para
revisarlas lado a lado.

Uso:
    source .venv/bin/activate
    python labs/style/gen.py <run_name> [--only caso1,caso2]

Los casos del batch se definen en CASES (lista declarativa al final). Requiere
FAL_KEY en el entorno o en .env de la raíz del repo.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
RUNS_DIR = Path(__file__).resolve().parent / "runs"
STYLES_DIR = REPO_ROOT / "nefan-core" / "data" / "styles"

sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ai_server"))
from style_pack_builder import (  # noqa: E402
    CATEGORY_SCENES,
    ENV_FRAME_ISO,
    ENV_FRAME_TOPDOWN,
)

from labs.common.env import load_key  # noqa: E402
from labs.common.fal import FAL_BASE, download_image  # noqa: E402
from labs.common.images import jpeg_data_uri  # noqa: E402
from labs.common.report import PAGE_CSS, manifest_upsert, render_page  # noqa: E402

T2I = "openai/gpt-image-2"
EDIT = "openai/gpt-image-2/edit"


@dataclass
class Case:
    name: str  # slug: nombre del PNG resultante
    endpoint: str  # T2I | EDIT
    prompt: str
    refs: list[Path] = field(default_factory=list)  # solo EDIT
    quality: str = "medium"
    image_size: str | dict = "square_hd"  # 1024x1024
    note: str = ""  # qué prueba este caso (para la galería)


def run_case(client: httpx.Client, case: Case, out_dir: Path) -> dict:
    payload: dict = {
        "prompt": case.prompt,
        "quality": case.quality,
        "image_size": case.image_size,
        "num_images": 1,
        "output_format": "png",
    }
    if case.endpoint == EDIT:
        if not case.refs:
            raise ValueError(f"{case.name}: EDIT requiere refs")
        payload["image_urls"] = [jpeg_data_uri(p) for p in case.refs]
    t0 = time.time()
    resp = client.post(f"{FAL_BASE}/{case.endpoint}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(
            f"{case.name}: fal devolvió {resp.status_code}: {resp.text[:2000]}"
        )
    data = resp.json()
    image = data["images"][0]
    png = download_image(image, client)
    out_path = out_dir / f"{case.name}.png"
    out_path.write_bytes(png)
    elapsed = round(time.time() - t0, 1)
    print(f"  ✓ {case.name} ({elapsed}s, {len(png) // 1024} KB)")
    return {
        "file": out_path.name,
        "endpoint": case.endpoint,
        "quality": case.quality,
        "image_size": case.image_size,
        "prompt": case.prompt,
        "refs": [str(p.relative_to(REPO_ROOT)) for p in case.refs],
        "note": case.note,
        "elapsed_s": elapsed,
        "width": image.get("width"),
        "height": image.get("height"),
    }


def render_index(out_dir: Path, entries: list[dict]) -> None:
    cards = []
    for e in entries:
        refs = (
            "<div class='refs'>refs: " + ", ".join(map(html.escape, e["refs"])) + "</div>"
            if e["refs"]
            else ""
        )
        cards.append(
            f"""
  <div class="card">
    <img src="{e['file']}" loading="lazy">
    <div class="meta">
      <h2>{html.escape(e['file'])}</h2>
      <div class="params">{html.escape(e['endpoint'])} · {e['quality']} ·
        {html.escape(json.dumps(e['image_size']))} · {e['elapsed_s']}s</div>
      <p class="note">{html.escape(e['note'])}</p>
      {refs}
      <pre>{html.escape(e['prompt'])}</pre>
    </div>
  </div>"""
        )
    render_page(
        html.escape(out_dir.name),
        f"<h1>{html.escape(out_dir.name)} — {len(entries)} imágenes</h1>\n{''.join(cards)}",
        out_dir / "index.html",
        css=PAGE_CSS,
    )


def main(cases: list[Case]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_name")
    ap.add_argument("--only", default="", help="lista de nombres de caso separados por coma")
    args = ap.parse_args()
    if args.only:
        wanted = set(args.only.split(","))
        unknown = wanted - {c.name for c in cases}
        if unknown:
            raise SystemExit(f"casos desconocidos: {sorted(unknown)}")
        cases = [c for c in cases if c.name in wanted]

    out_dir = RUNS_DIR / args.run_name
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    entries: list[dict] = (
        json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else []
    )

    key = load_key("FAL_KEY")
    with httpx.Client(
        headers={"Authorization": f"Key {key}"}, timeout=httpx.Timeout(300.0)
    ) as client:
        for case in cases:
            print(f"→ {case.name} [{case.endpoint}, {case.quality}]")
            entry = run_case(client, case, out_dir)
            entries = manifest_upsert(manifest_path, entry, key="file")
            render_index(out_dir, entries)
    print(f"\nrun completo: {out_dir}/index.html ({len(entries)} imágenes en manifest)")


# ---------------------------------------------------------------------------
# Batch: farmland + farmland_iso para medievo_crudo (gpt-image-2)
# ---------------------------------------------------------------------------

STYLE_TOKEN = json.loads(
    (STYLES_DIR / "medievo_crudo" / "style.json").read_text(encoding="utf-8")
)["style_token"]
FARMLAND = CATEGORY_SCENES["farmland"]
PACK = STYLES_DIR / "medievo_crudo"

# Reglas de la plantilla reforzadas (cenital con caras / iso 2:1), en el mismo
# orden frame → acción → escena → estilo que build_prompt.
FACES_RULES = (
    "Faked elevation is MANDATORY: the barn and farmhouse show their roof AND "
    "their south wall below it (about 25% darker, with a door), every tree "
    "shows its canopy AND its trunk at the south edge, fences cast their post "
    "shadows south"
)
ISO_RULES = (
    "True 2:1 isometric pixel-art-style projection is MANDATORY: every "
    "building and tree drawn as a volume with southwest faces lit and "
    "southeast faces in shadow, ground cells are 2:1 rhombi"
)

CASES = [
    # -- smoke barato para validar auth/params (se conserva igualmente) --
    Case(
        name="smoke_low",
        endpoint=T2I,
        quality="low",
        prompt=f"{ENV_FRAME_TOPDOWN}. Draw: {FARMLAND}. Art style: {STYLE_TOKEN}.",
        note="Smoke test: prompt del builder tal cual, quality low.",
    ),
    # -- cenital --
    Case(
        name="top_t2i_builder",
        endpoint=T2I,
        prompt=f"{ENV_FRAME_TOPDOWN}. Draw: {FARMLAND}. Art style: {STYLE_TOKEN}.",
        note="Baseline: prompt canónico del builder (frame topdown + escena farmland + style_token), text-to-image.",
    ),
    Case(
        name="top_t2i_faces",
        endpoint=T2I,
        prompt=(
            f"{ENV_FRAME_TOPDOWN}. {FACES_RULES}. Draw: {FARMLAND}. "
            f"Art style: {STYLE_TOKEN}."
        ),
        note="Prompt reforzado con las reglas de 'cenital con caras' de la plantilla.",
    ),
    Case(
        name="top_edit_refs",
        endpoint=EDIT,
        refs=[PACK / "settlement.jpg", PACK / "forest.jpg"],
        prompt=(
            f"{ENV_FRAME_TOPDOWN}. Draw: {FARMLAND}. Match the EXACT art "
            f"style, palette and rendering technique of the reference images "
            f"({STYLE_TOKEN}). Do NOT copy their content or layout, only the style."
        ),
        note="Edit con settlement.jpg+forest.jpg del pack como refs de estilo — ¿respeta la paleta de medievo_crudo?",
    ),
    # -- isométrica --
    Case(
        name="iso_t2i_builder",
        endpoint=T2I,
        prompt=f"{ENV_FRAME_ISO}. Draw: {FARMLAND}. Art style: {STYLE_TOKEN}.",
        note="Baseline iso: prompt canónico del builder (frame iso), text-to-image.",
    ),
    Case(
        name="iso_t2i_rules",
        endpoint=T2I,
        prompt=(
            f"{ENV_FRAME_ISO}. {ISO_RULES}. Draw: {FARMLAND}. "
            f"Art style: {STYLE_TOKEN}."
        ),
        note="Prompt iso reforzado (2:1 estricto, SO iluminado / SE en sombra).",
    ),
    Case(
        name="iso_edit_refs",
        endpoint=EDIT,
        refs=[PACK / "settlement.jpg", PACK / "forest.jpg"],
        prompt=(
            f"{ENV_FRAME_ISO}. Draw: {FARMLAND}. Match the EXACT art style, "
            f"palette and rendering technique of the reference images "
            f"({STYLE_TOKEN}). Do NOT copy their content, layout or top-down "
            f"projection, only the style."
        ),
        note="Edit iso con refs del pack (que son cenitales) — ¿mantiene la proyección iso pese a refs top-down?",
    ),
    # -- batch 2: refinar iso (sin deriva pixel-art ni cenital) y combinar
    #    refs de paleta con reglas de caras --
    Case(
        name="iso_t2i_game",
        endpoint=T2I,
        prompt=(
            f"{ENV_FRAME_ISO}. Render it like a classic isometric strategy "
            f"game map: strict 2:1 dimetric camera, the SAME projection for "
            f"every building and tree across the whole image, painterly "
            f"brushwork (NOT pixel art). Draw: {FARMLAND}. "
            f"Art style: {STYLE_TOKEN}."
        ),
        note="Iso batch 2: 2:1 estricto en clave 'juego de estrategia isométrico', pincelada pictórica sin pixel-art.",
    ),
    Case(
        name="iso_edit_rules",
        endpoint=EDIT,
        refs=[PACK / "settlement.jpg", PACK / "forest.jpg"],
        prompt=(
            f"{ENV_FRAME_ISO}. The reference images are TOP-DOWN; do NOT "
            f"copy their projection — render in strict 2:1 isometric like a "
            f"classic strategy game, every volume with southwest faces lit "
            f"and southeast faces in shadow. Draw: {FARMLAND}. Match the "
            f"EXACT art style, palette and rendering technique of the "
            f"reference images ({STYLE_TOKEN}), not their content or camera."
        ),
        note="Iso batch 2: refs de paleta del pack + orden explícita de ignorar su proyección cenital.",
    ),
    Case(
        name="top_edit_faces",
        endpoint=EDIT,
        refs=[PACK / "settlement.jpg", PACK / "forest.jpg"],
        prompt=(
            f"{ENV_FRAME_TOPDOWN}. {FACES_RULES}. Draw: {FARMLAND}. Match "
            f"the EXACT art style, palette and rendering technique of the "
            f"reference images ({STYLE_TOKEN}). Do NOT copy their content or "
            f"layout, only the style."
        ),
        note="Cenital batch 2: paleta del pack (refs) + reglas de caras explícitas — el mejor de ambos mundos.",
    ),
    # -- finalistas en high (misma receta que sus ganadoras medium) --
    Case(
        name="top_final_high",
        endpoint=T2I,
        quality="high",
        prompt=(
            f"{ENV_FRAME_TOPDOWN}. {FACES_RULES}. Draw: {FARMLAND}. "
            f"Art style: {STYLE_TOKEN}."
        ),
        note="Finalista cenital en quality high: misma receta que top_t2i_faces.",
    ),
    Case(
        name="iso_final_high",
        endpoint=T2I,
        quality="high",
        prompt=(
            f"{ENV_FRAME_ISO}. Render it like a classic isometric strategy "
            f"game map: strict 2:1 dimetric camera, the SAME projection for "
            f"every building and tree across the whole image, painterly "
            f"brushwork (NOT pixel art). Draw: {FARMLAND}. "
            f"Art style: {STYLE_TOKEN}."
        ),
        note="Finalista iso en quality high: misma receta que iso_t2i_game.",
    ),
]

if __name__ == "__main__":
    main(CASES)
