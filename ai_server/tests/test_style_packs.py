"""Tests del StylePackResolver (formato de refs libres): resolución por id
dentro de la vista, fallback primera-de-vista, lámina fps sin sustituto,
degradación con packs incompletos, recarga por mtime y byte-igualdad del
contexto de caché con los ids migrados."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image

from style_packs import StylePackResolver, ref_folder  # noqa: E402


def _write_jpg(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (64, 64), color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    path.write_bytes(buf.getvalue())


class StylePacksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.styles_dir = Path(self.tmp.name)
        d = self.styles_dir / "mi_estilo"
        d.mkdir()
        manifest = {
            "style_id": "mi_estilo",
            "name": "Mi estilo",
            "description": "desc",
            "style_token": "token de arte",
            "cover": "cover.jpg",
            "tags": ["medieval"],
            "refs": [
                # El ORDEN importa: settlement es la primera cenital (fallback).
                {"id": "settlement", "file": "overworld/settlement.jpg",
                 "description": "una aldea"},
                {"id": "forest", "file": "overworld/forest.jpg",
                 "description": "un bosque"},
                {"id": "catedral", "file": "overworld/catedral.jpg",
                 "description": "una catedral gótica"},
                {"id": "stage_street", "file": "proscenium/stage_street.jpg",
                 "description": "una calle"},
                {"id": "fps_surfaces", "file": "fps/surfaces.jpg",
                 "description": "lámina", "role": "fps_surfaces"},
                {"id": "commoner", "file": "characters/commoner.jpg",
                 "description": "una persona corriente"},
            ],
        }
        (d / "style.json").write_text(json.dumps(manifest), encoding="utf-8")
        # settlement declarado pero SIN archivo (pack incompleto): el fallback
        # de la vista debe saltar a la siguiente cenital existente.
        _write_jpg(d / "overworld/forest.jpg", (10, 200, 10))
        _write_jpg(d / "overworld/catedral.jpg", (120, 120, 140))
        _write_jpg(d / "proscenium/stage_street.jpg", (90, 80, 70))
        _write_jpg(d / "fps/surfaces.jpg", (60, 60, 60))
        _write_jpg(d / "characters/commoner.jpg", (200, 10, 10))
        self.resolver = StylePackResolver(styles_dir=self.styles_dir)

    def tearDown(self):
        self.tmp.cleanup()

    def test_resuelve_por_id(self):
        ref = self.resolver.resolve("mi_estilo", "catedral", "overworld")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "catedral")
        self.assertTrue(ref.data_uri.startswith("data:image/jpeg;base64,"))
        self.assertEqual(ref.style_token, "token de arte")

    def test_sin_id_cae_a_primera_de_vista_existente(self):
        # settlement (primera) no tiene archivo ⇒ forest (siguiente cenital).
        ref = self.resolver.resolve("mi_estilo", "", "overworld")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "forest")

    def test_id_desconocido_degrada_a_primera_de_vista(self):
        ref = self.resolver.resolve("mi_estilo", "no_existe", "overworld")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "forest")

    def test_una_ref_nunca_cruza_de_vista(self):
        # Pedir un id cenital en vista proscenium NO devuelve la cenital:
        # cae a la primera de plató.
        ref = self.resolver.resolve("mi_estilo", "catedral", "proscenium")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "stage_street")

    def test_lamina_fuera_del_catalogo_tematico(self):
        # La lámina no es candidata de la vista fps (role la excluye): un
        # pack sin refs temáticas fps devuelve None para esa vista.
        self.assertIsNone(self.resolver.resolve("mi_estilo", "", "fps"))

    def test_resolve_fps_face(self):
        # Ref temática fps/ (cara completa) por id EXACTO, sin fallback.
        d = self.styles_dir / "mi_estilo"
        import json as _json
        manifest = _json.loads((d / "style.json").read_text())
        manifest["refs"].append({
            "id": "fachada", "file": "fps/fachada.jpg",
            "description": "fachada de casa con puerta",
        })
        (d / "style.json").write_text(_json.dumps(manifest), encoding="utf-8")
        _write_jpg(d / "fps/fachada.jpg", (140, 110, 90))
        r = StylePackResolver(styles_dir=self.styles_dir)
        ref = r.resolve_fps_face("mi_estilo", "fachada")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "fachada")
        # Id desconocido ⇒ None (SIN fallback a otra imagen temática).
        self.assertIsNone(r.resolve_fps_face("mi_estilo", "no_existe"))
        # La lámina queda fuera del namespace de refs temáticas.
        self.assertIsNone(r.resolve_fps_face("mi_estilo", "fps_surfaces"))
        # Vacío / pack inexistente ⇒ None.
        self.assertIsNone(r.resolve_fps_face("mi_estilo", ""))
        self.assertIsNone(r.resolve_fps_face("no_pack", "fachada"))

    def test_resolve_fps_sheet(self):
        sheet = self.resolver.resolve_fps_sheet("mi_estilo")
        self.assertIsNotNone(sheet)
        self.assertEqual(sheet.ref_id, "fps_surfaces")
        # Lámina declarada pero sin archivo ⇒ None (sin sustituto).
        (self.styles_dir / "mi_estilo" / "fps" / "surfaces.jpg").unlink()
        resolver2 = StylePackResolver(styles_dir=self.styles_dir)
        self.assertIsNone(resolver2.resolve_fps_sheet("mi_estilo"))

    def test_personajes_son_vista_characters(self):
        ref = self.resolver.resolve("mi_estilo", "commoner", "characters")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "commoner")
        # Sin elección ⇒ primera de characters (commoner en los migrados).
        ref = self.resolver.resolve("mi_estilo", "", "characters")
        self.assertEqual(ref.ref_id, "commoner")

    def test_pack_inexistente_o_vacio_devuelve_none(self):
        self.assertIsNone(self.resolver.resolve("no_existe", "x", "overworld"))
        d = self.styles_dir / "vacio"
        d.mkdir()
        (d / "style.json").write_text(json.dumps({
            "style_id": "vacio", "name": "v", "description": "v",
            "style_token": "t", "cover": "cover.jpg", "tags": ["x"], "refs": [],
        }), encoding="utf-8")
        self.assertIsNone(self.resolver.resolve("vacio", "", "overworld"))

    def test_contexto_de_cache_byte_igual_con_ids_migrados(self):
        # El contexto de caché de escena es "{style_id}/{ref_id}:{hash}". Con
        # los ids migrados (= categorías antiguas) y el archivo movido sin
        # recomprimir, la cadena es byte-idéntica a la era de categorías.
        ref = self.resolver.resolve("mi_estilo", "forest", "overworld")
        context = f"{ref.style_id}/{ref.ref_id}:{ref.content_hash}"
        import hashlib
        raw = (self.styles_dir / "mi_estilo" / "overworld" / "forest.jpg").read_bytes()
        expected_hash = hashlib.sha256(raw).hexdigest()[:12]
        self.assertEqual(context, f"mi_estilo/forest:{expected_hash}")

    def test_recarga_por_mtime(self):
        ref1 = self.resolver.resolve("mi_estilo", "forest", "overworld")
        path = self.styles_dir / "mi_estilo" / "overworld" / "forest.jpg"
        _write_jpg(path, (99, 99, 99))
        os.utime(path, (path.stat().st_atime + 5, path.stat().st_mtime + 5))
        ref2 = self.resolver.resolve("mi_estilo", "forest", "overworld")
        self.assertNotEqual(ref1.content_hash, ref2.content_hash)

    def test_list_styles_incluye_tags(self):
        styles = self.resolver.list_styles()
        self.assertEqual(len(styles), 1)
        self.assertEqual(styles[0]["style_id"], "mi_estilo")
        self.assertEqual(styles[0]["tags"], ["medieval"])

    def test_ref_folder(self):
        self.assertEqual(ref_folder("overworld/x.jpg"), "overworld")
        self.assertEqual(ref_folder("characters/y.jpg"), "characters")
        self.assertEqual(ref_folder("x.jpg"), "")
        self.assertEqual(ref_folder("otra/x.jpg"), "")


if __name__ == "__main__":
    unittest.main()
