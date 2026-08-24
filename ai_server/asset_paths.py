"""Dónde guarda ne-fan los sprite sheets de personaje que ha pagado.

Módulo mínimo sin dependencias: lo importan el adaptador de sprite-forge
(`routers/remote_generation.py`) y quien sirva esos frames, sin crear ciclos.

Ya no hay ruta a las hojas BASE: las produce sprite-forge, que es otro proceso
en otro repo. Que el Python leyera la salida de un CLI de Node desde el
directorio estático del cliente web era el acoplamiento que motivó sacarlo.
"""

from pathlib import Path

# Sheets VESTIDOS (lo que se ha pagado) + `heroes/`. Lo sirve el asset-store en
# /cache/sprite_sheet/{hash}/ y /cache/sprite_hero/{key}.
SKINNED_SHEETS_DIR = Path(__file__).resolve().parent.parent / "cache" / "sprite_sheets"
