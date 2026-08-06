#!/usr/bin/env bash
# capture.sh <scene_module> <plan_json> <ground_png> <out_png> [tex_dir]
# Rutas relativas a labs/render/. Delegado en labs/common/capture.sh
# (reutiliza labs/serve.sh en :8912 si está arriba, o arranca uno efímero).
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
LABS="$(cd "$LAB/.." && pwd)"
SCENE="$1"; PLAN="$2"; GROUND="$3"; OUT="$4"; TEX="${5:-runs/001_alternativas/textures}"

"$LABS/common/capture.sh" "$LABS" \
  "render/exp2_three/viewer.html?scene=../$SCENE&plan=../$PLAN&ground=../$GROUND&tex=../$TEX" \
  "$OUT" 560,640 20000
