#!/usr/bin/env python3
"""Compara dos hojas de sprites y da verde o rojo.

Es el criterio de aceptación del port a three.js, ejecutable: mide encuadre,
silueta y tono de la hoja nueva contra una de referencia en vez de fiarse de que
"compila". Se usó para calibrar `DEFAULT_LIGHT_INTENSITY` en `render.mjs` y sirve
para recalibrarla si cambia three, el material o el modelo de color.

Uso:
    python3 tools/render-sprite-sheets/comparar.py NUEVA REFERENCIA [--todos]

donde cada ruta es un directorio {model}/{anim}/{angle}. Por ejemplo:

    python3 tools/render-sprite-sheets/comparar.py \\
        /tmp/sprites-nuevo/y_bot/idle/frontal_8 \\
        nefan-html/public/sprites/y_bot/idle/frontal_8

Qué comprueba y con qué tolerancia:

  * el conjunto de ficheros es idéntico (mismo número de PNG y mismos nombres);
  * `meta.json` casa campo a campo salvo `generated_at`; `duration` se compara
    numéricamente porque Godot la guardaba en float32 y aquí es float64;
  * bbox del canal alfa: ±3 px en cada uno de los cuatro lados. Es lo que caza
    un fallo de escala del FBX (Mixamo exporta en cm) y, sobre una locomoción,
    el lock de Hips XZ sin portar — sin él la bbox se desplaza frame a frame;
  * cobertura alfa (píxeles con a>0): ±5 %;
  * luminancia media de los píxeles con a>0: ±8 %.

Salida distinta de cero si algo se sale de tolerancia.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

BBOX_TOL_PX = 3
COVERAGE_TOL = 0.05
LUMINANCE_TOL = 0.08
# Precisión de `duration`: Godot la escribía como float32, aquí es float64.
DURATION_TOL = 1e-6


def frame_stats(path: Path) -> tuple[tuple[int, int, int, int], int, float]:
    """bbox del alfa, número de píxeles con a>0 y su luminancia media."""
    arr = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    mask = arr[:, :, 3] > 0
    if not mask.any():
        raise SystemExit(f"FATAL: {path} está completamente transparente")
    bbox = Image.fromarray((mask * 255).astype("uint8")).getbbox()
    rgb = arr[:, :, :3][mask]
    lum = 0.2126 * rgb[:, 0] + 0.7152 * rgb[:, 1] + 0.0722 * rgb[:, 2]
    return bbox, int(mask.sum()), float(lum.mean())


def compare_meta(new_dir: Path, ref_dir: Path) -> list[str]:
    fails: list[str] = []
    new = json.loads((new_dir / "meta.json").read_text())
    ref = json.loads((ref_dir / "meta.json").read_text())
    for key in sorted(set(new) | set(ref)):
        if key == "generated_at":
            continue
        a, b = new.get(key), ref.get(key)
        if key == "duration":
            if a is None or b is None or abs(a - b) / max(abs(b), 1e-9) > DURATION_TOL:
                fails.append(f"meta.duration: {a} vs {b}")
            else:
                print(f"  meta.duration      {a!r} ≈ {b!r}  ✔")
            continue
        if a != b:
            fails.append(f"meta.{key}: {a!r} vs {b!r}")
        else:
            print(f"  meta.{key:<14} {a!r}  ✔")
    return fails


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("nueva", type=Path)
    p.add_argument("referencia", type=Path)
    p.add_argument("--todos", action="store_true", help="comparar todos los frames, no una muestra")
    p.add_argument("--muestras", type=int, default=6, help="frames a muestrear si no se pasa --todos")
    args = p.parse_args()

    for d in (args.nueva, args.referencia):
        if not (d / "meta.json").exists():
            print(f"FATAL: {d} no parece una hoja (falta meta.json)", file=sys.stderr)
            return 2

    fails = compare_meta(args.nueva, args.referencia)

    new_pngs = sorted(f.name for f in args.nueva.glob("*.png"))
    ref_pngs = sorted(f.name for f in args.referencia.glob("*.png"))
    if new_pngs != ref_pngs:
        only_new = set(new_pngs) - set(ref_pngs)
        only_ref = set(ref_pngs) - set(new_pngs)
        fails.append(
            f"conjunto de PNG distinto: {len(new_pngs)} vs {len(ref_pngs)}"
            f" (sobran {len(only_new)}, faltan {len(only_ref)})"
        )
        print(f"  ficheros           {len(new_pngs)} PNG vs {len(ref_pngs)}  ✘")
    else:
        print(f"  ficheros           {len(new_pngs)} PNG + meta.json  ✔")

    shared = [f for f in new_pngs if f in set(ref_pngs)]
    if args.todos or len(shared) <= args.muestras:
        sample = shared
    else:
        step = len(shared) / args.muestras
        sample = [shared[int(i * step)] for i in range(args.muestras)]

    print(f"\n  {'frame':24} {'bbox Δ (l,t,r,b)':22} {'cobertura':>18} {'luminancia':>18}")
    for name in sample:
        nb, nc, nl = frame_stats(args.nueva / name)
        rb, rc, rl = frame_stats(args.referencia / name)
        d_bbox = tuple(n - r for n, r in zip(nb, rb))
        d_cov = (nc - rc) / rc
        d_lum = (nl - rl) / rl
        bad = []
        if max(abs(v) for v in d_bbox) > BBOX_TOL_PX:
            bad.append(f"bbox Δ{d_bbox} > ±{BBOX_TOL_PX} px")
        if abs(d_cov) > COVERAGE_TOL:
            bad.append(f"cobertura {d_cov:+.1%} > ±{COVERAGE_TOL:.0%}")
        if abs(d_lum) > LUMINANCE_TOL:
            bad.append(f"luminancia {d_lum:+.1%} > ±{LUMINANCE_TOL:.0%}")
        mark = "✘" if bad else "✔"
        print(
            f"  {name:24} {str(d_bbox):22} {nc:6d} ({d_cov:+6.1%}) "
            f"{nl:8.1f} ({d_lum:+6.1%}) {mark}"
        )
        fails += [f"{name}: {b}" for b in bad]

    print()
    if fails:
        print(f"ROJO — {len(fails)} comprobación(es) fuera de tolerancia:")
        for f in fails:
            print(f"  · {f}")
        return 1
    print(f"VERDE — {len(sample)} frame(s) comparados, todo dentro de tolerancia.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
