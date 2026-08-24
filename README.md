# Never Ending Fantasy

**AI-powered open-world dark fantasy RPG with real-time generative content**

An RPG whose world is **sculpted by a narrative engine at play time**: Claude (via MCP) generates the initial open-world scene — terrain, vegetation, buildings, lighting — and keeps adding entities (NPCs, buildings, objects) dynamically as the story unfolds. If the player says *"quiero ir a la forja a comprar un arma"*, the engine generates a forge, spawns a blacksmith, and wires a trade through a declarative plugin. Textures, 3D models, and character skins are generated on demand by local and remote generative models.

The client is **nefan-html**: a first-person WebGL renderer (three.js) in the browser, driven by shared TypeScript game logic.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              nefan-html — first-person client (three.js)         │
│                     │ WebSocket :9877                            │
│  ┌──────────────────┴─────────────────────────────────────────┐  │
│  │                nefan-core (TypeScript)                     │  │
│  │  GameSimulation tick · combat resolver · enemy AI          │  │
│  │  NarrativeState (canonical save) · world map · scenarios   │  │
│  │  Declarative plugins (JSON manifests + interpreter)        │  │
│  │  bridge/ws-server.ts (:9877) + state HTTP API (:9878)      │  │
│  └───────────────┬────────────────────────────────────────────┘  │
└──────────────────┼───────────────────────────────────────────────┘
                   │ HTTP
┌──────────────────┴────────────────────────────────────────────────┐
│                    ai_server (FastAPI :8765)                       │
│  SD 1.5 + LCM-LoRA + TAESD (PBR textures) · img2img (skins)        │
│  Meshy/TripoSG (GLB models) · scene image gen (img2img/outpaint)   │
│  Claude vía narrative-mcp (:3737) — scene generation & reactions   │
└────────────────────────────────────────────────────────────────────┘
```

- **Game logic lives in `nefan-core`** (TypeScript, zero rendering dependencies); the client only paints, which keeps the renderer swappable. Combat resolution is authoritative from the bridge; the game still runs without it (local fallback).
- **NarrativeState is the canonical save** — the whole playthrough (world, player, entities, dialogue history, world map, active plugins) lives in one versioned, multi-slot JSON.
- **Declarative plugins** — complete game systems (commerce, reputation…) as pure JSON manifests executed by an interpreter: state slice, event reducers with a small DSL, derived views for the LLM, and deterministic fixtures validated before activation. The narrative engine drives them with `plugin_event` consequences and can even register new plugins at runtime.
- **Asset library indexed by hash** — everything generated is tracked in a manifest (with LRU pruning); the narrative engine reuses cached assets by hash instead of regenerating.

## Generative Models

| Model | Purpose | Where |
|-------|---------|-------|
| **Claude (MCP bridge)** | Open-world scene generation, narrative reactions (dialogue → consequences → dynamic spawns), weapon orientation via vision | `narrative-mcp` + `ai_server/llm_client.py` |
| **sprite-forge** (separate service, `:8770`) | Character sprite sheets: base render (three.js in headless Chrome, free and deterministic) + AI repaint | [`sprite-forge`](https://github.com/alberto-hortelano/sprite-forge); adapter in `ai_server/routers/remote_generation.py` |
| **Meshy image models + SAM (fal.ai)** | 2D scene backgrounds + occluder segmentation | `scene_image_generator.py` |

## Quick Start

```bash
./start.sh
```

The interactive launcher offers presets that respect service dependencies (asset-store → image services → bridge → narrative-mcp → ai_server → client) and pauses when a narrative session needs a Claude Code terminal. Highlights:

| Preset | For |
|--------|-----|
| `play` | Full narrative session — spends credits on AI imagery |
| `story-web-sin-imagenes` | Same, with the image services off — cannot spend |
| `e2e-sin-creditos` | Everything mocked, zero credits (what `qa/run.mjs` boots) |
| `html-fixtures` | Client only, no backend |

`./start.sh --list` prints all eight. Presets are addressed **by slug**, not by number: numbers shift when a preset is retired.

Manual startup, controls, and all development conventions are documented in [CLAUDE.md](CLAUDE.md) (Spanish — the project's working language).

## Project Structure

```
ne-fan/
├── nefan-core/        # Game logic + narrative state + plugins + WS bridge (TS)
├── nefan-html/        # First-person client (three.js/WebGL) — display, input, HUD
├── ai_server/         # FastAPI: textures, models, skins, scene gen (:8765)
├── narrative-mcp/     # MCP bridge: Claude ↔ ai_server (:3737)
├── qa/                # Executable QA scripts that drive the real game
├── labs/              # Experiment benches (style, fps, authoring, narrative)
└── docs/              # Design documents (Spanish)
```

CI runs on every PR: TypeScript typecheck + eslint + ~300 tests (nefan-core), build (nefan-html), ruff + unittest (ai_server).

## Hardware

- **GPU:** NVIDIA RTX 3060 12GB (~3GB VRAM peak, fp16)
- **OS:** Linux (Ubuntu, kernel 6.8) · **Browser:** Chrome/Chromium with WebGL2
- **Node.js:** 24+ · **Python:** 3.10+

## Origin

Started as the final project for **XCS236: Deep Generative Models** (Stanford Online) and kept growing into a generative open-world engine.

## License

This project uses Mixamo character models and animations (Adobe), free for personal and commercial use with an Adobe account. Generated assets are cached locally and not redistributed.
