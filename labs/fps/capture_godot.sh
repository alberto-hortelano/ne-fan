#!/usr/bin/env bash
# capture_godot.sh <escena> <outdir> <parity|quality> [run] [poses...]
# Espejo de capture.sh para el bench Godot (labs/fps/godot): una captura
# 1600×1000 por pose vía xvfb-run (JAMÁS --headless: apaga el 3D).
# Sin poses explícitas captura p0..p7. run vacío ("") = clay.
set -euo pipefail
cd "$(dirname "$0")"

SCENE="${1:?uso: capture_godot.sh <escena> <outdir> <parity|quality> [run] [poses...]}"
OUTDIR="${2:?falta outdir}"
MODE="${3:?falta modo parity|quality}"
RUN="${4:-}"
shift $(( $# > 4 ? 4 : $# ))
POSES=("$@")
[ ${#POSES[@]} -eq 0 ] && POSES=(p0 p1 p2 p3 p4 p5 p6 p7)

GODOT="${GODOT:-$HOME/Downloads/Godot_v4.6.1-stable_linux.x86_64}"
mkdir -p "$OUTDIR"

for POSE in "${POSES[@]}"; do
  OUT="$(cd "$OUTDIR" && pwd)/${POSE}.png"
  ARGS=(--scene "$SCENE" --mode "$MODE" --pose "$POSE" --out "$OUT")
  [ -n "$RUN" ] && ARGS+=(--run "$RUN")
  xvfb-run -a -s "-screen 0 1920x1080x24" "$GODOT" --path godot \
    --rendering-method forward_plus res://main.tscn -- "${ARGS[@]}" \
    2>&1 | grep -E "push_error|SCRIPT ERROR|main:" || true
  [ -f "$OUT" ] || { echo "FALLO: no se generó $OUT" >&2; exit 1; }
done
echo "capture_godot: ${#POSES[@]} poses de $SCENE ($MODE${RUN:+, run $RUN}) en $OUTDIR"
