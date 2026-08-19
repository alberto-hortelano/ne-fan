"""sheet.py — helpers de sprite sheet compartidos por run.py y lab_server.py.

Antes cada uno llevaba su copia (keyframe_indices, atlas, gif, data URIs);
este módulo es la única implementación. El atlas V4 (≤10 frames) es el
formato ganador del bench — ver README.
"""

from __future__ import annotations

import base64
import io
import math
import sys
from pathlib import Path

from PIL import Image

LAB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAB_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT))
from labs.common.images import png_file_data_uri as png_to_data_uri  # noqa: E402,F401


def image_to_data_uri(img: Image.Image) -> str:
    """PNG de una imagen PIL SIN reescalar (los atlas superan los 1024 px y
    deben viajar a resolución completa)."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def keyframe_indices(src_count: int, n: int) -> list[int]:
    """N frames evenly distributed across the WHOLE cycle.
    src_count=13, n=4 → [0, 3, 6, 10]."""
    if n <= 0 or src_count <= 0:
        return []
    out: list[int] = []
    for i in range(n):
        idx = int(round(i * src_count / n))
        if idx >= src_count:
            idx = src_count - 1
        if not out or idx != out[-1]:
            out.append(idx)
    return out


def atlas_layout(n: int) -> tuple[int, int]:
    cols = int(math.ceil(math.sqrt(n)))
    rows = int(math.ceil(n / cols))
    if cols < rows:
        cols, rows = rows, cols
    return cols, rows


def compose_atlas(
    frame_paths: list[Path], frame_size: tuple[int, int] | None = None
) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    if frame_size is None:
        frame_size = Image.open(frame_paths[0]).size
    fw, fh = frame_size
    cols, rows = atlas_layout(len(frame_paths))
    atlas = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, p in enumerate(frame_paths):
        r, c = divmod(i, cols)
        atlas.paste(Image.open(p).convert("RGBA"), (c * fw, r * fh))
    return atlas, (cols, rows), (fw, fh)


def compose_grid_atlas(
    rows_of_paths: list[list[Path]], frame_size: tuple[int, int] | None = None
) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    """Grid SEMÁNTICO explícito: cada fila es una secuencia (p. ej. los
    keyframes de una dirección) y las filas comparten longitud. A diferencia
    de `atlas_layout` (cuadrado apaisado), aquí cols/rows los decide el
    caller — es el formato del bench V5 packed (multi-dirección)."""
    if not rows_of_paths or not rows_of_paths[0]:
        raise ValueError("compose_grid_atlas: grid vacío")
    cols = len(rows_of_paths[0])
    if any(len(row) != cols for row in rows_of_paths):
        raise ValueError("compose_grid_atlas: todas las filas deben tener la misma longitud")
    rows = len(rows_of_paths)
    if frame_size is None:
        frame_size = Image.open(rows_of_paths[0][0]).size
    fw, fh = frame_size
    atlas = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for r, row in enumerate(rows_of_paths):
        for c, p in enumerate(row):
            atlas.paste(Image.open(p).convert("RGBA"), (c * fw, r * fh))
    return atlas, (cols, rows), (fw, fh)


def split_atlas(atlas: Image.Image, layout: tuple[int, int], n: int,
                frame_size: tuple[int, int]) -> list[Image.Image]:
    cols, rows = layout
    fw, fh = frame_size
    expected = (cols * fw, rows * fh)
    if atlas.size != expected:
        atlas = atlas.resize(expected, Image.LANCZOS)
    return [atlas.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
            for i in range(n) for r, c in [divmod(i, cols)]]


def fit_atlas_output(atlas: Image.Image, expected: tuple[int, int]) -> Image.Image:
    """Encaja el atlas devuelto por el modelo en el tamaño esperado SIN
    deformar. Los modelos de lienzo cuadrado (gpt-image-2 devuelve 1024²)
    letterboxean los grids apaisados: si la relación de aspecto no coincide,
    se recorta el bbox del contenido (píxeles distintos del fondo de las
    esquinas — recorte determinista local, no segmentación IA), se expande a
    la relación esperada y se reescala. Con aspecto coincidente, reescala
    directa (comportamiento clásico de split_atlas)."""
    ew, eh = expected
    aw, ah = atlas.size
    if abs((aw / ah) - (ew / eh)) < 0.05:
        return atlas.resize(expected, Image.LANCZOS) if atlas.size != expected else atlas
    rgb = atlas.convert("RGB")
    px = rgb.load()
    corners = [px[0, 0], px[aw - 1, 0], px[0, ah - 1], px[aw - 1, ah - 1]]
    bg = tuple(sorted(c[i] for c in corners)[len(corners) // 2] for i in range(3))
    from PIL import ImageChops
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).convert("L")
    bbox = diff.point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox is None:
        return atlas.resize(expected, Image.LANCZOS)
    # Expandir el bbox del contenido a la relación esperada, centrado y
    # clampado al lienzo.
    bx0, by0, bx1, by1 = bbox
    bw, bh = bx1 - bx0, by1 - by0
    target_ratio = ew / eh
    if bw / bh < target_ratio:
        need = bh * target_ratio
        cx = (bx0 + bx1) / 2
        bx0, bx1 = cx - need / 2, cx + need / 2
    else:
        need = bw / target_ratio
        cy = (by0 + by1) / 2
        by0, by1 = cy - need / 2, cy + need / 2
    bx0, by0 = max(0, int(round(bx0))), max(0, int(round(by0)))
    bx1, by1 = min(aw, int(round(bx1))), min(ah, int(round(by1)))
    return atlas.crop((bx0, by0, bx1, by1)).resize(expected, Image.LANCZOS)


def write_gif(frames: list[Image.Image], out_path: Path, fps: float) -> None:
    if not frames:
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration_ms = max(1, int(round(1000 / max(fps, 0.1))))
    rgba = [f.convert("RGBA") for f in frames]
    rgba[0].save(out_path, save_all=True, append_images=rgba[1:],
                 duration=duration_ms, loop=0, disposal=2)
