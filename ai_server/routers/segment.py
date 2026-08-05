"""POST /segment (S5 remote-gen): la ÚNICA llamada SAM2 del stack (F4).

Extraído para que narrative-llm no dependa de FAL_KEY. Adaptador puro sobre
FalSamClient: mode "auto" → SAM2 auto-segment (una máscara por región, ids
sintéticos `auto_i`); mode "boxes" → silueta del objeto de cada caja (mismos
ids y orden que la entrada). Devuelve los PNG CRUDOS de fal en base64 — la
conversión a máscara booleana queda en el consumidor (_mask_from_fal /
mask_from_png), así los blobs ya guardados en los canales dev del consumidor
siguen valiendo byte a byte. Sin DEV_API_CACHE aquí: su único cliente
(narrative-llm) envuelve la llamada en sus canales through_sync — meter otro
cache debajo emparejaría blobs con el item equivocado.

Errores: sin FAL_KEY → 503; fallo de fal → 502 (fail-loud, {detail}).
"""

import base64
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deps import deps
from request_util import decode_b64_png

logger = logging.getLogger("ai_server")

router = APIRouter()


class SegmentBox(BaseModel):
    id: str = Field(min_length=1)
    # [x0, y0, x1, y1] px — el box prompt de SAM2 tal cual.
    box_xyxy: list[float] = Field(min_length=4, max_length=4)


class SegmentRequest(BaseModel):
    image_b64: str = Field(min_length=1)
    mode: str = Field(pattern="^(auto|boxes)$")
    boxes: list[SegmentBox] = Field(default_factory=list)


@router.post("/segment")
async def segment_endpoint(body: SegmentRequest):
    import asyncio

    if deps.fal_sam is None:
        raise HTTPException(
            status_code=503,
            detail="segmentación no disponible — define FAL_KEY en .env (proceso remote-gen)",
        )
    png = decode_b64_png(body.image_b64)
    data_uri = "data:image/png;base64," + base64.b64encode(png).decode()

    if body.mode == "boxes":
        if not body.boxes:
            raise HTTPException(status_code=422, detail="mode 'boxes' requiere boxes")
        ids = [b.id for b in body.boxes]
        if len(set(ids)) != len(ids):
            raise HTTPException(status_code=422, detail="boxes con ids duplicados")
        xyxy = [tuple(int(v) for v in b.box_xyxy) for b in body.boxes]
        try:
            masks = await asyncio.to_thread(deps.fal_sam.segment_boxes, data_uri, xyxy)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"fal SAM2 box segment failed: {e}") from e
    else:
        try:
            masks = await asyncio.to_thread(deps.fal_sam.auto_segment, data_uri)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"fal SAM2 auto-segment failed: {e}") from e
        ids = [f"auto_{i}" for i in range(len(masks))]

    return {
        "masks": [
            {"id": mask_id, "mask_b64": base64.b64encode(png_bytes).decode()}
            for mask_id, png_bytes in zip(ids, masks, strict=True)
        ]
    }
