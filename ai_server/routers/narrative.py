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
    # style_id requerido (espejo del pre-flight MCP): la plantilla exige
    # elegirlo de available_styles — sin él el juego quedaría sin estilo y el
    # título degradaría en silencio.
    required = ("game_id", "title", "description", "style_id", "world_brief", "world_md")
    missing = [k for k in required if not isinstance(game.get(k), str) or not game.get(k)]
    # tags requeridos (lista no vacía de strings): filtran qué estilos ofrece
    # el título para este mundo.
    tags = game.get("tags")
    if not (isinstance(tags, list) and tags and all(isinstance(t, str) and t for t in tags)):
        missing.append("tags")
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"develop_world response missing fields: {missing}",
        )
    return {"game": {
        "game_id": game["game_id"],
        "title": game["title"],
        "description": game["description"],
        "style_id": game["style_id"],
        "world_brief": game["world_brief"],
        "world_md": game["world_md"],
        "tags": [str(t) for t in game["tags"]],
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
