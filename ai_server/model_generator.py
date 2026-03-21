"""3D model generator: SD 1.5 reference image → rembg → textured GLB via trimesh.

Phase 4 v1: Creates textured meshes from AI reference images.
Can be upgraded to SF3D when CUDA toolkit is installed (nvcc needed for custom kernels).
"""

import io
import time

import numpy as np
import trimesh
from PIL import Image


class ModelGenerator:
    def __init__(self, texture_gen_ref=None, device: str = "cuda", lazy: bool = True):
        """
        Args:
            texture_gen_ref: Reference to TextureGenerator (for SD 1.5 reference image generation).
            device: CUDA device.
            lazy: If True, rembg session loaded on first use.
        """
        self.texture_gen_ref = texture_gen_ref
        self.device = device
        self._rembg_session = None
        self._loaded = False

        if not lazy:
            self._load()

    def _load(self) -> None:
        if self._loaded:
            return
        from rembg import new_session
        print("ModelGen: Loading rembg session...")
        self._rembg_session = new_session("u2net")
        self._loaded = True
        print("ModelGen: Ready")

    def generate(self, prompt: str, scale: list = None, seed: int = -1) -> bytes:
        """Generate a GLB model from a text prompt.

        Returns GLB binary data.
        """
        if scale is None:
            scale = [0.5, 0.5, 0.5]

        self._load()
        start = time.perf_counter()

        # Step 1: Generate reference image using SD 1.5
        ref_image = self._generate_reference_image(prompt, seed)

        # Step 2: Remove background
        ref_rgba = self._remove_background(ref_image)

        # Step 3: Create textured 3D mesh
        glb_bytes = self._create_textured_mesh(ref_rgba, scale)

        elapsed = time.perf_counter() - start
        print(f"ModelGen: '{prompt[:50]}...' -> {elapsed:.2f}s")
        return glb_bytes

    def _generate_reference_image(self, prompt: str, seed: int) -> Image.Image:
        """Generate a reference image using the existing SD 1.5 pipeline."""
        if self.texture_gen_ref is None or self.texture_gen_ref.pipe is None:
            # Fallback: create a simple colored placeholder
            return Image.new("RGB", (512, 512), color=(128, 100, 80))

        import torch

        self.texture_gen_ref._load_pipeline()

        full_prompt = (
            f"isolated 3D object on pure white background, studio lighting, "
            f"no shadows, centered, {prompt}"
        )

        generator = None
        if seed >= 0:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        with torch.no_grad():
            # Temporarily disable circular padding for reference images
            result = self.texture_gen_ref.pipe(
                prompt=full_prompt,
                num_inference_steps=self.texture_gen_ref.steps,
                guidance_scale=1.0,
                width=512,
                height=512,
                generator=generator,
            ).images[0]

        return result

    def _remove_background(self, image: Image.Image) -> Image.Image:
        """Remove background using rembg, return RGBA image."""
        from rembg import remove
        rgba = remove(image, session=self._rembg_session)
        return rgba

    def _create_textured_mesh(self, image: Image.Image, scale: list) -> bytes:
        """Create a textured box mesh with the reference image applied to faces."""
        sx, sy, sz = float(scale[0]), float(scale[1]), float(scale[2])

        # Create a box mesh with correct proportions
        box = trimesh.creation.box(extents=[sx, sy, sz])

        # Create UV mapping for the box
        # trimesh box already has UVs, but let's make sure the texture maps well
        # Apply the reference image as texture material
        img_array = np.array(image.convert("RGBA"))

        # Create a PBR material with the reference image
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=Image.fromarray(img_array),
            metallicFactor=0.0,
            roughnessFactor=0.7,
        )

        # Apply UV-mapped visual
        # For a box, we need to create proper UV coordinates
        # trimesh's box comes with face colors, not UV. Let's create UV-textured visual.
        uv = _compute_box_uvs(box)
        color_visual = trimesh.visual.TextureVisuals(uv=uv, material=material)
        box.visual = color_visual

        # Export to GLB
        glb_bytes = box.export(file_type="glb")
        return glb_bytes

    @property
    def is_loaded(self) -> bool:
        return self._loaded


def _compute_box_uvs(box_mesh: trimesh.Trimesh) -> np.ndarray:
    """Compute UV coordinates for a box mesh (project each face)."""
    vertices = box_mesh.vertices
    faces = box_mesh.faces
    normals = box_mesh.face_normals

    # For each vertex, compute UV based on position
    uvs = np.zeros((len(vertices), 2), dtype=np.float64)

    for i, vert in enumerate(vertices):
        # Simple planar projection: use X,Y normalized to [0,1]
        extents = box_mesh.extents
        if extents[0] > 0 and extents[2] > 0:
            uvs[i, 0] = (vert[0] - box_mesh.bounds[0][0]) / extents[0]
            uvs[i, 1] = (vert[1] - box_mesh.bounds[0][1]) / extents[1]

    return uvs
