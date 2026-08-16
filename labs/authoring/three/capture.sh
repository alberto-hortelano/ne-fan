#!/usr/bin/env bash
# capture.sh <outdir> [poses...] — captura la escena three de labs/authoring.
set -euo pipefail
LAB="$(cd "$(dirname "$0")" && pwd)"
LABS="$(cd "$LAB/../.." && pwd)"
OUTDIR="$1"; shift || true
POSES=("$@")
[ ${#POSES[@]} -eq 0 ] && POSES=(p0 p1 p2 p3)
mkdir -p "$OUTDIR"
for POSE in "${POSES[@]}"; do
  "$LABS/common/capture.sh" "$LABS" "authoring/three/index.html?pose=$POSE" "$OUTDIR/$POSE.png" 1600,1000 20000
done
echo "capturas three en $OUTDIR"
