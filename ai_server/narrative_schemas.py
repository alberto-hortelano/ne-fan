"""Tool definitions and validation for Claude API narrative engine."""

VALID_MESHES = {"box", "sphere", "capsule", "cylinder", "cone", "plane", "torus"}

NARRATIVE_SYSTEM_PROMPT = """You are the narrative engine of a dark fantasy RPG. You generate world content as structured data.

RULES:
- Every object you create must have a vivid, specific visual description (used for AI image generation).
  Bad: "a chest". Good: "a weathered oak chest with rusted iron bands, slightly ajar, faint golden glow inside".
- Descriptions must be in English (used as Stable Diffusion prompts).
- Keep descriptions under 25 words. They will be concatenated with other descriptions.
- Mesh types available: box, sphere, capsule, cylinder, cone, plane, torus.
- Choose mesh by rough silhouette: humanoids=capsule, containers=box, pillars=cylinder, etc.
- Maintain consistency with the world state. Do not contradict established facts.
- Scale emergent content to player level.
- spawn_position values are in Unreal units relative to room origin. Room is roughly 800x800, centered at origin. Z=0 is floor.
- Scale values are multipliers on a 100-unit base mesh. Typical object: [0.3, 0.3, 0.5]. Wall: [8, 0.1, 3].
"""

POPULATE_ROOM_TOOL = {
    "name": "populate_room",
    "description": "Populates a room with objects, enemies and story elements based on the current world state.",
    "input_schema": {
        "type": "object",
        "properties": {
            "room_description": {
                "type": "string",
                "description": "2-3 sentence atmospheric description for the player",
            },
            "objects": {
                "type": "array",
                "description": "Objects to spawn in the room",
                "items": {
                    "type": "object",
                    "properties": {
                        "mesh": {
                            "type": "string",
                            "enum": list(VALID_MESHES),
                            "description": "Primitive mesh shape",
                        },
                        "scale": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 3,
                            "maxItems": 3,
                            "description": "Scale multiplier [x, y, z]",
                        },
                        "description": {
                            "type": "string",
                            "description": "Vivid visual description for AI rendering (English, <25 words)",
                        },
                        "category": {
                            "type": "string",
                            "enum": ["building", "creature", "item", "terrain", "prop"],
                        },
                        "state": {
                            "type": "string",
                            "description": "Current state: intact, damaged, burning, open, locked, etc.",
                        },
                        "mood": {
                            "type": "string",
                            "enum": ["ominous", "peaceful", "mysterious", "hostile", "neutral"],
                        },
                        "spawn_position": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 3,
                            "maxItems": 3,
                            "description": "Position [x, y, z] in Unreal units relative to room origin",
                        },
                    },
                    "required": ["mesh", "scale", "description", "category", "spawn_position"],
                },
                "maxItems": 8,
            },
            "npcs": {
                "type": "array",
                "description": "NPCs to spawn (optional)",
                "items": {
                    "type": "object",
                    "properties": {
                        "mesh": {"type": "string", "enum": ["capsule"]},
                        "scale": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 3,
                            "maxItems": 3,
                        },
                        "description": {"type": "string"},
                        "name": {"type": "string"},
                        "spawn_position": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 3,
                            "maxItems": 3,
                        },
                    },
                    "required": ["mesh", "scale", "description", "name", "spawn_position"],
                },
                "maxItems": 3,
            },
            "ambient_event": {
                "type": "string",
                "description": "Optional atmospheric event (sound, movement, smell)",
            },
        },
        "required": ["room_description", "objects"],
    },
}

# FALLBACK_ROOM was removed. The bridge and ai_server no longer manufacture a
# scripted room when the LLM is unreachable — they raise NarrativeUnavailable
# (HTTP 503) so the caller sees the failure instead of a placeholder.


# --- Extended schema for Godot 3D rooms (Phase 2+) ---

NARRATIVE_SYSTEM_PROMPT_V2 = """You are the narrative engine of Never Ending Fantasy, a dark fantasy RPG. You generate complete 3D rooms as structured data for a Godot 4 engine.

UNITS & COORDINATES:
- All units in METERS. Typical room: 8-15m wide, 3-5m tall.
- Room centered at origin. Floor at y=0. North wall at z=-depth/2, South at z=+depth/2.
- Object position.y=0 means bottom of object touches floor.
- Place objects INSIDE room bounds with 0.5m clearance from walls.

SURFACES:
- texture_prompt: English, for Stable Diffusion. Describe material visually, include "seamless tiling".
- tiling: [columns, rows] texture repeat. Scale with surface size.
- All 4 walls (north, east, south, west) MUST be defined.

EXITS:
- MUST include an exit on entry_wall (provided in world state) leading back.
- 1-3 additional exits to new areas. offset=0 means centered on wall.
- Typical door: size [2.0, 3.0]. target_hint describes what lies beyond.

LIGHTING:
- ambient.color: RGB [0-1]. Dark dungeons: [0.03-0.08, ...]. Warm taverns: [0.08-0.12, ...].
- ambient.intensity: 0.1-0.5. lights: 1-4 per room. Torches=warm orange, magic=cool blue.

OBJECTS (max 10):
- mesh: box, sphere, capsule, cylinder, cone, plane, torus. Pick by silhouette.
- scale: ACTUAL SIZE in meters. Barrel=[0.4, 0.6, 0.4], table=[1.5, 0.75, 0.8], pillar=[0.5, 3.5, 0.5].
- generate_3d=true ONLY for unique/important items. Most use false.
- description: vivid, in Spanish. texture_prompt/model_prompt: English, for AI generation.

NPCs (max 3):
- character_type: one of peasant_female, peasant_male, knight, mage, rogue, soldier.
- animation: ambient animation to play. One of: idle, look_around, breathing, sitting, sitting_talk, talking, drinking, praying, waving, leaning, wounded, lying, arms_crossed, salute.
- scale: body dimensions in meters. Human: [0.5, 1.8, 0.5].
- dialogue_hint: NPC knowledge/role (not shown to player).
- Do NOT use sprite_prompt or model_prompt for NPCs. All NPCs are Mixamo 3D models.

NARRATIVE:
- room_description and ambient_event in Spanish.
- Maintain consistency with world state. Scale to player level.
- Each room should feel distinct but thematically connected.
"""

GENERATE_ROOM_TOOL = {
    "name": "generate_room",
    "description": "Generates a complete 3D room with geometry, lighting, objects, and NPCs.",
    "input_schema": {
        "type": "object",
        "properties": {
            "room_id": {
                "type": "string",
                "description": "Unique identifier like 'crypt_003', 'tavern_cellar_01'",
            },
            "room_description": {
                "type": "string",
                "description": "2-3 sentence atmospheric description in Spanish",
            },
            "dimensions": {
                "type": "object",
                "properties": {
                    "width": {"type": "number", "description": "X axis, 3-20 meters"},
                    "height": {"type": "number", "description": "Y axis, 2.5-6 meters"},
                    "depth": {"type": "number", "description": "Z axis, 3-20 meters"},
                },
                "required": ["width", "height", "depth"],
            },
            "surfaces": {
                "type": "object",
                "properties": {
                    "floor": {
                        "type": "object",
                        "properties": {
                            "texture_prompt": {"type": "string"},
                            "tiling": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                        },
                        "required": ["texture_prompt", "tiling"],
                    },
                    "ceiling": {
                        "type": "object",
                        "properties": {
                            "texture_prompt": {"type": "string"},
                            "tiling": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                        },
                        "required": ["texture_prompt", "tiling"],
                    },
                    "walls": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "side": {"type": "string", "enum": ["north", "east", "south", "west"]},
                                "texture_prompt": {"type": "string"},
                                "tiling": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                            },
                            "required": ["side", "texture_prompt", "tiling"],
                        },
                        "minItems": 4, "maxItems": 4,
                    },
                },
                "required": ["floor", "ceiling", "walls"],
            },
            "exits": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "wall": {"type": "string", "enum": ["north", "east", "south", "west"]},
                        "offset": {"type": "number"},
                        "size": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                        "description": {"type": "string"},
                        "target_hint": {"type": "string"},
                    },
                    "required": ["wall", "offset", "size", "description", "target_hint"],
                },
                "minItems": 1, "maxItems": 4,
            },
            "lighting": {
                "type": "object",
                "properties": {
                    "ambient": {
                        "type": "object",
                        "properties": {
                            "color": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                            "intensity": {"type": "number"},
                        },
                        "required": ["color", "intensity"],
                    },
                    "lights": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["point", "spot"]},
                                "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                                "color": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                                "intensity": {"type": "number"},
                                "range": {"type": "number"},
                            },
                            "required": ["type", "position", "color", "intensity", "range"],
                        },
                        "maxItems": 6,
                    },
                },
                "required": ["ambient", "lights"],
            },
            "objects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "mesh": {"type": "string", "enum": list(VALID_MESHES)},
                        "generate_3d": {"type": "boolean"},
                        "model_prompt": {"type": "string"},
                        "texture_prompt": {"type": "string"},
                        "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "rotation": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "scale": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "description": {"type": "string"},
                        "category": {"type": "string", "enum": ["building", "creature", "item", "terrain", "prop"]},
                        "state": {"type": "string"},
                        "mood": {"type": "string", "enum": ["ominous", "peaceful", "mysterious", "hostile", "neutral"]},
                        "interactive": {"type": "boolean"},
                    },
                    "required": ["id", "mesh", "position", "scale", "description", "category"],
                },
                "maxItems": 10,
            },
            "npcs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "name": {"type": "string"},
                        "character_type": {
                            "type": "string",
                            "enum": ["peasant_female", "peasant_male", "knight", "mage", "rogue", "soldier"],
                            "description": "Mixamo 3D character model type",
                        },
                        "animation": {
                            "type": "string",
                            "enum": ["idle", "look_around", "breathing", "sitting", "sitting_talk",
                                     "talking", "drinking", "praying", "waving", "leaning",
                                     "wounded", "lying", "arms_crossed", "salute"],
                            "description": "Ambient animation to play (default: idle)",
                        },
                        "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "rotation": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "scale": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "description": {"type": "string"},
                        "dialogue_hint": {"type": "string"},
                    },
                    "required": ["id", "name", "character_type", "position", "description"],
                },
                "maxItems": 3,
            },
            "ambient_event": {"type": "string"},
        },
        "required": ["room_id", "room_description", "dimensions", "surfaces", "exits", "lighting", "objects", "ambient_event"],
    },
}

# FALLBACK_EXTENDED_ROOM also removed; same reasoning.


def validate_extended_room_response(data: dict) -> dict:
    """Validate and sanitize LLM-generated extended room data."""
    import uuid as _uuid

    data.setdefault("room_id", f"room_{_uuid.uuid4().hex[:8]}")
    data.setdefault("room_description", "Una sala oscura.")
    data.setdefault("ambient_event", "")

    # Dimensions
    dims = data.setdefault("dimensions", {"width": 10.0, "height": 4.0, "depth": 8.0})
    dims["width"] = max(3.0, min(float(dims.get("width", 10.0)), 25.0))
    dims["height"] = max(2.5, min(float(dims.get("height", 4.0)), 8.0))
    dims["depth"] = max(3.0, min(float(dims.get("depth", 8.0)), 25.0))

    # Surfaces
    surfaces = data.setdefault("surfaces", {})
    surfaces.setdefault("floor", {"texture_prompt": "stone floor, dark, seamless tiling", "tiling": [2, 2]})
    surfaces.setdefault("ceiling", {"texture_prompt": "stone ceiling, seamless tiling", "tiling": [2, 2]})
    walls = surfaces.get("walls", [])
    existing_sides = {w.get("side") for w in walls if isinstance(w, dict)}
    for side in ["north", "east", "south", "west"]:
        if side not in existing_sides:
            walls.append({"side": side, "texture_prompt": "stone wall, seamless tiling", "tiling": [2, 1]})
    surfaces["walls"] = walls[:4]

    # Exits
    exits = data.get("exits", [])
    if not exits:
        exits = [{"wall": "south", "offset": 0, "size": [2.0, 3.0], "description": "salida", "target_hint": "passage"}]
    for ex in exits:
        ex.setdefault("offset", 0)
        ex.setdefault("size", [2.0, 3.0])
        ex.setdefault("description", "an opening")
        ex.setdefault("target_hint", "unknown")
    data["exits"] = exits[:4]

    # Lighting
    lighting = data.setdefault("lighting", {})
    lighting.setdefault("ambient", {"color": [0.05, 0.03, 0.02], "intensity": 0.3})
    lighting.setdefault("lights", [{"type": "point", "position": [0, 3, 0], "color": [1, 0.8, 0.4], "intensity": 1.5, "range": 8}])
    lighting["lights"] = lighting["lights"][:6]

    # Objects
    w, d = dims["width"], dims["depth"]
    objects = data.get("objects", [])[:10]
    for obj in objects:
        obj.setdefault("id", f"obj_{_uuid.uuid4().hex[:6]}")
        if obj.get("mesh") not in VALID_MESHES:
            obj["mesh"] = "box"
        obj.setdefault("scale", [0.5, 0.5, 0.5])
        if len(obj["scale"]) != 3:
            obj["scale"] = [0.5, 0.5, 0.5]
        obj["scale"] = [max(0.05, min(float(s), 10.0)) for s in obj["scale"]]
        obj.setdefault("position", [0, 0, 0])
        pos = obj["position"]
        if len(pos) == 3:
            pos[0] = max(-w / 2 + 0.5, min(float(pos[0]), w / 2 - 0.5))
            pos[1] = max(0, float(pos[1]))
            pos[2] = max(-d / 2 + 0.5, min(float(pos[2]), d / 2 - 0.5))
        obj.setdefault("rotation", [0, 0, 0])
        obj.setdefault("description", "un objeto misterioso")
        obj.setdefault("category", "prop")
        obj.setdefault("state", "intact")
        obj.setdefault("mood", "neutral")
        obj.setdefault("generate_3d", False)
        obj.setdefault("interactive", False)
    data["objects"] = objects

    # NPCs
    valid_character_types = {"peasant_female", "peasant_male", "knight", "mage", "rogue", "soldier"}
    valid_animations = {"idle", "look_around", "breathing", "sitting", "sitting_talk",
                        "talking", "drinking", "praying", "waving", "leaning",
                        "wounded", "lying", "arms_crossed", "salute"}
    npcs = data.get("npcs", [])[:3]
    for npc in npcs:
        npc.setdefault("id", f"npc_{_uuid.uuid4().hex[:6]}")
        npc.setdefault("name", "Desconocido")
        npc.setdefault("scale", [0.5, 1.8, 0.5])
        npc.setdefault("position", [0, 0, 0])
        npc.setdefault("rotation", [0, 0, 0])
        npc.setdefault("description", "una figura sombria")
        npc.setdefault("dialogue_hint", "")
        npc.setdefault("character_type", "peasant_male")
        npc.setdefault("animation", "idle")
        if npc["character_type"] not in valid_character_types:
            npc["character_type"] = "peasant_male"
        if npc["animation"] not in valid_animations:
            npc["animation"] = "idle"
        # Remove legacy fields
        npc.pop("sprite_prompt", None)
        npc.pop("model_prompt", None)
        npc.pop("generate_3d", None)
    data["npcs"] = npcs

    return data


GENERATE_SCENE_SYSTEM_PROMPT = """You are the world builder of Never Ending Fantasy, a dark fantasy RPG. You produce TOP-DOWN 2D MAPS as a structured grid plus a list of named entities. The game engine takes your output and renders it; the narrative engine reads it to reason about where things are.

OUTPUT SHAPE — "Map Format D" — ALWAYS this exact structure, nothing else:

{
  "scene_id": "<slug, e.g. 'tavern_clearing' or 'forest_path'>",
  "place_id": "<optional: the world-map place id this scene realizes>",
  "scene_description": "<2-3 sentences in Spanish describing the scene>",
  "size":  { "cols": <int>, "rows": <int>, "meters_per_cell": 2 },
  "terrain": [
    "<string of EXACTLY `cols` chars>",
    ...   // EXACTLY `rows` strings total
  ],
  "terrain_legend": { "<char>": "<terrain name>", ... },
  "entities": [
    {
      "id":        "<unique slug, e.g. 'tavern_main', 'tree_n1', 'boris'>",
      "kind":      "building" | "prop" | "item" | "tree" | "npc" | "player",
      "name":      "<spanish display name>",
      "cell":      [<col>, <row>],       // 0-indexed; top-left of footprint
      "footprint": [<width_cells>, <height_cells>],
      "glyph":     "<one ASCII char, must be different from terrain chars>"
    },
    ...
  ],
  "ambient_event": "<one Spanish sentence of atmospheric flavour>"
}

COORDINATE SYSTEM
- Top-left is (0,0). Col grows EAST, row grows SOUTH.
- meters_per_cell is always 2 (so a 30×20 grid is 60 m × 40 m of world).

GRID SIZES (pick what suits the scene)
- Small scene (a clearing, a cabin and surroundings): 16×10 to 24×16.
- Town square / village: 32×24 to 48×30.
- Big town: 48×30 to 60×40.
- Never larger than 80×60.

TERRAIN CHARS — reserved (you do not need to declare these in terrain_legend, but it doesn't hurt)
- "g" grass (default)         - "_" path / dirt road        - "s" stone / paved
- "w" water (river / pond)    - "b" bridge (wood over water)
- "d" dirt / tilled soil      - "a" sand (river bank)       - "o" wood (planks / dock)
You may invent additional chars (lowercase letters or "~", "-", ":") and document them in terrain_legend.

ENTITY RULES
- Every entity has a UNIQUE `id`. Two trees in different places need different ids (`tree_n1`, `tree_w2`) even with the same `name` ("roble").
- `cell` is the TOP-LEFT of the footprint. `cell + footprint` must stay inside the grid.
- Buildings: ONE rectangular footprint (a tavern is one rectangle, not four wall slabs). Typical size 4×3 to 8×6 cells.
- Props are usually 1×1 (barrel, lantern, well). Carts/log piles can be 2×1 or 3×2.
- NPCs and player are always 1×1.
- Place NPCs at their work spot (smith near the smithy, innkeeper at the inn's door).
- The player sits where the narrative says the player ENTERS the scene.

GLYPH RULES (critical for ASCII debug rendering)
- Glyph must be a SINGLE printable ASCII char.
- Glyph must NOT equal any terrain char in the same map (so an entity over grass "g" cannot have glyph "g").
- Glyphs CAN repeat across entities of the same kind (e.g. all trees use "T") because each entity has its own id. The narrative engine uses the id, not the glyph.

NPCs
- Yes, include the NPCs that belong to this scene as `kind: "npc"` entities. The narrative engine reads them by id.
- Use Spanish first names (Boris, Greta, Mirla, Tomás, Halmar, Yannis, etc.) and a short title ("Boris el Herrero").

ASSET REUSE
- The request may include `available_assets`: a list of cached textures/models with hashes and prompts. If a cached prompt matches what you'd want for an entity, add `"texture_hash": "<hash>"` or `"model_hash": "<hash>"` to that entity. Optional but encouraged for visual consistency across scenes.

VALIDATION CHECKLIST — before calling narrative_respond:
- [ ] All `terrain` rows are strings of EXACTLY `size.cols` chars.
- [ ] Number of `terrain` rows equals `size.rows`.
- [ ] Every char that appears in `terrain` is reserved OR documented in `terrain_legend`.
- [ ] Every entity has all required fields.
- [ ] No two entities share an `id`.
- [ ] No entity's footprint runs off the grid.
- [ ] Every glyph differs from every terrain char.

EXAMPLE — claro del cazador, 16 cols × 10 rows:
{
  "scene_id": "claro_cazador",
  "scene_description": "Un claro pequeño en lo profundo del bosque. Una cabaña baja humea perezosamente y un sendero pisado lleva al sur.",
  "size": { "cols": 16, "rows": 10, "meters_per_cell": 2 },
  "terrain": [
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggggggg__gggggg",
    "gggggggg__gggggg",
    "gggggggg__gggggg",
    "gggggggg__gggggg",
    "gggggggg__gggggg"
  ],
  "terrain_legend": { "g": "grass", "_": "path" },
  "entities": [
    { "id": "cabin",      "kind": "building", "name": "Cabaña del Cazador", "cell": [7, 2], "footprint": [6, 3], "glyph": "H" },
    { "id": "fire_pit",   "kind": "prop",     "name": "hoguera",            "cell": [10, 6], "footprint": [1, 1], "glyph": "f" },
    { "id": "tree_n1",    "kind": "tree",     "name": "pino",               "cell": [2, 1],  "footprint": [1, 1], "glyph": "T" },
    { "id": "tree_n2",    "kind": "tree",     "name": "pino",               "cell": [13, 1], "footprint": [1, 1], "glyph": "T" },
    { "id": "tree_s",     "kind": "tree",     "name": "roble",              "cell": [3, 8],  "footprint": [1, 1], "glyph": "T" },
    { "id": "hunter",     "kind": "npc",      "name": "Tarald el Cazador",  "cell": [11, 5], "footprint": [1, 1], "glyph": "n" },
    { "id": "player",     "kind": "player",   "name": "Tú",                 "cell": [9, 9],  "footprint": [1, 1], "glyph": "@" }
  ],
  "ambient_event": "Una rama cruje en algún lugar tras los pinos y el humo de la chimenea huele a pino quemado."
}
"""

GENERATE_SCENE_TOOL = {
    "name": "generate_scene",
    "description": (
        "Generates a top-down 2D map in Map Format D: a terrain grid (ASCII strings) "
        "plus a list of named entities with cell + footprint. The narrative engine reads "
        "it to know what is where; the game engine renders it. See system prompt for the "
        "full schema and a worked example."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "scene_id": {
                "type": "string",
                "description": "Unique slug identifying this map (e.g. 'tavern_clearing', 'robledo_village').",
            },
            "place_id": {
                "type": "string",
                "description": "Optional. The world-map place id this scene realizes; the engine binds the scene to that place.",
            },
            "scene_description": {
                "type": "string",
                "description": "2-3 sentence description of the scene, in Spanish.",
            },
            "size": {
                "type": "object",
                "properties": {
                    "cols": {"type": "integer", "minimum": 12, "maximum": 80},
                    "rows": {"type": "integer", "minimum": 8, "maximum": 60},
                    "meters_per_cell": {"type": "number", "description": "Always 2."},
                },
                "required": ["cols", "rows", "meters_per_cell"],
            },
            "terrain": {
                "type": "array",
                "description": (
                    "Exactly `rows` strings, each EXACTLY `cols` characters wide. "
                    "Each char is a terrain glyph (g=grass, w=water, _=path, s=stone, "
                    "b=bridge, d=dirt, a=sand, o=wood, or any char you define in terrain_legend)."
                ),
                "items": {"type": "string"},
            },
            "terrain_legend": {
                "type": "object",
                "description": (
                    "Mapping from terrain char to terrain name. Reserved chars don't need to "
                    "appear here. Add any custom terrain chars you used."
                ),
                "additionalProperties": {"type": "string"},
            },
            "entities": {
                "type": "array",
                "description": "Every thing on the map that is NOT terrain.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Unique slug (lowercase + underscore).",
                        },
                        "kind": {
                            "type": "string",
                            "enum": ["building", "prop", "item", "tree", "npc", "player"],
                        },
                        "name": {"type": "string", "description": "Spanish display name."},
                        "cell": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 2,
                            "maxItems": 2,
                            "description": "[col, row] of the top-left of the footprint.",
                        },
                        "footprint": {
                            "type": "array",
                            "items": {"type": "integer", "minimum": 1},
                            "minItems": 2,
                            "maxItems": 2,
                            "description": "[width_cells, height_cells]; usually [1,1] for props/NPCs.",
                        },
                        "glyph": {
                            "type": "string",
                            "description": "A single printable ASCII char, distinct from terrain chars.",
                        },
                        "texture_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached texture by 16-char hash from available_assets.",
                        },
                        "model_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached 3D model by hash.",
                        },
                    },
                    "required": ["id", "kind", "name", "cell", "footprint", "glyph"],
                },
                "maxItems": 80,
            },
            "ambient_event": {
                "type": "string",
                "description": "One Spanish sentence of atmospheric flavour (wind, birdsong, smell of stew, etc.).",
            },
        },
        "required": ["scene_id", "scene_description", "size", "terrain", "terrain_legend", "entities", "ambient_event"],
    },
}


RESERVED_TERRAIN = {
    "g": "grass", "w": "water", "_": "path", "s": "stone",
    "b": "bridge", "d": "dirt", "a": "sand", "o": "wood",
}

VALID_ENTITY_KINDS = {"building", "prop", "item", "tree", "npc", "player"}


def validate_scene_response(data: dict) -> dict:
    """Validate and sanitize a Map Format D scene returned by the LLM.

    Tolerant pass: when the LLM gets a field slightly wrong (wrong row length,
    glyph collision, footprint out of bounds, missing glyph) we trim/fix it
    instead of rejecting the whole map. Truly broken responses degrade to a
    minimal grass-only fallback so the client never gets a 500.
    """
    import uuid as _uuid

    # ── Identity & description ───────────────────────────────────────────
    scene_id = (
        data.get("scene_id")
        or data.get("room_id")  # legacy alias
        or f"scene_{_uuid.uuid4().hex[:8]}"
    )
    data["scene_id"] = scene_id
    # Keep `room_id` as alias so older clients keep working.
    data["room_id"] = scene_id
    data["scene_description"] = (
        data.get("scene_description") or data.get("room_description") or "Un paraje desolado."
    )
    data["room_description"] = data["scene_description"]
    data["ambient_event"] = data.get("ambient_event") or ""

    # ── Size ─────────────────────────────────────────────────────────────
    size = data.get("size") or {}
    cols = int(size.get("cols") or 24)
    rows = int(size.get("rows") or 16)
    mpc = float(size.get("meters_per_cell") or 2)
    cols = max(12, min(cols, 80))
    rows = max(8, min(rows, 60))
    data["size"] = {"cols": cols, "rows": rows, "meters_per_cell": mpc}

    # ── Terrain grid ─────────────────────────────────────────────────────
    raw_terrain = data.get("terrain")
    if not isinstance(raw_terrain, list) or not raw_terrain:
        # Old schema with `terrain: { type, texture_prompt }` — replace with empty grass.
        raw_terrain = []

    # Normalize each row to exactly `cols` chars: pad with "g" or truncate.
    normalized = []
    for r in range(rows):
        if r < len(raw_terrain) and isinstance(raw_terrain[r], str):
            row = raw_terrain[r]
        else:
            row = ""
        if len(row) > cols:
            row = row[:cols]
        elif len(row) < cols:
            row = row + ("g" * (cols - len(row)))
        normalized.append(row)
    data["terrain"] = normalized

    # ── Terrain legend ───────────────────────────────────────────────────
    legend = data.get("terrain_legend")
    if not isinstance(legend, dict):
        legend = {}
    # Ensure every char used in terrain has an entry (default = grass for unknown).
    used_chars = set("".join(normalized))
    for ch in used_chars:
        if ch not in legend and ch not in RESERVED_TERRAIN:
            legend[ch] = "grass"
    # Merge reserved (the legend takes precedence if LLM redefined a char).
    for ch, name in RESERVED_TERRAIN.items():
        legend.setdefault(ch, name)
    data["terrain_legend"] = legend

    # ── Entities ─────────────────────────────────────────────────────────
    raw_entities = data.get("entities")
    if not isinstance(raw_entities, list):
        raw_entities = []
    terrain_chars = set(legend.keys())

    seen_ids: set = set()
    cleaned: list = []
    for ent in raw_entities[:80]:
        if not isinstance(ent, dict):
            continue
        eid = ent.get("id") or f"ent_{_uuid.uuid4().hex[:6]}"
        if eid in seen_ids:
            eid = f"{eid}_{_uuid.uuid4().hex[:4]}"
        seen_ids.add(eid)

        kind = ent.get("kind") or "prop"
        if kind not in VALID_ENTITY_KINDS:
            kind = "prop"

        cell = ent.get("cell") or [0, 0]
        if not (isinstance(cell, list) and len(cell) == 2):
            cell = [0, 0]
        col = max(0, min(int(cell[0]), cols - 1))
        row = max(0, min(int(cell[1]), rows - 1))

        fp = ent.get("footprint") or [1, 1]
        if not (isinstance(fp, list) and len(fp) == 2):
            fp = [1, 1]
        w = max(1, min(int(fp[0]), cols - col))
        h = max(1, min(int(fp[1]), rows - row))

        glyph = ent.get("glyph")
        if not (isinstance(glyph, str) and len(glyph) == 1) or glyph in terrain_chars:
            # Pick a fallback glyph that's not used as terrain.
            fallback_pool = "?xyzqXYZQ#&%$*+!"
            glyph = next(
                (c for c in fallback_pool if c not in terrain_chars),
                "?",
            )

        clean_ent = {
            "id": eid,
            "kind": kind,
            "name": ent.get("name") or eid,
            "cell": [col, row],
            "footprint": [w, h],
            "glyph": glyph,
        }
        if isinstance(ent.get("texture_hash"), str):
            clean_ent["texture_hash"] = ent["texture_hash"]
        if isinstance(ent.get("model_hash"), str):
            clean_ent["model_hash"] = ent["model_hash"]
        cleaned.append(clean_ent)
    data["entities"] = cleaned

    # ── Strip legacy fields the new schema doesn't use ───────────────────
    for legacy in ("dimensions", "sky", "fog", "vegetation", "lighting", "exits",
                   "npcs", "objects", "surfaces", "zone_type"):
        data.pop(legacy, None)

    return data


def validate_room_response(data: dict) -> dict:
    """Validate and clamp LLM response to safe values."""
    # Ensure required fields
    if "room_description" not in data:
        data["room_description"] = "A dark chamber."
    if "objects" not in data:
        data["objects"] = []

    # Cap objects
    data["objects"] = data["objects"][:8]

    for obj in data["objects"]:
        # Validate mesh type
        if obj.get("mesh") not in VALID_MESHES:
            obj["mesh"] = "box"

        # Clamp scale
        if "scale" not in obj or len(obj["scale"]) != 3:
            obj["scale"] = [0.5, 0.5, 0.5]
        obj["scale"] = [max(0.05, min(s, 10.0)) for s in obj["scale"]]

        # Ensure spawn_position
        if "spawn_position" not in obj or len(obj["spawn_position"]) != 3:
            obj["spawn_position"] = [0, 0, 0]

        # Defaults
        obj.setdefault("category", "prop")
        obj.setdefault("state", "intact")
        obj.setdefault("mood", "neutral")
        obj.setdefault("description", "a mysterious object")

    # Validate NPCs
    data.setdefault("npcs", [])
    data["npcs"] = data["npcs"][:3]
    for npc in data["npcs"]:
        npc.setdefault("mesh", "capsule")
        npc.setdefault("scale", [1.0, 1.0, 1.8])
        npc.setdefault("description", "a shadowy figure")
        npc.setdefault("name", "Stranger")
        npc.setdefault("spawn_position", [0, 0, 0])

    data.setdefault("ambient_event", "")

    return data


# ----------------------------------------------------------------------
# Weapon orientation (vision-guided)
# ----------------------------------------------------------------------

WEAPON_ORIENT_SYSTEM_PROMPT = """You orient 3D weapon meshes for a third-person RPG.

Input: 3 orthographic renders of an isolated weapon model on white background:
- front: camera at +Z looking toward origin (X axis right, Y axis up)
- side:  camera at +X looking toward origin (Z axis right, Y axis up)
- top:   camera at +Y looking down (X axis right, -Z into screen)

The mesh is centered on its bounding box. Positions you return are normalized
to [0,1]^3 where (0,0,0) is the bbox min and (1,1,1) is the bbox max.

Identify:
1. grip_point_normalized: where the hand wraps the weapon (cylindrical wrapped
   area for swords, center of back face for shields, bottom of haft for axes/maces).
2. blade_direction: unit vector from grip toward tip/edge/front of the weapon.
3. up_direction: unit vector perpendicular to blade_direction, the "up" face
   (back of sword blade, front of shield, top of axe head).

Right-handed coordinates throughout. All unit vectors must be normalized.
Confidence: 0.9+ if grip and blade are clearly visible; 0.5-0.8 if uncertain;
<0.5 if mesh looks broken or you cannot identify the weapon.

Always respond via the orient_weapon tool — never emit free-form text."""


WEAPON_ORIENT_TOOL = {
    "name": "orient_weapon",
    "description": "Return the grip point and orientation vectors for a 3D weapon mesh.",
    "input_schema": {
        "type": "object",
        "required": [
            "grip_point_normalized",
            "blade_direction",
            "up_direction",
            "weapon_type",
            "confidence",
        ],
        "properties": {
            "grip_point_normalized": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Grip point in normalized bbox space [0..1]^3",
            },
            "blade_direction": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Unit vector: from grip toward tip/edge/front",
            },
            "up_direction": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 3,
                "maxItems": 3,
                "description": "Unit vector: perpendicular to blade_direction, 'up' face",
            },
            "weapon_type": {
                "type": "string",
                "enum": [
                    "sword", "shield", "axe", "mace", "staff",
                    "bow", "dagger", "spear", "generic",
                ],
            },
            "grip_length_normalized": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "Fraction of the weapon length occupied by the grip",
            },
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
            "notes": {
                "type": "string",
                "description": "Short rationale for debugging",
            },
        },
    },
}


def validate_weapon_orient_response(data: dict) -> dict | None:
    """Validate and normalize a weapon orientation response from the LLM.

    Returns None if the response is malformed beyond repair.
    """
    if not isinstance(data, dict):
        return None

    # Required vector fields
    for field in ("grip_point_normalized", "blade_direction", "up_direction"):
        v = data.get(field)
        if not isinstance(v, list) or len(v) != 3:
            return None
        try:
            data[field] = [float(x) for x in v]
        except (TypeError, ValueError):
            return None

    # Clamp grip point to [0, 1]
    data["grip_point_normalized"] = [
        max(0.0, min(1.0, x)) for x in data["grip_point_normalized"]
    ]

    # Normalize direction vectors
    def _normalize(v: list) -> list | None:
        length = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
        if length < 1e-6:
            return None
        return [v[0] / length, v[1] / length, v[2] / length]

    blade = _normalize(data["blade_direction"])
    up = _normalize(data["up_direction"])
    if blade is None or up is None:
        return None
    data["blade_direction"] = blade
    data["up_direction"] = up

    # Reject if blade and up are nearly parallel (degenerate frame)
    dot = abs(blade[0] * up[0] + blade[1] * up[1] + blade[2] * up[2])
    if dot > 0.95:
        return None

    # Defaults for optional fields
    data.setdefault("weapon_type", "generic")
    data.setdefault("grip_length_normalized", 0.15)
    data.setdefault("notes", "")
    try:
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        data["confidence"] = 0.5

    return data


# ============================================================================
# Narrative event reaction (Phase 3) — Claude reacts to player dialogue choices
# by emitting consequences that the engine applies to the open world.
# ============================================================================

NARRATIVE_REACT_SYSTEM_PROMPT = """You are the narrative engine of a dark fantasy open-world RPG.

A player has just answered an NPC — either by picking a scripted option or by
typing a free-form reply. When they type free text, the scripted scenario is
PAUSED waiting for you to decide what happens next. Your response drives the
story: you can make NPCs speak, update the running story, schedule events, or
materialize new entities.

You will receive:
- speaker: the NPC who spoke
- chosen_text: which canned option they picked (may be empty if they typed)
- free_text: a free-form reply they typed (may be empty)
- context: a compact NarrativeState snapshot (story_so_far, recent_dialogues,
  entities already in the world, current scene id, available_assets)

CRITICAL — when free_text is non-empty:
- The player has gone off-script. You MUST respond with at least one `dialogue`
  consequence so a visible NPC reacts in-world. Stay in character.
- The `dialogue` speaker should normally be an NPC that is already present in
  `entities` (use the same display name). It can be the `speaker` you received
  or another NPC in the scene.
- You may also add other consequences (story_update, spawn_entity) when the
  player expressed intent. Example: free_text says "I want a sword from a
  forge" → add a spawn_entity (forge building) AND a dialogue line where an
  NPC acknowledges "There's an old forge at the edge of town, follow me".
- Write dialogue text in the same language the player used (match free_text).

CRITICAL — when free_text is empty (numbered choice only):
- The scripted scenario will advance on its own. Usually return empty
  consequences, unless the choice strongly implies a world reaction.

RULES:
- Do NOT spawn things that are already in `entities`.
- Reuse `available_assets` (by hash) when generating new entities, when sensible.
- Be sparing — 0–4 consequences max. Prefer one dialogue + optional side effects.
- Position spawns plausibly relative to the player using `position_hint`.
- Return your answer ONLY via the react_to_player tool. Never write free text.
"""

NARRATIVE_REACT_TOOL = {
    "name": "react_to_player",
    "description": "Decide if the player's dialogue choice/free-text reshapes the open world. Return zero or more consequences.",
    "input_schema": {
        "type": "object",
        "required": ["consequences"],
        "properties": {
            "consequences": {
                "type": "array",
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "required": ["type"],
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["dialogue", "story_update", "spawn_entity", "schedule_event", "noop"],
                        },
                        # dialogue — an NPC reacts in-world with spoken lines.
                        # REQUIRED for free_text responses.
                        "speaker": {
                            "type": "string",
                            "description": "Display name of the NPC who speaks. Prefer an NPC already in `entities`.",
                        },
                        "text": {
                            "type": "string",
                            "description": "What the NPC says. Write in the same language as the player's free_text.",
                        },
                        "choices": {
                            "type": "array",
                            "items": {"type": "string"},
                            "maxItems": 3,
                            "description": "Optional 2-3 follow-up options for the player.",
                        },
                        # story_update
                        "delta": {
                            "type": "string",
                            "description": "Incremental update to story_so_far (1-3 sentences).",
                        },
                        # spawn_entity
                        "entity_kind": {
                            "type": "string",
                            "enum": ["npc", "building", "object"],
                        },
                        "description": {
                            "type": "string",
                            "description": "Vivid English description of the entity (used for asset generation).",
                        },
                        "name": {
                            "type": "string",
                            "description": "Display name for an NPC entity.",
                        },
                        "position_hint": {
                            "type": "string",
                            "description": "Plausible placement: near_player, distant_east, distant_north, etc.",
                        },
                        "texture_hash": {
                            "type": "string",
                            "description": "Reuse a cached texture by hash from available_assets.",
                        },
                        "model_hash": {
                            "type": "string",
                            "description": "Reuse a cached GLB by hash from available_assets.",
                        },
                        # schedule_event
                        "trigger": {
                            "type": "string",
                            "description": "When the scheduled event fires: next_scene, timer:60s, on_player_action:..",
                        },
                    },
                },
            },
        },
    },
}


def validate_narrative_reaction(data: dict | None) -> dict:
    """Validate a Claude response to react_to_player.

    Strict mode — accepted types are exactly {dialogue, story_update,
    spawn_entity, schedule_event, noop}. Any deviation (aliases like
    show_dialogue, text instead of delta, missing required fields, malformed
    kinds) raises ValueError. The bridge surfaces the error to the client; the
    operator fixes the narrative engine's prompt.
    """
    if not isinstance(data, dict):
        raise ValueError(f"react_to_player payload must be an object, got {type(data).__name__}")
    raw = data.get("consequences")
    if not isinstance(raw, list):
        raise ValueError("react_to_player payload missing list `consequences`")
    if len(raw) > 4:
        raise ValueError(f"react_to_player returned {len(raw)} consequences, max is 4")

    valid_types = {"dialogue", "story_update", "spawn_entity", "schedule_event", "noop"}
    valid_kinds = {"npc", "building", "object"}
    out: list[dict] = []
    for idx, c in enumerate(raw):
        if not isinstance(c, dict):
            raise ValueError(f"consequence[{idx}] is not an object")
        t = c.get("type")
        if t not in valid_types:
            raise ValueError(
                f"consequence[{idx}].type='{t}' is invalid; allowed: {sorted(valid_types)}"
            )
        if t == "noop":
            continue
        if t == "dialogue":
            speaker = str(c.get("speaker", "")).strip()
            text = str(c.get("text", "")).strip()
            if not speaker:
                raise ValueError(f"dialogue[{idx}] missing required field `speaker`")
            if not text:
                raise ValueError(f"dialogue[{idx}] missing required field `text`")
            entry: dict = {"type": "dialogue", "speaker": speaker, "text": text}
            raw_choices = c.get("choices")
            if raw_choices is not None:
                if not isinstance(raw_choices, list):
                    raise ValueError(f"dialogue[{idx}].choices must be a list")
                trimmed = [str(x).strip() for x in raw_choices if str(x).strip()]
                if trimmed:
                    if len(trimmed) > 3:
                        raise ValueError(f"dialogue[{idx}].choices has {len(trimmed)} entries, max is 3")
                    entry["choices"] = trimmed
            out.append(entry)
        elif t == "story_update":
            delta_raw = c.get("delta")
            if not isinstance(delta_raw, str) or not delta_raw.strip():
                raise ValueError(
                    f"story_update[{idx}] missing required field `delta` (non-empty string)"
                )
            out.append({"type": "story_update", "delta": delta_raw.strip()})
        elif t == "spawn_entity":
            kind = c.get("entity_kind")
            if kind not in valid_kinds:
                raise ValueError(
                    f"spawn_entity[{idx}].entity_kind='{kind}' invalid; allowed: {sorted(valid_kinds)}"
                )
            description = str(c.get("description", "")).strip()
            if not description:
                raise ValueError(f"spawn_entity[{idx}] missing required field `description`")
            entry = {
                "type": "spawn_entity",
                "entity_kind": kind,
                "description": description,
                "position_hint": str(c.get("position_hint", "near_player")),
            }
            if c.get("name"):
                entry["name"] = str(c["name"])
            if c.get("texture_hash"):
                entry["texture_hash"] = str(c["texture_hash"])
            if c.get("model_hash"):
                entry["model_hash"] = str(c["model_hash"])
            out.append(entry)
        elif t == "schedule_event":
            description = str(c.get("description", "")).strip()
            if not description:
                raise ValueError(f"schedule_event[{idx}] missing required field `description`")
            out.append({
                "type": "schedule_event",
                "description": description,
                "trigger": str(c.get("trigger", "next_scene")),
            })
    return {"consequences": out}
