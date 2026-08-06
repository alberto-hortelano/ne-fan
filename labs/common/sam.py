"""sam.py — segmentado SAM2 auto-segment con caché por sha de imagen.

Unifica las copias gemelas de labs/render y labs/style. El payload es el
EXACTO de FalSamClient.auto_segment (ai_server/fal_client.py) — cambiarlo
invalida las cachés de los benches. `cache_name` conserva el esquema de
fichero histórico de cada lab (render: "sam_{sha}.json"; style: "{sha}.json").
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import httpx
from PIL import Image

from .fal import FAL_BASE, add_spend, download_image
from .images import png_data_uri

SAM_MODEL = "fal-ai/sam2/auto-segment"
SAM_COST = 0.01  # aproximado por imagen


def segment_bboxes(
    image_path: Path,
    client: httpx.Client,
    cache_dir: Path,
    cache_name: str = "sam_{sha}.json",
    spend_file: Path | None = None,
) -> list[tuple[float, float, float, float]]:
    """Bboxes de las masks de SAM2 auto-segment, cacheadas por sha de la
    imagen para no re-pagar al re-puntuar."""
    import numpy as np

    raw = image_path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()[:16]
    cache = cache_dir / cache_name.format(sha=sha)
    if cache.exists():
        return [tuple(b) for b in json.loads(cache.read_text())["bboxes"]]

    img = Image.open(io.BytesIO(raw))
    payload = {
        "image_url": png_data_uri(img, long_side=1024),
        "points_per_side": 32,
        "pred_iou_thresh": 0.88,
        "stability_score_thresh": 0.95,
        "min_mask_region_area": 100,
        "sync_mode": True,
        "output_format": "png",
    }
    resp = client.post(f"{FAL_BASE}/{SAM_MODEL}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"SAM2 devolvió {resp.status_code}: {resp.text[:500]}")
    if spend_file is not None:
        add_spend(spend_file, SAM_COST, f"sam2 {image_path.name}")
    masks = resp.json().get("individual_masks") or []
    bboxes: list[tuple[float, float, float, float]] = []
    # Las masks vienen al tamaño que SAM procesó (lado largo 1024): reescalar
    # los bbox al tamaño real de la imagen puntuada.
    for m in masks:
        mask_png = download_image(m, client)
        arr = np.asarray(Image.open(io.BytesIO(mask_png)).convert("L"))
        ys, xs = np.nonzero(arr > 127)
        if len(xs) == 0:
            continue
        sx = img.width / arr.shape[1]
        sy = img.height / arr.shape[0]
        bboxes.append(
            (
                float(xs.min()) * sx,
                float(ys.min()) * sy,
                float(xs.max() - xs.min() + 1) * sx,
                float(ys.max() - ys.min() + 1) * sy,
            )
        )
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"image": image_path.name, "bboxes": bboxes}))
    print(f"  SAM2: {len(bboxes)} masks")
    return bboxes
