#!/usr/bin/env bash
# Sirve labs/ entero en :8912 (reports de runs/, demos, galerías) sin caché.
# El lab de skinning tiene además su propio servidor interactivo (:8911,
# ./labs/skinning/serve.sh) porque genera bajo demanda vía FastAPI.
cd "$(dirname "$0")" && exec python3 serve.py "${1:-8912}"
