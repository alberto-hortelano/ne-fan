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
  "terrain_legend": { },                                             // optional custom chars
  "entities": [ ],              // cells 0..127 LOCAL to this tile; NO "player" (see BOOTSTRAP). Optional "h" = height in METRES (volumes use cells; entities use metres)
  "ground": [ … ],   // flat ground features (paths/plazas/water/decks) — see MAP PLAN below
  "volumes": [ … ]   // everything with HEIGHT: buildings, walls, trees, paths' bridges… — see MAP PLAN below
}

HARD RULES OF THE TILE:
- NEVER write "size" or a full "terrain[]" grid. The base is the "biome"
  fill; everything else is primitives. A simple tile ("forest with a path")
  is ~5 lines: biome + one `ground` path — the engine stamps the ~16,000
  cells for you and auto-fills tree masses over everything still bare biome
  (avoiding paths, water, buildings and occupied cells).
- SEAMS: generate_tile.neighbors.<edge> lists what each existing neighbour
  exposes on your shared border: its biome and crossings [{type, at, width}].
  "at" is MIRRORED — the same coordinate on your side. You MUST continue
  every crossing with a `ground` feature whose endpoint reaches that shared
  edge at <same at> (±2 cells): a path crossing continues as a `ground` path
  landing on the edge cell; a water crossing as a `ground` water (or a `deck`
  where a road bridges it). The server validates this and rejects the tile
  otherwise.
- IMAGE REALITY: neighbors.<edge>.image_elements (when present) lists what
  the PAINTED image of that neighbour ACTUALLY contains near your shared
  border — vision-classified elements {label (Spanish), solid, tall,
  at: [c0, c1]} with their cell range along the border (same coordinate on
  your side, like crossings). The painted image is the REAL world the player
  sees, and may include large structures the schematic never had (walls,
  rivers). CONTINUE them in your tile design: a "muralla"
  spanning cells 20..90 on your shared border should continue as a `wall`
  volume at those cells; a solid "río" should continue as a `ground` water.
  Leave an opening if a crossing overlaps it.
- Extend features to OTHER edges when natural (a road usually crosses the
  whole tile) — that seeds where future tiles will grow.
- The player enters WALKING from generate_tile.entry.edge: keep that border
  open/walkable. Do NOT include a "player" entity.
- Match the neighbour biome near the shared border (no hard forest→desert
  cuts without a visible transition strip).

MAP PLAN — the tile's semantic blueprint (STRONGLY recommended):
The plan has two halves: flat ground features + typed volumes. You declare
WHAT exists in flat world cells as PURE DATA — never draw anything yourself.
The engine builds a deterministic 3D scene from your plan (the base plate of
the repaint), derives the walk collision from the declared FOOTPRINTS (water
blocks, decks punch it open) and guides the vision classifier with the
projected boxes. This is where the tile stops being boxes and becomes a
place, so invest your design effort here.

1) "ground" — flat ground FEATURES, as typed objects (max 64):
Common fields: "id" (unique slug), optional "label" (Spanish noun),
"kind". Coordinates in cells (0..128). Area-like kinds (area/water/deck)
take EXACTLY ONE shape: "rect": [col,row,w,d] | "polygon": [[c,r],…] (3..32
points) | "ellipse": { "center": [c,r], "rx", "ry" }. Kinds:
- path { points:[[c,r],…] (2..16), w?=4, material? } — roads and trails as a
  polyline. Continue every neighbour crossing with a path whose endpoints
  reach the shared edge cells.
- area { shape, material } — plazas, courtyards, interior floors, sandy
  banks, clearings. Materials: "dirt"|"cobble"|"stone"|"sand"|"wood"|
  "gravel"|"grass".
- water { shape } — rivers/ponds/moats; continue any neighbour water crossing
  along the SAME course out to the shared edge. NOT walkable (declarative
  collision).
- deck { shape, material?:"wood"|"stone" } — walkable surfaces OVER water:
  bridges, jetties, stepping platforms (collision punches these out of the
  water). Wherever a road crosses water there MUST be a deck.
- ONLY flat ground here. NO walls, trees, furniture or anything with
  height — those are volumes.

2) "volumes" — everything with HEIGHT, as typed objects (max 160):
Common fields: "id" (unique slug), "label" (Spanish noun — it guides the
vision classifier later), "type". Coordinates in cells (0..128); heights in
cells too (a character is ~3.6 cells tall). The preset types below are
SHORTCUTS — reach for them first. When NONE fits the shape you're imagining,
do NOT force it: declare the geometry yourself with `prism` (an arbitrary
polygon outline + height). Types:
- building { rect:[col,row,w,d], wall_h?=5, roof?:{kind:"gable"|"hip"|"shed"|
  "flat"|"none", axis?:"x"|"y", material?:"slate"|"tile"|"thatch"|"wood",
  color?:"#rrggbb"}, walls?:{material:"timber"|"stone"|"wood"|"plaster",
  color?}, doors?:[{edge:"n"|"s"|"e"|"w", at:<cells from the NW corner along
  that edge>, w?=4}], angle?, cutaway?:true }
  cutaway=true = ENTERABLE building: no roof, low front walls, interior
  visible from the camera. Furniture inside = prop volumes within the rect.
  Buildings the player can enter MUST be cutaway; pure scenery keeps a roof.
  angle (DEGREES −180..180, CCW seen from above; NOT combinable with
  cutaway) rotates the whole footprint — collision and manifest follow the
  rotated rect. USE IT: village houses must carry varied small angles
  (±5..±30°, different per building), reserving 0° for one or two civic
  buildings. A settlement of perfectly axis-aligned boxes reads as a
  barracks grid, not a lived-in place.
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
  passable?:true, angle? (rect only) } — tables, barrels, crates, wells,
  market stalls, carts, signs… passable=true for rugs/awnings that must not
  block movement; a slight angle on carts/stalls sells the clutter.
- prism { points:[[c,r],…] (3..24), h, solid?=true, tall?=true,
  color?:"#rrggbb" } — FREE geometry: an arbitrary polygon footprint extruded
  to height h, for shapes no preset expresses (the curved arc of a ruined
  tower's wall, an L-shaped ruin, an irregular rock platform, a broken bridge
  span). Sample curves into points (a semicircle ≈ 8–12 points). solid=false
  for a decorative walkable shape; tall=false for a low platform. The image
  model repaints it — the prism just sets the massing, collision and
  occlusion. Compose several prisms/presets for one complex object.
- building/wall/prop/prism accept optional surface_desc (English, <=200
  chars): a description of that volume's visible surface for the
  first-person view — painted once as a unique texture that joins the
  reusable surface library. Use it ONLY when a surface should look SPECIFIC
  (a faded mural on the tavern facade, a heraldic city gate); plain walls
  already derive their look from material/color. Never required.
COLLISION comes from these footprints. A ROOFED building is pure scenery:
its whole footprint is solid and its doors are decorative paint — the player
can NEVER walk in (they would vanish under the roof). Any building the story
needs the player to enter MUST be cutaway:true, and then a cutaway with no
door is a sealed box (bug); doors/gates ARE the openings. Trees block only
at the trunk.

Design doctrine (what makes the plan GOOD):
- Roads first: lay the road/river network in ground (continuing every
  crossing and neighbour image_element), THEN snap buildings to the roads
  with a door facing them. A building nobody can reach is a bug.
- Centerpiece → surroundings → filler: one anchor feature (plaza with a
  fountain, a bridge, a shrine), support structures around it, then frame
  with vegetation MASSES — clustered trees leaving clearings, not uniform
  scatter.
- COHERENCE with the tile: ground and volumes describe ONE consistent world —
  every `ground` path follows its own points and lands on its shared-edge
  cells; every building keeps its footprint. The plan carries all the detail
  (interiors, curves, materials).
- The engine auto-fills forest masses over bare biome when you declare no tree
  volumes — declare explicit volumes where you want CONTROL (materials, doors,
  cutaway interiors, landmarks) and let the fallback fill the woods.

EXAMPLE — forest tile continuing a path from the WEST neighbour (its crossing
is {type:"path", at:41}) and seeding an east exit:
{
  "tile": { "tx": -1, "ty": 0 },
  "scene_id": "tile_-1_0",
  "scene_description": "Bosque cerrado de pinos; la senda serpentea entre los troncos hacia el este.",
  "biome": "forest_floor",
  "entities": [
    { "id": "roca_musgo", "kind": "prop", "name": "roca cubierta de musgo", "cell": [80, 30], "footprint": [3, 2], "glyph": "O", "shape": "sphere" }
  ],
  "ground": [
    { "id": "claro_sur", "kind": "area", "label": "claro del bosque", "ellipse": { "center": [40, 80], "rx": 18, "ry": 12 }, "material": "grass" },
    { "id": "senda", "kind": "path", "label": "senda de tierra", "points": [[0, 41], [70, 45], [128, 50]], "w": 4, "material": "dirt" }
  ],
  "volumes": [
    { "id": "roca_musgo", "label": "roca", "type": "rock", "at": [81, 31], "s": 1.4 },
    { "id": "pino_1", "label": "pino", "type": "tree", "at": [30, 20], "species": "pino" },
    { "id": "pino_2", "label": "pino", "type": "tree", "at": [50, 70], "species": "pino" }
  ]
}
(a real forest tile leans on the engine's tree fallback for its dense masses
and declares explicit volumes only for landmarks; the example is
abbreviated.)

BOOTSTRAP (generate_tile.bootstrap === true — first tile of a fresh session):
- FIRST lay down the initial world map with the map tools (map_upsert_place ×
  several + map_link), as described in the WORLD MAP section.
- Tile (0,0) carries the starting location: e.g. the tavern as a cutaway
  `volumes` building on the plane (door + a `ground` path to an edge) and a
  "player" entity (REQUIRED here, walkable spawn).
- There are no neighbours yet: extend a path to at least one edge so the
  world has somewhere to grow.

Everything else (SOLIDITY, DECOR ATTACH, GLYPH/NPC rules, ASSET REUSE, WORLD
MAP tools) works exactly as in the standard scene reference that follows — but
IGNORE its "size"/"terrain" schema, grid-size budgets and its examples'
hand-written grids: tiles never write grids.