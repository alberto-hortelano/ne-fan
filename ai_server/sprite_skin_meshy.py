"""Skin de sprite sheets vía Meshy image-to-image (hero-shot + atlas V4).

Pipeline validado en labs/skinning (README, lessons learned): la vía local
SD1.5+ControlNet re-rollea la ropa entre frames y quedó descartada; lo que
funciona es Meshy con un atlas de keyframes por (anim, dirección) y un
hero-shot del personaje como segunda referencia de identidad. Este módulo es
el port de producción del generador de personajes de
`labs/skinning/lab_server.py` (endpoints hero_shot + skin).

Flujo por descripción narrativa (prompt):
1. `hero_shot(prompt)` — img2img del frame `idle dir_0 frame_000` del modelo
   base con el prompt → referencia de identidad. UNA llamada, cacheada por
   prompt en `{cache}/heroes/`.
2. `skin_anim(anim)` — reduce la anim a densidad de sprite-sheet 2D
   (ANIM_PROFILES), agrupa las direcciones en lotes (`plan_dir_batches`:
   una fila del atlas por dirección, ≤ ATLAS_MAX_CELLS celdas por llamada),
   llama Meshy con `[atlas, hero]` y descompone el atlas devuelto en frames.

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
from spend_tracker import SPEND

# Densidad de keyframes por anim: (n_keyframes, fps de reproducción).
# Tuneados a mano en labs/skinning/build_base_browser.py:ANIM_PROFILES para
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

# Concurrencia de llamadas Meshy por anim. Mismo valor que el
# lab_server; el límite real lo pone la API remota, no la GPU local.
MESHY_CONCURRENCY = 6

# Techo de celdas por atlas — lección de labs/skinning (>10 frames el modelo
# colapsa a la misma pose), revalidado 2026-08-18 con gpt-image-2 y
# nano-banana-pro (presets pack_*): varias DIRECCIONES comparten atlas (una
# fila por dirección) mientras el grid no supere el techo ni sea de aspecto
# extremo (el 4x1 hizo que nano-banana-pro re-maquetara el grid).
ATLAS_MAX_CELLS = 10
# Filas máximas relativas a las columnas (grids muy verticales u horizontales
# rompen la integridad del grid en el modelo de imagen).
ATLAS_MAX_ROWS_FACTOR = 2


def plan_dir_batches(directions: int, n_keyframes: int) -> list[list[int]]:
    """Agrupa las direcciones de una anim en lotes de atlas: cada lote pinta
    un grid con una FILA por dirección (cols = keyframes). rows*kf ≤
    ATLAS_MAX_CELLS y rows ≤ 2·kf. Con kf ≥ 6 degenera al plan clásico de una
    dirección por llamada."""
    if directions <= 0 or n_keyframes <= 0:
        raise ValueError(
            f"plan_dir_batches: directions={directions}, n_keyframes={n_keyframes}"
        )
    rows = max(1, min(ATLAS_MAX_CELLS // n_keyframes, ATLAS_MAX_ROWS_FACTOR * n_keyframes))
    return [list(range(d, min(d + rows, directions))) for d in range(0, directions, rows)]

# Fragmento de vista del hero-shot por ÁNGULO del set base. Un ángulo sin
# fragmento es un error de contrato, no algo que adivinar.
HERO_VIEW_FRAGMENTS = {
    "isometric_30": "isometric view",
    "isometric_45": "isometric view",
    "frontal": "front view, eye-level camera",
    "frontal_8": "front view, eye-level camera",
}


def hero_prompt_suffix(angle: str) -> str:
    view = HERO_VIEW_FRAGMENTS.get(angle)
    if view is None:
        raise ValueError(
            f"hero_prompt_suffix: ángulo de sprite sin fragmento de vista: {angle!r} "
            f"(conocidos: {sorted(HERO_VIEW_FRAGMENTS)})"
        )
    # Pose neutral de pie, NUNCA T-pose: la T-pose del hero se colaba en los
    # atlas de anims sutiles (idle) — el modelo pintaba una hoja de turnaround
    # en T-pose en vez de la animación (2026-08-18).
    return (
        f", full body character, relaxed natural standing pose, arms at sides, "
        f"{view}, neutral background, hero shot, character reference"
    )


def build_atlas_prompt(prompt: str, layout: tuple[int, int], multi_dir: bool) -> str:
    """Prompt del repintado de un atlas — fuente única (el bench V5 de
    labs/skinning lo reutiliza). El pose-lock es crítico: sin la cláusula de
    "pose exacta de cada celda" el modelo trata los atlas de poses sutiles
    (idle) como una hoja de turnaround y pinta T-poses (2026-08-18)."""
    out = (
        f"{prompt}. Same {layout[0]}x{layout[1]} grid layout, same number of frames, "
        f"keep each cell aligned, do not add new cells, do not crop frames. "
        f"Repaint every cell keeping its EXACT body pose from the input grid — "
        f"do not change any pose. "
    )
    if multi_dir:
        out += (
            "Each row shows the same character seen from a different viewing direction — "
            "keep each row's viewing direction exactly as in the input grid. "
        )
    out += (
        "The second reference image defines the character's appearance and identity ONLY — "
        "copy its clothing, colors and features, ignore its pose."
    )
    return out


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


def compose_grid_atlas(
    rows_of_paths: list[list[Path]],
) -> tuple[Image.Image, tuple[int, int], tuple[int, int]]:
    """Grid SEMÁNTICO: cada fila es la secuencia de keyframes de UNA dirección
    (mismo formato que el V5 packed de labs/skinning). Todas las filas deben
    tener la misma longitud."""
    if not rows_of_paths or not rows_of_paths[0]:
        raise ValueError("compose_grid_atlas: grid vacío")
    cols = len(rows_of_paths[0])
    if any(len(row) != cols for row in rows_of_paths):
        raise ValueError("compose_grid_atlas: filas de longitud desigual")
    rows = len(rows_of_paths)
    fw, fh = Image.open(rows_of_paths[0][0]).size
    atlas = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for r, row in enumerate(rows_of_paths):
        for c, p in enumerate(row):
            atlas.paste(Image.open(p).convert("RGBA"), (c * fw, r * fh))
    return atlas, (cols, rows), (fw, fh)


def fit_atlas_output(atlas: Image.Image, expected: tuple[int, int]) -> Image.Image:
    """Encaja el atlas devuelto por el modelo en el tamaño esperado SIN
    deformar. Los modelos de lienzo cuadrado (gpt-image-2 devuelve 1024²)
    letterboxean los grids no cuadrados; el resize directo los aplastaría.
    Si la relación de aspecto no coincide se recorta el bbox del contenido
    (píxeles distintos del color de fondo de las esquinas — recorte
    determinista local, no segmentación) expandido a la relación esperada."""
    ew, eh = expected
    aw, ah = atlas.size
    if abs((aw / ah) - (ew / eh)) < 0.05:
        return atlas.resize(expected, Image.LANCZOS) if atlas.size != expected else atlas
    from PIL import ImageChops

    rgb = atlas.convert("RGB")
    px = rgb.load()
    corners = [px[0, 0], px[aw - 1, 0], px[0, ah - 1], px[aw - 1, ah - 1]]
    bg = tuple(sorted(c[i] for c in corners)[len(corners) // 2] for i in range(3))
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg)).convert("L")
    bbox = diff.point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox is None:
        return atlas.resize(expected, Image.LANCZOS)
    bx0, by0, bx1, by1 = bbox
    bw, bh = bx1 - bx0, by1 - by0
    target_ratio = ew / eh
    if bw / bh < target_ratio:
        need = bh * target_ratio
        cx = (bx0 + bx1) / 2
        bx0, bx1 = cx - need / 2, cx + need / 2
    else:
        need = bw / target_ratio
        cy = (by0 + by1) / 2
        by0, by1 = cy - need / 2, cy + need / 2
    bx0, by0 = max(0, int(round(bx0))), max(0, int(round(by0)))
    bx1, by1 = min(aw, int(round(bx1))), min(ah, int(round(by1)))
    return atlas.crop((bx0, by0, bx1, by1)).resize(expected, Image.LANCZOS)


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


def atlas_echo_score(atlas_in: Image.Image, atlas_out: Image.Image) -> float:
    """Diferencia media por píxel (RGB 0-255, downsample 64²) entre el atlas
    enviado y el devuelto. Un modelo que "repinta" devolviendo el clay casi
    intacto da un score ínfimo — eso no es un skin y cachearlo deja al NPC en
    y_bot azul para siempre (visto en cache 2026-08-18). Comparación de píxel
    determinista, sin segmentación."""
    a = atlas_in.convert("RGB").resize((64, 64), Image.BILINEAR)
    b = atlas_out.convert("RGB").resize((64, 64), Image.BILINEAR)
    pa, pb = a.load(), b.load()
    total = 0
    for y in range(64):
        for x in range(64):
            ca, cb = pa[x, y], pb[x, y]
            total += abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2])
    return total / (64 * 64 * 3)


# Umbral de eco: un repintado real (clay cian → ropa/piel) supera esto de
# largo; solo un output ~idéntico al input queda por debajo.
ATLAS_ECHO_THRESHOLD = 8.0


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


def hero_key(
    prompt: str,
    base_model: str,
    ai_model: str,
    style_key: str = "",
    angle: str = "isometric_30",
) -> str:
    """Clave del hero-shot de identidad de un personaje (16 hex).

    Función de MÓDULO a propósito: el retrato del diálogo consulta si el hero
    ya existe, y una consulta de solo lectura no puede exigir MESHY_API_KEY
    (que el constructor de SpriteSkinMeshy sí exige).

    La composición del payload es INTOCABLE: cambiarla invalida todos los
    heroes ya pagados en cache/sprite_sheets/heroes/.

    namespace_suffix: un hero rancio de modo dev no debe ocupar el slot real
    de este prompt. style_key ("{style_id}:{hash}") separa el mismo personaje
    pintado con estilos de juego distintos; angle separa los sets por vista
    (el hero de isometric_30 no vale para frontal_8 — la pose base y el
    fragmento de vista del prompt cambian).
    """
    payload = "\n".join(
        [prompt.strip().lower(), base_model, ai_model, style_key,
         angle,
         # v2: hero en pose neutral (el hero en T-pose contaminaba los atlas
         # de idle) — un hero v1 cacheado no vale para el pipeline nuevo.
         "hero_v2",
         DEV_API_CACHE.namespace_suffix()]
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


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

    def hero_key(self, prompt: str, base_model: str, style_key: str = "", angle: str = "isometric_30") -> str:
        return hero_key(prompt, base_model, self.ai_model, style_key, angle)

    async def hero_shot(
        self,
        prompt: str,
        base_model: str,
        angle: str,
        client: httpx.AsyncClient,
        style_uri: str = "",
        style_key: str = "",
        style_token: str = "",
    ) -> tuple[Path, bool]:
        """Genera (o recupera del cache) el hero-shot del personaje. Devuelve
        `(path, paid)` — paid=True solo si esta llamada gastó una generación
        (cache de disco o dev-cache ⇒ False), para que el coste reportado por
        skin_anim incluya el hero cuando de verdad se pagó.

        `style_uri`/`style_token`: referencia de personaje del style pack del
        juego — el hero adopta ese estilo y las direcciones lo heredan del
        hero (el atlas no necesita ref extra)."""
        key = self.hero_key(prompt, base_model, style_key, angle)
        hero_path = self.heroes_dir / f"{key}.png"
        lock = self._hero_locks.setdefault(key, asyncio.Lock())
        async with lock:
            if hero_path.exists():
                return hero_path, False
            base_frame = self.base_sprites_dir / base_model / "idle" / angle / "dir_0_frame_000.png"
            if not base_frame.exists():
                raise FileNotFoundError(f"base frame missing: {base_frame}")

            hero_prompt = prompt.strip() + hero_prompt_suffix(angle)
            refs = [_png_to_data_uri(base_frame)]
            if style_uri:
                refs.append(style_uri)
                hero_prompt += (
                    ". Match the EXACT art style of the SECOND reference image"
                    + (f" ({style_token.strip()})" if style_token else "")
                )

            async def _call() -> list[bytes]:
                png, _ = await self.api.run_one(
                    self.ai_model,
                    hero_prompt,
                    refs,
                    client=client,
                )
                return [png]

            blobs, cached = await DEV_API_CACHE.through(
                "meshy_i2i_sprite_hero", _call, note=prompt
            )
            if not cached:
                SPEND.add(self.api.cost_usd(self.ai_model), f"hero: {prompt[:50]}", "remote-gen")
            png_bytes = blobs[0]
            self.heroes_dir.mkdir(parents=True, exist_ok=True)
            hero_path.write_bytes(png_bytes)
            return hero_path, not cached

    async def _skin_dir_batch(
        self,
        sheet_dir: Path,
        out_dir: Path,
        dirs: list[int],
        indices: list[int],
        prompt: str,
        hero_uri: str,
        client: httpx.AsyncClient,
    ) -> bool:
        """Skinnea un LOTE de direcciones en un solo atlas (una fila por
        dirección, cols = keyframes). Devuelve True si la llamada se pagó
        (False = dev-cache). Formato validado en labs/skinning (V5 packed)."""
        rows_of_paths = [
            [sheet_dir / f"dir_{d}_frame_{i:03d}.png" for i in indices] for d in dirs
        ]
        missing = [p for row in rows_of_paths for p in row if not p.exists()]
        if missing:
            raise FileNotFoundError(f"missing source frame: {missing[0]}")
        if len(dirs) == 1:
            # Lote de una dirección: grid cuadrado-ish clásico (3×3 para 8 kf)
            # — los aspectos extremos (8×1) rompen la integridad del grid en
            # algunos modelos (lección del bench 2026-08-18).
            atlas, layout, frame_size = compose_atlas(rows_of_paths[0])
        else:
            atlas, layout, frame_size = compose_grid_atlas(rows_of_paths)
        atlas_prompt = build_atlas_prompt(prompt, layout, multi_dir=len(dirs) > 1)

        async def _call() -> list[bytes]:
            png, _ = await self.api.run_one(
                self.ai_model,
                atlas_prompt,
                [_image_to_data_uri(atlas), hero_uri],
                client=client,
            )
            return [png]

        blobs, cached = await DEV_API_CACHE.through(
            "meshy_i2i_sprite_atlas", _call, note=f"{prompt} dirs{dirs}"
        )
        if not cached:
            SPEND.add(
                self.api.cost_usd(self.ai_model), f"atlas d{dirs}: {prompt[:44]}", "remote-gen"
            )
        png_bytes = blobs[0]
        atlas_out = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        atlas_out = fit_atlas_output(
            atlas_out, (layout[0] * frame_size[0], layout[1] * frame_size[1])
        )
        echo = atlas_echo_score(atlas, atlas_out)
        if echo < ATLAS_ECHO_THRESHOLD:
            raise RuntimeError(
                f"el modelo devolvió el atlas sin repintar (echo score {echo:.1f} < "
                f"{ATLAS_ECHO_THRESHOLD}) — dirs {dirs} de \"{prompt[:40]}\"; "
                f"no se cachea un skin en clay"
            )
        frames = split_atlas(atlas_out, layout, layout[0] * layout[1], frame_size)

        # rembg es CPU-bound (onnx): fuera del event loop, un thread por lote.
        def _strip_and_save() -> None:
            cols = layout[0]
            for r, d in enumerate(dirs):
                for c in range(len(indices)):
                    frame = frames[r * cols + c]
                    strip_background(frame).save(out_dir / f"dir_{d}_frame_{c:03d}.png")

        await asyncio.to_thread(_strip_and_save)
        return not cached

    async def skin_anim(
        self,
        base_model: str,
        anim: str,
        angle: str,
        prompt: str,
        out_dir: Path,
        style_uri: str = "",
        style_key: str = "",
        style_token: str = "",
    ) -> dict:
        """Skinnea una anim completa (todas sus direcciones) y escribe frames
        + meta.json en `out_dir`. Devuelve el meta (frames/fps REDUCIDOS según
        ANIM_PROFILES — el cliente reproduce con este meta, no con el base).
        Las direcciones van agrupadas en atlas multi-fila (plan_dir_batches).
        Todo-o-nada: si un lote falla, no se escribe meta.json y el
        endpoint reporta el error (los PNG parciales los pisa el retry)."""
        sheet_dir = self.base_sprites_dir / base_model / anim / angle
        base_meta = json.loads((sheet_dir / "meta.json").read_text())
        directions = int(base_meta["directions"])
        n_keyframes, play_fps = ANIM_PROFILES.get(anim, DEFAULT_PROFILE)
        indices = keyframe_indices(int(base_meta["frame_count"]), n_keyframes)
        batches = plan_dir_batches(directions, len(indices))

        out_dir.mkdir(parents=True, exist_ok=True)
        sem = asyncio.Semaphore(MESHY_CONCURRENCY)

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15, read=300, write=300, pool=10)
        ) as client:
            hero_path, hero_paid = await self.hero_shot(
                prompt, base_model, angle, client, style_uri, style_key, style_token
            )
            hero_uri = _png_to_data_uri(hero_path)

            async def guarded(dirs: list[int]) -> bool:
                async with sem:
                    return await self._skin_dir_batch(
                        sheet_dir, out_dir, dirs, indices, prompt, hero_uri, client
                    )

            paid_flags = await asyncio.gather(*(guarded(b) for b in batches))

        paid_calls = sum(1 for p in paid_flags if p) + (1 if hero_paid else 0)
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
                "style_key": style_key,
                "background": "rembg_u2net",
                "keyframe_indices": indices,
                "hero_paid": hero_paid,
                "atlas": {"max_cells": ATLAS_MAX_CELLS, "batches": batches},
                "cost_usd": round(self.api.cost_usd(self.ai_model) * paid_calls, 4),
            },
        }
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta
