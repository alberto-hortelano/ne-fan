#!/usr/bin/env bash
# Sirve labs/render en :8912 (reports de runs/ y demos) sin caché.
cd "$(dirname "$0")" && exec python3 serve.py
