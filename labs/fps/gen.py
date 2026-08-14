"""gen.py — fase de PAGO del bench FPS: pinta el atlas de superficies con un
modelo i2i de fal y recorta las celdas a texturas individuales.

Pipeline por run:
  1. node dump_layout.mjs <escena> <variante> → runs/<run>/layout.json
  2. base PIL por página: rects de color clay + ruido sutil sobre fondo gris
     neutro (DETERMINISTA — la caché de fal_call depende de estos bytes)
  3. img2img (prompt = estilo + leyenda posicional de celdas, SIN texto en el
     lienzo) → runs/<run>/atlas_pN_gen.png
  4. recorte de celdas con inset → runs/<run>/textures/<cellKey>.png
     (+ feather de tileado opcional en las celdas "tile")
  5. index.html del run regenerado tras cada imagen

Uso:
    python3 labs/fps/gen.py 001_layout --scene interior [--model seedream]
        [--variant C] [--style retro] [--pages 0,1] [--suffix _r2]
        [--feather 16] [--page-px 1024]

Tope de gasto DURO del lab: $12 (aborta antes de llamar si se superaría).
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import random
from pathlib import Path

from PIL import Image, ImageDraw

LAB = Path(__file__).resolve().parent
REPO = LAB.parent.parent
sys.path.insert(0, str(REPO))
from labs.common import env, fal, images, report  # noqa: E402

CACHE = LAB / "runs" / "_cache"
SPEND = CACHE / "spend.json"
HARD_CAP_USD = 12.0

MODEL_SPECS: dict[str, dict] = {
    "seedream": {
        "endpoint": "fal-ai/bytedance/seedream/v4/edit",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
    },
    "qwen": {
        "endpoint": "fal-ai/qwen-image-edit-plus",
        "params": {"image_size": "square_hd"},
        "cost_usd": 0.03,
    },
    "nano": {
        "endpoint": "fal-ai/nano-banana-pro/edit",
        "params": {"resolution": "1K", "aspect_ratio": "1:1"},
        "cost_usd": 0.15,
    },
    "kontext": {
        "endpoint": "fal-ai/flux-pro/kontext/max/multi",
        "params": {"aspect_ratio": "1:1", "guidance_scale": 3.5, "output_format": "png"},
        "cost_usd": 0.08,
    },
    "gpt2": {
        "endpoint": "openai/gpt-image-2/edit",
        "params": {"quality": "high", "image_size": "square_hd"},
        "cost_usd": 0.17,
    },
}

STYLES: dict[str, str] = {
    "retro": (
        "hand-painted 90s retro FPS game texture art, chunky readable detail, "
        "muted earthy medieval palette, subtle painterly grain, crisp edges"
    ),
    "painterly": (
        "painterly fantasy RPG texture art, rich material detail, warm candlelit "
        "medieval palette, visible brush strokes, not photorealistic"
    ),
    "grim": (
        "gritty dark-fantasy texture art, weathered and grimy surfaces, desaturated "
        "stone and old wood tones, fine painterly detail"
    ),
    "photo": (
        "realistic PBR albedo texture photography, high detail scanned material look, "
        "neutral color balance"
    ),
}

RULES = (
    "This image is a TEXTURE ATLAS SHEET for a retro first-person 3D game: a grid of "
    "rectangular placeholder cells on a plain neutral grey background. Repaint EVERY "
    "cell as a finished game texture, keeping each rectangle EXACTLY in place and "
    "filled edge to edge with its texture. Each cell is a FLAT MATERIAL SWATCH seen "
    "straight-on at exactly 90 degrees, like a sample from a texture library: the "
    "surface is parallel to the image plane and fills its whole rectangle. NEVER "
    "paint a room, a scene, furniture, loose objects, a floor meeting a wall, or a "
    "horizon inside a cell — only the material surface itself. The grey gutter "
    "between cells must stay plain neutral grey. Flat even lighting, albedo only: "
    "no cast shadows, no specular highlights, no perspective, no vanishing lines, "
    "no depth. Absolutely no text, no numbers, no labels, no borders, no frames, "
    "no watermark, no characters. "
)

TILE_RULE = (
    "Cells marked (seamless) must tile perfectly: their texture pattern must wrap "
    "continuously across opposite edges, with no vignetting and no centered motif. "
    "Brightness and detail density must be COMPLETELY uniform across each cell — "
    "the pixels at every edge must match the brightness of the center, with no "
    "darker borders or corners. "
)


def color_word(hex_color: str) -> str:
    """Nombre aproximado del color base (para señalar la celda en el prompt)."""
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    lum = (r + g + b) / 3
    if abs(r - g) < 18 and abs(g - b) < 18:
        return "dark grey" if lum < 90 else "grey" if lum < 150 else "light grey"
    if r > g > b:
        if lum < 95:
            return "dark brown"
        return "warm ochre" if g > 140 else "brown"
    if g >= r and g >= b:
        return "olive green" if lum < 110 else "green"
    if b >= r and b >= g:
        return "blue"
    return "brown"


def cell_position_words(cells: list[dict]) -> list[str]:
    """"row 1, cell 2" por celda, en orden de lectura del layout."""
    rows: dict[int, list[dict]] = {}
    for c in cells:
        rows.setdefault(c["rect"][1], []).append(c)
    words = {}
    for ri, y in enumerate(sorted(rows), start=1):
        for ci, c in enumerate(sorted(rows[y], key=lambda c: c["rect"][0]), start=1):
            words[c["key"]] = f"row {ri}, cell {ci}"
    return [words[c["key"]] for c in cells]


def draw_base(page: dict, page_px: int, label_mode: str) -> Image.Image:
    """Base clay del atlas. DETERMINISTA: ruido sembrado por cell.key."""
    img = Image.new("RGB", (page_px, page_px), "#7a7a7a")
    draw = ImageDraw.Draw(img)
    for cell in page["cells"]:
        x, y, w, h = cell["rect"]
        r, g, b = (int(cell["baseColor"][i : i + 2], 16) for i in (1, 3, 5))
        rng = random.Random(cell["key"])
        px = img.load()
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                n = rng.randint(-4, 4)
                px[xx, yy] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
        for hint in cell.get("hints") or []:
            hx0, hy0, hx1, hy1, hcolor = hint
            hr, hg, hb = (int(hcolor[i : i + 2], 16) for i in (1, 3, 5))
            for yy in range(y + int(hy0 * h), y + int(hy1 * h)):
                for xx in range(x + int(hx0 * w), x + int(hx1 * w)):
                    n = rng.randint(-4, 4)
                    px[xx, yy] = (max(0, min(255, hr + n)), max(0, min(255, hg + n)), max(0, min(255, hb + n)))
        if label_mode == "gutter":
            # Número pequeño EN el gutter, pegado a la esquina de la celda.
            idx = page["cells"].index(cell) + 1
            draw.text((x + 2, y - 14), str(idx), fill="#3c3c3c")
    return img


def build_prompt(layout: dict, page: dict, style: str, label_mode: str) -> str:
    cells = page["cells"]
    pos = cell_position_words(cells)
    has_tiles = any(c["kind"] == "tile" for c in cells)
    lines = []
    for i, c in enumerate(cells):
        seam = " (seamless)" if c["kind"] == "tile" else ""
        ident = f"cell {i + 1}" if label_mode == "gutter" else f"{pos[i]} ({color_word(c['baseColor'])})"
        lines.append(f"{ident}: {c['en']}{seam}.")
    count_rule = (
        f"There are EXACTLY {len(cells)} rectangles. Each rectangle holds ONE single "
        "texture spanning its full width and height — NEVER split a rectangle into "
        "smaller panels and NEVER paint anything over the grey gutter. "
    )
    return (
        RULES
        + count_rule
        + (TILE_RULE if has_tiles else "")
        + f"All materials come from the same location ({layout['description']}) "
        + "and must share ONE consistent palette. "
        + f"Art direction: {style}. "
        + "The cells: " + " ".join(lines)
    )


def flatten_illumination(img: Image.Image) -> Image.Image:
    """Divide la iluminación de baja frecuencia (viñeteado del modelo): sin
    esto, cada repetición del tile marca una rejilla oscura en el suelo."""
    import numpy as np
    from PIL import ImageFilter

    arr = np.asarray(img).astype("float32")
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(img.width / 3))).astype("float32")
    mean = blur.mean(axis=(0, 1), keepdims=True)
    out = arr * (mean / np.maximum(blur, 1.0))
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def make_tileable(img: Image.Image, band: int) -> Image.Image:
    """Feather de bordes: mezcla cada borde con la copia desplazada medio
    periodo (np.roll — ¡Image.transform AFFINE no envuelve y metía NEGRO,
    que era exactamente la rejilla oscura del suelo!)."""
    if band <= 0:
        return img
    import numpy as np

    arr = np.asarray(img).astype("float32")
    h, w = arr.shape[:2]
    shifted = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)
    # Peso 1 en el borde → 0 a `band` píxeles hacia dentro, por eje.
    dx = np.minimum(np.arange(w), np.arange(w)[::-1]).astype("float32")
    dy = np.minimum(np.arange(h), np.arange(h)[::-1]).astype("float32")
    wx = np.clip(1 - dx / band, 0, 1)
    wy = np.clip(1 - dy / band, 0, 1)
    weight = np.maximum(wx[None, :], wy[:, None])[..., None] * 0.85
    out = arr * (1 - weight) + shifted * weight
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def crop_cells(gen_img: Image.Image, layout: dict, page: dict, out_dir: Path, feather: int) -> None:
    inset = layout["inset_px"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for cell in page["cells"]:
        x, y, w, h = cell["rect"]
        crop = gen_img.crop((x + inset, y + inset, x + w - inset, y + h - inset))
        if cell["kind"] == "tile":
            crop = flatten_illumination(crop)
            if feather > 0:
                crop = make_tileable(crop, feather)
        crop.save(out_dir / f"{cell['key']}.png")


def render_index(run_dir: Path, entries: list[dict], layout: dict) -> None:
    rows = []
    for e in entries:
        cells_html = ""
        tex_dir = run_dir / "textures"
        page = layout["pages"][e["page"]]
        for c in page["cells"]:
            cells_html += (
                f'<div style="display:inline-block;margin:4px;text-align:center">'
                f'<img src="textures/{c["key"]}.png" style="width:110px;height:110px;object-fit:cover">'
                f'<br><small>{c["key"]}</small></div>'
            )
        rows.append(
            f"<h2>página {e['page']} — {e['model']} (${e['cost_usd']}, {e.get('elapsed_s', '?')}s)</h2>"
            f'<div style="display:flex;gap:12px">'
            f'<figure><img src="{e["base"]}" style="width:420px"><figcaption>base</figcaption></figure>'
            f'<figure><img src="{e["gen"]}" style="width:420px"><figcaption>generado</figcaption></figure>'
            f"</div><details><summary>prompt</summary><pre style='white-space:pre-wrap'>{e['prompt']}</pre></details>"
            f"<div>{cells_html}</div>"
        )
    body = f"<h1>{run_dir.name}</h1><p>{layout['scene']} · variante {layout['variant']}</p>" + "".join(rows)
    report.render_page(f"fps atlas — {run_dir.name}", body, run_dir / "index.html")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--scene", default="interior")
    ap.add_argument("--variant", default="C")
    ap.add_argument("--model", default="seedream")
    ap.add_argument("--style", default="retro")
    ap.add_argument("--pages", default="", help="índices de página, p.ej. 0,1 (default todas)")
    ap.add_argument("--label-mode", default="none", choices=["none", "gutter"])
    ap.add_argument("--suffix", default="", help="_r2… para repetir la MISMA llamada")
    ap.add_argument("--feather", type=int, default=28)
    ap.add_argument("--page-px", type=int, default=1024)
    ap.add_argument("--dry-run", action="store_true", help="solo base + prompt, sin llamar a fal")
    args = ap.parse_args()

    if not args.dry_run:
        env.load_key("FAL_KEY")
    spec = MODEL_SPECS[args.model]
    run_dir = LAB / "runs" / args.run
    run_dir.mkdir(parents=True, exist_ok=True)

    layout_path = run_dir / "layout.json"
    if not layout_path.exists():
        out = subprocess.run(
            ["node", str(LAB / "dump_layout.mjs"), args.scene, args.variant, str(args.page_px)],
            capture_output=True, text=True, check=True,
        )
        layout_path.write_text(out.stdout)
    layout = json.loads(layout_path.read_text())
    if layout["scene"] != args.scene:
        raise SystemExit(f"el layout del run es de '{layout['scene']}', no '{args.scene}'")

    pages = [int(p) for p in args.pages.split(",") if p != ""] or list(range(len(layout["pages"])))
    est = spec["cost_usd"] * len(pages)
    spent = fal.total_spend(SPEND)
    print(f"{len(pages)} página(s) × {args.model} ≈ ${est:.2f}. Gastado: ${spent:.2f} / tope ${HARD_CAP_USD}")
    if spent + est > HARD_CAP_USD:
        raise SystemExit(f"TOPE del lab (${HARD_CAP_USD}) superado — aborta")

    client = None if args.dry_run else fal.fal_client()
    manifest_path = run_dir / "manifest.json"
    entries: list[dict] = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    prev_gen_uri: str | None = None
    style = STYLES[args.style]

    for pi in pages:
        page = layout["pages"][pi]
        base = draw_base(page, layout["page_px"], args.label_mode)
        base_name = f"atlas_p{pi}_base.png"
        base.save(run_dir / base_name)
        prompt = build_prompt(layout, page, style, args.label_mode)
        image_urls = [images.png_file_data_uri(run_dir / base_name)]
        if prev_gen_uri:
            # La página anterior generada ancla la paleta de esta.
            image_urls.append(prev_gen_uri)
            prompt += (
                " The SECOND reference image is the previous sheet of this same atlas: "
                "match its palette, style and level of detail exactly."
            )
        payload = {"prompt": prompt, "num_images": 1, **spec["params"], "image_urls": image_urls}
        name = f"{args.run}_p{pi}_{args.model}{args.suffix}"
        if args.dry_run:
            (run_dir / f"prompt_p{pi}.txt").write_text(prompt)
            print(f"  · p{pi} dry-run: base {base_name} + prompt_p{pi}.txt ({len(prompt)} chars)")
            continue
        out = fal.fal_call(
            spec["endpoint"], payload, spec["cost_usd"], client,
            CACHE, SPEND, tag=name, extra_key=args.suffix,
        )
        png = fal.download_image(out["images"][0], client)
        gen = Image.open(io.BytesIO(png)).convert("RGB")
        if gen.size != (layout["page_px"], layout["page_px"]):
            gen = gen.resize((layout["page_px"], layout["page_px"]), Image.LANCZOS)
        gen_name = f"atlas_p{pi}_gen.png"
        gen.save(run_dir / gen_name)
        prev_gen_uri = images.png_file_data_uri(run_dir / gen_name)
        crop_cells(gen, layout, page, run_dir / "textures", args.feather)
        entry = {
            "page": pi, "model": args.model, "style": args.style, "cost_usd": spec["cost_usd"],
            "elapsed_s": out.get("_elapsed_s"), "base": base_name, "gen": gen_name, "prompt": prompt,
        }
        entries = [e for e in entries if e.get("page") != pi] + [entry]
        manifest_path.write_text(json.dumps(entries, indent=1, ensure_ascii=False))
        render_index(run_dir, sorted(entries, key=lambda e: e["page"]), layout)
        print(f"  ✓ p{pi} ({out.get('_elapsed_s')}s) → {gen_name} + {len(page['cells'])} texturas")

    print(f"gasto acumulado del lab: ${fal.total_spend(SPEND):.2f}")


if __name__ == "__main__":
    main()
