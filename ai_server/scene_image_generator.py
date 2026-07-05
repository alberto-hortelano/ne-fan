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
        context_sides: list[str] | None = None,
        blueprint_kind: str = "boxes",
    ) -> dict:
        sch = self._load_rgb(schematic_png_bytes)
        if blueprint_kind == "svg":
            # Blueprint map_svg: plano vectorial rico. Dos diales validados
            # empíricamente (experimento svg_test): la FIDELIDAD al plano viene
            # sola; el REPINTADO total hay que exigirlo o el modelo devuelve el
            # vector casi tal cual. Convención cutaway: sin techos, interiores
            # visibles. Specs negativas contra las invenciones observadas.
            instruction = (
                "Top-down 2D RPG game map, flat overhead view. The FIRST reference "
                "image is ONLY a schematic LAYOUT plan drawn with flat placeholder "
                "colours — it is NOT final art. Fully REPAINT the whole map in the "
                "painterly, richly textured style of the SECOND reference image: "
                "dense textured grass with tufts and colour variation, detailed "
                "tree canopies with individual foliage clumps, highlights and drop "
                "shadows, water with ripples, depth and high-contrast banks, worn "
                "dirt roads with edges blending into grass, individually drawn "
                "cobblestones, wooden floors with plank grain. The finished map "
                "must NOT look flat, vector-like or diagram-like anywhere. "
                "The plan legend: green = grass (two tones = meadow variation), "
                "dark green circles = individual tree canopies, blue = water with "
                "banks, tan = dirt roads and paths, grey = stone paving, "
                "dark-brown outlines = building WALLS seen from above, lighter "
                "areas inside the walls = interior floors. Buildings are drawn in "
                "CUTAWAY view: they have NO roofs — render them open-roofed with "
                "their walls and interiors fully visible exactly as drawn "
                "(furniture, floors, door gaps in the wall outlines). Keep every "
                "element in the SAME position, size and shape; follow the EXACT "
                "course and width of the water and of every road; keep bridges "
                "and walkways painted ON TOP of the water. Do NOT add roofs. "
                "Do NOT move, remove or merge buildings. Do NOT invent new "
                "buildings, walls, bridges or watercourses that are not in the "
                f"blueprint. Render the scene as: {prompt.strip()}. {_STYLE_RULES}"
            )
        else:
            instruction = (
                "Top-down 2D RPG game map, flat overhead view. Use the FIRST reference "
                "image as the LAYOUT blueprint. The background colour zones are ground "
                "types — blue = water/river, brown strip = a bridge, tan = path/road, "
                "grey = stone/paving, green = grass. Curved coloured lines are real "
                "watercourses and roads: follow their exact course and width. The "
                "coloured shapes mark objects and hint their form: rectangles = "
                "buildings/walls/crates, circles = round things (barrels, wells, round "
                "towers, fountains), triangles = tents/spires. Keep every element in "
                "the SAME position, size and shape. Avoid large flat single-colour "
                "areas; add natural ground variation and texture everywhere. "
                f"Render the scene as: {prompt.strip()}. {_STYLE_RULES}"
            )
        if context_sides:
            edges = ", ".join(context_sides)
            instruction += (
                f" CONTEXT STRIPS: the outermost strip along the {edges} edge(s) of "
                "the FIRST reference is NOT schematic — it is finished painted art "
                "from the adjacent, already-rendered map. Reproduce those strips "
                "EXACTLY as given, unchanged and in the same position at the same "
                "edges of your output, and paint everything else so it continues "
                "them with no visible seam (same palette, same ground texture)."
            )
        refs = [_to_data_uri(sch, "PNG"), self._style_uri]
        start = time.perf_counter()
        png, res = self._run(instruction, refs)
        dt = time.perf_counter() - start
        w, h = Image.open(io.BytesIO(png)).size
        print(
            f"SceneImageGen.full[{blueprint_kind}]: '{prompt[:40]}' {w}x{h} "
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
