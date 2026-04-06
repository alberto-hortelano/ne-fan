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

FALLBACK_ROOM = {
    "room_description": "A dimly lit stone chamber. Dust motes drift through stale air. The walls bear scratch marks from ages past.",
    "objects": [
        {
            "mesh": "cylinder",
            "scale": [0.3, 0.3, 0.5],
            "description": "old wooden barrel with iron hoops, stained with age",
            "category": "prop",
            "state": "intact",
            "mood": "neutral",
            "spawn_position": [-150, -100, 25],
        },
        {
            "mesh": "cylinder",
            "scale": [0.3, 0.3, 0.5],
            "description": "cracked wooden barrel leaking dark liquid",
            "category": "prop",
            "state": "damaged",
            "mood": "ominous",
            "spawn_position": [-100, -150, 25],
        },
        {
            "mesh": "box",
            "scale": [0.4, 0.3, 0.3],
            "description": "small stone bench worn smooth by countless travelers",
            "category": "prop",
            "state": "intact",
            "mood": "neutral",
            "spawn_position": [200, -50, 15],
        },
        {
            "mesh": "sphere",
            "scale": [0.15, 0.15, 0.15],
            "description": "a broken lantern with faintly glowing embers inside",
            "category": "item",
            "state": "damaged",
            "mood": "mysterious",
            "spawn_position": [0, -200, 80],
        },
    ],
    "npcs": [],
    "ambient_event": "Water drips slowly from the ceiling, echoing in the silence.",
}


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

FALLBACK_EXTENDED_ROOM = {
    "room_id": "fallback_001",
    "room_description": "Una sala de piedra tenuemente iluminada. El polvo flota en el aire viciado.",
    "dimensions": {"width": 10.0, "height": 4.0, "depth": 8.0},
    "surfaces": {
        "floor": {"texture_prompt": "cracked stone floor, dark, seamless tiling", "tiling": [2, 2]},
        "ceiling": {"texture_prompt": "rough stone ceiling, cobwebs, seamless tiling", "tiling": [2, 2]},
        "walls": [
            {"side": "north", "texture_prompt": "damp stone wall, moss patches, seamless tiling", "tiling": [2, 1]},
            {"side": "east", "texture_prompt": "rough stone wall, cracks, seamless tiling", "tiling": [2, 1]},
            {"side": "south", "texture_prompt": "stone wall with archway marks, seamless tiling", "tiling": [2, 1]},
            {"side": "west", "texture_prompt": "stone wall, water stains, seamless tiling", "tiling": [2, 1]},
        ],
    },
    "exits": [
        {"wall": "south", "offset": 0, "size": [2.0, 3.0], "description": "arco de piedra desgastado", "target_hint": "passage back"},
    ],
    "lighting": {
        "ambient": {"color": [0.05, 0.03, 0.02], "intensity": 0.3},
        "lights": [{"type": "point", "position": [0, 3.5, 0], "color": [1.0, 0.7, 0.3], "intensity": 1.5, "range": 8.0}],
    },
    "objects": [
        {"id": "barrel_f1", "mesh": "cylinder", "position": [-3, 0, 2], "scale": [0.4, 0.6, 0.4],
         "description": "barril viejo con aros de hierro", "category": "prop", "generate_3d": False},
        {"id": "crate_f1", "mesh": "box", "position": [2, 0, -1], "scale": [0.5, 0.4, 0.5],
         "description": "caja de madera astillada", "category": "prop", "generate_3d": False},
    ],
    "npcs": [],
    "ambient_event": "Gotas de agua caen lentamente del techo.",
}


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


GENERATE_SCENE_SYSTEM_PROMPT = """You are the world builder of Never Ending Fantasy, a dark fantasy RPG. You generate open-world 3D scenes as structured data for a Godot 4 engine.

IMPORTANT: You do NOT generate enclosed rooms. You generate OUTDOOR SCENES with buildings as objects.

UNITS & COORDINATES:
- All units in METERS. Scene area: 40-80m wide/deep.
- Origin at center. Floor at y=0. +Z is south, -Z is north.
- Object position.y=0 means bottom of object touches ground.

BUILDINGS:
- Buildings are constructed from box meshes: walls, floor, ceiling as separate objects.
- Leave gaps between wall segments for doors/entrances.
- Example tavern wall: mesh=box, scale=[8, 3, 0.2], position=[x, 1.5, z].
- Floor: mesh=box, scale=[width, 0.1, depth], position=[cx, -0.05, cz].
- Ceiling: mesh=box, scale=[width, 0.1, depth], position=[cx, height+0.05, cz].

TERRAIN:
- zone_type MUST be "outdoor".
- terrain.type: "static" (flat ground plane) or "chunked" (infinite heightmap).
- terrain.texture_prompt: English, for SD texture generation.

SKY & FOG:
- sky.time_of_day: "dawn", "day", "dusk", "night".
- fog: density 0.005-0.02, color matching atmosphere.

VEGETATION:
- grass: count 500-2000, radius 20-30m.
- bushes: count 10-30, radius 20-25m.
- trees: count 5-20, ring_inner_radius 15-25m, ring_outer_radius 25-30m.

OBJECTS (max 25):
- mesh: box, sphere, capsule, cylinder, cone, plane, torus.
- scale: ACTUAL SIZE in meters.
- category: building (walls/floors/structure), prop (furniture/barrels/carts), terrain (rocks/logs), item (interactive).
- texture_prompt: English, for SD. Include "seamless tiling".
- description: Spanish.

LIGHTING:
- ambient: RGB [0-1], intensity 0.2-0.5.
- lights: point/spot for torches, lamps, fires. Max 6.
- The directional light (sun/moon) is auto-generated from sky.time_of_day.

NPCs: Do NOT include NPCs in the scene. NPCs are spawned by the narrative scenario system.

Generate a scene_id, room_description (Spanish), and ambient_event (Spanish).
"""

GENERATE_SCENE_TOOL = {
    "name": "generate_scene",
    "description": "Generates an open-world 3D scene with terrain, buildings, objects, and lighting.",
    "input_schema": {
        "type": "object",
        "properties": {
            "room_id": {"type": "string", "description": "Unique scene identifier"},
            "room_description": {"type": "string", "description": "2-3 sentence description in Spanish"},
            "zone_type": {"type": "string", "enum": ["outdoor"], "description": "Always outdoor"},
            "dimensions": {
                "type": "object",
                "properties": {
                    "width": {"type": "number", "description": "X axis, 40-80 meters"},
                    "height": {"type": "number", "description": "Sky height, 20-40"},
                    "depth": {"type": "number", "description": "Z axis, 40-80 meters"},
                },
                "required": ["width", "height", "depth"],
            },
            "terrain": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["static", "chunked"]},
                    "texture_prompt": {"type": "string"},
                },
                "required": ["type", "texture_prompt"],
            },
            "sky": {
                "type": "object",
                "properties": {
                    "time_of_day": {"type": "string", "enum": ["dawn", "day", "dusk", "night"]},
                    "custom_sky_color": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                    "custom_horizon_color": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                },
                "required": ["time_of_day"],
            },
            "fog": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"},
                    "density": {"type": "number"},
                    "color": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                },
            },
            "vegetation": {
                "type": "object",
                "properties": {
                    "grass": {"type": "object", "properties": {"count": {"type": "integer"}, "radius": {"type": "number"}}},
                    "bushes": {"type": "object", "properties": {"count": {"type": "integer"}, "radius": {"type": "number"}}},
                    "trees": {"type": "object", "properties": {
                        "count": {"type": "integer"},
                        "ring_inner_radius": {"type": "number"},
                        "ring_outer_radius": {"type": "number"},
                    }},
                },
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
                        "texture_prompt": {"type": "string"},
                        "model_prompt": {"type": "string"},
                        "generate_3d": {"type": "boolean"},
                        "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "rotation": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "scale": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "description": {"type": "string"},
                        "category": {"type": "string", "enum": ["building", "prop", "terrain", "item"]},
                    },
                    "required": ["id", "mesh", "position", "scale", "description", "category"],
                },
                "maxItems": 25,
            },
            "ambient_event": {"type": "string"},
        },
        "required": ["room_id", "room_description", "zone_type", "dimensions", "terrain", "sky", "lighting", "objects", "ambient_event"],
    },
}


def validate_scene_response(data: dict) -> dict:
    """Validate and sanitize LLM-generated outdoor scene data."""
    import uuid as _uuid

    data.setdefault("room_id", f"scene_{_uuid.uuid4().hex[:8]}")
    data.setdefault("room_description", "Un paraje desolado.")
    data.setdefault("ambient_event", "")
    data["zone_type"] = "outdoor"
    data.setdefault("exits", [])
    data.setdefault("npcs", [])

    # Dimensions
    dims = data.setdefault("dimensions", {"width": 60.0, "height": 30.0, "depth": 60.0})
    dims["width"] = max(30.0, min(float(dims.get("width", 60.0)), 100.0))
    dims["height"] = max(10.0, min(float(dims.get("height", 30.0)), 50.0))
    dims["depth"] = max(30.0, min(float(dims.get("depth", 60.0)), 100.0))

    # Terrain
    terrain = data.setdefault("terrain", {"type": "static", "texture_prompt": "grass and dirt path, seamless"})
    if terrain.get("type") not in ("static", "chunked"):
        terrain["type"] = "static"

    # Sky
    sky = data.setdefault("sky", {"time_of_day": "day"})
    if sky.get("time_of_day") not in ("dawn", "day", "dusk", "night"):
        sky["time_of_day"] = "day"

    # Fog
    data.setdefault("fog", {"enabled": False})

    # Lighting
    lighting = data.setdefault("lighting", {})
    lighting.setdefault("ambient", {"color": [0.15, 0.12, 0.1], "intensity": 0.4})
    lighting.setdefault("lights", [])
    lighting["lights"] = lighting["lights"][:6]

    # Objects
    objects = data.get("objects", [])[:25]
    for obj in objects:
        obj.setdefault("id", f"obj_{_uuid.uuid4().hex[:6]}")
        if obj.get("mesh") not in VALID_MESHES:
            obj["mesh"] = "box"
        obj.setdefault("scale", [1.0, 1.0, 1.0])
        if len(obj.get("scale", [])) != 3:
            obj["scale"] = [1.0, 1.0, 1.0]
        obj["scale"] = [max(0.05, min(float(s), 30.0)) for s in obj["scale"]]
        obj.setdefault("position", [0, 0, 0])
        obj.setdefault("rotation", [0, 0, 0])
        obj.setdefault("description", "un objeto")
        obj.setdefault("category", "prop")
        obj.setdefault("generate_3d", False)
    data["objects"] = objects

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
