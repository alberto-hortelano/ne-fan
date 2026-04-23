"""3D model generator: SD 1.5 reference image → TripoSG → simplified GLB.

Uses TripoSG (VAST-AI) for image-to-3D generation with ~5000 face meshes.
Falls back to textured box via trimesh if TripoSG is not available.
TripoSG repo: vendor/triposg (or set TRIPOSG_PATH env).
"""

import io
import os
import sys
import time

import numpy as np
import trimesh
from PIL import Image


# Add TripoSG to path
_default_triposg = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor", "triposg")
_triposg_path = os.environ.get("TRIPOSG_PATH", _default_triposg)
if _triposg_path not in sys.path:
    sys.path.insert(0, _triposg_path)


class ModelGenerator:
    def __init__(self, texture_gen_ref=None, device: str = "cuda", lazy: bool = True):
        self.texture_gen_ref = texture_gen_ref
        self.device = device
        self._pipe = None
        self._loaded = False
        self._triposg_available = False
        self._target_faces = 5000

        # Try to use Meshy API as preferred backend
        self._meshy = None
        if os.environ.get("MESHY_API_KEY"):
            try:
                from meshy_client import MeshyClient
                self._meshy = MeshyClient()
                print("ModelGen: Meshy API backend ready")
            except Exception as e:
                print(f"ModelGen: Meshy not available ({e})")

        if not lazy:
            self._load()

    def _load(self) -> None:
        if self._loaded:
            return
        try:
            from triposg.pipelines.pipeline_triposg import TripoSGPipeline
            import torch
            from huggingface_hub import snapshot_download

            weights_dir = os.path.expanduser("~/.cache/triposg/TripoSG")
            if not os.path.exists(os.path.join(weights_dir, "config.json")):
                print("ModelGen: Downloading TripoSG weights...")
                snapshot_download(repo_id="VAST-AI/TripoSG", local_dir=weights_dir)

            print("ModelGen: Loading TripoSG pipeline...")
            self._pipe = TripoSGPipeline.from_pretrained(weights_dir)
            self._pipe.to(self.device, torch.float16)
            self._triposg_available = True
            print("ModelGen: TripoSG ready")
        except Exception as e:
            print(f"ModelGen: TripoSG not available ({e}), using trimesh fallback")
            self._triposg_available = False

        self._loaded = True

    def generate(self, prompt: str, scale: list = None, seed: int = -1,
                 quality: str = "normal") -> bytes:
        """Generate a GLB model from a text prompt. Returns GLB binary data.

        Uses Meshy API if MESHY_API_KEY is set; falls back to local TripoSG.
        """
        if scale is None:
            scale = [0.5, 0.5, 0.5]

        start = time.perf_counter()

        # Preferred backend: Meshy API
        if self._meshy is not None:
            target_polycount = 5000 if quality == "normal" else 2000
            try:
                glb_bytes = self._meshy.text_to_3d(
                    prompt=prompt,
                    art_style="realistic",
                    topology="triangle",
                    target_polycount=target_polycount,
                )
                elapsed = time.perf_counter() - start
                print(f"ModelGen[meshy]: '{prompt[:50]}' -> {elapsed:.1f}s")
                return glb_bytes
            except Exception as e:
                print(f"ModelGen: Meshy failed ({e}), falling back to TripoSG")

        # Fallback: local TripoSG pipeline
        self._load()

        # Step 1: Generate reference image using SD 1.5 (circular padding OFF)
        ref_image = self._generate_reference_image(prompt, seed)

        if self._triposg_available:
            # Step 2: TripoSG image-to-3D (swaps GPU: SD→CPU, TripoSG→GPU, then restores SD→GPU)
            mesh = self._generate_triposg(ref_image, scale, seed, quality)
            # Step 3: Generate PBR material texture (SD 1.5 back on GPU with circular padding)
            mesh = self._apply_texture(mesh, prompt)
            glb_bytes = mesh.export(file_type="glb")
        else:
            # Fallback: textured box
            glb_bytes = self._generate_textured_box(ref_image, scale)

        elapsed = time.perf_counter() - start
        print(f"ModelGen[local]: '{prompt[:50]}' -> {elapsed:.1f}s")
        return glb_bytes

    def _generate_reference_image(self, prompt: str, seed: int) -> Image.Image:
        """Generate a reference image using the existing SD 1.5 pipeline."""
        if self.texture_gen_ref is None:
            return Image.new("RGB", (512, 512), color=(128, 100, 80))

        import torch
        import torch.nn as nn

        # Load SD pipeline BEFORE checking if it's available
        self.texture_gen_ref._load_pipeline()
        if self.texture_gen_ref.pipe is None:
            return Image.new("RGB", (512, 512), color=(128, 100, 80))

        pipe = self.texture_gen_ref.pipe

        # 1. Disable circular padding (used for seamless textures)
        patched_padding = []
        for module in pipe.unet.modules():
            if isinstance(module, nn.Conv2d) and module.padding_mode == "circular":
                module.padding_mode = "zeros"
                patched_padding.append(module)

        # 2. Unfuse LCM-LoRA and switch to standard scheduler for proper image generation
        from diffusers import PNDMScheduler
        lcm_scheduler = pipe.scheduler
        try:
            pipe.unfuse_lora()
        except Exception:
            pass  # May not be fused
        pipe.scheduler = PNDMScheduler.from_config(lcm_scheduler.config)

        full_prompt = (
            f"isolated 3D render on pure white background, studio lighting, "
            f"no shadows, centered, single object, side view, {prompt}"
        )

        generator = None
        if seed >= 0:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        # Standard SD 1.5 parameters: 20 steps, guidance 7.5
        with torch.no_grad():
            result = pipe(
                prompt=full_prompt,
                num_inference_steps=20,
                guidance_scale=7.5,
                width=512,
                height=512,
                generator=generator,
            ).images[0]

        # Save reference image for debugging
        result.save("/tmp/model_ref_image.png")
        print("ModelGen: reference image saved to /tmp/model_ref_image.png")

        # 3. Restore LCM-LoRA and circular padding for texture generation
        try:
            pipe.fuse_lora()
        except Exception:
            pass
        pipe.scheduler = lcm_scheduler
        for module in patched_padding:
            module.padding_mode = "circular"

        return result

    def _generate_triposg(self, image: Image.Image, scale: list, seed: int,
                          quality: str = "normal") -> trimesh.Trimesh:
        """Generate 3D mesh with TripoSG, simplify, and scale. Returns trimesh."""
        import torch

        # Quality presets
        if quality == "fast":
            num_steps = 20
            guidance = 4.0
            target_faces = 2000
        else:
            num_steps = 50
            guidance = 7.0
            target_faces = self._target_faces

        # Move SD 1.5 to CPU to free VRAM for TripoSG
        if self.texture_gen_ref and self.texture_gen_ref.pipe is not None:
            self.texture_gen_ref.pipe.to("cpu")
            torch.cuda.empty_cache()

        # Ensure TripoSG is on GPU
        if self._pipe.device.type != "cuda":
            self._pipe.to(self.device, torch.float16)

        actual_seed = seed if seed >= 0 else 42
        with torch.no_grad():
            outputs = self._pipe(
                image=image,
                generator=torch.Generator(device=self.device).manual_seed(actual_seed),
                num_inference_steps=num_steps,
                guidance_scale=guidance,
            ).samples[0]

        vertices = outputs[0].astype(np.float32)
        faces = np.ascontiguousarray(outputs[1])
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)

        # Simplify to target face count
        if len(mesh.faces) > target_faces:
            mesh = self._simplify_mesh(mesh, target_faces)

        # Scale mesh to match requested dimensions
        mesh = self._scale_mesh(mesh, scale)

        # Move TripoSG to CPU, restore SD 1.5 to GPU for texture generation
        self._pipe.to("cpu")
        torch.cuda.empty_cache()
        if self.texture_gen_ref and self.texture_gen_ref.pipe is not None:
            self.texture_gen_ref.pipe.to(self.device)

        return mesh

    def _simplify_mesh(self, mesh: trimesh.Trimesh, target_faces: int) -> trimesh.Trimesh:
        """Reduce face count using quadric edge collapse."""
        try:
            import pymeshlab
            ms = pymeshlab.MeshSet()
            ms.add_mesh(pymeshlab.Mesh(
                vertex_matrix=mesh.vertices,
                face_matrix=mesh.faces,
            ))
            ms.meshing_merge_close_vertices()
            ms.meshing_decimation_quadric_edge_collapse(targetfacenum=target_faces)
            result = ms.current_mesh()
            return trimesh.Trimesh(
                vertices=result.vertex_matrix(),
                faces=result.face_matrix(),
            )
        except Exception as e:
            print(f"ModelGen: simplification failed ({e}), using original mesh")
            return mesh

    def _apply_texture(self, mesh: trimesh.Trimesh, prompt: str) -> trimesh.Trimesh:
        """Generate seamless PBR material texture and apply via xatlas UV unwrap."""
        try:
            import xatlas
            import torch

            # Ensure SD 1.5 pipeline is loaded
            self.texture_gen_ref._load_pipeline()

            # Generate seamless material texture with SD 1.5 (circular padding active)
            tex_prompt = (
                f"seamless tiling texture, flat lit, no perspective, PBR albedo, "
                f"surface material of {prompt}"
            )
            with torch.no_grad():
                albedo = self.texture_gen_ref.pipe(
                    prompt=tex_prompt,
                    num_inference_steps=self.texture_gen_ref.steps,
                    guidance_scale=1.0,
                    width=512,
                    height=512,
                ).images[0]

            # UV unwrap
            vmapping, indices, uvs = xatlas.parametrize(mesh.vertices, mesh.faces)
            new_verts = mesh.vertices[vmapping]

            material = trimesh.visual.material.PBRMaterial(
                baseColorTexture=albedo.convert("RGBA"),
                metallicFactor=0.0,
                roughnessFactor=0.7,
            )
            tex_visual = trimesh.visual.TextureVisuals(uv=uvs, material=material)
            return trimesh.Trimesh(vertices=new_verts, faces=indices, visual=tex_visual)
        except Exception as e:
            print(f"ModelGen: texture application failed ({e})")
            return mesh

    def _scale_mesh(self, mesh: trimesh.Trimesh, scale: list) -> trimesh.Trimesh:
        """Scale mesh to fill the requested bounding box, stretching to match dimensions."""
        current_extents = mesh.extents
        if current_extents.max() == 0:
            return mesh
        sx, sy, sz = float(scale[0]), float(scale[1]), float(scale[2])
        target = np.array([sx, sy, sz])
        # Per-axis scale to match target dimensions exactly
        scale_factors = target / current_extents
        mesh.vertices -= mesh.centroid
        mesh.vertices *= scale_factors
        return mesh

    def _generate_textured_box(self, image: Image.Image, scale: list) -> bytes:
        """Fallback: create a textured box mesh (original v1 behavior)."""
        from rembg import remove

        if not hasattr(self, '_rembg_session'):
            from rembg import new_session
            self._rembg_session = new_session("u2net")

        rgba = remove(image, session=self._rembg_session)
        sx, sy, sz = float(scale[0]), float(scale[1]), float(scale[2])
        box = trimesh.creation.box(extents=[sx, sy, sz])

        img_array = np.array(rgba.convert("RGBA"))
        material = trimesh.visual.material.PBRMaterial(
            baseColorTexture=Image.fromarray(img_array),
            metallicFactor=0.0,
            roughnessFactor=0.7,
        )
        uv = _compute_box_uvs(box)
        box.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)

        return box.export(file_type="glb")

    @property
    def is_loaded(self) -> bool:
        return self._loaded


def _compute_box_uvs(box_mesh: trimesh.Trimesh) -> np.ndarray:
    """Compute UV coordinates for a box mesh."""
    vertices = box_mesh.vertices
    uvs = np.zeros((len(vertices), 2), dtype=np.float64)
    for i, vert in enumerate(vertices):
        extents = box_mesh.extents
        if extents[0] > 0 and extents[2] > 0:
            uvs[i, 0] = (vert[0] - box_mesh.bounds[0][0]) / extents[0]
            uvs[i, 1] = (vert[1] - box_mesh.bounds[0][1]) / extents[1]
    return uvs
