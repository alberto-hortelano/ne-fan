#!/usr/bin/env python3
"""Monta runs/<run>/index.html con three y godot lado a lado por pose."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from labs.common.report import render_page, PAGE_CSS  # noqa: E402
from labs.common.images import jpeg_data_uri  # noqa: E402

POSES = ["p0", "p1", "p2", "p3"]
NOTES = {
    "p0": "Postal desde el espigón: pueblo encendido, muelle, barcas, luna",
    "p1": "En el muelle: pescador, farolillos, faro entre la bruma",
    "p2": "El callejón: farol, fachadas y el mar enmarcado al fondo",
    "p3": "La taberna El Congrio: porche, tabernera a contraluz, cartel",
}


def main() -> None:
    run_dir = Path(__file__).parent / (sys.argv[1] if len(sys.argv) > 1 else "runs/001")
    variants = sorted((d.name for d in run_dir.iterdir() if d.is_dir()),
                      key=lambda v: (v != "three", v))
    if not variants:
        sys.exit(f"gen_report: sin variantes en {run_dir}")
    rows: list[str] = ["<p>Misma descripción (DESCRIPCION.md), autoría libre e independiente en cada motor.</p>"]
    for pose in POSES:
        cells = []
        for var in variants:
            png = run_dir / var / f"{pose}.png"
            if not png.is_file():
                cells.append(f"<td class='missing'>{var}: —</td>")
                continue
            cells.append(f"<td><div class='lbl'>{var}</div>"
                         f"<img src='{jpeg_data_uri(png, long_side=760)}'></td>")
        rows.append(f"<h3>{pose} — {NOTES[pose]}</h3><table class='cmp'><tr>{''.join(cells)}</tr></table>")
    extra = """
    table.cmp{border-collapse:collapse} table.cmp td{padding:4px;vertical-align:top}
    table.cmp img{max-width:760px;display:block} .lbl{font-weight:bold;margin-bottom:2px}
    .missing{color:#c66}
    """
    render_page("Cala de Brumaluz — three.js vs Godot (autoría libre)", "\n".join(rows),
                run_dir / "index.html", css=PAGE_CSS + extra)
    print(f"informe: {run_dir / 'index.html'}")


if __name__ == "__main__":
    main()
