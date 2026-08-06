"""images.py — data URIs y rasterizado compartidos por los benches.

Unifica las siete copias del helper "PIL → resize a lado largo → base64"
que había repartidas por los labs. Los tamaños por defecto reproducen los
call sites originales; los labs que usaban otro lado largo lo pasan explícito.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

#: Fondo de la captura del cliente (DEFAULT_TERRAIN_COLOR de canvas-renderer.ts).
CAPTURE_BG = "#1d2a18"
#: Escala del blueprint.png que envía el juego.
PX_PER_UNIT = 4


def _open(src: Image.Image | Path) -> Image.Image:
    return src if isinstance(src, Image.Image) else Image.open(src)


def _fit(img: Image.Image, long_side: int) -> Image.Image:
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    return img


def png_data_uri(src: Image.Image | Path, long_side: int = 768) -> str:
    """PNG RGB con lado largo `long_side` (contrato del juego para esquemas)."""
    img = _fit(_open(src).convert("RGB"), long_side)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def png_rgba_data_uri(src: Image.Image | Path, long_side: int = 1024) -> str:
    img = _fit(_open(src), long_side)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def jpeg_data_uri(src: Image.Image | Path, long_side: int = 1024) -> str:
    img = _fit(_open(src).convert("RGB"), long_side)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def png_file_data_uri(path: Path) -> str:
    """PNG tal cual, sin reescalar ni recomprimir (sprites frame a frame)."""
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def raster_svg(svg_path: Path, out_png: Path, view_box: dict, background: str | None = CAPTURE_BG) -> None:
    import cairosvg

    w = round(view_box["width"] * PX_PER_UNIT)
    h = round(view_box["height"] * PX_PER_UNIT)
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_png),
        output_width=w,
        output_height=h,
        background_color=background,
    )
