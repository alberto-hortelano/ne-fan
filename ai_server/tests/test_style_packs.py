"""Tests del StylePackResolver (formato de refs libres): resolución por id
dentro de la carpeta de ROL, fallback primera-de-carpeta en personajes,
lámina sin sustituto, caras sin fallback, degradación con packs incompletos,
recarga por mtime y byte-igualdad del contexto de caché."""
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
                {"id": "fps_surfaces", "file": "surfaces/surfaces.jpg",
                 "description": "lámina de materiales"},
                {"id": "fachada", "file": "faces/fachada.jpg",
                 "description": "fachada de casa con puerta"},
                {"id": "porton", "file": "faces/porton.jpg",
                 "description": "un portón de dos hojas"},
                # El ORDEN importa: noble es el primer personaje (fallback) y
                # NO tiene archivo, así que el fallback debe saltar al
                # siguiente personaje que sí existe.
                {"id": "noble", "file": "characters/noble.jpg",
                 "description": "un noble"},
                {"id": "commoner", "file": "characters/commoner.jpg",
                 "description": "una persona corriente"},
            ],
        }
        (d / "style.json").write_text(json.dumps(manifest), encoding="utf-8")
        _write_jpg(d / "surfaces/surfaces.jpg", (60, 60, 60))
        _write_jpg(d / "faces/fachada.jpg", (140, 110, 90))
        _write_jpg(d / "faces/porton.jpg", (90, 70, 50))
        _write_jpg(d / "characters/commoner.jpg", (200, 10, 10))
        self.resolver = StylePackResolver(styles_dir=self.styles_dir)

    def tearDown(self):
        self.tmp.cleanup()

    # ── characters/: el único rol con fallback ──

    def test_personaje_por_id(self):
        ref = self.resolver.resolve_character("mi_estilo", "commoner")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "commoner")
        self.assertTrue(ref.data_uri.startswith("data:image/jpeg;base64,"))
        self.assertEqual(ref.style_token, "token de arte")

    def test_sin_id_cae_al_primer_personaje_existente(self):
        # noble (primero) no tiene archivo ⇒ commoner.
        ref = self.resolver.resolve_character("mi_estilo", "")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "commoner")

    def test_id_desconocido_degrada_al_primer_personaje(self):
        ref = self.resolver.resolve_character("mi_estilo", "no_existe")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "commoner")

    def test_una_ref_nunca_cruza_de_carpeta(self):
        # Pedir una CARA como personaje no la devuelve: cae al personaje de
        # fallback. Una fachada no sirve de model sheet.
        ref = self.resolver.resolve_character("mi_estilo", "fachada")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "commoner")

    # ── faces/: por id EXACTO, sin fallback ──

    def test_resolve_face(self):
        ref = self.resolver.resolve_face("mi_estilo", "fachada")
        self.assertIsNotNone(ref)
        self.assertEqual(ref.ref_id, "fachada")
        # Id desconocido ⇒ None (SIN fallback a otra cara: pintaría la celda
        # con arte que el motor no pidió).
        self.assertIsNone(self.resolver.resolve_face("mi_estilo", "no_existe"))
        # La lámina vive en otra carpeta: no es una cara.
        self.assertIsNone(self.resolver.resolve_face("mi_estilo", "fps_surfaces"))
        # Un personaje tampoco.
        self.assertIsNone(self.resolver.resolve_face("mi_estilo", "commoner"))
        # Vacío / pack inexistente ⇒ None.
        self.assertIsNone(self.resolver.resolve_face("mi_estilo", ""))
        self.assertIsNone(self.resolver.resolve_face("no_pack", "fachada"))

    def test_cara_declarada_sin_imagen(self):
        d = self.styles_dir / "mi_estilo"
        manifest = json.loads((d / "style.json").read_text())
        manifest["refs"].append({
            "id": "tienda", "file": "faces/tienda.jpg", "description": "un comercio",
        })
        (d / "style.json").write_text(json.dumps(manifest), encoding="utf-8")
        r = StylePackResolver(styles_dir=self.styles_dir)
        self.assertIsNone(r.resolve_face("mi_estilo", "tienda"))

    # ── surfaces/: la lámina, sin sustituto ──

    def test_resolve_sheet(self):
        sheet = self.resolver.resolve_sheet("mi_estilo")
        self.assertIsNotNone(sheet)
        self.assertEqual(sheet.ref_id, "fps_surfaces")
        # Lámina declarada pero sin archivo ⇒ None (sin sustituto: una escena
        # contaminaría los swatches planos).
        (self.styles_dir / "mi_estilo" / "surfaces" / "surfaces.jpg").unlink()
        resolver2 = StylePackResolver(styles_dir=self.styles_dir)
        self.assertIsNone(resolver2.resolve_sheet("mi_estilo"))

    def test_sheet_de_pack_sin_lamina(self):
        # Un pack así no pasa el StyleManifestSchema; el resolver no valida
        # el manifest, así que aquí solo se comprueba que no inventa una.
        d = self.styles_dir / "sin_lamina"
        d.mkdir()
        (d / "style.json").write_text(json.dumps({
            "style_id": "sin_lamina", "name": "s", "description": "s",
            "style_token": "t", "cover": "cover.jpg", "tags": ["x"],
            "refs": [{"id": "fachada", "file": "faces/fachada.jpg", "description": "x"}],
        }), encoding="utf-8")
        self.assertIsNone(self.resolver.resolve_sheet("sin_lamina"))

    # ── degradación y caché ──

    def test_pack_inexistente_o_vacio_devuelve_none(self):
        self.assertIsNone(self.resolver.resolve_character("no_existe", "x"))
        d = self.styles_dir / "vacio"
        d.mkdir()
        (d / "style.json").write_text(json.dumps({
            "style_id": "vacio", "name": "v", "description": "v",
            "style_token": "t", "cover": "cover.jpg", "tags": ["x"], "refs": [],
        }), encoding="utf-8")
        self.assertIsNone(self.resolver.resolve_character("vacio", ""))

    def test_contexto_de_cache_byte_igual(self):
        # El contexto de caché de imagen es "{style_id}/{ref_id}:{hash}", y el
        # hash es del CONTENIDO del archivo: mover la ref de carpeta con
        # `git mv` (sin recomprimir) no cambia ni una letra, que es lo que
        # hace que el arte ya pagado siga siendo alcanzable.
        ref = self.resolver.resolve_face("mi_estilo", "fachada")
        context = f"{ref.style_id}/{ref.ref_id}:{ref.content_hash}"
        import hashlib
        raw = (self.styles_dir / "mi_estilo" / "faces" / "fachada.jpg").read_bytes()
        expected_hash = hashlib.sha256(raw).hexdigest()[:12]
        self.assertEqual(context, f"mi_estilo/fachada:{expected_hash}")

    def test_recarga_por_mtime(self):
        ref1 = self.resolver.resolve_face("mi_estilo", "fachada")
        path = self.styles_dir / "mi_estilo" / "faces" / "fachada.jpg"
        _write_jpg(path, (99, 99, 99))
        os.utime(path, (path.stat().st_atime + 5, path.stat().st_mtime + 5))
        ref2 = self.resolver.resolve_face("mi_estilo", "fachada")
        self.assertNotEqual(ref1.content_hash, ref2.content_hash)

    def test_list_styles_incluye_tags(self):
        styles = self.resolver.list_styles()
        self.assertEqual(len(styles), 1)
        self.assertEqual(styles[0]["style_id"], "mi_estilo")
        self.assertEqual(styles[0]["tags"], ["medieval"])

    def test_ref_folder(self):
        self.assertEqual(ref_folder("surfaces/x.jpg"), "surfaces")
        self.assertEqual(ref_folder("faces/x.jpg"), "faces")
        self.assertEqual(ref_folder("characters/y.jpg"), "characters")
        self.assertEqual(ref_folder("x.jpg"), "")
        self.assertEqual(ref_folder("otra/x.jpg"), "")
        # Las carpetas de las vistas retiradas ya no clasifican nada.
        self.assertEqual(ref_folder("overworld/x.jpg"), "")
        self.assertEqual(ref_folder("proscenium/x.jpg"), "")


if __name__ == "__main__":
    unittest.main()
