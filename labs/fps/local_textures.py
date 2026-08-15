"""local_textures.py — variante C-LOCAL del bench FPS: las celdas tileables se
generan GRATIS con el TextureGenerator del ai_server (SD1.5 + LCM-LoRA,
seamless por circular padding, ~1 s/textura en la 3060); las celdas hero se
quedan en clay (o se completan luego con gen.py --pages de la página hero).

    source .venv/bin/activate
    python3 labs/fps/local_textures.py --scene interior [--variant C] [--run local_interior]
→ runs/<run>/{layout.json, textures/<key>.png}  (mismo contrato que gen.py)
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent
REPO = LAB.parent.parent
sys.path.insert(0, str(REPO / "ai_server"))

#: SD1.5 entiende mejor prompts cortos de material que las frases largas del
#: atlas — versión corta por clase (fallback: la descripción del catálogo).
SHORT_PROMPTS = {
    "wall_plaster": "old lime plaster wall, beige, cracks",
    "wall_timber": "medieval half-timbered wall, dark oak beams, plaster",
    "wall_stone": "rough fieldstone wall, mortar joints",
    "stone_wall": "large stone blocks, fortress wall",
    "roof_tile": "terracotta roof tiles rows",
    "wood_planks": "rough wooden planks, weathered",
    "wood_floor": "worn wooden floorboards",
    "ceiling_planks": "dark wood ceiling boards",
    "wood_beam": "dark oak wood beam",
    "stone_floor": "worn stone flagstones",
    "ground_dirt": "packed dirt ground, small stones",
    "ground_grass": "grass meadow ground",
    "path_cobble": "cobblestone path",
    "bark": "tree bark",
    "foliage": "dense leafy foliage",
    "water": "dark still water surface",
    "thatch": "straw thatch roof",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", default="interior")
    ap.add_argument("--variant", default="C")
    ap.add_argument("--run", default="")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    run_dir = LAB / "runs" / (args.run or f"local_{args.scene}")
    run_dir.mkdir(parents=True, exist_ok=True)
    out = subprocess.run(
        ["node", str(LAB / "dump_layout.mjs"), args.scene, args.variant, "1024"],
        capture_output=True, text=True, check=True,
    )
    (run_dir / "layout.json").write_text(out.stdout)
    layout = json.loads(out.stdout)

    from texture_generator import TextureGenerator  # noqa: E402 (import pesado)

    gen = TextureGenerator()
    tex_dir = run_dir / "textures"
    tex_dir.mkdir(exist_ok=True)
    done = skipped = 0
    for page in layout["pages"]:
        for cell in page["cells"]:
            out_path = tex_dir / f"{cell['key']}.png"
            if cell["kind"] != "tile":
                skipped += 1
                continue  # heroes: clay (o gen.py sobre la página hero)
            if out_path.exists():
                done += 1
                continue
            prompt = SHORT_PROMPTS.get(cell["mat"], cell["en"])
            result = gen.generate(prompt, seed=args.seed)
            Image.open(io.BytesIO(result["albedo"])).save(out_path)
            done += 1
            print(f"  ✓ {cell['key']} ({result.get('generation_time_ms', '?')} ms)")
    print(f"{done} texturas locales, {skipped} heroes sin pintar → {tex_dir}")


if __name__ == "__main__":
    main()
