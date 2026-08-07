#!/usr/bin/env bash
# capture.sh — captura las plantillas clay de estilos.
#
# PROSCENIO: escenas three.js del bench labs/escenografia/greybox (cámara de
# cine DENTRO de la escena — decisión 2026-08-07: las plantillas de plató NO
# salen del builder de producción, su encuadre anamórfico ancho deforma y
# aleja; el bench es la referencia estética validada).
# OBLICUA: render del builder de producción (tile-greybox) vía la página dev
# de nefan-html — requiere `npm run dev` (:3000).
#
# Uso:
#   ./labs/plantillas/capture.sh stage stage_street      # una plantilla de plató
#   ./labs/plantillas/capture.sh tile settlement         # una plantilla oblicua
#   ./labs/plantillas/capture.sh all                     # las 15 (6 plató + 9 oblicuas)
#
# Salida: nefan-core/data/styles/_plantilla/{proscenio|oblicua}/<nombre>.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLANTILLA="$ROOT/nefan-core/data/styles/_plantilla"
LABS="$ROOT/labs"

# Categoría de plató → escena del bench que la encarna.
declare -A STAGE_SCENE=(
  [stage_street]=01_calle
  [stage_plaza]=02_plaza
  [stage_interior]=03_taberna
  [stage_nature]=04_bosque
  [stage_harbor]=05_puerto
  [stage_gate]=06_puerta
)
TILE_ZONES=(settlement farmland forest wetland desert snow fortress interior underground)

capture_stage() { # capture_stage <categoria>
  local CAT="$1" SCENE="${STAGE_SCENE[$1]:-}"
  [ -n "$SCENE" ] || { echo "categoría de plató desconocida: $CAT" >&2; exit 1; }
  mkdir -p "$PLANTILLA/proscenio"
  # 1600×1000: el encuadre del bench (gpt-image-2 lo recibe a 1280×800).
  "$LABS/common/capture.sh" "$LABS" \
    "escenografia/greybox/viewer.html?scene=./$SCENE/escena.mjs&pass=clay" \
    "$PLANTILLA/proscenio/$CAT.png" 1600,1000 15000
}

capture_tile() { # capture_tile <zona>
  if ! curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1; then
    echo "vite dev no responde en :3000 — arranca 'npm run dev' en nefan-html" >&2
    exit 1
  fi
  mkdir -p "$PLANTILLA/oblicua"
  # 1024² = el tile recortado a sus 128 celdas × 8 px (sin voladizos).
  google-chrome --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
    --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
    --virtual-time-budget=20000 --screenshot="$PLANTILLA/oblicua/$1.png" \
    "http://127.0.0.1:3000/dev/greybox-clay.html?mode=tile&scene=$1" 2>/dev/null
  echo "captura -> $PLANTILLA/oblicua/$1.png"
}

case "${1:-}" in
  stage) capture_stage "$2" ;;
  tile) capture_tile "$2" ;;
  all)
    for c in "${!STAGE_SCENE[@]}"; do capture_stage "$c"; done
    for z in "${TILE_ZONES[@]}"; do capture_tile "$z"; done
    ;;
  *) echo "uso: $0 stage <stage_*> | tile <zona> | all" >&2; exit 1 ;;
esac
