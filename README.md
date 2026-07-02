# Never Ending Fantasy

**AI-powered open-world dark fantasy RPG with real-time generative content**

An RPG whose world is **sculpted by a narrative engine at play time**: Claude (via MCP) generates the initial open-world scene — terrain, vegetation, buildings, lighting — and keeps adding entities (NPCs, buildings, objects) dynamically as the story unfolds. If the player says *"quiero ir a la forja a comprar un arma"*, the engine generates a forge, spawns a blacksmith, and wires a trade through a declarative plugin. Textures, 3D models, and character skins are generated on demand by local and remote generative models.

The canonical client is **Godot 4.6 (3D)**. A lightweight **HTML/Canvas (2D top-down)** client shares the same TypeScript game logic and is used to iterate on story, dialogue, and maps without booting the full 3D stack.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Godot 4.6 (3D, canonical)          nefan-html (2D, dev/story)   │
│      │ WebSocket :9877                  │ WebSocket :9877        │
│  ┌───┴─────────────────────────────────┴─────────────────────┐   │
│  │                nefan-core (TypeScript)                     │   │
│  │  GameSimulation tick · combat resolver · enemy AI          │   │
│  │  NarrativeState (canonical save) · world map · scenarios   │   │
│  │  Declarative plugins (JSON manifests + interpreter)        │   │
│  │  bridge/ws-server.ts (:9877) + state HTTP API (:9878)      │   │
│  └───────────────┬────────────────────────────────────────────┘   │
└──────────────────┼────────────────────────────────────────────────┘
                   │ HTTP
┌──────────────────┴────────────────────────────────────────────────┐
│                    ai_server (FastAPI :8765)                       │
│  SD 1.5 + LCM-LoRA + TAESD (PBR textures) · img2img (skins)        │
│  Meshy/TripoSG (GLB models) · scene image gen (img2img/outpaint)   │
│  Claude vía narrative-mcp (:3737) — scene generation & reactions   │
└────────────────────────────────────────────────────────────────────┘
```

- **Game logic lives in `nefan-core`** (TypeScript, zero engine dependencies); Godot is display-only where possible, ready for an engine swap. Combat resolution is authoritative from the bridge; the game still runs without it (local fallback).
- **NarrativeState is the canonical save** — the whole playthrough (world, player, entities, dialogue history, world map, active plugins) lives in one versioned, multi-slot JSON.
- **Declarative plugins** — complete game systems (commerce, reputation…) as pure JSON manifests executed by an interpreter: state slice, event reducers with a small DSL, derived views for the LLM, and deterministic fixtures validated before activation. The narrative engine drives them with `plugin_event` consequences and can even register new plugins at runtime.
- **Asset library indexed by hash** — everything generated is tracked in a manifest (with LRU pruning); the narrative engine reuses cached assets by hash instead of regenerating.

## Generative Models

| Model | Purpose | Where |
|-------|---------|-------|
| **Claude (MCP bridge)** | Open-world scene generation, narrative reactions (dialogue → consequences → dynamic spawns), weapon orientation via vision | `narrative-mcp` + `ai_server/llm_client.py` |
| **SD 1.5 + LCM-LoRA + TAESD** | Seamless PBR textures (albedo + normal), ~1s | `texture_generator.py` |
| **SD 1.5 img2img (+ControlNet)** | Character skins and sprite sheets | `controlnet_skin.py` |
| **Meshy / TripoSG** | GLB models from prompts | `model_generator.py` |
| **Meshy image models + SAM (fal.ai)** | 2D scene backgrounds + occluder segmentation | `scene_image_generator.py` |

## Quick Start

```bash
./start.sh
```

The interactive launcher offers presets that respect service dependencies (bridge → narrative-mcp → ai_server → Godot/HTML) and pauses when a narrative session needs a Claude Code terminal. Highlights:

| Preset | For |
|--------|-----|
| 1 · Play | Full narrative session (Godot 3D) |
| 2 · Story 2D | Iterate story/NPCs/dialogue with the 2D client |
| 3 · Automated tests | Headless Godot (xvfb) + `godot/tools/movement_test.py` |
| 5 · Godot offline | Quick visual tests, no AI |

Manual startup, controls, remote-control testing (TCP :9876), and all development conventions are documented in [CLAUDE.md](CLAUDE.md) (Spanish — the project's working language).

## Project Structure

```
ne-fan/
├── nefan-core/        # Game logic + narrative state + plugins + WS bridge (TS)
├── godot/             # 3D client (Godot 4.6) — display, input, HUD
├── nefan-html/        # 2D top-down client (Canvas) — dev/story iteration
├── ai_server/         # FastAPI: textures, models, skins, scene gen (:8765)
├── narrative-mcp/     # MCP bridge: Claude ↔ ai_server (:3737)
├── skinning_lab/      # Reusable bench for AI skinning experiments
├── narrative_lab/     # Bench for testing the narrative engine as-the-game
└── docs/              # Design documents (Spanish)
```

CI runs on every PR: TypeScript typecheck + eslint + ~300 tests (nefan-core), build (nefan-html), ruff + unittest (ai_server).

## Hardware

- **GPU:** NVIDIA RTX 3060 12GB (~3GB VRAM peak, fp16)
- **OS:** Linux (Ubuntu, kernel 6.8) · **Godot:** 4.6.1 with `gl_compatibility`
- **Node.js:** 20+ · **Python:** 3.10+

## Origin

Started as the final project for **XCS236: Deep Generative Models** (Stanford Online) and kept growing into a generative open-world engine.

## License

This project uses Mixamo character models and animations (Adobe), free for personal and commercial use with an Adobe account. Generated assets are cached locally and not redistributed.
