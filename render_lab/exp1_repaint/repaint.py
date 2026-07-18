"""repaint.py — E1: img2img del tile COMPLETO con modelos alternativos (fal).

Reproduce el contrato del juego (blueprint prestretch a cuadrado + ref de
estilo por zona + prompt de repintado con proyección oblicua declarada) y
compara modelos por fidelidad de layout (score SAM2), coste y latencia.

Uso:
    python3 render_lab/exp1_repaint/repaint.py --tiles medieval [--only seedream4]
    python3 render_lab/exp1_repaint/repaint.py --tiles medieval,scifi --only nanobanana_pro,seedream4
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image

LAB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(LAB))
import common  # noqa: E402

RUN = LAB / "runs/001_alternativas"
MANIFEST = RUN / "manifest.json"

STYLE_REFS = {
    "medieval": common.REPO / "nefan-core/data/styles/medievo_crudo/settlement.jpg",
    "scifi": common.REPO / "nefan-core/data/styles/acero_neon/settlement.jpg",
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

#: Leyenda de la proyección oblicua — VERBATIM del generador del juego.
VIEW_LEGEND = (
    "Top-down 3/4 RPG game map. The plan is ALREADY projected: "
    "vertical volumes show their top plus a lit SOUTH facade and a "
    "shaded EAST side facade (tops lean slightly north-west), trees "
    "show a trunk under the canopy. Keep that projection and light "
    "direction exactly. "
)

REPAINT_BODY = (
    "The FIRST reference image is ONLY a schematic LAYOUT plan drawn "
    "with flat placeholder colours — it is NOT final art. Fully REPAINT "
    "the whole map in the painterly, richly textured style of the "
    "SECOND reference image: dense textured ground with colour variation, "
    "detailed tree canopies with individual foliage clumps, highlights and "
    "drop shadows, worn roads with edges blending into the terrain, "
    "individually drawn cobblestones or floor plates, walls with visible "
    "material blocks, roofs with visible plating or tiling. The finished "
    "map must NOT look flat, vector-like or diagram-like anywhere. "
    "Buildings drawn open (no roof, interior floors and furniture "
    "visible over low front walls) are CUTAWAY interiors — keep them "
    "open exactly as drawn; buildings drawn with a roof keep their "
    "roof. Keep every element in the SAME position, size, shape and "
    "height; follow the EXACT course and width of every road. Do NOT "
    "move, remove or merge buildings. Do NOT invent new buildings, "
    "walls, bridges or watercourses that are not in the blueprint. "
    "IMPORTANT: leave every fully transparent pixel of the first "
    "reference EXACTLY transparent-black — paint only where the plan "
    "has content. "
)

STYLE_ROLE_RULES = (
    "The SECOND reference image defines ONLY the art style (brushwork, "
    "palette, material rendering). Do NOT copy its layout, its buildings, "
    "its walls, its gates or its composition in any way. "
)

NO_WATER = (
    "This map contains NO water at all: do NOT paint any river, stream, "
    "canal, pond or lake anywhere. "
)

STYLE_RULES = (
    "The map must fill the ENTIRE image edge to edge, full bleed — NO border, "
    "NO margin, NO frame, NO text, NO watermark, NO characters, NO UI."
)

MODEL_SPECS: dict[str, dict] = {
    "nanobanana_pro": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "1:1"},
        "cost_usd": 0.15,
        "note": "BASELINE — el modelo del juego (camino Meshy) con prestretch",
    },
    "seedream4": {
        "endpoint": "fal-ai/bytedance/seedream/v4/edit",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
        "note": "candidato barato (5×) con fama de preservar estructura",
    },
    "qwen_edit": {
        "endpoint": "fal-ai/qwen-image-edit-plus",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
        "note": "editor multi-imagen de Alibaba (5× más barato)",
    },
    "kontext_max": {
        "endpoint": "fal-ai/flux-pro/kontext/max/multi",
        "params": {"aspect_ratio": "1:1", "guidance_scale": 3.5, "output_format": "png"},
        "cost_usd": 0.08,
        "note": "FLUX Kontext: editor diseñado para preservar el layout",
    },
    "gpt2_high": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high", "image_size": "square_hd"},
        "cost_usd": 0.17,
        "note": "el más caro y lento; techo de calidad img2img",
    },
}


def build_prompt(tile: str, has_water: bool) -> str:
    dump = json.loads((common.FIXTURES[tile] / "blueprint.json").read_text())
    desc = str(dump.get("scene_description") or "").strip()
    body = REPAINT_BODY + ("" if has_water else NO_WATER)
    return (
        VIEW_LEGEND + body + STYLE_ROLE_RULES
        + f"Render the scene as: {desc}. "
        + f"Overall art direction: {STYLE_TOKENS[tile]}. "
        + STYLE_RULES
    )


def tile_has_water(tile: str) -> bool:
    plan = json.loads((common.FIXTURES[tile] / "plan.json").read_text())
    ground = plan.get("map_ground") or ""
    import re

    m = re.search(r'<g id="water">(.*?)</g>', ground, re.S)
    return bool(m and m.group(1).strip())


def run_case(name: str, model: str, tile: str, client, suffix: str = "") -> dict:
    spec = MODEL_SPECS[model]
    blueprint = Image.open(common.FIXTURES[tile] / "blueprint.png")
    side = max(blueprint.size)
    prestretched = blueprint.resize((side, side), Image.LANCZOS)  # prestretch2, como el juego
    payload = {
        "prompt": build_prompt(tile, tile_has_water(tile)),
        "num_images": 1,
        **spec["params"],
        "image_urls": [
            common.png_data_uri(prestretched, long_side=768),
            common.jpeg_data_uri(STYLE_REFS[tile]),
        ],
    }
    t0 = time.time()
    out = common.fal_call(spec["endpoint"], payload, spec["cost_usd"], client, tag=name, extra_key=suffix)
    elapsed = out.get("_elapsed_s", round(time.time() - t0, 1))
    png = common.download_image(out["images"][0], client)
    # Des-estirar al aspect real del blueprint (el contrato del cliente).
    img = Image.open(io.BytesIO(png)).convert("RGB")
    img = img.resize(blueprint.size, Image.LANCZOS)
    (RUN / "images").mkdir(parents=True, exist_ok=True)
    out_path = RUN / "images" / f"{name}.png"
    img.save(out_path)
    metrics = common.score_image_for(tile, out_path, RUN / "overlays" / f"{name}.png", client)
    b = metrics.get("buildings") or {}
    print(f"  ✓ {name} ({elapsed}s) edif:{b.get('pct_matched')}% offset:{b.get('mean_offset_pct')}% "
          f"inventadas:{metrics.get('n_unmatched_big_masks')}")
    return {
        "name": name, "tile": tile, "model": model, "endpoint": spec["endpoint"],
        "cost_usd": spec["cost_usd"], "note": spec["note"], "prompt": payload["prompt"],
        "elapsed_s": elapsed, "metrics": metrics, "exp": "e1_repaint",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default="medieval")
    ap.add_argument("--only", default="")
    ap.add_argument("--suffix", default="", help="_r2, _r3 para repeticiones")
    ap.add_argument("--budget", type=float, default=5.0)
    args = ap.parse_args()
    tiles = [t for t in args.tiles.split(",") if t]
    only = {m for m in args.only.split(",") if m}
    models = [m for m in MODEL_SPECS if not only or m in only]

    cases = [(f"e1_{m}__{t}{args.suffix}", m, t) for t in tiles for m in models]
    est = sum(MODEL_SPECS[m]["cost_usd"] for _, m, _ in cases)
    print(f"{len(cases)} casos, coste estimado ~${est:.2f} (+SAM ~$0.01/img). "
          f"Gasto acumulado actual: ${common.total_spend():.2f}")
    if common.total_spend() + est > args.budget:
        raise SystemExit(f"superaría --budget {args.budget}: aborta (sube el flag si procede)")

    entries: list[dict] = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    client = common.fal_client()
    for name, model, tile in cases:
        try:
            entry = run_case(name, model, tile, client, args.suffix)
        except Exception as err:
            print(f"  ✗ {name}: {err}")
            entry = {"name": name, "tile": tile, "model": model, "error": str(err)[:400], "exp": "e1_repaint"}
        entries = [e for e in entries if e.get("name") != name] + [entry]
        MANIFEST.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
    print(f"gasto acumulado: ${common.total_spend():.2f}")


if __name__ == "__main__":
    main()
