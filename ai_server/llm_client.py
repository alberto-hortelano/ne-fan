"""LLM client for narrative generation.

Supports two backends:
  - MCP bridge (default): routes through Claude Code via narrative-mcp WebSocket
  - Claude API direct: uses ANTHROPIC_API_KEY (fallback if MCP not available)
"""

import os
import json
import copy
import uuid
import threading
import time

from narrative_schemas import (
    NARRATIVE_SYSTEM_PROMPT,
    NARRATIVE_SYSTEM_PROMPT_V2,
    POPULATE_ROOM_TOOL,
    GENERATE_ROOM_TOOL,
    GENERATE_SCENE_SYSTEM_PROMPT,
    GENERATE_SCENE_TOOL,
    FALLBACK_ROOM,
    FALLBACK_EXTENDED_ROOM,
    WEAPON_ORIENT_SYSTEM_PROMPT,
    WEAPON_ORIENT_TOOL,
    NARRATIVE_REACT_SYSTEM_PROMPT,
    NARRATIVE_REACT_TOOL,
    validate_room_response,
    validate_extended_room_response,
    validate_scene_response,
    validate_weapon_orient_response,
    validate_narrative_reaction,
)

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


class LLMClient:
    def __init__(
        self,
        model: str = "claude-sonnet-4-5-20250514",
        mcp_ws_url: str = "ws://127.0.0.1:3737",
        timeout: float = 60.0,
        asset_manifest=None,
    ):
        self.model = model
        self.mcp_ws_url = mcp_ws_url
        self.timeout = timeout
        self.asset_manifest = asset_manifest
        # Active narrative session — set by /notify_session, included in every
        # request to the MCP bridge so Claude knows which playthrough is in flight.
        self.session_info: dict | None = None

        # Pending responses from MCP bridge
        self._pending: dict[str, dict | None] = {}
        self._pending_lock = threading.Lock()
        self._ws: "websocket.WebSocketApp | None" = None
        self._ws_connected = False

        # Try MCP bridge first
        if HAS_WEBSOCKET:
            self._try_connect_mcp()

        # Direct API: always initialize if a key is available, even if MCP is up.
        # This way analyze_weapon can fall back to API when MCP has no listener.
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
                  "or set ANTHROPIC_API_KEY. Will use fallback rooms.")

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
                elif msg_type == "vision_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._pending[req_id] = msg.get("result", {})
                elif msg_type == "narrative_event_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._pending[req_id] = msg.get("result", {})
                elif msg_type == "bridge_status_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            # Strip the type/request_id wrapper
                            self._pending[req_id] = {
                                "listener_active": msg.get("listener_active", False),
                                "listener_ever_connected": msg.get("listener_ever_connected", False),
                                "last_listen_seconds_ago": msg.get("last_listen_seconds_ago", -1),
                            }
            except (json.JSONDecodeError, KeyError):
                pass

        def on_open(ws: "websocket.WebSocket") -> None:
            self._ws_connected = True
            ws.send(json.dumps({"type": "hello"}))
            print("LLM: Connected to narrative-mcp bridge (ws://127.0.0.1:3737)")

        def on_close(ws: "websocket.WebSocket", close_code: int, close_msg: str) -> None:
            self._ws_connected = False
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

    def _inject_available_assets(self, payload: dict, limit: int = 100) -> dict:
        """Add `available_assets` and active session info to a request payload
        so the narrative engine knows what's already generated and which
        playthrough is in flight. Mutates and returns the payload."""
        if self.asset_manifest is not None:
            try:
                assets = self.asset_manifest.list_assets(limit=limit)
                if assets:
                    payload["available_assets"] = assets
            except Exception as e:
                print(f"LLM: failed to list assets for narrative payload: {e}")
        if self.session_info is not None:
            payload["session"] = dict(self.session_info)
        return payload

    def populate_room(self, world_state: dict) -> dict:
        """Generate room contents. Tries MCP bridge, then API, then fallback."""
        world_state = self._inject_available_assets(dict(world_state))
        if self._ws_connected and self._ws:
            result = self._populate_via_mcp(world_state)
            if result is not None:
                return result

        if self.api_client:
            return self._populate_via_api(world_state)

        print("LLM: No backend, returning fallback room")
        return copy.deepcopy(FALLBACK_ROOM)

    def _populate_via_mcp(self, world_state: dict) -> dict | None:
        """Send request through MCP bridge, wait for Claude Code to respond."""
        request_id = str(uuid.uuid4())

        with self._pending_lock:
            self._pending[request_id] = None

        # Send room request
        self._ws.send(json.dumps({  # type: ignore
            "type": "room_request",
            "request_id": request_id,
            "world_state": world_state,
        }))

        print(f"LLM: Room request sent via MCP bridge (id={request_id[:8]}...)")

        # Wait for response with timeout
        start = time.time()
        while time.time() - start < self.timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    validated = validate_room_response(result)
                    print(f"LLM: Room received via MCP ({len(validated['objects'])} objects, "
                          f"{time.time() - start:.1f}s)")
                    return validated
            time.sleep(0.1)

        # Timeout
        with self._pending_lock:
            self._pending.pop(request_id, None)

        print(f"LLM: MCP bridge timeout ({self.timeout}s)")
        return None

    def generate_room(self, world_state: dict) -> dict:
        """Generate extended room data. Tries MCP bridge, then API, then fallback."""
        world_state = self._inject_available_assets(dict(world_state))
        if self._ws_connected and self._ws:
            result = self._generate_via_mcp(world_state)
            if result is not None:
                return result

        if self.api_client:
            return self._generate_via_api(world_state)

        print("LLM: No backend, returning fallback extended room")
        return copy.deepcopy(FALLBACK_EXTENDED_ROOM)

    def generate_scene(self, scene_request: dict) -> dict:
        """Generate an outdoor scene from premise + setting. Tries MCP, then API, then fallback."""
        scene_request = self._inject_available_assets(dict(scene_request))
        if self._ws_connected and self._ws:
            result = self._generate_scene_via_mcp(scene_request)
            if result is not None:
                return result

        if self.api_client:
            return self._generate_scene_via_api(scene_request)

        print("LLM: No backend, returning minimal outdoor scene")
        return self._fallback_scene(scene_request)

    def _generate_scene_via_mcp(self, scene_request: dict) -> dict | None:
        """Send scene generation request through MCP bridge."""
        request_id = str(uuid.uuid4())

        with self._pending_lock:
            self._pending[request_id] = None

        self._ws.send(json.dumps({  # type: ignore
            "type": "room_request",
            "request_id": request_id,
            "world_state": scene_request,
            "format": "scene",
        }))

        print(f"LLM: Scene request via MCP (id={request_id[:8]}...)")

        start = time.time()
        while time.time() - start < self.timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    validated = validate_scene_response(result)
                    print(f"LLM: Scene via MCP ({len(validated.get('objects', []))} objects, "
                          f"{time.time() - start:.1f}s)")
                    return validated
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: MCP scene timeout ({self.timeout}s)")
        return None

    def _generate_scene_via_api(self, scene_request: dict) -> dict:
        """Call Claude API directly with generate_scene tool."""
        premise = scene_request.get("premise", "")
        setting = scene_request.get("setting", {})

        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=4096,
                system=GENERATE_SCENE_SYSTEM_PROMPT,
                tools=[GENERATE_SCENE_TOOL],
                tool_choice={"type": "tool", "name": "generate_scene"},
                messages=[{
                    "role": "user",
                    "content": (
                        f"Generate an outdoor scene for this setting:\n\n"
                        f"PREMISE:\n{premise}\n\n"
                        f"SETTING:\n{json.dumps(setting, indent=2)}\n\n"
                        f"SCENE DESCRIPTION:\n{scene_request.get('scene_description', 'an outdoor area')}\n\n"
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

            print("LLM: No tool call in scene API response, using fallback")
            return self._fallback_scene(scene_request)

        except Exception as e:
            print(f"LLM: API scene error ({e}), using fallback")
            return self._fallback_scene(scene_request)

    @staticmethod
    def _fallback_scene(scene_request: dict) -> dict:
        """Minimal outdoor fallback scene."""
        return {
            "room_id": "fallback_scene",
            "room_description": "Un paraje abierto y desolado.",
            "zone_type": "outdoor",
            "dimensions": {"width": 60.0, "height": 30.0, "depth": 60.0},
            "terrain": {"type": "static", "texture_prompt": "grass and dirt, medieval, seamless"},
            "sky": {"time_of_day": "day"},
            "fog": {"enabled": False},
            "lighting": {
                "ambient": {"color": [0.15, 0.12, 0.1], "intensity": 0.4},
                "lights": [],
            },
            "objects": [],
            "npcs": [],
            "exits": [],
            "ambient_event": "El viento sopla entre la hierba.",
        }

    def _generate_via_mcp(self, world_state: dict) -> dict | None:
        """Send extended room request through MCP bridge."""
        request_id = str(uuid.uuid4())

        with self._pending_lock:
            self._pending[request_id] = None

        self._ws.send(json.dumps({  # type: ignore
            "type": "room_request",
            "request_id": request_id,
            "world_state": world_state,
            "format": "extended",
        }))

        print(f"LLM: Extended room request via MCP (id={request_id[:8]}...)")

        start = time.time()
        while time.time() - start < self.timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    validated = validate_extended_room_response(result)
                    print(f"LLM: Extended room via MCP ({len(validated['objects'])} objects, "
                          f"{time.time() - start:.1f}s)")
                    return validated
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: MCP timeout ({self.timeout}s)")
        return None

    def _generate_via_api(self, world_state: dict) -> dict:
        """Call Claude API directly with generate_room tool."""
        entry_wall = world_state.get("entry_wall", "south")
        target_hint = world_state.get("target_hint", "a new chamber")

        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=2048,
                system=NARRATIVE_SYSTEM_PROMPT_V2,
                tools=[GENERATE_ROOM_TOOL],
                tool_choice={"type": "tool", "name": "generate_room"},
                messages=[{
                    "role": "user",
                    "content": (
                        f"Generate a room. The player enters from the {entry_wall} wall.\n"
                        f"Expected room theme: {target_hint}\n\n"
                        f"World state:\n{json.dumps(world_state, indent=2)}"
                    ),
                }],
            )

            for block in response.content:
                if block.type == "tool_use" and block.name == "generate_room":
                    result = validate_extended_room_response(block.input)
                    print(f"LLM: Extended room via API ({len(result['objects'])} objects, "
                          f"{len(result.get('npcs', []))} npcs)")
                    return result

            print("LLM: No tool call in API response, using fallback")
            return copy.deepcopy(FALLBACK_EXTENDED_ROOM)

        except Exception as e:
            print(f"LLM: API error ({e}), using fallback extended room")
            return copy.deepcopy(FALLBACK_EXTENDED_ROOM)

    def _populate_via_api(self, world_state: dict) -> dict:
        """Call Claude API directly with tool_use."""
        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=1024,
                system=NARRATIVE_SYSTEM_PROMPT,
                tools=[POPULATE_ROOM_TOOL],
                tool_choice={"type": "tool", "name": "populate_room"},
                messages=[{
                    "role": "user",
                    "content": (
                        "The player enters a new room. Generate its contents.\n\n"
                        f"World state:\n{json.dumps(world_state, indent=2)}"
                    ),
                }],
            )

            for block in response.content:
                if block.type == "tool_use" and block.name == "populate_room":
                    result = validate_room_response(block.input)
                    print(f"LLM: Room generated via API ({len(result['objects'])} objects)")
                    return result

            print("LLM: No tool call in API response, using fallback")
            return copy.deepcopy(FALLBACK_ROOM)

        except Exception as e:
            print(f"LLM: API error ({e}), using fallback room")
            return copy.deepcopy(FALLBACK_ROOM)

    # ------------------------------------------------------------------
    # Vision: weapon orientation
    # ------------------------------------------------------------------

    def analyze_weapon(
        self,
        images: list,
        weapon_type: str = "generic",
        kind: str = "weapon_orient",
        context: dict | None = None,
    ) -> dict | None:
        """Send weapon images to Claude and get back orientation vectors.

        Returns None if no backend can handle the request — caller should
        fall back to a heuristic placement.
        """
        context = context or {}
        if not images:
            return None

        if self._ws_connected and self._ws:
            result = self._analyze_weapon_via_mcp(images, weapon_type, kind, context)
            if result is not None:
                return result

        if self.api_client:
            return self._analyze_weapon_via_api(images, weapon_type, kind, context)

        print("LLM: No vision backend available")
        return None

    def _analyze_weapon_via_mcp(
        self,
        images: list,
        weapon_type: str,
        kind: str,
        context: dict,
    ) -> dict | None:
        request_id = str(uuid.uuid4())
        with self._pending_lock:
            self._pending[request_id] = None

        try:
            self._ws.send(json.dumps({  # type: ignore
                "type": "vision_request",
                "request_id": request_id,
                "kind": kind,
                "weapon_type": weapon_type,
                "images": images,
                "context": context,
            }))
        except Exception as e:
            print(f"LLM: Vision MCP send failed ({e})")
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return None

        print(f"LLM: Vision request sent via MCP (id={request_id[:8]}, type={weapon_type})")

        # Vision generation gets a longer timeout
        timeout = max(self.timeout, 180.0)
        start = time.time()
        while time.time() - start < timeout:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    # Check for explicit no-listener error from the bridge
                    if isinstance(result, dict) and result.get("error") == "no_mcp_listener":
                        reason = result.get("reason", "unknown")
                        msg = result.get("message", "")
                        print(f"LLM: Vision MCP rejected — {reason}")
                        if msg:
                            print(f"LLM:   {msg}")
                        return None
                    validated = validate_weapon_orient_response(result)
                    if validated is None:
                        print("LLM: Vision response failed validation")
                        return None
                    print(f"LLM: Vision response received ({time.time() - start:.1f}s, "
                          f"confidence={validated.get('confidence', 0):.2f})")
                    return validated
            time.sleep(0.1)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        print(f"LLM: Vision MCP timeout ({timeout}s)")
        return None

    def _analyze_weapon_via_api(
        self,
        images: list,
        weapon_type: str,
        kind: str,
        context: dict,
    ) -> dict | None:
        if not self.api_client:
            return None

        # Build user content: text + images interleaved with view labels
        content: list = [{
            "type": "text",
            "text": (
                f"Weapon type hint: {weapon_type}\n"
                f"Number of views: {len(images)}\n\n"
                "Examine the views (front, side, top in order) and respond via the "
                "orient_weapon tool."
            ),
        }]
        for img in images:
            data_b64 = img.get("data_b64") if isinstance(img, dict) else None
            if not data_b64:
                continue
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.get("media_type", "image/png"),
                    "data": data_b64,
                },
            })
            content.append({
                "type": "text",
                "text": f"View: {img.get('view', 'unknown')}",
            })

        try:
            response = self.api_client.messages.create(  # type: ignore
                model=self.model,
                max_tokens=1024,
                system=WEAPON_ORIENT_SYSTEM_PROMPT,
                tools=[WEAPON_ORIENT_TOOL],
                tool_choice={"type": "tool", "name": "orient_weapon"},
                messages=[{"role": "user", "content": content}],
            )
            for block in response.content:
                if block.type == "tool_use" and block.name == "orient_weapon":
                    validated = validate_weapon_orient_response(block.input)
                    if validated is None:
                        print("LLM: Vision API response failed validation")
                        return None
                    print(f"LLM: Vision API response (confidence="
                          f"{validated.get('confidence', 0):.2f})")
                    return validated
        except Exception as e:
            print(f"LLM: Vision API error ({e})")
            return None

        print("LLM: Vision API gave no tool_use response")
        return None

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
        and return its consequences. Tries MCP bridge first, then API.

        Returns dict {consequences: [...]} (possibly empty)."""
        # Always inject session+assets so Claude has full context
        context = self._inject_available_assets(dict(context))
        if self._ws_connected and self._ws:
            result = self._report_choice_via_mcp(event_id, speaker, chosen_text, free_text, context)
            if result is not None:
                return result
        if self.api_client:
            result = self._report_choice_via_api(event_id, speaker, chosen_text, free_text, context)
            if result is not None:
                return result
        # No backend reachable — empty consequences (degrades gracefully)
        return {"consequences": []}

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

        # Same long timeout as vision — Claude may take a moment to think
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
            for block in response.content:
                if block.type == "tool_use" and block.name == "react_to_player":
                    validated = validate_narrative_reaction(block.input)
                    print(f"LLM: narrative reaction via API ({len(validated['consequences'])} consequences)")
                    return validated
        except Exception as e:
            print(f"LLM: react_to_player API error ({e})")
            return None
        return {"consequences": []}

    # ------------------------------------------------------------------
    # Bridge status probe
    # ------------------------------------------------------------------

    def has_api_fallback(self) -> bool:
        """True if a direct Anthropic API client is available as fallback."""
        return self.api_client is not None

    def get_bridge_status(self) -> dict:
        """Query the MCP bridge for its current state without sending a real request.

        Returns a dict with at least:
            connected: bool
            listener_active: bool         (if connected)
            listener_ever_connected: bool (if connected)
            last_listen_seconds_ago: float (if connected; -1 if never)
        """
        if not self._ws_connected or not self._ws:
            return {"connected": False}

        request_id = str(uuid.uuid4())
        with self._pending_lock:
            self._pending[request_id] = None

        try:
            self._ws.send(json.dumps({  # type: ignore
                "type": "bridge_status_request",
                "request_id": request_id,
            }))
        except Exception as e:
            print(f"LLM: bridge_status send failed ({e})")
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return {"connected": False, "error": "send failed"}

        # Quick wait for response (bridge replies synchronously, ~1ms)
        start = time.time()
        while time.time() - start < 2.0:
            with self._pending_lock:
                result = self._pending.get(request_id)
                if result is not None:
                    del self._pending[request_id]
                    return {"connected": True, **result}
            time.sleep(0.02)

        with self._pending_lock:
            self._pending.pop(request_id, None)
        return {"connected": True, "error": "timeout"}
