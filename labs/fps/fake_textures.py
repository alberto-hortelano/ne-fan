"""fake_textures.py — texturas de TEST locales ($0) para validar el plumbing
de UVs del viewer antes de pagar: damero en tonos de la celda + marca de
orientación (esquina roja = UV (0,1), banda clara = borde superior V=1).

    python3 labs/fps/fake_textures.py --scene interior [--variant C]
→ runs/fake_<escena>/{layout.json, textures/<key>.png}
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

LAB = Path(__file__).resolve().parent


def cell_texture(cell: dict, px: int = 256) -> Image.Image:
    r, g, b = (int(cell["baseColor"][i : i + 2], 16) for i in (1, 3, 5))
    light = (min(255, r + 30), min(255, g + 30), min(255, b + 30))
    dark = (max(0, r - 30), max(0, g - 30), max(0, b - 30))
    img = Image.new("RGB", (px, px))
    d = ImageDraw.Draw(img)
    n = 8
    for j in range(n):
        for i in range(n):
            d.rectangle([i * px // n, j * px // n, (i + 1) * px // n - 1, (j + 1) * px // n - 1],
                        fill=light if (i + j) % 2 == 0 else dark)
    d.rectangle([0, 0, px - 1, px // 24], fill=(240, 240, 200))  # banda superior (V=1)
    d.rectangle([0, 0, px // 12, px // 12], fill=(220, 40, 40))  # esquina roja (U=0,V=1)
    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="interior")
    ap.add_argument("--variant", default="C")
    args = ap.parse_args()

    run_dir = LAB / "runs" / f"fake_{args.scene}"
    run_dir.mkdir(parents=True, exist_ok=True)
    out = subprocess.run(
        ["node", str(LAB / "dump_layout.mjs"), args.scene, args.variant, "1024"],
        capture_output=True, text=True, check=True,
    )
    (run_dir / "layout.json").write_text(out.stdout)
    layout = json.loads(out.stdout)
    tex_dir = run_dir / "textures"
    tex_dir.mkdir(exist_ok=True)
    n = 0
    for page in layout["pages"]:
        for cell in page["cells"]:
            cell_texture(cell).save(tex_dir / f"{cell['key']}.png")
            n += 1
    print(f"{n} texturas fake → {tex_dir}")


if __name__ == "__main__":
    main()
