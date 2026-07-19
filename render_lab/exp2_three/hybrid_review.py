"""hybrid_review.py — retoque por VISIÓN del pipeline híbrido.

El modelo de visión (Claude, mirando review_grid.png) identifica los objetos
que el img2img INVENTÓ y los señala con cajas imprecisas en review.json;
SAM2 (box prompt, el mismo endpoint que usa el juego) recorta su silueta
exacta. Cada extra "keep" se convierte en sprite/occluder con la colisión que
la visión estimó mirando su BASE pintada; los "removes" se borran de la placa
(LaMa local); los "adjusts" corrigen la base de objetos declarados que el
repintado movió o torció.

Uso:
    python3 render_lab/exp2_three/hybrid_review.py --tile medieval --grid
    # → mirar review_grid.png, escribir review.json
    python3 render_lab/exp2_three/hybrid_review.py --tile medieval --apply
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
VB = {"minX": -12, "minY": -32, "width": 140, "height": 160}
PXC = 4  # px por celda de las capturas
SAM_BOX_MODEL = "fal-ai/sam2/image"
SAM_BOX_COST = 0.01


def px_to_cells(x: float, y: float) -> tuple[float, float]:
    return (x / PXC + VB["minX"], y / PXC + VB["minY"])


def cells_to_px(u: float, v: float) -> tuple[float, float]:
    return ((u - VB["minX"]) * PXC, (v - VB["minY"]) * PXC)


def cmd_grid(tile: str) -> None:
    hyb = RUN / "hybrid" / tile
    img = Image.open(hyb / "repainted.png").convert("RGB")
    draw = ImageDraw.Draw(img, "RGBA")
    for u in range(0, 129, 8):
        x, _ = cells_to_px(u, 0)
        draw.line([(x, 0), (x, img.height)], fill=(0, 255, 255, 90), width=1)
        draw.text((x + 2, 2), str(u), fill=(0, 255, 255, 220))
    for v in range(0, 129, 8):
        _, y = cells_to_px(0, v)
        draw.line([(0, y), (img.width, y)], fill=(0, 255, 255, 90), width=1)
        draw.text((2, y + 2), str(v), fill=(0, 255, 255, 220))
    out = hyb / "review_grid.png"
    img.save(out)
    print(f"rejilla en CELDAS (cian, cada 8) -> {out}")


def sam_box_mask(image: Image.Image, box_px: list[float], client) -> np.ndarray:
    """Silueta SAM2 de la caja imprecisa (payload de fal_client.segment_boxes)."""
    x, y, w, h = box_px
    payload = {
        "image_url": common.png_rgba_data_uri(image.convert("RGB"), long_side=max(image.size)),
        "box_prompts": [{
            "x_min": int(x), "y_min": int(y),
            "x_max": int(x + w), "y_max": int(y + h),
        }],
        "sync_mode": True,
        "output_format": "png",
    }
    out = common.fal_call(SAM_BOX_MODEL, payload, SAM_BOX_COST, client, tag=f"box {box_px}")
    mask_png = common.download_image(out["image"], client)
    arr = np.asarray(Image.open(io.BytesIO(mask_png)).convert("L").resize(image.size, Image.NEAREST))
    return arr > 127


def base_cells_from_mask(mask: np.ndarray, depth_cells: float) -> tuple[list[list[int]], list[float]]:
    """Banda de contacto con el suelo derivada de la SILUETA: contorno
    inferior de la máscara (por columna, el y máximo) suavizado y extruido
    `depth_cells` hacia el norte. En la oblicua los píxeles de contacto están
    a h=0 (imagen == mundo), así que la banda sigue EXACTAMENTE la
    inclinación pintada y no puede salirse del objeto en X.

    Devuelve (celdas [[u,v],...], bbox [u0,v0,u1,v1])."""
    h, w = mask.shape
    cols = np.where(mask.any(axis=0))[0]
    if len(cols) == 0:
        return [], [0, 0, 0, 0]
    bottom = np.full(w, -1.0)
    for x in cols:
        bottom[x] = np.nonzero(mask[:, x])[0].max()
    # Suavizado de mediana (ventana 9) solo sobre columnas con contenido.
    win = 4
    smoothed = bottom.copy()
    for x in cols:
        lo, hi = max(0, x - win), min(w, x + win + 1)
        vals = bottom[lo:hi]
        vals = vals[vals >= 0]
        smoothed[x] = np.median(vals)
    # Agrupar por columna de celda y extruir depth hacia el norte.
    cells: set[tuple[int, int]] = set()
    for x in cols:
        u = int(np.floor(x / PXC + VB["minX"]))
        v_contact = smoothed[x] / PXC + VB["minY"]
        v0 = int(np.floor(v_contact - depth_cells))
        v1 = int(np.floor(v_contact))
        for v in range(v0, v1 + 1):
            if 0 <= u < 128 and 0 <= v < 128:
                cells.add((u, v))
    cell_list = sorted(cells)
    us = [c[0] for c in cell_list]
    vs = [c[1] for c in cell_list]
    bbox = [min(us), min(vs), max(us) + 1, max(vs) + 1]
    return [list(c) for c in cell_list], bbox


def dilate(mask: np.ndarray, times: int) -> np.ndarray:
    m = mask.copy()
    for _ in range(times):
        d = m.copy()
        d[1:, :] |= m[:-1, :]
        d[:-1, :] |= m[1:, :]
        d[:, 1:] |= m[:, :-1]
        d[:, :-1] |= m[:, 1:]
        m = d
    return m


def inpaint(base: Image.Image, mask: np.ndarray) -> Image.Image:
    try:
        sys.path.insert(0, str(REPO / "ai_server"))
        from plate_inpainter import PlateInpainter

        buf_img, buf_mask = io.BytesIO(), io.BytesIO()
        base.save(buf_img, format="PNG")
        Image.fromarray(mask.astype(np.uint8) * 255).save(buf_mask, format="PNG")
        out = PlateInpainter().generate(buf_img.getvalue(), buf_mask.getvalue())
        return Image.open(io.BytesIO(out)).convert("RGB")
    except Exception as err:  # noqa: BLE001 — bench: degradar con aviso
        print(f"  LaMa no disponible ({err}); cv2.inpaint")
        import cv2

        bgr = cv2.cvtColor(np.asarray(base), cv2.COLOR_RGB2BGR)
        out = cv2.inpaint(bgr, mask.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
        return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))


def cmd_apply(tile: str) -> None:
    hyb = RUN / "hybrid" / tile
    review = json.loads((hyb / "review.json").read_text())
    repainted = Image.open(hyb / "repainted.png").convert("RGB")
    plate = Image.open(hyb / "plate.png").convert("RGB")
    rep = np.asarray(repainted)
    client = common.fal_client()

    extras_meta: list[dict] = []
    patch = {"add": [], "add_cells": [], "clear": []}
    plate_holes = np.zeros(rep.shape[:2], dtype=bool)

    for n, e in enumerate(review.get("extras", [])):
        if e.get("action") != "keep":
            continue
        base = e.get("base_cells")
        from_mask = e.get("base_from_mask", False)
        if e.get("solid", True) and not from_mask and base:
            patch["add"].append(base)
        if not e.get("tall", False):
            print(f"  extra bajo '{e['label']}': solo colisión {base}")
            continue
        mask = sam_box_mask(repainted, e["box_px"], client)
        if mask.sum() < 30:
            print(f"  ✗ extra '{e['label']}': SAM no devolvió silueta útil")
            continue
        if from_mask:
            cells, base = base_cells_from_mask(mask, e.get("depth_cells", 4))
            if e.get("solid", True):
                patch["add_cells"].extend(cells)
            print(f"    base desde silueta: {len(cells)} celdas, bbox {base}")
        plate_holes |= mask
        m = dilate(mask, 1)
        ys, xs = np.nonzero(m)
        x0, x1 = int(xs.min()), int(xs.max() + 1)
        y0, y1 = int(ys.min()), int(ys.max() + 1)
        sprite = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        sprite[..., :3] = rep[y0:y1, x0:x1]
        sprite[..., 3] = m[y0:y1, x0:x1].astype(np.uint8) * 255
        name = f"extra_{n}_{e['label'].replace(' ', '_')[:24]}"
        (hyb / "sprites").mkdir(exist_ok=True)
        Image.fromarray(sprite).save(hyb / "sprites" / f"{name}.png")
        extras_meta.append(
            {
                "id": name,
                "label": e["label"],
                "sprite": f"sprites/{name}.png",
                "bbox_px": [x0, y0, x1 - x0, y1 - y0],
                "footprint": base,
                "h": e.get("h", 6),
                "tall": True,
                "solid": e.get("solid", True),
            }
        )
        print(f"  ✓ extra '{e['label']}': sprite {x1-x0}x{y1-y0}, base {base}")

    remove_holes = np.zeros(rep.shape[:2], dtype=bool)
    for r in review.get("removes", []):
        mask = sam_box_mask(repainted, r["box_px"], client)
        if mask.sum() < 30:
            print(f"  ✗ remove '{r['label']}': sin silueta")
            continue
        remove_holes |= dilate(mask, 3)
        print(f"  ✓ remove '{r['label']}'")

    for a in review.get("adjusts", []):
        if a.get("clear_cells"):
            patch["clear"].append(a["clear_cells"])
        if a.get("base_from_mask") and a.get("box_px"):
            mask = sam_box_mask(repainted, a["box_px"], client)
            if mask.sum() < 30:
                print(f"  ✗ adjust '{a.get('id')}': sin silueta — conservo base_cells")
                if a.get("base_cells"):
                    patch["add"].append(a["base_cells"])
                continue
            cells, bbox = base_cells_from_mask(mask, a.get("depth_cells", 4))
            patch["add_cells"].extend(cells)
            print(f"  ✓ adjust '{a.get('id')}': base desde silueta ({len(cells)} celdas, bbox {bbox})")
            if a.get("occluder"):
                # El objeto pintado (lona incluida) pasa a ser sprite/occluder:
                # tapa al personaje detrás y se funde; su hueco sale de la placa.
                plate_holes |= mask
                m = dilate(mask, 1)
                ys, xs = np.nonzero(m)
                x0, x1 = int(xs.min()), int(xs.max() + 1)
                y0, y1 = int(ys.min()), int(ys.max() + 1)
                sprite = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
                sprite[..., :3] = rep[y0:y1, x0:x1]
                sprite[..., 3] = m[y0:y1, x0:x1].astype(np.uint8) * 255
                name = f"adjust_{a['id']}"
                (hyb / "sprites").mkdir(exist_ok=True)
                Image.fromarray(sprite).save(hyb / "sprites" / f"{name}.png")
                extras_meta.append(
                    {
                        "id": name,
                        "label": a["id"],
                        "sprite": f"sprites/{name}.png",
                        "bbox_px": [x0, y0, x1 - x0, y1 - y0],
                        "footprint": bbox,
                        "h": a.get("h", 4),
                        "tall": True,
                        "solid": True,
                    }
                )
                print(f"    + occluder '{a['id']}': la lona tapa al personaje detrás")
        elif a.get("base_cells"):
            patch["add"].append(a["base_cells"])
            print(f"  ✓ adjust '{a.get('id')}': base → {a.get('base_cells')}")

    holes = dilate(plate_holes, 4) | remove_holes
    if holes.any():
        plate = inpaint(plate, holes)
        plate.save(hyb / "plate.png")
        print(f"  placa re-inpaintada ({int(holes.sum())} px)")

    (hyb / "extras.json").write_text(json.dumps(extras_meta, indent=1, ensure_ascii=False))
    (hyb / "collision_patch.json").write_text(json.dumps(patch, indent=1, ensure_ascii=False))

    # Debug visual: repainted + colisiones del review (naranja=add rects,
    # magenta=add_cells de silueta, azul=clear) — comprobar de un vistazo que
    # las bandas quedan DENTRO de cada objeto.
    dbg = repainted.convert("RGBA")
    ov = Image.new("RGBA", dbg.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(ov)
    for u0, v0, u1, v1 in patch["clear"]:
        dd.rectangle([cells_to_px(u0, v0), cells_to_px(u1, v1)], fill=(60, 120, 255, 110))
    for u0, v0, u1, v1 in patch["add"]:
        dd.rectangle([cells_to_px(u0, v0), cells_to_px(u1, v1)], fill=(255, 170, 30, 120))
    for u, v in patch["add_cells"]:
        x, y = cells_to_px(u, v)
        dd.rectangle([x, y, x + PXC, y + PXC], fill=(255, 40, 200, 130))
    dbg.alpha_composite(ov)
    dbg.convert("RGB").save(hyb / "review_debug.png")
    print(f"  ✓ {tile}: {len(extras_meta)} extras, patch add={len(patch['add'])} clear={len(patch['clear'])}")
    print(f"gasto acumulado: ${common.total_spend():.2f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", required=True)
    ap.add_argument("--grid", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if args.grid:
        cmd_grid(args.tile)
    if args.apply:
        cmd_apply(args.tile)


if __name__ == "__main__":
    main()
