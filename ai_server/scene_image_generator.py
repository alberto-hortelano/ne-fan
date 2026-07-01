"""Full-scene image generator for the 2D client — Meshy image-to-image backend.

Turns the schematic the Canvas renderer paints (terrain plate + object/building
rectangles, NO characters) into a styled top-down RPG scene by sending TWO
reference images to a top instruction-following image model via Meshy:

  1. the **schematic** → layout/position blueprint,
  2. a fixed **art-style reference** (a real game tileset) → homogeneous look,

plus a text instruction derived from the scene description. `nano-banana-pro`
(Gemini Pro Image) matches the style and keeps a flat top-down projection that
maps 1:1 onto the XZ collision plane.

No local GPU — generation runs on Meshy (costs credits). Outpaint extends the
world by instructing the model to show more terrain on one side.

Caveat: Meshy image-to-image returns a 1024² square; non-square scenes are
stretched to their bounds by the client (minor distortion, acceptable for now).
"""

from __future__ import annotations

import asyncio
import base64
import io
import time
from pathlib import Path

from PIL import Image

from meshy_client import MeshyImageToImage

# Image-space side names for outpaint. Kept for API compatibility with main.py.
SIDES = ("left", "right", "top", "bottom")

_STYLE_RULES = (
    "Match the EXACT art style of the SECOND reference image. The map must fill "
    "the ENTIRE image edge to edge, full bleed — NO border, NO margin, NO "
    "transparent or checkerboard background, NO frame, NO text, NO watermark, "
    "NO characters, NO UI."
)


def _to_data_uri(img: Image.Image, fmt: str = "PNG", long_side: int = 768) -> str:
    w, h = img.size
    s = min(1.0, long_side / max(w, h))
    if s < 1.0:
        img = img.resize((int(w * s), int(h * s)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, fmt)
    mime = "jpeg" if fmt.upper() in ("JPEG", "JPG") else "png"
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode()


class SceneImageGenerator:
    def __init__(self, style_image_path: str, model: str = "nano-banana-pro"):
        self._model = model
        self._meshy = MeshyImageToImage()  # reads MESHY_API_KEY
        self._style_path = Path(style_image_path)
        if not self._style_path.exists():
            raise FileNotFoundError(f"scene style image not found: {self._style_path}")
        # Cache the style reference data URI once (it never changes per run).
        style = Image.open(self._style_path).convert("RGB")
        self._style_uri = _to_data_uri(style, "JPEG", long_side=1024)
        print(f"SceneImageGen: Meshy '{model}', style={self._style_path.name}", flush=True)

    @staticmethod
    def _load_rgb(png_bytes: bytes) -> Image.Image:
        return Image.open(io.BytesIO(png_bytes)).convert("RGB")

    def _run(self, prompt: str, refs: list[str]) -> tuple[bytes, dict]:
        """Drive the async Meshy client from a sync context (called via to_thread)."""
        return asyncio.run(self._meshy.run_one(self._model, prompt, refs))

    def generate_full(
        self,
        schematic_png_bytes: bytes,
        prompt: str,
        strength: float = 0.85,   # unused; kept for API compatibility
        seed: int = -1,           # unused (Meshy)
        guidance: float = 6.0,    # unused
        controlnet_scale: float = 0.5,  # unused
    ) -> dict:
        sch = self._load_rgb(schematic_png_bytes)
        instruction = (
            "Top-down 2D RPG game map, flat overhead view. Use the FIRST reference "
            "image as the LAYOUT blueprint: the coloured rectangles mark where "
            "objects/buildings/walls go and the background colour is the ground; "
            "keep every element in the same position and proportion. "
            f"Render the scene as: {prompt.strip()}. {_STYLE_RULES}"
        )
        refs = [_to_data_uri(sch, "PNG"), self._style_uri]
        start = time.perf_counter()
        png, res = self._run(instruction, refs)
        dt = time.perf_counter() - start
        w, h = Image.open(io.BytesIO(png)).size
        print(
            f"SceneImageGen.full: '{prompt[:40]}' {w}x{h} "
            f"{res.get('consumed_credits')}cr -> {dt:.1f}s",
            flush=True,
        )
        return {
            "scene": png,
            "width": w,
            "height": h,
            "generation_time_ms": int(dt * 1000),
        }

    def outpaint(
        self,
        current_png_bytes: bytes,
        side: str,
        expand_px: int = 256,
        prompt: str = "",
        seed: int = -1,
    ) -> dict:
        if side not in SIDES:
            raise ValueError(f"side must be one of {SIDES}, got {side!r}")
        cur = self._load_rgb(current_png_bytes)
        instruction = (
            "Top-down 2D RPG game map, flat overhead view. The FIRST reference image "
            f"is an existing map; render a LARGER map that extends it toward the "
            f"{side} side with more terrain of the same kind, keeping the existing "
            "content and layout recognisable. "
            f"Theme: {prompt.strip()}. {_STYLE_RULES}"
        )
        refs = [_to_data_uri(cur, "PNG", long_side=1024), self._style_uri]
        start = time.perf_counter()
        png, res = self._run(instruction, refs)
        dt = time.perf_counter() - start
        w, h = Image.open(io.BytesIO(png)).size
        print(
            f"SceneImageGen.outpaint[{side}]: {w}x{h} "
            f"{res.get('consumed_credits')}cr -> {dt:.1f}s",
            flush=True,
        )
        return {
            "scene": png,
            "side": side,
            "expand_px": expand_px,
            "width": w,
            "height": h,
            "generation_time_ms": int(dt * 1000),
        }
