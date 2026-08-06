#!/usr/bin/env bash
# capture.sh <escena> [pass...]  — p.ej.: ./capture.sh 01_calle clay depth seg
# Captura greybox/<escena>/<pass>.png delegando en labs/common/capture.sh
# (reutiliza labs/serve.sh en :8912 si está arriba, o arranca uno efímero).
set -euo pipefail
LAB="$(cd "$(dirname "$0")/.." && pwd)"
LABS="$(cd "$LAB/.." && pwd)"
SCENE="$1"; shift
PASSES=("${@:-clay}")

for PASS in "${PASSES[@]}"; do
  OUT="$LAB/greybox/$SCENE/$PASS.png"
  "$LABS/common/capture.sh" "$LABS" \
    "escenografia/greybox/viewer.html?scene=./$SCENE/escena.mjs&pass=$PASS" \
    "$OUT" 1600,1000 15000
done
