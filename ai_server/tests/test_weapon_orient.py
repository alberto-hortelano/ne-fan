"""Tests de validate_weapon_orient_response — fail-loud con causa precisa.

Antes la función devolvía None en 6 puntos sin traza: el caller solo podía
loguear "failed validation" sin saber qué campo rompió. Ahora lanza ValueError
con el motivo (patrón validate_narrative_reaction); las normalizaciones
benignas (clamp de grip, unit vectors, defaults) se conservan.
"""
import unittest

from ai_server.narrative_schemas import validate_weapon_orient_response


def valid_payload() -> dict:
    return {
        "grip_point_normalized": [0.5, 0.1, 0.5],
        "blade_direction": [0, 2, 0],
        "up_direction": [0, 0, 1],
        "confidence": 0.9,
    }


class TestWeaponOrientValidation(unittest.TestCase):
    def test_valid_normalizes(self):
        out = validate_weapon_orient_response(valid_payload())
        self.assertEqual(out["blade_direction"], [0.0, 1.0, 0.0])
        self.assertEqual(out["up_direction"], [0.0, 0.0, 1.0])
        self.assertEqual(out["weapon_type"], "generic")
        self.assertEqual(out["grip_length_normalized"], 0.15)
        self.assertEqual(out["confidence"], 0.9)

    def test_grip_clamped_and_confidence_defaults(self):
        p = valid_payload()
        p["grip_point_normalized"] = [-0.5, 2.0, 0.5]
        p["confidence"] = "not-a-number"
        out = validate_weapon_orient_response(p)
        self.assertEqual(out["grip_point_normalized"], [0.0, 1.0, 0.5])
        self.assertEqual(out["confidence"], 0.5)

    def test_non_dict_raises_with_type(self):
        with self.assertRaisesRegex(ValueError, r"must be an object, got list"):
            validate_weapon_orient_response([1, 2, 3])

    def test_missing_field_names_the_field(self):
        p = valid_payload()
        del p["up_direction"]
        with self.assertRaisesRegex(ValueError, r"up_direction must be a list of 3"):
            validate_weapon_orient_response(p)

    def test_wrong_arity_names_the_field(self):
        p = valid_payload()
        p["blade_direction"] = [1, 0]
        with self.assertRaisesRegex(ValueError, r"blade_direction must be a list of 3"):
            validate_weapon_orient_response(p)

    def test_non_numeric_names_the_field(self):
        p = valid_payload()
        p["grip_point_normalized"] = [0.5, "alto", 0.5]
        with self.assertRaisesRegex(
            ValueError, r"grip_point_normalized contains non-numeric"
        ):
            validate_weapon_orient_response(p)

    def test_zero_length_vector(self):
        p = valid_payload()
        p["blade_direction"] = [0, 0, 0]
        with self.assertRaisesRegex(ValueError, r"blade_direction has ~zero length"):
            validate_weapon_orient_response(p)

    def test_degenerate_parallel_frame(self):
        p = valid_payload()
        p["up_direction"] = [0, -1.99, 0]  # antiparalelo al blade → |dot| = 1
        with self.assertRaisesRegex(ValueError, r"nearly parallel"):
            validate_weapon_orient_response(p)


if __name__ == "__main__":
    unittest.main()
