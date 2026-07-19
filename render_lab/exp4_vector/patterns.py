"""patterns.py — E4: el blueprint del compositor texturizado con IA local.

Sin repintado img2img: clasifica cada píxel del raster del blueprint en una
clase de material por reglas HSV (el arte del compositor es plano, de paleta
corta) y aplica la textura seamless correspondiente MODULADA por la luminancia
local — así se conservan la cara sur iluminada / este en sombra, las manchas
del suelo y los strokes de los caminos. Fidelidad de layout 1.0 por
construcción (no se mueve un píxel); colisión y oclusión siguen siendo las
nativas del plan.

Uso:
    python3 render_lab/exp4_vector/patterns.py [--tiles medieval,scifi]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
TEX_DIR = RUN / "textures"
#: Período del tileado en px de imagen (4 px = 1 celda = 2 m → 96 px ≈ 48 m).
TILE_PERIOD = {"default": 96, "roof": 64, "foliage": 72}

#: clase → textura, por tile.
CLASS_TEX = {
    "medieval": {
        "water": "water",
        "foliage": "foliage",
        "roof": "roof_tiles",
        "stone": "cobblestone",
        "wood": "wood_planks",
        "dirt": "dirt",
    },
    "scifi": {
        "water": "water",
        "foliage": "foliage",
        "roof": "metal_plate",
        "stone": "concrete",
        "wood": "wood_planks",
        "dirt": "dirt",
    },
}

VOID_RGB = np.array([29, 42, 24], dtype=np.float32)  # CAPTURE_BG #1d2a18


def classify(rgb: np.ndarray, hsv: np.ndarray) -> np.ndarray:
    """Devuelve un array de etiquetas de clase (uint8 index sobre CLASSES)."""
    h = hsv[..., 0].astype(np.int16)
    s = hsv[..., 1].astype(np.int16)
    labels = np.full(rgb.shape[:2], CLASSES.index("dirt"), dtype=np.uint8)
    void = np.linalg.norm(rgb.astype(np.float32) - VOID_RGB, axis=-1) < 30
    water = (h >= 120) & (h <= 185) & (s >= 70)
    foliage = (h >= 45) & (h <= 110) & (s >= 60)
    roof = ((h <= 13) | (h >= 235)) & (s >= 110)
    stone = s < 45
    wood = (h >= 10) & (h <= 32) & (s >= 120)
    labels[stone] = CLASSES.index("stone")
    labels[wood] = CLASSES.index("wood")
    labels[roof] = CLASSES.index("roof")
    labels[foliage] = CLASSES.index("foliage")
    labels[water] = CLASSES.index("water")
    labels[void] = CLASSES.index("void")
    return labels


CLASSES = ["void", "water", "foliage", "roof", "stone", "wood", "dirt"]


def tiled_texture(name: str, w: int, h: int, period: int) -> np.ndarray:
    tex = Image.open(TEX_DIR / f"{name}.png").convert("RGB").resize((period, period), Image.LANCZOS)
    arr = np.asarray(tex, dtype=np.float32)
    reps = (h // period + 2, w // period + 2, 1)
    return np.tile(arr, reps)[:h, :w, :]


def texturize(tile: str) -> Path:
    src = common.FIXTURES[tile] / "blueprint.png"
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img)
    hsv = np.asarray(img.convert("HSV"))
    labels = classify(rgb, hsv)

    lum = np.asarray(img.convert("L"), dtype=np.float32)
    out = rgb.astype(np.float32).copy()
    h, w = lum.shape
    for cls, tex_name in CLASS_TEX[tile].items():
        mask = labels == CLASSES.index(cls)
        n = int(mask.sum())
        if n == 0:
            continue
        period = TILE_PERIOD.get(cls, TILE_PERIOD["default"])
        tex = tiled_texture(tex_name, w, h, period)
        mean = float(lum[mask].mean())
        ratio = np.clip(lum / max(mean, 1.0), 0.35, 1.8)[..., None]
        out[mask] = np.clip(tex[mask] * np.repeat(ratio, 3, axis=2)[mask], 0, 255)
        pct = 100.0 * n / labels.size
        print(f"  {tile}: {cls} -> {tex_name} ({pct:.1f}% de píxeles)")

    dest = RUN / "images" / f"e4_patterns__{tile}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out.astype(np.uint8)).save(dest)
    print(f"  ✓ {dest}")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default="medieval,scifi")
    args = ap.parse_args()
    for tile in args.tiles.split(","):
        texturize(tile)


if __name__ == "__main__":
    main()
