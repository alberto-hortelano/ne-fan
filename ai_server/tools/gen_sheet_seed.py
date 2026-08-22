#!/usr/bin/env python3
"""Genera la plantilla de rejilla de la lámina de materiales (surfaces/).

DETERMINISTA (semilla fija): 1024×1024, rejilla 3×4 de celdas grises con
ruido sutil sobre gutter gris neutro — el mismo lenguaje visual que la base
clay del atlas de superficies in-game (surface_atlas_generator.draw_base),
para que el modelo de imagen reciba el encuadre que ya sabe repintar.

Salida: nefan-core/data/styles/_plantilla/surfaces/default.png
"""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image

PAGE_PX = 1024
GUTTER_PX = 24
ROWS = 3
COLS = 4
BG = (128, 128, 128)
CELL_BASES = [110, 126, 142, 118, 134, 150, 114, 130, 146, 122, 138, 154]

OUT = (
    Path(__file__).resolve().parents[2]
    / "nefan-core" / "data" / "styles" / "_plantilla" / "surfaces" / "default.png"
)


def main() -> None:
    rng = random.Random(20260815)
    img = Image.new("RGB", (PAGE_PX, PAGE_PX), BG)
    px = img.load()
    cell_w = (PAGE_PX - GUTTER_PX * (COLS + 1)) // COLS
    cell_h = (PAGE_PX - GUTTER_PX * (ROWS + 1)) // ROWS
    for r in range(ROWS):
        for c in range(COLS):
            base = CELL_BASES[r * COLS + c]
            x0 = GUTTER_PX + c * (cell_w + GUTTER_PX)
            y0 = GUTTER_PX + r * (cell_h + GUTTER_PX)
            for y in range(y0, y0 + cell_h):
                for x in range(x0, x0 + cell_w):
                    n = rng.randint(-6, 6)
                    v = max(0, min(255, base + n))
                    px[x, y] = (v, v, v)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(f"gen_sheet_seed: escrito {OUT} ({ROWS}x{COLS} celdas)")


if __name__ == "__main__":
    main()
