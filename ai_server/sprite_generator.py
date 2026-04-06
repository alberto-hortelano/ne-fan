"""Sprite generator: SD 1.5 image → rembg → RGBA PNG with transparent background.

Used for vegetation (trees, bushes), objects, and anything that needs
a billboard image instead of a seamless tiling texture.
"""

import io
import time

import torch.nn as nn
from PIL import Image


class SpriteGenerator:
    def __init__(self, texture_gen_ref=None):
        self.texture_gen_ref = texture_gen_ref

    def generate(self, prompt: str, width: int = 512, height: int = 512, seed: int = -1) -> dict[str, bytes]:
        """Generate an RGBA sprite PNG from a prompt.

        Returns dict with "sprite" key containing PNG bytes.
        """
        if self.texture_gen_ref is None:
            raise RuntimeError("No texture generator reference")

        import torch

        self.texture_gen_ref._load_pipeline()
        pipe = self.texture_gen_ref.pipe
        start = time.perf_counter()

        # Switch to standard padding (sprites should NOT tile)
        self._set_padding_mode(pipe, "zeros")

        try:
            full_prompt = (
                f"single object centered on solid white background, "
                f"studio photo, clean edges, no ground, isolated, {prompt}"
            )

            generator = None
            if seed >= 0:
                generator = torch.Generator(device=self.texture_gen_ref.device).manual_seed(seed)

            with torch.no_grad():
                result = pipe(
                    prompt=full_prompt,
                    num_inference_steps=self.texture_gen_ref.steps,
                    guidance_scale=1.0,
                    width=width,
                    height=height,
                    generator=generator,
                ).images[0]
        finally:
            # Restore circular padding for texture generation
            self._set_padding_mode(pipe, "circular")

        # Remove background
        from rembg import remove
        rgba = remove(result)

        # Crop to content with margin
        rgba = self._crop_to_content(rgba, margin=4)

        # Convert to PNG bytes
        buf = io.BytesIO()
        rgba.save(buf, format="PNG")
        sprite_bytes = buf.getvalue()

        elapsed = time.perf_counter() - start
        print(f"SpriteGen: '{prompt[:50]}...' -> {elapsed:.2f}s ({rgba.size[0]}x{rgba.size[1]})")
        return {"sprite": sprite_bytes}

    def _set_padding_mode(self, pipe, mode: str) -> None:
        for module in pipe.unet.modules():
            if isinstance(module, nn.Conv2d):
                module.padding_mode = mode

    def _crop_to_content(self, image: Image.Image, margin: int = 4) -> Image.Image:
        """Crop RGBA image to non-transparent bounding box with margin."""
        import numpy as np
        arr = np.array(image)
        alpha = arr[:, :, 3]
        rows = alpha.any(axis=1)
        cols = alpha.any(axis=0)

        if not rows.any() or not cols.any():
            return image

        y_min, y_max = rows.argmax(), len(rows) - rows[::-1].argmax()
        x_min, x_max = cols.argmax(), len(cols) - cols[::-1].argmax()

        y_min = max(0, y_min - margin)
        y_max = min(image.height, y_max + margin)
        x_min = max(0, x_min - margin)
        x_max = min(image.width, x_max + margin)

        return image.crop((x_min, y_min, x_max, y_max))
