"""gen_ground.py — E3: el SUELO del tile repintado aparte (sin volúmenes).

Repinta el raster de ground_only (bioma + detalle + map_ground, sin ningún
volumen) con un modelo barato. Al no haber volúmenes no hay nada que el
modelo pueda mover: la fidelidad del suelo es no-crítica (colisión de agua
aparte, que aquí no cambia porque el curso del agua se conserva a nivel de
mancha grande).

Uso: python3 render_lab/exp3_sprites/gen_ground.py --tile medieval
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"

STYLE_TOKENS = {
    "medieval": "gritty realistic medieval illustration, painterly, weathered dust and stone",
    "scifi": "used-future sci-fi colony, concrete and steel, ochre haze, painterly",
}

PROMPT = (
    "This is the GROUND PLANE of a top-down RPG game map: terrain, roads and "
    "floor surfaces only — there are NO buildings, NO walls, NO trees and NO "
    "objects, and you must NOT add any. Repaint it fully in a painterly, richly "
    "textured style: {token}. Keep every road and surface patch in the SAME "
    "position, course and width. The dark flat green area outside the map "
    "stays plain dark and empty. No border, no text, no characters."
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", default="medieval")
    args = ap.parse_args()
    tile = args.tile
    client = common.fal_client()

    src = Image.open(common.FIXTURES[tile] / "ground_only.png").convert("RGB")
    side = max(src.size)
    prestretched = src.resize((side, side), Image.LANCZOS)
    payload = {
        "prompt": PROMPT.format(token=STYLE_TOKENS[tile]),
        "num_images": 1,
        "image_size": "square_hd",
        "image_urls": [common.png_data_uri(prestretched, long_side=768)],
    }
    out = common.fal_call("fal-ai/bytedance/seedream/v4/edit", payload, 0.03, client, tag=f"ground_{tile}")
    png = common.download_image(out["images"][0], client)
    img = Image.open(io.BytesIO(png)).convert("RGB").resize(src.size, Image.LANCZOS)
    dest = RUN / "sprites" / tile / "ground_repainted.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest)
    print(f"  ✓ suelo repintado -> {dest}")
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
