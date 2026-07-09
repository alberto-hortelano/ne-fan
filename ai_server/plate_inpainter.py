"""Placa de fondo de escena: inpainting local de los huecos de los objetos altos.

El cliente 2D recorta de la imagen de escena los segmentos `tall` (occluders
con z-index) y manda aquí la imagen original + la máscara unión de esos
recortes (blanco = hueco). El resultado es la escena SIN los objetos: el suelo
continuado, con la instrucción de no añadir nada. Instalada como capa base del
tile, el fade por proximidad de los cutouts revela "lo que realmente hay
debajo" de un edificio o un árbol, no una copia congelada del propio objeto.

Reutiliza los pesos SD 1.5 + LCM-LoRA ya cargados por TextureGenerator
(AutoPipelineForInpainting.from_pipe, mismo patrón que SkinGenerator): no
duplica los ~3 GB de VRAM y queda serializado por el GPU lock del caller.
"""

import io
import time

import numpy as np
from PIL import Image, ImageFilter


# Versión del algoritmo de placa: entra en la clave de caché del endpoint —
# subirla invalida placas generadas con un relleno anterior.
PLATE_ALGO = "prefill-v2"

PLATE_PROMPT = (
    "empty ground, plain terrain, seamless continuation of the surrounding "
    "ground surface, game background, nothing on the ground"
)
# Con LCM el guidance debe quedarse bajo (1.0-2.0); >1.0 para que el negative
# prompt tenga efecto.
PLATE_NEGATIVE = (
    "trees, tree, foliage, buildings, houses, walls, towers, rocks, objects, "
    "props, people, characters, animals, structures, furniture"
)
# SD 1.5 rinde a 512² (resolución de entrenamiento); el relleno se reescala y
# se compone SOLO dentro de la máscara — fuera de ella los píxeles originales
# quedan intactos, así que la pérdida de detalle no se ve.
WORK_SIZE = 512
# El pipeline comparte el checkpoint BASE (no inpaint-trained): a strength
# alta regeneraría el hueco solo desde el prompt, ignorando el entorno. Por
# eso el hueco se PRE-RELLENA con el color local del entorno (convolución
# normalizada) y SD solo armoniza/texturiza encima a strength media.
FILL_BLUR_RADIUS = 64
INPAINT_STRENGTH = 0.55


def _prefill_holes(image: Image.Image, mask: Image.Image) -> Image.Image:
    """Rellena los huecos (máscara blanca) con la media local del ENTORNO no
    enmascarado — convolución normalizada: blur(img·(1−m)) / blur(1−m). El
    color/estructura de alrededor (hierba, un camino que entra) se propaga
    hacia dentro del hueco; SD después solo añade textura coherente."""
    arr = np.asarray(image, dtype=np.float32)
    m = (np.asarray(mask, dtype=np.float32) / 255.0)[..., None]
    premul = Image.fromarray((arr * (1.0 - m)).astype(np.uint8))
    inv = Image.fromarray(((1.0 - m[..., 0]) * 255.0).astype(np.uint8))
    pb = np.asarray(premul.filter(ImageFilter.GaussianBlur(FILL_BLUR_RADIUS)), dtype=np.float32)
    ib = np.asarray(inv.filter(ImageFilter.GaussianBlur(FILL_BLUR_RADIUS)), dtype=np.float32)[..., None] / 255.0
    fill = np.clip(pb / np.maximum(ib, 1e-3), 0, 255)
    out = arr * (1.0 - m) + fill * m
    return Image.fromarray(out.astype(np.uint8))


class PlateInpainter:
    def __init__(self, texture_gen_ref):
        self._texture_gen = texture_gen_ref
        self._pipe = None

    def _ensure_pipeline(self) -> None:
        if self._pipe is not None:
            return
        # Fuerza la carga de TextureGen si aún no cargó (lazy).
        self._texture_gen._load_pipeline()

        from diffusers import AutoPipelineForInpainting

        self._pipe = AutoPipelineForInpainting.from_pipe(self._texture_gen.pipe)
        print("PlateInpainter: inpaint pipeline ready (shared weights with TextureGen)")

    def generate(self, image_png: bytes, mask_png: bytes, seed: int = 0) -> bytes:
        """Rellena los huecos (blanco de la máscara) continuando solo el suelo.

        Devuelve PNG de las mismas dimensiones que la imagen de entrada, con
        los píxeles originales intactos fuera de la máscara. Seed fija por
        defecto: mismo (imagen, máscara) ⇒ misma placa (la caché por hash del
        caller cuenta con ello).
        """
        self._ensure_pipeline()
        import torch

        image = Image.open(io.BytesIO(image_png)).convert("RGB")
        mask = Image.open(io.BytesIO(mask_png)).convert("L")
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)

        small_img = image.resize((WORK_SIZE, WORK_SIZE), Image.LANCZOS)
        small_mask = mask.resize((WORK_SIZE, WORK_SIZE), Image.NEAREST)
        prefilled = _prefill_holes(small_img, small_mask)

        generator = torch.Generator(device=self._texture_gen.device).manual_seed(seed)
        start = time.perf_counter()
        with torch.no_grad():
            result = self._pipe(
                prompt=PLATE_PROMPT,
                negative_prompt=PLATE_NEGATIVE,
                image=prefilled,
                mask_image=small_mask,
                strength=INPAINT_STRENGTH,
                num_inference_steps=8,
                guidance_scale=1.8,
                generator=generator,
            ).images[0]

        # Componer a resolución original: relleno solo DENTRO del hueco.
        filled = result.resize(image.size, Image.LANCZOS)
        out = Image.composite(filled, image, mask)
        elapsed = time.perf_counter() - start
        print(f"PlateInpainter: {image.size[0]}x{image.size[1]} -> {elapsed:.2f}s")

        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
