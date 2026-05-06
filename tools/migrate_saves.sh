#!/usr/bin/env bash
# One-shot migration: copy any narrative saves from Godot's old per-app dir
# (~/.local/share/godot/app_userdata/Never Ending Fantasy/saves/) into the
# shared location (~/code/ne-fan/saves/) that both Godot and the HTML 2D
# client now use. Idempotent — re-running just no-ops.
set -euo pipefail

SRC="${HOME}/.local/share/godot/app_userdata/Never Ending Fantasy/saves"
DEST="${NEFAN_SAVES_DIR:-${HOME}/code/ne-fan/saves}"

if [[ ! -d "$SRC" ]]; then
  echo "migrate_saves: no legacy saves at '$SRC' (nothing to do)"
  exit 0
fi

mkdir -p "$DEST"

shopt -s nullglob
moved=0
for entry in "$SRC"/*/; do
  name="$(basename "$entry")"
  target="$DEST/$name"
  if [[ -e "$target" ]]; then
    echo "migrate_saves: skip '$name' (already in $DEST)"
    continue
  fi
  cp -r "$entry" "$target"
  moved=$((moved + 1))
  echo "migrate_saves: copied '$name' -> $target"
done
echo "migrate_saves: done ($moved sessions migrated)"
