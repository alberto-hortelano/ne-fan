"""Tests de los helpers de atlas del skin de sprites vía Meshy.

Ejecutar con: python3 -m unittest discover -s ai_server/tests -v
(sin llamadas a la API — solo la geometría keyframes/atlas, que es lo que
garantiza que los frames devueltos por Meshy se recortan alineados)."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image  # noqa: E402

from sprite_skin_meshy import (  # noqa: E402
    ANIM_PROFILES,
    ATLAS_ECHO_THRESHOLD,
    ATLAS_MAX_CELLS,
    atlas_echo_score,
    atlas_layout,
    build_atlas_prompt,
    compose_atlas,
    compose_grid_atlas,
    fit_atlas_output,
    keyframe_indices,
    plan_dir_batches,
    split_atlas,
)


class KeyframeIndicesTest(unittest.TestCase):
    def test_uniform_coverage_without_duplicates(self):
        idx = keyframe_indices(44, 8)  # idle y_bot
        self.assertEqual(len(idx), 8)
        self.assertEqual(idx, sorted(set(idx)))
        self.assertEqual(idx[0], 0)
        self.assertLess(idx[-1], 44)

    def test_more_keyframes_than_frames_collapses(self):
        idx = keyframe_indices(3, 8)
        self.assertEqual(idx, [0, 1, 2])

    def test_empty_inputs(self):
        self.assertEqual(keyframe_indices(0, 4), [])
        self.assertEqual(keyframe_indices(10, 0), [])

    def test_profiles_fit_atlas_limit(self):
        # Lección de labs/skinning: el atlas colapsa con >ATLAS_MAX_CELLS
        # frames. Ningún perfil debe superarlo (cada lote lleva al menos una
        # fila completa de keyframes).
        for anim, (n_kf, _fps) in ANIM_PROFILES.items():
            self.assertLessEqual(n_kf, ATLAS_MAX_CELLS, f"perfil de {anim} supera el límite")


class PlanDirBatchesTest(unittest.TestCase):
    def test_covers_all_directions_without_duplicates(self):
        for n_kf in range(1, 11):
            batches = plan_dir_batches(8, n_kf)
            flat = [d for b in batches for d in b]
            self.assertEqual(flat, list(range(8)), f"kf={n_kf}")

    def test_no_batch_exceeds_max_cells(self):
        for n_kf in range(1, 11):
            for batch in plan_dir_batches(8, n_kf):
                cells = len(batch) * n_kf
                if len(batch) > 1:
                    self.assertLessEqual(cells, ATLAS_MAX_CELLS, f"kf={n_kf}")

    def test_expected_batch_counts_for_profiles(self):
        # walk/run (4 kf): 2 dirs por atlas → 4 llamadas; quick (3 kf): 3 →
        # 3 llamadas; idle (8 kf): 1 → 8 llamadas (plan clásico).
        self.assertEqual(len(plan_dir_batches(8, 4)), 4)
        self.assertEqual(len(plan_dir_batches(8, 3)), 3)
        self.assertEqual(len(plan_dir_batches(8, 8)), 8)

    def test_aspect_cap_on_tiny_keyframe_counts(self):
        # defensive (2 kf): sin tope de filas saldría 2x5 (aspecto extremo);
        # el factor 2·kf lo limita a 2x4.
        batches = plan_dir_batches(8, 2)
        self.assertTrue(all(len(b) <= 4 for b in batches))
        self.assertEqual(len(batches), 2)

    def test_single_direction_degenerates_to_classic_plan(self):
        self.assertEqual(plan_dir_batches(1, 8), [[0]])

    def test_invalid_inputs_raise(self):
        with self.assertRaises(ValueError):
            plan_dir_batches(0, 4)
        with self.assertRaises(ValueError):
            plan_dir_batches(8, 0)


class AtlasPromptTest(unittest.TestCase):
    def test_pose_lock_always_present(self):
        # La T-pose de 2026-08-18: sin pose-lock el modelo convierte el atlas
        # de idle en una hoja de turnaround. La cláusula es innegociable.
        for multi in (False, True):
            p = build_atlas_prompt("un herrero", (4, 2), multi_dir=multi)
            self.assertIn("EXACT body pose", p)
            self.assertIn("ignore its pose", p)
            self.assertIn("4x2 grid", p)

    def test_direction_clause_only_multi_dir(self):
        self.assertIn("viewing direction", build_atlas_prompt("x", (4, 2), multi_dir=True))
        self.assertNotIn("viewing direction", build_atlas_prompt("x", (4, 1), multi_dir=False))


class AtlasEchoScoreTest(unittest.TestCase):
    def test_identical_atlas_is_echo(self):
        clay = Image.new("RGBA", (256, 128), (90, 200, 220, 255))
        self.assertLess(atlas_echo_score(clay, clay.copy()), ATLAS_ECHO_THRESHOLD)

    def test_repainted_atlas_is_not_echo(self):
        clay = Image.new("RGBA", (256, 128), (90, 200, 220, 255))
        skinned = Image.new("RGBA", (256, 128), (120, 90, 60, 255))
        self.assertGreater(atlas_echo_score(clay, skinned), ATLAS_ECHO_THRESHOLD)

    def test_minor_noise_still_counts_as_echo(self):
        # Un "repintado" que solo cambia texturas sutiles sobre el mismo clay
        # sigue sin ser un skin.
        import random
        rng = random.Random(7)
        clay = Image.new("RGBA", (64, 64), (90, 200, 220, 255))
        noisy = clay.copy()
        px = noisy.load()
        for _ in range(200):
            x, y = rng.randrange(64), rng.randrange(64)
            px[x, y] = (95, 195, 215, 255)
        self.assertLess(atlas_echo_score(clay, noisy), ATLAS_ECHO_THRESHOLD)


class AtlasLayoutTest(unittest.TestCase):
    def test_landscape_grids(self):
        self.assertEqual(atlas_layout(4), (2, 2))
        self.assertEqual(atlas_layout(8), (3, 3))
        self.assertEqual(atlas_layout(2), (2, 1))
        self.assertEqual(atlas_layout(3), (2, 2))
        cols, rows = atlas_layout(6)
        self.assertGreaterEqual(cols, rows)
        self.assertGreaterEqual(cols * rows, 6)


class AtlasRoundtripTest(unittest.TestCase):
    def test_compose_then_split_recovers_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            colors = [(255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255), (255, 255, 0, 255)]
            for i, color in enumerate(colors):
                p = Path(tmp) / f"dir_0_frame_{i:03d}.png"
                Image.new("RGBA", (32, 32), color).save(p)
                paths.append(p)

            atlas, layout, frame_size = compose_atlas(paths)
            self.assertEqual(frame_size, (32, 32))
            self.assertEqual(atlas.size, (layout[0] * 32, layout[1] * 32))

            frames = split_atlas(atlas, layout, len(paths), frame_size)
            self.assertEqual(len(frames), len(paths))
            for frame, color in zip(frames, colors, strict=True):
                self.assertEqual(frame.getpixel((16, 16)), color)

    def test_grid_compose_then_split_recovers_rows(self):
        # Atlas multi-dirección: fila = dirección. El split row-major debe
        # devolver cada celda en su (dir, frame).
        with tempfile.TemporaryDirectory() as tmp:
            rows_of_paths = []
            colors = {}
            for d in range(2):
                row = []
                for c in range(4):
                    color = (40 * d + 10, 30 * c + 10, 200, 255)
                    p = Path(tmp) / f"dir_{d}_frame_{c:03d}.png"
                    Image.new("RGBA", (32, 32), color).save(p)
                    row.append(p)
                    colors[(d, c)] = color
                rows_of_paths.append(row)

            atlas, layout, frame_size = compose_grid_atlas(rows_of_paths)
            self.assertEqual(layout, (4, 2))
            self.assertEqual(atlas.size, (4 * 32, 2 * 32))
            frames = split_atlas(atlas, layout, 8, frame_size)
            for d in range(2):
                for c in range(4):
                    self.assertEqual(frames[d * 4 + c].getpixel((16, 16)), colors[(d, c)])

    def test_grid_rejects_uneven_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.png"
            Image.new("RGBA", (8, 8), (1, 2, 3, 255)).save(p)
            with self.assertRaises(ValueError):
                compose_grid_atlas([[p, p], [p]])

    def test_fit_atlas_output_unpacks_letterboxed_square(self):
        # gpt-image-2 devuelve lienzo cuadrado: un grid 4x2 llega centrado con
        # bandas de fondo. fit_atlas_output debe recuperar el contenido sin
        # aplastarlo.
        content = Image.new("RGB", (400, 200), (200, 50, 50))
        canvas = Image.new("RGB", (512, 512), (30, 30, 30))
        canvas.paste(content, (56, 156))
        fitted = fit_atlas_output(canvas.convert("RGBA"), (1024, 512))
        self.assertEqual(fitted.size, (1024, 512))
        r, g, b = fitted.convert("RGB").getpixel((512, 256))[:3]
        self.assertGreater(r, 150, "el centro debe ser contenido, no fondo")

    def test_fit_atlas_output_matching_aspect_resizes_directly(self):
        atlas = Image.new("RGBA", (200, 100), (5, 5, 5, 255))
        fitted = fit_atlas_output(atlas, (400, 200))
        self.assertEqual(fitted.size, (400, 200))

    def test_split_resizes_offsized_atlas(self):
        # Meshy no respeta el tamaño exacto del input: un atlas devuelto a
        # otra resolución debe reescalarse al grid esperado antes de cortar.
        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for i in range(4):
                p = Path(tmp) / f"f{i}.png"
                Image.new("RGBA", (32, 32), (10 * i, 0, 0, 255)).save(p)
                paths.append(p)
            atlas, layout, frame_size = compose_atlas(paths)
            bigger = atlas.resize((atlas.width * 2, atlas.height * 2), Image.NEAREST)
            frames = split_atlas(bigger, layout, 4, frame_size)
            self.assertEqual(len(frames), 4)
            self.assertEqual(frames[0].size, (32, 32))


if __name__ == "__main__":
    unittest.main()
