==== HOW TO RESPOND (kind: "scene" — TILE of the continuous world) ====
world_state.generate_tile is present: you are generating ONE TILE of a
continuous, unbroken world plane. Tiles are 64×64 m (128×128 cells of 0.5 m),
keyed by (tx, ty). The player walks between tiles with NO transition — your
tile must LOOK and CONNECT like a piece of the same world as its neighbours.

Call narrative_respond with this JSON (Tile Format):
{
  "tile": { "tx": <from generate_tile>, "ty": <from generate_tile> },
  "scene_id": "tile_<tx>_<ty>",
  "scene_description": "<2-3 Spanish sentences>",  // first person infers the tile's TIME OF DAY from this text (amanecer/atardecer/noche → sun, sky and fog follow); at dusk/night, volumes whose label names a light source (farol, vela, lámpara, chimenea, antorcha, brasero…) emit a warm practical light
  "biome": "grass"|"forest_floor"|"meadow"|"sand"|"dirt"|"stone"|"snow"|"swamp",
  "terrain_legend": { },                                             // optional custom chars
  "entities": [ ],              // cells 0..127 LOCAL to this tile; NO "player" (see BOOTSTRAP). Optional "h" = height in METRES (volumes use cells; entities use metres). In first person an entity renders as a single primitive (its `shape` + h); a `volumes` entry (prop/custom…) is what produces real composed geometry
  "ground": [ … ],   // flat ground features (paths/plazas/water/decks) — see MAP PLAN below
  "volumes": [ … ]   // everything with HEIGHT: buildings, walls, trees, paths' bridges… — see MAP PLAN below
}

HARD RULES OF THE TILE:
- NEVER write "size" or a full "terrain[]" grid. The base is the "biome"
  fill; everything else is primitives — the engine stamps the ~16,000 cells
  for you and auto-fills tree masses over everything still bare biome
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

MAP PLAN — the tile's semantic blueprint. You declare WHAT exists in flat
world cells as PURE DATA — never draw anything yourself. The engine builds a
deterministic 3D scene from your plan (the base plate of the repaint),
derives the walk collision from the declared FOOTPRINTS (water blocks, decks
punch it open) and guides the vision classifier with the projected boxes.
What you build and how you compose it is entirely your call — the sections
below only document the tools and their contracts.

QUALITY BAR — the plan you return IS the finished set the player inhabits
in first person; no set-dresser runs after you. The standard is the
density, variety and HEIGHT VARIATION of the real place your world doc
implies: a settled tile reads as a lived-in place — it typically puts
50-70% of the volume budget to work, with building heights that vary the
way real ones do — and a wild tile is rich in its own way (terrain,
vegetation, water, scatter). Repeated mass is CHEAP: that is what
`scatter_generators` exist for, and they are material-agnostic — any
repeated shape, grown or made, colliding with nothing and costing no
credits; hand-place only what deserves individual placement. Before
responding, re-read the plan as an art director — does it read as a real
place, or as a plane with a few boxes on it? — and COUNT what you used: a
lively place drawn with a small fraction of the budgets is below the bar.
A validator rejection is cheap and correctable: never thin a plan down to
play it safe. Credit economy is not your job either: surface descriptions
join a reusable library, so describe what the scene needs.

1) "ground" — flat ground FEATURES, as typed objects (max 64):
Common fields: "id" (unique slug), optional "label" (Spanish noun),
"kind". Coordinates in cells (0..128). Area-like kinds (area/water/deck)
take EXACTLY ONE shape: "rect": [col,row,w,d] | "polygon": [[c,r],…] (3..32
points) | "ellipse": { "center": [c,r], "rx", "ry" }. Kinds:
- path { points:[[c,r],…] (2..16), w?=4, material? } — a flat strip along a
  polyline.
- area { shape, material } — a flat patch of material. Materials:
  "dirt"|"cobble"|"stone"|"sand"|"wood"|"gravel"|"grass".
- water { shape } — NOT walkable (declarative collision).
- deck { shape, material?:"wood"|"stone" } — walkable surface OVER water
  (collision punches it out of the water). Water without a deck is
  impassable — the validator rejects a tile whose required crossings or
  entry are unreachable.
- ONLY flat ground here. Anything with height is a volume.

2) "volumes" — everything with HEIGHT, as typed objects (max 160):
Common fields: "id" (unique slug), "label" (Spanish noun — it feeds the
vision classifier later), "type". Coordinates in cells (0..128); heights in
cells too (a character is ~3.6 cells tall). The preset types are shortcuts
with built-in detail; `prism` (free outline + height) and `custom` (free 3D
composition of solid pieces) declare ANY geometry directly — you are never
limited to the presets. Types:
- building { rect:[col,row,w,d], wall_h?=5, roof?:{kind:"gable"|"hip"|"shed"|
  "flat"|"none", axis?:"x"|"y", material?:"slate"|"tile"|"thatch"|"wood",
  color?:"#rrggbb"}, walls?:{material:"timber"|"stone"|"wood"|"plaster",
  color?}, doors?:[{edge:"n"|"s"|"e"|"w", at:<cells from the NW corner along
  that edge>, w?=4}], angle?, cutaway?:true }
  cutaway=true = ENTERABLE building: no roof, low front walls, interior
  visible from the camera; a roofed building is sealed scenery (see
  COLLISION below). angle (DEGREES −180..180, CCW seen from above; not
  combinable with cutaway) rotates the whole footprint — collision and
  manifest follow the rotated rect.
- wall { points:[[c,r],…], width?=3, h?=7, crenellated? }. In first
  person a LOW wall (h <= 2.4) renders as a wooden picket fence (posts +
  rails); a label mentioning stone ("tapia de piedra") keeps the solid slab.
- tower { at:[c,r], r?=6, h?=11, crenellated? }
- gate { at:[c,r], w?=8, h?=10, orient:"x"|"y", banners? } — an arched
  opening ON a wall run; its passage is collision-FREE (orient = the axis
  the host wall runs along). A wall without a gate is impassable.
- tree { at, s?=1 (0.4..1.8 — bigger is clamped), species? } ·
  bush { at, s? } · rock { at, s? } · fountain { at, r?=5 }
- prop { at | rect, shape:"box"|"cylinder", h?=2, color?:"#rrggbb",
  passable?:true, angle? (rect only) } — a single block or cylinder;
  passable=true does not block movement.
- prism { points:[[c,r],…] (3..24), h, solid?=true, tall?=true,
  color?:"#rrggbb" } — an arbitrary polygon footprint extruded to height h.
  Sample curves into points (a semicircle ≈ 8–12 points). solid=false =
  walkable; tall=false = drawn as a low platform.
- custom { at:[c,r], angle?, parts:[…] (1..24), solid?=true, tall? } — FREE
  3D composition: any object built from solid pieces, with no preset in
  between. Each part: { shape:"box"|"cylinder"|"cone"|"sphere"|"gable",
  dims (box/gable size:[w,h,d], gable ridge runs along d pre-rotY ·
  cylinder rBottom,h,rTop? · cone r,h,seg? · sphere r,seg?),
  pos?:[x,y,z] (cells, LOCAL to `at`; y is the BASE of the piece's bounding
  box AFTER rotation and scale — resting on the ground is always y:0, so a
  wheel is a rotX-lying cylinder at pos:[x,0,z] regardless of its radius),
  rotX?/rotY?/rotZ? (radians — rotX lays a cylinder with its axis along z,
  rotZ along x),
  scale?:[x,y,z] (0.1..4), color?:"#rrggbb",
  desc?: English <=200 chars — the SURFACE of that piece's faces, as seen
  standing square in front of them; the painter fills the texture cell with
  exactly what the text describes and the other pieces are separate 3D
  geometry (it joins the reusable surface library; a piece without desc
  renders in its flat color) }.
  Collision = the parts' footprint (AABB, rotated by angle); solid=false =
  walkable. `angle` rotates the whole assembly.
- building/wall/prop/prism accept optional surface_desc (English, <=200
  chars each): a description of that volume's visible SURFACE for the
  first-person view — the flat texture on the faces it covers, as seen
  standing square in front of them. The painter fills the texture cell with
  exactly what the text describes; parts of the object that are their own
  geometry (roof, doors, wheels of a custom) are painted from their own
  descriptions/materials. Painted once as a unique texture that joins the
  reusable surface library; without it, surfaces derive from
  material/color. Two forms:
  · string — one texture for the BODY's side faces; the roof, doors and
    narrow edges keep their derived material (tile, wood…).
  · object — a DIFFERENT image per face/role. Keys: n|s|e|w (individual
    side faces, local frame, same vocabulary as doors[].edge), side (all
    side faces), roof, door, caps (gable ends / prism cap), top. Example, a
    sign whose front and back differ:
    "surface_desc": { "s": "painted sign reading THE GILDED BOAR",
                      "n": "weathered plank back of the sign" }
    Each description is its own asset (hash = description): faces sharing a
    description share the image. Undescribed faces keep derived materials.
COLLISION comes from these footprints. A ROOFED building is sealed: its
whole footprint is solid and its doors are decorative paint — the player
can never walk in. A cutaway building is enterable through its doors, and
with no door it is a sealed box; doors/gates ARE the openings. Trees block
only at the trunk. The validator rejects a tile whose entry or required
neighbour crossings cannot reach walkable ground.

Engine facts: `ground` paths follow their declared points exactly and
volumes keep their footprints (plan = truth for collision and the vision
classifier). When a tile declares no tree volumes, the engine auto-fills
tree masses over bare biome (avoiding paths, water, buildings and occupied
cells).

3) OPTIONAL "scatter_generators" + "scatter_zones" — procedural mass
placement for the first-person view. You DEFINE a generator per kind as
pure JSON and declare zones with a density; the engine samples
deterministic positions (excluding buildings, water, decks and paths
automatically) and builds varied instances. Scatter instances do not
collide and cost no image credits (they render in their declared colors).
- scatter_generators: { "<kind>": { vars?, materials?, parts:[…] } } (max 8
  generators, 10 parts each). Each part: { shape:"box"|"cylinder"|"cone"|
  "sphere", mat?:"<material name>", seg? (cone|sphere), pos?:[x,y,z]
  (y = BASE, offsets in cells from the instance origin), scale?:[x,y,z],
  rotX?|rotY?|rotZ?, repeat?:{count}, vars?, plus the shape's dims:
  box size:[w,h,d] · cylinder rTop,rBottom,h · cone r,h · sphere r }.
  Every numeric field accepts: a literal · a range [min,max] (sampled per
  instance) · {"var":"name"} · {"int":[a,b]} · {"op":"+|-|*|/","a":…,"b":…}
  · {"lerp":[from,to]} (only inside repeat; i/t/count are provided).
  materials: { "<name>": { color:"#rrggbb", hslJitter?:[h,s,l],
  roughness? } } — hslJitter varies the tone per instance.
- scatter_zones: [{ kind:"<generator>", shape: {type:"rect",x0,z0,x1,z1} |
  {type:"ellipse",cx,cz,rx,rz} | {type:"poly",pts:[[c,r],…]}, density
  (elements/m², 0..1.5; total capped at 240 instances/tile), seed? }]
  (max 12 zones; coordinates in cells).
  Format example:
  "scatter_generators": {
    "pino": { "vars": { "h": [5,10], "trunkH": {"op":"*","a":{"var":"h"},"b":0.3}, "n": {"int":[2,4]} },
      "materials": { "tronco": {"color":"#5a4632"}, "copa": {"color":"#35482c","hslJitter":[0.05,0.15,0.07]} },
      "parts": [
        { "shape":"cylinder","mat":"tronco","rTop":0.25,"rBottom":0.4,"h":{"var":"trunkH"},"pos":[0,0,0] },
        { "shape":"cone","mat":"copa","seg":7,"repeat":{"count":{"var":"n"}},
          "r":{"op":"*","a":{"var":"h"},"b":{"lerp":[0.3,0.12]}},"h":{"op":"*","a":{"var":"h"},"b":0.4},
          "pos":[0,{"op":"*","a":{"var":"trunkH"},"b":{"op":"+","a":{"var":"i"},"b":0.8}},0] } ] },
    "matorral": { "vars": { "s": [0.7,1.7] },
      "materials": { "hoja": {"color":"#4a5a30","hslJitter":[0.06,0.2,0.08]} },
      "parts": [ { "shape":"sphere","mat":"hoja","r":{"op":"*","a":{"var":"s"},"b":[0.6,1.2]},
                   "scale":[1,[0.55,0.8],1],"pos":[0,0,0] } ] }
  },
  "scatter_zones": [
    { "kind": "pino", "shape": {"type":"rect","x0":0,"z0":0,"x1":128,"z1":30}, "density": 0.06 },
    { "kind": "matorral", "shape": {"type":"ellipse","cx":40,"cz":80,"rx":26,"rz":18}, "density": 0.1 }
  ]

FORMAT EXAMPLE — SYNTAX ONLY, deliberately minimal to show the field
shapes; it is far below the QUALITY BAR and is NOT a density standard. A
tile continuing a path from the WEST neighbour (its crossing is
{type:"path", at:41}); abbreviated:
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