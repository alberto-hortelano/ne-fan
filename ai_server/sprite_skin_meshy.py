"""Skin de sprite sheets vía Meshy image-to-image (hero-shot + atlas V4).

Pipeline validado en skinning_lab (README, lessons learned): la vía local
SD1.5+ControlNet re-rollea la ropa entre frames y quedó descartada; lo que
funciona es Meshy con un atlas de keyframes por (anim, dirección) y un
hero-shot del personaje como segunda referencia de identidad. Este módulo es
el port de producción del generador de personajes de
`skinning_lab/lab_server.py` (endpoints hero_shot + skin).

Flujo por descripción narrativa (prompt):
1. `hero_shot(prompt)` — img2img del frame `idle dir_0 frame_000` del modelo
   base con el prompt → referencia de identidad. UNA llamada, cacheada por
   prompt en `{cache}/heroes/`.
2. `skin_anim(anim)` — por cada dirección: reduce la anim a densidad de
   sprite-sheet 2D (ANIM_PROFILES), compone el atlas de keyframes, llama
   Meshy con `[atlas, hero]` y descompone el atlas devuelto en frames.

El sheet resultante tiene MENOS frames y OTRO fps que el base (el meta.json
que se escribe junto a los frames es la fuente de verdad para el cliente).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import math
from pathlib import Path

import httpx
from PIL import Image

from dev_api_cache import DEV_API_CACHE
from meshy_client import MeshyImageToImage

# Densidad de keyframes por anim: (n_keyframes, fps de reproducción).
# Tuneados a mano en skinning_lab/build_base_browser.py:ANIM_PROFILES para
# que el loop se sienta natural (Disney 4-pose para walk, etc.).
ANIM_PROFILES: dict[str, tuple[int, float]] = {
    "idle": (8, 2.2),
    "walk": (4, 3.6),
    "run": (4, 6.0),
    "quick": (3, 4.0),
    "heavy": (8, 6.0),
    "medium": (4, 3.5),
    "defensive": (2, 3.5),
    "precise": (6, 4.5),
    "hit_react": (3, 4.0),
    "death": (8, 4.0),
}
DEFAULT_PROFILE = (4, 4.0)

# Concurrencia de llamadas Meshy por anim (8 direcciones). Mismo valor que el
# lab_server; el límite real lo pone la API remota, no la GPU local.
MESHY_CONCURRENCY = 6

HERO_PROMPT_SUFFIX = (
    ", full body character, T-pose stance, isometric view, neutral background, "
    "hero shot, character reference"
)


def keyframe_indices(src_count: int, n: int) -> list[int]:
    """N índices uniformes cubriendo todo el ciclo, sin duplicados."""
    if n <= 0 or src_count <= 0:
        return []
    out: list[int] = []
    for i in range(n):
        idx = min(int(round(i * src_count / n)), src_count - 1)
        if not out or idx != out[-1]:
            out.append(idx)
    return out


def atlas_layout(n: int) -> tuple[int, int]:
    """Grid (cols, rows) apaisado — el shape con el que se validó V4."""
    cols = int(math.ceil(math.sqrt(n)))
    rows = int(math.ceil(n / cols))
    if cols < rows:
        cols, rows = rows, cols
    return cols, rows


def compose_atlas(frame_paths: list[Path]) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    first = Image.open(frame_paths[0])
    fw, fh = first.size
    cols, rows = atlas_layout(len(frame_paths))
    atlas = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, p in enumerate(frame_paths):
        r, c = divmod(i, cols)
        atlas.paste(Image.open(p).convert("RGBA"), (c * fw, r * fh))
    return atlas, (cols, rows), (fw, fh)


def split_atlas(
    atlas: Image.Image,
    layout: tuple[int, int],
    n: int,
    frame_size: tuple[int, int],
) -> list[Image.Image]:
    """Recorta el atlas devuelto por Meshy en frames. Meshy no respeta el
    tamaño exacto del input, así que se reescala al grid esperado primero."""
    cols, rows = layout
    fw, fh = frame_size
    expected = (cols * fw, rows * fh)
    if atlas.size != expected:
        atlas = atlas.resize(expected, Image.LANCZOS)
    frames: list[Image.Image] = []
    for i in range(n):
        r, c = divmod(i, cols)
        frames.append(atlas.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)))
    return frames


_rembg_session = None


def strip_background(img: Image.Image) -> Image.Image:
    """Quita el fondo de estudio (blanco + sombra suave) que devuelve Meshy.

    Meshy image-to-image devuelve imágenes opacas y además relaja la pose y
    cambia el volumen del personaje (ropa, pelo), así que re-aplicar el alfa
    del frame base — lo que hacía la vía ControlNet — recortaría mal. rembg
    (u2net) es la herramienta que el proyecto ya usa para quitar fondos de
    referencias de modelos 3D (model_generator._generate_textured_box).
    """
    global _rembg_session
    from rembg import remove

    if _rembg_session is None:
        from rembg import new_session

        _rembg_session = new_session("u2net")
    return remove(img.convert("RGB"), session=_rembg_session)


def _image_to_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _png_to_data_uri(path: Path) -> str:
    return f"data:image/png;base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


class SpriteSkinMeshy:
    """Skinning de sprite sheets contra la API de Meshy.

    Lanza en el constructor si MESHY_API_KEY no está definida (fail-loud):
    el endpoint decide si eso es un 503 para el cliente.
    """

    def __init__(self, base_sprites_dir: Path, cache_dir: Path, ai_model: str):
        if ai_model not in MeshyImageToImage.MODEL_CREDITS:
            raise ValueError(f"unknown Meshy ai_model: {ai_model}")
        self.api = MeshyImageToImage()  # lanza si falta MESHY_API_KEY
        self.base_sprites_dir = base_sprites_dir
        self.cache_dir = cache_dir
        self.heroes_dir = cache_dir / "heroes"
        self.ai_model = ai_model
        # Un hero-shot en vuelo por prompt: dos anims del mismo personaje no
        # deben generar dos identidades distintas en paralelo.
        self._hero_locks: dict[str, asyncio.Lock] = {}

    def hero_key(self, prompt: str, base_model: str) -> str:
        # namespace_suffix: un hero rancio de modo dev no debe ocupar el slot
        # real de este prompt.
        payload = "\n".join(
            [prompt.strip().lower(), base_model, self.ai_model, DEV_API_CACHE.namespace_suffix()]
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    async def hero_shot(
        self, prompt: str, base_model: str, angle: str, client: httpx.AsyncClient
    ) -> Path:
        """Genera (o recupera del cache) el hero-shot del personaje."""
        key = self.hero_key(prompt, base_model)
        hero_path = self.heroes_dir / f"{key}.png"
        lock = self._hero_locks.setdefault(key, asyncio.Lock())
        async with lock:
            if hero_path.exists():
                return hero_path
            base_frame = self.base_sprites_dir / base_model / "idle" / angle / "dir_0_frame_000.png"
            if not base_frame.exists():
                raise FileNotFoundError(f"base frame missing: {base_frame}")

            async def _call() -> list[bytes]:
                png, _ = await self.api.run_one(
                    self.ai_model,
                    prompt.strip() + HERO_PROMPT_SUFFIX,
                    [_png_to_data_uri(base_frame)],
                    client=client,
                )
                return [png]

            blobs, _cached = await DEV_API_CACHE.through(
                "meshy_i2i_sprite_hero", _call, note=prompt
            )
            png_bytes = blobs[0]
            self.heroes_dir.mkdir(parents=True, exist_ok=True)
            hero_path.write_bytes(png_bytes)
            return hero_path

    async def _skin_one_dir(
        self,
        sheet_dir: Path,
        out_dir: Path,
        direction: int,
        indices: list[int],
        prompt: str,
        hero_uri: str,
        client: httpx.AsyncClient,
    ) -> None:
        frame_paths = [sheet_dir / f"dir_{direction}_frame_{i:03d}.png" for i in indices]
        missing = [p for p in frame_paths if not p.exists()]
        if missing:
            raise FileNotFoundError(f"missing source frame: {missing[0]}")
        atlas, layout, frame_size = compose_atlas(frame_paths)
        atlas_prompt = (
            f"{prompt}. Same {layout[0]}x{layout[1]} grid layout, same number of frames, "
            f"keep each cell aligned, do not add new cells, do not crop frames. "
            f"Maintain character identity exactly as in the reference."
        )
        async def _call() -> list[bytes]:
            png, _ = await self.api.run_one(
                self.ai_model,
                atlas_prompt,
                [_image_to_data_uri(atlas), hero_uri],
                client=client,
            )
            return [png]

        blobs, _cached = await DEV_API_CACHE.through(
            "meshy_i2i_sprite_atlas", _call, note=f"{prompt} [{direction}]"
        )
        png_bytes = blobs[0]
        frames = split_atlas(
            Image.open(io.BytesIO(png_bytes)).convert("RGBA"), layout, len(indices), frame_size
        )
        # rembg es CPU-bound (onnx): fuera del event loop, un thread por dir.
        def _strip_and_save() -> None:
            for f_idx, frame in enumerate(frames):
                strip_background(frame).save(out_dir / f"dir_{direction}_frame_{f_idx:03d}.png")

        await asyncio.to_thread(_strip_and_save)

    async def skin_anim(
        self, base_model: str, anim: str, angle: str, prompt: str, out_dir: Path
    ) -> dict:
        """Skinnea una anim completa (todas sus direcciones) y escribe frames
        + meta.json en `out_dir`. Devuelve el meta (frames/fps REDUCIDOS según
        ANIM_PROFILES — el cliente reproduce con este meta, no con el base).
        Todo-o-nada: si una dirección falla, no se escribe meta.json y el
        endpoint reporta el error (los PNG parciales los pisa el retry)."""
        sheet_dir = self.base_sprites_dir / base_model / anim / angle
        base_meta = json.loads((sheet_dir / "meta.json").read_text())
        directions = int(base_meta["directions"])
        n_keyframes, play_fps = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
        indices = keyframe_indices(int(base_meta["frame_count"]), n_keyframes)

        out_dir.mkdir(parents=True, exist_ok=True)
        sem = asyncio.Semaphore(MESHY_CONCURRENCY)

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15, read=300, write=300, pool=10)
        ) as client:
            hero_path = await self.hero_shot(prompt, base_model, angle, client)
            hero_uri = _png_to_data_uri(hero_path)

            async def guarded(d: int) -> None:
                async with sem:
                    await self._skin_one_dir(
                        sheet_dir, out_dir, d, indices, prompt, hero_uri, client
                    )

            await asyncio.gather(*(guarded(d) for d in range(directions)))

        meta = {
            "model": base_model,
            "anim": anim,
            "angle": angle,
            "directions": directions,
            "frame_count": len(indices),
            "fps": play_fps,
            "duration": round(len(indices) / play_fps, 4),
            "frame_width": int(base_meta["frame_width"]),
            "frame_height": int(base_meta["frame_height"]),
            "skin": {
                "prompt": prompt,
                "ai_model": self.ai_model,
                "background": "rembg_u2net",
                "keyframe_indices": indices,
                "cost_usd": round(
                    self.api.cost_usd(self.ai_model) * directions, 4
                ),
            },
        }
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta
