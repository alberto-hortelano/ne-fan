#!/usr/bin/env bash
# hybrid_capture.sh <tile> — captura para el pipeline híbrido:
#   runs/001_alternativas/hybrid/<tile>/base.png    render three.js con luz
#   runs/001_alternativas/hybrid/<tile>/masks.png   pasada de máscaras por occluder
#   runs/001_alternativas/hybrid/<tile>/masks.json  meta id/color/footprint/h
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
TILE="$1"
OUT="$LAB/runs/001_alternativas/hybrid/$TILE"
mkdir -p "$OUT"
PORT=8912

if ! curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  (cd "$LAB" && python3 serve.py >/dev/null 2>&1 &)
  for _ in $(seq 20); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.3; done
fi

BASEQS="scene=../exp2_three/plan_to_scene.mjs?v=4&plan=../fixtures/$TILE/plan.json&ground=../fixtures/$TILE/ground_crop.png&tex=../runs/001_alternativas/textures"
CHROME="google-chrome --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --force-device-scale-factor=1 --window-size=560,640"

$CHROME --virtual-time-budget=20000 --screenshot="$OUT/base.png" \
  "http://127.0.0.1:$PORT/exp2_three/viewer.html?$BASEQS" 2>/dev/null
$CHROME --virtual-time-budget=20000 --screenshot="$OUT/masks.png" \
  "http://127.0.0.1:$PORT/exp2_three/viewer.html?$BASEQS&mode=masks" 2>/dev/null
# --dump-dom a veces vuelca antes de que el viewer termine: reintentar.
# OJO: el DOM va a fichero — un pipe hacia `python3 -` con heredoc pierde el
# stdin (el heredoc del script pisa al pipe).
DOMTMP="$OUT/.dom_masks.html"
for attempt in 1 2 3 4; do
  $CHROME --virtual-time-budget=30000 --dump-dom \
    "http://127.0.0.1:$PORT/exp2_three/viewer.html?$BASEQS&mode=masks" 2>/dev/null > "$DOMTMP"
  if python3 - "$OUT/masks.json" "$DOMTMP" <<'EOF'
import html, json, sys
from html.parser import HTMLParser

class P(HTMLParser):
    inside = False
    buf: list

    def __init__(self):
        super().__init__()
        self.buf = []

    def handle_starttag(self, tag, attrs):
        if tag == "pre" and ("id", "scene-dump") in attrs:
            self.inside = True

    def handle_endtag(self, tag):
        if self.inside and tag == "pre":
            self.inside = False

    def handle_data(self, d):
        if self.inside:
            self.buf.append(d)

p = P()
p.feed(open(sys.argv[2], encoding="utf-8").read())
data = json.loads(html.unescape("".join(p.buf)))
masks = data.get("masks")
assert masks, "el dump no trae masks — ¿mode=masks llegó al viewer?"
open(sys.argv[1], "w").write(json.dumps(masks, indent=1, ensure_ascii=False))
print(f"{len(masks)} unidades -> {sys.argv[1]}")
EOF
  then break; fi
  echo "  dump-dom sin scene-dump (intento $attempt), reintentando…"
  [ "$attempt" = 4 ] && { echo "meta de máscaras inaccesible"; exit 1; }
done
rm -f "$DOMTMP"
echo "captura híbrida de $TILE completa -> $OUT"
