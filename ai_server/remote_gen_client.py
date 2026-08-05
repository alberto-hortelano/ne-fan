"""Cliente HTTP del remote-gen (S5, :8768) — la segmentación de narrative-llm.

Desde F4 la ÚNICA llamada fal SAM2 del stack vive en el proceso remote-gen
(POST /segment); narrative-llm ya no necesita FAL_KEY. Este cliente expone la
MISMA superficie que tenía FalSamClient en los call sites (auto_segment /
segment_boxes → list[bytes] de PNG crudos de fal, mismo orden), así el
postproceso (_mask_from_fal, mask_from_png) y los canales DEV_API_CACHE que
lo envuelven no cambian ni un byte.

Fail-loud: remote-gen caído o respuesta no-200 lanza RuntimeError con el
detail — el caller decide (analyze/stage review lo suben como 502; el
refinado de siluetas degrada a la unión de partes con log).
"""
import base64
import logging
import os

import httpx

logger = logging.getLogger(__name__)

# El auto-segment de fal puede tardar (timeout interno 180 s) — margen encima.
_TIMEOUT_S = 240.0


class RemoteGenClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (
            base_url
            or os.environ.get("NEFAN_URL_REMOTE_GEN")
            or "http://127.0.0.1:8768"
        ).rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=_TIMEOUT_S)

    def _segment(self, payload: dict) -> list[dict]:
        try:
            r = self._client.post("/segment", json=payload)
        except httpx.HTTPError as err:
            raise RuntimeError(f"remote-gen no disponible ({self.base_url}): {err}") from err
        if r.status_code != 200:
            try:
                detail = r.json().get("detail", r.text)
            except ValueError:
                detail = r.text
            raise RuntimeError(f"remote-gen /segment HTTP {r.status_code}: {detail}")
        masks = r.json().get("masks")
        if not isinstance(masks, list):
            raise RuntimeError(f"remote-gen /segment sin masks: {r.text[:200]}")
        return masks

    def auto_segment(self, image_data_uri: str) -> list[bytes]:
        """Segmentación automática completa — una máscara PNG por región."""
        masks = self._segment({"image_b64": image_data_uri, "mode": "auto"})
        return [base64.b64decode(m["mask_b64"]) for m in masks]

    def segment_boxes(
        self, image_data_uri: str, boxes_xyxy: list[tuple[int, int, int, int]]
    ) -> list[bytes]:
        """Silueta del objeto de cada caja, en el orden de las cajas."""
        boxes = [
            {"id": f"b{i}", "box_xyxy": [int(v) for v in box]}
            for i, box in enumerate(boxes_xyxy)
        ]
        masks = self._segment(
            {"image_b64": image_data_uri, "mode": "boxes", "boxes": boxes}
        )
        by_id = {m["id"]: m for m in masks}
        try:
            return [base64.b64decode(by_id[f"b{i}"]["mask_b64"]) for i in range(len(boxes))]
        except KeyError as err:
            raise RuntimeError(f"remote-gen /segment: falta la máscara {err}") from err

    def close(self) -> None:
        self._client.close()
