==== HOW TO RESPOND (kind: "scene") ====
You generate TOP-DOWN 2D MAPS as a structured grid plus a list of named
entities. The game renders them; the narrative engine uses them to know where
everything is. Call narrative_respond with this JSON ("Map Format D"):

{
  "scene_id": "<slug>",
  "scene_description": "<2-3 Spanish sentences>",
  "size":  { "cols": <int>, "rows": <int>, "meters_per_cell": <0.5 interior | 2 exterior> },
  "terrain": [
    "<string of EXACTLY cols chars>",
    ...   // EXACTLY rows strings total
  ],
  "terrain_legend": { "<char>": "<terrain name>" | { "name": "<terrain name>", "solid": true|false }, ... },
  "ground": [ … ],   // flat ground features (paths/plazas/water/decks) — see the MAP PLAN reference: tile instructions in tile worlds; the stage instructions document them inline for proscenium
  "volumes": [ … ],  // everything with HEIGHT: buildings (cutaway for enterable), walls, trees… — same MAP PLAN reference as ground
  "entities": [
    { "id": "<unique slug>", "kind": "building"|"prop"|"item"|"tree"|"npc"|"player"|"decor",
      "name": "<spanish>", "cell": [col, row], "footprint": [w, h], "glyph": "<1 ASCII char>",
      "shape": "box"|"cylinder"|"sphere"|"cone",     // optional; default box
      "h": <metres> },                               // height in METRES — ALWAYS declare it for furniture/props (table 0.75, bench 0.45, barrel 0.9, shelf 2.0…); without it the engine falls back to semantic defaults by label, generic per-kind otherwise
    ...
  ]
}

COORDINATES: top-left is (0,0). col → east, row → south.

SCALE — meters_per_cell (CHOOSE IT per scene; do NOT default to 2).
PROSCENIUM stages have their OWN scale and size budgets (0.5–1.0 mpc, wider
grids) — when the stage instructions are present and disagree with anything
here, THE STAGE RULES WIN:
A [1,1] footprint is meters_per_cell metres across, and the player is ~0.8 m.
So pick meters_per_cell to match the smallest thing that matters in the scene,
keeping cols/rows within the string budget (≤ 80×60). Real size = cols × mpc.
- INTERIOR (tavern, shop, room): meters_per_cell 0.5 → a [1,1] prop is a 0.5 m
  stool/keg (≈ the player). Size the room so cols×0.5 ≈ its real width: a tavern
  ~10×7 m ⇒ ~20×14 cells PLUS exterior margin. The room shell is a `volumes`
  building with `cutaway:true` (the engine draws its walls and door gaps), NOT
  a plain "building" entity. Furniture is small (stools/kegs 1×1, tables 2×2 to
  3×2, counters [5..8]×1).
- OUTDOOR small (clearing, cabin yard): meters_per_cell 2 → real ~30–50 m.
- OUTDOOR town/village:                 meters_per_cell 2 → real ~60–120 m.

GRID SIZES in CELLS (string budget; metres = cells × meters_per_cell)
- interior room:        16×12 to 28×20   (mpc 0.5 ⇒ 8–14 m)
- small clearing/cabin: 16×10 to 24×16   (mpc 2  ⇒ 32–48 m)
- village / square:     32×24 to 48×30   (mpc 2  ⇒ 64–96 m)
- big town:             48×30 to 60×40   (mpc 2)
- never larger than     80×60

RESERVED TERRAIN CHARS (you can use without declaring in legend)
- g grass (default)   _ path/dirt road    s stone/paved
- w water             b bridge (wood over water)
- d dirt/tilled       a sand              o wood/dock planks
- W wall (SOLID)

Any other char you use MUST be declared in terrain_legend.

SOLIDITY — collision (the player physically CANNOT cross solid cells)
- "W" (wall) and "w" (water) BLOCK movement. "b" (bridge) is walkable over water.
- A custom char is declared solid with the object form of terrain_legend:
  "R": { "name": "roca desprendida", "solid": true }. Plain string values are walkable.
- Consequence: every walled room NEEDS a door gap (a walkable char like "_" in its
  W border) or the player is trapped inside — or locked out. Water that crosses the
  map needs a bridge if the far side matters.

ENTERABLE ROOMS & BUILDINGS: don't hand-draw a W border. Declare the shell as a
`volumes` building with `cutaway:true` (walls, door gaps and interior visible
from the camera come out deterministically), and write only the BASE terrain
(grass, paths) in the grid. The volumes schema (rect, walls, roof, doors,
cutaway) is in the MAP PLAN reference: the tile instructions (tile worlds) or
the stage instructions' volumes examples (proscenium).

VEGETATION: don't hand-place 20 trees. Declare tree `volumes` (or let the engine
fill forest masses from the plan). Hand-placed `tree` entities are still fine
for singular landmarks.

DECOR ATTACH: a decor entity may add "attach": "wall" — the engine snaps it to
the nearest wall cell (torches, hanging signs, banners).

EXTERIOR CONTEXT (open world — a scene is NEVER just the inside of a box)
- An interior scene still shows 3-6 cells of exterior around the building (the
  yard, the street, a strip of trees) and the door opens onto it.
- A path (a `ground` path feature) connects the door to the map edge where the
  world continues, towards the neighbouring world-map place.
- The player must be able to WALK from their start position through the door
  and off the map edge. A sealed box with nothing outside is WRONG.

LINEAR & ORGANIC GROUND (rivers, roads, plazas) — anything linear or organic
makes far better maps than cell rows. Declare it as typed `ground` features:
`path` polylines for roads/trails, `water` shapes for rivers/ponds (NOT
walkable), `deck` for walkable surfaces over water (bridges), `area` for
plazas/courtyards. Points are float cell coordinates and curves are smoothed
(full ground schema in the MAP PLAN reference above). Rule of thumb: a
river/road in `ground` should follow the same course as its "w"/"_" cells in
the grid (the grid stays the coarse base; ground refines it with curves).

Do NOT emit SVG of any kind (the old "terrain_svg"/"map_ground" fields are
gone): everything is declarative data — typed "ground" features + "volumes".

ENTITY RULES
- Every entity has a UNIQUE id (slug). Two trees in different places need
  different ids ("tree_n1", "tree_w2") even if they share name ("roble").
- REUSE EXISTING CHARACTERS: if a character already in context.entities
  appears in the scene you are generating (someone you spawned earlier, an
  NPC who travelled here), declare them with their EXACT existing id — the
  engine MOVES that record here with all its state (inventory, role,
  directives). A new id would DUPLICATE the character (two records, one
  orphaned in the old scene). Mint new ids only for brand-new characters.
- cell is the TOP-LEFT of the footprint. cell + footprint must stay inside the grid.
- Buildings (OUTDOOR scenes, mpc 2): ONE rectangular footprint each — a tavern
  seen from outside is one rectangle of 6×4 to 8×6 cells, NOT four wall slabs.
  (Indoors you are INSIDE the building, so there is no building entity; the
  walls come from its `volumes` cutaway building.)
- Props are usually 1×1 (= mpc metres: 0.5 m indoors, 2 m outdoors). Indoor
  furniture stays 1×1/2×1; tables and counters a bit bigger. Carts/log piles 2×1.
- NPCs and player are always 1×1.
- Place NPCs at their workspot (smith near smithy, innkeeper at inn's door).
- Player starts where the narrative says they enter the scene.
- "decor" = purely aesthetic set dressing: wall torches, banners, rugs, cobwebs,
  hanging signs, stains. Visible on the map but NO collision and NO interaction.
  Use decor (never prop) for anything the player should walk past freely; a prop
  is a physical obstacle (table, barrel, cart).
- `h` = height in METRES (NOT cells; footprint stays in cells). Both clients
  render it (extruded prism in 2D, real height in 3D). Guide: house 2.5-4,
  tower/church/keep 5-8, tree 3-8, prop 0.5-2. Omit for the per-kind default
  (building 2.5, tree 4, prop 1, item/decor 0.5) — DO set it when it tells a
  story: a looming fortress, a stunted sapling, a grand cathedral.

SHAPE (optional; hints the rendered footprint — use it, it makes better maps)
- "cylinder": round things seen from above — barrel, well, cauldron, urn, jar,
  brazier, ROUND tower, fountain, column. Trees are round by default (no need to
  set it). This is the one you'll use most.
- "sphere": boulder, dome, orb, haystack.
- "cone": tent, spire, pointed roof, pile.
- "box" (or omit): buildings, walls, crates, tables, carts, rectangular things.

GLYPH RULES
- Single printable ASCII char. NOT equal to any terrain char in the same map.
- Glyphs CAN repeat across entities (all trees can be "T") — ids disambiguate.

ASSET REUSE — available_assets is a GROWING LIBRARY of already-generated
assets (textures, 3D models, sprites, painted surfaces), each with a short
description and a 16-char hash. Reuse is OPTIONAL, never forced:
- If an entry matches what you imagine for an entity, add "texture_hash" or
  "model_hash" with its hash — the engine loads it instantly, for free.
- If nothing fits, just describe what you want (texture_prompt/model_prompt,
  or surface_desc on a volume): it gets generated once and JOINS the library
  for future scenes. Never bend your scene to fit an existing asset.

VALIDATION before responding:
- [ ] every terrain row is exactly cols chars
- [ ] number of terrain rows equals rows
- [ ] every entity has id/kind/name/cell/footprint/glyph
- [ ] no two entities share an id
- [ ] no footprint runs off the grid
- [ ] every glyph differs from every terrain char
- [ ] PLAYABILITY: the player spawn is walkable; walking from it you can reach
      every enterable building's door AND some map edge (the world continues there)
narrative_respond re-checks playability server-side with a flood-fill: if it
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
    { "id": "cabin",    "kind": "building", "name": "Cabaña del Cazador", "cell": [7, 2], "footprint": [6, 3], "glyph": "H" },
    { "id": "fire_pit", "kind": "prop",     "name": "hoguera",            "cell": [10, 6],"footprint": [1, 1], "glyph": "f" },
    { "id": "tree_n1",  "kind": "tree",     "name": "pino",               "cell": [2, 1], "footprint": [1, 1], "glyph": "T" },
    { "id": "tree_n2",  "kind": "tree",     "name": "pino",               "cell": [13, 1],"footprint": [1, 1], "glyph": "T" },
    { "id": "tree_s",   "kind": "tree",     "name": "roble",              "cell": [3, 8], "footprint": [1, 1], "glyph": "T" },
    { "id": "hunter",   "kind": "npc",      "name": "Tarald el Cazador",  "cell": [11, 5],"footprint": [1, 1], "glyph": "n" },
    { "id": "player",   "kind": "player",   "name": "Tú",                 "cell": [9, 9], "footprint": [1, 1], "glyph": "@" }
  ]
}

EXAMPLE — INTERIOR de taberna CON EXTERIOR alrededor, 28 cols × 16 rows,
meters_per_cell 0.5 (= 14×8 m). La sala es un `volumes` building con
`cutaway:true` — el motor dibuja los muros, el suelo interior y el hueco de
puerta transitable; tú escribes SOLO el terreno base (hierba). Un `ground` path
conecta la puerta con el borde sur, por donde continúa el mundo. NO hay entidad
"building".
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
  "ground": [
    { "id": "sendero", "kind": "path", "label": "sendero", "points": [[14, 12], [14, 16]], "w": 3, "material": "dirt" }
  ],
  "volumes": [
    { "id": "taberna", "label": "taberna", "type": "building", "rect": [4, 2, 20, 10], "cutaway": true,
      "walls": { "material": "timber" }, "doors": [ { "edge": "s", "at": 9, "w": 3 } ] },
    { "id": "pino_e1", "label": "pino", "type": "tree", "at": [3, 14], "species": "pino" },
    { "id": "pino_e2", "label": "pino", "type": "tree", "at": [24, 14], "species": "pino" }
  ],
  "entities": [
    { "id": "mostrador", "kind": "prop", "name": "mostrador de roble",        "cell": [6, 3],  "footprint": [6, 1], "glyph": "=" },
    { "id": "barkeep",   "kind": "npc",  "name": "Tabernero corpulento",      "cell": [9, 4],  "footprint": [1, 1], "glyph": "n" },
    { "id": "mesa_1",    "kind": "prop", "name": "mesa con jarras vacías",    "cell": [7, 7],  "footprint": [3, 2], "glyph": "m" },
    { "id": "barril_1",  "kind": "prop", "name": "barril de cerveza",         "cell": [21, 3], "footprint": [1, 1], "glyph": "k" },
    { "id": "antorcha_1","kind": "decor","name": "antorcha de pared",         "cell": [8, 2],  "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "antorcha_2","kind": "decor","name": "antorcha de pared",         "cell": [18, 2], "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "player",    "kind": "player","name": "Tú",                       "cell": [13, 13],"footprint": [1, 1], "glyph": "@" }
  ]
}

WORLD MAP (the scene request's world_state may carry map fields)

The world is a 3-level map: world > region > settlement|landmark > site >
interior. The map lives in the bridge; mutate it with the map_* tools BEFORE
you call narrative_respond. Two flags can appear in world_state:

- bootstrap_world_map: true  → fresh session. Before generating the scene,
  lay down an initial map: call map_upsert_place for the root world, 1-2
  regions, 3-5 settlements/landmarks, and the sites of the starting
  settlement; call map_link for the roads/paths/rivers between them. Then
  generate the Format D scene for ONE starting place.
- realize_place: { id, kind, name, description, sites, links }  → lazy
  realize. Generate the Format D scene specifically for that place; its
  sites should appear as buildings/areas in the grid.

In BOTH cases, add a top-level "place_id" to the scene JSON naming the map
place this scene realizes (e.g. "place_id": "robledo"). The engine binds the
scene to that place. Use the map_* tools for everything map-related — do not
invent a different map representation in the scene JSON.

EXTERIOR LINK RULE: the place a scene realizes must ALWAYS have at least one
outgoing map_link (door/path to its containing exterior or a neighbour) —
walking off the scene edge follows those links. When you realize an interior,
create/link its exterior place FIRST (map_upsert_place + map_link), then
respond. The scene pre-flight rejects a scene whose place has no links.
Whenever two linked places are spatially adjacent, set the link's "edge"
param (the side of the FROM place's scene where the exit sits) — walking off
that side of the scene travels the link; the reverse direction automatically
uses the opposite edge.

A third flag can appear in world_state:
- frontier_request: { from_place_id, from_place_name, edge }  → the player
  walked off the <edge> side of the scene realizing from_place_id and the
  world map has NO destination in that direction. Extend the world on the
  fly (see FRONTIER below).

FRONTIER (on-the-fly world expansion)

When world_state carries frontier_request, the player is standing at the
<edge> border of <from_place_name> waiting for the world to continue. Do, in
this order, BEFORE narrative_respond:
1. map_upsert_place — create ONE new place adjacent to from_place_id in that
   direction (usually a sibling: same parent_id as from_place_id; give it an
   approx_position offset from from_place's toward <edge>). Invent something
   coherent with the region and the story so far.
2. map_link — link the two places with edge set. Call it EXACTLY as
   map_link(from=<from_place_id>, to=<new_place_id>, edge=<frontier_request's
   edge>, kind=path|road|...). Do NOT swap from/to; do NOT use the opposite
   edge — the reverse direction is derived automatically.
3. Generate the Format D scene for the NEW place with "place_id":
   "<new_place_id>". The player ENTERS from the side OPPOSITE to the crossed
   edge (crossed east ⇒ the player entity sits near the WEST side of the new
   grid), and the terrain must visibly continue back toward that side (a path
   or open ground reaching that border).
Optionally add more links from the new place onward (future frontiers).