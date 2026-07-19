"""hybrid_pipeline.py — pipeline híbrido definitivo del bench:

  render three.js (base.png) ──repaint IA──▶ repainted.png
  pasada de máscaras (masks.png + masks.json)
       └──▶ recorte de sprites por máscara EXACTA (sin SAM2)
       └──▶ placa de fondo: huecos de los tall inpaintados (LaMa local)

Salidas en runs/001_alternativas/hybrid/<tile>/:
  repainted.png            imagen pictórica del tile (des-estirada)
  plate.png                fondo sin objetos altos (lo que revela el fade)
  sprites/<unit>.png       sprite RGBA por unidad de oclusión
  occluders.json           [{id, sprite, bbox_px, baseline_px, footprint, h}]

Uso:
    python3 render_lab/exp2_three/hybrid_pipeline.py --tile medieval [--model nanobanana_pro]
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

LAB = Path(__file__).resolve().parent.parent
REPO = LAB.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
VB = {"minX": -12, "minY": -32, "width": 140, "height": 160}
PX = 4  # px por celda de las capturas

STYLE_REFS = {
    "medieval": REPO / "nefan-core/data/styles/medievo_crudo/settlement.jpg",
    "scifi": REPO / "nefan-core/data/styles/acero_neon/settlement.jpg",
}
STYLE_TOKENS = {
    "medieval": (
        "gritty realistic medieval illustration, weathered stone and dust, rich "
        "material detail, candlelight and ink tones, painterly not photorealistic"
    ),
    "scifi": (
        "used-future industrial sci-fi colony, brushed steel and concrete, ochre "
        "haze, neon signage accents, painterly not photorealistic"
    ),
}
MODELS = {
    "nanobanana_pro": {"endpoint": "fal-ai/nano-banana-pro/edit", "params": {"resolution": "1K", "aspect_ratio": "1:1"}, "cost": 0.15},
    "seedream4": {"endpoint": "fal-ai/bytedance/seedream/v4/edit", "params": {"image_size": "square_hd"}, "cost": 0.03},
}

PROMPT = (
    "The FIRST reference image is a simple 3D render with flat placeholder "
    "textures of a top-down 3/4 RPG game map — already projected (lit SOUTH "
    "facades, shaded EAST side facades, tops leaning slightly north-west). "
    "Fully REPAINT it in the painterly, richly textured style of the SECOND "
    "reference image: rich ground variation, detailed foliage, highlights and "
    "drop shadows, worn roads, individually drawn floor stones, walls with "
    "visible material blocks, roofs with visible tiling or plating. The result "
    "must NOT look flat or 3D-render-like anywhere. CRITICAL: keep EVERY "
    "building, wall, tree and object in the SAME position, size, shape, height "
    "and projection — do not move, add, remove or merge anything; follow the "
    "exact course and width of every road. Buildings shown open (no roof, "
    "interior visible) stay open exactly as drawn. The SECOND image defines "
    "ONLY the art style — do not copy its layout. Scene: {desc}. Art "
    "direction: {token}. Full bleed, no border, no text, no characters. "
    "The dark flat area outside the map stays plain dark."
)


def repaint(tile: str, model: str, client) -> Image.Image:
    hyb = RUN / "hybrid" / tile
    base = Image.open(hyb / "base.png").convert("RGB")
    side = max(base.size)
    prestretched = base.resize((side, side), Image.LANCZOS)
    desc = json.loads((common.FIXTURES[tile] / "plan.json").read_text())["scene_description"]
    spec = MODELS[model]
    payload = {
        "prompt": PROMPT.format(desc=desc, token=STYLE_TOKENS[tile]),
        "num_images": 1,
        **spec["params"],
        "image_urls": [
            common.png_data_uri(prestretched, long_side=768),
            common.jpeg_data_uri(STYLE_REFS[tile]),
        ],
    }
    out = common.fal_call(spec["endpoint"], payload, spec["cost"], client, tag=f"hybrid_{tile}_{model}")
    png = common.download_image(out["images"][0], client)
    img = Image.open(io.BytesIO(png)).convert("RGB").resize(base.size, Image.LANCZOS)
    img.save(hyb / "repainted.png")
    return img


def cut_sprites(tile: str, repainted: Image.Image) -> list[dict]:
    hyb = RUN / "hybrid" / tile
    masks_img = np.asarray(Image.open(hyb / "masks.png").convert("RGB"), dtype=np.int16)
    meta = json.loads((hyb / "masks.json").read_text())
    rep = np.asarray(repainted, dtype=np.uint8)
    h, w = masks_img.shape[:2]

    # Asignación por color más cercano de la paleta (bordes AA → el fondo negro
    # también compite; umbral de distancia evita comerse el suelo).
    palette = np.array(
        [[0, 0, 0]] + [[int(m["color"][i : i + 2], 16) for i in (1, 3, 5)] for m in meta],
        dtype=np.int16,
    )
    flat = masks_img.reshape(-1, 3)
    dists = np.linalg.norm(flat[:, None, :] - palette[None, :, :], axis=2)
    nearest = dists.argmin(axis=1)
    nearest[dists.min(axis=1) > 40] = 0  # ambiguo → fondo
    labels = nearest.reshape(h, w)

    (hyb / "sprites").mkdir(exist_ok=True)
    out_meta = []
    union_mask = np.zeros((h, w), dtype=np.uint8)
    for idx, m in enumerate(meta, start=1):
        mask = labels == idx
        if mask.sum() < 12:
            continue
        union_mask |= mask.astype(np.uint8)
        ys, xs = np.nonzero(mask)
        x0, x1 = xs.min(), xs.max() + 1
        y0, y1 = ys.min(), ys.max() + 1
        sprite = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        sprite[..., :3] = rep[y0:y1, x0:x1]
        # alpha = máscara dilatada 1px (sella el borde AA del repintado)
        sub = mask[y0:y1, x0:x1].astype(np.uint8)
        dil = sub.copy()
        dil[1:, :] |= sub[:-1, :]
        dil[:-1, :] |= sub[1:, :]
        dil[:, 1:] |= sub[:, :-1]
        dil[:, :-1] |= sub[:, 1:]
        sprite[..., 3] = dil * 255
        name = m["id"].replace(":", "_")
        Image.fromarray(sprite).save(hyb / "sprites" / f"{name}.png")
        out_meta.append(
            {
                "id": m["id"],
                "sprite": f"sprites/{name}.png",
                "bbox_px": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                "baseline_px": round((m["footprint"][3] + VB["minY"] * -1) * PX, 1),
                "footprint": m["footprint"],
                "h": m["h"],
                "proximity_only": m.get("proximity_only", False),
            }
        )
    (hyb / "occluders.json").write_text(json.dumps(out_meta, indent=1, ensure_ascii=False))

    # dilatar la unión ±4 px para la placa (mismo margen que el juego)
    for _ in range(4):
        d = union_mask.copy()
        d[1:, :] |= union_mask[:-1, :]
        d[:-1, :] |= union_mask[1:, :]
        d[:, 1:] |= union_mask[:, :-1]
        d[:, :-1] |= union_mask[:, 1:]
        union_mask = d
    Image.fromarray(union_mask * 255).save(hyb / "plate_mask.png")
    return out_meta


def build_plate(tile: str, repainted: Image.Image) -> None:
    hyb = RUN / "hybrid" / tile
    mask = Image.open(hyb / "plate_mask.png").convert("L")
    try:
        sys.path.insert(0, str(REPO / "ai_server"))
        from plate_inpainter import PlateInpainter

        buf_img, buf_mask = io.BytesIO(), io.BytesIO()
        repainted.save(buf_img, format="PNG")
        mask.save(buf_mask, format="PNG")
        plate_png = PlateInpainter().generate(buf_img.getvalue(), buf_mask.getvalue())
        Image.open(io.BytesIO(plate_png)).convert("RGB").save(hyb / "plate.png")
        print("  placa: LaMa local")
    except Exception as err:  # noqa: BLE001 — bench: degradar a cv2 con aviso
        print(f"  placa: LaMa no disponible ({err}); uso cv2.inpaint")
        import cv2

        rep = cv2.cvtColor(np.asarray(repainted), cv2.COLOR_RGB2BGR)
        out = cv2.inpaint(rep, np.asarray(mask), 5, cv2.INPAINT_TELEA)
        Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)).save(hyb / "plate.png")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", default="medieval")
    ap.add_argument("--model", default="nanobanana_pro", choices=list(MODELS))
    args = ap.parse_args()
    client = common.fal_client()
    repainted = repaint(args.tile, args.model, client)
    meta = cut_sprites(args.tile, repainted)
    build_plate(args.tile, repainted)
    print(f"  ✓ {args.tile}: {len(meta)} sprites recortados por máscara, placa lista")
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
