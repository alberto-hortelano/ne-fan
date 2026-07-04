"""Scene segmenter — cut occluder sprites out of the AI-painted scene image.

For each known occluder (building/prop) we already have its approximate pixel
box from the schematic. We ask SAM (via fal.ai) to segment the object inside
that box, derive a binary mask from fal's output, and cut the sprite from the
ORIGINAL scene pixels (not fal's possibly-recoloured output) so the cutout
matches the background exactly — the client can then re-draw it on top of the
player for occlusion with no visible seam.

No local GPU: segmentation runs on fal. Boxes are BATCHED — SAM2 accepts many
box prompts per call and masks each as an independent object (verified: 40
boxes → 40 objects, ~1 s), so a 96-occluder scene costs 2 calls instead of 96.
The combined mask is split back per occluder by intersecting with its box.

Fail-loud: a fal/infrastructure error raises. An occluder whose mask comes back
empty (SAM found nothing in the box) is a logged skip (expected degradation),
not a silent [].
"""

from __future__ import annotations

import io
import time

import numpy as np
from PIL import Image

from fal_client import FalSamClient

# Cajas por llamada a fal. Verificado con 40 en ~1 s; 64 deja una escena de 96
# occluders en 2 llamadas manteniendo margen frente a límites no documentados.
MAX_BOXES_PER_CALL = 64


def _to_data_uri(png_bytes: bytes) -> str:
    import base64
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode()


def _iou(a: tuple, b: tuple) -> float:
    """IoU of two x0,y0,x1,y1 boxes."""
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _center_in(box: tuple, container: tuple) -> bool:
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    return container[0] <= cx <= container[2] and container[1] <= cy <= container[3]


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


class SceneSegmenter:
    def __init__(self, fal_client: FalSamClient):
        self._fal = fal_client
        print(
            f"SceneSegmenter: fal segment='{fal_client.segment_model}' "
            f"discover='{fal_client.discover_model}'",
            flush=True,
        )

    def segment_occluders(
        self,
        scene_png_bytes: bytes,
        occluders: list[dict],
    ) -> list[dict]:
        """occluders: [{id, box_px: [x_min, y_min, x_max, y_max]}].

        Returns [{id, sprite_png_bytes, image_bbox: [x, y, w, h], img_w, img_h}]
        for every occluder whose mask was non-empty."""
        scene = Image.open(io.BytesIO(scene_png_bytes)).convert("RGB")
        w, h = scene.size
        scene_rgb = np.asarray(scene)  # HxWx3
        data_uri = _to_data_uri(scene_png_bytes)

        # Validar y clampear todas las cajas antes de gastar ninguna llamada.
        clamped: list[tuple[str, tuple[int, int, int, int]]] = []
        for occ in occluders:
            oid = str(occ.get("id", "?"))
            box = occ.get("box_px")
            if not (isinstance(box, (list, tuple)) and len(box) == 4):
                raise ValueError(f"occluder {oid!r}: box_px must be [x_min,y_min,x_max,y_max], got {box!r}")
            x_min = max(0, min(w - 1, int(box[0])))
            y_min = max(0, min(h - 1, int(box[1])))
            x_max = max(x_min + 1, min(w, int(box[2])))
            y_max = max(y_min + 1, min(h, int(box[3])))
            clamped.append((oid, (x_min, y_min, x_max, y_max)))

        # La máscara combinada se reparte intersectando con la caja de cada
        # occluder (+margen: SAM puede pintar unos px fuera del prompt). Dos
        # cajas que se solapen comparten esos píxeles en ambos recortes —
        # inocuo, el sprite sigue siendo el trozo correcto de la imagen.
        margin = 4
        out: list[dict] = []
        for i in range(0, len(clamped), MAX_BOXES_PER_CALL):
            chunk = clamped[i:i + MAX_BOXES_PER_CALL]
            start = time.perf_counter()
            result_png = self._fal.segment_boxes(data_uri, [b for _, b in chunk])
            mask = _mask_from_fal(result_png, w, h)
            dt = time.perf_counter() - start
            print(f"SceneSegmenter: batch {len(chunk)} boxes ({dt:.2f}s)", flush=True)

            for oid, (x_min, y_min, x_max, y_max) in chunk:
                rx0 = max(0, x_min - margin)
                ry0 = max(0, y_min - margin)
                rx1 = min(w, x_max + margin)
                ry1 = min(h, y_max + margin)
                region = mask[ry0:ry1, rx0:rx1]
                ys, xs = np.where(region)
                if ys.size == 0:
                    print(f"SceneSegmenter[{oid}]: empty mask in box {[x_min, y_min, x_max, y_max]} — skipping", flush=True)
                    continue

                bx0, bx1 = rx0 + int(xs.min()), rx0 + int(xs.max()) + 1
                by0, by1 = ry0 + int(ys.min()), ry0 + int(ys.max()) + 1
                crop_rgb = scene_rgb[by0:by1, bx0:bx1]
                crop_mask = region[by0 - ry0:by1 - ry0, bx0 - rx0:bx1 - rx0]
                rgba = np.dstack([crop_rgb, (crop_mask * 255).astype(np.uint8)])
                buf = io.BytesIO()
                Image.fromarray(rgba, "RGBA").save(buf, "PNG")

                bbox = [bx0, by0, bx1 - bx0, by1 - by0]
                print(f"SceneSegmenter[{oid}]: bbox {bbox}", flush=True)
                out.append({
                    "id": oid,
                    "sprite_png_bytes": buf.getvalue(),
                    "image_bbox": bbox,
                    "img_w": w,
                    "img_h": h,
                })
        return out

    def discover_objects(
        self,
        scene_png_bytes: bytes,
        known_boxes: list[list[int]],
        concepts: list[str],
        score_threshold: float = 0.4,
        min_area_frac: float = 0.0006,
        max_area_frac: float = 0.12,
        min_fill: float = 0.30,
    ) -> list[dict]:
        """Open-vocabulary discovery (Phase 3) of props the image model invented.

        For each `concept` SAM3 returns every instance; we keep the ones that look
        like a real solid prop and were NOT already a known object:
          - score >= threshold,
          - area within [min_area_frac, max_area_frac] of the image (not tiny, not
            the whole ground),
          - not spanning a near-full axis (ground/foliage backdrop),
          - mask fills >= min_fill of its bbox (solid, not scattered foliage),
          - not overlapping a known footprint (IoU>0.25 or centre inside),
          - not a duplicate of one already accepted (IoU>0.5).
        `known_boxes` are [x_min,y_min,x_max,y_max] px. Returns the same shape as
        segment_occluders plus `score`/`concept`, sprites cut from the original."""
        scene = Image.open(io.BytesIO(scene_png_bytes)).convert("RGB")
        w, h = scene.size
        scene_rgb = np.asarray(scene)
        data_uri = _to_data_uri(scene_png_bytes)
        known = [tuple(b) for b in known_boxes]

        results: list[dict] = []
        accepted_xyxy: list[tuple] = []
        for concept in concepts:
            start = time.perf_counter()
            instances = self._fal.discover(data_uri, concept)
            kept = 0
            for inst in instances:
                score = inst.get("score")
                if score is not None and score < score_threshold:
                    continue
                mask = _mask_from_fal(inst["mask_png_bytes"], w, h)
                ys, xs = np.where(mask)
                if ys.size == 0:
                    continue
                bx0, bx1 = int(xs.min()), int(xs.max()) + 1
                by0, by1 = int(ys.min()), int(ys.max()) + 1
                bw, bh = bx1 - bx0, by1 - by0
                area_frac = (bw * bh) / (w * h)
                if not (min_area_frac <= area_frac <= max_area_frac):
                    continue
                if bw >= 0.9 * w or bh >= 0.9 * h:
                    continue
                if float(mask[by0:by1, bx0:bx1].mean()) < min_fill:
                    continue
                box_xyxy = (bx0, by0, bx1, by1)
                if any(_iou(box_xyxy, k) > 0.25 or _center_in(box_xyxy, k) for k in known):
                    continue
                if any(_iou(box_xyxy, a) > 0.5 for a in accepted_xyxy):
                    continue

                crop_rgb = scene_rgb[by0:by1, bx0:bx1]
                crop_mask = mask[by0:by1, bx0:bx1]
                rgba = np.dstack([crop_rgb, (crop_mask * 255).astype(np.uint8)])
                buf = io.BytesIO()
                Image.fromarray(rgba, "RGBA").save(buf, "PNG")
                accepted_xyxy.append(box_xyxy)
                results.append({
                    "id": f"found_{concept.replace(' ', '_')}_{len(results)}",
                    "sprite_png_bytes": buf.getvalue(),
                    "image_bbox": [bx0, by0, bw, bh],
                    "img_w": w,
                    "img_h": h,
                    "score": score,
                    "concept": concept,
                })
                kept += 1
            dt = time.perf_counter() - start
            print(
                f"SceneSegmenter.discover['{concept}']: {len(instances)} inst -> "
                f"{kept} kept ({dt:.2f}s)",
                flush=True,
            )
        print(f"SceneSegmenter.discover: {len(results)} new objects total", flush=True)
        return results
