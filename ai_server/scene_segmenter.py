"""Scene segmenter — el mundo jugable se deriva de la imagen IA de escena.

`analyze_regions` segmenta TODA la imagen (SAM2 auto-segment vía fal.ai),
filtra las regiones candidatas y produce un overlay numerado; el modelo de
visión clasifica después cada región (solid/tall) y `crop_sprite` recorta los
sprites de los píxeles ORIGINALES de la escena (no la salida posiblemente
recoloreada de fal) para que el recorte case con el fondo sin costura.

No local GPU: la segmentación corre en fal (1 llamada por escena).

Fail-loud: un error de fal/infraestructura lanza. Una máscara vacía es un
skip logueado (degradación esperable), no un [] silencioso.
"""

from __future__ import annotations

import io
import time

import numpy as np
from PIL import Image

from fal_client import FalSamClient


def _to_data_uri(png_bytes: bytes) -> str:
    import base64
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


def _mask_from_fal(result_png: bytes, w: int, h: int) -> np.ndarray:
    """Derive a boolean HxW mask from fal's segmented output.

    Prefers the alpha channel (apply_mask cutout); falls back to luminance
    (non-black) if the result has no usable transparency (e.g. a binary mask)."""
    r = Image.open(io.BytesIO(result_png)).convert("RGBA")
    if r.size != (w, h):
        r = r.resize((w, h), Image.NEAREST)
    arr = np.asarray(r)  # HxWx4
    alpha = arr[:, :, 3]
    if int(alpha.min()) < 250 and int(alpha.max()) > 5:
        return alpha >= 128
    # No usable alpha → treat the result as a mask by luminance (object on black).
    lum = arr[:, :, :3].max(axis=2)
    return lum >= 32


# Filtros de regiones candidatas del auto-segment (mundo derivado de imagen).
# Fracción de área de imagen: por debajo es ruido, por encima es el suelo/fondo.
MIN_REGION_AREA_FRAC = 0.0005
MAX_REGION_AREA_FRAC = 0.35
# Máximo de regiones que se mandan a clasificar (las mayores primero): acota
# el tamaño de la respuesta de visión.
MAX_REGIONS = 48


def scene_rgb_from_png(png_bytes: bytes) -> np.ndarray:
    """Píxeles RGB HxWx3 de una imagen de escena (para crop_sprite)."""
    return np.asarray(Image.open(io.BytesIO(png_bytes)).convert("RGB"))


def crop_sprite(scene_rgb: np.ndarray, mask: np.ndarray, bbox_xyxy: tuple) -> dict:
    """Recorta el sprite RGBA de una región: píxeles ORIGINALES de la escena
    con la máscara como alpha, para que el recorte case con el fondo."""
    bx0, by0, bx1, by1 = bbox_xyxy
    crop_rgb = scene_rgb[by0:by1, bx0:bx1]
    crop_mask = mask[by0:by1, bx0:bx1]
    rgba = np.dstack([crop_rgb, (crop_mask * 255).astype(np.uint8)])
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG")
    return {
        "sprite_png_bytes": buf.getvalue(),
        "image_bbox": [int(bx0), int(by0), int(bx1 - bx0), int(by1 - by0)],
        "img_w": int(scene_rgb.shape[1]),
        "img_h": int(scene_rgb.shape[0]),
    }


class SceneSegmenter:
    def __init__(self, fal_client: FalSamClient):
        self._fal = fal_client
        print(
            f"SceneSegmenter: fal auto-segment='{fal_client.auto_segment_model}'",
            flush=True,
        )

    def analyze_regions(self, scene_png_bytes: bytes) -> dict:
        """Fase 1 del mundo derivado de imagen: segmenta TODA la escena
        (SAM2 auto-segment), filtra las regiones candidatas y produce el
        overlay numerado que verá el modelo de visión.

        Devuelve {"regions": [{index, mask (bool HxW), bbox_xyxy}],
        "overlay_png": bytes}. Fail-loud si fal falla; sin regiones tras el
        filtro devuelve regions=[] (escena sin elementos, improbable)."""
        from PIL import ImageDraw, ImageFont

        scene = Image.open(io.BytesIO(scene_png_bytes)).convert("RGB")
        w, h = scene.size
        data_uri = _to_data_uri(scene_png_bytes)

        start = time.perf_counter()
        mask_pngs = self._fal.auto_segment(data_uri)
        dt = time.perf_counter() - start
        print(f"SceneSegmenter.analyze: {len(mask_pngs)} masks ({dt:.2f}s)", flush=True)

        candidates: list[dict] = []
        for png in mask_pngs:
            mask = _mask_from_fal(png, w, h)
            ys, xs = np.where(mask)
            if ys.size == 0:
                continue
            bx0, bx1 = int(xs.min()), int(xs.max()) + 1
            by0, by1 = int(ys.min()), int(ys.max()) + 1
            area_frac = float(mask.sum()) / (w * h)
            if not (MIN_REGION_AREA_FRAC <= area_frac <= MAX_REGION_AREA_FRAC):
                continue
            candidates.append({
                "mask": mask,
                "bbox_xyxy": (bx0, by0, bx1, by1),
                "area": float(mask.sum()),
            })
        candidates.sort(key=lambda c: -c["area"])
        dropped = max(0, len(candidates) - MAX_REGIONS)
        candidates = candidates[:MAX_REGIONS]
        if dropped:
            print(f"SceneSegmenter.analyze: {dropped} regiones descartadas por cap {MAX_REGIONS}", flush=True)

        # Overlay numerado: contorno del bbox + índice en el centroide, sobre
        # una copia atenuada para que los números resalten.
        overlay = scene.copy()
        draw = ImageDraw.Draw(overlay)
        try:
            font = ImageFont.load_default(size=max(18, w // 45))
        except TypeError:  # PIL < 10 sin size
            font = ImageFont.load_default()
        regions: list[dict] = []
        for i, c in enumerate(candidates):
            bx0, by0, bx1, by1 = c["bbox_xyxy"]
            draw.rectangle([bx0, by0, bx1 - 1, by1 - 1], outline=(255, 40, 40), width=3)
            ys, xs = np.where(c["mask"])
            cx, cy = float(xs.mean()), float(ys.mean())
            text = str(i)
            tb = draw.textbbox((0, 0), text, font=font)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            draw.rectangle([cx - tw / 2 - 4, cy - th / 2 - 4, cx + tw / 2 + 4, cy + th / 2 + 4],
                           fill=(0, 0, 0))
            draw.text((cx - tw / 2, cy - th / 2 - tb[1]), text, fill=(255, 255, 80), font=font)
            regions.append({"index": i, "mask": c["mask"], "bbox_xyxy": c["bbox_xyxy"]})

        buf = io.BytesIO()
        overlay.save(buf, "PNG")
        return {"regions": regions, "overlay_png": buf.getvalue()}
