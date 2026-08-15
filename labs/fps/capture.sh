#!/usr/bin/env bash
# capture.sh <escena> <outdir> [run] [poses...] — captura las poses fijas del
# bench FPS delegando en labs/common/capture.sh (reutiliza :8912 si está
# arriba). Sin [poses] captura todas las de la escena (p0..p7).
#   ./capture.sh interior runs/clay_interior
#   ./capture.sh interior runs/003_c/poses runs/003_c p1 p4
set -euo pipefail
LAB="$(cd "$(dirname "$0")" && pwd)"
LABS="$(cd "$LAB/.." && pwd)"
SCENE="$1"
OUTDIR="$2"
RUN="${3:-}"
shift 2 || true
[ $# -gt 0 ] && shift || true
POSES=("$@")
if [ ${#POSES[@]} -eq 0 ]; then
  POSES=(p0 p1 p2 p3 p4 p5 p6 p7)
fi

mkdir -p "$OUTDIR"
for POSE in "${POSES[@]}"; do
  URL="fps/viewer.html?scene=$SCENE&pose=$POSE&hud=0"
  if [ -n "$RUN" ]; then URL="$URL&run=$RUN"; fi
  "$LABS/common/capture.sh" "$LABS" "$URL" "$OUTDIR/$POSE.png" 1600,1000 20000
done
echo "capturas en $OUTDIR"
