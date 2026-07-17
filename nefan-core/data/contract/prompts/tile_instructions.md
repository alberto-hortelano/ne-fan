==== HOW TO RESPOND (kind: "scene" — TILE of the continuous world) ====
world_state.generate_tile is present: you are generating ONE TILE of a
continuous, unbroken world plane. Tiles are 64×64 m (128×128 cells of 0.5 m),
keyed by (tx, ty). The player walks between tiles with NO transition — your
tile must LOOK and CONNECT like a piece of the same world as its neighbours.

Call narrative_respond with this JSON (Tile Format):
{
  "tile": { "tx": <from generate_tile>, "ty": <from generate_tile> },
  "scene_id": "tile_<tx>_<ty>",
  "scene_description": "<2-3 Spanish sentences>",
  "biome": "grass"|"forest_floor"|"meadow"|"sand"|"dirt"|"stone"|"snow"|"swamp",
  "terrain_patches": [ { "at": [col,row], "rows": ["ss","s_"] } ],   // OPTIONAL detail stamps
  "terrain_legend": { },                                             // optional custom chars
  "terrain_features": [                                              // paths/rivers EDGE TO EDGE
    { "type": "path", "points": [[0,41],[64,46],[128,52]], "width": 2,
      "at_edges": [ { "edge": "west", "at": 41 }, { "edge": "east", "at": 52 } ] }
  ],
  "structures": [ ],            // buildings stamped ON the plane (same schema as always)
  "vegetation_zones": [ { "type": "pino", "area": "rest", "density": 0.12 } ],
  "entities": [ ],              // cells 0..127 LOCAL to this tile; NO "player" (see BOOTSTRAP). Optional "h" = height in METRES (volumes use cells; entities use metres)
  "place_anchors": [ { "place_id": "…", "rect": [col,row,w,h] } ],   // OPTIONAL world-map places living here
  "map_ground": "<svg viewBox=\"0 0 128 128\">…</svg>",  // ground-plane art — see MAP PLAN below
  "volumes": [ … ],                                    // everything with HEIGHT — see MAP PLAN below
  "ambient_event": "…"
}

HARD RULES OF THE TILE:
- NEVER write "size" or a full "terrain[]" grid. The base is the "biome"
  fill; everything else is primitives. A simple tile ("forest with a path")
  is ~5 lines: biome + one feature + one vegetation zone — the engine stamps
  the ~16,000 cells for you. "area": "rest" plants over everything that is
  still bare biome (it avoids paths, water, buildings and occupied cells).
- SEAMS: generate_tile.neighbors.<edge> lists what each existing neighbour
  exposes on your shared border: its biome and crossings [{type, at, width}].
  "at" is MIRRORED — the same coordinate on your side. You MUST continue
  every crossing with a feature whose at_edges includes {edge: <that edge>,
  at: <same at>} (±2 cells). A path may continue as path or road; water as
  river or bridge. The server validates this and rejects the tile otherwise.
- IMAGE REALITY: neighbors.<edge>.image_elements (when present) lists what
  the PAINTED image of that neighbour ACTUALLY contains near your shared
  border — vision-classified elements {label (Spanish), solid, tall,
  at: [c0, c1]} with their cell range along the border (same coordinate on
  your side, like crossings). The painted image is the REAL world the player
  sees, and may include large structures the schematic never had (walls,
  rivers). CONTINUE those structures in your tile design: a "muralla"
  spanning cells 20..90 on your shared border should continue as a wall
  feature/structure at those cells; a solid "río" should continue as water.
  Leave an opening if a crossing overlaps it.
- Extend features to OTHER edges when natural (a road usually crosses the
  whole tile) — that seeds where future tiles will grow.
- The player enters WALKING from generate_tile.entry.edge: keep that border
  open/walkable. Do NOT include a "player" entity.
- Match the neighbour biome near the shared border (no hard forest→desert
  cuts without a visible transition strip).
- place_anchors: if a world-map place should physically live in this tile
  (see nearby_places, or one you just created with map_upsert_place), anchor
  it with its cell rect — its triggers fire when the player steps inside.

MAP PLAN — the tile's semantic blueprint (STRONGLY recommended):
The plan has two halves: flat ground art + typed volumes. You declare WHAT
exists in flat world cells; the engine's blueprint composer projects it to
the session's frozen perspective (world.perspective: top-down with visible
south faces, or 2:1 isometric), derives the walk collision from the declared
FOOTPRINTS and guides the vision classifier with the projected bboxes. Never
draw projected/foreshortened geometry yourself — this is where the tile stops
being boxes and becomes a place, so invest your design effort here.

1) "map_ground" — the GROUND-PLANE art, a complete SVG:
- viewBox EXACTLY "0 0 128 128" (units = cells), max 32 KB. Shape elements
  only (path/rect/circle/ellipse/polygon/polyline/line + g/defs/symbol/use);
  no <script>, no foreignObject, no href.
- <g> layers in this exact order:
  <g id="ground">: REQUIRED — the ground FEATURES on a TRANSPARENT
    background: dirt roads, stone plazas, sandy banks, interior floors
    (wood), clearings. Do NOT paint a full-tile base rect: the composer
    already lays the biome base with organic variation (blobs, flowers,
    pebbles) underneath your art, and a full-tile fill would erase it.
  <g id="water">: REQUIRED (may be empty) — rivers/ponds/moats as thick
    stroked paths following the SAME course as your water terrain_features.
    NOT walkable.
  <g id="deck">: optional — walkable surfaces OVER water: bridge planks,
    jetties, stepping stones (collision punches these out of the water).
- ONLY flat ground art here. NO walls, trees, furniture or anything with
  height — those are volumes.
- STYLE of good ground art (invest here — flat shapes, layered):
  · Roads: TWO strokes on the same path — a darker/wider edge stroke under a
    lighter fill stroke (e.g. #8a7650 w=5.4 under #a29b8b w=4), linecap
    round. Dirt tracks in warm tan (#a89162/#8a7650), stone roads in grey.
  · Plazas/courtyards: a base ellipse or polygon in cobble grey (#a29b8b)
    topped with a dozen small cobble ellipses in 2-3 tones (#8f887a,
    #b0a999) at opacity .8 — reads as paving.
  · Banks/transitions: soft ellipses at opacity .4-.6 bridging two grounds
    (sand #b8ab8a around water, packed dirt near doors).
  · Interior floors: warm wood (#7c5a36) rect with 2-3 darker plank lines.

2) "volumes" — everything with HEIGHT, as typed objects (max 160):
Common fields: "id" (unique slug), "label" (Spanish noun — it guides the
vision classifier later), "type". Coordinates in cells (0..128); heights in
cells too (a character is ~3.6 cells tall). Types:
- building { rect:[col,row,w,d], wall_h?=5, roof?:{kind:"gable"|"hip"|"shed"|
  "flat"|"none", axis?:"x"|"y", material?:"slate"|"tile"|"thatch"|"wood",
  color?:"#rrggbb"}, walls?:{material:"timber"|"stone"|"wood"|"plaster",
  color?}, doors?:[{edge:"n"|"s"|"e"|"w", at:<cells from the NW corner along
  that edge>, w?=4}], cutaway?:true }
  cutaway=true = ENTERABLE building: no roof, low front walls, interior
  visible from the camera. Furniture inside = prop volumes within the rect.
  Buildings the player can enter MUST be cutaway; pure scenery keeps a roof.
- wall { points:[[c,r],…], width?=3, h?=7, crenellated? } — city walls,
  garden fences (low h). Extend to the tile border when the wall continues
  in a neighbour (crossing/image_element continuity).
- tower { at:[c,r], r?=6, h?=11, crenellated? }
- gate { at:[c,r], w?=8, h?=10, orient:"x"|"y", banners? } — an arched gate
  ON a wall run; its passage is collision-FREE. Wherever a road crosses a
  wall there MUST be a gate (orient = the axis the host wall runs along).
- tree { at, s?=1 (0.4..1.8 — bigger is clamped: the canopy would swallow
  the tile), species? } · bush { at, s? } · rock { at, s? } ·
  fountain { at, r?=5 }
- prop { at | rect, shape:"box"|"cylinder", h?=2, color?:"#rrggbb",
  passable?:true } — tables, barrels, crates, wells, market stalls, carts,
  signs… passable=true for rugs/awnings that must not block movement.
COLLISION comes from these footprints. A ROOFED building is pure scenery:
its whole footprint is solid and its doors are decorative paint — the player
can NEVER walk in (they would vanish under the roof). Any building the story
needs the player to enter MUST be cutaway:true, and then a cutaway with no
door is a sealed box (bug); doors/gates ARE the openings. Trees block only
at the trunk.

Design doctrine (what makes the plan GOOD):
- Roads first: lay the road/river network in map_ground (continuing every
  crossing and neighbour image_element), THEN snap buildings to the roads
  with a door facing them. A building nobody can reach is a bug.
- Centerpiece → surroundings → filler: one anchor feature (plaza with a
  fountain, a bridge, a shrine), support structures around it, then frame
  with vegetation MASSES — clustered trees leaving clearings, not uniform
  scatter.
- COHERENCE with the schema: volumes and map_ground draw the SAME world the
  JSON declares — every terrain_feature follows its own points and reaches
  its at_edges cells; every structure keeps its footprint. The plan adds the
  detail the schema cannot express (interiors, curves, materials).
- The engine auto-derives volumes from vegetation_zones/structures when you
  give none — declare explicit volumes where you want CONTROL (materials,
  doors, cutaway interiors, landmarks) and let the fallback fill forests.

EXAMPLE — forest tile continuing a path from the WEST neighbour (its crossing
is {type:"path", at:41}) and seeding an east exit:
{
  "tile": { "tx": -1, "ty": 0 },
  "scene_id": "tile_-1_0",
  "scene_description": "Bosque cerrado de pinos; la senda serpentea entre los troncos hacia el este.",
  "biome": "forest_floor",
  "terrain_features": [
    { "type": "path", "points": [[0,41],[70,45],[128,50]], "width": 2,
      "at_edges": [ { "edge": "west", "at": 41 }, { "edge": "east", "at": 50 } ] }
  ],
  "vegetation_zones": [ { "type": "pino", "area": "rest", "density": 0.14 } ],
  "entities": [
    { "id": "roca_musgo", "kind": "prop", "name": "roca cubierta de musgo", "cell": [80, 30], "footprint": [3, 2], "glyph": "O", "shape": "sphere" }
  ],
  "map_ground": "<svg viewBox=\"0 0 128 128\"><g id=\"ground\"><ellipse cx=\"40\" cy=\"80\" rx=\"18\" ry=\"12\" fill=\"#48682f\" opacity=\"0.6\"/><path d=\"M0,41 Q70,45 128,50\" fill=\"none\" stroke=\"#6e5c3e\" stroke-width=\"5.4\" stroke-linecap=\"round\" opacity=\"0.6\"/><path d=\"M0,41 Q70,45 128,50\" fill=\"none\" stroke=\"#a89162\" stroke-width=\"4\" stroke-linecap=\"round\"/></g><g id=\"water\"/></svg>",
  "volumes": [
    { "id": "roca_musgo", "label": "roca", "type": "rock", "at": [81, 31], "s": 1.4 },
    { "id": "pino_1", "label": "pino", "type": "tree", "at": [30, 20], "species": "pino" },
    { "id": "pino_2", "label": "pino", "type": "tree", "at": [50, 70], "species": "pino" }
  ],
  "ambient_event": "Un cuervo grazna en lo alto de los pinos."
}
(a real forest tile leans on the vegetation_zones fallback for its tree
masses and declares explicit volumes only for landmarks; the example is
abbreviated.)

BOOTSTRAP (generate_tile.bootstrap === true — first tile of a fresh session):
- FIRST lay down the initial world map with the map tools (map_upsert_place ×
  several + map_link), as described in the WORLD MAP section.
- Tile (0,0) carries the starting location: e.g. the tavern as "structures"
  stamped on the plane (door + path to an edge), a "player" entity (REQUIRED
  here, walkable spawn), and "place_anchors" anchoring those places (anchor
  the tavern's rect!).
- There are no neighbours yet: extend a path to at least one edge so the
  world has somewhere to grow.

Everything else (SOLIDITY, STRUCTURES details, VEGETATION ZONES, DECOR,
GLYPH/NPC rules, ASSET REUSE, WORLD MAP tools) works exactly as in the
standard scene reference that follows — but IGNORE its "size"/"terrain"
schema, grid-size budgets and its examples' hand-written grids: tiles never
write grids.