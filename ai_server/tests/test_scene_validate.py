"""Tests de validate_scene_response — fail-loud en la FORMA (espejo de
EmittedSceneSchema) + normalizaciones benignas conservadas.

Antes esta función no tenía tests y degradaba TODO en silencio (grid rellenado,
entities clampadas), así que un error de forma del modelo nunca le volvía. Aquí
se fija el contrato nuevo: lanza ValueError en lo estructural, normaliza lo
benigno, y NUNCA rechaza una escena real (el caso peligroso: rechazar tras el
pre-flight MCP).
"""
import json
import glob
import os
import unittest

from ai_server.narrative_schemas import (
    MAX_VEGETATION_ZONES,
    MAX_VEG_DENSITY,
    NPC_ROLES,
    validate_narrative_reaction,
    validate_scene_response,
)

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENES = os.path.join(REPO, "nefan-core", "data", "scenes")


def base_scene():
    """Format D tiene UNA variante: el tile del mundo continuo. La "suelta"
    (grid propio) murió con el issue #172 y el plató con su vista."""
    return {
        "scene_id": "tile_0_0",
        "scene_description": "una escena de prueba",
        "tile": {"tx": 0, "ty": 0},
        "biome": "grass",
        "entities": [
            {"id": "p", "kind": "player", "name": "Tú", "cell": [1, 1], "footprint": [1, 1], "glyph": "@"}
        ],
    }


def suelta_scene():
    """La variante RETIRADA, perfectamente formada: grid propio, sin tile."""
    return {
        "scene_id": "aldea_suelta",
        "scene_description": "Una aldea sin sitio en el mundo.",
        "size": {"cols": 4, "rows": 2, "meters_per_cell": 2},
        "terrain": ["gggg", "gggg"],
        "entities": [
            {"id": "p", "kind": "player", "name": "Tú", "cell": [1, 1], "footprint": [1, 1], "glyph": "@"}
        ],
    }


def plato_scene():
    """El PLATÓ proscenio: la suelta más su bloque `stage`. Pasaba hasta hoy."""
    s = suelta_scene()
    s["scene_id"] = "posada_salon"
    s["place_id"] = "sala"
    s["stage"] = {
        "exits": [
            {"id": "puerta", "edge": "north", "to_place_id": "cocina",
             "zone": [1, 0, 2, 1], "kind": "door", "label": "Puerta a la cocina"}
        ]
    }
    return s


class TestSceneValidateAcceptsReal(unittest.TestCase):
    def test_real_scenes_do_not_raise(self):
        files = sorted(glob.glob(os.path.join(SCENES, "*.json")))
        for f in files:
            with self.subTest(scene=os.path.basename(f)):
                with open(f) as fh:
                    data = json.load(fh)
                validate_scene_response(dict(data))  # no raise

    def test_base_scene_ok(self):
        out = validate_scene_response(base_scene())
        # El tile NO trae grid: lo sintetiza el engine desde bioma+primitivas.
        self.assertNotIn("terrain", out)
        self.assertEqual(len(out["entities"]), 1)


class TestVariantesRetiradas(unittest.TestCase):
    """CANDADO (espejo de EmittedSceneSchema): Format D tiene UNA forma —el
    tile del mundo continuo—. La "suelta" (grid propio, sin sitio en el plano)
    se retiró con el issue #172 y el PLATÓ proscenio con la vista que lo
    pintaba. El saneador las rechaza con un mensaje que nombra la viva, porque
    ese texto es lo que vuelve al modelo como 422 para re-responder."""

    def test_escena_suelta_impecable_lanza(self):
        with self.assertRaises(ValueError) as cm:
            validate_scene_response(suelta_scene())
        msg = str(cm.exception)
        self.assertIn("tile", msg)
        self.assertIn("generate_tile", msg)

    def test_plato_impecable_lanza(self):
        with self.assertRaises(ValueError) as cm:
            validate_scene_response(plato_scene())
        self.assertIn("tile", str(cm.exception))

    def test_la_variante_viva_sigue_pasando(self):
        validate_scene_response(base_scene())  # tile: no raise

    def test_un_tile_con_stage_lo_descarta_con_traza(self):
        s = base_scene()
        s["stage"] = {"exits": []}
        out = validate_scene_response(s)
        self.assertNotIn("stage", out)

    def test_la_style_ref_de_escena_no_sobrevive(self):
        # Se retiró con el repintado del tile (nadie la consume en primera
        # persona). El rechazo duro vive en el gate zod; aquí, como `stage`,
        # se descarta para que no se persista un campo que ya no existe.
        s = base_scene()
        s["style_ref"] = "settlement"
        self.assertNotIn("style_ref", validate_scene_response(s))


class TestSceneValidateFailLoud(unittest.TestCase):
    def test_tile_without_biome_raises(self):
        with self.assertRaises(ValueError):
            validate_scene_response({"scene_id": "t", "scene_description": "d", "tile": {"tx": 0, "ty": 0}, "entities": []})

    def test_entity_bad_kind_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "monster", "name": "X", "cell": [0, 0], "footprint": [1, 1], "glyph": "x"}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_entity_missing_glyph_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [1, 1]}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)

    def test_entity_bad_footprint_raises(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [0, 1], "glyph": "x"}]
        with self.assertRaises(ValueError):
            validate_scene_response(s)


class TestSceneValidateBenign(unittest.TestCase):
    def test_missing_scene_id_defaults(self):
        s = base_scene()
        del s["scene_id"]
        out = validate_scene_response(s)
        self.assertTrue(out["scene_id"])  # se rellena (benigno)

    def test_glyph_is_kept_verbatim(self):
        # El glyph es del motor y el saneador no lo reescribe: lo que declara
        # es lo que sale, sin sustituciones mudas (#335).
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [0, 0], "footprint": [1, 1], "glyph": "g"}]
        out = validate_scene_response(s)
        self.assertEqual(out["entities"][0]["glyph"], "g")

    def test_cell_out_of_bounds_clamped(self):
        s = base_scene()
        s["entities"] = [{"id": "x", "kind": "prop", "name": "X", "cell": [999, 999], "footprint": [1, 1], "glyph": "x"}]
        out = validate_scene_response(s)
        self.assertLess(out["entities"][0]["cell"][0], 128)  # clampado al grid del tile


if __name__ == "__main__":
    unittest.main()


class TestEntityStyleRefSurvives(unittest.TestCase):
    """`entities[].style_ref` es un campo DECLARADO en generate_scene.json: de
    él sale la clave de caché del skin del NPC. La lista blanca de
    `validate_scene_response` lo tiraba, así que la elección del motor no
    llegaba nunca al cliente y todo NPC caía al rol por defecto ("commoner"),
    generando —y pagando— el skin equivocado."""

    def _npc(self, **extra):
        s = base_scene()
        s["entities"].append(
            {"id": "guardia", "kind": "npc", "name": "Guardia", "cell": [2, 1],
             "footprint": [1, 1], "glyph": "n", **extra}
        )
        return validate_scene_response(s)["entities"][-1]

    def test_style_ref_elegido_por_el_motor_sobrevive(self):
        self.assertEqual(self._npc(style_ref="characters_capitana")["style_ref"], "characters_capitana")

    def test_sin_style_ref_no_se_inventa_la_clave(self):
        self.assertNotIn("style_ref", self._npc())

    def test_style_ref_que_no_es_cadena_util_no_viaja(self):
        # Espejo de formatDToWorld: un no-string o "" no es una elección. Si
        # viajara, el servidor de skins recibiría una ref inexistente.
        for basura in (42, "", None, {"id": "x"}):
            with self.subTest(valor=basura):
                self.assertNotIn("style_ref", self._npc(style_ref=basura))


class TestEntityRolYDescripcionSobreviven(unittest.TestCase):
    """`role` y `description` son los otros DOS campos con los que el motor
    viste y anima a un NPC, y se caían por el MISMO agujero que `style_ref`:
    la lista blanca de `validate_scene_response` no los copiaba. Sin `role`,
    todo NPC de escena resolvía el preset `villager` (deambula y huye) y un
    guardia declarado no se quedaba quieto; sin `description`, el prompt del
    skin era el nombre propio del personaje."""

    def _npc(self, **extra):
        s = base_scene()
        s["entities"].append(
            {"id": "guardia", "kind": "npc", "name": "Guardia Roric", "cell": [2, 1],
             "footprint": [1, 1], "glyph": "n", **extra}
        )
        return validate_scene_response(s)["entities"][-1]

    def test_el_rol_declarado_sobrevive(self):
        self.assertEqual(self._npc(role="guard")["role"], "guard")

    def test_la_descripcion_declarada_sobrevive(self):
        npc = self._npc(description="guardia con lanza y capa parda")
        self.assertEqual(npc["description"], "guardia con lanza y capa parda")

    def test_la_descripcion_de_un_prop_tambien_sobrevive(self):
        # #238: `description` es la PROCEDENCIA de cualquier entity (el texto
        # que se dio al modelo), no un campo de NPC. El saneador la copia para
        # todos los kinds; esto lo deja escrito para que nadie la acote de vuelta.
        s = base_scene()
        s["entities"].append(
            {"id": "pozo", "kind": "prop", "name": "pozo de la plaza", "cell": [2, 1],
             "footprint": [1, 1], "glyph": "o", "description": "pozo de piedra con brocal musgoso"}
        )
        prop = validate_scene_response(s)["entities"][-1]
        self.assertEqual(prop["name"], "pozo de la plaza")
        self.assertEqual(prop["description"], "pozo de piedra con brocal musgoso")

    def test_sin_declararlos_no_se_inventan(self):
        npc = self._npc()
        self.assertNotIn("role", npc)
        self.assertNotIn("description", npc)

    def test_un_rol_inventado_LANZA_nombrando_el_vocabulario(self):
        # Fail-loud al modelo: un oficio en `role` no degrada a villager en
        # silencio — el error dice los valores y dónde va el oficio.
        with self.assertRaises(ValueError) as cm:
            self._npc(role="herrero")
        self.assertIn("herrero", str(cm.exception))
        self.assertIn("guard", str(cm.exception))

    def test_una_descripcion_vacia_LANZA_en_vez_de_caerse(self):
        # Antes se descartaba en silencio y el NPC viajaba SIN prompt de skin,
        # pintado desde su nombre propio. El zod la rechaza (`.trim().min(1)`),
        # así que descartarla aquí era dar dos veredictos al mismo NPC según
        # por dónde entrase (#237): ahora los dos lados lanzan.
        for basura in ("", "   ", 42, None):
            with self.subTest(valor=basura):
                with self.assertRaises(ValueError) as cm:
                    self._npc(description=basura)
                self.assertIn("description", str(cm.exception))

    def test_una_clave_desconocida_LANZA_nombrandola(self):
        # #259: la allow-list era muda — todo lo que no estuviera entre las 12
        # se caía por el desagüe. `health` es del bloque de combate de
        # spawn_entity, no de una entity de escena: vuelve al motor con su
        # nombre y con los 12 campos que sí valen.
        with self.assertRaises(ValueError) as cm:
            self._npc(health=60)
        self.assertIn("health", str(cm.exception))
        self.assertIn("glyph", str(cm.exception))


class TestSpawnEntityLlevaRolYRef(unittest.TestCase):
    """La reconstrucción por allow-list de `validate_narrative_reaction` corre
    en las DOS vías (API directa y MCP) y tiraba `role` y `style_ref`: estaban
    declarados en el zod y consumidos por el cliente, pero no llegaban nunca.
    Vivos de contrato, muertos de datos."""

    def _spawn(self, **extra):
        out = validate_narrative_reaction({
            "consequences": [
                {"type": "spawn_entity", "entity_kind": "npc", "name": "Guardia",
                 "description": "un guardia con yelmo abollado", **extra},
            ],
        })
        return out["consequences"][0]

    # ── name obligatorio, description opcional: el MISMO vocabulario que una
    # entity de escena (entity-vocabulary.ts, #397). Espejo del zod, línea a
    # línea, porque esta reconstrucción corre en las DOS vías.
    def test_sin_name_LANZA_y_dice_que_es_el_rotulo(self):
        with self.assertRaises(ValueError) as cm:
            validate_narrative_reaction({
                "consequences": [
                    {"type": "spawn_entity", "entity_kind": "building",
                     "description": "forja de piedra ennegrecida"},
                ],
            })
        self.assertIn("name", str(cm.exception))
        # La misma frase que el zod (MOTIVO_NAME_INVALIDO, entity-vocabulary.ts).
        self.assertIn("es el rótulo que lee el jugador", str(cm.exception))

    def test_name_en_blanco_LANZA(self):
        with self.assertRaises(ValueError) as cm:
            self._spawn(name="   ")
        self.assertIn("name", str(cm.exception))
        self.assertIn("es el rótulo que lee el jugador", str(cm.exception))

    def test_sin_description_pasa_y_NO_se_inventa(self):
        out = validate_narrative_reaction({
            "consequences": [
                {"type": "spawn_entity", "entity_kind": "npc", "name": "Mochuelo"},
            ],
        })
        c = out["consequences"][0]
        self.assertEqual(c["name"], "Mochuelo")
        self.assertNotIn("description", c)

    def test_description_en_blanco_LANZA_en_vez_de_colarse(self):
        with self.assertRaises(ValueError) as cm:
            self._spawn(description="   ")
        self.assertIn("description", str(cm.exception))

    def test_description_viaja_verbatim(self):
        c = self._spawn(description="  posadera de manos grandes  ")
        # Sin `.strip()`: el schema no reescribe lo que valida (como el zod).
        self.assertEqual(c["description"], "  posadera de manos grandes  ")

    def test_rol_y_ref_llegan_hasta_la_consequence(self):
        c = self._spawn(role="guard", style_ref="characters_capitana")
        self.assertEqual(c["role"], "guard")
        self.assertEqual(c["style_ref"], "characters_capitana")

    def test_sin_declararlos_no_se_inventan(self):
        c = self._spawn()
        self.assertNotIn("role", c)
        self.assertNotIn("style_ref", c)

    def test_un_rol_inventado_LANZA(self):
        with self.assertRaises(ValueError) as cm:
            self._spawn(role="herrero")
        self.assertIn("herrero", str(cm.exception))

    def test_el_vocabulario_es_el_MISMO_que_el_de_una_entity_de_escena(self):
        # Un NPC no puede declarar su conducta con un vocabulario en
        # generate_scene y con otro en spawn_entity: es el fallo que esta
        # tanda cierra, y lo que parecería arbitrario en un mes.
        for role in sorted(NPC_ROLES):
            with self.subTest(role=role):
                self.assertEqual(self._spawn(role=role)["role"], role)


class TestVegetationZonesEspejoDelZod(unittest.TestCase):
    """`vegetation_zones.density` cambió de unidad y de rango en la tanda del
    bosque: son EJEMPLARES POR m² con tope MAX_VEG_DENSITY. Hasta entonces este
    saneador solo comprobaba que fuera un número —un `density: 2` pasaba
    entero— mientras el bloque de scatter de al lado sí validaba su rango:
    mismo nombre, dos unidades, y una de las dos rutas sin puerta."""

    def zona(self, **over):
        z = {"type": "pino", "area": "rest", "density": 0.05}
        z.update(over)
        s = base_scene()
        s["vegetation_zones"] = [z]
        return validate_scene_response(s).get("vegetation_zones", [])

    def test_una_densidad_del_rango_sobrevive(self):
        self.assertEqual(len(self.zona(density=MAX_VEG_DENSITY)), 1)
        self.assertEqual(len(self.zona(density=0.01)), 1)

    def test_una_densidad_fuera_de_rango_se_descarta(self):
        # 0.5 era «la mitad de las celdas» con la unidad vieja: leído como
        # ejemplares/m² serían 2.048 árboles en un tile.
        self.assertEqual(self.zona(density=0.5), [])
        self.assertEqual(self.zona(density=2), [])
        self.assertEqual(self.zona(density=0), [])
        self.assertEqual(self.zona(density="mucha"), [])

    def test_el_tope_es_el_MISMO_que_el_de_nefan_core(self):
        # Si el espejo se queda atrás, el saneador acepta lo que el gate del
        # MCP rebota (o al revés) y el motor recibe dos respuestas distintas
        # a la misma escena.
        veg = os.path.join(REPO, "nefan-core", "src", "scene", "blueprint", "vegetation.ts")
        with open(veg, encoding="utf-8") as f:
            fuente = f.read()
        # El tope se DERIVA en TS; aquí se comprueba contra la prosa del
        # contrato, que es lo que ambos procesos prometen.
        tool = os.path.join(REPO, "nefan-core", "data", "contract", "tools", "generate_scene.json")
        with open(tool, encoding="utf-8") as f:
            desc = json.load(f)["input_schema"]["properties"]["vegetation_zones"]["description"]
        self.assertIn(f"(0, {MAX_VEG_DENSITY}]", desc)
        self.assertIn("MAX_VEG_DENSITY", fuente)

    def test_mas_de_ocho_zonas_se_recortan(self):
        s = base_scene()
        s["vegetation_zones"] = [
            {"type": f"pino_{i}", "area": "rest", "density": 0.02} for i in range(12)
        ]
        self.assertEqual(len(validate_scene_response(s)["vegetation_zones"]), MAX_VEGETATION_ZONES)
