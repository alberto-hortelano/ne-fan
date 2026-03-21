"""Character skin generator: img2img over Paladin UV diffuse map.

Uses the existing SD 1.5 + LCM-LoRA pipeline in img2img mode to generate
character skin variants from text prompts, preserving UV layout.
"""

import io
import time
from pathlib import Path

import numpy as np
from PIL import Image


# Default base skin (Paladin diffuse UV atlas)
DEFAULT_BASE_SKIN = Path(__file__).resolve().parent.parent / (
    "godot/assets/characters/Sword and Shield Pack/Paladin_diffuse.png"
)


class SkinGenerator:
    def __init__(
        self,
        texture_gen_ref,
        base_skin_path: str | Path = DEFAULT_BASE_SKIN,
        default_strength: float = 0.5,
    ):
        self._texture_gen = texture_gen_ref
        self._base_skin_path = Path(base_skin_path)
        self._default_strength = default_strength
        self._img2img_pipe = None
        self._base_image: Image.Image | None = None
        self._bright_image: Image.Image | None = None

    def _ensure_pipeline(self) -> None:
        if self._img2img_pipe is not None:
            return

        # Force texture_gen to load if it hasn't yet
        self._texture_gen._load_pipeline()

        from diffusers import AutoPipelineForImage2Image

        self._img2img_pipe = AutoPipelineForImage2Image.from_pipe(
            self._texture_gen.pipe
        )
        print("SkinGen: img2img pipeline ready (shared weights with TextureGen)")

    def _get_base_image(self, gamma: float) -> Image.Image:
        if self._base_image is None:
            self._base_image = Image.open(self._base_skin_path).convert("RGB")
            print(f"SkinGen: base skin loaded ({self._base_image.size})")

        if gamma >= 1.0:
            return self._base_image

        # Cache the brightened version for the default gamma
        if gamma == 0.35 and self._bright_image is not None:
            return self._bright_image

        arr = np.array(self._base_image, dtype=np.float32)
        bright = np.power(arr / 255.0, gamma) * 255.0
        result = Image.fromarray(np.clip(bright, 0, 255).astype(np.uint8))

        if gamma == 0.35:
            self._bright_image = result

        return result

    def generate(
        self,
        prompt: str,
        strength: float = -1,
        gamma: float = 0.35,
        seed: int = -1,
    ) -> dict[str, bytes]:
        """Generate a skin variant from prompt using img2img.

        Args:
            prompt: Style description ("necromancer dark robes", "golden holy knight")
            strength: Denoising strength 0.0-1.0. Higher = more change. -1 uses default.
            gamma: Gamma correction on base image before img2img. < 1.0 = brighter.
                   Default 0.35 works well for the dark Paladin base.
            seed: Random seed, -1 for random.

        Returns:
            dict with "skin" key containing PNG bytes.
        """
        self._ensure_pipeline()
        import torch

        if strength < 0:
            strength = self._default_strength

        base = self._get_base_image(gamma)
        full_prompt = (
            f"character armor texture UV atlas, flat layout, {prompt}, "
            f"detailed, high quality, dark fantasy style"
        )

        generator = None
        if seed >= 0:
            generator = torch.Generator(device=self._texture_gen.device).manual_seed(seed)

        start = time.perf_counter()
        with torch.no_grad():
            result = self._img2img_pipe(
                prompt=full_prompt,
                image=base,
                strength=strength,
                num_inference_steps=6,
                guidance_scale=1.0,
                generator=generator,
            ).images[0]
        gen_time = time.perf_counter() - start

        skin_bytes = _pil_to_png_bytes(result)
        print(f"SkinGen: '{prompt[:50]}' strength={strength:.2f} gamma={gamma} -> {gen_time:.2f}s")
        return {
            "skin": skin_bytes,
            "generation_time_ms": int(gen_time * 1000),
        }


def _pil_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
