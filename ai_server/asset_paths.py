"""Rutas compartidas de sprite sheets (base Mixamo y skinneados).

Módulo mínimo sin dependencias: lo importan tanto main.py (lifespan del
router de diagnóstico, /skin_sprite_sheet) como routers/cache_assets.py
(servir frames skinneados) sin crear ciclos de import.
"""

from pathlib import Path

# Where the HTML 2D client serves Mixamo sprite sheets from. Resolved relative
# to the project root so the ai_server can read them off disk and run img2img
# over each frame.
SPRITE_SHEETS_DIR = Path(__file__).resolve().parent.parent / "nefan-html" / "public" / "sprites"
SKINNED_SHEETS_DIR = Path(__file__).resolve().parent.parent / "cache" / "sprite_sheets"
