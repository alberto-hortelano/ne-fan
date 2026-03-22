#!/bin/bash
# Start/restart Never Ending Fantasy
# Usage: ./start.sh [godot|bridge|html|all]

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

start_godot() {
    pkill -f "Godot_v4.6" 2>/dev/null
    sleep 1
    "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility &
    echo "Godot started"
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
    html)
        start_html
        ;;
    all)
        start_bridge
        sleep 3
        start_godot
        start_html
        ;;
    *)
        echo "Usage: ./start.sh [godot|bridge|html|all]"
        ;;
esac
