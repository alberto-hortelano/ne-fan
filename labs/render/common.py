"""common.py — helpers del bench labs/render sobre labs.common.

Lo compartible (claves, fal_call con caché+gasto, data URIs, raster, SAM2)
vive en labs/common; aquí quedan los fixtures y el scoring del bench. La
caché histórica sigue en runs/_cache (moverla invalidaría llamadas pagadas).
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
from PIL import Image

LAB = Path(__file__).resolve().parent
REPO = LAB.parent.parent
CACHE = LAB / "runs" / "_cache"
SPEND = CACHE / "spend.json"

sys.path.insert(0, str(REPO))
from labs.common import fal as _fal  # noqa: E402
from labs.common import sam as _sam  # noqa: E402
from labs.common import fidelity_score as fs  # noqa: E402
from labs.common.images import (  # noqa: E402,F401
    CAPTURE_BG,
    PX_PER_UNIT,
    jpeg_data_uri,
    png_data_uri,
    png_rgba_data_uri,
    raster_svg,
)

FAL_BASE = _fal.FAL_BASE
SAM_MODEL = _sam.SAM_MODEL
SAM_COST = _sam.SAM_COST

FIXTURES = {
    "medieval": LAB / "fixtures/medieval",
    "scifi": LAB / "fixtures/scifi",
}

# El plan del tile medieval se mudó a nefan-core/test/fixtures/fps-plans/: es
# la entrada del golden del atlas fps (test/fps-atlas-golden.test.ts) y este
# lab se archiva. El resto de la fixture (blueprint, occluders, PNGs) sigue
# aquí porque solo lo usa este bench.
PLANS = {
    "medieval": REPO / "nefan-core/test/fixtures/fps-plans/medieval.json",
    "scifi": LAB / "fixtures/scifi/plan.json",
}


def load_key(name: str) -> str:
    return _fal.load_key(name)


def fal_client(timeout: float = 600.0) -> httpx.Client:
    return _fal.fal_client(timeout)


def add_spend(usd: float, what: str) -> float:
    return _fal.add_spend(SPEND, usd, what)


def total_spend() -> float:
    return _fal.total_spend(SPEND)


def fal_call(endpoint: str, payload: dict, cost_usd: float, client: httpx.Client, tag: str = "", extra_key: str = "") -> dict:
    return _fal.fal_call(endpoint, payload, cost_usd, client, CACHE, SPEND, tag, extra_key)


def download_image(entry_or_url, client: httpx.Client) -> bytes:
    return _fal.download_image(entry_or_url, client)


def segment_bboxes(image_path: Path, client: httpx.Client) -> list[tuple[float, float, float, float]]:
    return _sam.segment_bboxes(image_path, client, CACHE, spend_file=SPEND)


def score_image_for(tile: str, image_path: Path, overlay_out: Path, client: httpx.Client) -> dict:
    """Fidelidad de layout de una imagen contra el blueprint del fixture."""
    import json

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
