# Never Ending Fantasy

**AI-powered dark fantasy RPG with real-time generative content**

A 3D dungeon-crawling RPG built with Godot 4.6 where rooms, textures, character skins, and narrative are generated in real-time using deep generative models. The game features procedurally generated dungeons driven by an LLM, PBR textures created by Stable Diffusion in under 1 second, and character skin variants produced via img2img on UV atlases.

## AI Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     GODOT 4.6 ENGINE                         │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────┐  ┌───────────┐  │
│  │ Room       │  │ Texture    │  │ Combat │  │ Skin      │  │
│  │ Builder    │  │ Loader     │  │ System │  │ Applicator│  │
│  └─────┬──────┘  └─────┬──────┘  └────────┘  └─────┬─────┘  │
│        │               │                           │        │
└────────┼───────────────┼───────────────────────────┼────────┘
         │ HTTP          │ HTTP                      │ HTTP
┌────────┴───────────────┴───────────────────────────┴────────┐
│                  AI SERVER  (FastAPI :8765)                  │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │  SD 1.5       │  │  SD 1.5       │  │ Claude Sonnet   │  │
│  │  + LCM-LoRA   │  │  img2img      │  │ via MCP bridge  │  │
│  │  + TAESD      │  │               │  │                 │  │
│  │               │  │  Character    │  │  Room JSON      │  │
│  │  PBR Textures │  │  Skin Gen     │  │  Generation     │  │
│  │  ~0.5s each   │  │  ~15s each    │  │                 │  │
│  └───────────────┘  └───────────────┘  └────────┬────────┘  │
│                                                  │ WS       │
└──────────────────────────────────────────────────┼──────────┘
                                                   │
                                        ┌──────────┴────────┐
                                        │  MCP Bridge       │
                                        │  (Node.js :3737)  │
                                        │                   │
                                        │  Claude Code      │
                                        │  narrative_listen  │
                                        │  narrative_respond │
                                        └───────────────────┘
```

## Generative Models

| Model | Purpose | Speed | Details |
|-------|---------|-------|---------|
| **SD 1.5 + LCM-LoRA + TAESD** | PBR texture generation | ~0.5s / 512x512 | Seamless tiling via circular padding. 4-step inference. Generates albedo + Sobel normal map |
| **SD 1.5 img2img** | Character skin generation | ~15s | Takes a Paladin UV atlas as base, applies gamma pre-processing (0.35) to brighten dark textures, then generates style variants while preserving UV layout |
| **Claude Sonnet 4.5** | Room/narrative generation | ~5s | Generates complete room JSON (geometry, objects, NPCs, lighting, exits) from world state via MCP bridge |
| **rembg (u2net)** | Background removal | <1s | Removes backgrounds from generated sprites and model reference images |

## Key Technical Features

- **Real-time PBR texture generation** — Circular padding on UNet Conv2d layers produces seamless tiling textures. LCM-LoRA reduces inference to 4 steps. TAESD provides fast VAE decoding. Total: ~0.5s per texture on RTX 3060
- **Character skin generation via img2img** — Uses the Paladin's UV diffuse atlas as img2img input. Gamma correction (γ=0.35) pre-brightens the dark base texture so the model can produce lighter color schemes. Strength 0.5 preserves UV layout while allowing style changes
- **LLM-driven procedural rooms** — Claude generates structured JSON defining room geometry, surface materials, object placement, NPC dialogue, lighting, and exit connections. The MCP bridge connects Claude Code to the game server via WebSocket
- **Shared Mixamo skeleton** — All characters use the same `mixamorig` skeleton, so one animation set (Sword and Shield Pack, 50+ animations) works across all character models. Runtime root motion stripping prevents animation drift by locking the Hips bone XZ position each frame
- **Real-time combat system** — Distance-based hit quality, 5x7 tactical matrix, wind-up timers, enemy AI with personality parameters

## Screenshots

The game generates rooms with AI textures in multiple art styles:

| Anime | Pixel Art | Watercolor |
|-------|-----------|------------|
| Bold outlines, stylized stone | Mosaic-like brick patterns | Warm orange tones, soft edges |

| Realistic | Dark Souls | Classic RPG |
|-----------|------------|-------------|
| Mossy weathered stone | Dark cracked stone, oppressive | Hand-painted oil style |

Character skins are generated via img2img on the Paladin UV atlas, producing visually distinct characters from the same 3D model and animation set.

## Quick Start

```bash
# 1. AI Server (textures, models, sprites, skins, narrative)
cd ~/code/ne-fan
source .venv/bin/activate
python ai_server/main.py                    # port 8765

# 2. Godot (launches directly into the game)
~/Downloads/Godot_v4.6.1-stable_linux.x86_64 \
  --path ~/code/ne-fan/godot \
  --rendering-method gl_compatibility

# 3. MCP narrative bridge (optional — for LLM room generation)
cd narrative-mcp && npm run build && node dist/server.js   # port 3737
```

The game runs without the AI server — it just won't generate new textures/models/rooms.

### Controls

| Key | Action |
|-----|--------|
| WASD | Movement |
| Shift | Sprint |
| Space | Jump |
| Mouse | Camera (3rd person) |
| E | Interact with object/NPC |
| 1-5 | Select attack type |
| LMB | Execute attack |
| F1/F2/F3 | Load test rooms |

## Project Structure

```
ne-fan/
├── godot/                     # Godot 4.6 project
│   ├── scripts/
│   │   ├── player/            # Controller, interaction
│   │   ├── combat/            # Combat system, animations, AI
│   │   ├── room/              # Room builder, object spawner, lights
│   │   ├── ai_assets/         # Texture/model/sprite loaders
│   │   ├── ui/                # HUD, combat UI
│   │   └── autoloads/         # GameState, AIClient, caches
│   ├── data/
│   │   └── combat_config.json # Attack types, weapons, tactical matrix
│   ├── test_rooms/            # JSON room definitions (multiple art styles)
│   └── assets/characters/     # Mixamo FBX models + animations
│
├── ai_server/                 # Python FastAPI backend
│   ├── main.py                # HTTP endpoints
│   ├── texture_generator.py   # SD 1.5 + LCM-LoRA + TAESD
│   ├── skin_generator.py      # img2img character skin generation
│   ├── model_generator.py     # 3D model generation (SD + rembg → GLB)
│   ├── sprite_generator.py    # NPC sprite generation (SD + rembg)
│   ├── llm_client.py          # Claude API / MCP bridge client
│   └── asset_cache.py         # Disk cache by SHA256(prompt)
│
├── narrative-mcp/             # Node.js MCP bridge
│   ├── server.ts              # MCP server (stdio)
│   └── ws-bridge.ts           # WebSocket :3737
│
├── Config/
│   └── ai_server_config.json
│
├── docs/                      # Design documents (Spanish)
└── CLAUDE.md                  # Development guide
```

## Hardware Requirements

- **GPU:** NVIDIA RTX 3060 12GB (or equivalent, ~3GB VRAM peak for SD 1.5 fp16)
- **OS:** Linux (tested on Ubuntu, kernel 6.8)
- **CPU:** Ryzen 7 5800X or similar
- **Godot:** 4.6.1 with `gl_compatibility` renderer

## Dependencies

```bash
# Python (ai_server)
pip install -r ai_server/requirements.txt
# Key: torch, diffusers, transformers, fastapi, uvicorn, rembg, trimesh

# Node.js (narrative-mcp)
cd narrative-mcp && npm install
```

## Course

Built for **XCS236: Deep Generative Models** — Stanford Online.

## License

This project uses Mixamo character models and animations (Adobe), which are free for personal and commercial use with an Adobe account.
