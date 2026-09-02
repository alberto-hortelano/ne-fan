#!/usr/bin/env bash
# Never Ending Fantasy — interactive launcher (TUI).
# Run without arguments. Use ↑/↓ to navigate, → to fine-tune which services
# launch, ← to go back, Space to toggle a service, Enter to launch,
# s = status, k = parar lo de ESTE worktree, K = barrer el catálogo entero
# (incluido lo ajeno), q to quit.
# Env: NEFAN_LOG_DIR, NEFAN_SAVES_DIR, NEFAN_GAMES_DIR (bench),
#      NEFAN_EAGER_BIND=0 (no arrancar narrative-mcp: el terminal del motor
#      posee el puerto del narrative-mcp).

set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAVES_DIR_NEW="${NEFAN_SAVES_DIR:-$PROJECT_DIR/saves}"

# ─── Puertos ───────────────────────────────────────────────────
#
# Este fichero NO declara ningún puerto. Los declaraba —dos veces: aquí y otra
# vez a mano dentro de SERVICE_LABELS, que es de donde los leía qa/presets.mjs—
# mientras `nefan-core/src/config.ts` decía por escrito ser «la fuente única de
# puertos» y nadie la respetaba. El hallazgo no era que faltara una fuente
# única: era que sobraba todo lo que la ignoraba.
#
# El bloque BASE sale del snapshot que ya escribe `scripts/dump-config.ts`
# (`data/runtime_config.json`, commiteado), que es el mismo canal por el que lo
# reciben ai_server, narrative-mcp y el banco de pruebas.
#
# NEFAN_PORT_OFFSET desplaza el bloque entero para que quepan varios stacks en
# la misma máquina (varios agentes, varios worktrees, dos corridas del banco).
# 0 = los puertos de siempre, EXACTAMENTE: quien trabaja solo no se entera.
# Es explícito y nunca derivado del nombre del worktree — dos worktrees de
# nombre parecido colisionarían sin que nadie lo notara.
RUNTIME_CONFIG="$PROJECT_DIR/nefan-core/data/runtime_config.json"
PORT_OFFSET="${NEFAN_PORT_OFFSET:-0}"
if ! [[ "$PORT_OFFSET" =~ ^[0-9]+$ ]] || (( PORT_OFFSET > 40000 )); then
    echo "❌ NEFAN_PORT_OFFSET inválido: '$PORT_OFFSET' (entero de 0 a 40000)" >&2
    exit 1
fi
# Se exporta para que TODO lo que arranque debajo resuelva a sus VECINOS con el
# mismo bloque: `resolveServiceUrl` (TS, navegador incluido) y qa/lib/stack.mjs
# suman este mismo número. Cada servicio recibe además su propio puerto en su
# variable de siempre — la de escucha manda sobre cualquier derivación.
export NEFAN_PORT_OFFSET="$PORT_OFFSET"

read_ports() {
    node -e '
      const cfg = require(process.argv[1]);
      const off = Number(process.argv[2]);
      const vars = {
        PORT_BRIDGE: "bridge", PORT_STATE: "state_api", PORT_HTML: "html",
        PORT_AI: "ai_server", PORT_NARR: "narrative_ws", PORT_ASSETS: "asset_store",
        PORT_RGEN: "remote_gen", PORT_FAKE: "fake_ai", PORT_FORGE: "sprite_forge",
      };
      for (const [v, k] of Object.entries(vars)) {
        const base = cfg.ports?.[k];
        if (typeof base !== "number") {
          console.error(`runtime_config.json no declara ports.${k}`);
          process.exit(1);
        }
        console.log(`${v}=${base + off}`);
      }
    ' "$RUNTIME_CONFIG" "$PORT_OFFSET"
}
PORTS_DECL=$(read_ports) || {
    echo "❌ no puedo leer los puertos de $RUNTIME_CONFIG" >&2
    echo "   regenéralo: cd nefan-core && npm run dump-config" >&2
    exit 1
}
eval "$PORTS_DECL"

# Servicios que NO honran NEFAN_PORT_OFFSET, y por qué:
#  · ai_server y remote-gen son Python y leen sus puertos del snapshot, que es
#    uno por checkout y no puede llevar el offset (dos stacks se lo pisarían);
#  · narrative-mcp lo mismo, y además su puerto lo posee el terminal del motor;
#  · sprite-forge vive en OTRO repositorio y lo comparten varios proyectos.
# Con offset ≠ 0 el launcher se NIEGA a arrancarlos en vez de levantarlos en un
# puerto que su consumidor no va a buscar — que es como un desplazamiento se
# vuelve «arbitrario» en un mes.
SERVICIOS_SIN_OFFSET=(ai_server remote-gen narrative-mcp sprite-forge)

# Los nueve logs son nombres FIJOS (`nefan-bridge.log`…) y se TRUNCAN al
# arrancar. Con `/tmp` a secas eso los hacía globales de MÁQUINA: dos stacks se
# pisaban el diagnóstico justo cuando hacía falta leerlo.
#
# Y la identidad de un stack no es el worktree: es el par (worktree, offset).
# Indexar solo por worktree movía el bug de global-de-máquina a
# global-de-worktree — dos bloques desplazados en el MISMO checkout, que es
# justo lo que el offset existe para permitir, seguían truncando los mismos
# nueve ficheros. El banco no lo veía porque pone `NEFAN_LOG_DIR` explícito;
# una persona con dos terminales, sí.
# `${PORT_OFFSET:+…}` NO vale aquí: "0" es una cadena no vacía, así que el
# sufijo saldría también en el caso de una sola persona y le cambiaría la ruta
# de los logs sin motivo. El bloque de siempre no lleva sufijo.
SUFIJO_BLOQUE=""
(( PORT_OFFSET != 0 )) && SUFIJO_BLOQUE="-$PORT_OFFSET"
LOG_DIR="${NEFAN_LOG_DIR:-/tmp/nefan-$(basename "$PROJECT_DIR")$SUFIJO_BLOQUE}"
mkdir -p "$LOG_DIR" || { echo "❌ no puedo crear el directorio de logs $LOG_DIR"; exit 1; }

# sprite-forge vive fuera de este repo (lo usa más de un proyecto). Sin él,
# remote-gen devuelve 503 en /skin_sprite_sheet y los NPC salen en maniquí.
SPRITE_FORGE_DIR="${NEFAN_SPRITE_FORGE_DIR:-$HOME/code/sprite-forge}"

# narrative-mcp del launcher: 1 (default) = placeholder con NARRATIVE_EAGER_BIND
# que posee el puerto del MCP hasta que el terminal del motor haga takeover; 0 = NO
# arrancarlo (el terminal de Claude Code del motor será su dueño —
# flujo de labs/narrative/README.md).
NEFAN_EAGER_BIND="${NEFAN_EAGER_BIND:-1}"

declare -a STARTED_PIDS=()
# Puertos de los servicios que arrancó ESTE launcher. `cleanup` no toca ningún
# otro: en el catálogo puede haber procesos ajenos (el narrative-mcp que posee
# el terminal del motor, el stack de otra persona) y matarlos por barrido es un
# efecto colateral silencioso, no una limpieza.
declare -a STARTED_PORTS=()

# Registra un proceso arrancado por nosotros junto al puerto que ocupa.
track_started() {
    STARTED_PIDS+=("$1")
    shift
    STARTED_PORTS+=("$@")
}

# ─── Utilities ─────────────────────────────────────────────────

have_cmd()  { command -v "$1" >/dev/null 2>&1; }
port_busy() { fuser "$1/tcp" >/dev/null 2>&1; }
kill_port() { fuser -k "$1/tcp" 2>/dev/null; sleep 0.5; }

# ─── Quién escucha, en UNA foto ────────────────────────────────
#
# `fuser` lanza un proceso por puerto y recorre /proc entero buscando quién lo
# tiene: ~8 ms cada uno, y la mayor parte en tiempo de SISTEMA. Con nueve
# puertos no se nota; el día que hubo que mirar diez bloques (90 puertos) para
# que `k` encontrara un stack desplazado, sí: 0,77 s de reloj y 0,70 s de
# sistema en el camino que un agente pisa en CADA teardown. Eso es justo lo que
# esta tanda venía a mejorar, así que no puede pagarse así.
#
# `ss -H -ltn` saca la tabla ENTERA de sockets a la escucha de una vez en
# ~0,03 s — 25× más barato que una sola pasada de nueve `fuser`— y de propina
# ve sockets de otros usuarios que `fuser` no ve (ahí `fuser` calla y el puerto
# parecería libre). `fuser` se reserva para los POCOS puertos que salgan
# ocupados, y sus pids se capturan UNA vez para alimentar a la vez el «quién
# es» y el «¿es de este worktree?».
#
# OJO al parseo: en `ss -H -ltn` la dirección LOCAL es el campo 4
# (`LISTEN 0 128 0.0.0.0:22 0.0.0.0:*`). El campo 5 es el PEER, que en un
# socket a la escucha es siempre `0.0.0.0:*` — leerlo por error metería la
# clave `*` en la tabla y dejaría todos los puertos como libres.
declare -A ESCUCHANDO=()
snapshot_escuchando() {
    ESCUCHANDO=()
    local local_addr
    while read -r _ _ _ local_addr _; do
        [[ -n "$local_addr" ]] && ESCUCHANDO[${local_addr##*:}]=1
    done < <(ss -H -ltn 2>/dev/null)
}

# ¿Escucha alguien en $1, según la última foto? (No lanza procesos.)
port_en_foto() { [[ -v "ESCUCHANDO[$1]" ]]; }

# Los pids que tienen el puerto $1, en una sola llamada a fuser.
pids_del_puerto() { fuser "$1/tcp" 2>/dev/null; }

# Quién escucha, a partir de unos pids YA capturados: así el mismo `fuser` sirve
# para decirlo y para decidir si es nuestro.
owner_de_pids() {
    # shellcheck disable=SC2086
    [[ -n "${1// /}" ]] && ps -o comm=,args= -p $1 2>/dev/null | head -1 | cut -c1-60
}

# Quién escucha en un puerto, para poder decirlo antes de matarlo.
port_owner() { owner_de_pids "$(pids_del_puerto "$1")"; }

# ¿El proceso que escucha en $1 vive en ESTE worktree?
#
# En esta máquina trabajan varios agentes a la vez, cada uno en su worktree, y
# los nueve puertos del catálogo son los mismos para todos. "Lo mío" no puede
# ser "lo que arrancó este proceso de bash" —quien pulsa `k` casi nunca ha
# arrancado nada en esa terminal, así que STARTED_PORTS está vacío y el
# huérfano propio sobrevive— pero tampoco puede ser "todo el catálogo", que es
# el arma que esta tanda multiplica. El criterio es el WORKTREE: que el proceso
# se pueda DEMOSTRAR de este árbol, por su cwd o por sus argumentos.
#
# Un /proc/<pid>/cwd ILEGIBLE cuenta como AJENO, nunca al revés: si no se puede
# demostrar que es mío, no se mata. El falso negativo cuesta un servicio que
# hay que parar a mano; el falso positivo cuesta el trabajo de otra persona.
#
# El cwd no es la única prueba, y creerlo dejaba un servicio vivo: **sprite-forge**
# corre desde el repo hermano por diseño (`cd "$SPRITE_FORGE_DIR"`), así que la
# tecla `k` lo declaraba AJENO y no lo tocaba —aunque lo hubiera arrancado este
# mismo launcher— dejando :$PORT_FORGE ocupado, con la clave de imagen en su
# entorno, y el arranque siguiente negándose por puerto ocupado. Este comentario
# decía que eso era «lo correcto porque lo comparten varios proyectos»: confundía
# el REPOSITORIO, que sí se comparte, con el PROCESO, que no. El que escucha en
# ese puerto sirve los assets, el set y la caché de ESTE árbol.
#
# Así que se admite una segunda prueba, del mismo rango que el cwd: que los
# ARGUMENTOS del proceso apunten dentro de $PROJECT_DIR. Un sprite-forge
# arrancado con `--assets .../ne-fan/assets/characters --set .../ne-fan/...`
# está sirviendo a este worktree, lo diga su cwd o no. La barra final es
# obligatoria: sin ella, `/home/al/code/ne-fan` casaría con el worktree de otro
# agente llamado `/home/al/code/ne-fan-loquesea`.
#
# Un /proc/<pid> ILEGIBLE sigue contando como AJENO, nunca al revés: si no se
# puede demostrar que es mío, no se mata. El falso negativo cuesta un servicio
# que hay que parar a mano; el falso positivo cuesta el trabajo de otra persona.
worktree_de_pids() {
    local pid cwd args
    for pid in $1; do
        cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
        [[ "$cwd" == "$PROJECT_DIR" || "$cwd" == "$PROJECT_DIR"/* ]] && return 0
        args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
        [[ "$args" == *"$PROJECT_DIR/"* ]] && return 0
    done
    return 1
}
port_de_este_worktree() { worktree_de_pids "$(pids_del_puerto "$1")"; }

# El puerto tiene que estar LIBRE para arrancar. Si no lo está, se dice quién
# lo ocupa y se para.
#
# Hasta hoy las nueve funciones `start_*` hacían `port_busy && kill_port`: se
# cargaban al ocupante sin preguntar de quién era. Con un solo agente eso era
# una comodidad; con varios es exactamente lo que prohíbe «no le cerreis sus
# servers» — y el arranque más tonto (html-fixtures) se llevaba por delante el
# cliente de otro. La intención correcta ya estaba escrita en la BAJADA de este
# mismo fichero (`cleanup` solo toca STARTED_PORTS y lo dice); lo que faltaba
# era aplicarla a la subida.
#
# Negarse en vez de saltar a otro puerto es deliberado: así la URL que sale por
# pantalla es la que uno espera, y quien quiera otro bloque lo pide.
require_port_free() {
    local port=$1 label=$2 quien pids
    # Un solo `fuser`, y sus pids sirven para las dos preguntas que vienen
    # detrás («quién es» y «¿es de este worktree?»). Eran tres llamadas.
    pids=$(pids_del_puerto "$port")
    [[ -n "${pids// /}" ]] || return 0
    quien=$(owner_de_pids "$pids")
    echo "❌ :$port ocupado — $label NO arranca (este launcher no mata lo que no arrancó)."
    echo "   lo tiene: ${quien:-(no se puede leer: proceso de otro usuario)}"
    if worktree_de_pids "$pids"; then
        echo "   · es de ESTE worktree: párale con la tecla k del menú, o ./start.sh --parar"
    else
        echo "   · NO es de este worktree: puede ser otro agente de la máquina, o el"
        echo "     narrative-mcp que posee el terminal del motor. Habla con su dueño."
        echo "   · si de verdad sobra todo: ./start.sh --parar-todo (enumera antes de matar)"
    fi
    return 1
}

# Descendientes de un PID, hijos antes que padres (npx deja el proceso real
# colgando de él: matar solo al padre lo deja huérfano y con el puerto tomado).
descendants() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null); do
        descendants "$child"
        echo "$child"
    done
}

# Mata un proceso y su descendencia. TERM primero —los servicios cierran sus
# puertos y sus ficheros—, KILL solo a lo que sobreviva.
kill_tree() {
    local p
    local -a all
    mapfile -t all < <(descendants "$1")
    all+=("$1")
    for p in "${all[@]}"; do kill -TERM "$p" 2>/dev/null; done
    sleep 0.5
    for p in "${all[@]}"; do kill -KILL "$p" 2>/dev/null; done
}

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

# ¿Ha terminado ya el hijo? Un proceso muerto sigue siendo ZOMBIE hasta que
# alguien hace `wait` sobre él, y `kill -0` sobre un zombie devuelve 0 como si
# viviera: hay que mirar el estado en /proc/<pid>/stat, el campo que sigue al
# último ')' del nombre. Sin /proc/<pid> también cuenta como terminado.
proceso_terminado() {
    local pid=$1 stat estado
    stat=$(cat "/proc/$pid/stat" 2>/dev/null) || return 0
    estado=${stat##*) }
    estado=${estado%% *}
    [[ $estado == Z ]]
}

# Espera al /health de un servicio. Con `pid` y `log`, si el hijo MUERE antes
# de responder no se agota el timeout callando: se dice el código de salida y
# se enseñan las últimas líneas de su log, que es donde el servicio ha escrito
# por qué (el asset-store, por ejemplo, se niega a arrancar sobre un índice
# con kinds sin productor y deja ahí el nombre del script que lo purga).
wait_for_http_health() {
    local url=$1 timeout=${2:-60} label=${3:-service} pid=${4:-} log=${5:-}
    local i=0 rc
    while (( i < timeout )); do
        if curl -sf "$url" >/dev/null 2>&1; then
            return 0
        fi
        if [[ -n $pid ]] && proceso_terminado "$pid"; then
            wait "$pid" 2>/dev/null
            rc=$?
            echo "❌ $label murió antes de responder (exit $rc)"
            if [[ -n $log && -r $log ]]; then
                echo "   últimas líneas de $log:"
                tail -n 12 "$log" | sed 's/^/   │ /'
            fi
            return 1
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
# "HTML fixtures" no debe exigir el .venv de Python ni las deps del bridge.

preflight_tools() {
    local missing=()
    have_cmd node || missing+=("node — hace falta para leer el bloque de puertos de nefan-core/data/runtime_config.json")
    have_cmd ss   || missing+=("ss (iproute2) — la foto de puertos a la escucha; sudo apt install iproute2")
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
    if on ai_server || on remote-gen; then
        [[ -d "$PROJECT_DIR/.venv" ]] || missing+=("Python venv missing — python -m venv .venv && source .venv/bin/activate && pip install -r ai_server/requirements.txt")
    fi
    # replay-server también: importa `ws` desde nefan-core/node_modules.
    if on bridge || on asset-store || on replay-server; then
        [[ -d "$PROJECT_DIR/nefan-core/node_modules" ]] || missing+=("nefan-core deps — cd nefan-core && npm install")
    fi
    if on html; then
        [[ -d "$PROJECT_DIR/nefan-html/node_modules" ]] || missing+=("nefan-html deps — cd nefan-html && npm install")
    fi
    if on narrative-mcp; then
        [[ -d "$PROJECT_DIR/narrative-mcp/node_modules" ]] || missing+=("narrative-mcp deps — cd narrative-mcp && npm install")
    fi
    if on fake-ai || on replay-server; then
        have_cmd node || missing+=("node — needed by fake-ai-server / replay-server")
    fi

    if (( ${#missing[@]} )); then
        echo "❌ Preflight failed:"
        printf '   - %s\n' "${missing[@]}"
        return 1
    fi
}

# ─── Service starters ──────────────────────────────────────────

start_bridge() {
    require_port_free "$PORT_BRIDGE" "bridge" || return 1
    require_port_free "$PORT_STATE" "State API" || return 1
    # Refresca data/runtime_config.json (hook predev de nefan-core, que `npx
    # tsx` directo se saltaría): lo lee ai_server en Python, y un dump rancio
    # desincroniza los procesos.
    ( cd "$PROJECT_DIR/nefan-core" && npx tsx scripts/dump-config.ts ) \
        >"$LOG_DIR/nefan-bridge.log" 2>&1 || {
        echo "❌ dump-config failed (see $LOG_DIR/nefan-bridge.log)"; return 1; }
    # Con el fake-ai-server activo, el bridge habla con él en vez del ai_server
    # real (mismo mecanismo que el bench de labs/narrative). NEFAN_GAMES_DIR se
    # respeta del entorno si el usuario lo trae (aislar juegos de bench).
    local extra_env=()
    if on fake-ai; then
        extra_env+=("NEFAN_AI_SERVER=http://127.0.0.1:$PORT_FAKE")
    fi
    ( cd "$PROJECT_DIR/nefan-core" && exec env "${extra_env[@]}" \
        NEFAN_BRIDGE_PORT="$PORT_BRIDGE" NEFAN_STATE_HTTP_PORT="$PORT_STATE" \
        npx tsx bridge/ws-server.ts ) \
        >>"$LOG_DIR/nefan-bridge.log" 2>&1 &
    track_started $! "$PORT_BRIDGE" "$PORT_STATE"
    wait_for_port "$PORT_BRIDGE" 30 "bridge" || return 1
    echo "✅ bridge :$PORT_BRIDGE (State API :$PORT_STATE)  (log: $LOG_DIR/nefan-bridge.log)"
}

start_fake_ai() {
    require_port_free "$PORT_FAKE" "fake-ai-server" || return 1
    # cwd `nefan-core` y `npx tsx`, EXACTAMENTE como start_bridge (#309): el
    # motor falso es TypeScript desde que importa los contratos en vez de
    # copiarlos, y `tsx` solo es dependencia DECLARADA (4.21.0) desde aquí.
    # Lanzado desde la raíz del repo —que no tiene package.json ni
    # node_modules— `npx tsx` resuelve un tsx GLOBAL de la máquina
    # (~/.npm/_npx, 4.23.12 hoy): sería regalarle al banco una dependencia que
    # nadie declara y una segunda versión de tsx.
    ( cd "$PROJECT_DIR/nefan-core" && exec env PORT="$PORT_FAKE" STATE_API="http://127.0.0.1:$PORT_STATE" \
        npx tsx ../labs/narrative/fake-ai-server.ts ) \
        >"$LOG_DIR/nefan-fake-ai.log" 2>&1 &
    track_started $! "$PORT_FAKE"
    wait_for_http_health "http://127.0.0.1:$PORT_FAKE/health" 30 "fake-ai-server" "$!" "$LOG_DIR/nefan-fake-ai.log" || return 1
    echo "✅ fake-ai-server :$PORT_FAKE  (log: $LOG_DIR/nefan-fake-ai.log)"
}

start_replay() {
    # Suplanta al bridge en su propio puerto sirviendo una sesión grabada (por eso es
    # exclusivo con el bridge en EXCLUSIVE_PAIRS). LOG del entorno elige la
    # grabación; sin él usa la sesión de referencia embebida en el script.
    require_port_free "$PORT_BRIDGE" "replay-server" || return 1
    ( cd "$PROJECT_DIR" && exec env PORT="$PORT_BRIDGE" node labs/narrative/replay-server.mjs ) \
        >"$LOG_DIR/nefan-replay.log" 2>&1 &
    track_started $! "$PORT_BRIDGE"
    wait_for_port "$PORT_BRIDGE" 15 "replay-server" || return 1
    echo "✅ replay-server :$PORT_BRIDGE (${LOG:-grabación por defecto})  (log: $LOG_DIR/nefan-replay.log)"
}

start_asset_store() {
    require_port_free "$PORT_ASSETS" "asset-store" || return 1
    ( cd "$PROJECT_DIR/nefan-core" && exec env NEFAN_ASSET_STORE_PORT="$PORT_ASSETS" \
        npx tsx services/asset-store/server.ts ) \
        >"$LOG_DIR/nefan-asset-store.log" 2>&1 &
    track_started $! "$PORT_ASSETS"
    wait_for_http_health "http://127.0.0.1:$PORT_ASSETS/health" 30 "asset-store" "$!" "$LOG_DIR/nefan-asset-store.log" || return 1
    echo "✅ asset-store :$PORT_ASSETS  (log: $LOG_DIR/nefan-asset-store.log)"
}

start_remote_gen() {
    require_port_free "$PORT_RGEN" "remote-gen" || return 1
    (
        cd "$PROJECT_DIR" || exit 1
        # shellcheck disable=SC1091
        source .venv/bin/activate
        exec python -u ai_server/remote_gen_main.py
    ) >"$LOG_DIR/nefan-remote-gen.log" 2>&1 &
    track_started $! "$PORT_RGEN"
    wait_for_http_health "http://127.0.0.1:$PORT_RGEN/health" 30 "remote-gen" "$!" "$LOG_DIR/nefan-remote-gen.log" || return 1
    echo "✅ remote-gen :$PORT_RGEN  (log: $LOG_DIR/nefan-remote-gen.log)"
}

# Lee una variable de .env sin exportar el fichero entero. Los servicios Python
# lo cargan ellos mismos (`load_env_file`), así que el shell NO tiene estas
# variables: un servicio que no sea Python tiene que venir a buscarlas.
dotenv_get() {
    [[ -f "$PROJECT_DIR/.env" ]] || return 0
    sed -n "s/^$1=//p" "$PROJECT_DIR/.env" | head -1 | tr -d '"'"'"'\r'
}

# El veredicto de sprite-forge lo redacta nefan-core (`veredictoDeForge`), no
# este script: es una DECISIÓN sobre un contrato (`SpriteCatalogSchema`) y aquí
# no se puede probar sin arrancar el servicio de verdad. Este preflight AVISA y
# nunca falla (decisión del usuario, 2026-09-01): sprite-forge es opcional y
# vive en otro repo, y desde que su `/skins` se niega con 503 antes de pagar ya
# no se puede gastar por error. Por eso las dos llamadas acaban en `return 0`.
# cwd `nefan-core` y `npx tsx`, como start_bridge: desde otro directorio npx
# resolvería un tsx GLOBAL que no ve las dependencias del paquete.
salud_sprite_forge() {
    ( cd "$PROJECT_DIR/nefan-core" && npx tsx scripts/salud-sprite-forge.ts "$@" ) \
        || echo "⚠️  el preflight de sprite-forge falló al ejecutarse (su error, arriba)"
}

start_sprite_forge() {
    # El intérprete con el que corre el worker de repintado. Se nombra UNA vez
    # y se usa dos: para arrancarlo y para que el preflight pueda decir qué
    # teclear si le falta algo. Escribirlo dos veces es la forma de que un día
    # el aviso mande arreglar un venv que no es el que se está usando.
    local forge_python="$PROJECT_DIR/.venv/bin/python"
    # Vive en OTRO repositorio: lo usa más de un proyecto y ne-fan es un
    # consumidor suyo, no su dueño. Si no está clonado se dice y se sigue —
    # el resto del stack funciona, solo que sin personajes vestidos.
    if [[ ! -d "$SPRITE_FORGE_DIR" ]]; then
        salud_sprite_forge --sin-repo "$SPRITE_FORGE_DIR"
        return 0
    fi
    require_port_free "$PORT_FORGE" "sprite-forge" || return 1
    (
        cd "$PROJECT_DIR" || exit 1
        # El worker de repintado es Python y corre con ESTE venv, así que ESTE
        # venv tiene que traer `python/requirements.txt` de sprite-forge entero
        # (fastapi, uvicorn, Pillow, httpx y rembg). Si le falta algo, el
        # servicio sirve hojas base y publica `skin.enabled:false` con el
        # motivo — y el preflight de abajo lo lee y lo dice.
        # shellcheck disable=SC1091
        source .venv/bin/activate
        # La clave de imagen: ne-fan la llama MESHY_API_KEY en .env y el
        # servicio, que no sabe de proveedores concretos, SPRITE_FORGE_IMAGE_KEY.
        # Se traduce aquí, que es la frontera. Si no está, el servicio sirve
        # hojas base y lo DICE en /catalog (no finge repintar).
        export SPRITE_FORGE_IMAGE_KEY="${SPRITE_FORGE_IMAGE_KEY:-$(dotenv_get MESHY_API_KEY)}"
        export SPRITE_FORGE_PYTHON="$forge_python"
        cd "$SPRITE_FORGE_DIR" || exit 1
        # Los assets de personaje los pone quien despliega: aquí, los de ne-fan.
        # Y también el SET y la CACHÉ (#369-R10): el vocabulario de anims es de
        # ne-fan —quick/heavy/medium/defensive/precise son sus cinco tipos de
        # ataque— y los GB de PNG que salen de renderizarlas tienen que caer
        # dentro del árbol que ne-fan gestiona, no en la caché de un repo
        # hermano que ningún prune de este proyecto mira. Mover la caché NO
        # repaga arte: `base_key` no lleva ni la ruta ni el nombre del set, y
        # las hojas base son deterministas y gratis (~9 s cada una).
        exec node bin/sprite-forge.mjs serve \
            --assets "$PROJECT_DIR/assets/characters" --port "$PORT_FORGE" \
            --set "$PROJECT_DIR/nefan-core/data/sprite-set.json" \
            --cache "$PROJECT_DIR/nefan-core/cache/sprite_base_sheets"
    ) >"$LOG_DIR/nefan-sprite-forge.log" 2>&1 &
    track_started $! "$PORT_FORGE"
    # No basta con que /catalog conteste 200: contesta 200 con el repintado
    # APAGADO, que es el ✅ mentiroso de #367.
    # Las tres rutas del remedio las sabe ESTE script, no el repo hermano: el
    # motivo que publica el servicio habla de SU árbol (`pip install -r
    # python/requirements.txt`), y ese fichero no existe aquí mientras que el
    # venv que hay que arreglar sí es el nuestro.
    salud_sprite_forge --url "http://127.0.0.1:$PORT_FORGE/catalog" --espera 90 \
        --repo "$SPRITE_FORGE_DIR" --python "$forge_python" --env "$PROJECT_DIR/.env"
    echo "   sprite-forge :$PORT_FORGE  (log: $LOG_DIR/nefan-sprite-forge.log)"
    return 0
}

start_narrative_mcp() {
    # NEFAN_EAGER_BIND=0: NO arrancar el placeholder — el terminal de Claude
    # Code del motor será el único dueño del puerto MCP (flujo de labs/narrative,
    # cuyo README pide expresamente no robarle el puerto).
    if [[ "$NEFAN_EAGER_BIND" == "0" ]]; then
        echo "⏭  narrative-mcp NOT started (NEFAN_EAGER_BIND=0): el terminal del motor poseerá :$PORT_NARR"
        return 0
    fi
    require_port_free "$PORT_NARR" "narrative-mcp" || return 1
    # Recompilar SIEMPRE: `tsc -b` es incremental (no-op en ~0,1 s si está
    # fresco) y detecta también cambios en los contratos de nefan-core, que un
    # `find -newer` sobre narrative-mcp/*.ts no vería. Un dist viejo ejecuta
    # silenciosamente código de otro día y es indistinguible de un bug.
    echo "🛠  narrative-mcp: building (tsc -b incremental)..."
    ( cd "$PROJECT_DIR/narrative-mcp" && npm run build ) || return 1
    # NARRATIVE_EAGER_BIND: this standalone instance is a port placeholder, so it
    # must bind its port at startup (no narrative_listen ever drives it) to satisfy
    # wait_for_port below. Claude-Code-spawned instances bind lazily on first
    # narrative_listen, so opening a terminal for code work no longer steals the
    # bridge; the narrative terminal takes over this placeholder when it listens.
    ( cd "$PROJECT_DIR/narrative-mcp" && NARRATIVE_EAGER_BIND=1 exec node dist/server.js ) \
        >"$LOG_DIR/nefan-narrative.log" 2>&1 &
    track_started $! "$PORT_NARR"
    wait_for_port "$PORT_NARR" 20 "narrative-mcp" || return 1
    echo "✅ narrative-mcp :$PORT_NARR  (log: $LOG_DIR/nefan-narrative.log)"
}

start_ai() {
    require_port_free "$PORT_AI" "ai_server" || return 1
    (
        cd "$PROJECT_DIR" || exit 1
        # shellcheck disable=SC1091
        source .venv/bin/activate
        exec python -u ai_server/main.py
    ) >"$LOG_DIR/nefan-ai.log" 2>&1 &
    track_started $! "$PORT_AI"
    echo "⏳ ai_server is loading models (takes ~30s on first run)..."
    wait_for_http_health "http://localhost:$PORT_AI/health" 120 "ai_server" "$!" "$LOG_DIR/nefan-ai.log" || return 1
    echo "✅ ai_server :$PORT_AI  (log: $LOG_DIR/nefan-ai.log)"
}

start_html() {
    require_port_free "$PORT_HTML" "cliente HTML" || return 1
    ( cd "$PROJECT_DIR/nefan-html" && exec env NEFAN_HTML_PORT="$PORT_HTML" npx vite --host ) \
        >"$LOG_DIR/nefan-html.log" 2>&1 &
    track_started $! "$PORT_HTML"
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

  Tip: si el terminal del motor debe POSEER el puerto del MCP (flujo labs/narrative),
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

# Service slot index → key. Las MÁSCARAS de PRESET_PROFILES siguen siendo
# posicionales (una tabla se lee bien así), pero los CONSUMIDORES no: preguntan
# por clave con `on <clave>`. Añadir o quitar un servicio ya no puede desplazar
# en silencio lo que arranca un preset.
SERVICES=(bridge narrative-mcp ai_server html asset-store remote-gen sprite-forge fake-ai replay-server)
# Service slot index → display name. SIN puerto: los puertos ya no se escriben
# a mano en ningún sitio de este fichero (ver «Puertos», arriba). El menú los
# compone con el bloque vigente, así que con NEFAN_PORT_OFFSET la TUI enseña
# los de VERDAD y no los de un mundo sin desplazar.
SERVICE_LABELS=(
    "bridge"
    "narrative-mcp"
    "ai_server"
    "HTML"
    "asset-store"
    "remote-gen"
    "sprite-forge"
    "fake-ai-server"
    "replay-server"
)
# Service slot index → clave de `ports` en runtime_config.json. Es lo que lee
# `qa/presets.mjs` para saber qué puerto debe quedar escuchando por cada
# servicio: sigue derivando de este fichero (no copia una tabla propia) y sigue
# lanzando si a un servicio le falta el suyo. replay-server suplanta al bridge,
# así que comparte su puerto.
SERVICE_PORT_KEYS=(bridge narrative_ws ai_server html asset_store remote_gen sprite_forge fake_ai bridge)
# Puerto vigente (ya desplazado) de cada slot, en el mismo orden.
SERVICE_PORTS=("$PORT_BRIDGE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML" "$PORT_ASSETS" "$PORT_RGEN" "$PORT_FORGE" "$PORT_FAKE" "$PORT_BRIDGE")
# Service slot index → one-line hint
SERVICE_HINTS=(
    "shared TS logic + WebSocket (State API en el puerto siguiente)"
    "MCP bridge to Claude Code (NEFAN_EAGER_BIND=0 = lo posee el terminal del motor)"
    "Python narrative/LLM server"
    "Cliente web en primera persona (three.js) — el juego"
    "blobs + manifest SQLite + covers de estilos"
    "Meshy/fal + SAM2 + atlas fps + estilos — GASTA créditos si se invoca"
    "hojas de sprites de personaje (repo aparte ~/code/sprite-forge) — remote-gen lo necesita para vestir NPCs"
    "emula narrative-llm+remote-gen+asset-store — 0 créditos (bench)"
    "reproduce una sesión grabada como película (suplanta al bridge; LOG=runs/…/events.ndjson)"
)

# Índice del servicio con esa clave, o -1. Es la única función que traduce
# clave → posición: todo lo demás pregunta por clave.
svc_idx() {
    local key=$1 i
    for i in "${!SERVICES[@]}"; do
        [[ ${SERVICES[$i]} == "$key" ]] && { echo "$i"; return; }
    done
    echo -1
}

# ¿Está seleccionado el servicio <clave>? Sustituye a los ~18 `ACTIVE[n]` con
# índice literal que había, donde un desplazamiento arrancaba otro servicio sin
# que nadie se enterase.
on() {
    local i
    i=$(svc_idx "$1")
    if (( i < 0 )); then
        echo "❌ servicio desconocido en on(): $1" >&2
        return 2
    fi
    (( ACTIVE[i] == 1 ))
}

# Parejas que no pueden estar las dos a la vez: pelean por el mismo puerto.
# Al encender una en la TUI, se apaga su hermana. Por CLAVE, no por posición:
# era la última tabla que un servicio nuevo podía desplazar en silencio, y
# justo la que impide seleccionar dos servicios que se disputan un puerto.
# ai_server vs fake-ai (el motor narrativo); bridge vs replay-server (el gateway)
EXCLUSIVE_PAIRS=("ai_server fake-ai" "bridge replay-server")

# Presets: nombre + slug + descripción + bitmask posicional en el orden de
# SERVICES (mismo ancho que SERVICES — añadir un servicio obliga a tocar TODAS).
# El SLUG es la referencia estable: los números se renumeran cuando muere un
# preset (ya ha pasado), y un runner que cite "--preset 5" acaba arrancando
# otra cosa en silencio. Presets nuevos al final, antes de Custom.
PRESET_NAMES=(
    "Play"
    "Cliente web (dev)"
    "E2E sin créditos"
    "Story web sin imágenes"
    "Playtest motor (bench)"
    "Replay web (película)"
    "HTML fixtures"
    "Custom"
)
PRESET_SLUGS=(
    "play"
    "cliente-web"
    "e2e-sin-creditos"
    "story-web-sin-imagenes"
    "playtest-motor"
    "replay-web"
    "html-fixtures"
    "custom"
)
PRESET_DESCS=(
    "Stack completo + Claude Code + cliente web: historia, NPCs, mapas y diálogo — GASTA créditos con Imagen IA (Meshy/fal)"
    "bridge + HTML + asset-store + remote-gen (fps/estilos operativos) — solo gasta si activas Imagen IA en el juego"
    "fake-ai-server + bridge + HTML — todo mockeado, 0 créditos (bench E2E)"
    "motor narrativo con los servicios de imagen APAGADOS (sin remote-gen ni sprite-forge): imposible gastar en imágenes — juega en Maqueta 3D / y_bot"
    "bridge + ai_server + asset-store, SIN placeholder de narrative-mcp: el terminal del motor posee el puerto MCP (labs/narrative; conduce con game-emulator)"
    "replay-server + HTML: reproduce una sesión grabada como película, sin motor ni ai_server — renderer determinista (LOG=runs/…/events.ndjson)"
    "solo el cliente web: fixtures del selector Room + teclas dev, cero backend"
    "Lo que tengas seleccionado"
)
# El asset-store acompaña a cualquier preset con bridge o ai_server: el
# gateway resuelve assetExists contra el asset-store y los generadores registran ahí.
# remote-gen acompaña a los presets con ai_server; "Cliente web (dev)"
# también lo lleva (la vista fps pide /generate_surface_atlas y aplicar
# estilo pasa por /styles/*). "E2E sin créditos" usa el fake para TODO
# (emula también el asset-store): el bridge recibe NEFAN_AI_SERVER y el
# cliente se abre con ?ai= (URL impresa al arrancar).
# "Story web sin imágenes" quita remote-gen/sprite-forge a propósito: los
# pipelines de imagen del cliente quedan sin backend (elige Maqueta 3D).
# sprite-forge acompaña SIEMPRE a remote-gen: es de quien remote-gen obtiene
# las hojas de personaje. Sin él, /skin_sprite_sheet devuelve 503 y todos los
# NPC salen en maniquí — con el stack "arrancado" y sin pista de por qué.
#                  bridge  narr  ai  html  assets  rgen  forge  fake  replay
PRESET_PROFILES=(
    "1 1 1 1 1 1 1 0 0"   # Play
    "1 0 0 1 1 1 1 0 0"   # Cliente web (dev)
    "1 0 0 1 0 0 0 1 0"   # E2E sin créditos
    "1 1 1 1 1 0 0 0 0"   # Story web sin imágenes
    "1 0 1 0 1 0 0 0 0"   # Playtest motor (bench)
    "0 0 0 1 0 0 0 0 1"   # Replay web (película)
    "0 0 0 1 0 0 0 0 0"   # HTML fixtures
    "0 0 0 0 0 0 0 0 0"   # Custom (filled in from current selection)
)

# Live state — applied by TUI, consumed by launcher.
declare -a ACTIVE=(0 0 0 0 0 0 0 0 0)

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
    # De cada pareja en conflicto se conserva el slot recién encendido
    # (`keep_idx`) y se apaga el otro.
    local keep_idx=$1
    local pair ia ib
    for pair in "${EXCLUSIVE_PAIRS[@]}"; do
        ia=$(svc_idx "${pair% *}")
        ib=$(svc_idx "${pair#* }")
        if (( ia < 0 || ib < 0 )); then
            echo "❌ EXCLUSIVE_PAIRS nombra un servicio que no existe: $pair" >&2
            continue
        fi
        (( ACTIVE[ia] == 1 && ACTIVE[ib] == 1 )) || continue
        if (( keep_idx == ia )); then ACTIVE[ib]=0
        elif (( keep_idx == ib )); then ACTIVE[ia]=0
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
        k)              printf "STOP"  ; return ;;
        # Mayúscula = barrido del catálogo entero, incluido lo ajeno. Es una
        # tecla distinta a propósito: la peligrosa no puede ser la fácil.
        K)              printf "STOPALL"; return ;;
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
            local label
            label=$(printf "%-15s :%s" "${SERVICE_LABELS[$i]}" "${SERVICE_PORTS[$i]}")
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
        printf "  %s↑/↓%s navigate   %s→%s edit services   %sEnter%s launch   %ss%s status   %sk%s parar (lo tuyo)   %sK%s parar TODO   %sq%s quit\n" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" \
            "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" "$TUI_BOLD" "$TUI_RESET" \
            "$TUI_BOLD" "$TUI_RESET"
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
                    STOPALL)
                        tui_leave
                        cmd_stop todo
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
                    STOPALL)
                        tui_leave
                        cmd_stop todo
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
    # narrative-mcp (flujo playtest: el terminal del motor posee el puerto MCP, y el
    # diálogo de la pausa ofrece [s] saltar con detección de API key).
    TUI_NEEDS_PAUSE=0
    if on narrative-mcp || on ai_server; then
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

    # Con el bloque desplazado, los servicios que no lo honran se quedan
    # fuera: arrancarlos en su puerto de siempre mientras el resto del stack
    # vive cien números más allá es peor que no arrancarlos — su consumidor los
    # buscaría donde no están y el fallo aparecería tres capas más abajo.
    if (( PORT_OFFSET != 0 )); then
        local svc rechazados=()
        for svc in "${SERVICIOS_SIN_OFFSET[@]}"; do
            on "$svc" && rechazados+=("$svc")
        done
        if (( ${#rechazados[@]} )); then
            echo "❌ NEFAN_PORT_OFFSET=$PORT_OFFSET y este preset incluye ${rechazados[*]}."
            echo "   Esos servicios NO honran el desplazamiento (Python y sprite-forge leen"
            echo "   el snapshot, que es uno por checkout; el MCP lo posee el terminal del"
            echo "   motor). Arráncalos sin offset, o elige un preset que no los lleve"
            echo "   (e2e-sin-creditos, html-fixtures, replay-web)."
            return 1
        fi
    fi

    echo ""
    echo "▶ Launching selected services..."
    (( PORT_OFFSET != 0 )) && echo "   (bloque desplazado +$PORT_OFFSET — bridge :$PORT_BRIDGE, HTML :$PORT_HTML)"
    echo ""

    # Order: asset-store → sprite-forge → remote-gen → fake-ai → replay →
    # bridge → narrative-mcp → ai_server → (Claude pause) → html.
    # El asset-store va PRIMERO: ai_server hace count/prune al arrancar
    # y el gateway puede pedir assetExists temprano; remote-gen antes que
    # ai_server para que /segment ya lo vea al primer uso; el fake antes
    # que el bridge (que arranca apuntándole).
    on asset-store  && { start_asset_store   || return 1; }
    on sprite-forge && { start_sprite_forge  || return 1; }
    on remote-gen   && { start_remote_gen    || return 1; }
    on fake-ai      && { start_fake_ai       || return 1; }
    on replay-server && { start_replay       || return 1; }
    on bridge       && { start_bridge        || return 1; }
    on narrative-mcp && { start_narrative_mcp || return 1; }

    # Pausa de Claude Code SIN placeholder de narrative-mcp (flujo playtest,
    # labs/narrative/README): el terminal del motor debe POSEER el puerto MCP antes
    # de que ai_server intente conectar — pausar ANTES de arrancarlo.
    if (( TUI_NEEDS_PAUSE == 1 )) && ! on narrative-mcp; then
        pause_for_claude_code
    fi

    on ai_server && { start_ai || return 1; }

    # Con placeholder, la pausa va tras ai_server (el terminal del motor hace
    # takeover del placeholder al primer narrative_listen).
    if (( TUI_NEEDS_PAUSE == 1 )) && on narrative-mcp; then
        pause_for_claude_code
    fi

    on html && { start_html || return 1; }

    # URL del cliente: con el fake activo hay que abrirlo con ?ai= para que
    # TODOS los servicios del cliente (skins, atlas, estilos) resuelvan al fake.
    if on html; then
        # `&offset=` viaja en la URL porque el navegador no tiene entorno: es
        # como el cliente resuelve a sus servicios (State API incluida, que no
        # lleva override propio) dentro del bloque desplazado.
        local qs_offset=""
        (( PORT_OFFSET != 0 )) && qs_offset="&offset=$PORT_OFFSET"
        if on fake-ai; then
            cat <<EOF

  🌐 Cliente web (bench sin créditos):
     http://localhost:$PORT_HTML/?ai=http://127.0.0.1:$PORT_FAKE$qs_offset
     (añade &input=scripted para conducirlo con window.__nefan.inputDriver)
EOF
        else
            echo ""
            if (( PORT_OFFSET != 0 )); then
                echo "  🌐 Cliente web: http://localhost:$PORT_HTML/?offset=$PORT_OFFSET"
            else
                echo "  🌐 Cliente web: http://localhost:$PORT_HTML/"
            fi
        fi
    fi
    if on replay-server; then
        cat <<EOF
  🎞  Replay: el cliente reproduce la grabación al conectar (Reanudar la
     sesión del listado). Otra grabación: relanza con
     LOG=labs/narrative/runs/<ts>/events.ndjson ./start.sh
EOF
    fi
    # Bench de playtest (ai_server con el motor en otro terminal, sin
    # placeholder): recordar cómo se conduce.
    if on ai_server && ! on narrative-mcp && on bridge; then
        cat <<EOF

  🧪 Bench narrativo (labs/narrative): emula el juego con
     node labs/narrative/game-emulator.mjs   # API de control HTTP (CTRL_PORT)
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
        "remote-gen:$PORT_RGEN"
        "sprite-forge:$PORT_FORGE"
        "fake-ai:$PORT_FAKE"
        "HTML:$PORT_HTML"
    )
    snapshot_escuchando
    local pair name port
    for pair in "${pairs[@]}"; do
        name=${pair%:*}
        port=${pair#*:}
        if port_en_foto "$port"; then
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
ALL_PORTS=("$PORT_BRIDGE" "$PORT_STATE" "$PORT_NARR" "$PORT_AI" "$PORT_HTML" "$PORT_ASSETS" "$PORT_RGEN" "$PORT_FORGE" "$PORT_FAKE")

# La tecla `k`: parar el stack de ESTE worktree.
#
# Antes barría los nueve puertos del catálogo «lo hubiera arrancado este
# launcher o no», enumerando al dueño antes de matarlo. Con un agente en la
# máquina era servicial; con varios, enumerar no basta —el aviso lo lee quien
# pulsa la tecla, no la persona a la que se le está cayendo el stack—, y es
# justo el arma que multiplica poder arrancar varios stacks a la vez.
#
# Lo propio son dos conjuntos: lo que arrancó ESTE proceso (STARTED_PORTS) y
# los puertos del catálogo cuyo proceso VIVE EN ESTE WORKTREE. El segundo es el
# que hace la tecla útil: quien la pulsa casi nunca ha arrancado nada en esa
# terminal —viene a limpiar un huérfano— y sin él `k` no serviría para nada.
#
# El barrido del catálogo entero sigue existiendo, pero hay que pedirlo:
# `./start.sh --parar-todo` o la tecla `K` (mayúscula) en el menú.
cmd_stop() {
    local todo=${1:-no}
    local -a puertos=("${ALL_PORTS[@]}")
    if [[ "$todo" == "todo" ]]; then
        echo "🛑 BARRIDO COMPLETO: se mata lo que ocupe los puertos del catálogo,"
        echo "   sea de quien sea (otro agente de esta máquina, el narrative-mcp"
        echo "   que posea el terminal del motor en :$PORT_NARR…)."
        echo "   Solo el bloque VIGENTE (+$PORT_OFFSET): matar a ciegas los diez"
        echo "   bloques se llevaría por delante servicios que no son de nadie aquí."
    else
        echo "🛑 parando el stack de ESTE worktree ($PROJECT_DIR):"
        # La versión SEGURA puede permitirse mirar los diez bloques, porque no
        # mata nada que no pueda demostrar que es suyo. Y hace falta: quien
        # arrancó con NEFAN_PORT_OFFSET no debería tener que acordarse del
        # número para poder parar.
        local base off
        puertos=()
        for off in 0 100 200 300 400 500 600 700 800 900; do
            for base in "${ALL_PORTS[@]}"; do puertos+=("$(( base - PORT_OFFSET + off ))"); done
        done
    fi
    # UNA foto de toda la tabla de sockets, y a partir de ahí solo se lanza un
    # proceso por puerto que de verdad esté ocupado. Antes eran 90 `fuser` en
    # serie (0,77 s) más otros dos por cada ocupado.
    snapshot_escuchando
    local port who pids alguno=0 saltados=0
    for port in "${puertos[@]}"; do
        port_en_foto "$port" || continue
        pids=$(pids_del_puerto "$port")
        who=$(owner_de_pids "$pids")
        if [[ "$todo" != "todo" ]] && ! worktree_de_pids "$pids"; then
            echo "    ⏭  :$port  ${who:-(desconocido)}  — AJENO, no se toca"
            saltados=1
            continue
        fi
        echo "    · :$port  ${who:-(desconocido)}"
        kill_port "$port"
        alguno=1
    done
    (( alguno == 0 )) && echo "    (nada que parar aquí)"
    if [[ "$todo" != "todo" ]] && (( saltados == 1 )); then
        echo "   Para llevarte también lo ajeno: ./start.sh --parar-todo (o la tecla K)."
    fi
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

# Ctrl+C y salida: para SOLO lo que arrancó este launcher. Antes barría los 9
# puertos del catálogo con SIGKILL arrancara o no ese servicio, así que un
# `Ctrl+C` en el preset más tonto se llevaba por delante el narrative-mcp del
# terminal del motor, o el servicio del preset que alguien acababa de levantar.
CLEANUP_DONE=0
cleanup() {
    tui_leave
    # El trap está en EXIT, INT y TERM: sin esto, un Ctrl+C lo ejecuta dos veces
    # (una por INT y otra por el EXIT que viene detrás) y lo cuenta dos veces.
    (( CLEANUP_DONE == 1 )) && return
    CLEANUP_DONE=1
    (( ${#STARTED_PIDS[@]} == 0 )) && return
    echo ""
    echo "🧹 parando lo que arrancó este launcher..."
    local pid p
    for pid in "${STARTED_PIDS[@]}"; do
        kill_tree "$pid"
    done
    # Un puerto NUESTRO que sobreviva a su proceso se libera, pero diciéndolo:
    # un puerto ajeno no se toca ni aunque esté en el catálogo.
    for p in "${STARTED_PORTS[@]}"; do
        if port_busy "$p"; then
            echo "    ⚠️  :$p sigue ocupado tras parar su proceso — liberándolo"
            kill_port "$p"
        fi
    done
}
trap cleanup EXIT INT TERM

# ─── Modo no interactivo ───────────────────────────────────────

# `./start.sh --preset <slug|N>` arranca un preset sin TUI y sin teclas. Existe
# para que un runner pueda levantar el stack: el bench de QA (qa/run.mjs)
# necesita "e2e-sin-creditos" sin que haya nadie pulsando Enter. Mismo camino
# que la TUI — aplica la misma máscara, corre el mismo preflight y llama al
# mismo run_selection: si divergieran, el bench probaría un arranque que ningún
# jugador usa.
#
# Se acepta el SLUG además del número porque el número se mueve: cuando muere
# un preset, los de debajo se desplazan ("E2E sin créditos" ya pasó del 5 al 3).
# Un runner que cite el número acaba levantando otro stack y fallando por
# timeout, sin decir por qué. El slug no se desplaza.
usage() {
    echo "Uso: ./start.sh [--preset <slug|N>] [--list] [--parar] [--parar-todo]"
    echo "  sin argumentos      menú interactivo"
    echo "  --preset <slug>     arranca ese preset sin TUI (referencia estable — recomendado)"
    echo "  --preset N          idem por número (1-based, como en el menú; se renumera)"
    echo "  --list              lista los presets y sale"
    echo "  --parar             para el stack de ESTE worktree (lo mismo que la tecla k)"
    echo "  --parar-todo        BARRIDO: mata lo que ocupe los puertos del catálogo,"
    echo "                      sea de quien sea. Enumera a cada dueño antes de matarlo."
}

list_presets() {
    local i
    for i in "${!PRESET_NAMES[@]}"; do
        printf "  %2d · %-24s %-24s %s\n" \
            "$((i + 1))" "${PRESET_SLUGS[$i]}" "${PRESET_NAMES[$i]}" "${PRESET_DESCS[$i]}"
    done
}

# slug o número → índice, o -1.
preset_idx_of() {
    local want=$1 i
    if [[ "$want" =~ ^[0-9]+$ ]]; then
        i=$((want - 1))
        (( i >= 0 && i < ${#PRESET_NAMES[@]} )) && { echo "$i"; return; }
        echo -1; return
    fi
    for i in "${!PRESET_SLUGS[@]}"; do
        [[ ${PRESET_SLUGS[$i]} == "$want" ]] && { echo "$i"; return; }
    done
    echo -1
}

run_preset_noninteractive() {
    local want="$1" idx
    idx=$(preset_idx_of "$want")
    if (( idx < 0 )); then
        echo "❌ preset desconocido: '$want'. Disponibles (nº · slug · nombre):" >&2
        list_presets >&2
        exit 2
    fi
    if [[ ${PRESET_SLUGS[$idx]} == "custom" ]]; then
        echo "❌ 'Custom' no tiene selección propia: elige un preset concreto." >&2
        exit 2
    fi
    # Sin apply_exclusivity: las máscaras de PRESET_PROFILES ya son coherentes
    # por construcción (esa función resuelve conflictos del toggle de la TUI).
    apply_preset "$idx"
    echo "▶ Preset $((idx + 1)) · ${PRESET_SLUGS[$idx]} · ${PRESET_NAMES[$idx]} (no interactivo)"
    preflight_services && run_selection
}

# ─── Entry point ───────────────────────────────────────────────

NONINTERACTIVE_PRESET=""
while (( $# )); do
    case "$1" in
        --preset) NONINTERACTIVE_PRESET="${2:-}"; shift 2 ;;
        --preset=*) NONINTERACTIVE_PRESET="${1#*=}"; shift ;;
        --list) list_presets; exit 0 ;;
        # Parar sin abrir la TUI. La distinción es la misma que la de las
        # teclas k/K: por defecto solo lo propio, el barrido bajo bandera.
        --parar) preflight_tools; cmd_stop; exit 0 ;;
        --parar-todo) preflight_tools; cmd_stop todo; exit 0 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "❌ opción desconocida: $1" >&2; usage >&2; exit 2 ;;
    esac
done

preflight_tools

if [[ -n "$NONINTERACTIVE_PRESET" ]]; then
    # El código de salida IMPORTA: desde que arrancar deja de matar al ocupante
    # de un puerto, "no arrancó nada" es un desenlace posible, y un runner
    # (qa/run.mjs, qa/presets.mjs) tiene que poder distinguirlo de un arranque
    # bueno. Antes esto salía 0 pasara lo que pasara.
    run_preset_noninteractive "$NONINTERACTIVE_PRESET"
    exit $?
fi

run_tui
case "$TUI_RESULT" in
    launch) preflight_services && run_selection ;;
    quit|*) exit 0 ;;
esac
