"""Pintor del atlas de superficies de la vista fps (bench labs/fps, veredicto
2026-08-14). Cada CELDA es un asset de primera clase de la librería (kind
"surface", hash por descripción+estilo — independiente de la escena): el
endpoint resuelve qué celdas ya existen y aquí solo se pintan las que FALTAN,
re-empaquetadas juntas (paleta coherente en una sola llamada) y ancladas a
hasta 3 celdas reutilizadas como referencias extra.

Lecciones del bench candadas en este módulo:
- Prompt "flat material swatch seen straight-on at 90°" + descripciones
  material-first; celdas identificadas por posición+color, NUNCA texto en el
  lienzo; "EXACTLY N rectangles" contra la fragmentación.
- Base clay DETERMINISTA (ruido sembrado por cell key) — la caché depende de
  esos bytes.
- flatten_illumination (dividir el blur gaussiano) + make_tileable con
  np.roll (Image.transform AFFINE NO envuelve: metía negro y pintaba una
  rejilla oscura en el suelo).
- Tiles y heroes en páginas separadas: nano-banana-pro para tileables,
  gpt-image-2 para heroes (mezcla ganadora del bench).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import time

from PIL import Image, ImageFilter

from meshy_client import FalImageToImage

PAGE_PX = 1024
GUTTER_PX = 24
INSET_PX = 6
MAX_CELLS_PER_PAGE = 12
FEATHER_PX = 28
N_ROWS = 3

RULES = (
    "This image is a TEXTURE ATLAS SHEET for a retro first-person 3D game: a grid of "
    "rectangular placeholder cells on a plain neutral grey background. Repaint EVERY "
    "cell as a finished game texture, keeping each rectangle EXACTLY in place and "
    "filled edge to edge with its texture. Each cell is a FLAT MATERIAL SWATCH seen "
    "straight-on at exactly 90 degrees, like a sample from a texture library: the "
    "surface is parallel to the image plane and fills its whole rectangle. NEVER "
    "paint a room, a scene, furniture, loose objects, a floor meeting a wall, or a "
    "horizon inside a cell — only the material surface itself. The grey gutter "
    "between cells must stay plain neutral grey. Flat even lighting, albedo only: "
    "no cast shadows, no specular highlights, no perspective, no vanishing lines, "
    "no depth. Absolutely no text, no numbers, no labels, no borders, no frames, "
    "no watermark, no characters. "
)

TILE_RULE = (
    "Cells marked (seamless) must tile perfectly: their texture pattern must wrap "
    "continuously across opposite edges, with no vignetting and no centered motif. "
    "Brightness and detail density must be COMPLETELY uniform across each cell — "
    "the pixels at every edge must match the brightness of the center, with no "
    "darker borders or corners. "
)

# Regla de las celdas únicas (heroes): cada una viste UNA CARA de una pieza de
# un objeto 3D mayor. Sin esto, una desc que nombra el objeto ("peddler cart")
# hacía que el modelo pintase el objeto ENTERO — ruedas dibujadas sobre el
# cuerpo del carro (playtest 2026-08-16, volumen custom por piezas).
UNIQUE_RULE = (
    "Non-seamless cells are each ONE FACE of a piece of a larger 3D object: paint "
    "a flat straight-on close-up of that face's own surface, filling the rectangle "
    "edge to edge. The object's OTHER parts (wheels, legs, posts, roof, supports) "
    "exist as separate 3D geometry in the game and must NEVER be drawn inside the "
    "cell — no object silhouette, no ground contact, no sky or background around "
    "the face. "
)

ANCHOR_RULE = (
    "The additional reference images after the first one are ALREADY-PAINTED "
    "textures from this same material library: match their palette, style and "
    "level of detail exactly. Do NOT copy their content into the cells. "
)

# Lámina fps_surfaces del style pack (2ª referencia cuando el estilo la
# tiene): manda sobre el style_token en paleta y factura.
STYLE_SHEET_RULE = (
    "The SECOND reference image is a painted material swatch sheet that "
    "defines the TARGET ART STYLE: match its palette, material rendering and "
    "brushwork exactly in every cell. Do NOT copy its layout — each cell "
    "paints only the material its own description asks for. "
)
ANCHOR_RULE_AFTER_SHEET = (
    "The reference images after the second one are ALREADY-PAINTED textures "
    "from this same material library: match their palette, style and level "
    "of detail exactly. Do NOT copy their content into the cells. "
)

# Ref temática de CARA del style pack (surface_ref del motor): 2ª referencia
# de las páginas cuyo grupo de celdas la comparte. Enseña cómo compone el
# estilo una cara completa (fachada, portón…); desplaza la lámina a 3ª.
CELL_REF_RULE = (
    "The SECOND reference image is a themed style-pack illustration showing "
    "how this art style composes ONE full face of this kind (e.g. a house "
    "facade with its door and windows): follow its composition language, "
    "materials, proportions and level of detail in every cell, but paint "
    "exactly what each cell's own description asks — do NOT copy the "
    "reference verbatim and do NOT copy its framing or background. "
)
STYLE_SHEET_RULE_THIRD = (
    "The THIRD reference image is a painted material swatch sheet that "
    "defines the TARGET ART STYLE: match its palette, material rendering and "
    "brushwork exactly in every cell. Do NOT copy its layout — each cell "
    "paints only the material its own description asks for. "
)
ANCHOR_RULE_AFTER_THIRD = (
    "The reference images after the third one are ALREADY-PAINTED textures "
    "from this same material library: match their palette, style and level "
    "of detail exactly. Do NOT copy their content into the cells. "
)


def _hex_rgb(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def color_word(hex_color: str) -> str:
    """Nombre aproximado del color base (señala la celda en el prompt)."""
    r, g, b = _hex_rgb(hex_color)
    lum = (r + g + b) / 3
    if abs(r - g) < 18 and abs(g - b) < 18:
        return "dark grey" if lum < 90 else "grey" if lum < 150 else "light grey"
    if r > g > b:
        if lum < 95:
            return "dark brown"
        return "warm ochre" if g > 140 else "brown"
    if g >= r and g >= b:
        return "olive green" if lum < 110 else "green"
    if b >= r and b >= g:
        return "blue"
    return "brown"


def pack_missing(cells: list[dict]) -> list[list[dict]]:
    """Shelf-packer de las celdas que faltan (port de layoutAtlas de
    nefan-core/src/scene/greybox/surfaces.ts, mismas constantes). Además
    SEPARA tiles y heroes/unique en páginas distintas: cada grupo se pinta
    con su modelo. Devuelve páginas de celdas con `rect` asignado."""
    quant = lambda a: 0.5 if a <= 0.68 else 1 if a <= 1.2 else 1.5 if a <= 1.7 else 2  # noqa: E731
    row_h = (PAGE_PX - GUTTER_PX * (N_ROWS + 1)) // N_ROWS
    pages: list[list[dict]] = []

    def pack_group(group: list[dict]) -> None:
        page: list[dict] | None = None
        x = y = GUTTER_PX
        for cell in group:
            aspect = 1.0 if cell["kind"] == "tile" else quant(cell["world_w"] / max(1e-6, cell["world_h"]))
            w = min(round(row_h * aspect), PAGE_PX - 2 * GUTTER_PX)
            if page is not None and x + w + GUTTER_PX > PAGE_PX:
                x = GUTTER_PX
                y += row_h + GUTTER_PX
            if page is None or y + row_h + GUTTER_PX > PAGE_PX or len(page) >= MAX_CELLS_PER_PAGE:
                page = []
                pages.append(page)
                x = y = GUTTER_PX
            cell["rect"] = [x, y, w, row_h]
            page.append(cell)
            x += w + GUTTER_PX

    tiles = sorted((c for c in cells if c["kind"] == "tile"), key=lambda c: c["key"])
    # Uniques: subgrupos por ref temática (surface_ref) — sin-ref primero
    # ("" ordena antes), luego cada ref en orden alfabético. Cada subgrupo
    # empieza página propia: la ref viaja como imagen de referencia de SU
    # página y no puede mezclarse con celdas de otra ref. Coste: cada ref
    # distinta ⇒ ≥1 página gpt-image-2 (~$0.17) — es el precio de la
    # elección por cara.
    uniques = sorted(
        (c for c in cells if c["kind"] != "tile"),
        key=lambda c: (str(c.get("ref") or ""), c["key"]),
    )
    if tiles:
        pack_group(tiles)
    i = 0
    while i < len(uniques):
        ref = str(uniques[i].get("ref") or "")
        j = i
        while j < len(uniques) and str(uniques[j].get("ref") or "") == ref:
            j += 1
        pack_group(uniques[i:j])
        i = j
    return pages


def draw_base(page: list[dict]) -> Image.Image:
    """Base clay del atlas. DETERMINISTA: ruido sembrado por cell key."""
    img = Image.new("RGB", (PAGE_PX, PAGE_PX), "#7a7a7a")
    px = img.load()
    for cell in page:
        x, y, w, h = cell["rect"]
        r, g, b = _hex_rgb(cell["base_color"])
        rng = random.Random(cell["key"])
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                n = rng.randint(-4, 4)
                px[xx, yy] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
        for hint in cell.get("hints") or []:
            hx0, hy0, hx1, hy1, hcolor = hint
            hr, hg, hb = _hex_rgb(hcolor)
            for yy in range(y + int(hy0 * h), y + int(hy1 * h)):
                for xx in range(x + int(hx0 * w), x + int(hx1 * w)):
                    n = rng.randint(-4, 4)
                    px[xx, yy] = (max(0, min(255, hr + n)), max(0, min(255, hg + n)), max(0, min(255, hb + n)))
    return img


def build_prompt(
    page: list[dict], scene_description: str, style_token: str, has_anchors: bool,
    has_style_sheet: bool = False, has_cell_ref: bool = False,
) -> str:
    rows: dict[int, list[dict]] = {}
    for c in page:
        rows.setdefault(c["rect"][1], []).append(c)
    pos: dict[str, str] = {}
    for ri, yy in enumerate(sorted(rows), start=1):
        for ci, c in enumerate(sorted(rows[yy], key=lambda c: c["rect"][0]), start=1):
            pos[c["key"]] = f"row {ri}, cell {ci}"
    has_tiles = any(c["kind"] == "tile" for c in page)
    has_uniques = any(c["kind"] != "tile" for c in page)
    lines = []
    for c in page:
        seam = " (seamless)" if c["kind"] == "tile" else ""
        lines.append(f"{pos[c['key']]} ({color_word(c['base_color'])}): {c['desc']}{seam}.")
    count_rule = (
        f"There are EXACTLY {len(page)} rectangles. Each rectangle holds ONE single "
        "texture spanning its full width and height — NEVER split a rectangle into "
        "smaller panels and NEVER paint anything over the grey gutter. "
    )
    style = f"Art direction: {style_token}. " if style_token else ""
    # Posición de cada referencia EN PROSA — debe casar exactamente con el
    # orden de build_page_refs: [base, cell_ref?, lámina?, previa?, anchors].
    # Sin cell_ref (y sin lámina) el prompt queda byte-idéntico al histórico.
    if has_cell_ref:
        sheet_rule = STYLE_SHEET_RULE_THIRD if has_style_sheet else ""
        anchor_rule = (
            (ANCHOR_RULE_AFTER_THIRD if has_style_sheet else ANCHOR_RULE_AFTER_SHEET)
            if has_anchors else ""
        )
        ref_rules = CELL_REF_RULE + sheet_rule + anchor_rule
    else:
        anchor_rule = ""
        if has_anchors:
            anchor_rule = ANCHOR_RULE_AFTER_SHEET if has_style_sheet else ANCHOR_RULE
        ref_rules = (STYLE_SHEET_RULE if has_style_sheet else "") + anchor_rule
    return (
        RULES
        + count_rule
        + (TILE_RULE if has_tiles else "")
        + (UNIQUE_RULE if has_uniques else "")
        + ref_rules
        + f"All materials come from the same location ({scene_description}) "
        + "and must share ONE consistent palette. "
        + style
        + "The cells: "
        + " ".join(lines)
    )


def flatten_illumination(img: Image.Image) -> Image.Image:
    """Divide la iluminación de baja frecuencia (viñeteado del modelo): sin
    esto cada repetición del tile marca una rejilla oscura en el suelo."""
    import numpy as np

    arr = np.asarray(img).astype("float32")
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(img.width / 3))).astype("float32")
    mean = blur.mean(axis=(0, 1), keepdims=True)
    out = arr * (mean / np.maximum(blur, 1.0))
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def make_tileable(img: Image.Image, band: int = FEATHER_PX) -> Image.Image:
    """Feather de bordes con np.roll (¡Image.transform AFFINE no envuelve!)."""
    if band <= 0:
        return img
    import numpy as np

    arr = np.asarray(img).astype("float32")
    h, w = arr.shape[:2]
    shifted = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)
    dx = np.minimum(np.arange(w), np.arange(w)[::-1]).astype("float32")
    dy = np.minimum(np.arange(h), np.arange(h)[::-1]).astype("float32")
    wx = np.clip(1 - dx / band, 0, 1)
    wy = np.clip(1 - dy / band, 0, 1)
    weight = np.maximum(wx[None, :], wy[:, None])[..., None] * 0.85
    out = arr * (1 - weight) + shifted * weight
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def crop_cells(gen_img: Image.Image, page: list[dict]) -> dict[str, bytes]:
    """Recorta las celdas (inset) y postprocesa las tileables."""
    out: dict[str, bytes] = {}
    for cell in page:
        x, y, w, h = cell["rect"]
        crop = gen_img.crop((x + INSET_PX, y + INSET_PX, x + w - INSET_PX, y + h - INSET_PX))
        if cell["kind"] == "tile":
            crop = flatten_illumination(crop)
            crop = make_tileable(crop)
        buf = io.BytesIO()
        crop.save(buf, format="PNG")
        out[cell["key"]] = buf.getvalue()
    return out


def build_page_refs(
    base_uri: str,
    cell_ref_uri: str,
    sheet_uri: str,
    prev_uri: str,
    anchor_uris: list[str],
) -> list[str]:
    """Referencias de UNA página, en el orden del contrato del prompt:
    [base clay, ref de cara?, lámina?, página previa?, anchors...] recortando
    SOLO los anchors al techo de 5 de fal (base+cellref+lámina+previa = ≤4,
    la página previa nunca cae)."""
    refs = [base_uri]
    if cell_ref_uri:
        refs.append(cell_ref_uri)
    if sheet_uri:
        refs.append(sheet_uri)
    if prev_uri:
        refs.append(prev_uri)
    refs.extend(anchor_uris[: max(0, 5 - len(refs))])
    return refs


def surface_cell_context(
    mat: str,
    kind: str,
    hints: list | None,
    ai_model: str,
    style_key: str,
    style_sheet_hash: str = "",
    cell_ref_hash: str = "",
) -> dict:
    """Contexto de la clave de caché de UNA celda de la librería (función
    pura — el endpoint la namespacea con DEV_API_CACHE después). Claves
    CONDICIONALES (el hasher omite valores vacíos): sin lámina y sin ref el
    dict es byte-idéntico al histórico y la librería pintada sigue valiendo;
    `fpsref`/`cellref` invalidan SOLO las celdas afectadas, y usan el hash
    del CONTENIDO (renombrar la ref sin cambiar la imagen no repaga)."""
    ctx = {
        "mat": mat,
        "kind": kind,
        "style": style_key,
        "model": ai_model,
        "hints": canonical_hints(hints),
        "pipeline": "surface1",
        "library": "1",
    }
    if style_sheet_hash:
        ctx["fpsref"] = style_sheet_hash
    # Versión del contrato de las celdas ÚNICAS (UNIQUE_RULE del pintor:
    # una celda hero es UNA CARA, nunca el objeto entero). Solo en uniques:
    # invalida los heroes ya pintados como objeto (2026-08-16) sin repagar
    # ni una tile. La ref de cara solo aplica a uniques.
    if kind != "tile":
        ctx["unique_face_v"] = "2"
        if cell_ref_hash:
            ctx["cellref"] = cell_ref_hash
    return ctx


def _png_data_uri(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _bytes_data_uri(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


class SurfaceAtlasGenerator:
    """Pinta las celdas que faltan. `anchors` son PNG de celdas ya existentes
    reutilizadas en esta escena (≤3): anclan la paleta de lo nuevo."""

    def __init__(self, model: str = "nano-banana-pro", hero_model: str = "gpt-image-2") -> None:
        self._model = model
        self._hero_model = hero_model

    def _run_page(self, prompt: str, refs: list[str], ai_model: str) -> bytes:
        """Una página vía fal directo. Canal DEV_API_CACHE propio del atlas —
        compartir canal con otro pipeline mezclaría blobs en silencio."""
        from dev_api_cache import DEV_API_CACHE
        from spend_tracker import SPEND

        def _call() -> list[bytes]:
            fal = FalImageToImage()  # lee FAL_KEY; sin ella, error visible
            png, _task = asyncio.run(fal.run_one(prompt, refs, ai_model=ai_model, aspect=None))
            return [png]

        blobs, cached = DEV_API_CACHE.through_sync("fal_i2i_atlas", _call, note=prompt)
        if not cached:
            SPEND.add(FalImageToImage.COST_USD.get(ai_model, 0.17), prompt[:60], "remote-gen")
        return blobs[0]

    def generate(
        self,
        missing_cells: list[dict],
        scene_description: str,
        style_token: str,
        anchors: list[bytes],
        style_sheet_uri: str = "",
        cell_ref_uris: dict[str, str] | None = None,
    ) -> dict:
        """→ {"cells": {key: png_bytes}, "pages": [png_bytes], "pages_painted", "cost_usd"}

        Referencias por página, en este ORDEN (contrato del prompt,
        build_page_refs; techo 5 de fal — solo los anchors se recortan):
        base clay · ref de cara (2ª, si el grupo la tiene) · lámina
        fps_surfaces (2ª sin ref de cara — posición histórica; 3ª con ella) ·
        página previa · anchors.

        `cell_ref_uris`: data URI por id de ref de cara, faces/ (surface_ref);
        pack_missing agrupa las celdas por ref, así cada página tiene una
        sola (la de su primera celda)."""
        t0 = time.time()
        pages = pack_missing([dict(c) for c in missing_cells])
        painted: dict[str, bytes] = {}
        page_pngs: list[bytes] = []
        cost = 0.0
        prev_page_uri: str | None = None
        anchor_uris = [_bytes_data_uri(a) for a in anchors[:3]]
        for page in pages:
            base = draw_base(page)
            ai_model = self._model if any(c["kind"] == "tile" for c in page) else self._hero_model
            page_ref = str(page[0].get("ref") or "")
            cell_ref_uri = (cell_ref_uris or {}).get(page_ref, "")
            refs = build_page_refs(
                _png_data_uri(base), cell_ref_uri, style_sheet_uri,
                prev_page_uri or "", anchor_uris,
            )
            leading = 1 + (1 if cell_ref_uri else 0) + (1 if style_sheet_uri else 0)
            has_anchors = len(refs) > leading
            prompt = build_prompt(
                page, scene_description, style_token, has_anchors,
                has_style_sheet=bool(style_sheet_uri),
                has_cell_ref=bool(cell_ref_uri),
            )
            png = self._run_page(prompt, refs, ai_model)
            gen = Image.open(io.BytesIO(png)).convert("RGB")
            if gen.size != (PAGE_PX, PAGE_PX):
                gen = gen.resize((PAGE_PX, PAGE_PX), Image.LANCZOS)
            page_pngs.append(png)
            prev_page_uri = _png_data_uri(gen)
            painted.update(crop_cells(gen, page))
            cost += FalImageToImage.COST_USD.get(ai_model, 0.17)
        return {
            "cells": painted,
            "pages": page_pngs,
            "pages_painted": len(pages),
            "cost_usd": round(cost, 2),
            "generation_time_ms": int((time.time() - t0) * 1000),
        }


def canonical_hints(hints: list | None) -> str:
    """Serialización canónica de los hints para el context del hash: números
    normalizados a float redondeado 1e-4 (json.dumps distingue 1 de 1.0 y el
    wire puede traer cualquiera de los dos) — espejo de la canonicalización
    del layout TS (canonicalSurfaceLayoutJson)."""
    if not hints:
        return ""

    def canon(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return round(float(v) * 1e4) / 1e4
        if isinstance(v, list):
            return [canon(x) for x in v]
        return v

    return json.dumps(canon(hints), separators=(",", ":"), sort_keys=True)
