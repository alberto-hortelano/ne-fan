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
    FALLBACK_ROOM,
    FALLBACK_EXTENDED_ROOM,
    validate_room_response,
    validate_extended_room_response,
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
    ):
        self.model = model
        self.mcp_ws_url = mcp_ws_url
        self.timeout = timeout

        # Pending responses from MCP bridge
        self._pending: dict[str, dict | None] = {}
        self._pending_lock = threading.Lock()
        self._ws: "websocket.WebSocketApp | None" = None
        self._ws_connected = False

        # Try MCP bridge first
        if HAS_WEBSOCKET:
            self._try_connect_mcp()

        # Fallback to direct API
        self.api_client = None
        if not self._ws_connected and HAS_ANTHROPIC:
            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if api_key:
                self.api_client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
                print("LLM: Using Claude API direct mode")

        if not self._ws_connected and not self.api_client:
            print("LLM: No backend available. Install websocket-client for MCP bridge, "
                  "or set ANTHROPIC_API_KEY. Will use fallback rooms.")

    def _try_connect_mcp(self) -> None:
        """Connect to narrative-mcp WebSocket bridge."""
        import websocket as ws_module

        def on_message(ws: "websocket.WebSocket", message: str) -> None:
            try:
                msg = json.loads(message)
                if msg.get("type") == "room_response":
                    req_id = msg["request_id"]
                    with self._pending_lock:
                        if req_id in self._pending:
                            self._pending[req_id] = msg["room_data"]
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
            ws_thread = threading.Thread(target=self._ws.run_forever, daemon=True)
            ws_thread.start()

            # Wait briefly for connection
            for _ in range(10):
                if self._ws_connected:
                    return
                time.sleep(0.1)

            if not self._ws_connected:
                print("LLM: narrative-mcp bridge not available (is it running?)")
        except Exception as e:
            print(f"LLM: Failed to connect to MCP bridge: {e}")

    def populate_room(self, world_state: dict) -> dict:
        """Generate room contents. Tries MCP bridge, then API, then fallback."""
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
        if self._ws_connected and self._ws:
            result = self._generate_via_mcp(world_state)
            if result is not None:
                return result

        if self.api_client:
            return self._generate_via_api(world_state)

        print("LLM: No backend, returning fallback extended room")
        return copy.deepcopy(FALLBACK_EXTENDED_ROOM)

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
