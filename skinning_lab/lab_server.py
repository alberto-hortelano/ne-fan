#!/usr/bin/env python3
"""Local FastAPI server that backs the skinning_lab character generator.

Serves the static lab tree and exposes:
  POST /api/characters/{name}/hero_shot   { prompt, model? }
       → genera referencia 1024px desde y_bot/idle/dir_0_frame_000 + prompt
  POST /api/characters/{name}/skin        { anims, directions, model? }
       → para cada (anim, dir) compone keyframe atlas de Y Bot, llama Meshy
         con [atlas, hero_shot], descompone, escribe GIF skinneado.
  GET  /api/characters
       → listado para llenar el dropdown del viewer.

Requiere MESHY_API_KEY (.env del proyecto). Reusa MeshyImageToImage del
ai_server. Si no hay key, los endpoints fallan claramente con 503.

Uso:
  python3 skinning_lab/lab_server.py            # → http://localhost:8911
  python3 skinning_lab/lab_server.py --port 9000
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

LAB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAB_DIR.parent
SPRITES_ROOT = REPO_ROOT / "nefan-html" / "public" / "sprites"
CHARACTERS_DIR = LAB_DIR / "characters"
sys.path.insert(0, str(REPO_ROOT))


def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_env_file(REPO_ROOT / ".env")

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

from ai_server.meshy_client import MeshyImageToImage

# Same per-anim keyframe profiles used by build_base_browser.
# Keep these in sync.
ANIM_PROFILES: dict[str, tuple[int, float]] = {
    "idle":        (8, 2.2),
    "walk":        (4, 3.6),
    "run":         (4, 6.0),
    "quick":       (3, 4.0),
    "heavy":       (8, 6.0),
    "medium":      (4, 3.5),
    "defensive":   (2, 3.5),
    "precise":     (6, 4.5),
    "hit_react":   (3, 4.0),
    "death":       (8, 4.0),
}
DEFAULT_PROFILE = (4, 4.0)
DEFAULT_MODEL = "nano-banana-pro"
DEFAULT_BASE_MODEL = "y_bot"
DEFAULT_ANGLE = "isometric_30"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _slug(name: str) -> str:
    s = "".join(c if (c.isalnum() or c in "-_") else "_" for c in name.strip().lower())
    return s.strip("_") or "character"


def _png_to_data_uri(path: Path) -> str:
    return f"data:image/png;base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _image_to_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _keyframe_indices(src_count: int, n: int) -> list[int]:
    if n <= 0 or src_count <= 0:
        return []
    out: list[int] = []
    for i in range(n):
        idx = int(round(i * src_count / n))
        if idx >= src_count:
            idx = src_count - 1
        if not out or idx != out[-1]:
            out.append(idx)
    return out


def _atlas_layout(n: int) -> tuple[int, int]:
    cols = int(math.ceil(math.sqrt(n)))
    rows = int(math.ceil(n / cols))
    if cols < rows:
        cols, rows = rows, cols
    return cols, rows


def _compose_atlas(frame_paths: list[Path]) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    first = Image.open(frame_paths[0])
    fw, fh = first.size
    cols, rows = _atlas_layout(len(frame_paths))
    atlas = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, p in enumerate(frame_paths):
        r, c = divmod(i, cols)
        atlas.paste(Image.open(p).convert("RGBA"), (c * fw, r * fh))
    return atlas, (cols, rows), (fw, fh)


def _split_atlas(atlas: Image.Image, layout: tuple[int, int], n: int,
                 frame_size: tuple[int, int]) -> list[Image.Image]:
    cols, rows = layout
    fw, fh = frame_size
    expected = (cols * fw, rows * fh)
    if atlas.size != expected:
        atlas = atlas.resize(expected, Image.LANCZOS)
    frames: list[Image.Image] = []
    for i in range(n):
        r, c = divmod(i, cols)
        frames.append(atlas.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)))
    return frames


def _write_gif(frames: list[Image.Image], out_path: Path, fps: float) -> None:
    if not frames:
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration_ms = max(1, int(round(1000 / max(fps, 0.1))))
    rgba = [f.convert("RGBA") for f in frames]
    rgba[0].save(out_path, save_all=True, append_images=rgba[1:],
                 duration=duration_ms, loop=0, disposal=2)


def _meta_path(model: str, anim: str, angle: str) -> Path:
    return SPRITES_ROOT / model / anim / angle / "meta.json"


def _src_frame_path(model: str, anim: str, angle: str, direction: int, frame_idx: int) -> Path:
    return (SPRITES_ROOT / model / anim / angle /
            f"dir_{direction}_frame_{frame_idx:03d}.png")


def _character_dir(name: str) -> Path:
    return CHARACTERS_DIR / _slug(name)


def _character_config(char_dir: Path) -> dict:
    cfg_path = char_dir / "config.json"
    if cfg_path.exists():
        return json.loads(cfg_path.read_text())
    return {}


def _save_config(char_dir: Path, cfg: dict) -> None:
    char_dir.mkdir(parents=True, exist_ok=True)
    (char_dir / "config.json").write_text(json.dumps(cfg, indent=2))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class HeroShotRequest(BaseModel):
    prompt: str = Field(..., min_length=4)
    model: str = Field(DEFAULT_MODEL)
    base_model: str = Field(DEFAULT_BASE_MODEL)
    base_angle: str = Field(DEFAULT_ANGLE)


class HeroShotResponse(BaseModel):
    character: str
    prompt: str
    hero_shot_url: str
    history: list[str]
    cost_usd: float
    latency_s: float


class SkinRequest(BaseModel):
    anims: list[str] = Field(..., min_length=1)
    directions: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6, 7])
    model: str = Field(DEFAULT_MODEL)
    base_model: str = Field(DEFAULT_BASE_MODEL)
    base_angle: str = Field(DEFAULT_ANGLE)


class SkinJobResult(BaseModel):
    anim: str
    direction: int
    ok: bool
    gif_url: Optional[str] = None
    error: Optional[str] = None
    cost_usd: float
    latency_s: float


class SkinResponse(BaseModel):
    character: str
    results: list[SkinJobResult]
    total_cost_usd: float


class CharacterSummary(BaseModel):
    name: str
    slug: str
    prompt: Optional[str] = None
    hero_shot_url: Optional[str] = None
    skinned_anims: list[str] = []
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


app = FastAPI(title="skinning_lab")


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "meshy_key_set": bool(os.environ.get("MESHY_API_KEY")),
        "characters_dir": str(CHARACTERS_DIR.relative_to(REPO_ROOT)),
        "models": list(MeshyImageToImage.MODEL_CREDITS.keys()),
    }


@app.get("/api/characters", response_model=list[CharacterSummary])
async def list_characters() -> list[CharacterSummary]:
    out: list[CharacterSummary] = []
    if not CHARACTERS_DIR.exists():
        return out
    for d in sorted(CHARACTERS_DIR.iterdir()):
        if not d.is_dir():
            continue
        cfg = _character_config(d)
        skinned = []
        skinned_dir = d / "skinned"
        if skinned_dir.exists():
            skinned = sorted([p.name for p in skinned_dir.iterdir() if p.is_dir()])
        hero = "/characters/" + d.name + "/hero_shot.png" if (d / "hero_shot.png").exists() else None
        out.append(CharacterSummary(
            name=cfg.get("name", d.name),
            slug=d.name,
            prompt=cfg.get("prompt"),
            hero_shot_url=hero,
            skinned_anims=skinned,
            updated_at=cfg.get("updated_at"),
        ))
    return out


@app.post("/api/characters/{name}/hero_shot", response_model=HeroShotResponse)
async def generate_hero_shot(name: str, req: HeroShotRequest) -> HeroShotResponse:
    if not os.environ.get("MESHY_API_KEY"):
        raise HTTPException(503, "MESHY_API_KEY not set")
    if req.model not in MeshyImageToImage.MODEL_CREDITS:
        raise HTTPException(400, f"unknown model: {req.model}")

    base_frame = _src_frame_path(req.base_model, "idle", req.base_angle, 0, 0)
    if not base_frame.exists():
        raise HTTPException(400, f"base frame missing: {base_frame.relative_to(REPO_ROOT)}")

    char_dir = _character_dir(name)
    char_dir.mkdir(parents=True, exist_ok=True)
    history_dir = char_dir / "history"
    history_dir.mkdir(exist_ok=True)

    api = MeshyImageToImage()
    full_prompt = (
        f"{req.prompt.strip()}, full body character, T-pose stance, "
        f"isometric view, neutral background, hero shot, character reference"
    )

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=180, write=180, pool=10)) as client:
            png_bytes, _ = await api.run_one(
                req.model, full_prompt, [_png_to_data_uri(base_frame)], client=client
            )
    except Exception as e:
        raise HTTPException(502, f"Meshy failed: {type(e).__name__}: {e}")
    latency = time.perf_counter() - t0

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    hist_path = history_dir / f"{ts}.png"
    hist_path.write_bytes(png_bytes)
    hero_path = char_dir / "hero_shot.png"
    hero_path.write_bytes(png_bytes)

    cfg = _character_config(char_dir)
    cfg.update({
        "name": cfg.get("name", name),
        "slug": char_dir.name,
        "prompt": req.prompt,
        "model": req.model,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })
    _save_config(char_dir, cfg)

    history = sorted([p.name for p in history_dir.glob("*.png")])
    return HeroShotResponse(
        character=char_dir.name,
        prompt=req.prompt,
        hero_shot_url=f"/characters/{char_dir.name}/hero_shot.png?t={int(time.time())}",
        history=[f"/characters/{char_dir.name}/history/{h}" for h in history[-6:]],
        cost_usd=api.cost_usd(req.model),
        latency_s=round(latency, 2),
    )


@app.post("/api/characters/{name}/hero_shot/upload", response_model=HeroShotResponse)
async def upload_hero_shot(name: str, file: UploadFile = File(...)) -> HeroShotResponse:
    """Set the hero-shot from an uploaded image file (no Meshy call, no cost).

    Useful when you already have a reference (Photoshop, an image found online,
    a previous Meshy run, etc.) and want to use it as the consistency anchor."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file upload")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        raise HTTPException(400, f"could not parse image: {e}")
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    png_bytes = buf.getvalue()

    char_dir = _character_dir(name)
    char_dir.mkdir(parents=True, exist_ok=True)
    history_dir = char_dir / "history"
    history_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    (history_dir / f"{ts}_uploaded.png").write_bytes(png_bytes)
    (char_dir / "hero_shot.png").write_bytes(png_bytes)

    cfg = _character_config(char_dir)
    cfg.update({
        "name": cfg.get("name", name),
        "slug": char_dir.name,
        "uploaded_filename": file.filename,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    })
    if "prompt" not in cfg:
        cfg["prompt"] = f"(uploaded: {file.filename})"
    _save_config(char_dir, cfg)

    history = sorted([p.name for p in history_dir.glob("*.png")])
    return HeroShotResponse(
        character=char_dir.name,
        prompt=cfg.get("prompt", ""),
        hero_shot_url=f"/characters/{char_dir.name}/hero_shot.png?t={int(time.time())}",
        history=[f"/characters/{char_dir.name}/history/{h}" for h in history[-6:]],
        cost_usd=0.0,
        latency_s=0.0,
    )


async def _skin_one_dir(client: httpx.AsyncClient, api: MeshyImageToImage,
                        char_dir: Path, hero_uri: str, anim: str, direction: int,
                        model: str, base_model: str, base_angle: str,
                        prompt: str) -> SkinJobResult:
    t0 = time.perf_counter()
    try:
        meta = json.loads(_meta_path(base_model, anim, base_angle).read_text())
        src_fc = int(meta["frame_count"])
        n_keyframes, play_fps = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
        indices = _keyframe_indices(src_fc, n_keyframes)
        frame_paths = [_src_frame_path(base_model, anim, base_angle, direction, i) for i in indices]
        missing = [p for p in frame_paths if not p.exists()]
        if missing:
            return SkinJobResult(anim=anim, direction=direction, ok=False,
                                 error=f"missing source frames: {missing[0].name}",
                                 cost_usd=0.0, latency_s=time.perf_counter() - t0)

        atlas, layout, frame_size = _compose_atlas(frame_paths)
        atlas_prompt = (
            f"{prompt}. Same {layout[0]}x{layout[1]} grid layout, same number of frames, "
            f"keep each cell aligned, do not add new cells, do not crop frames. "
            f"Maintain character identity exactly as in the reference."
        )
        png_bytes, _ = await api.run_one(
            model, atlas_prompt,
            [_image_to_data_uri(atlas), hero_uri],
            client=client,
        )
        atlas_out = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        frames = _split_atlas(atlas_out, layout, len(indices), frame_size)
        out_dir = char_dir / "skinned" / anim
        gif_path = out_dir / f"dir_{direction}.gif"
        _write_gif(frames, gif_path, play_fps)
        # also save the raw atlas response for debugging
        (out_dir / f"dir_{direction}_atlas.png").write_bytes(png_bytes)
        rel = f"/characters/{char_dir.name}/skinned/{anim}/dir_{direction}.gif?t={int(time.time())}"
        return SkinJobResult(anim=anim, direction=direction, ok=True,
                             gif_url=rel, cost_usd=api.cost_usd(model),
                             latency_s=round(time.perf_counter() - t0, 2))
    except Exception as e:
        return SkinJobResult(anim=anim, direction=direction, ok=False,
                             error=f"{type(e).__name__}: {e}",
                             cost_usd=0.0, latency_s=round(time.perf_counter() - t0, 2))


@app.post("/api/characters/{name}/skin", response_model=SkinResponse)
async def skin_anims(name: str, req: SkinRequest) -> SkinResponse:
    if not os.environ.get("MESHY_API_KEY"):
        raise HTTPException(503, "MESHY_API_KEY not set")
    if req.model not in MeshyImageToImage.MODEL_CREDITS:
        raise HTTPException(400, f"unknown model: {req.model}")

    char_dir = _character_dir(name)
    hero_path = char_dir / "hero_shot.png"
    if not hero_path.exists():
        raise HTTPException(400, "no hero-shot generated yet for this character")
    cfg = _character_config(char_dir)
    prompt = cfg.get("prompt", "consistent character")
    hero_uri = _png_to_data_uri(hero_path)

    api = MeshyImageToImage()
    sem = asyncio.Semaphore(6)

    async def guarded(client, anim, direction):
        async with sem:
            return await _skin_one_dir(
                client, api, char_dir, hero_uri, anim, direction,
                req.model, req.base_model, req.base_angle, prompt,
            )

    tasks = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15, read=300, write=300, pool=10)) as client:
        for anim in req.anims:
            for d in req.directions:
                tasks.append(guarded(client, anim, d))
        results = await asyncio.gather(*tasks)

    total = sum(r.cost_usd for r in results)
    cfg["last_skin_at"] = datetime.now().isoformat(timespec="seconds")
    _save_config(char_dir, cfg)
    return SkinResponse(character=char_dir.name, results=results, total_cost_usd=round(total, 4))


# ---------------------------------------------------------------------------
# Static
# ---------------------------------------------------------------------------


@app.get("/")
async def root_redirect() -> Response:
    target = LAB_DIR / "index.html"
    if target.exists():
        return FileResponse(target)
    return Response(
        "<h1>skinning_lab</h1><p>No hay <code>index.html</code> raíz. "
        "Ejecuta primero <code>python3 skinning_lab/run.py --list-presets</code> "
        "o <code>build_base_browser.py</code>.</p>",
        media_type="text/html",
    )


# Mount the lab dir last so /api/* routes match first.
app.mount("/", StaticFiles(directory=str(LAB_DIR), html=True), name="lab")


def main() -> int:
    import uvicorn
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--port", type=int, default=8911)
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()
    print(f"→ skinning_lab @ http://{args.host}:{args.port}/")
    print(f"  characters root: {CHARACTERS_DIR.relative_to(REPO_ROOT)}/")
    print(f"  meshy key: {'OK' if os.environ.get('MESHY_API_KEY') else 'MISSING (.env)'}")
    print("  Ctrl+C para parar")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
