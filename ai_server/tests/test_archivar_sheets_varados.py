"""El barrido de sheets varados (`ai_server/tools/archivar_sheets_varados.py`).

Un guion que se ejecuta UNA vez, a mano, sobre arte que costó dinero. Se prueba
por eso: la primera corrida de verdad es también la única oportunidad de que
salga bien, y el modo por defecto tiene que ser el que no destruye nada.

Lo que se fija:
  1. **Dry-run no toca un byte.** Es el defecto, y si dejara de serlo se
     enteraría alguien contando ficheros en `cache/`, no un test.
  2. **`heroes/` no se archiva.** La clave del hero no cuelga de la del sheet:
     archivarlo obligaría a repagar la llamada de identidad de cada personaje.
  3. **Un destino ocupado para el barrido entero**, no a medias: la mitad del
     arte en cada sitio es peor que no haber empezado.
  4. **Nunca se borra**: lo movido está entero en el archivo.

Ejecutar con: python3 -m unittest discover -s ai_server/tests
"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_TOOL = Path(__file__).resolve().parents[1] / "tools" / "archivar_sheets_varados.py"
_spec = importlib.util.spec_from_file_location("archivar_sheets_varados", _TOOL)
tool = importlib.util.module_from_spec(_spec)
sys.modules["archivar_sheets_varados"] = tool
_spec.loader.exec_module(tool)


class BarridoTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        raiz = Path(self._tmp.name)
        self.cache = raiz / "sprite_sheets"
        self.archivo = raiz / "archivo"
        self.cache.mkdir()
        for h, anim in (("aaaa1111", "idle"), ("bbbb2222", "walk")):
            d = self.cache / h
            d.mkdir()
            (d / "dir_0_frame_000.png").write_bytes(b"x" * 10)
            (d / "meta.json").write_text(json.dumps({
                "model": "y_bot", "anim": anim, "angle": "frontal_8",
                "skin": {"prompt": f"un herrero {h}", "cost_usd": 1.92, "api": "fake"},
            }))
        # Lo que NO es un sheet vestido y no se archiva.
        (self.cache / "heroes").mkdir()
        (self.cache / "heroes" / "cafe.png").write_bytes(b"y" * 10)
        (self.cache / "_base_keys.json").write_text("{}")

    def tearDown(self):
        self._tmp.cleanup()

    def _correr(self, *args):
        argv = ["archivar_sheets_varados.py", "--cache", str(self.cache),
                "--archivo", str(self.archivo), *args]
        with mock.patch.object(sys, "argv", argv):
            return tool.main()

    def _en_cache(self):
        return sorted(p.name for p in self.cache.iterdir())

    def test_el_defecto_es_dry_run_y_no_mueve_NADA(self):
        self.assertEqual(self._correr(), 0)
        self.assertEqual(self._en_cache(), ["_base_keys.json", "aaaa1111", "bbbb2222", "heroes"])
        self.assertFalse(self.archivo.exists())

    def test_lista_los_sheets_con_su_procedencia(self):
        filas = tool.sheets_varados(self.cache)
        self.assertEqual({f["hash"] for f in filas}, {"aaaa1111", "bbbb2222"})
        self.assertEqual({f["prompt"] for f in filas},
                         {"un herrero aaaa1111", "un herrero bbbb2222"})
        self.assertTrue(all(f["frames"] == 1 for f in filas))

    def test_ejecutar_mueve_los_sheets_y_deja_heroes_e_indice(self):
        # El hero no se vara con la clave del sheet (`hero_key` no cuelga de
        # `base_key` ni del perfil): archivarlo repagaría la identidad de cada
        # personaje sin necesidad.
        self.assertEqual(self._correr("--ejecutar"), 0)
        self.assertEqual(self._en_cache(), ["_base_keys.json", "heroes"])
        self.assertEqual(sorted(p.name for p in self.archivo.iterdir()), ["aaaa1111", "bbbb2222"])

    def test_lo_movido_llega_ENTERO_con_su_meta(self):
        # `meta.json` es lo ÚNICO que sabe con qué prompt se pidió: sin él, el
        # arte archivado es irrepetible.
        self._correr("--ejecutar")
        meta = json.loads((self.archivo / "aaaa1111" / "meta.json").read_text())
        self.assertEqual(meta["skin"]["prompt"], "un herrero aaaa1111")
        self.assertTrue((self.archivo / "aaaa1111" / "dir_0_frame_000.png").exists())

    def test_un_destino_ocupado_para_el_barrido_ENTERO(self):
        (self.archivo / "aaaa1111").mkdir(parents=True)
        self.assertEqual(self._correr("--ejecutar"), 1)
        # Ni el que no chocaba: media mudanza es peor que ninguna.
        self.assertEqual(self._en_cache(), ["_base_keys.json", "aaaa1111", "bbbb2222", "heroes"])

    def test_un_sheet_sin_meta_se_archiva_pero_se_dice_que_no_tiene_procedencia(self):
        # Un repintado muerto a medias (el meta se escribe el último). Ocupa
        # disco y no lo sirve nadie, pero no se le inventa un prompt.
        (self.cache / "cccc3333").mkdir()
        (self.cache / "cccc3333" / "dir_0_frame_000.png").write_bytes(b"z")
        fila = next(f for f in tool.sheets_varados(self.cache) if f["hash"] == "cccc3333")
        self.assertEqual(fila["prompt"], "")
        self.assertIn("SIN PROCEDENCIA", tool.tabla([fila]))

    def test_una_cache_que_no_existe_no_revienta(self):
        self.assertEqual(tool.sheets_varados(self.cache / "no-existe"), [])


if __name__ == "__main__":
    unittest.main()
