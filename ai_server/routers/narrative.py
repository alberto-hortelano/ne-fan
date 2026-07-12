"""Narrativa: puente HTTP entre el bridge/Godot y el motor narrativo (MCP).

Endpoints movidos TAL CUAL desde main.py (el estado runtime viene de `deps`).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deps import deps
from llm_client import NarrativeUnavailable

router = APIRouter()


class NotifySessionRequest(BaseModel):
    session_id: str = Field(min_length=1)
    game_id: str = Field(min_length=1)
    is_resume: bool = False


class ReportPlayerChoiceRequest(BaseModel):
    event_id: str = Field(min_length=1)
    speaker: str = ""
    chosen_text: str = ""
    free_text: str = ""
    context: dict = Field(default_factory=dict)


class DevelopWorldRequest(BaseModel):
    """Borrador de mundo del jugador (textarea o archivo .md/.txt) que el
    motor narrativo desarrolla contra la plantilla de 10 secciones."""
    draft_text: str = Field(min_length=20, max_length=64_000)


class ReviewBlueprintRequest(BaseModel):
    """Revisión por visión del blueprint antes de generar (tecla R del cliente).

    `image_b64` es el mismo PNG del schematic que iría a Meshy; `scene` es la
    escena Format D que lo produjo. Claude (vía MCP) devuelve
    { approved, issues, fixes? } con overrides parciales."""
    scene_id: str = Field(min_length=1)
    image_b64: str = Field(min_length=1)
    scene: dict


@router.post("/develop_world")
async def develop_world_endpoint(body: DevelopWorldRequest):
    """Desarrolla el borrador de mundo de un jugador (kind MCP develop_world).
    Sin backend LLM o sin listener: 503 fail-loud (no hay fallback scripted)."""
    import asyncio

    if deps.llm_client is None:
        raise HTTPException(status_code=503, detail="LLM backend not initialised")
    styles = deps.style_packs.list_styles() if deps.style_packs is not None else []
    result = await asyncio.to_thread(deps.llm_client.develop_world, body.draft_text, styles)
    if result is None:
        raise HTTPException(
            status_code=503,
            detail="develop_world unavailable: no MCP listener (arranca Claude Code con narrative_listen) o timeout",
        )
    game = result.get("game") if isinstance(result.get("game"), dict) else result
    required = ("game_id", "title", "description", "world_brief", "world_md")
    missing = [k for k in required if not isinstance(game.get(k), str) or not game.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"develop_world response missing fields: {missing}",
        )
    return {"game": {
        "game_id": game["game_id"],
        "title": game["title"],
        "description": game["description"],
        "style_id": str(game.get("style_id", "")),
        "world_brief": game["world_brief"],
        "world_md": game["world_md"],
    }}


@router.post("/report_player_choice")
async def report_player_choice(body: ReportPlayerChoiceRequest):
    """Forward a player dialogue choice to the narrative engine and return its
    consequences. No silent fallback: if there is no LLM backend or the LLM
    produces an invalid response, this endpoint returns HTTP 503 / 422 so the
    bridge surfaces the error to the client."""
    import asyncio
    if deps.llm_client is None:
        raise HTTPException(
            status_code=503,
            detail="ai_server has no deps.llm_client configured — no MCP listener, no API key",
        )
    try:
        result = await asyncio.to_thread(
            deps.llm_client.report_player_choice,
            body.event_id,
            body.speaker,
            body.chosen_text,
            body.free_text,
            body.context,
        )
    except NarrativeUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        # validate_narrative_reaction raised: LLM returned invalid payload.
        raise HTTPException(
            status_code=422,
            detail=f"narrative engine returned invalid response: {e}",
        ) from e
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=502,
            detail=f"narrative engine returned non-dict result: {type(result).__name__}",
        )
    return result


@router.post("/review_scene_blueprint")
async def review_scene_blueprint(body: ReviewBlueprintRequest):
    """Pide a Claude (vía MCP) que MIRE el blueprint pintado y lo compare con la
    escena Format D antes de gastar créditos de generación. Devuelve
    { approved, issues, fixes? }. Fail-loud: sin listener MCP → 503; timeout →
    504; respuesta inválida del LLM → 422. Nunca 200 con error."""
    import asyncio
    if deps.llm_client is None:
        raise HTTPException(
            status_code=503,
            detail="ai_server has no deps.llm_client configured — no MCP listener",
        )
    # El bloque de imagen MCP exige base64 puro; aceptar también data URLs.
    image_b64 = body.image_b64
    if image_b64.startswith("data:"):
        _, _, image_b64 = image_b64.partition(",")
    try:
        result = await asyncio.to_thread(
            deps.llm_client.review_blueprint,
            image_b64,
            body.scene,
            {"scene_id": body.scene_id},
        )
    except NarrativeUnavailable as e:
        status = 504 if "timeout" in str(e).lower() else 503
        raise HTTPException(status_code=status, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=f"blueprint review returned invalid response: {e}",
        ) from e
    return result


@router.post("/notify_session")
async def notify_session(body: NotifySessionRequest):
    """Godot calls this when the player starts or resumes a narrative session.
    The session metadata is propagated to Claude on the next bridge request."""
    if deps.llm_client is not None:
        deps.llm_client.set_session(body.session_id, body.game_id, body.is_resume)
    return {
        "ok": True,
        "session_id": body.session_id,
        "game_id": body.game_id,
        "is_resume": body.is_resume,
    }
