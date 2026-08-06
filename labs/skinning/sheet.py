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


def split_atlas(atlas: Image.Image, layout: tuple[int, int], n: int,
                frame_size: tuple[int, int]) -> list[Image.Image]:
    cols, rows = layout
    fw, fh = frame_size
    expected = (cols * fw, rows * fh)
    if atlas.size != expected:
        atlas = atlas.resize(expected, Image.LANCZOS)
    return [atlas.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
            for i in range(n) for r, c in [divmod(i, cols)]]


def write_gif(frames: list[Image.Image], out_path: Path, fps: float) -> None:
    if not frames:
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration_ms = max(1, int(round(1000 / max(fps, 0.1))))
    rgba = [f.convert("RGBA") for f in frames]
    rgba[0].save(out_path, save_all=True, append_images=rgba[1:],
                 duration=duration_ms, loop=0, disposal=2)
