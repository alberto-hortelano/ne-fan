"""fidelity.py — bench de FIDELIDAD DE LAYOUT del repintado de blueprints.

Mide cuánto respeta cada (formato de blueprint × modelo de imagen) las huellas
declaradas por el compositor: la colisión del juego sale de esas huellas, así
que cualquier deriva del pintado desalinea colisiones e imagen.

Flujo (cada paso valida antes de gastar):
  python labs/style/fidelity.py raster            # SVG → PNG (gratis)
  python labs/style/fidelity.py overlay-expected  # bbox esperados sobre el blueprint (gratis)
  python labs/style/fidelity.py score --image <png> --format oblique --name <slug>
  python labs/style/fidelity.py generate [--only caso1,caso2] [--formats oblique,topdown,iso]
  python labs/style/fidelity.py report            # index.html

Los blueprints salen de dump_blueprint.ts (working tree = oblique; worktree de
HEAD = topdown/iso). El scoring segmenta con SAM2 (fal.ai) y casa los
segmentos contra los elements del compositor con la métrica del cliente
(fidelity_score.py). Requiere FAL_KEY en el entorno o en el .env de la raíz.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))
from labs.common import fidelity_score as fs  # noqa: E402
from labs.common import sam as _sam  # noqa: E402
from labs.common.env import load_key  # noqa: E402
from labs.common.fal import FAL_BASE, download_image  # noqa: E402
from labs.common.images import PX_PER_UNIT, jpeg_data_uri, png_data_uri  # noqa: E402,F401

RUN_DIR = Path(__file__).resolve().parent / "runs" / "002_repaint_fidelity"
BLUEPRINTS = RUN_DIR / "blueprints"
IMAGES = RUN_DIR / "images"
MASKS = RUN_DIR / "masks"
OVERLAYS = RUN_DIR / "overlays"
MANIFEST = RUN_DIR / "manifest.json"

FORMATS = ("oblique", "topdown", "iso")


# ---------------------------------------------------------------- raster


def cmd_raster(_args: argparse.Namespace) -> None:
    from labs.common.images import raster_svg

    for fmt in FORMATS:
        dump = json.loads((BLUEPRINTS / f"{fmt}.json").read_text())
        vb = dump["view_box"]
        out = BLUEPRINTS / f"{fmt}.png"
        raster_svg(BLUEPRINTS / f"{fmt}.svg", out, vb)
        print(f"{fmt}: {vb['width'] * PX_PER_UNIT}x{vb['height'] * PX_PER_UNIT} -> {out.relative_to(REPO_ROOT)}")


def cmd_overlay_expected(_args: argparse.Namespace) -> None:
    for fmt in FORMATS:
        dump = json.loads((BLUEPRINTS / f"{fmt}.json").read_text())
        img = Image.open(BLUEPRINTS / f"{fmt}.png")
        expected = fs.expected_from_dump(dump, img.width, img.height)
        metrics = {"_matches": [(e, None) for e in expected], "_invented": []}
        out = BLUEPRINTS / f"{fmt}_expected_overlay.png"
        fs.draw_overlay(img, metrics, str(out))
        print(f"{fmt}: {len(expected)} esperados -> {out.relative_to(REPO_ROOT)}")


# ---------------------------------------------------------------- SAM + score


def segment_bboxes(image_path: Path, client: httpx.Client) -> list[tuple[float, float, float, float]]:
    """SAM2 auto-segment (labs.common.sam), con la caché histórica de este
    run: MASKS/<sha>.json — sin prefijo, no renombrar o se re-paga."""
    return _sam.segment_bboxes(image_path, client, MASKS, cache_name="{sha}.json")


def score_image(image_path: Path, fmt: str, name: str, client: httpx.Client) -> dict:
    dump = json.loads((BLUEPRINTS / f"{fmt}.json").read_text())
    img = Image.open(image_path)
    expected = fs.expected_from_dump(dump, img.width, img.height)
    bboxes = segment_bboxes(image_path, client)
    metrics = fs.score(expected, bboxes, img.width, img.height)
    OVERLAYS.mkdir(parents=True, exist_ok=True)
    fs.draw_overlay(img, metrics, str(OVERLAYS / f"{name}.png"))
    public = {k: v for k, v in metrics.items() if not k.startswith("_")}
    public["n_sam_masks"] = len(bboxes)
    return public


def cmd_score(args: argparse.Namespace) -> None:
    client = httpx.Client(
        headers={"Authorization": f"Key {load_key('FAL_KEY')}"}, timeout=httpx.Timeout(300.0)
    )
    image = Path(args.image)
    name = args.name or image.stem
    metrics = score_image(image, args.format, name, client)
    print(json.dumps(metrics, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------- generate

#: Leyendas por formato, VERBATIM del generador del juego:
#: oblique — ai_server/scene_image_generator.py (working tree, rama svg);
#: topdown/iso — git show HEAD:ai_server/scene_image_generator.py.
VIEW_LEGENDS = {
    "oblique": (
        "Top-down 3/4 RPG game map. The plan is ALREADY projected: "
        "vertical volumes show their top plus a lit SOUTH facade and a "
        "shaded EAST side facade (tops lean slightly north-west), trees "
        "show a trunk under the canopy. Keep that projection and light "
        "direction exactly. "
    ),
    "topdown": (
        "Top-down 3/4 RPG game map. The plan is ALREADY projected: "
        "vertical surfaces show their SOUTH face below their top "
        "(walls and buildings have a visible facade strip, trees show "
        "a trunk under the canopy). Keep that projection exactly. "
    ),
    "iso": (
        "2:1 isometric video-game map (classic RPG angle). The plan is "
        "ALREADY projected: every building shows its top plus TWO "
        "visible facades (south-west facades lit, south-east facades "
        "in shade — keep that light direction), trees show a trunk "
        "with the canopy above, towers are cylinders. "
    ),
}

#: Común a las tres ramas del generador (idéntico en WT y HEAD).
REPAINT_BODY = (
    "The FIRST reference image is ONLY a schematic LAYOUT plan drawn "
    "with flat placeholder colours — it is NOT final art. Fully REPAINT "
    "the whole map in the painterly, richly textured style of the "
    "SECOND reference image: dense textured grass with tufts and "
    "colour variation, detailed tree canopies with individual foliage "
    "clumps, highlights and drop shadows, water with ripples, depth "
    "and high-contrast banks, worn dirt roads with edges blending into "
    "grass, individually drawn cobblestones, wooden floors with plank "
    "grain, stone walls with individual masonry blocks, roof tiles "
    "drawn one by one. The finished map must NOT look flat, "
    "vector-like or diagram-like anywhere. "
    "Buildings drawn open (no roof, interior floors and furniture "
    "visible over low front walls) are CUTAWAY interiors — keep them "
    "open exactly as drawn; buildings drawn with a roof keep their "
    "roof. Keep every element in the SAME position, size, shape and "
    "height; follow the EXACT course and width of the water and of "
    "every road; keep bridges and walkways painted ON TOP of the "
    "water. Do NOT move, remove or merge buildings. Do NOT invent new "
    "buildings, walls, bridges or watercourses that are not in the "
    "blueprint. IMPORTANT: leave every fully transparent pixel of the "
    "first reference EXACTLY transparent-black — paint only where the "
    "plan has content. "
)

STYLE_RULES = (
    "Match the EXACT art style of the SECOND reference image. The map must fill "
    "the ENTIRE image edge to edge, full bleed — NO border, NO margin, NO "
    "transparent or checkerboard background, NO frame, NO text, NO watermark, "
    "NO characters, NO UI."
)

STYLE_REF = REPO_ROOT / "nefan-core/data/styles/medievo_crudo/settlement.jpg"
STYLE_TOKEN = (
    "gritty realistic medieval illustration, weathered stone and dust, rich "
    "material detail, candlelight and ink tones, painterly not photorealistic"
)


def build_prompt(fmt: str, variant: str = "") -> str:
    dump = json.loads((BLUEPRINTS / f"{fmt}.json").read_text())
    desc = str(dump.get("scene_description") or "").strip()
    body = REPAINT_BODY
    if variant == "nowater":
        # Hipótesis del bench: mencionar agua en un plano SIN agua ceba la
        # alucinación de ríos (fallo dominante de la ronda 1). Variante que
        # solo habla de agua si el plano la tiene.
        body = (
            body.replace("water with ripples, depth and high-contrast banks, ", "")
            .replace(
                "follow the EXACT course and width of the water and of every road; "
                "keep bridges and walkways painted ON TOP of the water. ",
                "follow the EXACT course and width of every road. ",
            )
        )
        body += (
            "This map contains NO water at all: do NOT paint any river, stream, "
            "canal, pond or lake anywhere. "
        )
    return (
        VIEW_LEGENDS[fmt]
        + body
        + f"Render the scene as: {desc}. "
        + f"Overall art direction: {STYLE_TOKEN}. "
        + STYLE_RULES
    )


#: Fichas verificadas en fal.ai (2026-07-15). `params` va tal cual al payload;
#: todos aceptan `image_urls` multi-ref (esquema + ref de estilo, el contrato
#: del juego). Coste aproximado por imagen según dashboard/README.
MODEL_SPECS: dict[str, dict] = {
    "gpt2_high": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high", "image_size": "square_hd"},
        "cost_usd": 0.17,
        "note": "config actual del juego (reproduce el bug)",
    },
    "gpt2_medium": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "medium", "image_size": "square_hd"},
        "cost_usd": 0.06,
        "note": "¿misma fidelidad por 1/3 del coste?",
    },
    "gpt2_native": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high"},  # image_size se calcula del blueprint
        "native_size": True,
        "cost_usd": 0.17,
        "note": "aspect nativo del blueprint (sin estiramiento anamórfico)",
    },
    "nanobanana_pro": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "1:1"},
        "cost_usd": 0.15,
        "note": "el modelo que usaba el juego vía Meshy antes de gpt-image-2",
    },
    "nanobanana_pro_45": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "4:5"},
        "only_formats": ["topdown"],  # 512×640 = 4:5 exacto (aspect nativo)
        "cost_usd": 0.15,
        "note": "nano-banana-pro con el aspect nativo del blueprint topdown",
    },
    "nanobanana_pro_45nw": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "4:5"},
        "only_formats": ["topdown"],
        "prompt_variant": "nowater",
        "cost_usd": 0.15,
        "note": "mejor combo + prompt sin agua (anti-alucinación de ríos)",
    },
    "nanobanana_pro_ob_nw": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "4:5"},
        "only_formats": ["oblique"],  # 560×640 = 7:8; 4:5 es el ratio más cercano
        "prompt_variant": "nowater",
        "cost_usd": 0.15,
        "note": "¿la oblicua con TODAS las mejoras alcanza al topdown?",
    },
    "gpt2_native_nw": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high"},
        "native_size": True,
        "prompt_variant": "nowater",
        "cost_usd": 0.17,
        "note": "gpt2 aspect nativo + prompt sin agua",
    },
    # Hipótesis "prestretch": si el esquema se PRE-ESTIRA al aspect del output
    # (cuadrado), el mapeo entrada↔salida vuelve a ser lineal y el des-estirado
    # del cliente lo compensa — arreglaría el aspect también en el camino
    # Meshy, que no deja elegir tamaño de salida.
    "gpt2_sq_ps": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high", "image_size": "square_hd"},
        "prestretch": True,
        "prompt_variant": "nowater",
        "only_formats": ["oblique"],
        "cost_usd": 0.17,
        "note": "esquema pre-estirado a cuadrado + output square_hd",
    },
    "nanobanana_pro_sq_ps": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "1:1"},
        "prestretch": True,
        "prompt_variant": "nowater",
        "only_formats": ["topdown"],
        "cost_usd": 0.15,
        "note": "esquema pre-estirado a cuadrado + output 1:1 (simula camino Meshy)",
    },
    "nanobanana_pro_sq_ps_ob": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "1:1"},
        "prestretch": True,
        "prompt_variant": "nowater",
        "only_formats": ["oblique"],
        "cost_usd": 0.15,
        "note": "prestretch cuadrado en OBLICUA — validación de la config elegida para el juego",
    },
    "seedream4": {
        "endpoint": "fal-ai/bytedance/seedream/v4/edit",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
        "note": "candidato barato con fama de preservar estructura",
    },
    "kontext_max": {
        "endpoint": "fal-ai/flux-pro/kontext/max/multi",
        "params": {"aspect_ratio": "1:1", "guidance_scale": 3.5, "output_format": "png"},
        "cost_usd": 0.08,
        "note": "FLUX Kontext: editor diseñado para preservar el layout",
    },
    "qwen_edit": {
        "endpoint": "fal-ai/qwen-image-edit-plus",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
        "note": "editor multi-imagen de Alibaba",
    },
}


def run_case(
    name: str, model: str, fmt: str, client: httpx.Client, note_extra: str = ""
) -> dict:
    spec = MODEL_SPECS[model]
    blueprint = Image.open(BLUEPRINTS / f"{fmt}.png")
    if spec.get("prestretch"):
        side = max(blueprint.size)
        blueprint = blueprint.resize((side, side), Image.LANCZOS)
    payload: dict = {
        "prompt": build_prompt(fmt, spec.get("prompt_variant", "")),
        "num_images": 1,
        **spec["params"],
        "image_urls": [png_data_uri(blueprint, long_side=768), jpeg_data_uri(STYLE_REF)],
    }
    if spec.get("native_size"):
        # Múltiplos de 16 preservando el aspect del blueprint, lado largo ~1280.
        scale = 1280 / max(blueprint.size)
        payload["image_size"] = {
            "width": round(blueprint.width * scale / 16) * 16,
            "height": round(blueprint.height * scale / 16) * 16,
        }
    t0 = time.time()
    resp = client.post(f"{FAL_BASE}/{spec['endpoint']}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"{name}: fal devolvió {resp.status_code}: {resp.text[:400]}")
    image = resp.json()["images"][0]
    png = download_image(image, client)
    IMAGES.mkdir(parents=True, exist_ok=True)
    out_path = IMAGES / f"{name}.png"
    out_path.write_bytes(png)
    elapsed = round(time.time() - t0, 1)
    metrics = score_image(out_path, fmt, name, client)
    print(f"  ✓ {name} ({elapsed}s) edif:{metrics['buildings']['pct_matched']}% "
          f"offset:{metrics['buildings']['mean_offset_pct']}% "
          f"inventadas:{metrics['n_unmatched_big_masks']}")
    return {
        "name": name,
        "format": fmt,
        "model": model,
        "endpoint": spec["endpoint"],
        "params": spec["params"],
        "cost_usd": spec["cost_usd"],
        "note": (spec["note"] + (" · " + note_extra if note_extra else "")),
        "prompt": payload["prompt"],
        "elapsed_s": elapsed,
        "metrics": metrics,
    }


def cmd_generate(args: argparse.Namespace) -> None:
    formats = [f for f in args.formats.split(",") if f]
    only = {c for c in args.only.split(",") if c}
    cases: list[tuple[str, str, str]] = []  # (name, model, fmt)
    for model, spec in MODEL_SPECS.items():
        if model in ("gpt2_medium", "gpt2_native", "gpt2_native_nw"):
            fmts = ["oblique"]
        else:
            fmts = spec.get("only_formats", formats)
        for fmt in fmts:
            cases.append((f"{model}__{fmt}{args.suffix}", model, fmt))
    if only:
        cases = [c for c in cases if c[0] in only or c[0].removesuffix(args.suffix) in only]
    total_cost = sum(MODEL_SPECS[m]["cost_usd"] for _, m, _ in cases)
    print(f"{len(cases)} casos, coste estimado ~${total_cost:.2f} (+SAM ~$0.01/img)")
    entries: list[dict] = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    client = httpx.Client(
        headers={"Authorization": f"Key {load_key('FAL_KEY')}"}, timeout=httpx.Timeout(600.0)
    )
    for name, model, fmt in cases:
        try:
            entry = run_case(name, model, fmt, client)
        except Exception as err:  # un caso fallido no tumba la matriz
            print(f"  ✗ {name}: {err}")
            entry = {"name": name, "format": fmt, "model": model, "error": str(err)[:400]}
        entries = [e for e in entries if e.get("name") != name] + [entry]
        MANIFEST.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
        render_index(entries)


# ---------------------------------------------------------------- report


def cmd_report(_args: argparse.Namespace) -> None:
    entries = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else []
    render_index(entries)
    print(f"index -> {RUN_DIR / 'index.html'}")


def render_index(entries: list[dict]) -> None:
    def row(e: dict) -> str:
        m = e.get("metrics") or {}
        b = m.get("buildings") or {}
        a = m.get("all") or {}
        cells = (
            f"<td>{e['name']}</td><td>{e.get('format', '')}</td><td>{e.get('model', '')}</td>"
            f"<td>{b.get('pct_matched', '—')}</td><td>{b.get('mean_offset_pct', '—')}</td>"
            f"<td>{a.get('pct_matched', '—')}</td><td>{a.get('mean_iou', '—')}</td>"
            f"<td>{m.get('n_unmatched_big_masks', '—')}</td>"
            f"<td>{m.get('unexplained_area_pct', '—')}</td>"
            f"<td>{e.get('elapsed_s', '—')}</td>"
        )
        return f"<tr>{cells}</tr>"

    def card(e: dict) -> str:
        imgs = "".join(
            f'<figure><img src="{src}" loading="lazy"><figcaption>{cap}</figcaption></figure>'
            for src, cap in [
                (f"blueprints/{e.get('format', 'oblique') }.png", "blueprint"),
                (f"images/{e['name']}.png", "generada"),
                (f"overlays/{e['name']}.png", "overlay (verde=casado rojo=perdido magenta=inventado)"),
            ]
        )
        return (
            f'<section id="{e["name"]}"><h2>{e["name"]}</h2>'
            f"<p>{e.get('format', '')} · {e.get('model', '')} · {e.get('note', '')} · "
            f"{e.get('elapsed_s', '—')}s</p>"
            f'<div class="imgs">{imgs}</div>'
            f"<details><summary>métricas + prompt</summary>"
            f"<pre>{json.dumps(e.get('metrics'), indent=1, ensure_ascii=False)}</pre>"
            f"<pre>{e.get('prompt', '')}</pre></details></section>"
        )

    ordered = sorted(
        entries,
        key=lambda e: -(((e.get("metrics") or {}).get("buildings") or {}).get("pct_matched") or 0),
    )
    html = (
        "<!doctype html><meta charset=utf-8><title>002_repaint_fidelity</title><style>"
        "body{font-family:system-ui;background:#141414;color:#ddd;margin:2rem}"
        "table{border-collapse:collapse}td,th{border:1px solid #444;padding:.3rem .6rem}"
        ".imgs{display:flex;gap:1rem;flex-wrap:wrap}figure{margin:0}img{max-width:420px;display:block}"
        "figcaption{font-size:.8rem;color:#999}pre{white-space:pre-wrap;background:#1e1e1e;padding:.6rem}"
        "</style><h1>Fidelidad de layout — matriz formato × modelo</h1>"
        "<table><tr><th>caso</th><th>formato</th><th>modelo</th>"
        "<th>edif. casados %</th><th>offset % (edif.)</th><th>casados % (todo)</th>"
        "<th>IoU</th><th>masks inventadas</th><th>área no explicada %</th><th>t(s)</th></tr>"
        + "".join(row(e) for e in ordered)
        + "</table>"
        + "".join(card(e) for e in ordered)
    )
    (RUN_DIR / "index.html").write_text(html)


# ---------------------------------------------------------------- main


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("raster")
    sub.add_parser("overlay-expected")
    sc = sub.add_parser("score")
    sc.add_argument("--image", required=True)
    sc.add_argument("--format", required=True, choices=FORMATS)
    sc.add_argument("--name")
    gen = sub.add_parser("generate")
    gen.add_argument("--only", default="")
    gen.add_argument("--formats", default=",".join(FORMATS))
    gen.add_argument("--suffix", default="", help="sufijo del caso (repeticiones: _r2, _r3)")
    sub.add_parser("report")
    args = p.parse_args()
    {
        "raster": cmd_raster,
        "overlay-expected": cmd_overlay_expected,
        "score": cmd_score,
        "generate": cmd_generate,
        "report": cmd_report,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
