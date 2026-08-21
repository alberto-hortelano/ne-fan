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
      "h": <metres>,                                 // height in METRES — ALWAYS declare it for furniture/props (table 0.75, bench 0.45, barrel 0.9, shelf 2.0…); without it the engine falls back to semantic defaults by label, generic per-kind otherwise
      "style_ref": "<character ref id>" },           // NPCs only, optional: id from world.style_refs.characters whose description best matches this NPC's look (guides the AI skin); missing/unknown falls back to a role-derived default
    ...
  ]
}

COORDINATES: top-left is (0,0). col → east, row → south.

TWO VARIANTS, AND ONLY TWO. The request tells you which one you are answering:
- `generate_tile` in world_state → a TILE of the continuous world. It carries
  `tile:{tx,ty}` + `biome` and NO `size`/`terrain`: the engine synthesises the
  128×128 @0.5 m grid from the biome and your `ground`/`volumes`. Its rules are
  in the tile instructions, which win over anything here.
- `stage_request` in world_state → a PROSCENIUM stage: its own `size`+`terrain`
  grid plus the `stage` block (exits, backdrop, fourth wall). Its scale and
  size budgets live in the stage instructions, which win over anything here.
A scene with neither is rejected by the gate before it reaches the game: there
is no such thing as a free-standing map with a size of your choosing.

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

VEGETATION: don't hand-place 20 trees. Declare `vegetation_zones` (tile worlds:
the engine plants real tree/bush masses per zone, deterministically) or tree
`volumes`. Nothing fills vegetation on its own: undeclared vegetation does not
exist. Hand-placed `tree` entities are still fine for singular landmarks.

DECOR ATTACH: a decor entity may add "attach": "wall" — the engine snaps it to
the nearest wall cell (torches, hanging signs, banners).

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
- Buildings seen from OUTSIDE: ONE rectangular footprint each — a tavern is one
  rectangle covering its real width in cells, NOT four wall slabs. (Indoors you
  are INSIDE the building, so there is no building entity; the walls come from
  its `volumes` cutaway building.)
- Props: size them in CELLS from their real size (a 1-cell prop is
  meters_per_cell metres across). Furniture 1×1/2×1; tables and counters a bit
  bigger; carts/log piles 2×1.
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
      every enterable building's door AND the way out — a tile's seams with its
      neighbours, a stage's declared exits
narrative_respond re-checks playability server-side with a flood-fill: if it
rejects, FIX the listed issues (or call the map tools it names) and respond
again — the request stays pending. You can also dry-run with scene_validate.

WORLD MAP (the scene request's world_state may carry map fields)

The world is a 3-level map: world > region > settlement|landmark > site >
interior. The map lives in the bridge; mutate it with the map_* tools BEFORE
you call narrative_respond. Two flags can appear in world_state:

- bootstrap_world_map: true  → fresh session. Before generating the scene,
  lay down an initial map: call map_upsert_place for the root world, 1-2
  regions, 3-5 settlements/landmarks, and the sites of the starting
  settlement; call map_link for the roads/paths/rivers between them. Then
  generate the Format D scene for ONE starting place.
- realize_place: { id, kind, name, description, sites, links }  → lazy realize
  of a place, and it always travels WITH `stage_request`: only a proscenium
  world realizes a place as its own scene. In the continuous world a place
  lives inside a tile, so it arrives as `generate_tile` instead.

On BOOTSTRAP, add a top-level "place_id" to the scene JSON naming the map
place the player starts in (e.g. "place_id": "robledo"). You are the only one
who knows it — you just laid the map down in this same turn — and it is what
ties the first scene to it: without it the travel panel has no place to show
exits for, so the server REJECTS the response and asks you to add it.

On realize_place you do NOT need it: the server knows which place it asked
you to realize and tags the scene itself. Same for a tile that is a place —
`generate_tile.place` tells you which one, and the server tags it. Use the
map_* tools for everything map-related — do not invent a different map
representation in the scene JSON.

Two world_state fields carry the world's canonical VOCABULARY (reusable
descriptions; styled image assets are cached by description+style, so a
verbatim reuse is a cache hit instead of a new image):
- generate_world_vocabulary: true  → game-genesis request. The
  vocabulary_set tool is honored on this turn: you may declare the world's
  canonical surface/facade/prop descriptions and character archetypes (see
  the tool's own doc for the entry shape).
- world_vocabulary: [{id, kind, desc, roles?}]  → the declared vocabulary,
  echoed back on tile/realize requests. Reusing an entry's desc verbatim
  (in a volume's surface_desc, or as a character description) is optional.
