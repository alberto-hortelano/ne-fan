"""ControlNet-guided character skinning for Mixamo sprite sheets.

The vanilla img2img pipeline (skin_generator.py) was producing recognisable
characters but inconsistent details across frames — at strength≥0.3 the model
re-rolls clothing and face every frame, so playing the animation flickers.
This module sits on top of the same SD 1.5 + LCM-LoRA pipeline but adds:

  * Canny ControlNet that anchors the silhouette of each Mixamo frame, so
    the player still recognises the same paladin pose underneath the new
    skin.
  * A deterministic seed derived from (model, anim, prompt) so every frame
    of the sheet samples the same latent — much higher visual coherence
    than seed=-1 across hundreds of frames.
  * The circular Conv2d padding the TextureGenerator applies for seamless
    tiling is temporarily disabled during skinning. Wrapping the borders
    creates spurious colour bleed when the input is a centred portrait.

Costs: lazily loads `lllyasviel/sd-controlnet-canny` (~720 MB) the first time
generate() is called. Adds ~1 GB VRAM while active.
"""

from __future__ import annotations

import hashlib
import io
import time
from typing import Iterable, Iterator

import cv2
import numpy as np
from PIL import Image


def _canny_from_pil(
    rgba: Image.Image,
    low: int = 150,
    high: int = 250,
    blur_kernel: int = 11,
) -> Image.Image:
    """Silhouette-biased edge map for ControlNet. With low canny thresholds
    every armour seam and shield rivet leaks into the conditioning, and the
    model treats them as instructions to paint a multicoloured patchwork.
    The defaults below (heavier blur + tight Canny window) drop interior
    detail and only keep the gross body outline — exactly what we want when
    repainting a paladin into a peasant."""
    base = Image.new("RGB", rgba.size, (0, 0, 0))
    base.paste(rgba, mask=rgba.split()[3])
    arr = np.array(base.convert("L"))
    if blur_kernel >= 3 and blur_kernel % 2 == 1:
        arr = cv2.GaussianBlur(arr, (blur_kernel, blur_kernel), 0)
    edges = cv2.Canny(arr, low, high)
    return Image.fromarray(edges).convert("RGB")


def seed_for(prompt: str, salt: str = "") -> int:
    """Stable seed for a (prompt, salt) pair. Same prompt → same seed → same
    appearance across every frame the caller hands us."""
    h = hashlib.sha256((prompt.strip().lower() + "|" + salt).encode()).hexdigest()
    return int(h[:8], 16) % (2**31)


class ControlNetSkinGenerator:
    CONTROLNET_ID = "lllyasviel/sd-controlnet-canny"

    def __init__(self, texture_gen_ref, default_strength: float = 0.40):
        self._texture_gen = texture_gen_ref
        self._default_strength = default_strength
        self._pipe = None
        self._controlnet = None

    def _ensure_pipeline(self) -> None:
        if self._pipe is not None:
            return
        import torch
        from diffusers import (
            ControlNetModel,
            StableDiffusionControlNetImg2ImgPipeline,
        )

        self._texture_gen._load_pipeline()
        base = self._texture_gen.pipe

        print(f"ControlNetSkin: loading {self.CONTROLNET_ID}...")
        self._controlnet = ControlNetModel.from_pretrained(
            self.CONTROLNET_ID,
            torch_dtype=torch.float16,
        ).to(self._texture_gen.device)

        # Reuse the base pipeline's UNet (LCM-LoRA already fused), VAE
        # (TAESD — we'll override per-call below), text encoder and scheduler
        # so we don't pay for two SD copies in VRAM.
        self._pipe = StableDiffusionControlNetImg2ImgPipeline(
            vae=base.vae,
            text_encoder=base.text_encoder,
            tokenizer=base.tokenizer,
            unet=base.unet,
            scheduler=base.scheduler,
            controlnet=self._controlnet,
            safety_checker=None,
            feature_extractor=None,
            requires_safety_checker=False,
        ).to(self._texture_gen.device)
        print("ControlNetSkin: pipeline ready (shared weights with TextureGen)")

    def _disable_circular_padding(self) -> list:
        """Side-effect: walk the UNet, set every Conv2d back to zero padding
        and return the list of layers we touched so we can restore them.
        TextureGenerator turns these to "circular" for seamless tiling, which
        makes character portraits leak across borders."""
        import torch.nn as nn

        saved: list[tuple[nn.Conv2d, str]] = []
        for module in self._pipe.unet.modules():
            if isinstance(module, nn.Conv2d) and module.padding_mode == "circular":
                saved.append((module, module.padding_mode))
                module.padding_mode = "zeros"
        return saved

    @staticmethod
    def _restore_padding(saved: list) -> None:
        for module, mode in saved:
            module.padding_mode = mode

    def generate_one(
        self,
        rgba_frame: Image.Image,
        prompt: str,
        seed: int,
        strength: float | None = None,
        steps: int = 15,
        guidance: float = 2.5,
        # 0.5 leaves enough headroom for the prompt to repaint the armour as
        # plain clothing. Higher values (the default-ish 0.85) made the model
        # treat the paladin's armour seams as if they were instructions for
        # patchwork peasant clothing, so the output looked like a harlequin.
        controlnet_scale: float = 0.5,
    ) -> Image.Image:
        """Run one img2img pass. Reapplies the input alpha so transparency
        survives (the model only sees RGB)."""
        import torch

        self._ensure_pipeline()
        if strength is None:
            strength = self._default_strength

        edges = _canny_from_pil(rgba_frame)

        # img2img wants RGB. Flatten over a neutral grey that doesn't bias
        # the model towards any colour scheme.
        rgb = Image.new("RGB", rgba_frame.size, (128, 128, 128))
        rgb.paste(rgba_frame, mask=rgba_frame.split()[3])

        full_prompt = (
            f"{prompt}, full body character standing, isometric perspective, "
            f"same pose, detailed clothing, high quality"
        )

        saved = self._disable_circular_padding()
        try:
            generator = torch.Generator(device=self._texture_gen.device).manual_seed(seed)
            with torch.no_grad():
                result = self._pipe(
                    prompt=full_prompt,
                    image=rgb,
                    control_image=edges,
                    strength=strength,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    controlnet_conditioning_scale=controlnet_scale,
                    generator=generator,
                ).images[0]
        finally:
            self._restore_padding(saved)

        out = result.convert("RGBA")
        out.putalpha(rgba_frame.split()[3])
        return out

    def generate_to_bytes(
        self,
        rgba_frame: Image.Image,
        prompt: str,
        seed: int,
        **kwargs,
    ) -> bytes:
        out = self.generate_one(rgba_frame, prompt, seed, **kwargs)
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
