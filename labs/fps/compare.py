#!/usr/bin/env python3
"""Comparativa three.js vs Godot del bench FPS.

Modos:
  python3 compare.py runs/cmp_001 --scenes interior exterior
      Monta runs/cmp_001/index.html con las variantes lado a lado por pose
      (columnas = subdirectorios variante/<escena>/<pose>.png) y métricas
      simples (Δ luminancia mediana, % de píxeles con Δlum > 25 vs la
      primera columna). El juicio principal sigue siendo el checklist de
      director de arte del README.
  python3 compare.py --calibrate a.png b.png
      Mediana/media de luminancia global y por tercios (para calibrar las
      energías de EnvSetup contra three).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from labs.common.report import render_page, manifest_upsert  # noqa: E402
from labs.common.images import jpeg_data_uri  # noqa: E402

POSES = [f"p{i}" for i in range(8)]


def luminance_stats(path: Path) -> dict:
    img = Image.open(path).convert("L")
    px = list(img.getdata())
    px.sort()
    n = len(px)
    h = img.height
    w = img.width
    img_l = Image.open(path).convert("L")
    thirds = []
    for band in range(3):
        crop = img_l.crop((0, band * h // 3, w, (band + 1) * h // 3))
        data = sorted(crop.getdata())
        thirds.append(data[len(data) // 2])
    return {
        "median": px[n // 2],
        "mean": round(sum(px) / n, 1),
        "thirds_median": thirds,  # [cielo, medio, suelo]
    }


def diff_metrics(a: Path, b: Path) -> dict:
    ia = Image.open(a).convert("L")
    ib = Image.open(b).convert("L")
    if ia.size != ib.size:
        ib = ib.resize(ia.size)
    pa = ia.getdata()
    pb = ib.getdata()
    n = len(pa)
    big = sum(1 for x, y in zip(pa, pb) if abs(x - y) > 25)
    sa = sorted(pa)
    sb = sorted(pb)
    return {
        "d_median": sb[n // 2] - sa[n // 2],
        "pct_big_diff": round(100.0 * big / n, 1),
    }


def cmd_calibrate(a: str, b: str) -> None:
    for name, path in (("A", Path(a)), ("B", Path(b))):
        st = luminance_stats(path)
        print(f"{name} {path.name}: mediana={st['median']} media={st['mean']} "
              f"tercios(cielo/medio/suelo)={st['thirds_median']}")
    d = diff_metrics(Path(a), Path(b))
    print(f"Δmediana(B-A)={d['d_median']}  %píxeles Δ>25: {d['pct_big_diff']}%")


def cmd_report(run_dir: Path, scenes: list[str]) -> None:
    # 'three' es la referencia: siempre primera columna (base de las métricas).
    variants = sorted(
        (d.name for d in run_dir.iterdir()
         if d.is_dir() and any((d / s).is_dir() for s in scenes)),
        key=lambda v: (v != "three", v),
    )
    if not variants:
        sys.exit(f"compare: sin variantes en {run_dir} (esperaba <variante>/<escena>/pN.png)")
    manifest_path = run_dir / "manifest.json"
    rows: list[str] = []
    for scene in scenes:
        rows.append(f"<h2>{scene}</h2>")
        for pose in POSES:
            cells: list[str] = []
            base: Path | None = None
            entry: dict = {"file": f"{scene}/{pose}", "scene": scene, "pose": pose}
            for var in variants:
                png = run_dir / var / scene / f"{pose}.png"
                if not png.is_file():
                    cells.append(f"<td class='missing'>{var}: —</td>")
                    continue
                metrics = ""
                if base is None:
                    base = png
                else:
                    d = diff_metrics(base, png)
                    entry[var] = d
                    metrics = (f"<div class='m'>Δmed {d['d_median']:+d} · "
                               f"Δ&gt;25: {d['pct_big_diff']}%</div>")
                cells.append(
                    f"<td><div class='lbl'>{var}</div>"
                    f"<img src='{jpeg_data_uri(png, long_side=640)}'>{metrics}</td>")
            if base is None:
                continue
            manifest_upsert(manifest_path, entry, key="file")
            rows.append(f"<h3>{pose}</h3><table class='cmp'><tr>{''.join(cells)}</tr></table>")
    extra_css = """
    table.cmp{border-collapse:collapse} table.cmp td{padding:4px;vertical-align:top}
    table.cmp img{max-width:640px;display:block} .lbl{font-weight:bold;margin-bottom:2px}
    .m{color:#9a9;font-size:12px} .missing{color:#c66}
    """
    from labs.common.report import PAGE_CSS
    render_page("Bench FPS — three.js vs Godot", "\n".join(rows),
                run_dir / "index.html", css=PAGE_CSS + extra_css)
    print(f"compare: {run_dir / 'index.html'} ({len(variants)} variantes: {', '.join(variants)})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("run_dir", nargs="?", help="p.ej. runs/cmp_001")
    ap.add_argument("--scenes", nargs="+", default=["interior", "exterior"])
    ap.add_argument("--calibrate", nargs=2, metavar=("A", "B"))
    args = ap.parse_args()
    if args.calibrate:
        cmd_calibrate(*args.calibrate)
        return
    if not args.run_dir:
        ap.error("falta run_dir (o --calibrate)")
    cmd_report(Path(__file__).parent / args.run_dir, args.scenes)


if __name__ == "__main__":
    main()
