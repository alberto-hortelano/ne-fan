"""compose_tile.py — E3: composición determinista suelo + sprites por asset.

Pega cada sprite RGBA en el bbox proyectado de su elemento, en orden de
baseline_y ascendente (el mismo depth-sort del compositor/cliente). No hay
SAM2: el occluder del juego ES el sprite (con baseline y huella declaradas) y
la colisión es la del plan.

Uso:
    python3 render_lab/exp3_sprites/compose_tile.py --tile medieval --route repaint
    python3 render_lab/exp3_sprites/compose_tile.py --tile medieval --route t2i
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
PX = common.PX_PER_UNIT
PAD = 2  # el mismo PAD de gen_sprites.raster_asset_svg

#: ruta t2i: element id → sprite de tipo reutilizable.
T2I_MAP = {
    "medieval": {
        "casa_calle_n": "casa", "casa_calle_s": "casa", "casa_adarve": "casa",
        "casa_zocodover": "casa", "horno_barrio": "casa", "taberna_serrana": "casa",
        "frutal_1": "frutal", "frutal_2": "frutal", "frutal_3": "frutal",
        "frutal_4": "frutal", "frutal_5": "frutal",
        "torre_adarve": "torre",
    },
    "scifi": {
        "bloque_o": "bloque", "bloque_e": "bloque",
        "mastil_plaza": "mastil",
        "puesto_mercado_1": "puesto", "puesto_mercado_2": "puesto", "puesto_mercado_3": "puesto",
    },
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", default="medieval")
    ap.add_argument("--route", default="repaint", choices=["repaint", "t2i"])
    ap.add_argument("--ground", default="repainted", choices=["repainted", "vector"])
    args = ap.parse_args()
    tile = args.tile

    dump = json.loads((common.FIXTURES[tile] / "blueprint.json").read_text())
    vb = dump["view_box"]

    if args.ground == "repainted":
        ground_path = RUN / "sprites" / tile / "ground_repainted.png"
    else:
        ground_path = common.FIXTURES[tile] / "ground_only.png"
    canvas = Image.open(ground_path).convert("RGBA")

    sprites_dir = RUN / "sprites" / tile / args.route
    missing: list[str] = []
    occluders = json.loads((common.FIXTURES[tile] / "occluders/occluders.json").read_text())
    plan = json.loads((common.FIXTURES[tile] / "plan.json").read_text())
    vol_by_id = {v["id"]: v for v in plan["volumes"]}

    #: (baseline, sprite_id, bbox_units, pad_units) — muros por tramo.
    jobs: list[tuple[float, str, tuple, float]] = []
    for e in dump["elements"]:
        vid = e["id"]
        if args.route == "repaint" and vol_by_id.get(vid, {}).get("type") == "wall":
            for occ in occluders:
                if occ["vid"] == vid:
                    jobs.append((occ["baseline_y"], occ["id"], tuple(occ["bbox"]), 0.0))
        else:
            # Mismo sesgo del compositor: torres y puertas se asientan SOBRE su
            # muro anfitrión y se pintan después de sus tramos.
            bias = 4.0 if vol_by_id.get(vid, {}).get("type") in ("tower", "gate") else 0.0
            jobs.append((e["baseline_y"] + bias, vid, tuple(e["bbox"]), 0.0 if args.route == "t2i" else PAD))

    occ_by_id = {o["id"]: o for o in occluders}
    for baseline, sid, bbox, pad in sorted(jobs, key=lambda j: j[0]):
        if args.route == "t2i":
            name = T2I_MAP[tile].get(sid)
            if name is None:
                missing.append(sid)
                continue
            path = sprites_dir / f"{name}.png"
        else:
            path = sprites_dir / f"{sid}.png"
        if not path.exists():
            missing.append(sid)
            continue
        if args.route == "repaint" and sid in occ_by_id and vol_by_id.get(occ_by_id[sid]["vid"], {}).get("type") == "wall":
            # Muros: el repaint por tramo discontinúa la estructura — usar el
            # vector del occluder tal cual (híbrido vector+IA), a resolución
            # del canvas y con fondo transparente.
            import io as _io
            import cairosvg
            svg_text = (common.FIXTURES[tile] / "occluders" / occ_by_id[sid]["file"]).read_text()
            x, y, w, h = bbox
            png = cairosvg.svg2png(
                bytestring=svg_text.encode(),
                output_width=max(4, round(w * PX)),
                output_height=max(4, round(h * PX)),
            )
            sprite = Image.open(_io.BytesIO(png)).convert("RGBA")
        else:
            sprite = Image.open(path).convert("RGBA")
        x, y, w, h = bbox
        box = (
            round((x - pad - vb["minX"]) * PX),
            round((y - pad - vb["minY"]) * PX),
            round((w + 2 * pad) * PX),
            round((h + 2 * pad) * PX),
        )
        sprite = sprite.resize((box[2], box[3]), Image.LANCZOS)
        canvas.alpha_composite(sprite, (box[0], box[1]))

    dest = RUN / "images" / f"e3_sprites_{args.route}__{tile}.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(dest)
    print(f"  ✓ {dest} ({len(jobs) - len(missing)} sprites, faltan: {missing or 'ninguno'})")


if __name__ == "__main__":
    main()
