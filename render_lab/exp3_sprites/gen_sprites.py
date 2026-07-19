"""gen_sprites.py — E3: un sprite RGBA por ASSET (volumen), sin SAM2.

Ruta 1 (fiel): extrae del blueprint compuesto los grupos `data-vid` de cada
volumen (ya proyectados con la cizalla), los rasteriza sobre blanco a ~512 px
y pide a un modelo img2img barato que REPINTE ese único asset conservando la
silueta; rembg local quita el fondo → sprite RGBA con alpha.

El sprite resultante ES el occluder del juego (baseline y huella declaradas
en elements/occluders.json) y la colisión sigue siendo la del plan: el paso
SAM2 y la placa inpainted desaparecen por construcción.

Uso:
    python3 render_lab/exp3_sprites/gen_sprites.py --tile medieval [--only casa_adarve]
    python3 render_lab/exp3_sprites/gen_sprites.py --tile medieval --route t2i
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
SPRITE_LONG_SIDE = 512
PAD = 2  # unidades de usuario alrededor del bbox

STYLE_TOKENS = {
    "medieval": "gritty painterly medieval RPG asset, weathered materials, rich texture",
    "scifi": "used-future sci-fi colony RPG asset, brushed steel and concrete, painterly",
}


def extract_vid_markup(svg: str, vid: str) -> list[str]:
    """Todos los fragmentos `<g data-vid="vid" ...>...</g>` (con anidados)."""
    frags = []
    for m in re.finditer(rf'<g data-vid="{re.escape(vid)}"', svg):
        i = m.start()
        depth = 0
        j = i
        while j < len(svg):
            nxt_open = svg.find("<g", j + 1)
            nxt_close = svg.find("</g>", j + 1)
            if nxt_close == -1:
                raise ValueError(f"SVG mal formado extrayendo {vid}")
            if nxt_open != -1 and nxt_open < nxt_close:
                depth += 1
                j = nxt_open
            else:
                if depth == 0:
                    frags.append(svg[i : nxt_close + 4])
                    break
                depth -= 1
                j = nxt_close
    return frags


def element_bbox_union(elements: list[dict], vid: str) -> tuple[float, float, float, float]:
    for e in elements:
        if e["id"] == vid:
            return tuple(e["bbox"])
    raise KeyError(vid)


def raster_asset_svg(markup: str, bbox: tuple[float, float, float, float]) -> Image.Image:
    """Rasteriza el asset sobre BLANCO al tamaño de trabajo del img2img."""
    import cairosvg

    x, y, w, h = bbox
    vb = f"{x - PAD} {y - PAD} {w + 2 * PAD} {h + 2 * PAD}"
    svg = f'<svg viewBox="{vb}" xmlns="http://www.w3.org/2000/svg">{markup}</svg>'
    scale = SPRITE_LONG_SIDE / max(w + 2 * PAD, h + 2 * PAD)
    png = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=round((w + 2 * PAD) * scale),
        output_height=round((h + 2 * PAD) * scale),
        background_color="#ffffff",
    )
    return Image.open(io.BytesIO(png)).convert("RGB")


def repaint_asset(img: Image.Image, label: str, tile: str, client, tag: str, cutaway: bool = False) -> Image.Image:
    cut = (
        "It is an OPEN roofless CUTAWAY interior seen from above (low front "
        "walls, furniture visible inside): keep it open exactly as drawn, do "
        "NOT add a roof or close it. "
        if cutaway
        else ""
    )
    prompt = (
        f"Repaint this single video-game map asset — {label} — in a painterly, "
        f"richly textured style: {STYLE_TOKENS[tile]}. It is shown in an oblique "
        "top-down 3/4 projection: top plus a lit SOUTH facade and a shaded EAST "
        f"side facade; KEEP the exact same silhouette, size, proportions and "
        f"projection. {cut}Plain solid WHITE background, no shadow outside the "
        "object, no text, no border, nothing else in the image."
    )
    payload = {
        "prompt": prompt,
        "num_images": 1,
        "image_size": "square_hd",
        "image_urls": [common.png_data_uri(img, long_side=768)],
    }
    out = common.fal_call("fal-ai/bytedance/seedream/v4/edit", payload, 0.03, client, tag=tag)
    png = common.download_image(out["images"][0], client)
    return Image.open(io.BytesIO(png)).convert("RGB")


def cut_alpha(img: Image.Image) -> Image.Image:
    from rembg import remove

    return remove(img).convert("RGBA")


#: Assets únicos por tile para la ruta t2i (reutilizables, sin blueprint).
T2I_PROMPTS = {
    "medieval": {
        "casa": "small medieval spanish house with terracotta gable roof and plaster walls",
        "frutal": "single fruit tree with round leafy canopy and visible trunk",
        "torre": "round medieval stone tower with crenellations",
    },
    "scifi": {
        "bloque": "brutalist sci-fi housing block, flat roof, concrete, small lit windows",
        "mastil": "sci-fi communications mast with dish antennas on a concrete base",
        "puesto": "small sci-fi market stall with metal counter and awning",
    },
}


def t2i_asset(name: str, prompt: str, tile: str, client) -> Image.Image:
    full = (
        f"{prompt}, single isolated video-game map asset, oblique top-down 3/4 view "
        "(seen mostly from above, lit south facade, shaded east side), "
        f"{STYLE_TOKENS[tile]}, plain solid white background, nothing else"
    )
    payload = {"prompt": full, "num_images": 1, "image_size": "square_hd", "enable_safety_checker": False}
    out = common.fal_call("fal-ai/flux/schnell", payload, 0.003, client, tag=f"t2i_{name}")
    png = common.download_image(out["images"][0], client)
    return Image.open(io.BytesIO(png)).convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", default="medieval")
    ap.add_argument("--only", default="")
    ap.add_argument("--route", default="repaint", choices=["repaint", "t2i"])
    ap.add_argument("--budget", type=float, default=8.0)
    args = ap.parse_args()
    tile = args.tile
    client = common.fal_client()

    out_dir = RUN / "sprites" / tile / args.route
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.route == "t2i":
        for name, prompt in T2I_PROMPTS[tile].items():
            dest = out_dir / f"{name}.png"
            if dest.exists():
                print(f"  [skip] {name}")
                continue
            img = t2i_asset(name, prompt, tile, client)
            cut_alpha(img).save(dest)
            print(f"  ✓ t2i {name} -> {dest.name}")
        print(f"gasto acumulado: ${common.total_spend():.2f}")
        return

    dump = json.loads((common.FIXTURES[tile] / "blueprint.json").read_text())
    svg = (common.FIXTURES[tile] / "blueprint.svg").read_text()
    occluders = json.loads((common.FIXTURES[tile] / "occluders/occluders.json").read_text())
    plan = json.loads((common.FIXTURES[tile] / "plan.json").read_text())
    vol_by_id = {v["id"]: v for v in plan["volumes"]}
    only = {v for v in args.only.split(",") if v}
    elements = dump["elements"]

    #: Los muros van por TRAMO del compositor (un sprite por chunk): un muro
    #: de 128 celdas como imagen única degenera (aspect extremo).
    def jobs():
        for e in elements:
            vid = e["id"]
            if only and vid not in only:
                continue
            vol = vol_by_id.get(vid, {})
            if vol.get("type") == "wall":
                for occ in occluders:
                    if occ["vid"] == vid:
                        yield (occ["id"], e["label"], occ["bbox"],
                               (common.FIXTURES[tile] / "occluders" / occ["file"]).read_text(),
                               False)
            else:
                frags = extract_vid_markup(svg, vid)
                if not frags:
                    print(f"  ✗ {vid}: sin markup en el SVG")
                    continue
                yield (vid, e["label"], e["bbox"], "".join(frags), bool(vol.get("cutaway")))

    todo = list(jobs())
    est = 0.03 * len(todo)
    if common.total_spend() + est > args.budget:
        raise SystemExit(f"superaría --budget {args.budget} (est +${est:.2f})")

    for sid, label, bbox, markup, cutaway in todo:
        dest = out_dir / f"{sid}.png"
        if dest.exists():
            print(f"  [skip] {sid}")
            continue
        if markup.startswith("<svg"):
            # occluder standalone: rasterizar tal cual (ya trae viewBox+margen)
            import cairosvg
            x, y, w, h = bbox
            scale = SPRITE_LONG_SIDE / max(w, h)
            png = cairosvg.svg2png(
                bytestring=markup.encode(),
                output_width=max(8, round(w * scale)),
                output_height=max(8, round(h * scale)),
                background_color="#ffffff",
            )
            base = Image.open(io.BytesIO(png)).convert("RGB")
        else:
            base = raster_asset_svg(markup, tuple(bbox))
        repainted = repaint_asset(base, label, tile, client, tag=f"{tile}_{sid}", cutaway=cutaway)
        # El repaint sale cuadrado (square_hd): devolver al aspect del raster
        # de entrada antes del recorte alpha.
        repainted = repainted.resize(base.size, Image.LANCZOS)
        cut_alpha(repainted).save(dest)
        print(f"  ✓ {sid} ({label}) -> {dest.name}")
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
