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
    atlas_layout,
    compose_atlas,
    keyframe_indices,
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

    def test_profiles_fit_v4_atlas_limit(self):
        # Lección de skinning_lab: el atlas V4 colapsa con >10 frames. Ningún
        # perfil debe superarlo.
        for anim, (n_kf, _fps) in ANIM_PROFILES.items():
            self.assertLessEqual(n_kf, 10, f"perfil de {anim} supera el límite V4")


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
            for frame, color in zip(frames, colors):
                self.assertEqual(frame.getpixel((16, 16)), color)

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
