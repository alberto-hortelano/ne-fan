"""Candado anti-divergencia del contrato de subida de estilos (lado Python).

La MISMA tabla de casos que `nefan-core/test/style-upload.test.ts` corre aquí
contra `validar_subida`: si alguien endurece o relaja un lado sin el otro, uno
de los dos suites rompe en CI en vez de divergir en silencio — que es
exactamente lo que pasaba hasta la PR 7 de #241, cuando el título comprobaba
cuatro cosas con sus textos y este proceso ocho con los suyos y sus números
escritos a mano.

Aquí no se comprueba solo el veredicto: se comprueba el MOTIVO, porque el motivo
es lo que lee el jugador (el título lo enseña antes de subir y este proceso lo
devuelve como `detail` del 422). Y ninguno de los dos se escribe en este fichero:
salen del snapshot `data/contract/style-upload.json`, que es la fuente única.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from routers.styles import (  # noqa: E402
    StyleUploadImage,
    StyleUploadRequest,
    _motivo,
    _ref,
    validar_subida,
)
from style_packs import LAMINA, REF_FOLDERS, STYLE_UPLOAD  # noqa: E402

B64 = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
LIM = STYLE_UPLOAD["limites"]


def cara(description="una fachada de piedra", **extra):
    return StyleUploadImage(folder="faces", description=description, image_b64=B64, **extra)


def lamina():
    return StyleUploadImage(folder=LAMINA, description="", image_b64=B64)


def subida(**parche):
    base = {"name": "Tinta y pergamino", "tags": ["medieval"], "images": [cara()]}
    base.update(parche)
    return StyleUploadRequest(**base)


class StyleUploadContractTest(unittest.TestCase):
    def test_el_snapshot_es_la_fuente(self):
        """Los números y las carpetas NO están escritos en styles.py."""
        self.assertEqual(tuple(STYLE_UPLOAD["carpetas"]), REF_FOLDERS)
        self.assertIn(LAMINA, REF_FOLDERS)
        for clave in ("nombre", "tags", "imagenes"):
            self.assertIn("min", LIM[clave])
            self.assertIn("max", LIM[clave])

    def test_el_caso_minimo_pasa(self):
        tags, ref_ids = validar_subida(subida())
        self.assertEqual(tags, ["medieval"])
        self.assertEqual(ref_ids, ["una_fachada_de_piedra"])

    def test_la_lamina_es_la_unica_que_puede_ir_sin_descripcion(self):
        validar_subida(subida(images=[lamina()]))
        with self.assertRaises(HTTPException):
            validar_subida(subida(images=[cara("")]))

    def test_las_tres_carpetas_valen_y_solo_esas(self):
        for folder in REF_FOLDERS:
            img = StyleUploadImage(folder=folder, description="algo", image_b64=B64)
            validar_subida(subida(images=[img]))
        with self.assertRaises(HTTPException) as ctx:
            validar_subida(
                subida(images=[StyleUploadImage(folder="stage_wide", description="a", image_b64=B64)])
            )
        self.assertEqual(ctx.exception.detail, _motivo("carpeta", _ref(0, "")))

    def test_normaliza_las_etiquetas(self):
        tags, _ = validar_subida(subida(tags=["  medieval  ", "", "   ", "oscuro"]))
        self.assertEqual(tags, ["medieval", "oscuro"])

    def test_los_limites_justos_pasan(self):
        validar_subida(subida(name="ab"))
        validar_subida(subida(name="a" * LIM["nombre"]["max"]))
        validar_subida(subida(tags=[str(i) for i in range(LIM["tags"]["max"])]))
        # Descripciones DISTINTAS: el id se deriva de la descripción, así que
        # doce iguales serían doce ids duplicados (lo que ya pasaba antes de
        # esta PR, y que el título no puede ver porque no deriva ids).
        validar_subida(
            subida(images=[cara(f"fachada {i}") for i in range(LIM["imagenes"]["max"])])
        )
        validar_subida(subida(description="a" * LIM["descripcion_del_pack_max"]))
        validar_subida(subida(images=[cara("a" * LIM["descripcion_de_imagen_max"])]))

    def test_cada_rechazo_con_su_motivo(self):
        """La tabla espejo de style-upload.test.ts, en el mismo orden."""
        casos = [
            ("sin nombre", subida(name=""), _motivo("nombre_corto")),
            ("nombre de 1", subida(name="a"), _motivo("nombre_corto")),
            ("nombre de solo espacios", subida(name="        "), _motivo("nombre_corto")),
            (
                "nombre de max+1",
                subida(name="a" * (LIM["nombre"]["max"] + 1)),
                _motivo("nombre_largo"),
            ),
            (
                "descripcion del pack de max+1",
                subida(description="a" * (LIM["descripcion_del_pack_max"] + 1)),
                _motivo("descripcion_del_pack"),
            ),
            (
                "style_token de max+1",
                subida(style_token="a" * (LIM["style_token_max"] + 1)),
                _motivo("style_token"),
            ),
            ("sin etiquetas", subida(tags=[]), _motivo("sin_etiquetas")),
            ("etiquetas en blanco", subida(tags=["  ", ""]), _motivo("sin_etiquetas")),
            (
                "max+1 etiquetas",
                subida(tags=[str(i) for i in range(LIM["tags"]["max"] + 1)]),
                _motivo("demasiadas_etiquetas"),
            ),
            ("sin imagenes", subida(images=[]), _motivo("sin_imagenes")),
            (
                "max+1 imagenes",
                subida(images=[cara(f"fachada {i}") for i in range(LIM["imagenes"]["max"] + 1)]),
                _motivo("demasiadas_imagenes"),
            ),
            (
                "dos laminas",
                subida(images=[lamina(), lamina()]),
                _motivo("mas_de_una_lamina"),
            ),
            (
                "una cara sin descripcion",
                subida(images=[lamina(), cara("")]),
                _motivo("sin_descripcion", _ref(1, "")),
            ),
            (
                "imagen vacia",
                subida(images=[StyleUploadImage(folder="faces", description="a", image_b64="")]),
                _motivo("imagen_vacia", _ref(0, "")),
            ),
            (
                "descripcion de imagen de max+1",
                subida(images=[cara("a" * (LIM["descripcion_de_imagen_max"] + 1))]),
                _motivo("descripcion_de_imagen", _ref(0, "")),
            ),
            (
                "id con barra",
                subida(images=[cara(id="con/barra")]),
                _motivo("id_invalido", "con/barra"),
            ),
            (
                "id de max+1",
                subida(images=[cara(id="a" * (LIM["ref_id_max"] + 1))]),
                _motivo("id_invalido", "a" * (LIM["ref_id_max"] + 1)),
            ),
            (
                "dos ids iguales",
                subida(images=[cara(id="fachada"), cara(id="fachada")]),
                _motivo("id_duplicado", "fachada"),
            ),
        ]
        for nombre, cuerpo, motivo in casos:
            with self.subTest(nombre):
                with self.assertRaises(HTTPException) as ctx:
                    validar_subida(cuerpo)
                self.assertEqual(ctx.exception.status_code, 422)
                self.assertEqual(ctx.exception.detail, motivo)

    def test_el_id_derivado_tambien_se_comprueba(self):
        """Lo que este proceso puede ver y el título no: dos imágenes sin id
        cuya descripción da el MISMO slug. El cliente no deriva ids, así que
        este caso solo lo caza aquí — y con el motivo compartido, que es lo que
        el título acabará enseñando cuando llegue el 422."""
        with self.assertRaises(HTTPException) as ctx:
            validar_subida(subida(images=[cara("Una fachada"), cara("una  fachada")]))
        self.assertEqual(ctx.exception.detail, _motivo("id_duplicado", "una_fachada"))

    def test_el_primer_motivo_es_el_mismo_orden_que_el_zod(self):
        with self.assertRaises(HTTPException) as ctx:
            validar_subida(subida(name="", tags=[], images=[]))
        self.assertEqual(ctx.exception.detail, _motivo("nombre_corto"))


if __name__ == "__main__":
    unittest.main()
