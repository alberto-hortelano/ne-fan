"""image_review — proceso de los objetos EXTRA del tile repintado.

La visión (motor narrativo, kind MCP `image_review`) señala con cajas
IMPRECISAS los objetos que el modelo de imagen inventó; SAM2 con box prompt
recorta su silueta exacta y de ella se deriva la línea de contacto con el
suelo (contorno inferior suavizado) — la base de colisión que el cliente
extruye `depth_cells` hacia el norte, siguiendo la inclinación pintada
(validado en render_lab, run 001).
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image


def mask_from_png(mask_png: bytes, size_wh: tuple[int, int]) -> np.ndarray:
    """Máscara PNG de SAM → bool array al tamaño de la escena."""
    img = Image.open(io.BytesIO(mask_png)).convert("L")
    if img.size != size_wh:
        img = img.resize(size_wh, Image.NEAREST)
    return np.asarray(img) > 127


def bottom_contour(mask: np.ndarray, step: int = 2, window: int = 4) -> list[list[int]]:
    """Contorno INFERIOR de la silueta: para cada columna con píxeles, el y
    máximo, suavizado con mediana (ventana ±`window`). Puntos [x, y] cada
    `step` columnas — la línea de contacto con el suelo tal como está pintada
    (en la oblicua esos píxeles están a h=0: imagen == mundo)."""
    h, w = mask.shape
    cols = np.where(mask.any(axis=0))[0]
    if len(cols) == 0:
        return []
    bottom = np.full(w, -1.0)
    for x in cols:
        bottom[x] = np.nonzero(mask[:, x])[0].max()
    points: list[list[int]] = []
    for x in cols[::step]:
        lo, hi = max(0, x - window), min(w, x + window + 1)
        vals = bottom[lo:hi]
        vals = vals[vals >= 0]
        points.append([int(x), int(np.median(vals))])
    return points


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)
