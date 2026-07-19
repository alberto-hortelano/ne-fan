"""score_all.py — puntúa la fidelidad de layout (SAM2) de las imágenes de los
experimentos que no la traen ya (E2a, E3, E4) y las añade al manifest del run.

E2b (freeform) NO se puntúa contra el blueprint: su layout es distinto por
diseño (el LLM inventó el suyo); su evaluación es la de gestión
(dumps/e2b_management_report.json).

Uso: python3 render_lab/score_all.py [--only e4_patterns__medieval]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
MANIFEST = RUN / "manifest.json"

#: (prefijo de imagen, exp, nota, coste_por_tile, badges)
CASES = [
    ("e2a_three", "e2a_three", "three.js determinista desde el plan + texturas SD1.5 locales", 0.0),
    ("e3_sprites_repaint", "e3_sprites", "sprites por asset (img2img del recorte) + suelo repintado", None),
    ("e3_sprites_t2i", "e3_sprites_t2i", "sprites por tipo (flux/schnell t2i) reutilizables", None),
    ("e4_patterns", "e4_patterns", "vector del compositor + texturas SD1.5 como patterns", 0.0),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {n for n in args.only.split(",") if n}

    entries: list[dict] = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    client = common.fal_client()
    for prefix, exp, note, cost in CASES:
        for tile in ("medieval", "scifi"):
            name = f"{prefix}__{tile}"
            img = RUN / "images" / f"{name}.png"
            if not img.exists() or (only and name not in only):
                continue
            metrics = common.score_image_for(tile, img, RUN / "overlays" / f"{name}.png", client)
            b = metrics.get("buildings") or {}
            print(f"  ✓ {name} edif:{b.get('pct_matched')}% offset:{b.get('mean_offset_pct')}% "
                  f"inventadas:{metrics.get('n_unmatched_big_masks')}")
            entry = {"name": name, "tile": tile, "exp": exp, "note": note,
                     "cost_usd": cost, "metrics": metrics}
            entries = [e for e in entries if e.get("name") != name] + [entry]
            MANIFEST.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
