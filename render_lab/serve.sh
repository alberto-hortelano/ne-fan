#!/usr/bin/env bash
# Sirve render_lab en :8912 (reports de runs/ y demos) sin caché.
cd "$(dirname "$0")" && exec python3 serve.py
