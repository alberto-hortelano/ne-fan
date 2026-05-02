#!/usr/bin/env bash
# Never Ending Fantasy — interactive launcher.
# Run without arguments. Pick a preset from the menu.
#
# Presets honour service dependencies (wait_for_port instead of blind sleeps),
# pause for Claude Code MCP setup when the narrative engine is involved, and
# clean up child processes on Ctrl+C via a trap.

set -uo pipefail

GODOT_BIN="${GODOT_BIN:-$HOME/Downloads/Godot_v4.6.1-stable_linux.x86_64}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${NEFAN_LOG_DIR:-/tmp}"
SAVES_DIR_NEW="${NEFAN_SAVES_DIR:-$PROJECT_DIR/saves}"
SAVES_DIR_OLD="$HOME/.local/share/godot/app_userdata/Never Ending Fantasy/saves"

PORT_BRIDGE=9877
PORT_HTML=3000
PORT_AI=8765
PORT_NARR=3737
PORT_REMOTE=9876

declare -a STARTED_PIDS=()

# ─── Utilities ─────────────────────────────────────────────────

have_cmd()  { command -v "$1" >/dev/null 2>&1; }
port_busy() { fuser "$1/tcp" >/dev/null 2>&1; }
kill_port() { fuser -k "$1/tcp" 2>/dev/null; sleep 0.5; }

wait_for_port() {
    local port=$1 timeout=${2:-30} label=${3:-port}
    local i=0
    while (( i < timeout )); do
        if nc -z localhost "$port" 2>/dev/null; then
            return 0
        fi
        sleep 1
        ((i++))
    done
    echo "❌ $label did not come up on :$port within ${timeout}s"
    return 1
}

wait_for_http_health() {
    local url=$1 timeout=${2:-60} label=${3:-service}
    local i=0
    while (( i < timeout )); do
        if curl -sf "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        ((i++))
    done
    echo "❌ $label /health did not respond within ${timeout}s ($url)"
    return 1
}

# ─── Preflight ─────────────────────────────────────────────────

preflight() {
    local missing=()
    [[ -x "$GODOT_BIN" ]] || missing+=("Godot binary not executable at $GODOT_BIN — set GODOT_BIN env var to override")
    [[ -d "$PROJECT_DIR/.venv" ]] || missing+=("Python venv missing — python -m venv .venv && source .venv/bin/activate && pip install -r ai_server/requirements.txt")
    [[ -d "$PROJECT_DIR/nefan-core/node_modules" ]] || missing+=("nefan-core deps — cd nefan-core && npm install")
    [[ -d "$PROJECT_DIR/nefan-html/node_modules" ]] || missing+=("nefan-html deps — cd nefan-html && npm install")
    [[ -d "$PROJECT_DIR/narrative-mcp/node_modules" ]] || missing+=("narrative-mcp deps — cd narrative-mcp && npm install")
    have_cmd nc   || missing+=("netcat (nc) — sudo apt install netcat-openbsd")
    have_cmd curl || missing+=("curl — sudo apt install curl")

    if (( ${#missing[@]} )); then
        echo "❌ Preflight failed:"
        printf '   - %s\n' "${missing[@]}"
        exit 1
    fi

    if [[ -d "$SAVES_DIR_OLD" ]]; then
        local has_legacy=0
        if compgen -G "$SAVES_DIR_OLD/*/state.json" >/dev/null; then
            has_legacy=1
        fi
        local new_empty=1
        if [[ -d "$SAVES_DIR_NEW" ]] && [[ -n "$(ls -A "$SAVES_DIR_NEW" 2>/dev/null)" ]]; then
            new_empty=0
        fi
        if (( has_legacy == 1 )) && (( new_empty == 1 )); then
            echo "📦 Legacy saves found at:"
            echo "   $SAVES_DIR_OLD"
            read -rp "   Migrate to '$SAVES_DIR_NEW'? [Y/n]: " ans
            if [[ ! "$ans" =~ ^[Nn] ]]; then
                bash "$PROJECT_DIR/tools/migrate_saves.sh" || echo "   (migration script returned non-zero)"
            fi
        fi
    fi
}

# ─── Service starters ──────────────────────────────────────────

start_bridge() {
    port_busy "$PORT_BRIDGE" && kill_port "$PORT_BRIDGE"
    ( cd "$PROJECT_DIR/nefan-core" && exec npx tsx bridge/ws-server.ts ) \
        >"$LOG_DIR/nefan-bridge.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_BRIDGE" 30 "bridge" || return 1
    echo "✅ bridge :$PORT_BRIDGE  (log: $LOG_DIR/nefan-bridge.log)"
}

start_narrative_mcp() {
    port_busy "$PORT_NARR" && kill_port "$PORT_NARR"
    if [[ ! -f "$PROJECT_DIR/narrative-mcp/dist/server.js" ]]; then
        echo "🛠  narrative-mcp: building..."
        ( cd "$PROJECT_DIR/narrative-mcp" && npm run build ) || return 1
    fi
    ( cd "$PROJECT_DIR/narrative-mcp" && exec node dist/server.js ) \
        >"$LOG_DIR/nefan-narrative.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_NARR" 20 "narrative-mcp" || return 1
    echo "✅ narrative-mcp :$PORT_NARR  (log: $LOG_DIR/nefan-narrative.log)"
}

start_ai() {
    port_busy "$PORT_AI" && kill_port "$PORT_AI"
    (
        cd "$PROJECT_DIR" || exit 1
        # shellcheck disable=SC1091
        source .venv/bin/activate
        exec python -u ai_server/main.py
    ) >"$LOG_DIR/nefan-ai.log" 2>&1 &
    STARTED_PIDS+=($!)
    echo "⏳ ai_server is loading models (takes ~30s on first run)..."
    wait_for_http_health "http://localhost:$PORT_AI/health" 120 "ai_server" || return 1
    echo "✅ ai_server :$PORT_AI  (log: $LOG_DIR/nefan-ai.log)"
}

start_godot() {
    pkill -f "Godot_v4.6" 2>/dev/null
    sleep 1
    ( exec "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility ) \
        >"$LOG_DIR/nefan-godot.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_REMOTE" 30 "Godot remote control" || return 1
    echo "✅ Godot (remote :$PORT_REMOTE)  (log: $LOG_DIR/nefan-godot.log)"
}

start_godot_headless() {
    pkill -f "Godot_v4.6" 2>/dev/null
    sleep 1
    have_cmd xvfb-run || { echo "❌ xvfb-run not found — sudo apt install xvfb"; return 1; }
    (
        exec xvfb-run --auto-servernum -s "-screen 0 1920x1080x24" \
            "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility
    ) >"$LOG_DIR/nefan-godot.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_REMOTE" 45 "Godot headless" || return 1
    echo "✅ Godot headless (remote :$PORT_REMOTE)  (log: $LOG_DIR/nefan-godot.log)"
}

start_html() {
    pkill -f "vite" 2>/dev/null
    sleep 1
    ( cd "$PROJECT_DIR/nefan-html" && exec npx vite --host ) \
        >"$LOG_DIR/nefan-html.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_HTML" 30 "HTML client" || return 1
    echo "✅ HTML client http://localhost:$PORT_HTML  (log: $LOG_DIR/nefan-html.log)"
}

# ─── Claude Code pause ─────────────────────────────────────────

has_anthropic_key() {
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] && return 0
    [[ -f "$PROJECT_DIR/.env" ]] && grep -q '^ANTHROPIC_API_KEY=' "$PROJECT_DIR/.env" && return 0
    return 1
}

pause_for_claude_code() {
    cat <<'EOF'

────────────────────────────────────────────────────────────────────────
🤖 Claude Code as narrative engine (MCP)

  To enable:
    1. Open ANOTHER terminal in this directory.
    2. Run:    claude
    3. When Claude Code is ready, paste this prompt:

       "Llama a narrative_listen en bucle y responde con el schema
        adecuado a cada tipo de request (room, weapon_orient,
        weapon_verify, narrative_event)."

  If you skip:
    · With ANTHROPIC_API_KEY set — ai_server falls back to direct API.
    · Without API key — fallback rooms (very limited gameplay).

────────────────────────────────────────────────────────────────────────
EOF
    while true; do
        read -rp "  [Enter] Claude Code is ready  |  [s] skip  |  [q] cancel: " ans
        case "$ans" in
            "")
                echo "▶ continuing with Claude Code"
                return 0
                ;;
            s|S)
                if has_anthropic_key; then
                    echo "▶ skipping MCP — ai_server will use direct ANTHROPIC_API_KEY"
                else
                    echo "⚠️  ANTHROPIC_API_KEY not detected — ai_server will use hardcoded fallback rooms."
                fi
                return 0
                ;;
            q|Q)
                echo "✋ cancelled by user"
                exit 0
                ;;
            *)
                echo "  unrecognised option"
                ;;
        esac
    done
}

# ─── Presets ───────────────────────────────────────────────────

preset_play() {
    echo "▶ preset: Play (full stack + Claude Code narrative)"
    start_bridge        || return 1
    start_narrative_mcp || return 1
    start_ai            || return 1
    pause_for_claude_code
    start_godot         || return 1
    start_html          || return 1
    follow_logs
}

preset_tests_headless() {
    echo "▶ preset: Automated tests (headless + bridge)"
    start_bridge         || return 1
    start_godot_headless || return 1
    cat <<EOF

  Now you can run for example:
    python3 godot/tools/movement_test.py
    python3 godot/tools/anim_debug.py medium --angles side
EOF
    follow_logs
}

preset_html_iter() {
    echo "▶ preset: HTML 2D iteration (bridge + html)"
    echo "  Note: ai_server is NOT started — for full narrative use the Play preset."
    start_bridge || return 1
    start_html   || return 1
    follow_logs
}

preset_godot_offline() {
    echo "▶ preset: Godot offline (no bridge, no AI)"
    start_godot || return 1
    follow_logs
}

preset_bridge_only() {
    echo "▶ preset: Bridge only (nefan-core dev)"
    start_bridge || return 1
    follow_logs
}

preset_ai_only() {
    echo "▶ preset: ai_server only (AI pipeline dev)"
    start_ai || return 1
    follow_logs
}

preset_custom() {
    echo "▶ preset: Custom (toggle each service)"
    local picks=()
    local svc
    for svc in bridge narrative-mcp ai_server godot godot-headless html; do
        read -rp "  start $svc? [y/N]: " ans
        [[ "$ans" =~ ^[Yy] ]] && picks+=("$svc")
    done
    if (( ${#picks[@]} == 0 )); then
        echo "  nothing selected"
        return 0
    fi
    # Topological order: bridge → narrative-mcp → ai_server → (pause) → godot → html
    local needs_pause=0
    [[ " ${picks[*]} " == *" narrative-mcp "* ]] && needs_pause=1
    local order=(bridge narrative-mcp ai_server godot godot-headless html)
    local started_ai=0
    for svc in "${order[@]}"; do
        if [[ " ${picks[*]} " == *" $svc "* ]]; then
            case "$svc" in
                bridge)         start_bridge        || return 1 ;;
                narrative-mcp)  start_narrative_mcp || return 1 ;;
                ai_server)      start_ai            || return 1; started_ai=1 ;;
                godot)
                    if (( needs_pause == 1 )) && (( started_ai == 1 )); then
                        pause_for_claude_code
                        needs_pause=0
                    fi
                    start_godot || return 1
                    ;;
                godot-headless)
                    if (( needs_pause == 1 )) && (( started_ai == 1 )); then
                        pause_for_claude_code
                        needs_pause=0
                    fi
                    start_godot_headless || return 1
                    ;;
                html)
                    if (( needs_pause == 1 )) && (( started_ai == 1 )); then
                        pause_for_claude_code
                        needs_pause=0
                    fi
                    start_html || return 1
                    ;;
            esac
        fi
    done
    # If narrative-mcp was selected but no client renderer pulled the pause yet,
    # offer it now so the user knows what to do.
    if (( needs_pause == 1 )); then
        pause_for_claude_code
    fi
    follow_logs
}

# ─── Status / Stop ─────────────────────────────────────────────

cmd_status() {
    echo ""
    echo "  Service status:"
    local pairs=(
        "bridge:$PORT_BRIDGE"
        "narrative-mcp:$PORT_NARR"
        "ai_server:$PORT_AI"
        "Godot remote:$PORT_REMOTE"
        "HTML:$PORT_HTML"
    )
    local pair name port
    for pair in "${pairs[@]}"; do
        name=${pair%:*}
        port=${pair#*:}
        if port_busy "$port"; then
            printf "    ✅  %-15s :%d\n" "$name" "$port"
        else
            printf "    ⬜  %-15s :%d\n" "$name" "$port"
        fi
    done
    if [[ -d "$SAVES_DIR_NEW" ]]; then
        local count
        count=$(find "$SAVES_DIR_NEW" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
        echo "    📦 saves: $SAVES_DIR_NEW ($count session(s))"
    else
        echo "    📦 saves: $SAVES_DIR_NEW (does not exist yet)"
    fi
    echo ""
}

cmd_stop() {
    echo "🛑 killing services..."
    local port
    for port in "$PORT_BRIDGE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML"; do
        if port_busy "$port"; then
            kill_port "$port"
            echo "    · :$port"
        fi
    done
    pkill -f "Godot_v4.6" 2>/dev/null && echo "    · Godot"
    pkill -f "vite"       2>/dev/null && echo "    · vite"
    echo "✅ stack cleaned"
}

# ─── Foreground wait ───────────────────────────────────────────

follow_logs() {
    cat <<EOF

  📜 Logs in $LOG_DIR/nefan-*.log
  Press Ctrl+C to stop everything that this launcher started.

EOF
    # Block until interrupted; trap handles cleanup.
    wait
}

# ─── Cleanup trap ──────────────────────────────────────────────

cleanup() {
    local pid
    if (( ${#STARTED_PIDS[@]} > 0 )); then
        echo ""
        echo "🧹 cleaning up child processes..."
        for pid in "${STARTED_PIDS[@]}"; do
            kill "$pid" 2>/dev/null
        done
        # Best-effort: kill anything still holding our ports.
        for port in "$PORT_BRIDGE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML"; do
            port_busy "$port" && kill_port "$port"
        done
        # And any orphaned Godot from headless mode (xvfb-run obscures the PID).
        pkill -f "Godot_v4.6" 2>/dev/null
    fi
}
trap cleanup EXIT INT TERM

# ─── Main menu ─────────────────────────────────────────────────

main_menu() {
    while true; do
        cat <<EOF

╭─────────────────────────────────────────────╮
│  Never Ending Fantasy — launcher            │
╰─────────────────────────────────────────────╯

  1) 🎮  Play (full stack + Claude Code narrative)
  2) 🔬  Automated tests (bridge + Godot headless)
  3) 🎨  HTML 2D iteration (bridge + html)
  ─────────────────────────────────────────────
  4) 🏛   Godot offline (fallback rooms only)
  5) 🔌  Bridge only (nefan-core dev)
  6) 🤖  ai_server only (AI pipeline dev)
  7) ⚙️   Custom (toggle each service)
  ─────────────────────────────────────────────
  s)  📊  Status
  k)  🛑  Stop everything
  q)  Quit
EOF
        read -rp "  Choice: " choice
        case "$choice" in
            1) preset_play; return ;;
            2) preset_tests_headless; return ;;
            3) preset_html_iter; return ;;
            4) preset_godot_offline; return ;;
            5) preset_bridge_only; return ;;
            6) preset_ai_only; return ;;
            7) preset_custom; return ;;
            s|S) cmd_status ;;
            k|K) cmd_stop ;;
            q|Q) exit 0 ;;
            *)   echo "  unrecognised option" ;;
        esac
    done
}

# ─── Entry point ───────────────────────────────────────────────

if (( $# > 0 )); then
    cat <<'EOF'
ℹ️  start.sh no longer takes arguments — it's interactive now.
   The previous modes (godot, bridge, html, ai, narrative, headless, all)
   are available as numbered presets in the menu.
EOF
fi

preflight
main_menu
