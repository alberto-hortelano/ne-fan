"""Placa de fondo de escena: eliminación de los objetos altos con LaMa.

El cliente 2D recorta de la imagen de escena los segmentos `tall` (occluders
con z-index) y manda aquí la imagen original + la máscara unión de esos
recortes (blanco = hueco). El resultado es la escena SIN los objetos: el suelo
continuado, sin añadir nada. Instalada como capa base del tile, el fade por
proximidad de los cutouts revela "lo que realmente hay debajo" de un edificio
o un árbol, no una copia congelada del propio objeto.

Backend: LaMa (big-lama, TorchScript ~196 MB) — un modelo específico de
object removal, no de difusión: propaga la textura Y las estructuras del
entorno hacia el hueco (un camino que pasa por debajo de un edificio sale
continuado). Determinista sin seed, <1 s por tile en la RTX 3060 y ~1 GB de
VRAM solo mientras se usa. Se descartó SD 1.5 compartido (from_pipe): el
checkpoint base no es inpaint-trained y rellenaba los huecos ignorando el
entorno incluso con pre-relleno por convolución normalizada.
"""

import io
import time

import numpy as np
from PIL import Image


# Versión del algoritmo de placa: entra en la clave de caché del endpoint —
# subirla invalida placas generadas con un relleno anterior.
PLATE_ALGO = "lama-v1"

# big-lama exportado a TorchScript (release de simple-lama-inpainting; el
# modelo original es de la propia LaMa, saic-mdal/lama). torch.hub lo cachea
# en ~/.cache/torch/hub/checkpoints.
LAMA_URL = (
    "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
)


class PlateInpainter:
    def __init__(self, texture_gen_ref=None):
        # texture_gen_ref se conserva por simetría con el resto de
        # generadores, pero LaMa no comparte pesos con SD: solo se usa para
        # heredar el device si está disponible.
        self._texture_gen = texture_gen_ref
        self._model = None
        self._device = None

    def _ensure_model(self) -> None:
        if self._model is not None:
            return
        import torch

        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        # El blob es TorchScript (no un state_dict, load_state_dict_from_url
        # no vale): se resuelve la ruta cacheada a mano con el layout de
        # torch.hub y se descarga solo si falta.
        from pathlib import Path
        from urllib.parse import urlparse

        hub_dir = Path(torch.hub.get_dir()) / "checkpoints"
        hub_dir.mkdir(parents=True, exist_ok=True)
        dest = hub_dir / Path(urlparse(LAMA_URL).path).name
        if not dest.exists():
            print(f"PlateInpainter: descargando big-lama a {dest}…", flush=True)
            torch.hub.download_url_to_file(LAMA_URL, str(dest), progress=False)
        self._model = torch.jit.load(str(dest), map_location=self._device).eval()
        print(f"PlateInpainter: big-lama listo en {self._device}")

    def generate(self, image_png: bytes, mask_png: bytes, seed: int = 0) -> bytes:
        """Rellena los huecos (blanco de la máscara) continuando el entorno.

        Devuelve PNG de las mismas dimensiones que la imagen de entrada, con
        los píxeles originales intactos fuera de la máscara. LaMa es
        determinista: mismo (imagen, máscara) ⇒ misma placa (la caché por
        hash del caller cuenta con ello). `seed` se ignora (compat firma).
        """
        self._ensure_model()
        import torch

        image = Image.open(io.BytesIO(image_png)).convert("RGB")
        mask = Image.open(io.BytesIO(mask_png)).convert("L")
        if mask.size != image.size:
            mask = mask.resize(image.size, Image.NEAREST)

        # A tensores [0..1]; LaMa exige lados múltiplos de 8 → pad reflejado.
        img_t = torch.from_numpy(np.asarray(image)).permute(2, 0, 1).float() / 255.0
        mask_t = (torch.from_numpy(np.asarray(mask)).float() / 255.0 > 0.5).float()[None]
        h, w = img_t.shape[1:]
        ph = (8 - h % 8) % 8
        pw = (8 - w % 8) % 8
        if ph or pw:
            img_t = torch.nn.functional.pad(img_t[None], (0, pw, 0, ph), mode="reflect")[0]
            mask_t = torch.nn.functional.pad(mask_t[None], (0, pw, 0, ph), mode="reflect")[0]

        start = time.perf_counter()
        with torch.no_grad():
            out = self._model(
                img_t[None].to(self._device), mask_t[None].to(self._device)
            )[0]
        filled_arr = (
            out.permute(1, 2, 0).clamp(0, 1).mul(255).byte().cpu().numpy()[:h, :w]
        )
        filled = Image.fromarray(filled_arr)

        # Garantía dura: fuera de la máscara, los píxeles ORIGINALES byte a
        # byte; el relleno solo dentro del hueco.
        result = Image.composite(filled, image, mask)
        elapsed = time.perf_counter() - start
        print(f"PlateInpainter: {image.size[0]}x{image.size[1]} -> {elapsed:.2f}s (lama)")

        buf = io.BytesIO()
        result.save(buf, format="PNG")
        return buf.getvalue()
