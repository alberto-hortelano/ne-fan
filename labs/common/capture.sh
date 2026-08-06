#!/usr/bin/env bash
# capture.sh — captura headless de un viewer three.js servido en local.
# Unifica el bloque "servidor efímero + Chrome headless + virtual-time-budget"
# que repetían los capture.sh de escenografia y render.
#
# Uso: capture.sh <dir_a_servir> <ruta_url_con_query> <out.png> [WxH] [budget_ms] [puerto]
#   capture.sh "$LABS" "render/exp2_three/viewer.html?scene=..." out.png 560,640 20000
#
# Si el puerto ya responde se reutiliza ese servidor (p. ej. labs/serve.sh);
# si no, arranca un http.server efímero sirviendo <dir_a_servir>.
set -euo pipefail
DIR="$1"; URLPATH="$2"; OUT="$3"
SIZE="${4:-1600,1000}"; BUDGET="${5:-15000}"; PORT="${6:-8912}"

if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  (cd "$DIR" && python3 -m http.server "$PORT" >/dev/null 2>&1 &)
  for _ in $(seq 20); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.3; done
fi

google-chrome --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --force-device-scale-factor=1 --window-size="$SIZE" \
  --virtual-time-budget="$BUDGET" --screenshot="$OUT" "http://127.0.0.1:$PORT/$URLPATH" 2>/dev/null
echo "captura -> $OUT"
