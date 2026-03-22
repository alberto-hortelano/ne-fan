# Never Ending Fantasy

**AI-powered dark fantasy RPG with real-time generative content**

A dungeon-crawling RPG with two frontends — 3D (Godot 4.6) and 2D top-down (HTML/Canvas) — sharing the same engine-independent game logic written in TypeScript. Rooms, textures, character skins, and narrative are generated in real-time using deep generative models.

## Game Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTENDS                                │
│                                                                 │
│  ┌─────────────────────┐        ┌─────────────────────────┐     │
│  │  Godot 4.6 (3D)     │        │  HTML/Canvas (2D)       │     │
│  │                     │        │                         │     │
│  │  3rd person camera  │        │  Top-down view          │     │
│  │  Mixamo animations  │        │  WASD + mouse aim       │     │
│  │  AI-gen textures    │        │  Canvas 2D rendering    │     │
│  │  PBR materials      │        │  DOM HUD                │     │
│  └────────┬────────────┘        └────────┬────────────────┘     │
│           │ WebSocket :9877              │ direct import        │
│           │                              │                      │
│  ┌────────┴──────────────────────────────┴────────────────┐     │
│  │              nefan-core (TypeScript)                    │     │
│  │                                                        │     │
│  │  GameSimulation.tick(delta, inputs) → FrameResult       │     │
│  │  ├── CombatManager (batch resolution)                  │     │
│  │  ├── Combatant (state machines)                        │     │
│  │  ├── EnemyAI (seeded PRNG decisions)                   │     │
│  │  └── GameStore (centralized state, event-driven)       │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTP
┌─────────────────────────────┴───────────────────────────────────┐
│                    AI SERVER (FastAPI :8765)                     │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────┐  │
│  │  SD 1.5       │  │  SD 1.5       │  │  Claude Sonnet 4.5  │  │
│  │  + LCM-LoRA   │  │  img2img      │  │  via MCP bridge     │  │
│  │  + TAESD      │  │               │  │                     │  │
│  │  PBR Textures │  │  Skin Gen     │  │  Room Generation    │  │
│  │  ~0.5s each   │  │  ~15s each    │  │                     │  │
│  └───────────────┘  └───────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

The game logic (combat, AI, state) lives in `nefan-core`, a TypeScript package with zero engine dependencies. Two frontends consume it:

- **Godot 3D** connects via WebSocket bridge (`localhost:9877`). Player movement and rendering are local; combat resolution is authoritative from TypeScript. Falls back to local combat when bridge is not running.
- **HTML 2D** imports `nefan-core` directly in the browser (no network, zero latency). Same combat rules, same enemy AI, same game state.

Both share `combat_config.json` (attack types, weapons, tactical matrix) and room JSON definitions.

## Generative Models

| Model | Purpose | Speed | Details |
|-------|---------|-------|---------|
| **SD 1.5 + LCM-LoRA + TAESD** | PBR texture generation | ~0.5s / 512x512 | Seamless tiling via circular padding, 4-step inference, albedo + Sobel normal map |
| **SD 1.5 img2img** | Character skin generation | ~15s | Paladin UV atlas as base, gamma pre-processing (0.35), style variants preserving UV layout |
| **Claude Sonnet 4.5** | Room/narrative generation | ~5s | Complete room JSON (geometry, objects, NPCs, lighting, exits) from world state via MCP bridge |
| **rembg (u2net)** | Background removal | <1s | Removes backgrounds from generated sprites and model reference images |

## Key Technical Features

- **Engine-independent game logic** — Combat resolver, state machines, enemy AI, and game state ported to TypeScript. 23 tests verify identical results to GDScript against the same `combat_config.json`
- **Deterministic combat replay** — Seeded PRNG in enemy AI produces reproducible combat sequences. Session recorder captures periodic state snapshots for debugging
- **Centralized state store** — Redux-like `dispatch/on/snapshot` pattern. All state readable from anywhere, writes only through events. Enables session recording, replay, and state synchronization across frontends
- **Real-time PBR textures** — Circular padding on UNet Conv2d for seamless tiling, LCM-LoRA for 4-step inference, TAESD for fast VAE. Multiple art styles (anime, dark souls, watercolor, realistic)
- **Character skin generation** — img2img on Paladin UV atlas with gamma correction. One 3D model + shared Mixamo animations = visually distinct characters from text prompts
- **Respawn as core event** — Game events (respawn, damage, death) flow through the logic layer, not as frontend hacks. Both Godot and HTML respond to the same events

## Quick Start

### HTML 2D Client (fastest way to play)

```bash
cd nefan-html && npm install && npm run dev
# Open http://localhost:3000
```

### Godot 3D Client

```bash
# 1. (Optional) Start the TypeScript combat bridge
cd nefan-core && npm install && npm run dev    # port 9877

# 2. Launch Godot
~/Downloads/Godot_v4.6.1-stable_linux.x86_64 \
  --path godot --rendering-method gl_compatibility

# 3. (Optional) AI Server for texture/room generation
source .venv/bin/activate && python ai_server/main.py    # port 8765
```

The game runs without any servers — textures and combat work locally. Each server adds features incrementally.

### Controls

**Godot 3D:**

| Key | Action |
|-----|--------|
| WASD | Movement |
| Shift | Sprint |
| Space | Jump |
| Mouse | Camera (3rd person) |
| E | Interact with object/NPC |
| 1-5 | Select attack type |
| LMB | Execute attack |
| R | Respawn (when dead) |
| F1/F2/F3 | Load test rooms |
| F10 | Toggle session recording |

**HTML 2D:**

| Key | Action |
|-----|--------|
| WASD | Movement |
| Shift | Sprint |
| Mouse | Aim direction |
| LMB | Execute attack |
| 1-5 | Select attack type |
| R | Respawn (when dead) |

## Project Structure

```
ne-fan/
├── nefan-core/                # Shared game logic (TypeScript)
│   ├── src/
│   │   ├── combat/            # Resolver, state machines, manager, enemy AI
│   │   ├── store/             # GameStore (dispatch/subscribe/snapshot)
│   │   ├── simulation/        # GameSimulation tick loop
│   │   └── protocol/          # Frontend ↔ logic message types
│   ├── bridge/
│   │   └── ws-server.ts       # WebSocket bridge for Godot (:9877)
│   └── test/                  # 23 tests against combat_config.json
│
├── nefan-html/                # 2D top-down browser client
│   ├── src/
│   │   ├── renderer/          # Canvas 2D room/entity rendering
│   │   ├── input/             # Keyboard + mouse handler
│   │   └── main.ts            # Game loop, imports nefan-core directly
│   └── index.html             # HUD, attack selector, combat log
│
├── godot/                     # 3D client (Godot 4.6)
│   ├── scripts/
│   │   ├── autoloads/         # GameStore, LogicBridge, SessionRecorder
│   │   ├── combat/            # Combatant, CombatManager, EnemyAI, Animations
│   │   ├── player/            # Controller, interaction
│   │   ├── room/              # Room builder, object spawner, lights
│   │   └── ai_assets/         # Texture/model/sprite loaders
│   ├── data/
│   │   └── combat_config.json # Shared with nefan-core (symlinked)
│   ├── test_rooms/            # Room JSONs (crypt, tavern, style variants)
│   └── assets/characters/     # Mixamo FBX models + animations + skins
│
├── ai_server/                 # Python FastAPI (texture/skin/room generation)
├── narrative-mcp/             # Node.js MCP bridge (Claude ↔ ai_server)
├── docs/                      # Design documents (Spanish)
└── CLAUDE.md                  # Development guide
```

## Hardware Requirements

- **GPU:** NVIDIA RTX 3060 12GB (or equivalent, ~3GB VRAM peak for SD 1.5 fp16)
- **OS:** Linux (tested on Ubuntu, kernel 6.8)
- **CPU:** Ryzen 7 5800X or similar
- **Node.js:** 20+ (for nefan-core and nefan-html)
- **Godot:** 4.6.1 with `gl_compatibility` renderer

## Course

Built for **XCS236: Deep Generative Models** — Stanford Online.

## License

This project uses Mixamo character models and animations (Adobe), which are free for personal and commercial use with an Adobe account.
