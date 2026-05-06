#!/usr/bin/env bash
# Never Ending Fantasy — interactive launcher (TUI).
# Run without arguments. Use ↑/↓ to navigate, → to fine-tune which services
# launch, ← to go back, Space to toggle a service, Enter to launch, q to quit.

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
    have_cmd tput || missing+=("tput (ncurses) — sudo apt install ncurses-bin")

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

# ─── Service catalogue + presets ───────────────────────────────
#
# Single source of truth for which services exist and what each preset
# turns on. The TUI reads from these arrays, the launcher runs them in
# topological order.

# Service slot index → key
SERVICES=(bridge narrative-mcp ai_server godot godot-headless html)
# Service slot index → display label
SERVICE_LABELS=(
    "bridge          :9877"
    "narrative-mcp   :3737"
    "ai_server       :8765"
    "Godot"
    "Godot headless (xvfb)"
    "HTML            :3000"
)
# Service slot index → one-line hint
SERVICE_HINTS=(
    "shared TS logic + WebSocket"
    "MCP bridge to Claude Code"
    "Python LLM/asset server"
    "3D client window"
    "Godot under xvfb (no window)"
    "2D browser client"
)

# Mutually exclusive pairs (space-separated indices in a single string).
# Toggling one in the TUI deactivates its sibling.
EXCLUSIVE_PAIRS=("3 4")  # godot vs godot-headless

# Presets: each entry is a name, a description, and a 6-element bitmask
# (1 = service active) in the SERVICES order.
PRESET_NAMES=(
    "Play"
    "Automated tests"
    "HTML 2D iteration"
    "Godot offline"
    "Bridge only"
    "ai_server only"
    "Custom"
)
PRESET_DESCS=(
    "Full stack + Claude Code narrative"
    "bridge + Godot headless (movement_test.py et al.)"
    "bridge + HTML (no AI generation)"
    "Just Godot — fallback rooms only"
    "Just nefan-core bridge"
    "Just the Python AI server"
    "Whatever you have selected"
)
#                  bridge  narr  ai  god  hl  html
PRESET_PROFILES=(
    "1 1 1 1 0 1"   # Play
    "1 0 0 0 1 0"   # Automated tests
    "1 0 0 0 0 1"   # HTML 2D iteration
    "0 0 0 1 0 0"   # Godot offline
    "1 0 0 0 0 0"   # Bridge only
    "0 0 1 0 0 0"   # ai_server only
    "0 0 0 0 0 0"   # Custom (filled in from current selection)
)

# Live state — applied by TUI, consumed by launcher.
declare -a ACTIVE=(0 0 0 0 0 0)

apply_preset() {
    local idx=$1
    if (( idx < 0 || idx >= ${#PRESET_NAMES[@]} )); then return; fi
    if (( idx == ${#PRESET_NAMES[@]} - 1 )); then
        # Custom: keep current selection
        return
    fi
    local mask="${PRESET_PROFILES[$idx]}"
    local i=0
    for bit in $mask; do
        ACTIVE[$i]=$bit
        ((i++))
    done
}

apply_exclusivity() {
    # When two slots in an exclusive pair are both 1, keep only `keep_idx`.
    local keep_idx=$1
    local pair other
    for pair in "${EXCLUSIVE_PAIRS[@]}"; do
        local a="${pair% *}" b="${pair#* }"
        if [[ $keep_idx == "$a" && ${ACTIVE[$a]} -eq 1 && ${ACTIVE[$b]} -eq 1 ]]; then
            ACTIVE[$b]=0
        elif [[ $keep_idx == "$b" && ${ACTIVE[$a]} -eq 1 && ${ACTIVE[$b]} -eq 1 ]]; then
            ACTIVE[$a]=0
        fi
    done
}

# ─── TUI: input + render ───────────────────────────────────────

read_key() {
    local k1="" k2="" k3=""
    IFS= read -rsn1 k1
    if [[ $k1 == $'\e' ]]; then
        IFS= read -rsn1 -t 0.01 k2 2>/dev/null
        IFS= read -rsn1 -t 0.01 k3 2>/dev/null
        case "$k2$k3" in
            '[A') printf "UP"    ; return ;;
            '[B') printf "DOWN"  ; return ;;
            '[C') printf "RIGHT" ; return ;;
            '[D') printf "LEFT"  ; return ;;
            '')   printf "ESC"   ; return ;;
        esac
        printf "ESC"; return
    fi
    case "$k1" in
        $'\n'|$'\r'|'') printf "ENTER" ; return ;;
        ' ')            printf "SPACE" ; return ;;
        q|Q)            printf "QUIT"  ; return ;;
        s|S)            printf "STATUS"; return ;;
        k|K)            printf "STOP"  ; return ;;
        *)              printf "OTHER:%s" "$k1" ;;
    esac
}

# Init terminal capabilities once.
TUI_BOLD=""
TUI_REV=""
TUI_DIM=""
TUI_RESET=""
TUI_CIVIS=""
TUI_CNORM=""
TUI_CLEAR=""
TUI_CUP00=""
TUI_ED=""
init_tput() {
    TUI_BOLD=$(tput bold 2>/dev/null || true)
    TUI_REV=$(tput rev 2>/dev/null || true)
    TUI_DIM=$(tput dim 2>/dev/null || true)
    TUI_RESET=$(tput sgr0 2>/dev/null || true)
    TUI_CIVIS=$(tput civis 2>/dev/null || true)
    TUI_CNORM=$(tput cnorm 2>/dev/null || true)
    TUI_CLEAR=$(tput clear 2>/dev/null || true)
    TUI_CUP00=$(tput cup 0 0 2>/dev/null || true)
    TUI_ED=$(tput ed 2>/dev/null || true)
}

render_menu() {
    local mode=$1 preset_idx=$2 service_idx=$3
    # Move to home + clear-to-end-of-display (less flicker than tput clear)
    printf "%s%s" "$TUI_CUP00" "$TUI_ED"

    printf "%s╭─ Never Ending Fantasy launcher ───────────────────────────────╮%s\n" "$TUI_BOLD" "$TUI_RESET"
    printf "\n"

    # Column headers
    if [[ $mode == "presets" ]]; then
        printf "  %sPresets%s                       %sServices for this preset%s\n" "$TUI_BOLD" "$TUI_RESET" "$TUI_DIM" "$TUI_RESET"
    else
        printf "  %s(presets — press ←)%s          %sServices to launch%s\n" "$TUI_DIM" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET"
    fi
    printf "\n"

    local n_presets=${#PRESET_NAMES[@]}
    local n_services=${#SERVICES[@]}
    local rows=$n_presets
    (( n_services > rows )) && rows=$n_services

    local i
    for ((i=0; i<rows; i++)); do
        # Left column: presets
        local left_text="" left=""
        if (( i < n_presets )); then
            left_text="${PRESET_NAMES[$i]}"
            if [[ $mode == "presets" ]]; then
                if (( i == preset_idx )); then
                    left=$(printf "%s▶ %-22s%s" "$TUI_REV" "$left_text" "$TUI_RESET")
                else
                    left=$(printf "  %-22s" "$left_text")
                fi
            else
                # Dim the presets while in services mode, but highlight the current one.
                if (( i == preset_idx )); then
                    left=$(printf "%s  %-22s%s" "$TUI_DIM" "$left_text" "$TUI_RESET")
                else
                    left=$(printf "%s  %-22s%s" "$TUI_DIM" "$left_text" "$TUI_RESET")
                fi
            fi
        else
            left=$(printf "  %-22s" "")
        fi
        printf "  %b   " "$left"

        # Right column: services
        if (( i < n_services )); then
            local mark="[ ]"
            (( ${ACTIVE[$i]} == 1 )) && mark="[✓]"
            local label="${SERVICE_LABELS[$i]}"
            if [[ $mode == "services" && $i == "$service_idx" ]]; then
                printf "%s▶ %s %s%s" "$TUI_REV" "$mark" "$label" "$TUI_RESET"
            else
                printf "  %s %s" "$mark" "$label"
            fi
        fi
        printf "\n"
    done

    printf "\n"

    # Description of the highlighted preset / service
    if [[ $mode == "presets" ]]; then
        printf "  %s▸ %s%s\n" "$TUI_DIM" "${PRESET_DESCS[$preset_idx]}" "$TUI_RESET"
    else
        if (( service_idx < ${#SERVICE_HINTS[@]} )); then
            printf "  %s▸ %s%s\n" "$TUI_DIM" "${SERVICE_HINTS[$service_idx]}" "$TUI_RESET"
        else
            printf "\n"
        fi
    fi

    printf "\n"
    printf "%s╰───────────────────────────────────────────────────────────────╯%s\n" "$TUI_BOLD" "$TUI_RESET"

    if [[ $mode == "presets" ]]; then
        printf "  %s↑/↓%s navigate   %s→%s edit services   %sEnter%s launch   %ss%s status   %sk%s stop   %sq%s quit\n" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET"
    else
        printf "  %s↑/↓%s navigate   %sSpace%s toggle   %s←%s presets   %sEnter%s launch   %sq%s quit\n" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET"
    fi
}

# Save terminal state so we can restore it on exit.
TTY_SAVED_STTY=""
tui_enter() {
    init_tput
    if [[ -t 0 ]]; then
        TTY_SAVED_STTY=$(stty -g 2>/dev/null || true)
        stty -echo -icanon time 0 min 1 2>/dev/null || true
    fi
    printf "%s%s" "$TUI_CIVIS" "$TUI_CLEAR"
}

tui_leave() {
    printf "%s" "$TUI_CNORM"
    if [[ -n "$TTY_SAVED_STTY" ]]; then
        stty "$TTY_SAVED_STTY" 2>/dev/null || true
        TTY_SAVED_STTY=""
    fi
}

# Returns via globals: ACTIVE[] (which services to start) and TUI_NEEDS_PAUSE.
TUI_NEEDS_PAUSE=0
TUI_RESULT=""   # "launch" or "quit"
run_tui() {
    if [[ ! -t 0 || ! -t 1 ]]; then
        echo "❌ This launcher needs an interactive terminal."
        echo "   stdin/stdout must be a TTY. Aborting."
        TUI_RESULT="quit"
        return 1
    fi

    local mode="presets"
    local preset_idx=0
    local service_idx=0
    apply_preset 0

    tui_enter
    # Make sure we always restore the terminal even on hard exits.
    trap 'tui_leave; cleanup' EXIT INT TERM

    while true; do
        render_menu "$mode" "$preset_idx" "$service_idx"
        local key
        key=$(read_key)
        case "$mode" in
            presets)
                case "$key" in
                    UP)
                        if (( preset_idx > 0 )); then
                            ((preset_idx--))
                            apply_preset "$preset_idx"
                        fi
                        ;;
                    DOWN)
                        if (( preset_idx < ${#PRESET_NAMES[@]} - 1 )); then
                            ((preset_idx++))
                            apply_preset "$preset_idx"
                        fi
                        ;;
                    RIGHT)
                        apply_preset "$preset_idx"
                        mode="services"
                        service_idx=0
                        ;;
                    ENTER)
                        apply_preset "$preset_idx"
                        TUI_RESULT="launch"
                        break
                        ;;
                    STATUS)
                        tui_leave
                        cmd_status
                        echo ""
                        read -rp "  press Enter to return to the menu... " _
                        tui_enter
                        ;;
                    STOP)
                        tui_leave
                        cmd_stop
                        echo ""
                        read -rp "  press Enter to return to the menu... " _
                        tui_enter
                        ;;
                    QUIT|ESC)
                        TUI_RESULT="quit"
                        break
                        ;;
                esac
                ;;
            services)
                case "$key" in
                    UP)
                        (( service_idx > 0 )) && ((service_idx--))
                        ;;
                    DOWN)
                        (( service_idx < ${#SERVICES[@]} - 1 )) && ((service_idx++))
                        ;;
                    SPACE)
                        ACTIVE[$service_idx]=$(( 1 - ACTIVE[$service_idx] ))
                        if (( ACTIVE[service_idx] == 1 )); then
                            apply_exclusivity "$service_idx"
                        fi
                        # Switch the preset to "Custom" since the user diverged.
                        preset_idx=$(( ${#PRESET_NAMES[@]} - 1 ))
                        ;;
                    LEFT)
                        mode="presets"
                        ;;
                    ENTER)
                        TUI_RESULT="launch"
                        break
                        ;;
                    QUIT|ESC)
                        TUI_RESULT="quit"
                        break
                        ;;
                esac
                ;;
        esac
    done

    tui_leave
    # Decide if Claude Code pause is needed: narrative-mcp active AND a
    # downstream consumer (ai_server / a renderer) is also active.
    TUI_NEEDS_PAUSE=0
    if (( ACTIVE[1] == 1 )); then
        TUI_NEEDS_PAUSE=1
    fi
}

# ─── Launch in topological order ───────────────────────────────

run_selection() {
    local any_selected=0
    local s
    for s in "${ACTIVE[@]}"; do (( s == 1 )) && any_selected=1; done
    if (( any_selected == 0 )); then
        echo "  Nothing selected. Bye."
        return 0
    fi

    echo ""
    echo "▶ Launching selected services..."
    echo ""

    # Order: bridge → narrative-mcp → ai_server → (Claude pause) → godot/headless → html
    (( ACTIVE[0] == 1 )) && { start_bridge        || return 1; }
    (( ACTIVE[1] == 1 )) && { start_narrative_mcp || return 1; }
    (( ACTIVE[2] == 1 )) && { start_ai            || return 1; }

    # Pause for Claude Code if the user activated narrative-mcp.
    if (( TUI_NEEDS_PAUSE == 1 )); then
        pause_for_claude_code
    fi

    (( ACTIVE[3] == 1 )) && { start_godot          || return 1; }
    (( ACTIVE[4] == 1 )) && { start_godot_headless || return 1; }
    (( ACTIVE[5] == 1 )) && { start_html           || return 1; }

    # Hint for headless tests
    if (( ACTIVE[4] == 1 )); then
        cat <<EOF

  Now you can run for example:
    python3 godot/tools/movement_test.py
    python3 godot/tools/anim_debug.py medium --angles side
EOF
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
    wait
}

# ─── Cleanup trap ──────────────────────────────────────────────

cleanup() {
    tui_leave
    local pid
    if (( ${#STARTED_PIDS[@]} > 0 )); then
        echo ""
        echo "🧹 cleaning up child processes..."
        for pid in "${STARTED_PIDS[@]}"; do
            kill "$pid" 2>/dev/null
        done
        local p
        for p in "$PORT_BRIDGE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML"; do
            port_busy "$p" && kill_port "$p"
        done
        pkill -f "Godot_v4.6" 2>/dev/null
    fi
}
trap cleanup EXIT INT TERM

# ─── Entry point ───────────────────────────────────────────────

if (( $# > 0 )); then
    cat <<'EOF'
ℹ️  start.sh no longer takes arguments — it's interactive now.
   Old modes (godot, bridge, html, ai, narrative, headless, all) live
   on as numbered presets in the TUI.
EOF
fi

preflight
run_tui
case "$TUI_RESULT" in
    launch) run_selection ;;
    quit|*) exit 0 ;;
esac
