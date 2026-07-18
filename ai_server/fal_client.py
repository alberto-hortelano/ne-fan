"""fal.ai client for SAM image segmentation (auth: FAL_KEY in the environment).

  - `auto_segment` (SAM2, `fal-ai/sam2/auto-segment`): full automatic
    segmentation of the painted scene — one mask per detected region, no
    labels. The vision model classifies the regions afterwards (mundo
    derivado de la imagen).
  - `segment_boxes` (SAM2, `fal-ai/sam2/image`): silueta del objeto ENTERO
    contenido en cada caja. El auto-segment no produce máscaras de objetos
    grandes compuestos (un edificio sale como ventanas/paneles y su cuerpo NO
    aparece entre las máscaras — bench seg_bench sobre la escena real); el
    box prompt sí devuelve la silueta completa.

Docs: https://fal.ai/models/fal-ai/sam2/auto-segment
      https://fal.ai/models/fal-ai/sam2/image/api
"""

from __future__ import annotations

import base64
import os

import httpx


class FalSamClient:
    BASE_URL = "https://fal.run"

    def __init__(
        self,
        auto_segment_model: str = "fal-ai/sam2/auto-segment",
        box_segment_model: str = "fal-ai/sam2/image",
        api_key: str | None = None,
    ):
        self.auto_segment_model = auto_segment_model
        self.box_segment_model = box_segment_model
        self.api_key = api_key or os.environ.get("FAL_KEY", "")
        if not self.api_key:
            raise ValueError("FAL_KEY not set")
        self.headers = {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json",
        }

    def is_available(self) -> bool:
        return bool(self.api_key)

    def _post(self, model: str, payload: dict, timeout: float) -> dict:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(f"{self.BASE_URL}/{model}", headers=self.headers, json=payload)
            resp.raise_for_status()
            return resp.json()

    def _fetch_bytes(self, url: str, timeout: float) -> bytes:
        if url.startswith("data:"):
            _, _, b64 = url.partition(",")
            return base64.b64decode(b64)
        with httpx.Client(timeout=timeout) as client:
            r = client.get(url)
            r.raise_for_status()
            return r.content

    def auto_segment(
        self,
        image_data_uri: str,
        points_per_side: int = 32,
        pred_iou_thresh: float = 0.88,
        stability_score_thresh: float = 0.95,
        min_mask_region_area: int = 100,
        timeout: float = 180.0,
    ) -> list[bytes]:
        """Segmentación automática completa (SAM2 auto-segment): una máscara
        PNG por región detectada, sin etiquetas. Base del mundo derivado de
        imagen — las regiones se clasifican después por visión.

        Raises on any failure or if fal returns no individual masks
        (fail-loud: una escena pintada siempre tiene regiones)."""
        payload = {
            "image_url": image_data_uri,
            "points_per_side": int(points_per_side),
            "pred_iou_thresh": float(pred_iou_thresh),
            "stability_score_thresh": float(stability_score_thresh),
            "min_mask_region_area": int(min_mask_region_area),
            "sync_mode": True,
            "output_format": "png",
        }
        data = self._post(self.auto_segment_model, payload, timeout)
        masks = data.get("individual_masks")
        if not isinstance(masks, list) or not masks:
            raise RuntimeError(f"fal SAM2 auto-segment returned no individual_masks: {data}")
        out: list[bytes] = []
        for i, m in enumerate(masks):
            if not isinstance(m, dict) or not m.get("url"):
                raise RuntimeError(f"fal SAM2 auto-segment mask {i} missing url: {m}")
            out.append(self._fetch_bytes(m["url"], timeout))
        return out

    def segment_boxes(
        self,
        image_data_uri: str,
        boxes_xyxy: list[tuple[int, int, int, int]],
        timeout: float = 60.0,
        max_workers: int = 4,
    ) -> list[bytes]:
        """Silueta del objeto de cada caja (SAM2 `image` con box prompt; el
        endpoint combina varias cajas en UNA máscara, así que se hace una
        llamada por caja, en paralelo). Devuelve las máscaras PNG en el orden
        de las cajas. Fail-loud: cualquier fallo de fal lanza (el caller
        decide si degrada)."""
        from concurrent.futures import ThreadPoolExecutor

        def one(box: tuple[int, int, int, int]) -> bytes:
            x0, y0, x1, y1 = box
            payload = {
                "image_url": image_data_uri,
                "box_prompts": [{
                    "x_min": int(x0), "y_min": int(y0),
                    "x_max": int(x1), "y_max": int(y1),
                }],
                "sync_mode": True,
                "output_format": "png",
            }
            data = self._post(self.box_segment_model, payload, timeout)
            image = data.get("image")
            url = image.get("url") if isinstance(image, dict) else None
            if not url:
                raise RuntimeError(f"fal SAM2 box segment returned no image: {data}")
            return self._fetch_bytes(url, timeout)

        if not boxes_xyxy:
            return []
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            return list(ex.map(one, boxes_xyxy))
