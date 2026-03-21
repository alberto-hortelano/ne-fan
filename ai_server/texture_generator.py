"""PBR texture generator: SD 1.5 + LCM-LoRA + TAESD + circular padding.

Generates seamless tiling albedo textures, plus Sobel-derived normal maps.
~3 GB VRAM (fp16). ~1s per 512x512 texture on RTX 3060.
"""

import io
import time

import numpy as np
from PIL import Image


class TextureGenerator:
    def __init__(
        self,
        model_id: str = "runwayml/stable-diffusion-v1-5",
        lcm_lora_id: str = "latent-consistency/lcm-lora-sdv1-5",
        taesd_id: str = "madebyollin/taesd",
        device: str = "cuda",
        width: int = 512,
        height: int = 512,
        steps: int = 4,
        lazy: bool = True,
    ):
        self.model_id = model_id
        self.lcm_lora_id = lcm_lora_id
        self.taesd_id = taesd_id
        self.device = device
        self.width = width
        self.height = height
        self.steps = steps
        self.pipe = None
        self._loaded = False

        if not lazy:
            self._load_pipeline()

    def _load_pipeline(self) -> None:
        if self._loaded:
            return

        import torch
        from diffusers import StableDiffusionPipeline, LCMScheduler, AutoencoderTiny

        print(f"TextureGen: Loading {self.model_id}...")
        self.pipe = StableDiffusionPipeline.from_pretrained(
            self.model_id,
            torch_dtype=torch.float16,
            safety_checker=None,
        ).to(self.device)

        # TAESD: fast VAE
        print(f"TextureGen: Loading TAESD...")
        self.pipe.vae = AutoencoderTiny.from_pretrained(
            self.taesd_id, torch_dtype=torch.float16
        ).to(self.device)

        # LCM-LoRA: 4-step inference
        print(f"TextureGen: Loading LCM-LoRA...")
        self.pipe.load_lora_weights(self.lcm_lora_id)
        self.pipe.fuse_lora()
        self.pipe.scheduler = LCMScheduler.from_config(self.pipe.scheduler.config)

        # Circular padding for seamless tiling
        self._apply_circular_padding()

        # Warmup
        print("TextureGen: Warming up...")
        import torch
        with torch.no_grad():
            self.pipe(
                prompt="warmup texture",
                num_inference_steps=self.steps,
                guidance_scale=1.0,
                width=self.width,
                height=self.height,
            )

        self._loaded = True
        vram = torch.cuda.max_memory_allocated() / 1024**3
        print(f"TextureGen: Ready ({vram:.1f} GB VRAM)")

    def _apply_circular_padding(self) -> None:
        """Replace zero padding with circular padding in UNet Conv2d layers."""
        import torch.nn as nn

        count = 0
        for module in self.pipe.unet.modules():
            if isinstance(module, nn.Conv2d) and module.padding_mode == "zeros":
                module.padding_mode = "circular"
                count += 1
        print(f"TextureGen: Circular padding applied to {count} Conv2d layers")

    def generate(self, prompt: str, seed: int = -1) -> dict[str, bytes]:
        """Generate PBR texture set (albedo + normal) from prompt.

        Returns dict with "albedo" and "normal" keys, each containing PNG bytes.
        """
        self._load_pipeline()
        import torch

        full_prompt = f"seamless tiling texture, flat lit, no perspective, PBR albedo, {prompt}"

        generator = None
        if seed >= 0:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        start = time.perf_counter()
        with torch.no_grad():
            result = self.pipe(
                prompt=full_prompt,
                num_inference_steps=self.steps,
                guidance_scale=1.0,
                width=self.width,
                height=self.height,
                generator=generator,
            ).images[0]
        gen_time = time.perf_counter() - start

        # Generate normal map from albedo
        normal = self._sobel_normal(result)

        # Convert to PNG bytes
        albedo_bytes = _pil_to_png_bytes(result)
        normal_bytes = _pil_to_png_bytes(normal)

        print(f"TextureGen: '{prompt[:50]}...' -> {gen_time:.2f}s")
        return {
            "albedo": albedo_bytes,
            "normal": normal_bytes,
            "generation_time_ms": int(gen_time * 1000),
        }

    def _sobel_normal(self, albedo: Image.Image) -> Image.Image:
        """Generate normal map from albedo using Sobel filter. CPU only."""
        arr = np.array(albedo.convert("L"), dtype=np.float32) / 255.0

        # Gaussian blur to reduce noise
        from scipy.ndimage import gaussian_filter, sobel
        arr = gaussian_filter(arr, sigma=1.0)

        # Sobel gradients
        dx = sobel(arr, axis=1)
        dy = sobel(arr, axis=0)

        # Build normal map (OpenGL convention: Y up)
        strength = 2.0
        normal = np.zeros((*arr.shape, 3), dtype=np.float32)
        normal[:, :, 0] = -dx * strength
        normal[:, :, 1] = -dy * strength
        normal[:, :, 2] = 1.0

        # Normalize
        length = np.sqrt(np.sum(normal ** 2, axis=2, keepdims=True))
        normal = normal / (length + 1e-8)

        # Map from [-1,1] to [0,255]
        normal_uint8 = ((normal * 0.5 + 0.5) * 255).astype(np.uint8)
        return Image.fromarray(normal_uint8)

    @property
    def is_loaded(self) -> bool:
        return self._loaded


def _pil_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
