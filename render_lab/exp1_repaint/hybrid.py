"""hybrid.py — E5: img2img barato PARTIENDO del render three.js (E2a).

Hipótesis: un render con volumen e iluminación real (three.js) guía al modelo
de imagen mejor que el SVG plano — el modelo "solo" tiene que embellecer, no
interpretar alturas. Mismo prompt de repintado que E1, modelo barato.

Uso: python3 render_lab/exp1_repaint/hybrid.py --tiles medieval,scifi
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402
from exp1_repaint.repaint import STYLE_REFS, build_prompt, tile_has_water  # noqa: E402

RUN = LAB / "runs/001_alternativas"
MANIFEST = RUN / "manifest.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default="medieval,scifi")
    args = ap.parse_args()
    client = common.fal_client()
    entries: list[dict] = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []

    for tile in args.tiles.split(","):
        name = f"e5_hybrid_seedream__{tile}"
        src = RUN / "images" / f"e2a_three__{tile}.png"
        if not src.exists():
            print(f"  ✗ {name}: falta el render three ({src.name})")
            continue
        base = Image.open(src).convert("RGB")
        side = max(base.size)
        prestretched = base.resize((side, side), Image.LANCZOS)
        payload = {
            "prompt": build_prompt(tile, tile_has_water(tile)).replace(
                "schematic LAYOUT plan drawn with flat placeholder colours",
                "simple 3D render with flat placeholder textures",
            ),
            "num_images": 1,
            "image_size": "square_hd",
            "image_urls": [
                common.png_data_uri(prestretched, long_side=768),
                common.jpeg_data_uri(STYLE_REFS[tile]),
            ],
        }
        t0 = time.time()
        out = common.fal_call("fal-ai/bytedance/seedream/v4/edit", payload, 0.03, client, tag=name)
        elapsed = out.get("_elapsed_s", round(time.time() - t0, 1))
        png = common.download_image(out["images"][0], client)
        img = Image.open(io.BytesIO(png)).convert("RGB").resize(base.size, Image.LANCZOS)
        out_path = RUN / "images" / f"{name}.png"
        img.save(out_path)
        metrics = common.score_image_for(tile, out_path, RUN / "overlays" / f"{name}.png", client)
        b = metrics.get("buildings") or {}
        print(f"  ✓ {name} ({elapsed}s) edif:{b.get('pct_matched')}% inventadas:{metrics.get('n_unmatched_big_masks')}")
        entry = {"name": name, "tile": tile, "exp": "e5_hybrid", "model": "seedream4 (sobre render three.js)",
                 "cost_usd": 0.03, "elapsed_s": elapsed, "metrics": metrics,
                 "note": "E5 híbrido: three.js con luz/volumen como entrada del img2img barato"}
        entries = [e for e in entries if e.get("name") != name] + [entry]
        MANIFEST.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
