"""Diagnostic endpoints for manual parameter sweeps (curl loops).

Mounted only when `ai_server.expose_diagnostic` is true in the unified
NefanConfig snapshot (nefan-core/src/config.ts) — in production the routes
simply don't exist. Not used by any game client.
"""

import asyncio
import io

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field


class SkinTestControlnetRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = "paladin"
    anim: str = "idle"
    angle: str = "isometric_30"
    dir: int = 0
    frame: int = 0
    strength: float = 0.30
    steps: int = 12
    guidance: float = 1.5
    controlnet_scale: float = 0.85
    canny_low: int = 80
    canny_high: int = 180
    blur_kernel: int = 5
    seed: int = 42
    silhouette_input: bool = False


class SkinTestFrameRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: str = "paladin"
    anim: str = "idle"
    angle: str = "isometric_30"
    dir: int = 0
    frame: int = 0
    strength: float = 0.45
    steps: int = 8
    guidance: float = 1.0
    seed: int = -1
    circular_padding: bool = False


def build_diagnostic_router(
    *, sprite_sheets_dir, gpu_lock, skin_gen, controlnet_skin_gen
) -> APIRouter:
    """The generators live in main.py's lifespan, so the router is built (and
    mounted) there once they exist."""
    router = APIRouter(prefix="/diagnostic")

    @router.post("/skin_test_controlnet")
    async def skin_test_controlnet(body: SkinTestControlnetRequest):
        """Diagnostic endpoint that exposes every ControlNet skinning knob, so a
        curl loop can sweep configurations without touching the code."""
        from PIL import Image
        import numpy as np
        import cv2

        src = sprite_sheets_dir / body.model / body.anim / body.angle / (
            f"dir_{body.dir}_frame_{body.frame:03d}.png"
        )
        if not src.exists():
            return Response(status_code=404, content=f"frame not found: {src.name}")

        base = Image.open(src).convert("RGBA")

        # Custom canny tuned per request: bigger blur + higher thresholds drop
        # interior detail (armour seams) and only keep the gross silhouette.
        flat = Image.new("RGB", base.size, (0, 0, 0))
        flat.paste(base, mask=base.split()[3])
        arr = np.array(flat.convert("L"))
        if body.blur_kernel >= 3 and body.blur_kernel % 2 == 1:
            arr = cv2.GaussianBlur(arr, (body.blur_kernel, body.blur_kernel), 0)
        edges = cv2.Canny(arr, body.canny_low, body.canny_high)
        edges_pil = Image.fromarray(edges).convert("RGB")

        # Optionally hide the paladin texture entirely so the model only sees a
        # white silhouette over grey. Tests whether internal detail is what's
        # confusing the result.
        if body.silhouette_input:
            rgb = Image.new("RGB", base.size, (128, 128, 128))
            white = Image.new("RGB", base.size, (255, 255, 255))
            rgb.paste(white, mask=base.split()[3])
        else:
            rgb = Image.new("RGB", base.size, (128, 128, 128))
            rgb.paste(base, mask=base.split()[3])

        full_prompt = (
            f"{body.prompt}, full body character standing, isometric perspective, "
            f"same pose, detailed clothing, high quality"
        )

        controlnet_skin_gen._ensure_pipeline()
        saved = controlnet_skin_gen._disable_circular_padding()
        try:
            import torch
            async with gpu_lock:
                generator = torch.Generator(
                    device=controlnet_skin_gen._texture_gen.device
                ).manual_seed(body.seed)
                with torch.no_grad():
                    result = await asyncio.to_thread(
                        lambda: controlnet_skin_gen._pipe(
                            prompt=full_prompt,
                            image=rgb,
                            control_image=edges_pil,
                            strength=body.strength,
                            num_inference_steps=body.steps,
                            guidance_scale=body.guidance,
                            controlnet_conditioning_scale=body.controlnet_scale,
                            generator=generator,
                        ).images[0]
                    )
            out = result.convert("RGBA")
            out.putalpha(base.split()[3])
            buf = io.BytesIO()
            out.save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")
        finally:
            controlnet_skin_gen._restore_padding(saved)

    @router.post("/skin_test_frame")
    async def skin_test_frame(body: SkinTestFrameRequest):
        """Diagnostic endpoint: img2img a single frame with explicit knobs.

        Used to validate whether the local model can produce a recognisable and
        consistent character without committing to a full sheet rebuild.
        Returns the resulting PNG bytes directly so a curl loop can drop them on
        disk for visual review.
        """
        from PIL import Image

        src = sprite_sheets_dir / body.model / body.anim / body.angle / (
            f"dir_{body.dir}_frame_{body.frame:03d}.png"
        )
        if not src.exists():
            return Response(status_code=404, content=f"frame not found: {src.name}")

        skin_gen._ensure_pipeline()
        import torch

        # The texture pipeline applies circular padding to every Conv2d layer for
        # seamless tiling. That's wrong for character portraits — wrapping the
        # border bleeds left-pixels into right-context. Toggle it per request so
        # we can A/B the impact in the test rig.
        unet = skin_gen._img2img_pipe.unet
        saved_padding: list[tuple[object, str]] = []
        if not body.circular_padding:
            for module in unet.modules():
                if isinstance(module, torch.nn.Conv2d) and module.padding_mode == "circular":
                    saved_padding.append((module, module.padding_mode))
                    module.padding_mode = "zeros"

        base = Image.open(src).convert("RGBA")
        rgb = Image.new("RGB", base.size, (128, 128, 128))
        rgb.paste(base, mask=base.split()[3])

        full_prompt = (
            f"{body.prompt}, full body character standing, isometric perspective, "
            f"same pose, detailed clothing, high quality"
        )

        try:
            async with gpu_lock:
                generator = None
                if body.seed >= 0:
                    generator = torch.Generator(
                        device=skin_gen._texture_gen.device
                    ).manual_seed(body.seed)
                with torch.no_grad():
                    result = await asyncio.to_thread(
                        lambda: skin_gen._img2img_pipe(
                            prompt=full_prompt,
                            image=rgb,
                            strength=body.strength,
                            num_inference_steps=body.steps,
                            guidance_scale=body.guidance,
                            generator=generator,
                        ).images[0]
                    )
            out = result.convert("RGBA")
            out.putalpha(base.split()[3])
            buf = io.BytesIO()
            out.save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")
        finally:
            for module, mode in saved_padding:
                module.padding_mode = mode

    return router
