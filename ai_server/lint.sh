#!/usr/bin/env bash
# El lint de Python del repo, en UN sitio (#709): ruff y compileall sobre
# ai_server/ y labs/. Lo corren los dos lados con la misma definición: el job
# `ai-server` de CI (`bash ai_server/lint.sh`) y el bucle local (`npm run
# verify` → `npm run lint:py`). Antes solo lo corría CI, y un E741 pasó tres
# vueltas de verificación local con el job en rojo.
#
# labs/ entra en ruff desde #718, con SUS reglas y no las de ai_server/: viven
# en labs/ruff.toml, que dice por qué (ruff resuelve la config por fichero).
# Hasta entonces solo pasaba compileall, y un código muerto vivía allí sin que
# nadie lo viera.
#
# Nunca sale 0 sin haber corrido ruff: sin intérprete, sin ruff o con una ruff
# de otra versión que el pin de requirements-dev.txt, falla diciendo la orden
# exacta para arreglarlo.

set -euo pipefail

raiz=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$raiz"

fallo() {
  printf 'lint.sh: %s\n' "$1" >&2
  exit 1
}

# Intérprete, en orden: NEFAN_PYTHON (explícito: si está puesta y no vale, es
# un error, no un «prueba el siguiente») → el .venv de este árbol → el .venv
# del checkout principal cuando esto es un worktree (git-common-dir; ninguna
# ruta de máquina escrita aquí) → python3 del PATH (CI, tras setup-python).
if [ -n "${NEFAN_PYTHON+x}" ]; then
  [ -n "$NEFAN_PYTHON" ] || fallo "NEFAN_PYTHON está puesta pero vacía"
  [ -x "$NEFAN_PYTHON" ] || command -v "$NEFAN_PYTHON" >/dev/null 2>&1 \
    || fallo "NEFAN_PYTHON=$NEFAN_PYTHON no es un ejecutable"
  py=$NEFAN_PYTHON
elif [ -x "$raiz/.venv/bin/python" ]; then
  py=$raiz/.venv/bin/python
else
  py=""
  comun=$(git -C "$raiz" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  if [ -n "$comun" ] && [ -x "$(dirname "$comun")/.venv/bin/python" ]; then
    py=$(dirname "$comun")/.venv/bin/python
  elif command -v python3 >/dev/null 2>&1; then
    py=python3
  fi
  [ -n "$py" ] || fallo "no hay intérprete de Python: ni .venv en $raiz, ni en el checkout principal, ni python3 en el PATH. Crea uno: cd \"$raiz\" && python3 -m venv .venv && .venv/bin/pip install -r ai_server/requirements.txt -r ai_server/requirements-dev.txt"
fi

# El binario que se comprueba es el que se ejecuta: `-m ruff`, no `ruff` del PATH.
pin=$(sed -n 's/^ruff==\([^[:space:]]*\).*/\1/p' ai_server/requirements-dev.txt)
[ -n "$pin" ] || fallo "ai_server/requirements-dev.txt no fija la versión de ruff (ruff==X.Y.Z)"
instalada=$("$py" -m ruff --version 2>/dev/null | awk '{print $2}') || instalada=""
if [ -z "$instalada" ]; then
  fallo "ruff no está instalado en $py. Instálalo: \"$py\" -m pip install -r \"$raiz/ai_server/requirements-dev.txt\""
fi
if [ "$instalada" != "$pin" ]; then
  fallo "ruff $instalada en $py, pero el pin (el que instala CI) es $pin. Instálalo: \"$py\" -m pip install -r \"$raiz/ai_server/requirements-dev.txt\""
fi

"$py" -m ruff check ai_server labs
"$py" -m compileall -q ai_server labs

echo "lint.sh: ruff $instalada + compileall OK ($py)"
