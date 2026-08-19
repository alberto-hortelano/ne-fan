#!/usr/bin/env python3
"""labs/skinning — bench reutilizable de skinning AI sobre sprites Mixamo.

Cada run produce una carpeta self-contained en `runs/` con un `index.html`
comparativo. El listado maestro `labs/skinning/index.html` se regenera al final
de cada run.

Uso:
  python3 labs/skinning/run.py --list-presets
  python3 labs/skinning/run.py --preset y_bot_walk_4kf --preview-only
  python3 labs/skinning/run.py --preset y_bot_walk_4kf
  python3 labs/skinning/run.py --preset y_bot_walk_4kf --variants V4 --frame-indices "0,3,6,10"
  ./labs/skinning/serve.sh

Para añadir un proveedor nuevo, ver README.md sección "Añadir un proveedor".
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import datetime as _dt
import io
import json
import math
import os
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

LAB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAB_DIR.parent.parent
sys.path.insert(0, str(REPO_ROOT))
# sprite_skin_meshy (fuente única del prompt del hero) usa imports planos
# internos de ai_server (dev_api_cache, meshy_client): mismo path que en los
# procesos del server.
sys.path.insert(0, str(REPO_ROOT / "ai_server"))

from labs.common.env import load_env_file  # noqa: E402

load_env_file()

import httpx
from PIL import Image, ImageDraw, ImageFont

from ai_server.meshy_client import MeshyImageToImage
from ai_server.sprite_skin_meshy import build_atlas_prompt, hero_prompt_suffix
from labs.skinning.sheet import (  # noqa: E402
    atlas_layout,
    compose_atlas,
    compose_grid_atlas,
    fit_atlas_output,
    keyframe_indices,
    png_to_data_uri,
    split_atlas,
    write_gif,
)

SPRITES_ROOT = REPO_ROOT / "nefan-html" / "public" / "sprites"
RUNS_DIR = LAB_DIR / "runs"
PRESETS_DIR = LAB_DIR / "presets"

ALL_MESHY_MODELS = ["nano-banana", "nano-banana-2", "nano-banana-pro", "gpt-image-2"]
ALL_VARIANTS = ["V1", "V2", "V3", "V4", "V5"]

VARIANT_FOLDER = {
    "V1": "V1_single",
    "V2": "V2_anchor",
    "V3": "V3_rolling",
    "V4": "V4_atlas",
    "V5": "V5_packed",
}

VARIANT_LABEL = {
    "V1": "V1 single",
    "V2": "V2 anchor",
    "V3": "V3 rolling",
    "V4": "V4 atlas",
    "V5": "V5 packed (multi-dir)",
}

# Heroes del bench (réplica del hero-shot de producción) cacheados entre runs
# para no pagar la identidad en cada iteración del preset.
HEROES_DIR = LAB_DIR / "heroes"

DEFAULT_PROMPT = (
    "campesino arapiento, andrajos marrones, capucha tosca, cara sucia, "
    "sin armadura, mismo encuadre y misma pose, full body, isometric view"
)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class FrameJob:
    variant: str
    model: str
    direction: int
    frame_idx: int
    src_frame_path: Path
    out_frame_path: Path
    cost_usd: float


@dataclass
class JobResult:
    job: FrameJob
    ok: bool
    error: str = ""
    latency_s: float = 0.0
    task_id: str = ""


# ---------------------------------------------------------------------------
# Frame sampling
# ---------------------------------------------------------------------------


def load_meta(base_rel: str) -> dict:
    return json.loads((SPRITES_ROOT / base_rel / "meta.json").read_text())


def src_frame_path(base_rel: str, direction: int, frame_idx: int) -> Path:
    return SPRITES_ROOT / base_rel / f"dir_{direction}_frame_{frame_idx:03d}.png"


def sample_frame_indices_stride(src_count: int, src_fps: int, target_fps: int, want: int) -> list[int]:
    """Drop fps src→target, take first `want`."""
    if target_fps >= src_fps:
        return list(range(min(want, src_count)))
    stride = src_fps / target_fps
    indices: list[int] = []
    i = 0.0
    while len(indices) < want and round(i) < src_count:
        idx = int(round(i))
        if not indices or idx != indices[-1]:
            indices.append(idx)
        i += stride
    return indices[:want]


def auto_anchors(base_rel: str, meta: dict) -> list[Path]:
    """V2 default anchors: front-facing frame 0 + mid-loop frame from dir 0."""
    fc = meta["frame_count"]
    return [src_frame_path(base_rel, 0, 0), src_frame_path(base_rel, 0, fc // 2)]


# ---------------------------------------------------------------------------
# Preview helpers (no API spend)
# ---------------------------------------------------------------------------


def _draw_label(img: Image.Image, text: str) -> None:
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except (OSError, IOError):
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    pad = 4
    w = bbox[2] - bbox[0] + pad * 2
    h = bbox[3] - bbox[1] + pad * 2
    draw.rectangle((4, 4, 4 + w, 4 + h), fill=(0, 0, 0, 220))
    draw.text((4 + pad, 4 + pad - bbox[1]), text, fill=(255, 220, 80), font=font)


def build_contact_sheet(src_paths: list[Path], indices: list[int], out_path: Path,
                        per_row: int = 12) -> None:
    if not src_paths:
        return
    fw, fh = Image.open(src_paths[0]).size
    rows = int(math.ceil(len(src_paths) / per_row))
    sheet = Image.new("RGBA", (per_row * fw, rows * fh), (40, 40, 48, 255))
    for i, (idx, p) in enumerate(zip(indices, src_paths)):
        r, c = divmod(i, per_row)
        cell = Image.open(p).convert("RGBA")
        sheet.paste(cell, (c * fw, r * fh), cell)
        cell_label = sheet.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
        _draw_label(cell_label, str(idx))
        sheet.paste(cell_label, (c * fw, r * fh))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def build_keyframes_preview(picked_paths: list[Path], picked_indices: list[int], out_path: Path) -> None:
    if not picked_paths:
        return
    fw, fh = Image.open(picked_paths[0]).size
    n = len(picked_paths)
    sheet = Image.new("RGBA", (n * fw, fh), (40, 40, 48, 255))
    for i, (idx, p) in enumerate(zip(picked_indices, picked_paths)):
        cell = Image.open(p).convert("RGBA")
        sheet.paste(cell, (i * fw, 0), cell)
        cell_label = sheet.crop((i * fw, 0, (i + 1) * fw, fh))
        _draw_label(cell_label, f"#{idx}")
        sheet.paste(cell_label, (i * fw, 0))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


# ---------------------------------------------------------------------------
# Variant runners
# ---------------------------------------------------------------------------


async def run_v1(client, api, sem, prompt, src_paths, model, out_dir):
    async def one(idx, src):
        async with sem:
            t0 = time.perf_counter()
            try:
                refs = [png_to_data_uri(src)]
                png_bytes, task_dict = await api.run_one(model, prompt, refs, client=client)
                out_path = out_dir / f"frame_{idx:03d}.png"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(png_bytes)
                return JobResult(
                    job=FrameJob("V1", model, 0, idx, src, out_path, api.cost_usd(model)),
                    ok=True, latency_s=time.perf_counter() - t0,
                    task_id=task_dict.get("id", "") or task_dict.get("task_id", ""))
            except Exception as e:
                return JobResult(
                    job=FrameJob("V1", model, 0, idx, src, out_dir / f"frame_{idx:03d}.png", api.cost_usd(model)),
                    ok=False, error=f"{type(e).__name__}: {e}",
                    latency_s=time.perf_counter() - t0)
    return await asyncio.gather(*(one(i, p) for i, p in enumerate(src_paths)))


async def run_v2(client, api, sem, prompt, src_paths, anchor_paths, model, out_dir):
    anchor_uris = [png_to_data_uri(a) for a in anchor_paths[:2]]
    async def one(idx, src):
        async with sem:
            t0 = time.perf_counter()
            try:
                refs = [png_to_data_uri(src), *anchor_uris]
                png_bytes, task_dict = await api.run_one(model, prompt, refs, client=client)
                out_path = out_dir / f"frame_{idx:03d}.png"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(png_bytes)
                return JobResult(
                    job=FrameJob("V2", model, 0, idx, src, out_path, api.cost_usd(model)),
                    ok=True, latency_s=time.perf_counter() - t0,
                    task_id=task_dict.get("id", "") or task_dict.get("task_id", ""))
            except Exception as e:
                return JobResult(
                    job=FrameJob("V2", model, 0, idx, src, out_dir / f"frame_{idx:03d}.png", api.cost_usd(model)),
                    ok=False, error=f"{type(e).__name__}: {e}",
                    latency_s=time.perf_counter() - t0)
    return await asyncio.gather(*(one(i, p) for i, p in enumerate(src_paths)))


async def run_v3(client, api, prompt, src_paths, model, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[JobResult] = []
    first_uri: Optional[str] = None
    prev_uri: Optional[str] = None
    for idx, src in enumerate(src_paths):
        t0 = time.perf_counter()
        try:
            refs = [png_to_data_uri(src)]
            if prev_uri is not None:
                refs.append(prev_uri)
            if first_uri is not None and first_uri is not prev_uri:
                refs.append(first_uri)
            png_bytes, task_dict = await api.run_one(model, prompt, refs, client=client)
            out_path = out_dir / f"frame_{idx:03d}.png"
            out_path.write_bytes(png_bytes)
            this_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
            if first_uri is None:
                first_uri = this_uri
            prev_uri = this_uri
            results.append(JobResult(
                job=FrameJob("V3", model, 0, idx, src, out_path, api.cost_usd(model)),
                ok=True, latency_s=time.perf_counter() - t0,
                task_id=task_dict.get("id", "") or task_dict.get("task_id", "")))
        except Exception as e:
            results.append(JobResult(
                job=FrameJob("V3", model, 0, idx, src, out_dir / f"frame_{idx:03d}.png", api.cost_usd(model)),
                ok=False, error=f"{type(e).__name__}: {e}",
                latency_s=time.perf_counter() - t0))
    return results


async def run_v4(client, api, prompt, src_paths, model, out_dir, frame_size):
    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(src_paths)
    atlas, layout, _ = compose_atlas(src_paths, frame_size)
    atlas_in = out_dir / "grid_input.png"
    atlas.save(atlas_in)
    atlas_prompt = (
        f"{prompt}. Same {layout[0]}x{layout[1]} grid layout, same number of frames, "
        f"keep each cell aligned, do not add new cells, do not crop frames"
    )
    t0 = time.perf_counter()
    try:
        refs = [png_to_data_uri(atlas_in)]
        png_bytes, task_dict = await api.run_one(model, atlas_prompt, refs, client=client)
        atlas_out_path = out_dir / "grid_output.png"
        atlas_out_path.write_bytes(png_bytes)
        atlas_out = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        frames = split_atlas(atlas_out, layout, n, frame_size)
        for i, fr in enumerate(frames):
            fr.save(out_dir / f"frame_{i:03d}.png")
        latency = time.perf_counter() - t0
        cost = api.cost_usd(model)
        results: list[JobResult] = []
        for i, src in enumerate(src_paths):
            results.append(JobResult(
                job=FrameJob("V4", model, 0, i, src, out_dir / f"frame_{i:03d}.png",
                             cost if i == 0 else 0.0),
                ok=True, latency_s=latency if i == 0 else 0.0,
                task_id=(task_dict.get("id", "") or task_dict.get("task_id", "")) if i == 0 else ""))
        return results
    except Exception as e:
        return [JobResult(
            job=FrameJob("V4", model, 0, 0, src_paths[0], out_dir / "grid_output.png", api.cost_usd(model)),
            ok=False, error=f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=2)}",
            latency_s=time.perf_counter() - t0)]


def hero_cache_path(prompt: str, model: str, angle: str) -> Path:
    import hashlib
    # El sufijo entra en la clave: si producción cambia la pose/encuadre del
    # hero, el bench regenera en vez de reusar un hero rancio.
    key = hashlib.sha256(
        f"{prompt.strip().lower()}|{model}|{angle}|{hero_prompt_suffix(angle)}".encode()
    ).hexdigest()[:16]
    return HEROES_DIR / f"{key}.png"


async def ensure_hero(client, api, prompt: str, base_model_dir: str, angle: str, model: str) -> Path:
    """Hero-shot de identidad, réplica del de producción
    (sprite_skin_meshy.hero_shot): img2img del frame idle frontal del modelo
    base con el prompt + sufijo de vista. Cacheado en labs/skinning/heroes/."""
    out = hero_cache_path(prompt, model, angle)
    if out.exists():
        return out
    base_frame = SPRITES_ROOT / base_model_dir / "idle" / angle / "dir_0_frame_000.png"
    if not base_frame.exists():
        raise FileNotFoundError(f"hero base frame missing: {base_frame}")
    hero_prompt = prompt.strip() + hero_prompt_suffix(angle)
    png_bytes, _ = await api.run_one(model, hero_prompt, [png_to_data_uri(base_frame)], client=client)
    HEROES_DIR.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png_bytes)
    return out


async def run_v5(client, api, prompt, base_rel, pack_indices, pack_dirs, model, out_dir,
                 frame_size, hero_uri, square=False):
    """V5 packed: UNA llamada con un grid multi-dirección (cols = keyframes,
    fila = dirección) + hero como 2ª ref — el prompt replica el de producción
    (_skin_dir_batch) más la cláusula direccional."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rows_of_paths = [
        [src_frame_path(base_rel, d, i) for i in pack_indices] for d in pack_dirs
    ]
    missing = [p for row in rows_of_paths for p in row if not p.exists()]
    if missing:
        raise FileNotFoundError(f"missing source frames: {missing[0]}")
    if square and len(pack_dirs) == 1:
        # Mismo camino que producción para lotes de una dirección: grid
        # cuadrado-ish (atlas_layout), no una fila 8×1 de aspecto extremo.
        atlas, layout, _ = compose_atlas(rows_of_paths[0], frame_size)
    else:
        atlas, layout, _ = compose_grid_atlas(rows_of_paths, frame_size)
    atlas_in = out_dir / "grid_input.png"
    atlas.save(atlas_in)
    cols, rows = layout
    # Prompt de PRODUCCIÓN (fuente única) — el bench mide lo que el juego usa.
    atlas_prompt = build_atlas_prompt(prompt, layout, multi_dir=len(pack_dirs) > 1)
    t0 = time.perf_counter()
    n = cols * rows
    try:
        refs = [png_to_data_uri(atlas_in)]
        if hero_uri:
            refs.append(hero_uri)
        png_bytes, task_dict = await api.run_one(model, atlas_prompt, refs, client=client)
        (out_dir / "grid_output.png").write_bytes(png_bytes)
        atlas_out = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        # gpt-image-2 devuelve lienzo cuadrado: los grids apaisados llegan
        # letterboxeados y el resize directo los aplasta.
        atlas_out = fit_atlas_output(atlas_out, (layout[0] * frame_size[0], layout[1] * frame_size[1]))
        frames = split_atlas(atlas_out, layout, n, frame_size)
        results: list[JobResult] = []
        latency = time.perf_counter() - t0
        cost = api.cost_usd(model)
        # (dir, frame, celda row-major del atlas): en grid multi-dir la fila es
        # la dirección; en square (1 dir) los keyframes recorren el grid plano.
        cells = ([(pack_dirs[0], c, c) for c in range(len(pack_indices))]
                 if square and len(pack_dirs) == 1 else
                 [(d, c, r * cols + c) for r, d in enumerate(pack_dirs) for c in range(cols)])
        for i, (d, c, flat) in enumerate(cells):
            fr = frames[flat]
            out_path = out_dir / f"dir_{d}_frame_{c:03d}.png"
            fr.save(out_path)
            first = i == 0
            src = rows_of_paths[0][c] if square else rows_of_paths[pack_dirs.index(d)][c]
            results.append(JobResult(
                job=FrameJob("V5", model, d, c, src, out_path,
                             cost if first else 0.0),
                ok=True, latency_s=latency if first else 0.0,
                task_id=(task_dict.get("id", "") or task_dict.get("task_id", "")) if first else ""))
        return results
    except Exception as e:
        return [JobResult(
            job=FrameJob("V5", model, pack_dirs[0], 0, rows_of_paths[0][0],
                         out_dir / "grid_output.png", api.cost_usd(model)),
            ok=False, error=f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=2)}",
            latency_s=time.perf_counter() - t0)]


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


def planned_calls(variants: list[str], models: list[str], frames: int, dirs: int,
                  hero_pending_models: list[str] | None = None) -> list[tuple[str, str, int]]:
    out: list[tuple[str, str, int]] = []
    for v in variants:
        for m in models:
            if v == "V4":
                n_calls = dirs
            elif v == "V5":
                # Un solo atlas multi-dirección (+1 hero si aún no está cacheado).
                n_calls = 1 + (1 if m in (hero_pending_models or []) else 0)
            else:
                n_calls = frames * dirs
            out.append((v, m, n_calls))
    return out


def projected_cost(plan: list[tuple[str, str, int]]) -> float:
    return sum(MeshyImageToImage.cost_usd(m) * n for _, m, n in plan)


def print_plan(plan: list[tuple[str, str, int]]) -> None:
    print(f"{'variant':<10} {'model':<20} {'calls':>6} {'usd':>8}")
    print("-" * 48)
    total_calls, total_usd = 0, 0.0
    for v, m, n in plan:
        cost = MeshyImageToImage.cost_usd(m) * n
        print(f"{v:<10} {m:<20} {n:>6} {cost:>8.2f}")
        total_calls += n
        total_usd += cost
    print("-" * 48)
    print(f"{'TOTAL':<10} {'':<20} {total_calls:>6} {total_usd:>8.2f}")


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------


_RUN_HTML_HEAD = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font: 14px system-ui, sans-serif; background: #1b1b1f; color: #e8e8ec; margin: 0; padding: 24px; }}
  h1 {{ margin: 0 0 4px; font-weight: 600; }}
  h2 {{ margin: 32px 0 12px; font-weight: 500; color: #c5c5cc; }}
  p.meta {{ color: #9b9ba0; margin: 4px 0 16px; }}
  table {{ border-collapse: collapse; }}
  th, td {{ padding: 10px; text-align: center; vertical-align: top; border: 1px solid #2c2c34; }}
  th {{ background: #25252b; font-weight: 500; color: #c5c5cc; }}
  th.row {{ text-align: right; padding-right: 14px; min-width: 110px; }}
  td img {{ width: 256px; height: 256px; image-rendering: pixelated;
           background: repeating-conic-gradient(#222 0% 25%, #2a2a2a 0% 50%) 50% / 16px 16px;
           border-radius: 4px; }}
  td .cost {{ color: #9b9ba0; font-size: 11px; margin-top: 4px; }}
  img.contact {{ max-width: 100%; image-rendering: pixelated; background: #25252b;
                border: 1px solid #2c2c34; border-radius: 4px; display: block; }}
  img.atlas-raw {{ width: 480px; image-rendering: pixelated; background: #25252b;
                  border: 1px solid #2c2c34; border-radius: 4px; }}
  code {{ background: #25252b; padding: 1px 6px; border-radius: 3px; }}
  a {{ color: #6c8cd5; }}
  .legend {{ color: #9b9ba0; font-size: 12px; }}
  .row-flex {{ display: flex; gap: 16px; flex-wrap: wrap; }}
</style>
</head>
<body>
"""

_RUN_HTML_FOOT = "</body></html>\n"


def render_run_index(run_dir: Path, meta: dict, results_by_key: dict) -> None:
    parts: list[str] = [
        _RUN_HTML_HEAD.format(title=f"Run · {meta['run_id']}"),
        f"<h1>{meta['preset_name']} <span style='color:#888;font-weight:400;font-size:18px'>· {meta['run_id']}</span></h1>",
        f"<p class='meta'>"
        f"source: <code>{meta['base_sprites']}</code> · "
        f"{meta['n_frames']} frames @ {meta['target_fps']} fps · "
        f"sampling: {meta['sampling']} · "
        f"indices: <code>{meta['indices']}</code></p>",
        f"<p class='meta'>prompt: <em>{meta['prompt']}</em></p>",
        f"<p class='meta'>coste real: <strong>${meta['total_usd']:.2f}</strong> · {meta['total_calls']} llamadas OK · "
        f"<a href='meta.json'>meta.json</a> · <a href='costs.json'>costs.json</a></p>",
    ]

    parts.append("<h2>Source</h2>")
    parts.append("<div class='row-flex'>")
    parts.append("<div><p class='legend'>Contact sheet (todos los frames numerados)</p>"
                 "<img class='contact' src='contact_sheet.png'></div>")
    parts.append("<div><p class='legend'>Keyframes elegidos</p>"
                 "<img class='contact' src='keyframes_preview.png'></div>")
    parts.append("</div>")

    parts.append("<h2>Resultados</h2>")
    parts.append("<table>")
    models_used = meta["models"]
    parts.append("<tr><th></th>" + "".join(f"<th>{m}<br><small>${MeshyImageToImage.cost_usd(m):.2f}/img</small></th>" for m in models_used) + "</tr>")
    for v in meta["variants"]:
        cells = [f"<th class='row'>{VARIANT_LABEL[v]}</th>"]
        for m in models_used:
            folder = VARIANT_FOLDER[v]
            gif_rel = f"{folder}/{m}/loop.gif"
            if (run_dir / gif_rel).exists():
                rs = results_by_key.get((v, m), [])
                ok = sum(1 for r in rs if r.ok)
                spend = sum(r.job.cost_usd for r in rs if r.ok)
                cells.append(f"<td><img src='{gif_rel}'><div class='cost'>${spend:.2f} · {ok}/{len(rs)}</div></td>")
            else:
                cells.append("<td><span style='color:#777'>—</span></td>")
        parts.append("<tr>" + "".join(cells) + "</tr>")
    parts.append("</table>")

    if "V4" in meta["variants"]:
        parts.append("<h2>V4 atlas raw (input → output)</h2>")
        parts.append("<div class='row-flex'>")
        for m in models_used:
            v4_dir = run_dir / "V4_atlas" / m
            if (v4_dir / "grid_input.png").exists():
                parts.append(f"<div><p class='legend'>{m} input</p>"
                             f"<img class='atlas-raw' src='V4_atlas/{m}/grid_input.png'></div>")
            if (v4_dir / "grid_output.png").exists():
                parts.append(f"<div><p class='legend'>{m} output</p>"
                             f"<img class='atlas-raw' src='V4_atlas/{m}/grid_output.png'></div>")
        parts.append("</div>")

    if "V5" in meta["variants"]:
        pack_meta = meta.get("pack") or {}
        pack_dirs = pack_meta.get("directions", [])
        parts.append(f"<h2>V5 packed — grid multi-dirección "
                     f"<small class='legend'>(fila = dirección {pack_dirs})</small></h2>")
        for m in models_used:
            v5_dir = run_dir / "V5_packed" / m
            if not v5_dir.exists():
                continue
            parts.append(f"<h3 style='font-weight:500;color:#c5c5cc'>{m}</h3>")
            parts.append("<div class='row-flex'>")
            if (v5_dir / "grid_input.png").exists():
                parts.append(f"<div><p class='legend'>input</p>"
                             f"<img class='atlas-raw' src='V5_packed/{m}/grid_input.png'></div>")
            if (v5_dir / "grid_output.png").exists():
                parts.append(f"<div><p class='legend'>output</p>"
                             f"<img class='atlas-raw' src='V5_packed/{m}/grid_output.png'></div>")
            parts.append("</div>")
            gif_cells = []
            for d in pack_dirs:
                if (v5_dir / f"dir_{d}.gif").exists():
                    gif_cells.append(f"<div><p class='legend'>dir {d}</p>"
                                     f"<img src='V5_packed/{m}/dir_{d}.gif' "
                                     f"style='width:192px;height:192px;image-rendering:pixelated'></div>")
            if gif_cells:
                parts.append("<div class='row-flex'>" + "".join(gif_cells) + "</div>")

    errors = []
    for (v, m), rs in results_by_key.items():
        for r in rs:
            if not r.ok:
                errors.append((v, m, r))
    if errors:
        parts.append("<h2>Errores</h2><ul>")
        for v, m, r in errors[:20]:
            parts.append(f"<li>{v} / {m} frame {r.job.frame_idx}: <code>{r.error}</code></li>")
        parts.append("</ul>")

    parts.append("<p class='legend' style='margin-top:32px'>"
                 "<a href='../../index.html'>← todos los runs</a></p>")
    parts.append(_RUN_HTML_FOOT)
    (run_dir / "index.html").write_text("".join(parts))


def render_lab_index() -> None:
    """Rebuild labs/skinning/index.html listing every run with a thumbnail."""
    runs = []
    for run_dir in sorted(RUNS_DIR.iterdir(), reverse=True):
        if not run_dir.is_dir():
            continue
        meta_path = run_dir / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
        except Exception:
            continue
        # Pick a thumbnail: first GIF found
        thumb = None
        for v in meta.get("variants", []):
            for m in meta.get("models", []):
                gif = run_dir / VARIANT_FOLDER.get(v, "") / m / "loop.gif"
                if gif.exists():
                    thumb = gif.relative_to(LAB_DIR).as_posix()
                    break
            if thumb:
                break
        runs.append((run_dir.name, meta, thumb))

    parts: list[str] = [
        _RUN_HTML_HEAD.format(title="labs/skinning — runs"),
        "<h1>labs/skinning</h1>",
        "<p class='meta'>Bench reusable de skinning AI sobre sprites Mixamo. "
        "Cada celda enlaza al run completo. Lanza nuevos runs con "
        "<code>python3 labs/skinning/run.py --preset NAME</code>.</p>",
    ]

    if not runs:
        parts.append("<p>No hay runs todavía. Empieza con "
                     "<code>python3 labs/skinning/run.py --list-presets</code>.</p>")
    else:
        parts.append("<table><tr><th>run</th><th>preset</th><th>preview</th>"
                     "<th>variants × models</th><th>frames</th><th>coste</th><th></th></tr>")
        for run_id, meta, thumb in runs:
            preview_cell = f"<img src='{thumb}' style='width:160px;height:160px'>" if thumb else "—"
            vm = (f"{', '.join(meta.get('variants', []))}<br>"
                  f"<small>{', '.join(meta.get('models', []))}</small>")
            parts.append(
                f"<tr><td><code>{run_id}</code></td>"
                f"<td>{meta.get('preset_name', '?')}</td>"
                f"<td>{preview_cell}</td>"
                f"<td>{vm}</td>"
                f"<td>{meta.get('n_frames', '?')}</td>"
                f"<td>${meta.get('total_usd', 0):.2f}</td>"
                f"<td><a href='runs/{run_id}/index.html'>abrir →</a></td></tr>"
            )
        parts.append("</table>")

    parts.append(_RUN_HTML_FOOT)
    (LAB_DIR / "index.html").write_text("".join(parts))


# ---------------------------------------------------------------------------
# Preset loading
# ---------------------------------------------------------------------------


def load_preset(name: str) -> dict:
    p = PRESETS_DIR / f"{name}.json"
    if not p.exists():
        raise FileNotFoundError(f"preset not found: {p}")
    return json.loads(p.read_text())


def list_presets() -> None:
    if not PRESETS_DIR.exists() or not any(PRESETS_DIR.iterdir()):
        print("(no presets)")
        return
    print(f"{'name':<28} {'description'}")
    print("-" * 80)
    for p in sorted(PRESETS_DIR.glob("*.json")):
        try:
            data = json.loads(p.read_text())
            print(f"{p.stem:<28} {data.get('description', '')[:50]}")
        except Exception as e:
            print(f"{p.stem:<28} (error: {e})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--preset", help="preset name (filename without .json under presets/)")
    p.add_argument("--list-presets", action="store_true", help="list available presets and exit")
    # Overrides
    p.add_argument("--base-sprites", help="override base_sprites")
    p.add_argument("--frames", type=int, help="stride-sampled frames (legacy)")
    p.add_argument("--keyframes", type=int, help="evenly-spaced keyframes covering whole cycle")
    p.add_argument("--frame-indices", help='explicit indices, e.g. "0,3,7,10" (overrides keyframes/frames)')
    p.add_argument("--target-fps", type=int)
    p.add_argument("--directions", type=int)
    p.add_argument("--variants", nargs="+", choices=ALL_VARIANTS + ["all"])
    p.add_argument("--models", nargs="+", choices=ALL_MESHY_MODELS + ["all"])
    p.add_argument("--prompt")
    p.add_argument("--anchor-images", nargs="*")
    p.add_argument("--budget-usd", type=float)
    p.add_argument("--concurrency", type=int)
    p.add_argument("--preview-only", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    if args.list_presets:
        list_presets()
        sys.exit(0)
    if not args.preset:
        p.error("--preset is required (or use --list-presets)")
    return args


def merge_config(preset: dict, args: argparse.Namespace) -> dict:
    """Preset values + CLI overrides. CLI wins when set."""
    config = {
        "preset_name": preset.get("name", args.preset),
        "description": preset.get("description", ""),
        "base_sprites": preset.get("base_sprites"),
        "frames": preset.get("frames"),
        "keyframes": preset.get("keyframes"),
        "frame_indices": preset.get("frame_indices"),
        "target_fps": preset.get("target_fps", 8),
        "directions": preset.get("directions", 1),
        "variants": preset.get("variants", ALL_VARIANTS),
        "models": preset.get("models", ALL_MESHY_MODELS),
        "prompt": preset.get("prompt", DEFAULT_PROMPT),
        "anchor_images": preset.get("anchor_images"),
        "concurrency": preset.get("concurrency", 8),
        "budget_usd": preset.get("budget_usd", 5.0),
        # V5 packed: {"directions": [0, 4], "keyframes": 4} — filas del grid.
        "pack": preset.get("pack"),
        # V5: hero-shot de identidad como 2ª ref (réplica de producción).
        "use_hero": preset.get("use_hero", False),
    }
    overrides = {
        "base_sprites": args.base_sprites,
        "frames": args.frames,
        "keyframes": args.keyframes,
        "frame_indices": args.frame_indices,
        "target_fps": args.target_fps,
        "directions": args.directions,
        "variants": args.variants,
        "models": args.models,
        "prompt": args.prompt,
        "anchor_images": args.anchor_images,
        "concurrency": args.concurrency,
        "budget_usd": args.budget_usd,
    }
    for k, v in overrides.items():
        if v is not None:
            config[k] = v
    if config["variants"] and "all" in config["variants"]:
        config["variants"] = ALL_VARIANTS
    if config["models"] and "all" in config["models"]:
        config["models"] = ALL_MESHY_MODELS
    return config


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main_async(args: argparse.Namespace) -> int:
    preset = load_preset(args.preset)
    config = merge_config(preset, args)

    if not config["base_sprites"]:
        print("ERROR: base_sprites missing in preset and not overridden", file=sys.stderr)
        return 2

    base_rel = config["base_sprites"]
    meta = load_meta(base_rel)
    src_fps = int(meta["fps"])
    fc = int(meta["frame_count"])
    fw = int(meta["frame_width"])
    fh = int(meta["frame_height"])

    # Pick frame indices
    if config["frame_indices"]:
        if isinstance(config["frame_indices"], str):
            indices = [int(x.strip()) for x in config["frame_indices"].split(",") if x.strip()]
        else:
            indices = list(config["frame_indices"])
        sampling = "explicit"
    elif config["keyframes"]:
        indices = keyframe_indices(fc, config["keyframes"])
        sampling = f"keyframes ({config['keyframes']} evenly across cycle)"
    elif config["frames"]:
        indices = sample_frame_indices_stride(fc, src_fps, config["target_fps"], config["frames"])
        sampling = f"stride ({src_fps}→{config['target_fps']} fps, want {config['frames']})"
    else:
        print("ERROR: preset must define one of: keyframes, frame_indices, frames", file=sys.stderr)
        return 2

    if not indices:
        print(f"ERROR: no frames sampled (mode={sampling})", file=sys.stderr)
        return 2

    direction = 0
    src_paths = [src_frame_path(base_rel, direction, i) for i in indices]
    missing = [p for p in src_paths if not p.exists()]
    if missing:
        print(f"ERROR: missing source frames: {missing[:3]}...", file=sys.stderr)
        return 2

    # V5 packed: filas = direcciones del pack, cols = keyframes.
    pack = config.get("pack") or {}
    pack_dirs: list[int] = [int(d) for d in pack.get("directions", [])]
    pack_indices = (keyframe_indices(fc, int(pack["keyframes"]))
                    if pack.get("keyframes") else indices)
    if "V5" in config["variants"] and not pack_dirs:
        print("ERROR: la variante V5 requiere `pack.directions` en el preset", file=sys.stderr)
        return 2
    # base_rel = "{modelo}/{anim}/{angle}" — el hero usa idle del mismo ángulo.
    base_model_dir, _, base_angle = base_rel.split("/")
    hero_pending = [
        m for m in config["models"]
        if "V5" in config["variants"] and config["use_hero"]
        and not hero_cache_path(config["prompt"], m, base_angle).exists()
    ]

    # Run dir
    timestamp = _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_id = f"{timestamp}_{config['preset_name']}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Previews always
    contact_path = run_dir / "contact_sheet.png"
    kf_path = run_dir / "keyframes_preview.png"
    all_paths = [src_frame_path(base_rel, direction, i) for i in range(fc)]
    build_contact_sheet(all_paths, list(range(fc)), contact_path)
    build_keyframes_preview(src_paths, indices, kf_path)
    print(f"Run dir: {run_dir.relative_to(REPO_ROOT)}")
    print(f"  contact_sheet:    contact_sheet.png")
    print(f"  keyframes preview: keyframes_preview.png\n")

    # Plan
    plan = planned_calls(config["variants"], config["models"], len(src_paths),
                         config["directions"], hero_pending)
    proj = projected_cost(plan)
    print(f"Sampled {len(src_paths)} frames from {base_rel} dir={direction} via {sampling}")
    print(f"  indices: {indices}")
    if "V5" in config["variants"]:
        print(f"  V5 pack: dirs={pack_dirs} × kf={pack_indices} "
              f"({len(pack_indices)}x{len(pack_dirs)} celdas, hero={'sí' if config['use_hero'] else 'no'})")
    print(f"  frame size: {fw}x{fh} px\n")
    print_plan(plan)
    print()

    if args.preview_only:
        # Save partial meta with no results so the run still appears in the lab index.
        partial_meta = {
            "run_id": run_id, "preset_name": config["preset_name"],
            "base_sprites": base_rel, "n_frames": len(src_paths), "indices": indices,
            "sampling": sampling, "target_fps": config["target_fps"],
            "variants": config["variants"], "models": config["models"],
            "prompt": config["prompt"], "total_usd": 0.0, "total_calls": 0,
            "preview_only": True,
        }
        (run_dir / "meta.json").write_text(json.dumps(partial_meta, indent=2))
        render_run_index(run_dir, partial_meta, {})
        render_lab_index()
        print(f"(--preview-only) inspeccionar {run_dir/'index.html'}")
        return 0

    if proj > config["budget_usd"]:
        print(f"ABORT: projected ${proj:.2f} > budget ${config['budget_usd']:.2f}", file=sys.stderr)
        return 3

    if args.dry_run:
        print("(dry-run) no API calls.")
        return 0

    if not os.environ.get("MESHY_API_KEY"):
        print("ERROR: MESHY_API_KEY not set", file=sys.stderr)
        return 2

    api = MeshyImageToImage()
    sem = asyncio.Semaphore(config["concurrency"])

    if config["anchor_images"]:
        anchor_paths = [Path(p) for p in config["anchor_images"]]
    else:
        anchor_paths = auto_anchors(base_rel, meta)
    if any(v == "V2" for v in config["variants"]):
        print(f"Anchors V2: {[p.name for p in anchor_paths]}\n")

    results_by_key: dict[tuple[str, str], list[JobResult]] = {}
    timeouts = httpx.Timeout(connect=15.0, read=180.0, write=180.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeouts) as client:
        hero_usd = 0.0
        for v in config["variants"]:
            for m in config["models"]:
                folder = VARIANT_FOLDER[v]
                out_dir = run_dir / folder / m
                if v not in ("V4", "V5"):
                    out_dir = out_dir / f"dir_{direction}"
                print(f"▶ {v} / {m} → {out_dir.relative_to(run_dir)}")
                t_v = time.perf_counter()
                if v == "V1":
                    rs = await run_v1(client, api, sem, config["prompt"], src_paths, m, out_dir)
                elif v == "V2":
                    rs = await run_v2(client, api, sem, config["prompt"], src_paths, anchor_paths, m, out_dir)
                elif v == "V3":
                    rs = await run_v3(client, api, config["prompt"], src_paths, m, out_dir)
                elif v == "V4":
                    rs = await run_v4(client, api, config["prompt"], src_paths, m, out_dir, (fw, fh))
                elif v == "V5":
                    hero_uri = ""
                    if config["use_hero"]:
                        hero_was_cached = hero_cache_path(config["prompt"], m, base_angle).exists()
                        hero_path = await ensure_hero(
                            client, api, config["prompt"], base_model_dir, base_angle, m)
                        if not hero_was_cached:
                            hero_usd += api.cost_usd(m)
                            print(f"  hero: generado (${api.cost_usd(m):.2f}) → {hero_path.name}")
                        else:
                            print(f"  hero: cache → {hero_path.name}")
                        hero_uri = png_to_data_uri(hero_path)
                    rs = await run_v5(client, api, config["prompt"], base_rel, pack_indices,
                                      pack_dirs, m, out_dir, (fw, fh), hero_uri,
                                      square=bool(pack.get("square")))
                else:
                    continue
                results_by_key[(v, m)] = rs
                ok = sum(1 for r in rs if r.ok)
                spend = sum(r.job.cost_usd for r in rs if r.ok)
                dt = time.perf_counter() - t_v
                print(f"  done: {ok}/{len(rs)} ok, ${spend:.2f}, {dt:.1f}s")

                if v == "V5":
                    # Un GIF por dirección; loop.gif = primera dir (thumbnail).
                    for d in pack_dirs:
                        d_paths = [r.job.out_frame_path for r in rs
                                   if r.ok and r.job.direction == d and r.job.out_frame_path.exists()]
                        if d_paths:
                            frames = [Image.open(p).convert("RGBA") for p in d_paths]
                            write_gif(frames, out_dir / f"dir_{d}.gif", config["target_fps"])
                    first_gif = out_dir / f"dir_{pack_dirs[0]}.gif"
                    if first_gif.exists():
                        (out_dir / "loop.gif").write_bytes(first_gif.read_bytes())
                        print(f"  gifs: dir_{{{','.join(map(str, pack_dirs))}}}.gif")
                    continue

                ok_paths = [r.job.out_frame_path for r in rs if r.ok and r.job.out_frame_path.exists()]
                if ok_paths:
                    frames = [Image.open(p).convert("RGBA") for p in ok_paths]
                    gif_path = (run_dir / folder / m / "loop.gif")
                    write_gif(frames, gif_path, config["target_fps"])
                    print(f"  gif:  {gif_path.relative_to(run_dir)}")

    # Persist
    total_calls = sum(1 for rs in results_by_key.values() for r in rs if r.ok)
    total_usd = sum(r.job.cost_usd for rs in results_by_key.values() for r in rs if r.ok) + hero_usd
    meta_out = {
        "run_id": run_id, "preset_name": config["preset_name"],
        "description": config.get("description", ""),
        "base_sprites": base_rel, "n_frames": len(src_paths), "indices": indices,
        "sampling": sampling, "target_fps": config["target_fps"],
        "variants": config["variants"], "models": config["models"],
        "prompt": config["prompt"], "total_usd": round(total_usd, 4), "total_calls": total_calls,
        "hero_usd": round(hero_usd, 4),
        "pack": ({"directions": pack_dirs, "indices": pack_indices}
                 if "V5" in config["variants"] else None),
        "generated_at": _dt.datetime.now().isoformat(timespec="seconds"),
    }
    (run_dir / "meta.json").write_text(json.dumps(meta_out, indent=2))

    costs_payload = []
    for (v, m), rs in results_by_key.items():
        for r in rs:
            costs_payload.append({
                "variant": v, "model": m, "frame": r.job.frame_idx, "ok": r.ok,
                "cost_usd": r.job.cost_usd, "latency_s": round(r.latency_s, 2),
                "task_id": r.task_id, "error": r.error,
            })
    (run_dir / "costs.json").write_text(json.dumps(costs_payload, indent=2))

    render_run_index(run_dir, meta_out, results_by_key)
    render_lab_index()

    print(f"\n✓ run completed. Total: {total_calls} calls, ${total_usd:.2f}")
    print(f"  open {run_dir/'index.html'} — or run ./labs/skinning/serve.sh")
    return 0


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
