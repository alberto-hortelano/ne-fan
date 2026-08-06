#!/usr/bin/env bash
# Launch the labs/skinning API + static server.
#
# Usage:
#   ./labs/skinning/serve.sh           # default port 8911
#   ./labs/skinning/serve.sh 9000      # custom port
#
set -euo pipefail
PORT="${1:-8911}"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LAB_DIR/../.." && pwd)"

# Activate project venv if available so imports resolve
if [[ -f "$REPO_ROOT/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.venv/bin/activate"
fi

cd "$REPO_ROOT"
exec python3 "$LAB_DIR/lab_server.py" --port "$PORT"
