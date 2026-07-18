"""common.py — helpers compartidos del bench render_lab.

- Claves: FAL_KEY / MESHY_API_KEY del entorno o del .env de la raíz.
- fal_call(): POST a fal.run con caché en disco (runs/_cache/<sha>.json) y
  contador de gasto acumulado persistido (runs/_cache/spend.json). Replay
  gratis: mismo endpoint+payload ⇒ misma respuesta sin red.
- score_image_for(): fidelidad de layout contra el blueprint de un fixture
  (reusa fidelity_score.py de style_lab y el segmentado SAM2 con caché).
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

LAB = Path(__file__).resolve().parent
REPO = LAB.parent
CACHE = LAB / "runs" / "_cache"
SPEND = CACHE / "spend.json"

sys.path.insert(0, str(REPO / "style_lab"))
import fidelity_score as fs  # noqa: E402

FAL_BASE = "https://fal.run"
SAM_MODEL = "fal-ai/sam2/auto-segment"
CAPTURE_BG = "#1d2a18"  # DEFAULT_TERRAIN_COLOR de canvas-renderer.ts
PX_PER_UNIT = 4
SAM_COST = 0.01  # aproximado por imagen

FIXTURES = {
    "medieval": LAB / "fixtures/medieval",
    "scifi": LAB / "fixtures/scifi",
}


def load_key(name: str) -> str:
    key = os.environ.get(name, "")
    if not key:
        env = REPO / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith(f"{name}="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        raise SystemExit(f"{name} no está ni en el entorno ni en .env")
    return key


def fal_client(timeout: float = 600.0) -> httpx.Client:
    return httpx.Client(
        headers={"Authorization": f"Key {load_key('FAL_KEY')}"},
        timeout=httpx.Timeout(timeout),
    )


# ---------------------------------------------------------------- gasto

def _spend_state() -> dict:
    if SPEND.exists():
        return json.loads(SPEND.read_text())
    return {"total_usd": 0.0, "calls": []}


def add_spend(usd: float, what: str) -> float:
    state = _spend_state()
    state["total_usd"] = round(state["total_usd"] + usd, 4)
    state["calls"].append({"what": what, "usd": usd, "t": time.strftime("%H:%M:%S")})
    CACHE.mkdir(parents=True, exist_ok=True)
    SPEND.write_text(json.dumps(state, indent=1))
    print(f"  [gasto] +${usd:.3f} ({what}) — acumulado ${state['total_usd']:.2f}")
    return state["total_usd"]


def total_spend() -> float:
    return _spend_state()["total_usd"]


# ---------------------------------------------------------------- fal con caché

def fal_call(endpoint: str, payload: dict, cost_usd: float, client: httpx.Client, tag: str = "", extra_key: str = "") -> dict:
    """POST a fal.run/<endpoint> con caché en disco. Solo cobra (add_spend) en
    llamadas reales; el replay es gratis. `extra_key` fuerza una entrada de
    caché distinta con el mismo payload (repeticiones para varianza)."""
    key = hashlib.sha256(
        json.dumps({"e": endpoint, "p": payload, "k": extra_key}, sort_keys=True).encode()
    ).hexdigest()[:24]
    cached = CACHE / f"fal_{key}.json"
    if cached.exists():
        print(f"  [cache-hit] {endpoint} ({tag or key})")
        return json.loads(cached.read_text())
    t0 = time.time()
    resp = client.post(f"{FAL_BASE}/{endpoint}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"fal {endpoint} devolvió {resp.status_code}: {resp.text[:400]}")
    out = resp.json()
    out["_elapsed_s"] = round(time.time() - t0, 1)
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(out))
    add_spend(cost_usd, f"{endpoint} {tag}".strip())
    return out


def download_image(entry_or_url, client: httpx.Client) -> bytes:
    url = entry_or_url["url"] if isinstance(entry_or_url, dict) else entry_or_url
    if url.startswith("data:"):
        return base64.b64decode(url.split(",", 1)[1])
    dl = client.get(url)
    dl.raise_for_status()
    return dl.content


# ---------------------------------------------------------------- data uris

def png_data_uri(img: Image.Image, long_side: int = 768) -> str:
    img = img.convert("RGB")
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def png_rgba_data_uri(img: Image.Image, long_side: int = 1024) -> str:
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def jpeg_data_uri(path: Path, long_side: int = 1024) -> str:
    img = Image.open(path).convert("RGB")
    scale = long_side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- raster

def raster_svg(svg_path: Path, out_png: Path, view_box: dict, background: str | None = CAPTURE_BG) -> None:
    import cairosvg

    w = round(view_box["width"] * PX_PER_UNIT)
    h = round(view_box["height"] * PX_PER_UNIT)
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_png),
        output_width=w,
        output_height=h,
        background_color=background,
    )


# ---------------------------------------------------------------- SAM + score

def segment_bboxes(image_path: Path, client: httpx.Client) -> list[tuple[float, float, float, float]]:
    """Bboxes de las masks de SAM2 auto-segment (cache por sha de imagen)."""
    import numpy as np

    raw = image_path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()[:16]
    cache = CACHE / f"sam_{sha}.json"
    if cache.exists():
        return [tuple(b) for b in json.loads(cache.read_text())["bboxes"]]

    img = Image.open(io.BytesIO(raw))
    payload = {  # payload exacto de FalSamClient.auto_segment
        "image_url": png_data_uri(img, long_side=1024),
        "points_per_side": 32,
        "pred_iou_thresh": 0.88,
        "stability_score_thresh": 0.95,
        "min_mask_region_area": 100,
        "sync_mode": True,
        "output_format": "png",
    }
    resp = client.post(f"{FAL_BASE}/{SAM_MODEL}", json=payload)
    if resp.status_code != 200:
        raise RuntimeError(f"SAM2 devolvió {resp.status_code}: {resp.text[:500]}")
    add_spend(SAM_COST, f"sam2 {image_path.name}")
    masks = resp.json().get("individual_masks") or []
    bboxes: list[tuple[float, float, float, float]] = []
    for m in masks:
        mask_png = download_image(m, client)
        arr = np.asarray(Image.open(io.BytesIO(mask_png)).convert("L"))
        ys, xs = np.nonzero(arr > 127)
        if len(xs) == 0:
            continue
        sx = img.width / arr.shape[1]
        sy = img.height / arr.shape[0]
        bboxes.append(
            (
                float(xs.min()) * sx,
                float(ys.min()) * sy,
                float(xs.max() - xs.min() + 1) * sx,
                float(ys.max() - ys.min() + 1) * sy,
            )
        )
    cache.write_text(json.dumps({"image": image_path.name, "bboxes": bboxes}))
    print(f"  SAM2: {len(bboxes)} masks")
    return bboxes


def score_image_for(tile: str, image_path: Path, overlay_out: Path, client: httpx.Client) -> dict:
    """Fidelidad de layout de una imagen contra el blueprint del fixture."""
    dump = json.loads((FIXTURES[tile] / "blueprint.json").read_text())
    img = Image.open(image_path)
    expected = fs.expected_from_dump(dump, img.width, img.height)
    bboxes = segment_bboxes(image_path, client)
    metrics = fs.score(expected, bboxes, img.width, img.height)
    overlay_out.parent.mkdir(parents=True, exist_ok=True)
    fs.draw_overlay(img, metrics, str(overlay_out))
    public = {k: v for k, v in metrics.items() if not k.startswith("_")}
    public["n_sam_masks"] = len(bboxes)
    return public
