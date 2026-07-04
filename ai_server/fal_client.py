"""fal.ai client for SAM image segmentation (SAM2 box-prompt + SAM3 open-vocab).

Two jobs, both on fal, same auth (FAL_KEY in the environment):

  - `segment_boxes` (SAM2, `fal-ai/sam2/image`): cut KNOWN objects out of the
    scene by feeding their approximate pixel boxes as box prompts. The endpoint
    accepts MANY boxes per call and returns one combined masked image (verified
    empirically: 40 boxes → 40 independent objects, ~1 s, nothing outside the
    boxes); the caller splits the combined mask back per box.
  - `discover` (SAM3, `fal-ai/sam-3/image`): open-vocabulary detection — given a
    text concept ("statue", "barrel", …) returns every matching INSTANCE with its
    own mask + score, so we can find props the image model invented that were not
    in the schematic (Phase 3).

Docs: https://fal.ai/models/fal-ai/sam2/image , https://fal.ai/models/fal-ai/sam-3/image
"""

from __future__ import annotations

import base64
import os

import httpx


class FalSamClient:
    BASE_URL = "https://fal.run"

    def __init__(
        self,
        segment_model: str = "fal-ai/sam2/image",
        discover_model: str = "fal-ai/sam-3/image",
        api_key: str | None = None,
    ):
        self.segment_model = segment_model
        self.discover_model = discover_model
        self.api_key = api_key or os.environ.get("FAL_KEY", "")
        if not self.api_key:
            raise ValueError("FAL_KEY not set")
        self.headers = {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json",
        }

    # Back-compat alias used elsewhere for logging.
    @property
    def model(self) -> str:
        return self.segment_model

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

    def segment_boxes(
        self,
        image_data_uri: str,
        boxes: list[tuple[int, int, int, int]],
        timeout: float = 120.0,
    ) -> bytes:
        """Segment the objects inside `boxes` ([(x_min, y_min, x_max, y_max)] px)
        in ONE call. Each box is an independent object prompt; the result is a
        single image with ALL their masks applied — split it per box afterwards.

        Returns the PNG bytes of fal's segmented `image` output. Raises on any
        failure (fail-loud — never returns an empty/black mask silently)."""
        if not boxes:
            raise ValueError("segment_boxes: boxes must be non-empty")
        payload = {
            "image_url": image_data_uri,
            "box_prompts": [
                {"x_min": int(b[0]), "y_min": int(b[1]),
                 "x_max": int(b[2]), "y_max": int(b[3])}
                for b in boxes
            ],
            "apply_mask": True,
            "sync_mode": True,
            "output_format": "png",
        }
        data = self._post(self.segment_model, payload, timeout)
        image = data.get("image")
        if not isinstance(image, dict) or not image.get("url"):
            raise RuntimeError(f"fal SAM2 response missing image url: {data}")
        return self._fetch_bytes(image["url"], timeout)

    def discover(
        self,
        image_data_uri: str,
        concept: str,
        max_masks: int = 6,
        timeout: float = 90.0,
    ) -> list[dict]:
        """Open-vocabulary detect every instance of `concept` (SAM3).

        Returns [{mask_png_bytes, score}] — one entry per detected instance.
        `apply_mask=False` so each `masks[i]` is the instance mask itself."""
        payload = {
            "image_url": image_data_uri,
            "prompt": concept,
            "apply_mask": False,
            "return_multiple_masks": True,
            "max_masks": int(max_masks),
            "include_scores": True,
            "sync_mode": True,
            "output_format": "png",
        }
        data = self._post(self.discover_model, payload, timeout)
        masks = data.get("masks") or []
        scores = data.get("scores") or []
        out: list[dict] = []
        for i, m in enumerate(masks):
            if not isinstance(m, dict) or not m.get("url"):
                continue
            score = float(scores[i]) if i < len(scores) and scores[i] is not None else None
            out.append({
                "mask_png_bytes": self._fetch_bytes(m["url"], timeout),
                "score": score,
            })
        return out
