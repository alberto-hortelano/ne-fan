"""Tool definitions and validation for Claude API narrative engine."""

GENERATE_SCENE_SYSTEM_PROMPT = """You are the world builder of Never Ending Fantasy, a dark fantasy RPG. You produce TOP-DOWN 2D MAPS as a structured grid plus a list of named entities. The game engine takes your output and renders it; the narrative engine reads it to reason about where things are.

OUTPUT SHAPE — "Map Format D" — ALWAYS this exact structure, nothing else:

{
  "scene_id": "<slug, e.g. 'tavern_clearing' or 'forest_path'>",
  "place_id": "<optional: the world-map place id this scene realizes>",
  "scene_description": "<2-3 sentences in Spanish describing the scene>",
  "size":  { "cols": <int>, "rows": <int>, "meters_per_cell": <0.5 interior | 2 exterior> },
  "terrain": [
    "<string of EXACTLY `cols` chars>",
    ...   // EXACTLY `rows` strings total
  ],
  "terrain_legend": { "<char>": "<terrain name>" | { "name": "<terrain name>", "solid": true|false }, ... },
  "terrain_features": [   // OPTIONAL — smooth vector shapes over the grid (see TERRAIN FEATURES)
    { "type": "river" | "path" | "bridge" | "stone" | "dirt" | "sand" | "wood" | "<free name>",
      "points": [[<col>, <row>], ...],   // cell coords, floats allowed
      "width": <cells>,                  // polyline stroke width; default 1
      "closed": true | false }           // true = filled polygon
  ],
  "structures": [   // PREFERRED for any enterable room/building (see STRUCTURES)
    { "type": "room", "rect": [<col>, <row>, <w>, <h>], "wall_char": "W", "floor_char": "o",
      "doors": [ { "side": "north"|"south"|"east"|"west", "at": <cells>, "width": <cells> } ] }
  ],
  "vegetation_zones": [   // OPTIONAL — deterministic tree scatter (see VEGETATION ZONES)
    { "type": "<plant name>", "area": [<col>, <row>, <w>, <h>], "density": 0.05-0.25 }
  ],
  "entities": [
    {
      "id":        "<unique slug, e.g. 'tavern_main', 'tree_n1', 'boris'>",
      "kind":      "building" | "prop" | "item" | "tree" | "npc" | "player" | "decor",
      "name":      "<spanish display name>",
      "cell":      [<col>, <row>],       // 0-indexed; top-left of footprint
      "footprint": [<width_cells>, <height_cells>],
      "glyph":     "<one ASCII char, must be different from terrain chars>",
      "shape":     "box" | "cylinder" | "sphere" | "cone"   // optional; default box
    },
    ...
  ],
  "ambient_event": "<one Spanish sentence of atmospheric flavour>"
}

COORDINATE SYSTEM
- Top-left is (0,0). Col grows EAST, row grows SOUTH.

SCALE — meters_per_cell (CHOOSE IT per scene; do NOT default to 2)
- A [1,1] footprint is meters_per_cell metres across, and the player is ~0.8 m.
  Pick meters_per_cell to match the smallest thing that matters, keeping cols/rows
  within budget (≤ 80×60). Real size = cols × meters_per_cell.
- INTERIOR (tavern, shop, room): meters_per_cell 0.5 → a [1,1] prop is a 0.5 m
  stool/keg (≈ the player). Size so cols×0.5 ≈ real width: a tavern ~10×7 m ⇒
  ~20×14 cells PLUS exterior margin. The room shell is a `structures` room (the
  engine stamps its walls), NOT a building entity.
- OUTDOOR small (clearing, cabin yard): meters_per_cell 2 → real ~30–50 m.
- OUTDOOR town/village: meters_per_cell 2 → real ~60–120 m.

GRID SIZES in CELLS (string budget; metres = cells × meters_per_cell)
- Interior room: 16×12 to 28×20 (mpc 0.5 ⇒ 8–14 m).
- Small clearing/cabin: 16×10 to 24×16 (mpc 2 ⇒ 32–48 m).
- Town square / village: 32×24 to 48×30 (mpc 2).
- Big town: 48×30 to 60×40 (mpc 2).
- Never larger than 80×60.

TERRAIN CHARS — reserved (you do not need to declare these in terrain_legend, but it doesn't hurt)
- "g" grass (default)         - "_" path / dirt road        - "s" stone / paved
- "w" water (river / pond)    - "b" bridge (wood over water)
- "d" dirt / tilled soil      - "a" sand (river bank)       - "o" wood (planks / dock)
- "W" wall (SOLID)
You may invent additional chars (lowercase letters or "~", "-", ":") and document them in terrain_legend.

SOLIDITY — collision (the player physically CANNOT cross solid cells)
- "W" (wall) and "w" (water) BLOCK movement. "b" (bridge) is walkable over water.
- A custom char is declared solid with the object form of terrain_legend:
  "R": { "name": "roca desprendida", "solid": true }. Plain string values are walkable.
- Consequence: every walled room NEEDS a door gap (a walkable char like "_" in its
  W border) or the player is trapped inside — or locked out. Water that crosses the
  map needs a bridge if the far side matters.

STRUCTURES (build walls with these — NEVER hand-draw a W border)
"structures": [
  { "type": "room",
    "rect": [<col>, <row>, <w_cells>, <h_cells>],   // outer rectangle, walls included, min 3x3
    "wall_char": "W", "floor_char": "o",            // optional; defaults W / o
    "doors": [ { "side": "north"|"south"|"east"|"west",
                 "at": <cells from the rect's top/left corner>,  // 1..side-2 (corners can't be doors)
                 "width": <cells, default 1> } ] }  // 1+ doors or the room is sealed
]
The engine stamps each room deterministically: CLOSED wall perimeter, floor
inside, walkable door gaps ("_"). Walls are always solid; the wall char is
auto-declared solid in the legend. Doors narrower than the player are
auto-widened to a ~1.1 m clear gap (3 cells at mpc 0.5). Use ONE structure per
enterable building/room and write only the BASE terrain (grass, paths) in the
grid.

VEGETATION ZONES (scatter, don't hand-place 20 trees)
"vegetation_zones": [
  { "type": "pino", "area": [<col>, <row>, <w>, <h>], "density": 0.1 }
]
The engine scatters `tree` entities deterministically (seeded by scene_id) over
walkable cells of the area, skipping rooms, doors and occupied cells. density =
fraction of cells planted (0.05 sparse … 0.25 thick). Hand-placed trees are
still fine for singular landmarks.

DECOR ATTACH: a decor entity may add "attach": "wall" — the engine snaps it to
the nearest wall cell (torches, hanging signs, banners).

EXTERIOR CONTEXT (open world — a scene is NEVER just the inside of a box)
- An interior scene still shows 3-6 cells of exterior around the building (the
  yard, the street, a strip of trees) and the door opens onto it.
- A path (terrain_features) connects the door to the map edge where the world
  continues, towards the neighbouring world-map place.
- The player must be able to WALK from their start position through the door
  and off the map edge. A sealed box with nothing outside is WRONG.

FRONTIER REQUESTS
The request may carry "frontier_request": { from_place_id, from_place_name,
edge }. The player walked off that edge of the previous scene and the world
continues there. Respond with a NEW scene whose "place_id" names the new
adjacent place; put the player entity near the grid side OPPOSITE to the
crossed edge (crossed east => player near the west side), and make the
terrain visibly continue back toward it.

TERRAIN FEATURES (optional; USE THEM for anything linear or organic — far better maps than cell rows)
The grid paints broad zones; `terrain_features` draw SMOOTH VECTOR SHAPES on top: a meandering river, a curving road, a round plaza. Each feature is a thick polyline (default) or a filled polygon ("closed": true).
- "points": [col,row] cell coordinates, FLOATS ALLOWED ([12.5, 3.0]). 2+ points for a polyline, 3+ for a polygon.
- "width": stroke width in CELLS (rivers 2-4, roads 1-2, streams 0.5-1).
- "type": river|water|path|road|bridge|stone|paved|dirt|sand|wood|grass, or a free Spanish name ("arroyo", "sendero") resolved by keywords. "color": "#rrggbb" forces a colour.
- PAINT ORDER = array order: river FIRST, then the bridge across it, then roads ending at the bridge.
- A river/road drawn as a feature should follow the same course as its `w`/`_` cells in the grid (grid = coarse base, feature = smooth refinement). Purely decorative curves may skip the grid cells and use only the feature.

TERRAIN SVG (advanced, RARELY needed — use ONLY when grid + terrain_features cannot express the shape)
`"terrain_svg"`: an SVG string of pure shapes drawn over the terrain, under the entities. Requirements: viewBox EXACTLY "0 0 <cols> <rows>" (units = cells), max 20 KB, only shape elements (path/rect/circle/ellipse/polygon/line with fill/stroke) — no <script>, no foreignObject, no href. Most scenes need no SVG at all.

ENTITY RULES
- Every entity has a UNIQUE `id`. Two trees in different places need different ids (`tree_n1`, `tree_w2`) even with the same `name` ("roble").
- `cell` is the TOP-LEFT of the footprint. `cell + footprint` must stay inside the grid.
- Buildings (OUTDOOR scenes, mpc 2): ONE rectangular footprint (a tavern seen from outside is one rectangle, not four wall slabs). Typical 4×3 to 8×6 cells. Indoors there is NO building entity — you are inside it; the walls come from its `structures` room.
- Props are usually 1×1 (= mpc metres: 0.5 m indoors, 2 m outdoors). Indoor furniture stays 1×1/2×1; tables and counters a bit bigger. Carts/log piles 2×1 or 3×2.
- NPCs and player are always 1×1.
- Place NPCs at their work spot (smith near the smithy, innkeeper at the inn's door).
- The player sits where the narrative says the player ENTERS the scene.
- "decor" = purely aesthetic set dressing: wall torches, banners, rugs, cobwebs,
  hanging signs, stains. Visible on the map but NO collision and NO interaction.
  Use decor (never prop) for anything the player should walk past freely; a prop
  is a physical obstacle (table, barrel, cart).

SHAPE (optional but encouraged — hints the rendered footprint, makes better maps)
- "cylinder": round things seen from above — barrel, well, cauldron, urn, jar, brazier, ROUND tower, fountain, column. (Trees are round by default; no need to set it.) The most common one.
- "sphere": boulder, dome, orb, haystack.
- "cone": tent, spire, pointed roof, pile.
- "box" (or omit): buildings, walls, crates, tables, carts, rectangular things.

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
- [ ] PLAYABILITY: the player spawn is walkable; walking from it you can reach
      every structure door AND some map edge (the world continues there).
The server re-checks playability with a flood-fill when you respond: if it
rejects, FIX the listed issues (or call the map tools it names) and respond
again — the request stays pending. You can also dry-run with scene_validate.

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

EXAMPLE — INTERIOR de taberna CON EXTERIOR alrededor, 28 cols × 16 rows,
meters_per_cell 0.5 (= 14×8 m). The room is a `structures` entry — the engine
stamps the closed W walls, the wooden floor and the walkable door gap; you
write ONLY the base terrain (grass). A path connects the door to the south
edge, where the world continues. There is NO "building" entity.
{
  "scene_id": "taberna_interior",
  "scene_description": "El interior cálido de una taberna y el patio embarrado que la rodea. Una puerta al sur da al camino que baja hacia la aldea.",
  "size": { "cols": 28, "rows": 16, "meters_per_cell": 0.5 },
  "terrain": [
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg",
    "gggggggggggggggggggggggggggg"
  ],
  "terrain_legend": {},
  "structures": [
    { "type": "room", "rect": [4, 2, 20, 10], "wall_char": "W", "floor_char": "o",
      "doors": [ { "side": "south", "at": 9, "width": 2 } ] }
  ],
  "terrain_features": [
    { "type": "path", "points": [[14, 12], [14, 16]], "width": 1.5 }
  ],
  "vegetation_zones": [
    { "type": "pino", "area": [0, 12, 28, 4], "density": 0.08 }
  ],
  "entities": [
    { "id": "mostrador",  "kind": "prop",  "name": "mostrador de roble",     "cell": [6, 3],  "footprint": [6, 1], "glyph": "=" },
    { "id": "barkeep",    "kind": "npc",   "name": "Tabernero corpulento",   "cell": [9, 4],  "footprint": [1, 1], "glyph": "n" },
    { "id": "mesa_1",     "kind": "prop",  "name": "mesa con jarras vacías", "cell": [7, 7],  "footprint": [3, 2], "glyph": "m" },
    { "id": "barril_1",   "kind": "prop",  "name": "barril de cerveza",      "cell": [21, 3], "footprint": [1, 1], "glyph": "k" },
    { "id": "antorcha_1", "kind": "decor", "name": "antorcha de pared",      "cell": [8, 2],  "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "antorcha_2", "kind": "decor", "name": "antorcha de pared",      "cell": [18, 2], "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "player",     "kind": "player","name": "Tú",                     "cell": [13, 13],"footprint": [1, 1], "glyph": "@" }
  ],
  "ambient_event": "El fuego crepita dentro y el viento arrastra olor a resina desde los pinos."
}

TILES (continuous world plane)
When the request carries "generate_tile" { tx, ty, neighbors, entry,
nearby_places, bootstrap }, respond with a TILE instead of a scene: 64x64 m,
128x128 cells at 0.5 m/cell. Shape: { "tile": {tx,ty}, "scene_id":
"tile_<tx>_<ty>", "biome": <grass|forest_floor|meadow|sand|dirt|stone|snow|
swamp>, "terrain_patches" (optional ASCII stamps {at:[col,row], rows:[...]}),
"terrain_features" (edge-to-edge, each with "at_edges": [{edge, at}]),
"structures", "vegetation_zones" (area may be "rest" = everything still bare
biome), "entities" (cells 0..127, NO "player" unless bootstrap),
"place_anchors" [{place_id, rect}], "ambient_event" }. NEVER write "size" or
a full "terrain[]" — the biome fill + primitives generate the grid. SEAMS:
every crossing listed in neighbors.<edge> (mirrored "at") MUST be continued
by a feature with matching at_edges (±2 cells); the player enters walking
from entry.edge. Bootstrap tiles carry the starting location, a player
entity and place_anchors.
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
            "tile": {
                "type": "object",
                "description": "Continuous-plane tile coords (tile responses only).",
                "properties": {"tx": {"type": "integer"}, "ty": {"type": "integer"}},
                "required": ["tx", "ty"],
            },
            "biome": {
                "type": "string",
                "description": "Tile base fill: grass|forest_floor|meadow|sand|dirt|stone|snow|swamp (tiles only).",
            },
            "terrain_patches": {
                "type": "array",
                "description": "Optional ASCII detail stamps over the biome fill (tiles only).",
                "maxItems": 24,
                "items": {
                    "type": "object",
                    "properties": {
                        "at": {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 2},
                        "rows": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    },
                    "required": ["at", "rows"],
                },
            },
            "place_anchors": {
                "type": "array",
                "description": "World-map places physically living in this tile (tiles only).",
                "maxItems": 8,
                "items": {
                    "type": "object",
                    "properties": {
                        "place_id": {"type": "string"},
                        "rect": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
                    },
                    "required": ["place_id"],
                },
            },
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
                    "meters_per_cell": {"type": "number", "description": "0.5 for interiors (furniture-scale), 2 for outdoor scenes. See system prompt."},
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
                    "appear here. Add any custom terrain chars you used. A value can also be "
                    '{"name": ..., "solid": true|false} to declare that char blocks movement '
                    "(walls, water). W and w are solid by default; b (bridge) is walkable."
                ),
                "additionalProperties": {
                    "oneOf": [
                        {"type": "string"},
                        {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "solid": {"type": "boolean"},
                            },
                            "required": ["name"],
                        },
                    ]
                },
            },
            "terrain_features": {
                "type": "array",
                "description": (
                    "Optional. Smooth vector shapes painted over the grid: thick polylines "
                    "(meandering river, curving road) or filled polygons (closed=true). "
                    "points are [col,row] cell coords (floats allowed), width in cells. "
                    "Array order = paint order (river first, bridge after)."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "description": (
                                "river|water|path|road|bridge|stone|paved|dirt|sand|wood|grass "
                                "or a free Spanish name resolved by keywords."
                            ),
                        },
                        "points": {
                            "type": "array",
                            "items": {
                                "type": "array",
                                "items": {"type": "number"},
                                "minItems": 2,
                                "maxItems": 2,
                            },
                            "minItems": 2,
                            "description": "[col,row] cell coordinates; floats allowed.",
                        },
                        "width": {"type": "number", "minimum": 0.1, "description": "Stroke width in cells (default 1). Ignored for closed polygons."},
                        "closed": {"type": "boolean", "description": "true = filled polygon (3+ points)."},
                        "color": {"type": "string", "description": "Optional #rrggbb override."},
                        "at_edges": {
                            "type": "array",
                            "description": "Tile seams: exact border cells this feature enters/exits at.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "edge": {"type": "string", "enum": ["north", "south", "east", "west"]},
                                    "at": {"type": "integer"},
                                },
                                "required": ["edge", "at"],
                            },
                        },
                    },
                    "required": ["type", "points"],
                },
                "maxItems": 24,
            },
            "terrain_svg": {
                "type": "string",
                "description": (
                    "Optional, rarely needed. SVG of pure shapes over the terrain: "
                    'viewBox EXACTLY "0 0 <cols> <rows>" (cell units), max 20KB, no '
                    "script/foreignObject/href. Use only when grid + terrain_features "
                    "cannot express the shape."
                ),
            },
            "structures": {
                "type": "array",
                "description": (
                    "Enterable rooms/buildings stamped deterministically by the engine: "
                    "closed wall perimeter + floor + door gaps. NEVER hand-draw W borders "
                    "when a structure can do it. rect = [col,row,w,h] outer rectangle "
                    "(walls included, min 3x3); doors carve walkable gaps."
                ),
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["room"]},
                        "rect": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 4,
                            "maxItems": 4,
                            "description": "[col, row, width_cells, height_cells], walls included.",
                        },
                        "wall_char": {"type": "string", "description": "Terrain char for the walls (default W, always solid)."},
                        "floor_char": {"type": "string", "description": "Terrain char for the interior floor (default o)."},
                        "doors": {
                            "type": "array",
                            "description": "1+ door gaps or the room is sealed.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "side": {"type": "string", "enum": ["north", "south", "east", "west"]},
                                    "at": {
                                        "type": "integer",
                                        "description": "Cells from the rect's top/left corner along that side (1..side-2; corners cannot be doors).",
                                    },
                                    "width": {"type": "integer", "minimum": 1},
                                },
                                "required": ["side", "at"],
                            },
                        },
                    },
                    "required": ["type", "rect"],
                },
            },
            "vegetation_zones": {
                "type": "array",
                "description": (
                    "Deterministic tree scatter (seeded by scene_id) over walkable cells "
                    "of the area, skipping rooms, doors and occupied cells. Use instead of "
                    "hand-placing many trees; hand-placed trees remain fine for landmarks."
                ),
                "maxItems": 16,
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "description": "Plant name in Spanish (pino, roble, matorral)."},
                        "area": {
                            "description": "[col, row, width_cells, height_cells], or \"rest\" (tiles only: everything still bare biome).",
                            "oneOf": [
                                {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4},
                                {"type": "string", "enum": ["rest"]},
                            ],
                        },
                        "density": {
                            "type": "number",
                            "exclusiveMinimum": 0,
                            "maximum": 1,
                            "description": "Fraction of cells planted: 0.05 sparse, 0.25 thick.",
                        },
                        "glyph": {"type": "string", "description": "Single ASCII char (default T)."},
                    },
                    "required": ["type", "area", "density"],
                },
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
                            "enum": ["building", "prop", "item", "tree", "npc", "player", "decor"],
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
                        "shape": {
                            "type": "string",
                            "enum": ["box", "cylinder", "sphere", "cone"],
                            "description": (
                                "Optional footprint shape hint (default box). cylinder = round "
                                "(barrel/well/round tower/urn/fountain), sphere = boulder/dome, "
                                "cone = tent/spire/pile, box = buildings/walls/crates."
                            ),
                        },
                        "texture_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached texture by 16-char hash from available_assets.",
                        },
                        "model_hash": {
                            "type": "string",
                            "description": "Optional. Reuse a cached 3D model by hash.",
                        },
                        "attach": {
                            "type": "string",
                            "enum": ["wall"],
                            "description": "decor only: snap to the nearest wall cell (torches, signs, banners).",
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
        "required": ["scene_id", "scene_description", "entities", "ambient_event"],
    },
}


RESERVED_TERRAIN = {
    "g": "grass", "w": "water", "_": "path", "s": "stone",
    "b": "bridge", "d": "dirt", "a": "sand", "o": "wood",
    "W": "muro",
}

VALID_ENTITY_KINDS = {"building", "prop", "item", "tree", "npc", "player", "decor"}


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

    # ── Tile (Format D v3, plano continuo) ───────────────────────────────
    # Un tile no lleva size/terrain (la base es biome + primitivas, expandida
    # en nefan-core). Aquí solo saneado superficial; el bridge fija las coords
    # y valida jugabilidad/costuras server-side.
    raw_tile = data.get("tile")
    is_tile = (
        isinstance(raw_tile, dict)
        and isinstance(raw_tile.get("tx"), int)
        and isinstance(raw_tile.get("ty"), int)
    )
    if is_tile:
        tx, ty = raw_tile["tx"], raw_tile["ty"]
        data["tile"] = {"tx": tx, "ty": ty}
        data["scene_id"] = f"tile_{tx}_{ty}"
        data["room_id"] = data["scene_id"]
        data.pop("size", None)
        data.pop("terrain", None)
        cols, rows = 128, 128
        if not isinstance(data.get("biome"), str) or not data["biome"]:
            print("validate_scene_response: tile sin biome — se asume grass", flush=True)
            data["biome"] = "grass"
        patches = data.get("terrain_patches")
        if isinstance(patches, list):
            clean_p = []
            for i, tp in enumerate(patches[:24]):
                if (
                    isinstance(tp, dict)
                    and isinstance(tp.get("at"), list) and len(tp["at"]) == 2
                    and all(isinstance(v, int) for v in tp["at"])
                    and isinstance(tp.get("rows"), list) and tp["rows"]
                    and all(isinstance(r, str) and r for r in tp["rows"])
                ):
                    clean_p.append({"at": tp["at"], "rows": tp["rows"]})
                else:
                    print(f"validate_scene_response: terrain_patches[{i}] malformado, descartado", flush=True)
            data["terrain_patches"] = clean_p
        else:
            data.pop("terrain_patches", None)
        anchors = data.get("place_anchors")
        if isinstance(anchors, list):
            clean_a = []
            for i, a in enumerate(anchors[:8]):
                if isinstance(a, dict) and isinstance(a.get("place_id"), str) and a["place_id"]:
                    entry = {"place_id": a["place_id"]}
                    rect = a.get("rect")
                    if isinstance(rect, list) and len(rect) == 4 and all(isinstance(v, int) for v in rect):
                        entry["rect"] = rect
                    clean_a.append(entry)
                else:
                    print(f"validate_scene_response: place_anchors[{i}] malformado, descartado", flush=True)
            data["place_anchors"] = clean_a
        else:
            data.pop("place_anchors", None)

    # ── Size + terrain grid (solo escenas legacy; los tiles no llevan) ────
    if not is_tile:
        size = data.get("size") or {}
        cols = int(size.get("cols") or 24)
        rows = int(size.get("rows") or 16)
        mpc = float(size.get("meters_per_cell") or 2)
        cols = max(12, min(cols, 80))
        rows = max(8, min(rows, 60))
        data["size"] = {"cols": cols, "rows": rows, "meters_per_cell": mpc}

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
    else:
        normalized = []

    # ── Terrain legend ───────────────────────────────────────────────────
    # Los valores pueden ser string (legacy) u objeto {name, solid} — la forma
    # objeto declara colisión por char y debe sobrevivir el saneado (la resuelve
    # formatDToWorld en nefan-core). Un valor de otro tipo se descarta.
    raw_legend = data.get("terrain_legend")
    legend: dict = {}
    if isinstance(raw_legend, dict):
        for ch, val in raw_legend.items():
            if isinstance(val, str):
                legend[ch] = val
            elif isinstance(val, dict) and isinstance(val.get("name"), str):
                entry = {"name": val["name"]}
                if isinstance(val.get("solid"), bool):
                    entry["solid"] = val["solid"]
                legend[ch] = entry
    # Ensure every char used in terrain has an entry (default = grass for unknown).
    # (solo legacy: los tiles no traen grid que escanear)
    if not is_tile:
        used_chars = set("".join(normalized))
        for ch in used_chars:
            if ch not in legend and ch not in RESERVED_TERRAIN:
                legend[ch] = "grass"
    # Merge reserved (the legend takes precedence if LLM redefined a char).
    for ch, name in RESERVED_TERRAIN.items():
        legend.setdefault(ch, name)
    data["terrain_legend"] = legend

    # ── Terrain features (vectoriales, opcionales) ───────────────────────
    # Tolerante como el resto de campos del LLM: una feature malformada se
    # descarta sin invalidar la escena. Puntos [col,row] numéricos (floats ok),
    # width > 0, color #rrggbb opcional.
    raw_features = data.get("terrain_features")
    clean_features: list = []
    if isinstance(raw_features, list):
        import re as _re

        for feat in raw_features[:24]:
            if not isinstance(feat, dict):
                continue
            ftype = feat.get("type")
            pts = feat.get("points")
            if not isinstance(ftype, str) or not ftype or not isinstance(pts, list) or len(pts) < 2:
                continue
            clean_pts = []
            for p in pts:
                if (
                    isinstance(p, list)
                    and len(p) >= 2
                    and all(isinstance(v, (int, float)) for v in p[:2])
                ):
                    clean_pts.append([float(p[0]), float(p[1])])
                else:
                    clean_pts = []
                    break
            if len(clean_pts) < 2:
                continue
            clean_feat: dict = {"type": ftype, "points": clean_pts}
            width = feat.get("width")
            if isinstance(width, (int, float)) and width > 0:
                clean_feat["width"] = float(width)
            if feat.get("closed") is True and len(clean_pts) >= 3:
                clean_feat["closed"] = True
            color = feat.get("color")
            if isinstance(color, str) and _re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                clean_feat["color"] = color
            # Costuras de tiles: celdas de borde exactas por las que la
            # feature entra/sale (las consume el expander de nefan-core).
            at_edges = feat.get("at_edges")
            if isinstance(at_edges, list):
                clean_edges = [
                    {"edge": ae["edge"], "at": ae["at"]}
                    for ae in at_edges
                    if isinstance(ae, dict)
                    and ae.get("edge") in ("north", "south", "east", "west")
                    and isinstance(ae.get("at"), int)
                ]
                if clean_edges:
                    clean_feat["at_edges"] = clean_edges
            clean_features.append(clean_feat)
    data["terrain_features"] = clean_features

    # ── Terrain SVG (capa opcional avanzada) ─────────────────────────────
    # Solo formas puras: se descarta (con traza) si excede 20 KB, si el viewBox
    # no casa con el size, o si contiene script/foreignObject/href.
    svg = data.get("terrain_svg")
    if isinstance(svg, str) and svg.strip():
        svg = svg.strip()
        reason = None
        if len(svg.encode("utf-8")) > 20_000:
            reason = "supera 20KB"
        elif not svg.startswith("<svg"):
            reason = "no empieza por <svg"
        else:
            low = svg.lower()
            if "<script" in low or "foreignobject" in low or "href=" in low:
                reason = "contiene script/foreignObject/href"
            else:
                import re as _re

                vb = _re.search(r'viewBox\s*=\s*"([\d.\s-]+)"', svg)
                parts = vb.group(1).split() if vb else []
                ok = (
                    len(parts) == 4
                    and float(parts[0]) == 0
                    and float(parts[1]) == 0
                    and abs(float(parts[2]) - cols) < 0.01
                    and abs(float(parts[3]) - rows) < 0.01
                )
                if not ok:
                    reason = f'viewBox debe ser "0 0 {cols} {rows}"'
        if reason:
            print(f"validate_scene_response: terrain_svg descartado ({reason})", flush=True)
            data.pop("terrain_svg", None)
        else:
            data["terrain_svg"] = svg
    else:
        data.pop("terrain_svg", None)

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
        if ent.get("shape") in ("box", "cylinder", "sphere", "cone"):
            clean_ent["shape"] = ent["shape"]
        if isinstance(ent.get("texture_hash"), str):
            clean_ent["texture_hash"] = ent["texture_hash"]
        if isinstance(ent.get("model_hash"), str):
            clean_ent["model_hash"] = ent["model_hash"]
        # decor puede pedir snap al muro más cercano (lo resuelve el expander TS).
        if ent.get("attach") == "wall":
            clean_ent["attach"] = "wall"
        cleaned.append(clean_ent)
    data["entities"] = cleaned

    # ── Primitivas v2 (structures / vegetation_zones) ────────────────────
    # Passthrough con chequeo de forma superficial: la expansión determinista
    # y la validación semántica (rects dentro del grid, puertas válidas…)
    # viven en nefan-core (scene-expand.ts / scene-validate.ts). Una entrada
    # sin la forma mínima se descarta con traza — nunca tumba la escena.
    raw_structures = data.get("structures")
    if isinstance(raw_structures, list):
        clean_structures = []
        for i, s in enumerate(raw_structures[:16]):
            if (
                isinstance(s, dict)
                and s.get("type") == "room"
                and isinstance(s.get("rect"), list)
                and len(s["rect"]) == 4
                and all(isinstance(v, int) for v in s["rect"])
            ):
                clean_structures.append(s)
            else:
                print(f"validate_scene_response: structures[{i}] malformada, descartada", flush=True)
        data["structures"] = clean_structures
    else:
        data.pop("structures", None)

    raw_veg = data.get("vegetation_zones")
    if isinstance(raw_veg, list):
        clean_veg = []
        for i, z in enumerate(raw_veg[:16]):
            area_ok = z.get("area") == "rest" or (
                isinstance(z.get("area"), list)
                and len(z["area"]) == 4
                and all(isinstance(v, int) for v in z["area"])
            ) if isinstance(z, dict) else False
            if (
                isinstance(z, dict)
                and isinstance(z.get("type"), str)
                and area_ok
                and isinstance(z.get("density"), (int, float))
            ):
                clean_veg.append(z)
            else:
                print(f"validate_scene_response: vegetation_zones[{i}] malformada, descartada", flush=True)
        data["vegetation_zones"] = clean_veg
    else:
        data.pop("vegetation_zones", None)

    # ── Strip legacy fields the new schema doesn't use ───────────────────
    for legacy in ("dimensions", "sky", "fog", "vegetation", "lighting", "exits",
                   "npcs", "objects", "surfaces", "zone_type"):
        data.pop(legacy, None)

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
# Scene segment classification — el mundo derivado de la imagen: la visión
# clasifica cada región segmentada como sólida (colisión) y/o alta (occluder).
# ============================================================================

SCENE_CLASSIFY_SYSTEM_PROMPT = """You classify segmented regions of a top-down painted RPG scene.

You receive 2 images: the original scene, and the same scene with candidate
regions outlined and numbered. The region list with pixel bboxes also arrives
in the request text. The game world is DERIVED from this image: your answer
becomes the real collision map and draw order.

For EVERY numbered index classify the element under that region:
- label: short Spanish noun ("roble", "muro", "barril", "camino", "sombra").
- solid: true if a character on foot could NOT walk through it (walls,
  buildings, tree trunks, boulders, deep water, fences, wagons). false for
  paths, grass, rugs, shadows, flowers, puddles, ground decals.
- tall: true if it is taller than a standing character, so it must be drawn
  on top of one standing behind it (trees, walls, buildings, towers, tents).
  false for low rocks, barrels, crates, low bushes, anything flat.

When unsure about solid, prefer false for open ground textures and true for
anything that reads as a built structure or large plant.

Always respond via the classify_scene tool — never emit free-form text."""


CLASSIFY_SCENE_TOOL = {
    "name": "classify_scene",
    "description": "Classify every numbered segmented region of the scene image.",
    "input_schema": {
        "type": "object",
        "required": ["segments"],
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["index", "label", "solid", "tall"],
                    "properties": {
                        "index": {"type": "integer", "minimum": 0},
                        "label": {"type": "string"},
                        "solid": {"type": "boolean"},
                        "tall": {"type": "boolean"},
                    },
                },
            },
        },
    },
}


def validate_scene_classify_response(
    data: dict, expected_indices: list[int] | None = None
) -> dict | None:
    """Valida una clasificación de regiones. Devuelve el dict normalizado
    ({"segments": [...]}) o None si la forma es irrecuperable o falta algún
    índice esperado (la colisión derivada exige clasificación COMPLETA)."""
    if not isinstance(data, dict):
        return None
    segments = data.get("segments")
    if not isinstance(segments, list):
        return None
    seen: set[int] = set()
    normalized = []
    for seg in segments:
        if not isinstance(seg, dict):
            return None
        index = seg.get("index")
        label = seg.get("label")
        solid = seg.get("solid")
        tall = seg.get("tall")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            return None
        if index in seen:
            return None
        if not isinstance(label, str) or not label:
            return None
        if not isinstance(solid, bool) or not isinstance(tall, bool):
            return None
        seen.add(index)
        normalized.append({"index": index, "label": label, "solid": solid, "tall": tall})
    if expected_indices is not None:
        missing = [i for i in expected_indices if i not in seen]
        if missing:
            print(f"scene_classify: faltan índices {missing} en la respuesta", flush=True)
            return None
    return {"segments": normalized}


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
                            "enum": ["dialogue", "story_update", "spawn_entity", "schedule_event", "plugin_event", "noop"],
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
                        # plugin_event — dirige un evento a un plugin declarativo
                        # activo. El motor del juego ejecuta sus reglas; usar esto
                        # en vez de narrar a mano lo que un plugin ya modela
                        # (comercio, reputación, ...).
                        "plugin_id": {
                            "type": "string",
                            "description": "Id (sha256) of the active plugin that consumes the event.",
                        },
                        "event_type": {
                            "type": "string",
                            "description": "Event type from the plugin's events_consumed (e.g. trade_offered).",
                        },
                        "payload": {
                            "type": "object",
                            "description": "Event payload matching what the plugin's rules read (event.*).",
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

    valid_types = {"dialogue", "story_update", "spawn_entity", "schedule_event", "plugin_event", "noop"}
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
        elif t == "plugin_event":
            plugin_id = str(c.get("plugin_id", "")).strip()
            event_type = str(c.get("event_type", "")).strip()
            if not plugin_id:
                raise ValueError(f"plugin_event[{idx}] missing required field `plugin_id`")
            if not event_type:
                raise ValueError(f"plugin_event[{idx}] missing required field `event_type`")
            payload = c.get("payload", {})
            if not isinstance(payload, dict):
                raise ValueError(f"plugin_event[{idx}].payload must be an object")
            out.append({
                "type": "plugin_event",
                "plugin_id": plugin_id,
                "event_type": event_type,
                "payload": payload,
            })
    return {"consequences": out}


def validate_blueprint_review(data: dict | None) -> dict:
    """Validate a Claude response to a blueprint_review request.

    Strict mode (mirror of narrative-mcp/server.ts:validateBlueprintReview —
    keep both in sync): the shape is { approved: bool, issues: [str],
    fixes?: { terrain?, terrain_features?, entity_moves? } }. Any deviation
    raises ValueError; the endpoint surfaces it as HTTP 422.

    `fixes` son overrides PARCIALES pero de campo completo: si viene terrain,
    son TODAS las filas; terrain_features reemplaza la lista entera. Las
    terrain_features pasan por la misma limpieza tolerante que en
    validate_scene_response (reutilizada aquí en miniatura).
    """
    if not isinstance(data, dict):
        raise ValueError(f"blueprint_review payload must be an object, got {type(data).__name__}")
    approved = data.get("approved")
    if not isinstance(approved, bool):
        raise ValueError("blueprint_review payload missing boolean `approved`")

    raw_issues = data.get("issues", [])
    if not isinstance(raw_issues, list) or any(not isinstance(i, str) for i in raw_issues):
        raise ValueError("blueprint_review `issues` must be a list of strings")
    issues = [i.strip() for i in raw_issues if i.strip()]
    if approved is False and not issues:
        raise ValueError("blueprint_review approved=false requires a non-empty `issues` list")

    out: dict = {"approved": approved, "issues": issues}

    raw_fixes = data.get("fixes")
    if raw_fixes is not None:
        if not isinstance(raw_fixes, dict):
            raise ValueError("blueprint_review `fixes` must be an object")
        allowed = {"terrain", "terrain_features", "entity_moves"}
        unknown = set(raw_fixes.keys()) - allowed
        if unknown:
            raise ValueError(
                f"blueprint_review fixes has invalid keys {sorted(unknown)}; allowed: {sorted(allowed)}"
            )
        fixes: dict = {}

        terrain = raw_fixes.get("terrain")
        if terrain is not None:
            if not isinstance(terrain, list) or any(not isinstance(r, str) for r in terrain):
                raise ValueError("blueprint_review fixes.terrain must be the FULL list of row strings")
            fixes["terrain"] = terrain

        feats = raw_fixes.get("terrain_features")
        if feats is not None:
            if not isinstance(feats, list):
                raise ValueError("blueprint_review fixes.terrain_features must be a list")
            clean: list = []
            for feat in feats[:24]:
                if not isinstance(feat, dict):
                    continue
                ftype = feat.get("type")
                pts = feat.get("points")
                if not isinstance(ftype, str) or not ftype or not isinstance(pts, list) or len(pts) < 2:
                    continue
                if any(
                    not (isinstance(p, list) and len(p) >= 2 and all(isinstance(v, (int, float)) for v in p[:2]))
                    for p in pts
                ):
                    continue
                cf: dict = {"type": ftype, "points": [[float(p[0]), float(p[1])] for p in pts]}
                width = feat.get("width")
                if isinstance(width, (int, float)) and width > 0:
                    cf["width"] = float(width)
                if feat.get("closed") is True and len(pts) >= 3:
                    cf["closed"] = True
                if isinstance(feat.get("color"), str):
                    cf["color"] = feat["color"]
                clean.append(cf)
            fixes["terrain_features"] = clean

        moves = raw_fixes.get("entity_moves")
        if moves is not None:
            if not isinstance(moves, list):
                raise ValueError("blueprint_review fixes.entity_moves must be a list")
            clean_moves: list = []
            for idx, m in enumerate(moves):
                if (
                    not isinstance(m, dict)
                    or not isinstance(m.get("id"), str)
                    or not isinstance(m.get("cell"), list)
                    or len(m["cell"]) != 2
                    or any(not isinstance(v, (int, float)) for v in m["cell"])
                ):
                    raise ValueError(
                        f"blueprint_review fixes.entity_moves[{idx}] must be {{ id: str, cell: [col,row] }}"
                    )
                clean_moves.append({"id": m["id"], "cell": [m["cell"][0], m["cell"][1]]})
            fixes["entity_moves"] = clean_moves

        if fixes:
            out["fixes"] = fixes

    return out
