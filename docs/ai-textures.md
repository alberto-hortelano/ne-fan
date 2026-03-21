# Local AI tools for seamless game textures in 2026

**ComfyUI paired with SDXL and dedicated PBR decomposition models has emerged as the dominant self-hosted pipeline for generating tileable game textures from text prompts.** The ecosystem matured rapidly through 2025, with Ubisoft's CHORD model, the StableMaterials pipeline, and ComfyUI-TextureAlchemy forming the core of a fully local, text-to-PBR workflow that produces albedo, normal, roughness, metallic, and height maps in a single pass. For terrain-specific textures, no single AI model dominates — the practical approach combines AI-generated tileable materials with traditional landscape blending in Unreal Engine 5. The field is moving fast: native 4K SVBRDF generation (HiMat) and millisecond-speed PBR decomposition (SuperMat) arrived in late 2025, signaling that production-quality local AI texturing is close to mainstream adoption.

---

## The ComfyUI pipeline dominates local texture generation

ComfyUI (GPLv3, **~89,000 GitHub stars**) has become the undisputed hub for self-hosted AI texture work. Its node-based architecture allows chaining seamless generation, PBR decomposition, upscaling, and preview into a single automated workflow. Three critical node packages form the backbone of any texture pipeline:

**ComfyUI-seamless-tiling** (by spinagon) is the go-to tiling solution with ~190 GitHub stars. It modifies model convolutional layers to use circular padding, producing genuinely seamless output. It supports independent X/Y axis tiling and includes a circular VAE decode node to prevent edge bleeding — a persistent problem with naive tiling approaches. This works best with SDXL; importantly, **FLUX and Z-Image Turbo do not natively support the tiling convolution hack**, making SDXL the preferred base model for tileable texture generation.

**ComfyUI-TextureAlchemy** (by amtarr) is the most comprehensive PBR processing toolkit available. It extracts full map sets — albedo, normal, AO, height, roughness, metallic, transparency, and emission — using Marigold for depth estimation and Lotus for normal/height inference. It includes a seamless tiling maker node, DirectX↔OpenGL normal map conversion (critical for UE5 compatibility), ORM texture packing, and a PBR Material Mixer for blending materials. This single extension handles most of the post-generation pipeline.

**MTB Nodes (comfy_mtb)** provides DeepBump integration directly inside ComfyUI, generating normal and height maps from color images with a dedicated seamless mode. While less comprehensive than TextureAlchemy, it's lightweight and extremely popular as a quick normal map generator.

A typical end-to-end workflow looks like this: SDXL generates a 1024×1024 tileable albedo via seamless-tiling → TextureAlchemy or CHORD decomposes it into PBR maps → an upscaler pushes resolution to 2K or 4K → maps are exported as PNG/TGA for engine import. The entire process runs on a single **12 GB GPU** in under 60 seconds.

---

## Ubisoft's CHORD model sets the PBR decomposition standard

Released in December 2025 as a SIGGRAPH Asia paper, **CHORD (Chain of Rendering Decomposition)** represents the most significant advance in local PBR estimation. It decomposes a single texture image into base color, normal, height, roughness, and metalness maps using chained single-step diffusion inference — each map prediction is conditioned on previously estimated maps, producing physically consistent results.

CHORD ships as a ComfyUI node package with ready-made workflows. The `chord_sdxl_t2i_image_to_material.json` workflow chains SDXL tileable generation directly into CHORD decomposition, producing a complete material from a text prompt. Quality is state-of-the-art in PSNR and LPIPS benchmarks. Community feedback notes it **excels at organic materials** (rock, wood, soil — exactly what terrain textures need) but produces weaker metalness predictions. The critical limitation is licensing: CHORD uses Ubisoft's Machine Learning License, which restricts use to **research only** — no commercial game production.

For commercial projects, **PBRFusion V3+** (by NightRaven109) offers a finetuned diffusion model generating normal, height, and roughness maps with seamless support and batch processing. It ships as a plug-and-play ComfyUI zip (~17 GB with all dependencies). **PBRify_Remix** (by Kim2091) takes the ethical route — trained exclusively on CC0 content from ambientCG — making it fully safe for commercial use. It integrates with NVIDIA's RTX Remix pipeline and generates normal, roughness, and height maps plus upscaling.

---

## Dedicated material generation models worth tracking

Beyond the ComfyUI ecosystem, several standalone models generate full SVBRDF/PBR map sets from text or images. The most production-relevant for game developers:

**StableMaterials** (OpenRAIL license, June 2024) generates base color, normal, height, roughness, and metallic maps from text or image prompts with built-in tileability. It runs via HuggingFace's DiffusionPipeline on **8+ GB VRAM** and supports LCM fast inference in just 4 steps. Output resolution is 512×512 with a refiner for upscaling. It outperforms MatFuse and Material Palette in quality benchmarks and is one of the few models combining tileability, full PBR output, and a permissive license.

**MatForger** (evolved from MatFuse, CVPR 2024) generates five PBR maps with noise rolling for tileable output. It's integrated into the **Material Crafter Blender add-on**, making it the most practical option for Blender-to-UE5 pipelines. Trained on the MatSynth dataset of 4,000+ materials, it produces diverse results across material categories.

**HiMat** (August 2025) is the cutting edge: a 1.8B-parameter Diffusion Transformer that generates **native 4096×4096 SVBRDF maps** — albedo, normal, roughness, metallic, and height — from text prompts. It uses linear attention with a CrossStitch module for cross-map consistency and achieves the highest aesthetic scores in benchmarks (4.43 vs ControlMat's 3.82). It requires significant GPU resources but represents where the field is heading.

**ControlMat** (Adobe Research, ACM TOG 2024) pioneered "rolled diffusion" for tileable output and "patched diffusion" for high-resolution generation up to 4K. It excels at photo-to-PBR estimation with minimal baked lighting artifacts.

For **speed-critical workflows**, SuperMat (ICCV 2025) decomposes images into albedo, metallic, and roughness maps in **0.07 seconds** — orders of magnitude faster than diffusion-based methods — using single-step UNet inference with physics-aware rendering loss.

| Model | Year | Maps Generated | Tileable | Max Resolution | License | Best For |
|---|---|---|---|---|---|---|
| CHORD (Ubisoft) | 2025 | 5 (full PBR) | ✅ | 1K→4K upscaled | Research only | Highest quality decomposition |
| StableMaterials | 2024 | 5 (full PBR) | ✅ | 512→upscaled | OpenRAIL | Commercial text-to-material |
| MatForger | 2024 | 5 (full PBR) | ✅ | 512 | Open source | Blender integration |
| HiMat | 2025 | 5 (full SVBRDF) | ✅ | Native 4K | Research | Maximum resolution |
| ControlMat | 2024 | 6 (SVBRDF+height+opacity) | ✅ | Up to 4K | Partial (Adobe) | Photo-to-material |
| SuperMat | 2025 | 3 (albedo/metal/rough) | — | Per-image | Open source | Real-time speed |
| PBRFusion V3 | 2025 | 3 (normal/height/rough) | ✅ | Varies | Not stated | Batch processing |
| DeepBump | 2020 | 2 (normal/height) | ✅ option | Any | GPL | Lightweight, CPU-capable |

---

## Terrain and landscape textures require a blended approach

No dedicated AI model exists specifically for terrain texture generation — the practical solution combines AI-generated tileable materials with engine-side landscape blending. The workflow for UE5 terrain texturing follows a proven pattern:

Generate individual terrain material tiles — "weathered granite rock face," "dry cracked mud," "alpine grass with moss patches," "wind-swept desert sand" — using ComfyUI with seamless tiling enabled. Extract PBR maps for each material using CHORD or TextureAlchemy. Import into UE5's Landscape Material system using **Layer Blend nodes** with weight maps derived from terrain data (slope angle, altitude, moisture). This approach mirrors how AAA studios texture landscapes, substituting AI generation for Megascans or manual photo scanning.

For prompting terrain textures specifically, effective patterns include: "seamless tiling orthographic top-down [material name], flat lit, no shadows, no perspective, PBR albedo" combined with material-specific descriptors like grain direction, weathering patterns, or moisture levels. Prompts describing surfaces rather than objects produce dramatically better results.

**InstaMAT 2025** deserves special mention for terrain work. This professional application (free for studios under $100K revenue) includes physically-based terrain erosion simulation, snow and river generation, procedural biome texturing, and an official UE5 plugin with real-time parameter adjustment. Studios like Bandai Namco and Blizzard use it in production. While not purely AI-generative, its AI-assisted decomposition (single image → full PBR set) combined with procedural terrain tools makes it the most complete terrain texturing solution available.

---

## Getting textures into Unreal Engine 5

Three integration paths exist, ranging from fully automated to manual:

**ComfyTextures** (open source UE5 plugin) connects ComfyUI directly to the UE5 editor. It captures scene renders from selected actors, sends them to ComfyUI for generation, and applies results back — enabling iterative texturing without leaving the editor. It requires **16 GB VRAM and 32 GB RAM** and supports Create (fast LCM), Refine (high-quality SDXL), and Edit (inpainting) modes. Setup is complex but the workflow is powerful.

**Infinite Texture Generator** (commercial, Fab marketplace) provides a simpler UE5-native option using Stable Diffusion with CUDA acceleration. It generates tileable textures from text prompts directly in the editor with scriptable batch generation. The runtime module works on CPU but is slow.

The **manual pipeline** remains the most reliable approach: generate in ComfyUI → export as PNG/TGA at power-of-2 resolutions → import into UE5 Content Browser. UE5 expects **DirectX-format normal maps** (flip green channel if generating OpenGL format), sRGB for base color, and linear for all other maps. For memory efficiency, pack AO, roughness, and metallic into a single **ORM texture** (R=AO, G=Roughness, B=Metallic). TextureAlchemy's PBR Saver node handles this packing automatically.

---

## GPU requirements, licensing, and practical recommendations

**Minimum viable setup**: An RTX 3060 12GB runs SDXL with seamless tiling, TextureAlchemy PBR extraction, and basic upscaling comfortably. Budget ~20 seconds per texture at 1024×1024.

**Recommended setup**: An RTX 4070 Ti 16GB or RTX 4090 24GB handles SDXL generation, CHORD decomposition, and 4K upscaling simultaneously. The 24GB card opens access to FLUX, HiMat, and other large models.

**System RAM**: 32 GB minimum for ComfyUI with multiple loaded models.

For **commercial game development**, licensing requires careful attention. The safest stack uses FLUX.1 [schnell] (Apache 2.0) or SDXL (CreativeML Open RAIL++) for generation, PBRify_Remix (CC0-trained) for PBR maps, and ComfyUI (GPLv3) as the interface — all fully cleared for commercial output. CHORD's research-only license and FLUX.1 [dev]'s non-commercial restrictions make them unsuitable for shipping games without separate licensing agreements. StableMaterials (OpenRAIL) permits commercial use of outputs.

**Community workflows worth installing immediately**: The "Seamless PBR Texture Generator" workflow by henry_triplette on OpenArt automates the full pipeline — SDXL generation, Florence2 auto-prompting, Fooocus inpainting for seam removal, and Marigold/DeepBump PBR extraction — producing seven map types from a single text prompt. The "Seamless PBR Material Generator V2" on Civitai adds FLUX support and ControlNet depth guidance for terrain-like structural control.

---

## Conclusion

The local AI texture generation ecosystem has reached a practical inflection point. A zero-cost pipeline of **ComfyUI + SDXL + seamless-tiling + TextureAlchemy** can produce game-ready tileable PBR materials from text in under a minute on a 12 GB GPU. For the highest quality PBR decomposition, CHORD is unmatched but limited to research use — StableMaterials and PBRFusion fill the commercial gap. The next frontier is already visible: HiMat's native 4K SVBRDF generation and SuperMat's millisecond inference suggest that by late 2026, AI-generated materials will be indistinguishable from scanned references at production resolutions. For terrain specifically, the winning strategy remains generating individual material tiles with AI and blending them procedurally in UE5's landscape system — no single tool yet handles end-to-end terrain texturing, though InstaMAT 2025 comes closest for studios willing to use a hybrid procedural-AI approach.