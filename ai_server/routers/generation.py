"""Generación narrativa: escenas LLM.

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
Los pipelines de APIs de pago (repintado, sprite sheets
skinneados) viven en routers/remote_generation.py (F4); la generación local
con GPU se retiró entera con el gpu-worker (#199).
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator

from deps import deps
from llm_client import NarrativeUnavailable

logger = logging.getLogger("ai_server")

router = APIRouter()


class GenerateSceneRequest(BaseModel):
    """/generate_scene takes the bridge's LlmContext
    (nefan-core/src/narrative/types.ts): session_id, game_id, world, player
    + extras. Extra fields pass through to the narrative engine untouched so
    the TS side can add context without a lockstep deploy; the validator only
    enforces that the shape is complete."""
    model_config = ConfigDict(extra="allow")

    session_id: str | None = None
    game_id: str | None = None
    world: dict | None = None
    player: dict | None = None

    @model_validator(mode="after")
    def _require_context(self) -> "GenerateSceneRequest":
        is_context = bool(
            self.session_id and self.game_id
            and self.world is not None and self.player is not None
        )
        if not is_context:
            raise ValueError(
                "expected an LlmContext (session_id, game_id, world, player)"
            )
        return self


@router.post("/generate_scene")
async def generate_scene(body: GenerateSceneRequest):
    """Accept the LlmContext from the bridge, return open-world scene JSON."""
    import asyncio

    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="deps.llm_client unavailable")

    try:
        return await asyncio.to_thread(
            deps.llm_client.generate_scene, body.model_dump(exclude_none=True)
        )
    except NarrativeUnavailable as e:
        # 504 para timeout (el modelo puede seguir escribiendo; el reintento
        # del mismo tile recupera la respuesta tardía), 503 para el resto.
        status = 504 if "timeout" in str(e).lower() else 503
        raise HTTPException(status_code=status, detail=str(e)) from e
