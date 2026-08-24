#!/usr/bin/env bash
# Sirve labs/ entero en :8912 (reports de runs/, demos, galerías) sin caché.
cd "$(dirname "$0")" && exec python3 serve.py "${1:-8912}"
