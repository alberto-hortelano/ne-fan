#!/usr/bin/env bash
# Never Ending Fantasy — interactive launcher (TUI).
# Run without arguments. Use ↑/↓ to navigate, → to fine-tune which services
# launch, ← to go back, Space to toggle a service, Enter to launch,
# s = status, k = stop everything, q to quit.
# Env: GODOT_BIN, NEFAN_LOG_DIR, NEFAN_SAVES_DIR, NEFAN_GAMES_DIR (bench),
#      NEFAN_EAGER_BIND=0 (no arrancar narrative-mcp: el terminal del motor
#      posee :3737).

set -uo pipefail

GODOT_BIN="${GODOT_BIN:-$HOME/Downloads/Godot_v4.6.1-stable_linux.x86_64}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${NEFAN_LOG_DIR:-/tmp}"
SAVES_DIR_NEW="${NEFAN_SAVES_DIR:-$PROJECT_DIR/saves}"
SAVES_DIR_OLD="$HOME/.local/share/godot/app_userdata/Never Ending Fantasy/saves"

PORT_BRIDGE=9877
PORT_STATE=9878    # State API HTTP (mismo proceso que el bridge)
PORT_HTML=3000
PORT_AI=8765
PORT_NARR=3737
PORT_REMOTE=9876
PORT_ASSETS=8767
PORT_GPU=8766
PORT_RGEN=8768
PORT_FAKE=18765    # fake-ai-server (labs/narrative) — emula S3–S6, 0 créditos

# narrative-mcp del launcher: 1 (default) = placeholder con NARRATIVE_EAGER_BIND
# que posee :3737 hasta que el terminal del motor haga takeover; 0 = NO
# arrancarlo (el terminal de Claude Code del motor será el dueño de :3737 —
# flujo de labs/narrative/README.md).
NEFAN_EAGER_BIND="${NEFAN_EAGER_BIND:-1}"

# Patrón de proceso Godot para pkill, derivado del binario configurado (no
# fijar la versión: 4.7+ debe seguir funcionando con GODOT_BIN).
GODOT_PROC="$(basename "$GODOT_BIN")"

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
#
# Dos fases: preflight_tools corre ANTES de la TUI (tput hace falta para
# pintarla); preflight_services corre DESPUÉS de elegir preset y solo
# comprueba las dependencias de los servicios seleccionados — elegir
# "E2E sin créditos" no debe exigir Godot ni el .venv de Python.

preflight_tools() {
    local missing=()
    have_cmd nc   || missing+=("netcat (nc) — sudo apt install netcat-openbsd")
    have_cmd curl || missing+=("curl — sudo apt install curl")
    have_cmd tput || missing+=("tput (ncurses) — sudo apt install ncurses-bin")

    if (( ${#missing[@]} )); then
        echo "❌ Preflight failed:"
        printf '   - %s\n' "${missing[@]}"
        exit 1
    fi
}

preflight_services() {
    local missing=()
    if (( ACTIVE[3] == 1 || ACTIVE[4] == 1 )); then
        [[ -x "$GODOT_BIN" ]] || missing+=("Godot binary not executable at $GODOT_BIN — set GODOT_BIN env var to override")
    fi
    if (( ACTIVE[2] == 1 || ACTIVE[7] == 1 || ACTIVE[8] == 1 )); then
        [[ -d "$PROJECT_DIR/.venv" ]] || missing+=("Python venv missing — python -m venv .venv && source .venv/bin/activate && pip install -r ai_server/requirements.txt")
    fi
    # replay-server también: importa `ws` desde nefan-core/node_modules.
    if (( ACTIVE[0] == 1 || ACTIVE[6] == 1 || ACTIVE[10] == 1 )); then
        [[ -d "$PROJECT_DIR/nefan-core/node_modules" ]] || missing+=("nefan-core deps — cd nefan-core && npm install")
    fi
    if (( ACTIVE[5] == 1 )); then
        [[ -d "$PROJECT_DIR/nefan-html/node_modules" ]] || missing+=("nefan-html deps — cd nefan-html && npm install")
    fi
    if (( ACTIVE[1] == 1 )); then
        [[ -d "$PROJECT_DIR/narrative-mcp/node_modules" ]] || missing+=("narrative-mcp deps — cd narrative-mcp && npm install")
    fi
    if (( ACTIVE[9] == 1 || ACTIVE[10] == 1 )); then
        have_cmd node || missing+=("node — needed by fake-ai-server / replay-server")
    fi

    if (( ${#missing[@]} )); then
        echo "❌ Preflight failed:"
        printf '   - %s\n' "${missing[@]}"
        return 1
    fi

    # Migración de saves legacy: solo relevante si va a haber sesión (bridge).
    if (( ACTIVE[0] == 1 )) && [[ -d "$SAVES_DIR_OLD" ]]; then
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
    # Refresca data/runtime_config.json y combat_effective_params.json (hook
    # predev de nefan-core, que `npx tsx` directo se saltaría): los leen
    # Python y Godot, y un dump rancio desincroniza los tres procesos.
    ( cd "$PROJECT_DIR/nefan-core" && npx tsx scripts/dump-config.ts ) \
        >"$LOG_DIR/nefan-bridge.log" 2>&1 || {
        echo "❌ dump-config failed (see $LOG_DIR/nefan-bridge.log)"; return 1; }
    # Con el fake-ai-server activo, el bridge habla con él en vez del ai_server
    # real (mismo mecanismo que el bench de labs/narrative). NEFAN_GAMES_DIR se
    # respeta del entorno si el usuario lo trae (aislar juegos de bench).
    local extra_env=()
    if (( ACTIVE[9] == 1 )); then
        extra_env+=("NEFAN_AI_SERVER=http://127.0.0.1:$PORT_FAKE")
    fi
    ( cd "$PROJECT_DIR/nefan-core" && exec env "${extra_env[@]}" npx tsx bridge/ws-server.ts ) \
        >>"$LOG_DIR/nefan-bridge.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_BRIDGE" 30 "bridge" || return 1
    echo "✅ bridge :$PORT_BRIDGE (State API :$PORT_STATE)  (log: $LOG_DIR/nefan-bridge.log)"
}

start_fake_ai() {
    port_busy "$PORT_FAKE" && kill_port "$PORT_FAKE"
    ( cd "$PROJECT_DIR" && exec node labs/narrative/fake-ai-server.mjs ) \
        >"$LOG_DIR/nefan-fake-ai.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_http_health "http://127.0.0.1:$PORT_FAKE/health" 30 "fake-ai-server" || return 1
    echo "✅ fake-ai-server :$PORT_FAKE  (log: $LOG_DIR/nefan-fake-ai.log)"
}

start_replay() {
    # Suplanta al bridge en :9877 sirviendo una sesión grabada (por eso es
    # exclusivo con el bridge en EXCLUSIVE_PAIRS). LOG del entorno elige la
    # grabación; sin él usa la sesión de referencia embebida en el script.
    port_busy "$PORT_BRIDGE" && kill_port "$PORT_BRIDGE"
    ( cd "$PROJECT_DIR" && exec node labs/narrative/replay-server.mjs ) \
        >"$LOG_DIR/nefan-replay.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_BRIDGE" 15 "replay-server" || return 1
    echo "✅ replay-server :$PORT_BRIDGE (${LOG:-grabación por defecto})  (log: $LOG_DIR/nefan-replay.log)"
}

start_asset_store() {
    port_busy "$PORT_ASSETS" && kill_port "$PORT_ASSETS"
    ( cd "$PROJECT_DIR/nefan-core" && exec npx tsx services/asset-store/server.ts ) \
        >"$LOG_DIR/nefan-asset-store.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_http_health "http://127.0.0.1:$PORT_ASSETS/health" 30 "asset-store" || return 1
    echo "✅ asset-store :$PORT_ASSETS  (log: $LOG_DIR/nefan-asset-store.log)"
}

start_gpu_worker() {
    port_busy "$PORT_GPU" && kill_port "$PORT_GPU"
    (
        cd "$PROJECT_DIR" || exit 1
        # shellcheck disable=SC1091
        source .venv/bin/activate
        exec python -u ai_server/gpu_worker_main.py
    ) >"$LOG_DIR/nefan-gpu-worker.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_http_health "http://127.0.0.1:$PORT_GPU/health" 30 "gpu-worker" || return 1
    echo "✅ gpu-worker :$PORT_GPU  (log: $LOG_DIR/nefan-gpu-worker.log)"
}

start_remote_gen() {
    port_busy "$PORT_RGEN" && kill_port "$PORT_RGEN"
    (
        cd "$PROJECT_DIR" || exit 1
        # shellcheck disable=SC1091
        source .venv/bin/activate
        exec python -u ai_server/remote_gen_main.py
    ) >"$LOG_DIR/nefan-remote-gen.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_http_health "http://127.0.0.1:$PORT_RGEN/health" 30 "remote-gen" || return 1
    echo "✅ remote-gen :$PORT_RGEN  (log: $LOG_DIR/nefan-remote-gen.log)"
}

start_narrative_mcp() {
    # NEFAN_EAGER_BIND=0: NO arrancar el placeholder — el terminal de Claude
    # Code del motor será el único dueño de :3737 (flujo de labs/narrative,
    # cuyo README pide expresamente no robarle el puerto).
    if [[ "$NEFAN_EAGER_BIND" == "0" ]]; then
        echo "⏭  narrative-mcp NOT started (NEFAN_EAGER_BIND=0): el terminal del motor poseerá :3737"
        return 0
    fi
    port_busy "$PORT_NARR" && kill_port "$PORT_NARR"
    # Recompilar SIEMPRE: `tsc -b` es incremental (no-op en ~0,1 s si está
    # fresco) y detecta también cambios en los contratos de nefan-core, que un
    # `find -newer` sobre narrative-mcp/*.ts no vería. Un dist viejo ejecuta
    # silenciosamente código de otro día y es indistinguible de un bug.
    echo "🛠  narrative-mcp: building (tsc -b incremental)..."
    ( cd "$PROJECT_DIR/narrative-mcp" && npm run build ) || return 1
    # NARRATIVE_EAGER_BIND: this standalone instance is a port placeholder, so it
    # must bind :3737 at startup (no narrative_listen ever drives it) to satisfy
    # wait_for_port below. Claude-Code-spawned instances bind lazily on first
    # narrative_listen, so opening a terminal for code work no longer steals the
    # bridge; the narrative terminal takes over this placeholder when it listens.
    ( cd "$PROJECT_DIR/narrative-mcp" && NARRATIVE_EAGER_BIND=1 exec node dist/server.js ) \
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
    pkill -f "$GODOT_PROC" 2>/dev/null
    sleep 1
    ( exec "$GODOT_BIN" --path "$PROJECT_DIR/godot" --rendering-method gl_compatibility ) \
        >"$LOG_DIR/nefan-godot.log" 2>&1 &
    STARTED_PIDS+=($!)
    wait_for_port "$PORT_REMOTE" 30 "Godot remote control" || return 1
    echo "✅ Godot (remote :$PORT_REMOTE)  (log: $LOG_DIR/nefan-godot.log)"
}

start_godot_headless() {
    pkill -f "$GODOT_PROC" 2>/dev/null
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

  Tip: si el terminal del motor debe POSEER :3737 (flujo labs/narrative),
  relanza con NEFAN_EAGER_BIND=0 para que este launcher no arranque su
  placeholder de narrative-mcp.

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

# Service slot index → key. OJO: añadir servicios nuevos AL FINAL — las
# máscaras de PRESET_PROFILES y EXCLUSIVE_PAIRS son posicionales.
SERVICES=(bridge narrative-mcp ai_server godot godot-headless html asset-store gpu-worker remote-gen fake-ai replay-server)
# Service slot index → display label
SERVICE_LABELS=(
    "bridge          :9877"
    "narrative-mcp   :3737"
    "ai_server       :8765"
    "Godot"
    "Godot headless (xvfb)"
    "HTML            :3000"
    "asset-store     :8767"
    "gpu-worker      :8766"
    "remote-gen      :8768"
    "fake-ai-server  :18765"
    "replay-server   :9877"
)
# Service slot index → one-line hint
SERVICE_HINTS=(
    "shared TS logic + WebSocket (State API :9878)"
    "MCP bridge to Claude Code (NEFAN_EAGER_BIND=0 = lo posee el terminal del motor)"
    "Python narrative/LLM server"
    "3D client window"
    "Godot under xvfb (no window)"
    "2D browser client (vistas oblicua/proscenio/fps)"
    "blobs + manifest SQLite + covers de estilos"
    "texturas SD / modelos / LaMa (GPU local, sin créditos)"
    "Meshy/fal + SAM2 + atlas fps + estilos — GASTA créditos si se invoca"
    "emula narrative-llm+gpu-worker+remote-gen+asset-store — 0 créditos (bench)"
    "reproduce una sesión grabada como película (suplanta al bridge; LOG=runs/…/events.ndjson)"
)

# Mutually exclusive pairs (space-separated indices in a single string).
# Toggling one in the TUI deactivates its sibling.
# godot vs godot-headless; ai_server vs fake-ai; bridge vs replay (mismo :9877)
EXCLUSIVE_PAIRS=("3 4" "2 9" "0 10")

# Presets: nombre + descripción + bitmask posicional en el orden de SERVICES
# (mismo ancho que SERVICES — añadir un servicio obliga a tocar TODAS).
# Los números 1-5 están citados en docs (CLAUDE.md, godot/tools) — presets
# nuevos SIEMPRE al final, antes de Custom.
PRESET_NAMES=(
    "Play"
    "Story web"
    "Automated tests"
    "Cliente web (dev)"
    "E2E sin créditos"
    "Story web sin imágenes"
    "Playtest motor (bench)"
    "Replay web (película)"
    "HTML fixtures"
    "Custom"
)
PRESET_DESCS=(
    "Stack completo + Claude Code + Godot — GASTA créditos con Imagen IA (Meshy/fal)"
    "Historia sin Godot: motor narrativo + cliente web (navegador); pre-generación de mundo/estilo — GASTA créditos con Imagen IA"
    "bridge + Godot headless + asset-store (movement_test.py y cía) — sin coste"
    "bridge + HTML + asset-store + remote-gen (fps/estilos operativos) — solo gasta si activas Imagen IA en el juego"
    "fake-ai-server + bridge + HTML — todo mockeado, 0 créditos (bench E2E)"
    "motor narrativo con los servicios de imagen APAGADOS (sin gpu-worker ni remote-gen): imposible gastar en imágenes — juega en Maqueta 3D / y_bot"
    "bridge + ai_server + asset-store, SIN placeholder de narrative-mcp: el terminal del motor posee :3737 (labs/narrative; conduce con game-emulator :9899)"
    "replay-server + HTML: reproduce una sesión grabada como película, sin motor ni ai_server — renderer determinista (LOG=runs/…/events.ndjson)"
    "solo el cliente web: fixtures del selector Room + teclas dev, cero backend"
    "Lo que tengas seleccionado"
)
# El asset-store acompaña a cualquier preset con bridge o ai_server: el
# gateway resuelve assetExists contra :8767 y los generadores registran ahí.
# gpu-worker y remote-gen acompañan a los presets con ai_server; "Cliente
# web (dev)" lleva remote-gen (la vista fps pide /generate_surface_atlas y
# aplicar estilo pasa por /styles/*) pero no gpu-worker. "E2E sin créditos"
# usa el fake para TODO (emula también el asset-store): el bridge recibe
# NEFAN_AI_SERVER y el cliente se abre con ?ai= (URL impresa al arrancar).
# "Story web sin imágenes" quita gpu-worker/remote-gen a propósito: los
# pipelines de imagen del cliente quedan sin backend (elige Maqueta 3D).
#                  bridge  narr  ai  god  hl  html  assets  gpu  rgen  fake  replay
PRESET_PROFILES=(
    "1 1 1 1 0 1 1 1 1 0 0"   # Play
    "1 1 1 0 0 1 1 1 1 0 0"   # Story web
    "1 0 0 0 1 0 1 0 0 0 0"   # Automated tests
    "1 0 0 0 0 1 1 0 1 0 0"   # Cliente web (dev)
    "1 0 0 0 0 1 0 0 0 1 0"   # E2E sin créditos
    "1 1 1 0 0 1 1 0 0 0 0"   # Story web sin imágenes
    "1 0 1 0 0 0 1 0 0 0 0"   # Playtest motor (bench)
    "0 0 0 0 0 1 0 0 0 0 1"   # Replay web (película)
    "0 0 0 0 0 1 0 0 0 0 0"   # HTML fixtures
    "0 0 0 0 0 0 0 0 0 0 0"   # Custom (filled in from current selection)
)

# Live state — applied by TUI, consumed by launcher.
declare -a ACTIVE=(0 0 0 0 0 0 0 0 0 0 0)

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
        esac
    done

    tui_leave
    # Pausa de Claude Code: siempre que haya motor narrativo en juego —
    # narrative-mcp seleccionado (placeholder con takeover) O ai_server sin
    # narrative-mcp (flujo playtest: el terminal del motor posee :3737, y el
    # diálogo de la pausa ofrece [s] saltar con detección de API key).
    TUI_NEEDS_PAUSE=0
    if (( ACTIVE[1] == 1 || ACTIVE[2] == 1 )); then
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

    # Order: asset-store → gpu-worker → remote-gen → fake-ai → replay →
    # bridge → narrative-mcp → ai_server → (Claude pause) → godot/headless →
    # html. El asset-store va PRIMERO: ai_server hace count/prune al arrancar
    # y el gateway puede pedir assetExists temprano; gpu-worker y remote-gen
    # antes que ai_server para que /backend_status y /segment ya los vean al
    # primer uso; el fake antes que el bridge (que arranca apuntándole).
    (( ACTIVE[6] == 1 ))  && { start_asset_store   || return 1; }
    (( ACTIVE[7] == 1 ))  && { start_gpu_worker    || return 1; }
    (( ACTIVE[8] == 1 ))  && { start_remote_gen    || return 1; }
    (( ACTIVE[9] == 1 ))  && { start_fake_ai       || return 1; }
    (( ACTIVE[10] == 1 )) && { start_replay        || return 1; }
    (( ACTIVE[0] == 1 ))  && { start_bridge        || return 1; }
    (( ACTIVE[1] == 1 ))  && { start_narrative_mcp || return 1; }

    # Pausa de Claude Code SIN placeholder de narrative-mcp (flujo playtest,
    # labs/narrative/README): el terminal del motor debe POSEER :3737 antes
    # de que ai_server intente conectar — pausar ANTES de arrancarlo.
    if (( TUI_NEEDS_PAUSE == 1 && ACTIVE[1] == 0 )); then
        pause_for_claude_code
    fi

    (( ACTIVE[2] == 1 )) && { start_ai || return 1; }

    # Con placeholder, la pausa va tras ai_server (el terminal del motor hace
    # takeover del placeholder al primer narrative_listen).
    if (( TUI_NEEDS_PAUSE == 1 && ACTIVE[1] == 1 )); then
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
    # URL del cliente 2D: con el fake activo hay que abrirlo con ?ai= para que
    # TODOS los servicios del cliente (skins, atlas, estilos) resuelvan al fake.
    if (( ACTIVE[5] == 1 )); then
        if (( ACTIVE[9] == 1 )); then
            cat <<EOF

  🌐 Cliente web (bench sin créditos):
     http://localhost:$PORT_HTML/?ai=http://127.0.0.1:$PORT_FAKE
     (añade &input=scripted para conducirlo con window.__nefan.inputDriver)
EOF
        else
            echo ""
            echo "  🌐 Cliente web: http://localhost:$PORT_HTML/"
        fi
    fi
    if (( ACTIVE[10] == 1 )); then
        cat <<EOF
  🎞  Replay: el cliente reproduce la grabación al conectar (Reanudar la
     sesión del listado). Otra grabación: relanza con
     LOG=labs/narrative/runs/<ts>/events.ndjson ./start.sh
EOF
    fi
    # Bench de playtest (ai_server con el motor en otro terminal, sin
    # placeholder): recordar cómo se conduce.
    if (( ACTIVE[2] == 1 && ACTIVE[1] == 0 && ACTIVE[0] == 1 )); then
        cat <<EOF

  🧪 Bench narrativo (labs/narrative): emula el juego con
     node labs/narrative/game-emulator.mjs   # API de control HTTP :9899
     y condúcelo con curl (ver labs/narrative/README.md).
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
        "state-api:$PORT_STATE"
        "narrative-mcp:$PORT_NARR"
        "ai_server:$PORT_AI"
        "asset-store:$PORT_ASSETS"
        "gpu-worker:$PORT_GPU"
        "remote-gen:$PORT_RGEN"
        "fake-ai:$PORT_FAKE"
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

# Todos los puertos que el launcher puede haber ocupado — compartido por
# cmd_stop y el fallback de cleanup para que ningún servicio quede colgado.
ALL_PORTS=("$PORT_BRIDGE" "$PORT_STATE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML" "$PORT_ASSETS" "$PORT_GPU" "$PORT_RGEN" "$PORT_FAKE")

cmd_stop() {
    echo "🛑 killing services..."
    local port
    for port in "${ALL_PORTS[@]}"; do
        if port_busy "$port"; then
            kill_port "$port"
            echo "    · :$port"
        fi
    done
    pkill -f "$GODOT_PROC" 2>/dev/null && echo "    · Godot"
    pkill -f "vite"        2>/dev/null && echo "    · vite"
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
        for p in "${ALL_PORTS[@]}"; do
            port_busy "$p" && kill_port "$p"
        done
        pkill -f "$GODOT_PROC" 2>/dev/null
    fi
}
trap cleanup EXIT INT TERM

# ─── Entry point ───────────────────────────────────────────────

preflight_tools
run_tui
case "$TUI_RESULT" in
    launch) preflight_services && run_selection ;;
    quit|*) exit 0 ;;
esac
