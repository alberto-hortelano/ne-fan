#!/usr/bin/env bash
# capture.sh <outdir> [poses...] — captura la escena Godot de labs/authoring.
# Siempre bajo xvfb (Forward+ usa la GPU real vía Vulkan, sin GLX).
set -euo pipefail
LAB="$(cd "$(dirname "$0")" && pwd)"
GODOT="${GODOT:-$HOME/Downloads/Godot_v4.6.1-stable_linux.x86_64}"
OUTDIR="$1"; shift || true
POSES=("$@")
[ ${#POSES[@]} -eq 0 ] && POSES=(p0 p1 p2 p3)
mkdir -p "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd)"
EXTRA=()
[ -n "${FRAMES:-}" ] && EXTRA=(--frames "$FRAMES")
for POSE in "${POSES[@]}"; do
  xvfb-run -a -s "-screen 0 1600x1000x24" "$GODOT" --path "$LAB" \
    --rendering-method forward_plus res://main.tscn -- \
    --pose "$POSE" --out "$OUTDIR/$POSE.png" "${EXTRA[@]}" 2>&1 \
    | grep -Ev "^(Godot Engine|OpenXR|Vulkan|.*NVIDIA)" || true
done
echo "capturas godot en $OUTDIR"
