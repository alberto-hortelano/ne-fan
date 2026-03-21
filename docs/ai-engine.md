# Real-time AI rendering for a TypeScript RPG: a full technical blueprint

**The core concept — rendering simple 3D primitives through an AI diffusion model to produce detailed game visuals — is technically feasible today, though with significant constraints.** On an RTX 4090, StreamDiffusion achieves **91 FPS** for img2img transformation at 512×512, and cloud APIs like fal.ai can deliver **3–7 FPS** via WebSocket with ~150ms latency. A solo TypeScript developer can realistically build a working prototype using Three.js, a semantic object layer, and either a local StreamDiffusion server or fal.ai's real-time endpoints. The architecture requires accepting that AI-rendered frames will lag behind player input by roughly 100–1000ms, but RPG pacing tolerates this well. This report covers every layer of the system: image transformation models, narrative AI, architecture choices, and the existing projects that prove the concept works.

---

## The AI rendering pipeline: from gray boxes to treasure chests

The foundational technique for this concept is **ControlNet Depth conditioning combined with fast diffusion models**. A Three.js scene renders simple geometry — colored boxes, cylinders, planes — and simultaneously outputs a depth buffer. This depth map feeds into ControlNet, which constrains a Stable Diffusion model to preserve the exact spatial layout of the scene while completely transforming the visual style. A gray box labeled "chest" at position (3, 0, 5) stays at that position in the output frame but becomes an ornate treasure chest.

Three model families make this near-real-time. **SDXL Turbo** uses Adversarial Diffusion Distillation to generate images in a single step — 207ms on an A100 at 512×512. **SDXL Lightning** (ByteDance) achieves high quality in 2–4 steps with full 1024×1024 resolution. **Latent Consistency Models (LCM)** work as LoRA adapters compatible with any fine-tuned SD model, requiring only 2–4 denoising steps. All three can run with ControlNet depth conditioning, though ControlNet adds roughly **30–50% overhead** to inference time.

The breakthrough enabling technology is **StreamDiffusion**, an open-source pipeline optimization framework (Apache 2.0, 10.7K GitHub stars). It reformulates denoising into batched Stream Batch processing, uses Residual Classifier-Free Guidance to eliminate redundant UNet computations, and employs a Stochastic Similarity Filter that skips GPU processing when consecutive frames are similar. On an RTX 4090, it achieves **91 FPS for img2img** at 512×512 with 1-step denoising (10.98ms per frame). Even at 2–3 denoising steps suitable for ControlNet, **15–30 FPS** is achievable on an RTX 3060. A derivative project called **ScreenDiffusion** already demonstrates exactly the "capture game screen → AI transform → display" pipeline in real-time.

ControlNet's advantage for game use is unique: unlike photo applications that must estimate depth from 2D images using MiDaS or ZoeDepth, a **3D renderer provides pixel-perfect depth maps for free** directly from the depth buffer. Setting the ControlNet preprocessor to "none" and passing the raw depth map produces superior structural fidelity. At strength 1.0, the composition is almost entirely determined by the depth map while the prompt controls style and subject detail. Multiple ControlNets can be stacked — Depth + Normal maps together produce even more faithful structural preservation.

---

## What frame rates are actually achievable in 2026

The honest answer depends entirely on hardware and deployment model. Here is the realistic performance landscape:

| Approach | Resolution | FPS | Hardware | Practical? |
|---|---|---|---|---|
| StreamDiffusion + SD 1.5 + LCM + TensorRT | 512×512 | **50–91** | RTX 4090 | ✅ Excellent |
| StreamDiffusion + SD 1.5 + LCM | 512×512 | **15–30** | RTX 3060 | ✅ Good |
| ControlNet Depth + SD 1.5 + LCM (local) | 512×512 | **10–20** | RTX 4090 | ✅ Viable |
| SDXL Turbo img2img (local) | 512×512 | **5–15** | RTX 4090 | ⚠️ Marginal |
| fal.ai WebSocket API (LCM) | 512×512 | **3–7** | Cloud GPU | ⚠️ RPG-viable |
| Replicate API | 512×512 | **0.5–1** | Cloud GPU | ❌ Too slow |
| WebGPU in browser (SD 1.5) | 512×512 | **0.02–0.1** | Any GPU | ❌ Completely impractical |

**Browser-based WebGPU inference is a dead end for real-time diffusion.** SD 1.5 in the browser takes 30–60 seconds per 512×512 image — roughly 1,000× too slow. WebGPU maturity has improved (Chrome 113+, Firefox 141+, Safari 26 pending), and ONNX Runtime Web shows ~20× speedups over CPU, but diffusion models are simply too large and compute-intensive. For comparison, ONNX Runtime Web's WebGPU backend achieves ~550× over single-threaded CPU for general inference, but SD's multi-step denoising with billion-parameter UNets overwhelms browser resource constraints.

The practical path for a web-based prototype is a **hybrid architecture**: Three.js renders in the browser at 60 FPS, frames stream to either a local GPU server or cloud API via WebSocket, and transformed frames return asynchronously. The player sees either a blended display or a dual-view (responsive low-poly + delayed AI-rendered).

---

## Neural game engines: what GameNGen and Oasis actually proved

Google DeepMind's **GameNGen** (ICLR 2025) demonstrated that a diffusion model can entirely replace a traditional game engine. Built on fine-tuned Stable Diffusion v1.4, it simulates DOOM at **20 FPS on a single TPU** with a PSNR of 29.4 — human raters couldn't distinguish real from generated clips better than chance. But GameNGen is a **world model**, not a style transfer system. It replaces the entire engine rather than transforming existing renders, requires millions of gameplay frames for training, runs only on TPUs, and cannot generalize beyond DOOM. It proves the concept of neural game rendering but is not applicable to this prototype.

**Oasis 2.0** (Decart, 2025) is far more relevant. It's a Minecraft mod that runs a **video-to-video model called MirageLSD** in real-time, transforming Minecraft's visuals while you play. Players type prompts like "/oasis prompt Venice in the summer" and the game's appearance transforms live. It claims 1080p at 30 FPS, though community reports suggest lower actual quality. This is the closest existing product to the envisioned prototype — but it's server-dependent, closed-source, and Minecraft-specific.

**DIAMOND** (NeurIPS 2024 Spotlight) deserves mention as the only fully open-source neural game engine. It runs Counter-Strike: Global Offensive at 10 Hz on an RTX 3090 and includes playable world models for 25 Atari games. The 381M parameter CS:GO model trained for 12 days on an RTX 4090. Unlike GameNGen, DIAMOND's code, weights, and agents are all publicly available.

The trajectory is clear: GameNGen (Aug 2024) → Oasis (Oct 2024) → Genie 2 (Dec 2024) → DIAMOND CS:GO (2024) → Oasis 2.0 (2025) → Genie 3 (2025). Neural game rendering is advancing rapidly, but **the style-transfer approach (simple 3D → AI-detailed) remains more practical than full neural game engines** for a prototype, because it preserves deterministic game logic, physics, and object permanence.

---

## The semantic layer: giving every box a soul

The most novel architectural idea in this concept is the **semantic layer** — each game object carries both a simple mesh for rendering and a text description that drives AI transformation. A `SemanticGameObject` might have a Three.js `BoxGeometry` positioned at (3, 0, 5) plus a description string: "A weathered wooden treasure chest with iron bands, slightly open, gold coins visible." When the frame is captured for AI transformation, a prompt compiler aggregates visible objects' descriptions into a scene prompt.

This pattern has academic roots in TU Delft's "Semantic Game Worlds" research (Tutenel, Bidarra), which proposed enriching virtual entities with attributes, states, hierarchies, and relationships beyond visual representation. More recently, Roblox's "4D" AI creation tool (February 2026) synthesizes geometry, texture, and physical properties simultaneously — when generating a vehicle, the AI "understands the object's function," creating wheels that rotate and doors with hinge constraints. The principle is the same: objects carry semantic meaning that drives their visual realization.

For the prototype, the implementation would look like this:

```typescript
interface SemanticGameObject {
  mesh: THREE.Mesh;              // Simple gray box, sphere, etc.
  description: string;           // "Ancient stone tower with ivy"
  category: string;              // "building" | "creature" | "item"
  mood: string;                  // "ominous" | "peaceful"
  state: string;                 // "intact" | "ruined" | "burning"
}

function compileScenePrompt(camera: THREE.Camera, objects: SemanticGameObject[]): string {
  const visible = objects.filter(obj => isInFrustum(obj, camera));
  return `Fantasy RPG scene: ${visible.map(o => o.description).join(', ')}`;
}
```

The depth map ensures spatial fidelity — ControlNet preserves where objects are — while the compiled prompt tells the diffusion model what those objects should look like. **Jeff Schomay documented building exactly this architecture** using fal.ai, achieving ~10 FPS with ~1 second latency. His key finding: image strength tuning is critical. Too much preservation keeps the blockiness; too little loses spatial alignment. A strength of **0.5–0.7** is the sweet spot, and a fixed seed dramatically improves frame-to-frame consistency.

---

## The narrative AI engine: LLMs as game masters

For procedural RPG content, the architecture is well-established thanks to AI Dungeon's seven years of iteration and a growing body of academic research. AI Dungeon now runs models from 12B to 405B parameters, including fine-tuned Llama 3.3 70B ("Wayfarer") specifically optimized for challenge mechanics, and uses **dynamic model routing** — simpler queries go to smaller models, complex narrative moments to larger ones.

The consensus architecture is a **hybrid system**: a deterministic game engine owns ground-truth state (positions, inventory, health, quest flags), while the LLM generates narrative prose informed by that state. Pure LLM-driven state is unreliable — RPGBench (February 2025) found that "state-of-the-art LLMs can produce engaging stories but often struggle to implement consistent, verifiable game mechanics."

**Structured output enforcement** has matured significantly. OpenAI's Structured Outputs (August 2024) guarantees valid JSON conforming to a schema, improving compliance from 35% (prompting alone) to **100%**. Libraries like Instructor, Outlines, and Formatron provide similar guarantees for local models. The pattern is: define Pydantic/JSON schemas for NPCs, items, quests, and locations; call the LLM with structured output mode; validate against game rules; normalize and repair invalid outputs; instantiate in the game engine. Function calling adds dice rolls, state transitions, and rule enforcement — research on Jim Henson's Labyrinth TTRPG found that combining dice roll functions with state functions produced the highest-quality game master narratives.

For a TypeScript prototype, the practical approach:

- **Cloud LLMs** (GPT-4, Claude) for complex generation: quests, character backstories, world-building. Use structured output / function calling for reliable JSON.
- **Local 7–13B models** (via Ollama) for high-frequency, low-complexity tasks: NPC barks, item descriptions, ambient flavor text. Quality is adequate and cost is zero.
- **Hierarchical generation**: World synopsis → regions → locations → NPCs → items. Each level references outputs from higher levels, maintaining coherence.
- **Lorebook pattern** (from SillyTavern): keyword-activated context injection. Define lore entries triggered when relevant keywords appear, minimizing context window usage while maintaining consistency.
- **Guided summarization** over RAG: periodically summarize conversation/event history rather than retrieving raw transcripts. More token-efficient and maintains narrative threads.

The key limitation: local models below 70B parameters struggle with reliable function calling. If structured game objects are essential (they are), either use cloud APIs or accept that smaller local models will need more validation and retry logic.

---

## Recommended architecture for a solo TypeScript developer

**Three.js is the clear winner** for this use case. At 168kB gzipped (vs. Babylon.js's 1.4MB), it's the lightest option with the largest ecosystem — 5 million weekly npm downloads, 110K GitHub stars, and 30K+ Stack Overflow questions. It provides direct canvas access for frame capture, supports `WebGLRenderTarget` for render-to-texture, and React Three Fiber (R3F) enables declarative scene composition that dramatically accelerates prototyping. For a prototype focused on AI transformation rather than rendering fidelity, Three.js's flexibility and minimal overhead are exactly right.

The complete recommended stack:

- **Rendering**: Three.js via React Three Fiber + Drei helpers
- **Build**: Vite 6 (fast HMR, native TypeScript)
- **State**: Zustand (lightweight, TS-native, R3F-compatible)
- **AI Image**: fal.ai WebSocket SDK (`@fal-ai/client`) for cloud, or local StreamDiffusion server
- **AI Narrative**: OpenAI/Anthropic API with structured outputs for complex generation, Ollama for local high-frequency tasks
- **Physics**: Rapier3D WASM (`@dimforge/rapier3d-compat`)

The frame capture pipeline uses `canvas.toBlob('image/jpeg', 0.7)` — binary blobs avoid the 33% overhead of base64 encoding. A **dual-renderer approach** captures frames: the display renderer runs at full resolution and 60 FPS, while a hidden 512×512 renderer captures frames for AI transformation at 5–10 FPS. A camera-delta threshold prevents unnecessary API calls — in an RPG, the player moves slowly enough that 2–5 transforms per second often suffice.

For managing the inevitable latency gap, several techniques work together. **Request ordering** ensures stale frames don't overwrite newer ones. **Cross-fade blending** smooths transitions between AI-transformed keyframes. **Cached transforms** indexed by camera position allow reuse when the player revisits viewpoints. And the most pragmatic approach: simply **show the responsive low-poly scene as the primary view** with the AI-rendered version as an overlay or secondary display that updates asynchronously. The RPG genre's slower pacing makes 3–10 FPS AI rendering genuinely playable.

The **local deployment path** for maximum performance: run a Python server with StreamDiffusion + ControlNet Depth + SD 1.5 + LCM-LoRA + TensorRT alongside the web app. Connect via localhost WebSocket. This eliminates network latency entirely and achieves 15–30+ FPS on an RTX 3060. For users without NVIDIA GPUs, fall back to fal.ai's cloud endpoints at 3–7 FPS.

---

## Prior art that proves each piece works

No production-ready open-source project yet combines all three layers — procedural 3D, AI image transformation, and narrative generation — into a single game. But every individual piece has been demonstrated:

**NVIDIA's vid2vid demo (NeurIPS 2018)** was the first to show a playable game where a semantic sketch of a 3D world transformed into photorealistic video in real-time using a GAN. Seven years later, the same pipeline is dramatically more capable with diffusion models. **ScreenDiffusion** already captures any game window and transforms it live using StreamDiffusion + SD-Turbo. **Oasis 2.0** proves that video-to-video transformation of a running game is commercially viable (15K+ downloads as a Minecraft mod). Academic papers on **G-buffer-guided neural style transfer** (BMVC 2023, PQDAST February 2025) demonstrate real-time style transfer integrated directly into Unity's rendering pipeline using depth and normal maps for temporal coherence.

For narrative AI, **"One Trillion and One Nights"** (MIT license) is a complete browser-based JRPG where every quest, NPC, item, and location is LLM-generated using hierarchical top-down generation. **VirtualGameMaster** supports both local and cloud LLMs with YAML-based world templates and automatic history summarization. **Intra** (open source, playable at playintra.win) demonstrates the hybrid state management approach — formal game state tracked by code, narrative prose generated by LLM.

The specific "viral demo" the user may have seen is most likely one of three things: Oasis 2.0's Minecraft transformation, ScreenDiffusion's game-screen-to-AI pipeline, or Jeff Schomay's documented experiment of rendering a game in real-time with fal.ai. All demonstrate that the concept is not theoretical — it works today, with caveats around frame rate, temporal consistency, and hardware requirements.

---

## Conclusion: what a realistic prototype looks like

The most honest assessment: **a solo TypeScript developer can build a working prototype in weeks, not months.** The rendering is trivial (low-poly Three.js primitives), the AI transformation infrastructure exists as battle-tested open-source software and APIs, and the narrative generation layer is well-served by existing LLM APIs with structured output. The prototype will produce genuinely impressive results — simple colored boxes transforming into detailed fantasy environments — at 3–10 FPS via cloud API or 15–30 FPS with a local NVIDIA GPU.

The hard problems are temporal consistency (frames "jump" between AI inferences, especially at low denoise strength), the latency gap between player input and visual response, and the cost of continuous API calls during extended play sessions. These are engineering challenges with known mitigation strategies — fixed seeds, camera-delta thresholds, frame caching, cross-fading — rather than unsolved research problems.

The most valuable insight from this research: **ControlNet Depth conditioning using the 3D engine's native depth buffer is the single most important technical choice.** It transforms the problem from "AI must understand and reconstruct a 3D scene from a flat image" into "AI must paint a detailed scene that matches this exact depth layout" — a far easier task that produces dramatically better structural fidelity. Combined with per-object semantic descriptions compiled into prompts, this creates a system where the 3D engine handles spatial reasoning perfectly while the AI handles visual imagination. That division of labor is what makes the concept viable today.