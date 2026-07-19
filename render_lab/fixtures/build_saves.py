"""build_saves.py — prepara los save-wrappers de los 2 tiles fixture.

- medieval: el save original del run 002 ya no existe; el plan se reconstruye
  desde sus artefactos: volumes del blueprints/oblique.json + map_ground
  extraído del SVG compuesto (compose incrusta innerSvg(map_ground) IDENTIDAD
  dentro de la capa de suelo, tras el detalle procedural — el primer
  `<g id=` interno marca el inicio del arte del LLM).
- scifi: scene_data directo del save real de colonia Umbral.

Emite runs/_cache/save_<tile>.json con el shape que espera dump_occluders.ts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parent
CACHE = LAB / "runs" / "_cache"

MEDIEVAL_DUMP = REPO / "style_lab/runs/002_repaint_fidelity/blueprints/oblique.json"
MEDIEVAL_SVG = REPO / "style_lab/runs/002_repaint_fidelity/blueprints/oblique.svg"
SCIFI_SAVE = REPO / "saves/1784313844-8cb4b5/state.json"


def extract_map_ground(composed_svg: str) -> str:
    """Recupera el map_ground embebido: contenido de la capa de suelo desde el
    primer grupo interno (`<g id="ground|water|deck">`) hasta el cierre de la
    capa (justo antes de `<g id="volumes">`)."""
    vol_idx = composed_svg.index('<g id="volumes">')
    ground_section = composed_svg[: vol_idx]
    # La capa exterior es `<g id="ground" ... clip-path=...>`; el arte del LLM
    # empieza en el primer `<g id="..."` SIN atributos extra (ground/water/deck).
    inner = re.search(r'<g id="(?:ground|water|deck)">', ground_section)
    if not inner:
        raise SystemExit("no se encontró el map_ground embebido en el SVG compuesto")
    body = ground_section[inner.start() :]
    # Quitar el </g> de cierre de la capa exterior.
    if not body.endswith("</g>"):
        raise SystemExit("la capa de suelo no termina donde se esperaba")
    body = body[: -len("</g>")]
    return f'<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">{body}</svg>'


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)

    # --- medieval (plazuela de Toledo, run 002) ---
    dump = json.loads(MEDIEVAL_DUMP.read_text())
    map_ground = extract_map_ground(MEDIEVAL_SVG.read_text())
    save = {
        "scenes_loaded": {
            "tile_0_0": {
                "scene_data": {
                    "map_ground": map_ground,
                    "volumes": dump["volumes"],
                    "biome": "dirt",  # base #8f7a52 del SVG compuesto = BIOME_COLORS.dirt
                    "scene_description": dump["scene_description"],
                    "style_tag": dump["style_tag"],
                }
            }
        }
    }
    out = CACHE / "save_medieval.json"
    out.write_text(json.dumps(save, ensure_ascii=False))
    print(f"medieval: map_ground {len(map_ground)}B, {len(dump['volumes'])} volumes -> {out}")

    # --- scifi (colonia Umbral, save real) ---
    state = json.loads(SCIFI_SAVE.read_text())
    entry = state["scenes_loaded"]["tile_0_0"]
    save = {"scenes_loaded": {"tile_0_0": {"scene_data": entry["scene_data"]}}}
    out = CACHE / "save_scifi.json"
    out.write_text(json.dumps(save, ensure_ascii=False))
    sd = entry["scene_data"]
    print(
        f"scifi: map_ground {len(sd.get('map_ground') or '')}B, "
        f"{len(sd.get('volumes') or [])} volumes declarados, biome={sd.get('biome')} -> {out}"
    )


if __name__ == "__main__":
    main()
