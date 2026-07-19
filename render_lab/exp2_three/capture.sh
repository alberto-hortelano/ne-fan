#!/usr/bin/env bash
# capture.sh <scene_module> <plan_json> <ground_png> <out_png> [tex_dir]
# Rutas relativas a render_lab/. Requiere serve.sh (o arranca uno efímero).
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="$1"; PLAN="$2"; GROUND="$3"; OUT="$4"; TEX="${5:-runs/001_alternativas/textures}"
PORT=8912

if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  (cd "$LAB" && python3 -m http.server $PORT >/dev/null 2>&1 &)
  for _ in $(seq 20); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.3; done
fi

URL="http://127.0.0.1:$PORT/exp2_three/viewer.html?scene=../$SCENE&plan=../$PLAN&ground=../$GROUND&tex=../$TEX"
google-chrome --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=560,640 \
  --virtual-time-budget=20000 --screenshot="$OUT" "$URL" 2>/dev/null
echo "captura -> $OUT"
