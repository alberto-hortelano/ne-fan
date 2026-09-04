"""Tests del pintor del atlas de superficies fps (surface_atlas_generator).

Cubren las lecciones candadas del bench labs/fps: packer determinista y
acotado, base clay reproducible byte a byte (la caché depende de esos bytes),
prompt con las reglas anti-fragmentación, feather sin negro (regresión del bug
AFFINE) y hints con serialización canónica estable.

Ejecutar con: NEFAN_SPEND_DIR=$(mktemp -d) python3 -m unittest discover -s ai_server/tests -v
(sin red: el generador no se instancia — solo las funciones puras)."""

import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from surface_atlas_generator import (  # noqa: E402
    FEATHER_PX,
    GUTTER_PX,
    MAX_CELLS_PER_PAGE,
    PAGE_PX,
    build_page_refs,
    build_prompt,
    canonical_hints,
    draw_base,
    make_tileable,
    pack_missing,
    surface_cell_context,
)


def cell(key, kind="tile", desc=None, color="#c9b89a", w=4.0, h=2.5, hints=None, ref=""):
    return {
        "key": key,
        "mat": key,
        "kind": kind,
        "desc": desc or f"{key} surface swatch",
        "base_color": color,
        "world_w": w,
        "world_h": h,
        "hints": hints,
        "ref": ref,
    }


class TestPacker(unittest.TestCase):
    def test_paginas_acotadas_y_grupos_separados(self):
        cells = [cell(f"tile_{i}") for i in range(14)] + [
            cell("hero_a", kind="unique", w=4.6, h=1.1),
            cell("hero_b", kind="unique", w=1.8, h=2.2),
        ]
        pages = pack_missing(cells)
        for page in pages:
            self.assertLessEqual(len(page), MAX_CELLS_PER_PAGE)
            kinds = {c["kind"] for c in page}
            # Tiles y heroes nunca comparten página (modelos distintos).
            self.assertLess(len(kinds), 2)
            for c in page:
                x, y, w, h = c["rect"]
                self.assertGreaterEqual(x, GUTTER_PX - 1)
                self.assertLessEqual(x + w, PAGE_PX)
                self.assertLessEqual(y + h, PAGE_PX)

    def test_determinista(self):
        cells = [cell(f"c{i}") for i in range(5)]
        a = pack_missing([dict(c) for c in cells])
        b = pack_missing([dict(c) for c in cells])
        self.assertEqual(
            [[c["rect"] for c in p] for p in a],
            [[c["rect"] for c in p] for p in b],
        )


class TestBaseYPrompt(unittest.TestCase):
    def test_base_reproducible_byte_a_byte(self):
        page = pack_missing([cell("wall_plaster"), cell("wood_floor", color="#7a5c3e")])[0]
        a, b = io.BytesIO(), io.BytesIO()
        draw_base(page).save(a, format="PNG")
        draw_base(page).save(b, format="PNG")
        self.assertEqual(a.getvalue(), b.getvalue())

    def test_base_pinta_hints(self):
        page = pack_missing(
            [cell("hero_arco", kind="unique", hints=[[0.25, 0.6, 0.75, 1.0, "#241a12"]])]
        )[0]
        img = draw_base(page)
        x, y, w, h = page[0]["rect"]
        centro_hint = img.getpixel((x + w // 2, y + int(h * 0.8)))
        fuera_hint = img.getpixel((x + w // 2, y + int(h * 0.2)))
        self.assertLess(sum(centro_hint), sum(fuera_hint) - 100)

    def test_prompt_reglas(self):
        page = pack_missing([cell("wall_plaster"), cell("puerta", kind="unique")])
        # Con tiles: cláusula seamless; sin tiles: no.
        p_tiles = build_prompt(page[0], "una aldea", "estilo x", has_anchors=False)
        self.assertIn(f"EXACTLY {len(page[0])} rectangles", p_tiles)
        self.assertIn("(seamless)", p_tiles)
        self.assertIn("estilo x", p_tiles)
        # Página SOLO tiles: sin la regla de caras únicas.
        self.assertNotIn("ONE FACE", p_tiles)
        p_hero = build_prompt(page[1], "una aldea", "", has_anchors=True)
        self.assertNotIn("(seamless)", p_hero)
        self.assertIn("ALREADY-PAINTED", p_hero)
        # Heroes: cada celda es UNA CARA de una pieza — las demás partes del
        # objeto (ruedas, patas…) son geometría aparte y no se pintan
        # (regresión del carro con ruedas dibujadas, 2026-08-16).
        self.assertIn("ONE FACE of a piece", p_hero)
        self.assertIn("must NEVER be drawn inside the cell", p_hero)

    def test_prompt_con_lamina_de_estilo(self):
        # Con lámina fps_surfaces: cláusula de la 2ª referencia y los anchors
        # pasan a describirse "after the second one" (la posición es contrato).
        page = pack_missing([cell("wall_plaster")])
        p = build_prompt(page[0], "una aldea", "estilo x", has_anchors=True,
                         has_style_sheet=True)
        self.assertIn("SECOND reference image is a painted material swatch sheet", p)
        self.assertIn("after the second one", p)
        self.assertNotIn("after the first one", p)
        # Sin lámina, el prompt es byte-idéntico al histórico.
        p_old = build_prompt(page[0], "una aldea", "estilo x", has_anchors=True)
        self.assertNotIn("swatch sheet", p_old)
        self.assertIn("after the first one", p_old)


class TestPostproceso(unittest.TestCase):
    def test_feather_no_introduce_negro(self):
        # Regresión del bug AFFINE: la imagen clara no puede ganar píxeles
        # oscuros en el borde (la banda del feather mezcla con la MISMA imagen
        # desplazada, nunca con negro).
        img = Image.new("RGB", (128, 128), (200, 180, 150))
        out = make_tileable(img, band=FEATHER_PX)
        extremos = [out.getpixel((0, 0)), out.getpixel((127, 127)), out.getpixel((64, 0))]
        for px in extremos:
            self.assertGreater(sum(px), 3 * 140, f"borde oscurecido: {px}")


class TestHints(unittest.TestCase):
    def test_serializacion_estable(self):
        a = canonical_hints([[0.25, 0.6, 0.75, 1, "#241a12"]])
        b = canonical_hints([[0.25, 0.60, 0.75, 1.0, "#241a12"]])
        self.assertEqual(a, b)
        self.assertEqual(canonical_hints(None), "")
        self.assertEqual(canonical_hints([]), "")



class TestCellRefs(unittest.TestCase):
    """surface_ref: agrupación por ref, presupuesto de refs y clave de caché."""

    def test_pack_agrupa_uniques_por_ref(self):
        cells = [
            cell("t1"), cell("t2"),
            cell("hero_z", kind="unique"),
            cell("hero_a", kind="unique", ref="fachada"),
            cell("hero_b", kind="unique", ref="porton"),
            cell("hero_c", kind="unique", ref="fachada"),
        ]
        pages = pack_missing(cells)
        # Cada página comparte kind Y ref; sin-ref primero, refs alfabéticas.
        seen_groups = []
        for page in pages:
            kinds = {c["kind"] for c in page}
            refs = {str(c.get("ref") or "") for c in page}
            self.assertEqual(len(kinds), 1)
            self.assertEqual(len(refs), 1)
            if "unique" in kinds:
                seen_groups.append(next(iter(refs)))
        self.assertEqual(seen_groups, ["", "fachada", "porton"])

    def test_pack_determinista_con_refs(self):
        cells = [
            cell("hero_b", kind="unique", ref="porton"),
            cell("hero_a", kind="unique", ref="fachada"),
            cell("hero_z", kind="unique"),
        ]
        a = pack_missing([dict(c) for c in cells])
        b = pack_missing([dict(c) for c in reversed(cells)])
        self.assertEqual(
            [[c["key"] for c in p] for p in a],
            [[c["key"] for c in p] for p in b],
        )

    def test_build_page_refs_presupuesto(self):
        anchors = ["a1", "a2", "a3"]
        # Sin nada opcional: base + 3 anchors.
        self.assertEqual(build_page_refs("base", "", "", "", anchors), ["base", "a1", "a2", "a3"])
        # Todo presente: base+cellref+lamina+prev = 4 fijos, 1 anchor cabe.
        refs = build_page_refs("base", "cr", "sheet", "prev", anchors)
        self.assertEqual(refs, ["base", "cr", "sheet", "prev", "a1"])
        self.assertLessEqual(len(refs), 5)
        # La página previa nunca cae; los anchors se recortan primero.
        self.assertIn("prev", refs)

    def test_prompt_con_cell_ref_desplaza_posiciones(self):
        page = pack_missing([cell("hero_a", kind="unique", ref="fachada")])[0]
        p = build_prompt(page, "una aldea", "token", has_anchors=True,
                         has_style_sheet=True, has_cell_ref=True)
        self.assertIn("The SECOND reference image is a themed style-pack", p)
        self.assertIn("The THIRD reference image is a painted material swatch", p)
        self.assertIn("after the third one", p)
        # Sin lámina: anchors tras la segunda (la cell ref).
        p2 = build_prompt(page, "una aldea", "token", has_anchors=True,
                          has_style_sheet=False, has_cell_ref=True)
        self.assertIn("after the second one", p2)
        self.assertNotIn("THIRD", p2)

    def test_prompt_sin_ref_byte_identico_al_historico(self):
        # El flag nuevo con default False no puede tocar ni un byte del
        # prompt histórico (la caché DEV y las reglas candadas dependen).
        page = pack_missing([cell("hero_a", kind="unique")])[0]
        old = build_prompt(page, "una aldea", "token", has_anchors=True, has_style_sheet=True)
        new = build_prompt(page, "una aldea", "token", has_anchors=True,
                           has_style_sheet=True, has_cell_ref=False)
        self.assertEqual(old, new)

    def test_cell_context_cellref_condicional(self):
        historico = surface_cell_context("wall_plaster", "unique", None, "gpt-image-2", "s:t")
        self.assertNotIn("cellref", historico)
        self.assertEqual(historico["unique_face_v"], "2")
        con_ref = surface_cell_context(
            "wall_plaster", "unique", None, "gpt-image-2", "s:t", cell_ref_hash="abc123"
        )
        self.assertEqual(con_ref["cellref"], "abc123")
        # Quitando la clave nueva, el resto es byte-idéntico al histórico.
        sin = dict(con_ref)
        sin.pop("cellref")
        self.assertEqual(sin, historico)
        # En tiles la ref NO entra (solo celdas hero la usan).
        tile = surface_cell_context("wall_plaster", "tile", None, "nano", "s:t", cell_ref_hash="abc123")
        self.assertNotIn("cellref", tile)
        self.assertNotIn("unique_face_v", tile)


if __name__ == "__main__":
    unittest.main()
