#!/usr/bin/env python3
"""Referencias de estilo desde las bases SVG del lab, vía gpt-image-2 (fal).

Cada base (render.png del SVG) se repinta con un ESTILO distinto manteniendo
composición, cámara y luz. Salida: estilos/<caso>.png + manifest.json +
index.html. Requiere FAL_KEY (entorno o .env de la raíz).

Uso:
    source .venv/bin/activate
    python escenografia_lab/gen_estilos.py [--only caso1,caso2]

Coste: ~0.17 USD/imagen (quality high, 1280x800). gpt-image-2 high tarda
~200-300 s por imagen; el run completo puede pasar de 20 min.
"""
from __future__ import annotations

import argparse
import base64
import html
import io
import json
import os
import time
from pathlib import Path

import httpx
from PIL import Image

LAB = Path(__file__).resolve().parent
REPO_ROOT = LAB.parent
OUT_DIR = LAB / "estilos"
FAL_BASE = "https://fal.run"
EDIT = "openai/gpt-image-2/edit"
#: Aspect nativo de las bases (1600x1000 → 1280x800, múltiplos de 16).
IMAGE_SIZE = {"width": 1280, "height": 800}

#: Preamble común: la base MANDA en composición; el estilo solo repinta.
KEEP = (
    "Fully repaint this exact scene as a finished illustration. Keep the "
    "composition, camera angle, perspective, the layout and silhouette of "
    "every element, and the lighting direction EXACTLY as in the reference "
    "image. Ground-level view. Fill the entire frame edge to edge: no "
    "borders, no frames, no letterboxing, no vignettes. No people, no "
    "animals with human poses, no text, no watermark."
)

CASES: list[tuple[str, str, str]] = [
    # (nombre, base, cláusula de estilo)
    (
        "01_calle_oleo_antiguo",
        "01_calle_curva/render.png",
        "Art style: antique oil painting by a 17th-century European old "
        "master — visible loaded brushstrokes, glazed warm layers, deep "
        "chiaroscuro golden-hour light, muted earth pigments with a luminous "
        "amber varnish glow, classical townscape painting.",
    ),
    (
        "02_plaza_comic_europeo",
        "02_plaza_mercado/render.png",
        "Art style: classic European comic album background (bande "
        "dessinée), ligne claire — crisp uniform dark ink outlines, flat "
        "vivid colors with minimal shading, clean geometric shapes, in the "
        "tradition of Tintin and Asterix village scenes.",
    ),
    (
        "03_taberna_maniac_mansion",
        "03_taberna/render.png",
        "Art style: 1990s LucasArts point-and-click adventure background in "
        "the vein of Maniac Mansion: Day of the Tentacle — zany cartoon "
        "look, slightly wobbly exaggerated shapes, bold dark outlines, "
        "saturated theatrical colors, hand-painted cartoon interior.",
    ),
    (
        "04_bosque_ghibli",
        "04_bosque_puente/render.png",
        "Art style: Studio Ghibli background painting — soft gouache "
        "brushwork, lush layered greens, luminous atmospheric light with "
        "gentle bloom, tender hand-painted anime scenery full of quiet "
        "detail.",
    ),
    (
        "05_puerto_videojuego_clasico",
        "05_puerto_fluvial/render.png",
        "Art style: classic 1990s video game pixel art background — 16-bit "
        "VGA adventure-game scene, limited 32-color palette, careful "
        "dithering for the fog and water gradients, crisp readable pixel "
        "clusters, no anti-aliasing look.",
    ),
    (
        "06_puerta_fantasia_oscura_80s",
        "06_puerta_muralla/render.png",
        "Art style: 1980s dark fantasy illustration — moody airbrushed "
        "painting like a vintage heavy-metal album cover or an 80s "
        "sword-and-sorcery paperback, ominous glow, deep purple-black "
        "shadows, dramatic rim-lit silhouettes, epic and menacing.",
    ),
    # -- tanda 2 --
    (
        "01_calle_miniatura_medieval",
        "01_calle_curva/render.png",
        "Art style: medieval illuminated manuscript miniature — flat bright "
        "mineral pigments (vermilion, lapis blue, malachite green), fine "
        "dark pen outlines, patterned surfaces, subtle gold leaf accents in "
        "the sky, parchment texture, naive charming detail like a 15th-"
        "century book of hours city scene.",
    ),
    (
        "02_plaza_acuarela",
        "02_plaza_mercado/render.png",
        "Art style: crisp defined watercolor painting — transparent luminous "
        "washes with deliberate hard edges, white paper reserved for "
        "highlights, granulating pigment texture in the shadows, confident "
        "wet-on-dry brushwork, controlled architectural watercolor with "
        "clean silhouettes.",
    ),
    (
        "03_taberna_caravaggio",
        "03_taberna/render.png",
        "Art style: Caravaggio — Baroque tenebrism, near-black shadows "
        "swallowing the room, one dramatic raking light and the fire as the "
        "only warm source, oil on canvas with rich impasto highlights, "
        "hyper-real textures on wood and clay, theatrical chiaroscuro.",
    ),
    (
        "04_bosque_carta_magic",
        "04_bosque_puente/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic magical "
        "light rays, painterly but detailed rendering, the lush epic look "
        "of a Forest basic land artwork.",
    ),
    (
        "05_puerto_impresionista",
        "05_puerto_fluvial/render.png",
        "Art style: French Impressionist painting in the manner of Monet's "
        "Impression soleil levant — broken visible brushstrokes, color "
        "vibration instead of outlines, misty atmosphere dissolving the far "
        "bank, soft complementary greys with a single warm accent, oil "
        "sketch spontaneity.",
    ),
    # -- tanda 3: pack completo estilo carta Magic --
    (
        "01_calle_magic",
        "01_calle_curva/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic golden "
        "light, painterly but detailed rendering, epic cinematic mood.",
    ),
    (
        "02_plaza_magic",
        "02_plaza_mercado/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic light, "
        "painterly but detailed rendering, epic cinematic mood.",
    ),
    (
        "03_taberna_magic",
        "03_taberna/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic warm "
        "firelight, painterly but detailed rendering, epic cinematic mood.",
    ),
    (
        "05_puerto_magic",
        "05_puerto_fluvial/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic misty "
        "light, painterly but detailed rendering, epic cinematic mood.",
    ),
    (
        "06_puerta_magic",
        "06_puerta_muralla/render.png",
        "Art style: Magic: The Gathering card illustration — polished "
        "digital fantasy painting, saturated jewel tones, dramatic sunset "
        "backlight, painterly but detailed rendering, epic cinematic mood.",
    ),
    (
        "06_puerta_dore_coloreado",
        "06_puerta_muralla/render.png",
        "Art style: Gustave Doré engraving, hand-colored — dense parallel "
        "hatching and cross-hatching building the volumes, dramatic biblical "
        "light bursting through the gate, apocalyptic clouds, a restrained "
        "tinted-print palette of warm ambers and cold violets over the "
        "monochrome engraving.",
    ),
]


def load_fal_key() -> str:
    key = os.environ.get("FAL_KEY", "")
    if not key:
        env = REPO_ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("FAL_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit("FAL_KEY no está ni en el entorno ni en .env")
    return key


def to_data_uri(path: Path, long_side: int = 1280) -> str:
    img = Image.open(path).convert("RGB")
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize(
            (round(img.width * scale), round(img.height * scale)), Image.LANCZOS
        )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def render_index(entries: list[dict]) -> None:
    cards = []
    for e in entries:
        cards.append(
            f"""
  <div class="card">
    <div class="pair">
      <div><h3>base</h3><img src="../{html.escape(e['ref'])}" loading="lazy"></div>
      <div><h3>{html.escape(e['file'])}</h3><img src="{e['file']}" loading="lazy"></div>
    </div>
    <div class="params">{e['quality']} · {e['elapsed_s']}s</div>
    <pre>{html.escape(e['prompt'])}</pre>
  </div>"""
        )
    OUT_DIR.joinpath("index.html").write_text(
        f"""<!doctype html><meta charset="utf-8">
<title>escenografia_lab — referencias de estilo (gpt-image-2)</title>
<style>
  body {{ background:#1c1c1c; color:#ddd; font:15px/1.5 system-ui; margin:24px; }}
  .card {{ border-bottom:1px solid #333; padding:24px 0; }}
  .pair {{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }}
  img {{ width:100%; height:auto; }}
  h3 {{ margin:0 0 6px; font-size:15px; }}
  pre {{ white-space:pre-wrap; background:#252525; padding:12px; font-size:12.5px; }}
  .params {{ color:#8fb35c; font-family:monospace; font-size:13px; margin-top:6px; }}
</style>
<h1>Bases SVG → referencias de estilo ({len(entries)} imágenes)</h1>
{''.join(cards)}
""",
        encoding="utf-8",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="casos separados por coma")
    args = ap.parse_args()
    cases = CASES
    if args.only:
        wanted = set(args.only.split(","))
        unknown = wanted - {c[0] for c in cases}
        if unknown:
            raise SystemExit(f"casos desconocidos: {sorted(unknown)}")
        cases = [c for c in cases if c[0] in wanted]

    OUT_DIR.mkdir(exist_ok=True)
    manifest_path = OUT_DIR / "manifest.json"
    entries: list[dict] = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else []
    )

    key = load_fal_key()
    with httpx.Client(
        headers={"Authorization": f"Key {key}"}, timeout=httpx.Timeout(400.0)
    ) as client:
        for name, ref, style in cases:
            prompt = f"{KEEP} {style}"
            print(f"→ {name}", flush=True)
            t0 = time.time()
            resp = client.post(
                f"{FAL_BASE}/{EDIT}",
                json={
                    "prompt": prompt,
                    "image_urls": [to_data_uri(LAB / ref)],
                    "quality": "high",
                    "image_size": IMAGE_SIZE,
                    "num_images": 1,
                    "output_format": "png",
                },
            )
            if resp.status_code != 200:
                raise RuntimeError(f"{name}: fal {resp.status_code}: {resp.text[:2000]}")
            image = resp.json()["images"][0]
            url = image["url"]
            if url.startswith("data:"):
                png = base64.b64decode(url.split(",", 1)[1])
            else:
                dl = client.get(url)
                dl.raise_for_status()
                png = dl.content
            (OUT_DIR / f"{name}.png").write_bytes(png)
            elapsed = round(time.time() - t0, 1)
            print(f"  ✓ {name} ({elapsed}s, {len(png) // 1024} KB)", flush=True)
            entry = {
                "file": f"{name}.png",
                "ref": ref,
                "prompt": prompt,
                "quality": "high",
                "elapsed_s": elapsed,
            }
            entries = [e for e in entries if e["file"] != entry["file"]] + [entry]
            manifest_path.write_text(
                json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            render_index(entries)
    print(f"\nrun completo: {OUT_DIR}/index.html ({len(entries)} imágenes)")


if __name__ == "__main__":
    main()
