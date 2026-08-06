#!/usr/bin/env bash
# capture.sh <escena> [pass...]  — p.ej.: ./capture.sh 01_calle clay depth seg
# Sirve labs/escenografia/ en :8913 y captura greybox/<escena>/<pass>.png
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
SCENE="$1"; shift
PASSES=("${@:-clay}")
PORT=8913

if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  (cd "$LAB" && python3 -m http.server $PORT >/dev/null 2>&1 &)
  for _ in $(seq 20); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.3; done
fi

for PASS in "${PASSES[@]}"; do
  OUT="$LAB/greybox/$SCENE/$PASS.png"
  URL="http://127.0.0.1:$PORT/greybox/viewer.html?scene=./$SCENE/escena.mjs&pass=$PASS"
  google-chrome --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
    --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,1000 \
    --virtual-time-budget=15000 --screenshot="$OUT" "$URL" 2>/dev/null
  echo "captura -> $OUT"
done
