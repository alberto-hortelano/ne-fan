"""textures.py — set de texturas IA locales compartido por E2a (three.js) y
E4 (patterns). Usa TextureGenerator del ai_server (SD1.5+LCM-LoRA, seamless,
~1s/textura en la RTX 3060). $0.

Uso:
    python3 render_lab/exp2_three/textures.py [--out runs/001_alternativas/textures]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parent
sys.path.insert(0, str(REPO / "ai_server"))

#: (nombre, prompt) — el prompt entra en la plantilla "seamless tiling texture,
#: flat lit, no perspective, PBR albedo, {prompt}" del generador.
TEXTURES: list[tuple[str, str]] = [
    ("dirt", "packed dirt ground, dusty earth, small pebbles, warm tan brown"),
    ("grass", "short grass lawn, small tufts, subtle colour variation, medieval game map"),
    ("cobblestone", "worn cobblestone pavement, individual rounded stones, grey"),
    ("stone_wall", "medieval stone masonry wall, individual blocks, weathered mortar"),
    ("wood_planks", "wooden floor planks, visible grain, warm brown"),
    ("roof_tiles", "terracotta roof tiles in rows, weathered clay, orange red"),
    ("foliage", "dense tree canopy foliage from above, leaf clumps, deep green"),
    ("bark", "tree bark, vertical grooves, brown grey"),
    ("water", "calm water surface, gentle ripples, dark teal blue"),
    ("plaster", "old plaster wall, cracked whitewash, ochre stains"),
    ("concrete", "worn concrete slabs, industrial floor, grey panels with seams"),
    ("metal_plate", "brushed steel plating with rivets, sci-fi hull panels"),
    ("neon_trim", "dark metal panel with subtle cyan glow strips, sci-fi"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(LAB / "runs/001_alternativas/textures"))
    ap.add_argument("--only", default="", help="lista de nombres separados por coma")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {n for n in args.only.split(",") if n}

    from texture_generator import TextureGenerator

    gen = TextureGenerator()
    for name, prompt in TEXTURES:
        if only and name not in only:
            continue
        dest = out / f"{name}.png"
        if dest.exists():
            print(f"  [skip] {name} ya existe")
            continue
        result = gen.generate(prompt, seed=7)
        dest.write_bytes(result["albedo"])
        print(f"  ✓ {name} ({result['generation_time_ms']} ms) -> {dest}")


if __name__ == "__main__":
    main()
