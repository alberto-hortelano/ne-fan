#!/bin/bash
# Start/restart Never Ending Fantasy
# Usage: ./start.sh [godot|bridge|html|ai|headless|all]

GODOT_BIN=~/Downloads/Godot_v4.6.1-stable_linux.x86_64
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-all}"

start_bridge() {
    fuser 9877/tcp 2>/dev/null | xargs -r kill
    sleep 1
    cd "$PROJECT_DIR/nefan-core"
    npx tsx bridge/ws-server.ts &
    echo "Bridge started on :9877"
}

start_narrative_mcp() {
    fuser 3737/tcp 2>/dev/null | xargs -r kill
    sleep 1
    cd "$PROJECT_DIR/narrative-mcp"
    if [ ! -f dist/server.js ]; then
        echo "narrative-mcp: building..."
        npm run build
    fi
    node dist/server.js >/tmp/narrative-mcp.log 2>&1 &
    echo "narrative-mcp WS bridge started on :3737 (log: /tmp/narrative-mcp.log)"
}

start_ai() {
    fuser 8765/tcp 2>/dev/null | xargs -r kill -9
    sleep 1
    cd "$PROJECT_DIR"
    source .venv/bin/activate
    python -u ai_server/main.py >/tmp/nefan_ai.log 2>&1 &
    echo "AI server started on :8765 (log: /tmp/nefan_ai.log, Meshy backend if MESHY_API_KEY set in .env)"
}

start_godot() {
    pkill -f "Godot_v4.6" 2>/dev/null
    sleep 1
    "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility &
    echo "Godot started"
}

start_godot_headless() {
    pkill -f "Godot_v4.6" 2>/dev/null
    sleep 1
    xvfb-run --auto-servernum "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility &
    echo "Godot started (headless via xvfb)"
}

start_html() {
    pkill -f "vite" 2>/dev/null
    sleep 1
    cd "$PROJECT_DIR/nefan-html"
    npx vite --host &
    echo "HTML client on http://localhost:3000"
}

case "$MODE" in
    godot)
        start_godot
        ;;
    bridge)
        start_bridge
        ;;
    ai)
        start_ai
        ;;
    narrative)
        start_narrative_mcp
        ;;
    html)
        start_html
        ;;
    all)
        start_bridge
        start_narrative_mcp
        sleep 3
        start_ai
        sleep 2
        start_godot
        start_html
        cat <<'EOF'

────────────────────────────────────────────────────────────────────────
[vision] To enable AI weapon orientation:
  Open another terminal in this directory and run:  claude
  Then tell that Claude session:
    "Please call narrative_listen in a loop and respond to vision_request
     messages by analyzing the images using the orient_weapon JSON schema."
  Without this, the weapon vision pipeline will fail-fast and the game
  will use the bbox heuristic fallback.
────────────────────────────────────────────────────────────────────────
EOF
        ;;
    headless)
        start_godot_headless
        ;;
    *)
        echo "Usage: ./start.sh [godot|bridge|ai|narrative|html|headless|all]"
        ;;
esac
