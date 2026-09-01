"""Tests del adaptador de sprite-forge (`routers/remote_generation.py`).

Es el ÚNICO puente por el que ne-fan pide hojas de personaje: si se tuerce, no
hay personajes. El módulo que sustituyó tenía 228 líneas de pruebas que se
fueron con él, y este se quedó sin ninguna — así que aquí están, con un
sprite-forge de mentira en localhost para no depender de que el de verdad esté
arriba (ni de que exista Python con rembg, ni de una clave de imagen).

Lo que se prueba, en el orden en que duele que se rompa:

1. **Las claves de caché.** Un cambio en cualquiera de sus campos tiene que dar
   otra clave, o se sirve arte de otro personaje; y dos peticiones iguales
   tienen que dar la misma, o se paga dos veces lo mismo.
2. **El índice de `base_key`.** Es lo que permite servir arte YA PAGADO con el
   servicio caído.
3. **La traducción de errores.** Un 4xx del servicio es culpa de lo que
   pedimos y sube tal cual; un 5xx es suyo y sale como 502. Confundirlos hace
   que el cliente reintente cuando debería corregir.
4. **El flujo entero**, contra el sprite-forge de mentira.

El sprite-forge de mentira ya no contesta respuestas inventadas: sirve las
fixtures CANÓNICAS que emite el servicio real (`npm run fixtures-contrato` en
su repo, commiteadas en `nefan-core/data/contract/fixtures/sprite-forge/`).
Era la cuarta copia del contrato, y la única que nadie comparaba con nada.

Requieren fastapi (TestClient); sin ella se saltan.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v
"""

import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None

_FIXTURES = Path(__file__).resolve().parents[2] / "nefan-core" / "data" / "contract" / "fixtures" / "sprite-forge"


def _fixture(nombre: str) -> dict:
    """Una respuesta REAL del servicio (fixture canónica). Si falta, LANZA: un
    doble que se inventa la respuesta es justo la copia sin contrastar que este
    directorio vino a matar."""
    return json.loads((_FIXTURES / f"{nombre}.json").read_text())


class ForgeFalso:
    """Un sprite-forge de mentira. Cuenta lo que le piden para poder afirmar
    cosas como "no se llamó a /identity la segunda vez"."""

    def __init__(self):
        self.llamadas = []
        self.respuestas = {}
        self.fallo = None  # (ruta, status, detail)
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silencio
                pass

            def _responder(self, status, cuerpo):
                datos = json.dumps(cuerpo).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(datos)))
                self.end_headers()
                self.wfile.write(datos)

            def do_GET(self):
                srv.llamadas.append(("GET", self.path))
                if srv.fallo and srv.fallo[0] == self.path:
                    return self._responder(srv.fallo[1], {"detail": srv.fallo[2]})
                self._responder(200, srv.respuestas.get(self.path, {}))

            def do_POST(self):
                n = int(self.headers.get("content-length", 0))
                cuerpo = json.loads(self.rfile.read(n) or b"{}")
                srv.llamadas.append(("POST", self.path, cuerpo))
                if srv.fallo and srv.fallo[0] == self.path:
                    return self._responder(srv.fallo[1], {"detail": srv.fallo[2]})
                self._responder(200, srv.respuestas.get(self.path, {}))

        self.http = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.http.server_address[1]}"
        self.hilo = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.hilo.start()

    def rutas_pedidas(self, metodo=None):
        return [c[1] for c in self.llamadas if metodo is None or c[0] == metodo]

    def parar(self):
        self.http.shutdown()
        self.http.server_close()


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class ClavesTest(unittest.TestCase):
    """Las dos claves de caché. Cambiar su composición invalida arte pagado, así
    que lo que se fija aquí es que NINGÚN campo se cuele sin efecto."""

    def setUp(self):
        from routers import remote_generation as rg

        self.rg = rg
        self.base = dict(base_key="b1", model="y_bot", anim="walk", angle="frontal_8",
                         prompt="un herrero", ai_model="gpt-image-2", style_key="s1")

    def test_misma_peticion_misma_clave(self):
        self.assertEqual(self.rg._skin_sheet_key(**self.base), self.rg._skin_sheet_key(**self.base))

    def test_cada_campo_cambia_la_clave_del_sheet(self):
        otros = dict(base_key="b2", model="paladin", anim="run", angle="otro",
                     prompt="una arquera", ai_model="nano-banana", style_key="s2")
        vistas = {self.rg._skin_sheet_key(**self.base): "base"}
        for campo, valor in otros.items():
            k = self.rg._skin_sheet_key(**{**self.base, campo: valor})
            self.assertNotIn(k, vistas, f'cambiar "{campo}" NO cambió la clave')
            vistas[k] = campo
        self.assertEqual(len(vistas), len(otros) + 1)

    def test_el_prompt_no_distingue_mayusculas_ni_espacios(self):
        # Dos NPC descritos igual con otro espaciado no deben cobrarse dos veces.
        a = self.rg._skin_sheet_key(**{**self.base, "prompt": "Un Herrero  "})
        self.assertEqual(a, self.rg._skin_sheet_key(**self.base))

    def test_el_hero_NO_depende_de_la_animacion(self):
        # Es la razón de ser del hero: las tres anims de un personaje tienen que
        # ser la MISMA persona. Su firma ni siquiera acepta `anim`.
        import inspect

        self.assertNotIn("anim", inspect.signature(self.rg.hero_key).parameters)

    def test_cada_campo_cambia_la_clave_del_hero(self):
        base = dict(prompt="un herrero", model="y_bot", angle="frontal_8",
                    ai_model="gpt-image-2", style_key="s1")
        otros = dict(prompt="una arquera", model="paladin", angle="otro",
                     ai_model="nano-banana", style_key="s2")
        vistas = {self.rg.hero_key(**base)}
        for campo, valor in otros.items():
            k = self.rg.hero_key(**{**base, campo: valor})
            self.assertNotIn(k, vistas, f'cambiar "{campo}" NO cambió la clave del hero')
            vistas.add(k)

    def test_las_dos_claves_no_colisionan(self):
        # Comparten campos: si se derivaran igual, el hero pisaría al sheet.
        self.assertNotEqual(
            self.rg._skin_sheet_key(**self.base),
            self.rg.hero_key(prompt="un herrero", model="y_bot", angle="frontal_8",
                             ai_model="gpt-image-2", style_key="s1"),
        )

    def test_son_hex_de_16(self):
        for k in (self.rg._skin_sheet_key(**self.base),
                  self.rg.hero_key(prompt="p", model="m", angle="a", ai_model="x")):
            self.assertRegex(k, r"^[0-9a-f]{16}$")


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class IndiceDeBasesTest(unittest.TestCase):
    """El índice que sostiene el arte pagado cuando el servicio no está."""

    def setUp(self):
        from routers import remote_generation as rg

        self.rg = rg
        self._tmp = tempfile.TemporaryDirectory()
        self._orig = rg._BASE_KEYS_INDEX
        rg._BASE_KEYS_INDEX = Path(self._tmp.name) / "_base_keys.json"

    def tearDown(self):
        self.rg._BASE_KEYS_INDEX = self._orig
        self._tmp.cleanup()

    def test_sin_fichero_es_un_diccionario_vacio(self):
        self.assertEqual(self.rg._leer_bases(), {})

    def test_guarda_y_recupera(self):
        self.rg._apuntar_base("y_bot/idle/frontal_8", "abc123")
        self.assertEqual(self.rg._leer_bases()["y_bot/idle/frontal_8"], "abc123")

    def test_una_base_nueva_reemplaza_a_la_vieja(self):
        self.rg._apuntar_base("y_bot/idle/frontal_8", "vieja")
        self.rg._apuntar_base("y_bot/idle/frontal_8", "nueva")
        self.assertEqual(self.rg._leer_bases(), {"y_bot/idle/frontal_8": "nueva"})

    def test_un_indice_corrupto_no_tumba_el_endpoint(self):
        # Es contabilidad, no el arte: lo peor que puede pasar es una llamada de
        # más. Reventar aquí dejaría sin personajes por un fichero mal escrito.
        self.rg._BASE_KEYS_INDEX.write_text("{esto no es json")
        self.assertEqual(self.rg._leer_bases(), {})

    def test_conserva_las_otras_hojas(self):
        self.rg._apuntar_base("y_bot/idle/frontal_8", "a")
        self.rg._apuntar_base("y_bot/walk/frontal_8", "b")
        self.assertEqual(len(self.rg._leer_bases()), 2)

    def test_la_escritura_es_atomica_una_muerte_a_medias_no_trunca_el_indice(self):
        # El índice existe para servir arte YA PAGADO con el servicio caído: un
        # write_text directo que muriera a medias lo dejaba truncado (= vacío
        # para _leer_bases) justo en ese escenario. Se escribe a un temporal y
        # se hace os.replace: si morimos antes del replace, la versión previa
        # queda intacta. PROBADO EN NEGATIVO: con el write_text de antes,
        # os.replace no se llama, la escritura "triunfa" y este test se pone
        # rojo (el índice cambió pese al fallo simulado).
        self.rg._apuntar_base("y_bot/idle/frontal_8", "previa")
        with mock.patch("routers.remote_generation.os.replace",
                        side_effect=OSError("muerte simulada entre el temporal y el replace")):
            with self.assertRaises(OSError):
                self.rg._apuntar_base("y_bot/idle/frontal_8", "nueva")
        self.assertEqual(self.rg._leer_bases(), {"y_bot/idle/frontal_8": "previa"})
        # Y el temporal no queda tirado en el directorio.
        restos = [p.name for p in self.rg._BASE_KEYS_INDEX.parent.iterdir()]
        self.assertEqual(restos, ["_base_keys.json"])


@unittest.skipUnless(_HAS_FASTAPI, "fastapi no instalado")
class AdaptadorHttpTest(unittest.TestCase):
    """El flujo entero contra un sprite-forge de mentira que contesta las
    respuestas CANÓNICAS del servicio real (las fixtures de contrato)."""

    def setUp(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from deps import deps
        from routers import remote_generation as rg

        self.rg = rg
        self.forge = ForgeFalso()
        self._tmp = tempfile.TemporaryDirectory()
        raiz = Path(self._tmp.name)

        # Todo lo que el adaptador escribe va al temporal.
        self._orig_dir = rg.SKINNED_SHEETS_DIR
        self._orig_idx = rg._BASE_KEYS_INDEX
        rg.SKINNED_SHEETS_DIR = raiz
        rg._BASE_KEYS_INDEX = raiz / "_base_keys.json"

        self._orig_cfg = dict(deps.config)
        deps.config["sprite_forge_url"] = self.forge.url
        deps.config["sprite_skin_model"] = "gpt-image-2"
        self._orig_packs = deps.style_packs
        deps.style_packs = None  # sin pack: el camino genérico

        self.forge.respuestas["/sheets"] = _fixture("sheets")
        self.forge.respuestas["/identity"] = _fixture("identity")
        self.forge.respuestas["/skins"] = _fixture("skins")
        # La identidad de la hoja base que declara la fixture: las aserciones
        # cuelgan de ella, no de un "BK1" inventado.
        self.base_key = self.forge.respuestas["/sheets"]["sheets"][0]["base_key"]
        self.meta_vestido = self.forge.respuestas["/skins"]["meta"]

        app = FastAPI()
        app.include_router(rg.router)
        self.client = TestClient(app)

    def tearDown(self):
        from deps import deps

        self.forge.parar()
        self.rg.SKINNED_SHEETS_DIR = self._orig_dir
        self.rg._BASE_KEYS_INDEX = self._orig_idx
        deps.config.clear()
        deps.config.update(self._orig_cfg)
        deps.style_packs = self._orig_packs
        self._tmp.cleanup()

    def _pedir(self, **extra):
        cuerpo = {"model": "heroe", "anim": "walk", "angle": "frontal_8",
                  "prompt": "un herrero de pelo cano"}
        cuerpo.update(extra)
        return self.client.post("/skin_sprite_sheet", json=cuerpo)

    # ── el wire ────────────────────────────────────────────────────────────
    def test_devuelve_el_wire_de_siempre(self):
        r = self._pedir()
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(
            sorted(d),
            ["cached", "frame_urls", "generation_time_ms", "hash", "hero_key", "hero_url", "meta", "ok"],
        )
        self.assertEqual(len(d["frame_urls"]), self.meta_vestido["directions"])
        self.assertEqual(len(d["frame_urls"][0]), self.meta_vestido["frame_count"])
        self.assertTrue(d["frame_urls"][0][0].startswith("/cache/sprite_sheet/"))
        self.assertTrue(d["hero_url"].startswith("/cache/sprite_hero/"))
        self.assertFalse(d["cached"])

    def test_escribe_los_frames_y_el_hero_en_disco(self):
        d = self._pedir().json()
        out = self.rg.SKINNED_SHEETS_DIR / d["hash"]
        esperados = self.meta_vestido["directions"] * self.meta_vestido["frame_count"]
        self.assertEqual(len(list(out.glob("*.png"))), esperados)
        self.assertTrue((out / "meta.json").exists())
        self.assertTrue((self.rg.SKINNED_SHEETS_DIR / "heroes" / f"{d['hero_key']}.png").exists())

    def test_la_identidad_de_la_base_queda_escrita_en_el_meta(self):
        # Para poder auditar de qué hoja base salió un sheet vestido. El meta
        # en disco es EXACTAMENTE el de sprite-forge más la base_key inyectada.
        d = self._pedir().json()
        meta = json.loads((self.rg.SKINNED_SHEETS_DIR / d["hash"] / "meta.json").read_text())
        self.assertEqual(meta["skin"]["base_key"], self.base_key)
        esperado = json.loads(json.dumps(self.meta_vestido))
        esperado["skin"]["base_key"] = self.base_key
        self.assertEqual(meta, esperado)

    def test_la_segunda_vez_sale_de_cache_y_NO_se_vuelve_a_pagar(self):
        primera = self._pedir().json()
        self.forge.llamadas.clear()
        segunda = self._pedir().json()
        self.assertTrue(segunda["cached"])
        self.assertEqual(primera["hash"], segunda["hash"])
        self.assertNotIn("/identity", self.forge.rutas_pedidas("POST"))
        self.assertNotIn("/skins", self.forge.rutas_pedidas("POST"))

    def test_el_hero_se_paga_UNA_vez_por_personaje(self):
        self._pedir(anim="walk")
        self.forge.llamadas.clear()
        self._pedir(anim="run")
        self.assertIn("/skins", self.forge.rutas_pedidas("POST"))
        self.assertNotIn("/identity", self.forge.rutas_pedidas("POST"))

    def test_apunta_la_base_en_el_indice(self):
        self._pedir()
        self.assertEqual(self.rg._leer_bases()["heroe/walk/frontal_8"], self.base_key)

    # ── fail-loud ──────────────────────────────────────────────────────────
    #
    # 422 y no 400 (#366): el endpoint era el ÚNICO del ai_server sin
    # `BaseModel` —leía `request.json()` y sacaba seis `str(body.get(...))`—,
    # así que solo dos de los seis campos tenían guarda, y a mano. Los cuatro
    # restantes se convertían en `""` y viajaban: `styel_id` mal escrito era un
    # personaje pintado sin el estilo del juego, sin una queja y ya pagado.
    # El 422 estructurado NOMBRA el campo, que es lo que el 400 a mano no hacía.
    def _malo(self, **cambios):
        cuerpo = {"model": "heroe", "prompt": "x", "angle": "frontal_8"}
        cuerpo.update(cambios)
        for k in [k for k, v in cuerpo.items() if v is None]:
            del cuerpo[k]
        return self.client.post("/skin_sprite_sheet", json=cuerpo)

    def _campos_del_422(self, r):
        return {".".join(str(x) for x in d["loc"][1:]) for d in r.json()["detail"]}

    def test_sin_angle_da_422_nombrandolo(self):
        # El default era el de una vista retirada: una petición sin ángulo
        # cruzaba medio sistema para morir en un 404 sin explicación.
        r = self._malo(angle=None)
        self.assertEqual(r.status_code, 422)
        self.assertIn("angle", self._campos_del_422(r))

    def test_sin_prompt_da_422_nombrandolo(self):
        r = self._malo(prompt=None)
        self.assertEqual(r.status_code, 422)
        self.assertIn("prompt", self._campos_del_422(r))

    def test_sin_model_da_422_nombrandolo(self):
        r = self._malo(model=None)
        self.assertEqual(r.status_code, 422)
        self.assertIn("model", self._campos_del_422(r))

    def test_un_campo_en_BLANCO_tampoco_pasa(self):
        # `"  "` sobrevivía al `if not angle` de antes solo por el `.strip()`
        # que había justo encima; con el modelo, el recorte es del contrato y
        # no de una línea que alguien puede quitar sin darse cuenta.
        for campo in ("model", "prompt", "angle", "anim"):
            with self.subTest(campo=campo):
                r = self._malo(**{campo: "   "})
                self.assertEqual(r.status_code, 422)
                self.assertIn(campo, self._campos_del_422(r))

    def test_el_cuerpo_llega_ya_RECORTADO_al_adaptador(self):
        # El endpoint hacía `.strip()` en los seis campos; ahora lo hace el
        # modelo. Si se perdiera, la clave de caché de " heroe " y "heroe"
        # serían distintas y el mismo personaje se pagaría dos veces.
        r = self._pedir(model="  heroe  ", anim=" walk ")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.rg._leer_bases()["heroe/walk/frontal_8"], self.base_key)

    def test_un_campo_MAL_ESCRITO_ya_no_se_traga(self):
        # Antes: `styel_id` no existía, `style_id` quedaba en `""` y el
        # personaje se pintaba sin el estilo del juego. Sin una queja.
        cuerpo = {"model": "heroe", "prompt": "x", "angle": "frontal_8", "styel_id": "anime"}
        r = self.client.post("/skin_sprite_sheet", json=cuerpo)
        self.assertEqual(r.status_code, 422)
        self.assertIn("styel_id", self._campos_del_422(r))

    def test_un_4xx_del_servicio_sube_tal_cual(self):
        # Es culpa de lo que pedimos: convertirlo en 502 le diría al cliente
        # "se rompió el de arriba" y le haría reintentar en vez de corregir.
        self.forge.fallo = ("/sheets", 422, 'modelo "gandalf" no está en el catálogo')
        r = self._pedir(model="gandalf")
        self.assertEqual(r.status_code, 422)
        self.assertIn("gandalf", r.json()["detail"])

    def test_un_5xx_del_servicio_sale_como_502(self):
        self.forge.fallo = ("/skins", 500, "el proveedor de imagen explotó")
        r = self._pedir()
        self.assertEqual(r.status_code, 502)
        self.assertIn("explotó", r.json()["detail"])

    def test_un_503_del_servicio_se_conserva(self):
        # El cliente ya sabe degradar a la hoja base con un 503.
        self.forge.fallo = ("/skins", 503, "falta la clave de imagen")
        r = self._pedir()
        self.assertEqual(r.status_code, 503)

    def test_si_falla_el_repintado_NO_queda_meta_a_medias(self):
        # meta.json se escribe el ÚLTIMO: su presencia significa "está entero".
        self.forge.fallo = ("/skins", 500, "boom")
        self._pedir()
        self.assertEqual(list(self.rg.SKINNED_SHEETS_DIR.glob("*/meta.json")), [])

    # ── el servicio caído ──────────────────────────────────────────────────
    def test_con_el_servicio_caido_el_arte_pagado_se_sigue_sirviendo(self):
        primera = self._pedir().json()
        self.forge.parar()
        r = self._pedir()
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertTrue(d["cached"])
        self.assertEqual(d["hash"], primera["hash"])
        self.assertEqual(len(d["frame_urls"]), 2)

    def test_con_el_servicio_caido_un_personaje_nuevo_da_503_que_lo_explica(self):
        self._pedir()
        self.forge.parar()
        r = self._pedir(prompt="una arquera que nadie ha pagado")
        self.assertEqual(r.status_code, 503)
        self.assertIn("no está en la caché", r.json()["detail"])

    def test_sin_indice_el_arte_pagado_tampoco_se_alcanza(self):
        # Demuestra que quien salva el caso anterior es el ÍNDICE y no otra cosa.
        self._pedir()
        self.rg._BASE_KEYS_INDEX.unlink()
        self.forge.parar()
        self.assertEqual(self._pedir().status_code, 503)

    def test_el_catalogo_se_reexpone(self):
        self.forge.respuestas["/catalog"] = {"service": "sprite-forge", "animations": []}
        r = self.client.get("/sprite_catalog")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["service"], "sprite-forge")

    def test_el_catalogo_con_el_servicio_caido_da_503_con_la_url(self):
        self.forge.parar()
        r = self.client.get("/sprite_catalog")
        self.assertEqual(r.status_code, 503)
        self.assertIn("no responde", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
