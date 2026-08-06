#!/usr/bin/env python3
"""Fase 2 del bench greybox: genera las variantes de cada escena.

Por escena (01_calle, 02_plaza, 05_puerto), 3 vías de pago:
  - gpt2_clay:     gpt-image-2/edit sobre el render clay (~$0.17)
  - flux_depth:    flux-control-lora-depth con nuestro depth.png (~$0.03)
  - seedream_clay: seedream v4 edit sobre el clay (~$0.03)
La 4ª columna del index es el baseline gratis: estilos/<esc>_magic.png
(gpt-image-2 sobre el render del SVG a mano).

Uso:
    source .venv/bin/activate
    python labs/escenografia/greybox/gen.py [--only caso1,caso2]

Coste run completo ≈ $0.70.
"""
from __future__ import annotations

import argparse
import base64
import html
import io
import json
import os
import time
from pathlib import Path

import httpx
from PIL import Image

GREYBOX = Path(__file__).resolve().parent
LAB = GREYBOX.parent
REPO_ROOT = LAB.parent.parent
OUT_DIR = GREYBOX / "out"
FAL_BASE = "https://fal.run"
IMAGE_SIZE = {"width": 1280, "height": 800}

MAGIC = (
    "Art style: Magic: The Gathering card illustration — polished digital "
    "fantasy painting, saturated jewel tones, dramatic light, painterly but "
    "detailed rendering, epic cinematic mood."
)

#: Para las vías img2img sobre el clay: la base MANDA en composición.
KEEP = (
    "Fully repaint this exact scene as a finished illustration. The "
    "reference is an untextured 3D blockout: replace the flat placeholder "
    "surfaces with fully detailed, textured materials while keeping the "
    "composition, camera angle, perspective, the position and silhouette of "
    "every volume, and the lighting direction EXACTLY as in the reference "
    "image. Ground-level view. Fill the entire frame edge to edge: no "
    "borders, no frames, no letterboxing, no vignettes. No people, no "
    "animals with human poses, no text, no watermark."
)

#: Descripción por escena (la vía depth SOLO ve el depth map: debe contarlo todo).
SCENES: dict[str, str] = {
    "01_calle": (
        "A curved main street in a medieval hillside town at sunset. Low "
        "golden sun from the west: an arcaded walkway with stone pillars in "
        "backlit shadow on the left, sunlit golden plaster facades with "
        "shuttered windows and a wooden door on the right, a wooden cart "
        "loaded with barrels beside them. The cobbled street with old cart "
        "ruts bends to the right and disappears behind the houses; a stone "
        "bell tower with a pyramidal roof rises above the bend, and hazy "
        "rooftops and soft hills dissolve in warm evening haze beyond. Long "
        "shadows run along the street with pools of warm light."
    ),
    "02_plaza": (
        "A market square in a medieval town at mid-morning. Morning sun from "
        "the east-right: a large stone church with buttresses and a bell "
        "tower closes the right side in backlit shade, casting a long "
        "diagonal shadow across the cobbled plaza; a small stone fountain "
        "with a central column stands in sunlight against that shadow. "
        "Wooden market stalls with canvas awnings, a table piled with "
        "pumpkins in the near right foreground, barrels near the left edge. "
        "Whitewashed houses with tiled gable roofs enclose the far side, "
        "with a gap between roofs opening to pale hazy farmland and hills."
    ),
    "05_puerto": (
        "A small river dock at foggy dawn. The stone quay cuts the scene in "
        "a strong diagonal, pewter-grey water beyond the edge dissolving "
        "into dense morning mist. A wooden treadwheel crane with a big "
        "vertical wheel stands dark in silhouette by the edge, its jib "
        "lifting a hanging bale over the water; a low moored barge with a "
        "tilted mast floats beyond the quay. On the left a small toll house "
        "with a single warm lantern glowing — the only warm light; drying "
        "fishing nets on wooden racks behind it. Barrels, crates and a "
        "coiled rope on the wet planked foreground. The far bank is a faint "
        "silhouette in the fog. Cold blue-grey dawn light, sun barely risen."
    ),
}

CASES: list[tuple[str, str]] = [
    (f"{scene}_{variant}", scene)
    for scene in SCENES
    for variant in ("gpt2_clay", "flux_depth", "seedream_clay")
]


def load_fal_key() -> str:
    key = os.environ.get("FAL_KEY", "")
    if not key:
        env = REPO_ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("FAL_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("FAL_KEY no está ni en el entorno ni en .env")
    return key


def to_data_uri(path: Path, long_side: int = 1280) -> str:
    img = Image.open(path).convert("RGB")
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)), Image.LANCZOS
        )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def build_request(case: str, scene: str) -> tuple[str, dict, float]:
    """→ (endpoint, payload, coste_estimado)."""
    desc = SCENES[scene]
    if case.endswith("gpt2_clay"):
        prompt = f"{KEEP} Scene: {desc} {MAGIC}"
        return (
            "openai/gpt-image-2/edit",
            {
                "prompt": prompt,
                "image_urls": [to_data_uri(GREYBOX / scene / "clay.png")],
                "quality": "high",
                "image_size": IMAGE_SIZE,
                "num_images": 1,
                "output_format": "png",
            },
            0.17,
        )
    if case.endswith("flux_depth"):
        prompt = f"{desc} {MAGIC} Fill the entire frame; no borders, no text, no people."
        return (
            "fal-ai/flux-control-lora-depth",
            {
                "prompt": prompt,
                "control_lora_image_url": to_data_uri(GREYBOX / scene / "depth.png"),
                "preprocess_depth": False,
                "image_size": IMAGE_SIZE,
                "num_inference_steps": 28,
                "guidance_scale": 3.5,
                "num_images": 1,
                "output_format": "png",
                "enable_safety_checker": True,
            },
            0.03,
        )
    if case.endswith("seedream_clay"):
        prompt = f"{KEEP} Scene: {desc} {MAGIC}"
        return (
            "fal-ai/bytedance/seedream/v4/edit",
            {
                "prompt": prompt,
                "image_urls": [to_data_uri(GREYBOX / scene / "clay.png")],
                "image_size": IMAGE_SIZE,
                "num_images": 1,
            },
            0.03,
        )
    raise SystemExit(f"caso desconocido: {case}")


def render_index(entries: list[dict]) -> None:
    by_scene: dict[str, dict[str, dict]] = {}
    for e in entries:
        by_scene.setdefault(e["scene"], {})[e["variant"]] = e
    blocks = []
    for scene in SCENES:
        row = by_scene.get(scene, {})
        baseline = f"../../estilos/magic/{scene}_magic.png"
        cols = [
            ("base clay (greybox 3D)", f"../{scene}/clay.png", ""),
            ("SVG a mano → gpt-image-2 (baseline)", baseline, ""),
        ]
        for variant, label in [
            ("gpt2_clay", "clay → gpt-image-2"),
            ("seedream_clay", "clay → seedream4"),
            ("flux_depth", "depth → FLUX depth"),
        ]:
            e = row.get(variant)
            cols.append(
                (label, e["file"], f"{e['cost_usd']}$ · {e['elapsed_s']}s")
                if e
                else (label + " (pendiente)", "", "")
            )
        cells = "".join(
            f'<div><h3>{html.escape(t)}</h3>'
            + (f'<img src="{src}" loading="lazy">' if src else "<p>—</p>")
            + (f'<div class="params">{meta}</div>' if meta else "")
            + "</div>"
            for t, src, meta in cols
        )
        blocks.append(f"<h2>{scene}</h2><div class='grid'>{cells}</div>")
    OUT_DIR.joinpath("index.html").write_text(
        f"""<!doctype html><meta charset="utf-8">
<title>greybox bench — SVG vs greybox 3D vs depth</title>
<style>
  body {{ background:#1c1c1c; color:#ddd; font:15px/1.5 system-ui; margin:24px; }}
  .grid {{ display:grid; grid-template-columns:repeat(2, 1fr); gap:14px; margin-bottom:38px; }}
  img {{ width:100%; height:auto; }}
  h2 {{ border-bottom:1px solid #333; padding-bottom:4px; }}
  h3 {{ margin:0 0 6px; font-size:14px; }}
  .params {{ color:#8fb35c; font-family:monospace; font-size:12.5px; }}
</style>
<h1>Bench greybox: mismo plan, distinto plano base ({len(entries)} imágenes)</h1>
<p>Comparativa por escena: greybox 3D (clay/depth) contra el baseline del SVG
dibujado a mano, todo con la misma cláusula de estilo Magic.</p>
{''.join(blocks)}
""",
        encoding="utf-8",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="casos separados por coma")
    args = ap.parse_args()
    cases = CASES
    if args.only:
        wanted = set(args.only.split(","))
        unknown = wanted - {c[0] for c in cases}
        if unknown:
            raise SystemExit(f"casos desconocidos: {sorted(unknown)}")
        cases = [c for c in cases if c[0] in wanted]

    OUT_DIR.mkdir(exist_ok=True)
    manifest_path = OUT_DIR / "manifest.json"
    entries: list[dict] = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else []
    )

    key = load_fal_key()
    with httpx.Client(
        headers={"Authorization": f"Key {key}"}, timeout=httpx.Timeout(400.0)
    ) as client:
        for case, scene in cases:
            endpoint, payload, cost = build_request(case, scene)
            print(f"→ {case} ({endpoint})", flush=True)
            t0 = time.time()
            resp = client.post(f"{FAL_BASE}/{endpoint}", json=payload)
            if resp.status_code != 200:
                raise RuntimeError(f"{case}: fal {resp.status_code}: {resp.text[:2000]}")
            image = resp.json()["images"][0]
            url = image["url"]
            if url.startswith("data:"):
                png = base64.b64decode(url.split(",", 1)[1])
            else:
                dl = client.get(url)
                dl.raise_for_status()
                png = dl.content
            (OUT_DIR / f"{case}.png").write_bytes(png)
            elapsed = round(time.time() - t0, 1)
            print(f"  ✓ {case} ({elapsed}s, {len(png) // 1024} KB)", flush=True)
            entry = {
                "file": f"{case}.png",
                "scene": scene,
                "variant": case.removeprefix(scene + "_"),
                "endpoint": endpoint,
                "prompt": payload["prompt"],
                "cost_usd": cost,
                "elapsed_s": elapsed,
            }
            entries = [e for e in entries if e["file"] != entry["file"]] + [entry]
            manifest_path.write_text(
                json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            render_index(entries)
    total = sum(e["cost_usd"] for e in entries)
    print(f"\nrun completo: {OUT_DIR}/index.html ({len(entries)} imágenes, ~${total:.2f})")


if __name__ == "__main__":
    main()
