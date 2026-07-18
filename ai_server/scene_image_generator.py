"""Full-scene image generator for the 2D client — Meshy image-to-image backend.

Turns the schematic the Canvas renderer paints (terrain plate + object/building
rectangles, NO characters) into a styled top-down RPG scene by sending TWO
reference images to a top instruction-following image model via Meshy:

  1. the **schematic** → layout/position blueprint,
  2. a fixed **art-style reference** (a real game tileset) → homogeneous look,

plus a text instruction derived from the scene description. `nano-banana-pro`
(Gemini Pro Image) matches the style and keeps a flat top-down projection that
maps 1:1 onto the XZ collision plane.

No local GPU — generation runs on Meshy (costs credits).

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

# Image-space side names of the capture's context strips (context_sides).
SIDES = ("left", "right", "top", "bottom")

_STYLE_RULES = (
    "Match the EXACT art style of the SECOND reference image. The map must fill "
    "the ENTIRE image edge to edge, full bleed — NO border, NO margin, NO "
    "transparent or checkerboard background, NO frame, NO text, NO watermark, "
    "NO characters, NO UI."
)

# Bench 003_scifi_fidelity: sin estas dos cláusulas, una ref de estilo con
# composición fuerte (p. ej. un recinto amurallado completo) se CALCA en la
# salida — el modelo la trata como segundo layout, sobre todo rellenando las
# bandas vacías del capture (el margen norte/oeste del viewBox). Con ellas,
# ambas muestras del bench siguieron el blueprint.
_STYLE_ROLE_RULES = (
    "The SECOND reference image is ONLY an art-style reference for materials, "
    "palette and rendering technique — do NOT copy its layout, its buildings, "
    "its walls, its fence, its gate or its composition. Every building, road, "
    "wall and object in your output comes ONLY from the FIRST reference image. "
)
_VOID_RULES = (
    "The flat dark-green background areas of the FIRST image are OUTSIDE the "
    "playable map: paint them as plain featureless terrain matching the scene "
    "(bare ground), with absolutely NO buildings, NO walls, NO fences and NO "
    "objects there. "
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

    def _run(
        self, prompt: str, refs: list[str], aspect: tuple[int, int] | None = None
    ) -> tuple[bytes, dict]:
        """Drive the async Meshy client from a sync context (called via to_thread).

        `aspect`: (w, h) del esquema — el fallback fal lo usa para pedir el
        output en el aspect nativo del blueprint (el estiramiento anamórfico a
        cuadrado cuesta ~45 puntos de fidelidad de layout, bench
        002_repaint_fidelity). Meshy no admite control de tamaño y lo ignora.

        Pasa por DevApiCache: en modo dev devuelve la última escena generada
        (0 créditos); la task dict se sustituye por un stub sin credits."""
        from dev_api_cache import DEV_API_CACHE

        task_holder: list[dict] = []

        def _call() -> list[bytes]:
            png, task = asyncio.run(
                self._meshy.run_one(self._model, prompt, refs, aspect=aspect)
            )
            task_holder.append(task)
            return [png]

        blobs, _cached = DEV_API_CACHE.through_sync("meshy_i2i_scene", _call, note=prompt)
        return blobs[0], (task_holder[0] if task_holder else {"dev_api_cache": True})

    def generate_full(
        self,
        schematic_png_bytes: bytes,
        prompt: str,
        context_sides: list[str] | None = None,
        blueprint_kind: str = "boxes",
        style_ref_uri: str | None = None,
        style_token: str = "",
        has_water: bool = True,
    ) -> dict:
        """`style_ref_uri`: referencia de estilo del pack del juego (data URI);
        None degrada a la referencia global fija. `style_token` complementa a
        la imagen con la dirección de arte en texto. `has_water=False` omite
        las cláusulas de agua y prohíbe pintarla — en planos secos la mención
        ceba ríos alucinados (fallo dominante del bench 002_repaint_fidelity)."""
        sch = self._load_rgb(schematic_png_bytes)
        # Prestretch (bench 002_repaint_fidelity): pre-estirar el esquema a
        # cuadrado y pedir salida cuadrada hace LINEAL el mapeo entrada↔salida
        # — el des-estirado lo deshace el cliente al escalar la imagen al rect
        # del tile. Sin esto, Meshy (que ignora `aspect` y devuelve 1024²)
        # obliga al modelo a un estiramiento anamórfico que desalinea las
        # huellas (~45 puntos de fidelidad con gpt2; con nano-banana-pro el
        # prestretch dio el mejor caso del bench: 100% edificios, 0 inventos).
        side = max(sch.size)
        if sch.size != (side, side):
            sch = sch.resize((side, side), Image.LANCZOS)
        if blueprint_kind == "svg":
            # Blueprint compuesto: plano vectorial rico YA PROYECTADO en la
            # oblicua del compositor. Dos diales validados empíricamente
            # (experimento svg_test): la FIDELIDAD al plano viene sola; el
            # REPINTADO total hay que exigirlo o el modelo devuelve el vector
            # casi tal cual. Specs negativas contra las invenciones observadas.
            view = (
                "Top-down 3/4 RPG game map. The plan is ALREADY projected: "
                "vertical volumes show their top plus a lit SOUTH facade and a "
                "shaded EAST side facade (tops lean slightly north-west), trees "
                "show a trunk under the canopy. Keep that projection and light "
                "direction exactly. "
            )
            water_texture = (
                "water with ripples, depth and high-contrast banks, " if has_water else ""
            )
            water_follow = (
                "follow the EXACT course and width of the water and of every "
                "road; keep bridges and walkways painted ON TOP of the water. "
                if has_water
                else "follow the EXACT course and width of every road. "
            )
            no_water = (
                ""
                if has_water
                else "This map contains NO water at all: do NOT paint any river, "
                "stream, canal, pond or lake anywhere. "
            )
            instruction = (
                view
                + "The FIRST reference image is ONLY a schematic LAYOUT plan drawn "
                "with flat placeholder colours — it is NOT final art. Fully REPAINT "
                "the whole map in the painterly, richly textured style of the "
                "SECOND reference image: dense textured grass with tufts and "
                "colour variation, detailed tree canopies with individual foliage "
                f"clumps, highlights and drop shadows, {water_texture}worn dirt "
                "roads with edges blending into "
                "grass, individually drawn cobblestones, wooden floors with plank "
                "grain, stone walls with individual masonry blocks, roof tiles "
                "drawn one by one. The finished map must NOT look flat, "
                "vector-like or diagram-like anywhere. "
                "Buildings drawn open (no roof, interior floors and furniture "
                "visible over low front walls) are CUTAWAY interiors — keep them "
                "open exactly as drawn; buildings drawn with a roof keep their "
                "roof. Keep every element in the SAME position, size, shape and "
                f"height; {water_follow}"
                "Do NOT move, remove or merge buildings. Do NOT invent new "
                "buildings, walls, bridges or watercourses that are not in the "
                f"blueprint. {no_water}"
                "IMPORTANT: leave every fully transparent pixel of the "
                "first reference EXACTLY transparent-black — paint only where the "
                "plan has content. "
                f"Render the scene as: {prompt.strip()}. "
                + (f"Overall art direction: {style_token.strip()}. " if style_token else "")
                + _STYLE_ROLE_RULES
                + _VOID_RULES
                + _STYLE_RULES
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
                f"Render the scene as: {prompt.strip()}. "
                + (f"Overall art direction: {style_token.strip()}. " if style_token else "")
                + _STYLE_RULES
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
        refs = [_to_data_uri(sch, "PNG"), style_ref_uri or self._style_uri]
        start = time.perf_counter()
        png, res = self._run(instruction, refs, aspect=sch.size)
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

