"""LLM client for narrative generation.

Supports two backends:
  - MCP bridge (default): routes through Claude Code via narrative-mcp WebSocket
  - Claude API direct: uses ANTHROPIC_API_KEY (fallback if MCP not available)

Cuál de los dos se intenta lo decide `NEFAN_LLM_MCP_URL` (#235): sin ella, el
canal MCP de siempre; con una URL, ese canal; con `off`, NINGÚN canal MCP y solo
la API. Antes el backend lo elegía un efecto de red —si había alguien
escuchando en el puerto del motor, se le mandaba la petición—, y en una
máquina con varios agentes ese alguien podía ser el terminal de OTRO.
"""

import os
import json
import uuid
import threading
import time

import httpx

from narrative_schemas import (
    GENERATE_SCENE_SYSTEM_PROMPT,
    GENERATE_SCENE_TOOL,
    NARRATIVE_REACT_SYSTEM_PROMPT,
    NARRATIVE_REACT_TOOL,
    NARRATIVE_WAKE_TOOL,
    PLAYER_DEATH_SYSTEM_PROMPT,
    validate_death_resolution,
    validate_scene_response,
    validate_narrative_reaction,
)
from style_packs import surface_style_key


class NarrativeUnavailable(RuntimeError):
    """No backend (MCP listener + API) is available to satisfy the request.
    Surfaced by ai_server endpoints as HTTP 503 — no scripted fallback runs."""

# WebSocket is optional — only needed for MCP bridge mode
try:
    import websocket  # websocket-client package
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False

# Anthropic is optional — only needed for direct API mode
try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


MCP_WS_URL_POR_DEFECTO = "ws://127.0.0.1:3737"
ENV_MCP_URL = "NEFAN_LLM_MCP_URL"


def mcp_ws_url_desde_entorno(env=os.environ) -> str | None:
    """A qué canal MCP se engancha el cliente, leído de `NEFAN_LLM_MCP_URL`.

    · ausente o en blanco → la URL de siempre (el terminal de Claude Code);
    · `off` (sin distinguir mayúsculas) → `None`: NO se abre canal MCP;
    · cualquier otra cosa → tiene que ser una URL `ws://`/`wss://`, y si no lo
      es se LANZA: una URL mal escrita que degradase a la de siempre mandaría
      la petición a un proceso que nadie eligió, que es justo lo que la
      variable existe para impedir."""
    raw = env.get(ENV_MCP_URL, "").strip()
    if not raw:
        return MCP_WS_URL_POR_DEFECTO
    if raw.lower() == "off":
        return None
    if not (raw.startswith("ws://") or raw.startswith("wss://")):
        raise ValueError(
            f"{ENV_MCP_URL}={raw!r} no es ni `off` ni una URL ws:// o wss://"
        )
    return raw


def _descripciones_reusables(assets: list[dict], limit: int) -> list[str]:
    """Proyección de las filas del store a lo que lee el motor: la descripción.
    Fuera las etiquetas opacas (<4 chars), dedupe por prompt sin distinguir
    mayúsculas, y las `limit` primeras (el store las da de la más reciente)."""
    seen: set[str] = set()
    out: list[str] = []
    for a in assets:
        prompt = str(a.get("prompt", "")).strip()
        if len(prompt) < 4:
            continue  # hashes/etiquetas internas, nada que leer
        norm = prompt.lower()
        if norm in seen:
            continue
        seen.add(norm)
        out.append(prompt)
        if len(out) >= limit:
            break
    return out


class LLMClient:
    def __init__(
        self,
        model: str = "claude-sonnet-4-5-20250929",
        mcp_ws_url: str | None = MCP_WS_URL_POR_DEFECTO,
        timeout: float = 60.0,
        asset_manifest=None,
        style_packs=None,
    ):
        self.model = model
        # `None` = canal MCP APAGADO a propósito (`NEFAN_LLM_MCP_URL=off`): no
        # se abre ningún WebSocket ni se reintenta cada 5 s.
        self.mcp_ws_url = mcp_ws_url
        self.timeout = timeout
        self.asset_manifest = asset_manifest
        # Resolver de packs (StylePackResolver): da el `style_token` con el que
        # se compone el estilo de la clave de caché de cada superficie, que es
        # el filtro de la librería que ve el motor (`surface_style_key`).
        self.style_packs = style_packs
        # Active narrative session — set by /notify_session, included in every
        # request to the MCP bridge so Claude knows which playthrough is in flight.
        self.session_info: dict | None = None

        # Pending responses from MCP bridge
        self._pending: dict[str, dict | None] = {}
        self._pending_lock = threading.Lock()
        # Peticiones de escena que agotaron el timeout, por request_id →
        # clave de reintento (session:tile). Si la respuesta llega tarde se
        # guarda en _late_scenes y el SIGUIENTE request del mismo tile la
        # devuelve al instante en vez de re-generar (minutos de LLM salvados).
        self._timed_out_scenes: dict[str, str] = {}
        self._late_scenes: dict[str, dict] = {}
        # Single-flight por clave de reintento: si el transporte del bridge
        # muere (p. ej. su fetch aborta) y reintenta el MISMO tile mientras el
        # motor aún genera, el segundo request se ENGANCHA a la generación en
        # vuelo en vez de mandar un duplicado al modelo.
        self._inflight_scenes: dict[str, str] = {}
        # Motivo real del último fallo del camino MCP (timeout/rechazo) para
        # que el 503/504 no mienta con "no MCP listener".
        self._last_mcp_failure: str = ""
        # Última señal de vida por request_id: los narrative_progress del
        # bridge MCP (una tool llamada, la petición recogida…) la refrescan y
        # el timeout de escena pasa a ser de INACTIVIDAD — un bootstrap puede
        # tardar 10+ min mientras dé señales.
        self._activity: dict[str, float] = {}
        self._last_progress_msg: dict[str, str] = {}
        self._ws: websocket.WebSocketApp | None = None
        self._ws_connected = False
        # Apagado en curso: el run_forever no debe reconectar. Un ai_server
        # moribundo que sigue reconectándose a narrative-mcp compite con el
        # ai_server nuevo por el canal del motor narrativo.
        self._closing = False

        # Try MCP bridge first — salvo que esté apagado por configuración.
        if not self.mcp_ws_url:
            print("LLM: canal MCP desactivado (NEFAN_LLM_MCP_URL=off); solo API directa")
        elif HAS_WEBSOCKET:
            self._try_connect_mcp()

        # Direct API: always initialize if a key is available, even if MCP is up.
        # This way the narrative kinds can fall back to API when MCP has no listener.
        self.api_client = None
        if HAS_ANTHROPIC:
            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if api_key:
                self.api_client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
                if not self._ws_connected:
                    print("LLM: Using Claude API direct mode (MCP not available)")
                else:
                    print("LLM: API client ready as MCP fallback")

        if not self._ws_connected and not self.api_client:
            print("LLM: No backend available. Install websocket-client for MCP bridge, "
                  "or set ANTHROPIC_API_KEY. Narrative requests will fail with 503.")

    def close(self) -> None:
        """Cierra el canal MCP y desactiva la reconexión (apagado del server).

        Llamado desde el shutdown del lifespan: `WebSocketApp.close()` para el
        `run_forever(reconnect=5)`, así el proceso que muere (aunque siga
        drenando peticiones HTTP en vuelo) deja de disputarle el canal de
        narrative-mcp al ai_server que lo sustituye."""
        self._closing = True
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception as e:
                print(f"LLM: error closing MCP websocket on shutdown: {e}")
            self._ws = None
        self._ws_connected = False

    def _try_connect_mcp(self) -> None:
        """Connect to narrative-mcp WebSocket bridge."""
        import websocket as ws_module

        def on_message(ws: "websocket.WebSocket", message: str) -> None:
            try:
                msg = json.loads(message)
                msg_type = msg.get("type")
                if msg_type == "room_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._pending[req_id] = msg["room_data"]
                        elif req_id in self._timed_out_scenes:
                            # Respuesta TARDÍA (el caller ya recibió timeout):
                            # conservarla — el siguiente request del mismo
                            # tile/sesión la devuelve sin re-generar.
                            retry_key = self._timed_out_scenes.pop(req_id)
                            self._late_scenes[retry_key] = msg["room_data"]
                            while len(self._late_scenes) > 8:
                                self._late_scenes.pop(next(iter(self._late_scenes)))
                            print(
                                f"LLM: respuesta de escena TARDÍA (id={req_id[:8]}…) "
                                f"guardada para reintento [{retry_key}] — "
                                "el timeout ya había expirado (sube llm_timeout_s)"
                            )
                        else:
                            print(f"LLM: room_response desconocido descartado (id={req_id[:8]}…)")
                elif msg_type == "narrative_event_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._pending[req_id] = msg.get("result", {})
                elif msg_type == "narrative_progress":
                    req_id = msg.get("request_id", "")
                    message = str(msg.get("message", ""))[:300]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._activity[req_id] = time.time()
                            self._last_progress_msg[req_id] = message
                            print(f"LLM: progreso [{req_id[:8]}…] {message}")
            except (json.JSONDecodeError, KeyError) as e:
                # The narrative-mcp bridge produced a frame we can't parse. Log
                # the preview so a real protocol mismatch surfaces instead of
                # disappearing into the void.
                preview = (message if isinstance(message, str) else str(message))[:200]
                print(
                    f"LLM: dropping unparseable bridge frame ({type(e).__name__}): {preview}",
                    flush=True,
                )

        def on_open(ws: "websocket.WebSocket") -> None:
            self._ws_connected = True
            ws.send(json.dumps({"type": "hello"}))
            print(f"LLM: Connected to narrative-mcp bridge ({self.mcp_ws_url})")

        def on_close(ws: "websocket.WebSocket", close_code: int, close_msg: str) -> None:
            self._ws_connected = False
            if not self._closing:
                print("LLM: Disconnected from narrative-mcp bridge")

        def on_error(ws: "websocket.WebSocket", error: Exception) -> None:
            self._ws_connected = False

        try:
            self._ws = ws_module.WebSocketApp(
                self.mcp_ws_url,
                on_message=on_message,
                on_open=on_open,
                on_close=on_close,
                on_error=on_error,
            )
            # reconnect=5 makes run_forever retry every 5s on initial failure or drop
            ws_thread = threading.Thread(
                target=lambda: self._ws.run_forever(reconnect=5),
                daemon=True,
            )
            ws_thread.start()

            # Wait briefly for connection
            for _ in range(10):
                if self._ws_connected:
                    return
                time.sleep(0.1)

            if not self._ws_connected:
                print("LLM: narrative-mcp bridge not available yet (will retry every 5s)")
        except Exception as e:
            print(f"LLM: Failed to connect to MCP bridge: {e}")

    def set_session(self, session_id: str, game_id: str, is_resume: bool) -> None:
        """Record the active narrative session. The next requests to the bridge
        will include it so Claude can reset/resume context appropriately."""
        self.session_info = {
            "session_id": session_id,
            "game_id": game_id,
            "is_resume": bool(is_resume),
        }
        print(f"LLM: active session set to {session_id} (game={game_id}, resume={is_resume})")

    #: Tipo que el motor puede REUSAR: solo las superficies de la vista fps,
    #: y por DESCRIPCIÓN verbatim, no por hash. Los kinds texture/model/sprite
    #: salieron con el gpu-worker (#199); scene/plate quedan FUERA porque sus
    #: prompts eran instrucciones de repintado (hallazgo medido 2026-08-14).
    REUSABLE_ASSET_TYPES = "surface"
    #: Solo las celdas `unique`: son las que crea un `surface_desc` del motor
    #: (src/scene/greybox/surfaces.ts). Las `tile` son la librería por defecto
    #: del engine (`info.en`), que el motor no puede pedir por descripción.
    REUSABLE_SURFACE_KIND = "unique"

    def _inject_available_assets(self, payload: dict, limit: int = 30) -> dict:
        """Add `available_assets` and active session info to a request payload
        so the narrative engine knows what's already painted and which
        playthrough is in flight. Mutates and returns the payload.

        La librería que ve el motor son DESCRIPCIONES (lo único que usa: reusa
        por texto, no por hash) de superficies pintadas en el ESTILO de la
        partida — el mismo `style` que entra en la clave de caché de la celda.
        Una descripción de otro estilo no es reusable: repetida aquí sería un
        repintado pagado, no un cache-hit (tanda BZ). El filtro va en el store,
        ANTES de la ventana: filtrar aquí dejaría que 200 filas recientes de
        otros estilos expulsaran a las del bueno.

        Sin `world.style_id` o sin resolver de packs NO se ofrece librería, y se
        dice: una librería sin estilo no puede ser honesta. Se conservan los
        prompts cortos ("banco de piedra"), el dedupe por prompt y las `limit`
        más recientes."""
        if self.asset_manifest is not None:
            world = payload.get("world")
            style_id = str(world.get("style_id") or "") if isinstance(world, dict) else ""
            style_key = surface_style_key(self.style_packs, style_id)
            if not style_key:
                print(
                    "LLM WARNING: available_assets NO se ofrece — la petición no "
                    f"trae world.style_id ({style_id!r}) o no hay resolver de packs; "
                    "sin estilo no se puede decir qué superficie es reusable"
                )
            else:
                try:
                    assets = self.asset_manifest.list_assets(
                        asset_type=self.REUSABLE_ASSET_TYPES,
                        limit=200,
                        style=style_key,
                        surface_kind=self.REUSABLE_SURFACE_KIND,
                    )
                except httpx.HTTPStatusError as e:
                    # Un 4xx es NUESTRO: la consulta no casa con el contrato de
                    # GET /assets (filtro vacío, kind fuera del enum…). Eso no es
                    # un store caído y no se degrada: se lanza.
                    if e.response.status_code < 500:
                        raise
                    print(f"LLM WARNING: asset-store falló sirviendo la librería del motor: {e}")
                except httpx.HTTPError as e:
                    # Store caído o inalcanzable: degradar SIN librería es
                    # legítimo (el motor describe libre y se pinta), con aviso.
                    # Un bug de código no se captura aquí.
                    print(f"LLM WARNING: asset-store no respondió la librería del motor: {e}")
                else:
                    reusable = _descripciones_reusables(assets, limit)
                    if reusable:
                        payload["available_assets"] = reusable
        if self.session_info is not None:
            payload["session"] = dict(self.session_info)
        return payload

    def generate_scene(self, scene_request: dict) -> dict:
        """Generate an outdoor scene. Tries MCP, then API. Raises
        NarrativeUnavailable if neither backend can satisfy the request —
        with the REAL reason (timeout ≠ sin listener)."""
        scene_request = self._inject_available_assets(dict(scene_request))
        mcp_attempted = False
        if self._ws_connected and self._ws:
            mcp_attempted = True
            result = self._generate_scene_via_mcp(scene_request)
            if result is not None:
                return result

        if self.api_client:
            return self._generate_scene_via_api(scene_request)

        if mcp_attempted:
            raise NarrativeUnavailable(
                f"generate_scene: {self._last_mcp_failure or 'el camino MCP falló'} "
                "(sin API client de fallback). Si el motor narrativo seguía "
                "escribiendo, su respuesta se guardará y un reintento del mismo "
                "tile la recupera; para bootstraps largos sube llm_timeout_s."
            )
        raise NarrativeUnavailable(
            "generate_scene: no MCP listener and no API client configured"
        )

    @staticmethod
    def _scene_retry_key(scene_request: dict) -> str:
        """Clave estable de reintento de una petición de escena: sesión +
        tile (o place realizado). Dos requests con la misma clave piden el
        MISMO contenido — una respuesta tardía de la primera vale para la
        segunda."""
        session = str(scene_request.get("session_id", ""))
        gt = scene_request.get("generate_tile") or {}
        if isinstance(gt, dict) and "tx" in gt:
            return f"{session}:tile_{gt.get('tx')}_{gt.get('ty')}"
        rp = scene_request.get("realize_place") or {}
        if isinstance(rp, dict) and rp.get("id"):
            return f"{session}:place_{rp.get('id')}"
        return f"{session}:scene"

    def _generate_scene_via_mcp(self, scene_request: dict) -> dict | None:
        """Send scene generation request through MCP bridge."""
        request_id = str(uuid.uuid4())
        retry_key = self._scene_retry_key(scene_request)

        with self._pending_lock:
            # Reintento de un tile cuya respuesta llegó tras el timeout (o
            # cuyo primer request murió en el transporte): la escena YA está
            # generada — devolverla sin molestar al modelo.
            late = self._late_scenes.pop(retry_key, None)
            inflight_id = None if late is not None else self._inflight_scenes.get(retry_key)
        if late is not None:
            print(f"LLM: sirviendo respuesta guardada para [{retry_key}]")
            try:
                return validate_scene_response(late)
            except Exception as e:  # noqa: BLE001 — degrada a re-generar
                print(f"LLM: respuesta guardada inválida ({e}); se re-genera")
        if inflight_id is not None:
            # Enganche: otra petición del MISMO contenido sigue en vuelo (el
            # bridge reintentó tras perder su conexión). Esperar su resultado
            # con el mismo timeout de inactividad, sin duplicar la generación.
            print(f"LLM: petición duplicada de [{retry_key}] — enganchada a la generación en vuelo (id={inflight_id[:8]}…)")
            attach_start = time.time()
            while True:
                with self._pending_lock:
                    done = self._late_scenes.pop(retry_key, None)
                    still_inflight = self._inflight_scenes.get(retry_key) == inflight_id
                    last_activity = self._activity.get(inflight_id, attach_start)
                if done is not None:
                    try:
                        return validate_scene_response(done)
                    except Exception as e:  # noqa: BLE001
                        print(f"LLM: resultado enganchado inválido ({e})")
                        return None
                if not still_inflight:
                    # El vuelo original terminó sin dejar resultado (timeout
                    # o rechazo): reflejar su fallo, el caller decide.
                    print(f"LLM: la generación en vuelo de [{retry_key}] terminó sin resultado")
                    return None
                if time.time() - last_activity >= self.timeout:
                    print(f"LLM: enganche a [{retry_key}] agotó la inactividad")
                    self._last_mcp_failure = (
                        f"timeout: {self.timeout:.0f}s sin señales del motor narrativo"
                    )
                    return None
                time.sleep(0.2)
        with self._pending_lock:
            self._pending[request_id] = None
            self._inflight_scenes[retry_key] = request_id

        self._ws.send(json.dumps({  # type: ignore
            "type": "room_request",
            "request_id": request_id,
            "world_state": scene_request,
            "format": "scene",
        }))

        print(f"LLM: Scene request via MCP (id={request_id[:8]}...)")

        start = time.time()
        with self._pending_lock:
            self._activity[request_id] = start
        while True:
            with self._pending_lock:
                # Timeout de INACTIVIDAD: cada narrative_progress del motor
                # (tool llamada, petición recogida) lo resetea. Solo expira
                # si el motor lleva `timeout` segundos sin dar señales.
                last_activity = self._activity.get(request_id, start)
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    self._activity.pop(request_id, None)
                    self._last_progress_msg.pop(request_id, None)
                    if self._inflight_scenes.get(retry_key) == request_id:
                        del self._inflight_scenes[retry_key]
                    # Guardar el resultado bruto: si el transporte del caller
                    # murió (fetch abortado), el reintento del bridge lo
                    # recoge de aquí sin re-generar. Cap compartido con las
                    # respuestas tardías.
                    if isinstance(result, dict) and not result.get("error"):
                        self._late_scenes[retry_key] = result
                        while len(self._late_scenes) > 8:
                            self._late_scenes.pop(next(iter(self._late_scenes)))
                    # Structured error from the bridge (e.g. no_mcp_listener).
                    # Without this check, validate_scene_response pads the
                    # error dict into a placeholder scene and the caller gets
                    # a 200.
                    if isinstance(result, dict) and result.get("error"):
                        reason = result.get("reason", "unknown")
                        print(f"LLM: Scene MCP rejected — {reason}")
                        self._last_mcp_failure = (
                            f"el bridge MCP rechazó la petición ({reason}) — "
                            "¿hay una terminal de Claude Code con narrative_listen?"
                        )
                        return None
                    try:
                        validated = validate_scene_response(result)
                    except ValueError as e:
                        # El pre-flight MCP (EmittedSceneSchema en narrative-mcp)
                        # ya validó la forma ANTES de "response sent"; si aun así
                        # el saneador la rechaza es una DIVERGENCIA de reglas —
                        # se reporta fail-loud (ni se degrada ni se crashea) para
                        # corregirla, no se cuela una escena mutilada.
                        print(f"LLM: escena MCP rechazada por el saneador ({e})")
                        self._last_mcp_failure = f"escena inválida: {e}"
                        return None
                    print(f"LLM: Scene via MCP ({len(validated.get('objects', []))} objects, "
                          f"{time.time() - start:.1f}s)")
                    return validated
            if time.time() - last_activity >= self.timeout:
                break
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
            last_msg = self._last_progress_msg.pop(request_id, "")
            self._activity.pop(request_id, None)
            if self._inflight_scenes.get(retry_key) == request_id:
                del self._inflight_scenes[retry_key]
            # Recordar el id: si el modelo responde tarde, on_message guarda
            # la escena bajo retry_key en vez de descartarla.
            self._timed_out_scenes[request_id] = retry_key
            while len(self._timed_out_scenes) > 16:
                self._timed_out_scenes.pop(next(iter(self._timed_out_scenes)))
        print(
            f"LLM: MCP scene timeout — {self.timeout:.0f}s SIN señales del motor "
            f"(total {time.time() - start:.0f}s) [{retry_key}]"
            + (f" — último progreso: {last_msg}" if last_msg else "")
        )
        self._last_mcp_failure = (
            f"timeout: {self.timeout:.0f}s sin señales del motor narrativo"
            + (f" (último progreso: {last_msg})" if last_msg else "")
        )
        return None

    def _generate_scene_via_api(self, scene_request: dict) -> dict:
        """Call Claude API directly with generate_scene tool."""
        world = scene_request.get("world", {}) or {}
        world_brief = world.get("description", "")
        world_document = scene_request.get("world_document", "")

        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                # 16k: un tile con map_svg (blueprint SVG de ~10 KB) + JSON no
                # cabe en 4096. El camino MCP no pasa por aquí.
                max_tokens=16384,
                system=GENERATE_SCENE_SYSTEM_PROMPT,
                tools=[GENERATE_SCENE_TOOL],
                tool_choice={"type": "tool", "name": "generate_scene"},
                messages=[{
                    "role": "user",
                    "content": (
                        f"Generate an outdoor scene for this world:\n\n"
                        f"WORLD BRIEF:\n{world_brief}\n\n"
                        + (f"WORLD DOCUMENT:\n{world_document}\n\n" if world_document else "")
                        + f"SCENE DESCRIPTION:\n{scene_request.get('scene_description', 'an outdoor area')}\n\n"
                        f"Include buildings, terrain details, props, and atmospheric elements. "
                        f"Do NOT include NPCs - they are managed separately."
                    ),
                }],
            )

            for block in response.content:
                if block.type == "tool_use" and block.name == "generate_scene":
                    result = validate_scene_response(block.input)
                    print(f"LLM: Scene via API ({len(result.get('objects', []))} objects)")
                    return result

            raise NarrativeUnavailable(
                "generate_scene API response had no tool_use block"
            )

        except NarrativeUnavailable:
            raise
        except Exception as e:
            raise NarrativeUnavailable(
                f"generate_scene API call failed: {e}"
            ) from e

    # ------------------------------------------------------------------
    # Narrative reactivity (Phase 3): player choices → world consequences
    # ------------------------------------------------------------------

    def report_player_choice(
        self,
        event_id: str,
        speaker: str,
        chosen_text: str,
        free_text: str,
        context: dict,
    ) -> dict:
        """Forward a player dialogue choice/free-text to the narrative engine
        and return its consequences.

        Tries MCP bridge first, then API. Raises NarrativeUnavailable if
        neither backend produced a valid response — the ai_server endpoint
        translates that into HTTP 503 so the client sees the failure instead
        of an empty consequences list.
        """
        context = self._inject_available_assets(dict(context))
        if self._ws_connected and self._ws:
            result = self._report_choice_via_mcp(event_id, speaker, chosen_text, free_text, context)
            if result is not None:
                return result
        if self.api_client:
            result = self._report_choice_via_api(event_id, speaker, chosen_text, free_text, context)
            if result is not None:
                return result
        raise NarrativeUnavailable(
            "report_player_choice: no MCP listener and no API client produced a response"
        )

    def _report_choice_via_mcp(
        self,
        event_id: str,
        speaker: str,
        chosen_text: str,
        free_text: str,
        context: dict,
    ) -> dict | None:
        request_id = str(uuid.uuid4())
        with self._pending_lock:
            self._pending[request_id] = None
        try:
            self._ws.send(json.dumps({  # type: ignore
                "type": "narrative_event",
                "request_id": request_id,
                "kind": "dialogue_choice",
                "event_id": event_id,
                "speaker": speaker,
                "chosen_text": chosen_text,
                "free_text": free_text,
                "context": context,
            }))
        except Exception as e:
            print(f"LLM: report_choice MCP send failed ({e})")
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return None
        print(f"LLM: narrative event sent via MCP (id={request_id[:8]}, speaker={speaker})")

        # Long timeout — Claude may take a moment to think
        timeout = max(self.timeout, 120.0)
        start = time.time()
        while time.time() - start < timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    if isinstance(result, dict) and result.get("error") == "no_mcp_listener":
                        print("LLM: narrative event rejected — no MCP listener")
                        return None
                    validated = validate_narrative_reaction(result if isinstance(result, dict) else {})
                    print(f"LLM: narrative reaction received ({time.time() - start:.1f}s, "
                          f"{len(validated['consequences'])} consequences)")
                    return validated
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: narrative event MCP timeout ({timeout}s)")
        return None

    def develop_world(self, draft_text: str, available_styles: list[dict]) -> dict | None:
        """Desarrolla el borrador de mundo de un jugador contra la plantilla
        de 10 secciones (kind develop_world vía MCP). Devuelve el dict del
        juego o None (sin listener / timeout) — el endpoint decide el 503."""
        if not self._ws_connected:
            return None
        request_id = str(uuid.uuid4())
        with self._pending_lock:
            self._pending[request_id] = None
        try:
            self._ws.send(json.dumps({  # type: ignore
                "type": "narrative_event",
                "request_id": request_id,
                "kind": "develop_world",
                "event_id": request_id,
                "speaker": "",
                "chosen_text": "",
                "free_text": "",
                "context": {
                    "draft_text": draft_text,
                    "available_styles": available_styles,
                },
            }))
        except Exception as e:
            print(f"LLM: develop_world MCP send failed ({e})")
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return None
        print(f"LLM: develop_world sent via MCP (id={request_id[:8]}, draft={len(draft_text)} chars)")

        # Desarrollar un mundo entero tarda como un bootstrap: timeout largo.
        timeout = max(self.timeout, 300.0)
        start = time.time()
        while time.time() - start < timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    if isinstance(result, dict) and result.get("error") == "no_mcp_listener":
                        print("LLM: develop_world rejected — no MCP listener")
                        return None
                    if not isinstance(result, dict):
                        return None
                    print(f"LLM: develop_world received ({time.time() - start:.1f}s)")
                    return result
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: develop_world MCP timeout ({timeout}s)")
        return None

    def _report_choice_via_api(
        self,
        event_id: str,
        speaker: str,
        chosen_text: str,
        free_text: str,
        context: dict,
    ) -> dict | None:
        if not self.api_client:
            return None
        user_text = (
            f"event_id: {event_id}\n"
            f"speaker: {speaker}\n"
            f"chosen_text: {chosen_text}\n"
            f"free_text: {free_text}\n\n"
            f"context: {json.dumps(context, ensure_ascii=False)[:6000]}\n\n"
            "Decide consequences via the react_to_player tool."
        )
        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=1024,
                system=NARRATIVE_REACT_SYSTEM_PROMPT,
                tools=[NARRATIVE_REACT_TOOL],
                tool_choice={"type": "tool", "name": "react_to_player"},
                messages=[{"role": "user", "content": user_text}],
            )
        except Exception as e:
            # Fallo de red/API — transitorio; el caller degrada a 503.
            print(f"LLM: react_to_player API error ({e})")
            return None
        for block in response.content:
            if block.type == "tool_use" and block.name == "react_to_player":
                # validate_narrative_reaction lanza ValueError con el motivo
                # preciso ante forma inválida — se deja PROPAGAR para que el
                # endpoint devuelva 422 (no un 503 genérico ni un [] silencioso).
                validated = validate_narrative_reaction(block.input)
                print(f"LLM: narrative reaction via API ({len(validated['consequences'])} consequences)")
                return validated
        # tool_choice forzó react_to_player: si no hay bloque tool_use la
        # respuesta del modelo es inválida. Fail-loud (→422) en vez de fingir
        # "no pasa nada" con {"consequences": []} y 200 OK (lo que el docstring
        # de report_player_choice dice EVITAR).
        raise ValueError("react_to_player: el modelo no emitió el bloque tool_use esperado")

    # ── player_death (#613, «que decida el motor») ──────────────────────────

    def report_player_death(self, event_id: str, context: dict) -> dict:
        """El jugador ha caído: el motor decide dónde despierta. MCP primero
        (kind `player_death`), API después. Sin ninguno de los dos, lanza
        NarrativeUnavailable (→ 503). Una respuesta con forma inválida lanza
        ValueError desde `validate_death_resolution` (→ 422)."""
        context = self._inject_available_assets(dict(context))
        if self._ws_connected and self._ws:
            result = self._report_death_via_mcp(event_id, context)
            if result is not None:
                return result
        if self.api_client:
            result = self._report_death_via_api(event_id, context)
            if result is not None:
                return result
        raise NarrativeUnavailable(
            "report_player_death: no MCP listener and no API client produced a response"
        )

    def _report_death_via_mcp(self, event_id: str, context: dict) -> dict | None:
        request_id = str(uuid.uuid4())
        with self._pending_lock:
            self._pending[request_id] = None
        try:
            self._ws.send(json.dumps({  # type: ignore
                "type": "narrative_event",
                "request_id": request_id,
                "kind": "player_death",
                "event_id": event_id,
                "speaker": "",
                "chosen_text": "",
                "free_text": "",
                "context": context,
            }))
        except Exception as e:
            print(f"LLM: player_death MCP send failed ({e})")
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return None
        print(f"LLM: player_death sent via MCP (id={request_id[:8]})")
        # El motor puede consultar el mapa antes de decidir: el techo de una escena.
        timeout = max(self.timeout, 120.0)
        start = time.time()
        while time.time() - start < timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    if isinstance(result, dict) and result.get("error") == "no_mcp_listener":
                        print("LLM: player_death rejected — no MCP listener")
                        return None
                    validated = validate_death_resolution(result if isinstance(result, dict) else None)
                    print(f"LLM: player_death resolved ({time.time() - start:.1f}s)")
                    return validated
            time.sleep(0.1)
        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: player_death MCP timeout ({timeout}s)")
        return None

    def _report_death_via_api(self, event_id: str, context: dict) -> dict | None:
        if not self.api_client:
            return None
        user_text = (
            f"event_id: {event_id}\n\n"
            f"context: {json.dumps(context, ensure_ascii=False)[:8000]}\n\n"
            "Decide where the player wakes up via the wake_player tool."
        )
        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=1024,
                system=PLAYER_DEATH_SYSTEM_PROMPT,
                tools=[NARRATIVE_WAKE_TOOL],
                tool_choice={"type": "tool", "name": "wake_player"},
                messages=[{"role": "user", "content": user_text}],
            )
        except Exception as e:
            print(f"LLM: wake_player API error ({e})")
            return None
        for block in response.content:
            if block.type == "tool_use" and block.name == "wake_player":
                return validate_death_resolution(block.input)
        raise ValueError("wake_player: el modelo no emitió el bloque tool_use esperado")
