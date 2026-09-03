"""El barrido de hero-shots (`ai_server/tools/arte_de_personaje.py`).

Un guion que se ejecuta UNA vez, a mano, sobre 61 MB de arte que costó dinero.
Se prueba por eso, y por una razón más: lo que decide es qué entra en el índice
COMO PROCEDENCIA, y una procedencia equivocada es peor que ninguna — el índice
existe justo para poder repetir la compra con un modelo mejor (#293, #376).

Lo que se fija:
  1. **Nombrable es una comprobación, no una conjetura.** Solo cuenta si
     `hero_key` recompuesta desde un `meta.json` da EXACTAMENTE el nombre del
     fichero. La `hero_key` es la de producción, importada.
  2. **El meta puede estar en `archivo/`.** Un hero sobrevive a que sus sheets
     se archiven, y entonces el único sitio donde queda su texto es ese.
  3. **Jamás un prompt inventado ni vacío.** El guardián de `registrar` es la
     línea que no puede fallar.
  4. **Dry-run no toca un byte** — es el defecto.
  5. **Nunca se borra**: lo que no tiene procedencia se MUEVE, y un destino
     ocupado para el barrido entero antes de mover el primero.

Ejecutar con: python3 -m unittest discover -s ai_server/tests
"""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_TOOL = Path(__file__).resolve().parents[1] / "tools" / "arte_de_personaje.py"
_spec = importlib.util.spec_from_file_location("arte_de_personaje", _TOOL)
tool = importlib.util.module_from_spec(_spec)
sys.modules["arte_de_personaje"] = tool
_spec.loader.exec_module(tool)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from routers.remote_generation import hero_key  # noqa: E402


class StoreFalso:
    def __init__(self):
        self.peticiones = []

    def register_character(self, hero_key, hero=None, sheets=None):
        self.peticiones.append({"hero_key": hero_key, "hero": hero, "sheets": sheets or []})
        return {"ok": True, "ref": f"character:{hero_key}", "rows": 1 if hero else 0}


class BarridoDeHeroesTest(unittest.TestCase):
    PROMPT = "Blas, el tabernero"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        raiz = Path(self._tmp.name)
        self.cache = raiz / "cache" / "sprite_sheets"
        self.archivo = raiz / "archivo" / "cache" / "sprite_sheets"
        (self.cache / "heroes").mkdir(parents=True)
        self.archivo.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _meta(self, donde: Path, nombre: str, prompt: str) -> None:
        d = donde / nombre
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(json.dumps({
            "model": "y_bot", "anim": "idle", "angle": "frontal_8",
            "directions": 2, "frame_count": 4, "fps": 3.6,
            "skin": {"prompt": prompt, "ai_model": "gpt-image-2", "base_key": "bk1"},
        }))

    def _hero(self, clave: str, bytes_=1234) -> Path:
        p = self.cache / "heroes" / f"{clave}.png"
        p.write_bytes(b"\x89PNG" + b"x" * (bytes_ - 4))
        return p

    def _clave_de(self, prompt: str) -> str:
        return hero_key(prompt, "y_bot", "frontal_8", "gpt-image-2", "")

    # ── el censo ───────────────────────────────────────────────────────────
    def test_nombrable_es_que_la_clave_recompuesta_ES_el_nombre_del_fichero(self):
        bueno = self._clave_de(self.PROMPT)
        self._meta(self.cache, "sheet1", self.PROMPT)
        self._hero(bueno)
        self._hero("ffffffffffffffff")  # ningún meta lo nombra

        censo = {f["hero_key"]: f for f in tool.censar(self.cache, self.archivo)}
        self.assertEqual(censo[bueno]["estado"], "nombrable")
        self.assertEqual(censo[bueno]["prompt"], self.PROMPT)
        self.assertEqual(censo["ffffffffffffffff"]["estado"], "no recomponible")
        self.assertEqual(censo["ffffffffffffffff"]["prompt"], "")

    def test_el_meta_puede_estar_en_ARCHIVO(self):
        # El caso real del 2026-09-03: los 27 sheets se archivaron con #375 y
        # sus heroes se quedaron en la caché. Si solo se mirara la caché viva,
        # los 7 nombrables saldrían como «sin procedencia» y se archivarían.
        clave = self._clave_de("Nuño, carbonero de Carboneras")
        self._meta(self.archivo, "sheet_archivado", "Nuño, carbonero de Carboneras")
        self._hero(clave)
        censo = tool.censar(self.cache, self.archivo)
        self.assertEqual([f["estado"] for f in censo], ["nombrable"])
        self.assertEqual(censo[0]["prompt"], "Nuño, carbonero de Carboneras")

    def test_un_meta_ilegible_no_tumba_el_censo_pero_se_dice(self):
        (self.cache / "roto").mkdir()
        (self.cache / "roto" / "meta.json").write_text("{ esto no es json")
        self._hero("aaaaaaaaaaaaaaaa")
        censo = tool.censar(self.cache, self.archivo)
        self.assertEqual([f["estado"] for f in censo], ["no recomponible"])

    def test_un_style_key_distinto_da_OTRAS_claves(self):
        # El meta no guarda el style_key: un personaje pintado con pack solo se
        # recompone si se le pasa el suyo. Es el punto ciego, escrito.
        clave_con_estilo = hero_key(self.PROMPT, "y_bot", "frontal_8", "gpt-image-2", "pack:abc")
        self._meta(self.cache, "sheet1", self.PROMPT)
        self._hero(clave_con_estilo)
        self.assertEqual(tool.censar(self.cache, self.archivo)[0]["estado"], "no recomponible")
        con = tool.censar(self.cache, self.archivo, "pack:abc")
        self.assertEqual(con[0]["estado"], "nombrable")

    # ── el registro ────────────────────────────────────────────────────────
    def test_registra_los_nombrables_con_su_prompt_real_en_UNA_peticion(self):
        clave = self._clave_de(self.PROMPT)
        self._meta(self.cache, "sheet1", self.PROMPT)
        self._hero(clave, 4096)
        self._hero("ffffffffffffffff")

        store = StoreFalso()
        self.assertEqual(tool.registrar(tool.censar(self.cache, self.archivo), store), 1)
        self.assertEqual(len(store.peticiones), 1, "el no recomponible NO se indexa")
        pet = store.peticiones[0]
        # Una petición por personaje: su hero y ningún sheet (sus anims ya no
        # están). El `ref` lo deriva el store del hero_key; aquí no se manda.
        self.assertEqual(pet["hero_key"], clave)
        self.assertEqual(pet["sheets"], [])
        self.assertEqual(pet["hero"]["prompt"], self.PROMPT)
        self.assertEqual(pet["hero"]["size_bytes"], 4096)
        self.assertNotIn("character_ref", pet["hero"]["extra"])
        self.assertEqual(pet["hero"]["extra"]["model"], "y_bot")
        self.assertEqual(pet["hero"]["extra"]["ai_model"], "gpt-image-2")

    def test_un_nombrable_sin_prompt_es_fail_loud_y_no_se_inventa_uno(self):
        # La línea que no puede fallar: un hero en el índice con la descripción
        # vacía es la mentira exacta que denuncia #376, escrita en el sitio del
        # que alguien se va a fiar para regenerar el arte.
        fila = {"hero_key": "a" * 16, "estado": "nombrable", "prompt": "",
                "model": "y_bot", "angle": "frontal_8", "ai_model": "m",
                "style_key": "", "bytes": 1}
        with self.assertRaises(RuntimeError) as e:
            tool.registrar([fila], StoreFalso())
        self.assertIn("no se inventa", str(e.exception))

    # ── el archivo ─────────────────────────────────────────────────────────
    def test_los_no_recomponibles_se_MUEVEN_enteros_y_nada_se_borra(self):
        clave = self._clave_de(self.PROMPT)
        self._meta(self.cache, "sheet1", self.PROMPT)
        self._hero(clave)
        huerfano = self._hero("ffffffffffffffff")
        contenido = huerfano.read_bytes()

        destino = self.archivo / tool.SUBDIR_NO_RECOMPONIBLES
        self.assertEqual(tool.archivar(tool.censar(self.cache, self.archivo), destino), 1)
        self.assertFalse(huerfano.exists(), "salió de la caché")
        self.assertTrue((self.cache / "heroes" / f"{clave}.png").exists(), "el nombrable se queda")
        movido = destino / "ffffffffffffffff.png"
        self.assertEqual(movido.read_bytes(), contenido, "entero, byte a byte: no se borra nada")

    def test_un_destino_ocupado_para_el_barrido_ENTERO(self):
        # La mitad del arte en cada sitio es peor que no haber empezado.
        for k in ["ffffffffffffffff", "eeeeeeeeeeeeeeee"]:
            self._hero(k)
        destino = self.archivo / tool.SUBDIR_NO_RECOMPONIBLES
        destino.mkdir(parents=True)
        (destino / "ffffffffffffffff.png").write_bytes(b"otra cosa")
        with self.assertRaises(RuntimeError):
            tool.archivar(tool.censar(self.cache, self.archivo), destino)
        self.assertTrue((self.cache / "heroes" / "eeeeeeeeeeeeeeee.png").exists(),
                        "ni el que no chocaba se movió")

    # ── el modo por defecto ────────────────────────────────────────────────
    def test_dry_run_no_toca_un_byte(self):
        clave = self._clave_de(self.PROMPT)
        self._meta(self.cache, "sheet1", self.PROMPT)
        self._hero(clave)
        self._hero("ffffffffffffffff")
        antes = sorted(p.name for p in (self.cache / "heroes").iterdir())

        argv = sys.argv
        sys.argv = ["arte_de_personaje.py", "--cache", str(self.cache), "--archivo", str(self.archivo)]
        try:
            self.assertEqual(tool.main(), 0)
        finally:
            sys.argv = argv
        self.assertEqual(sorted(p.name for p in (self.cache / "heroes").iterdir()), antes)
        self.assertFalse((self.archivo / tool.SUBDIR_NO_RECOMPONIBLES).exists())


if __name__ == "__main__":
    unittest.main()
