==== HOW TO RESPOND (kind: "scene" — PROSCENIUM STAGE) ====
world_state.stage_request is present: this world uses the PROSCENIUM view.
The world is NOT a continuous plane — it is a chain of discrete STAGES
(theatre sets / classic film sets), one per world-map place, connected ONLY
through physical exits. Walking into an exit zone transitions to the linked
place's stage with a fade (think classic survival-horror doors). There are NO
tiles here: never emit "tile" or "biome" (but "ground" and "volumes" ARE
used by stages — see below).

CAMERA CONVENTION (fixed, never changes): the camera sits at the SOUTH edge
of the stage, low, looking north.
- north (row 0, world −z) = the BACKDROP: painted far wall / horizon. An exit
  here is a door "into the distance".
- south (last row, world +z) = the APRON: closest to camera. An exit here
  means the player walks TOWARD the camera and out of frame. If fourth_wall
  is present, it is drawn on this side and fades when the player approaches.
- east/west = the WINGS (lateral exits).
The player moves freely in X and Z inside the stage; depth is BOUNDED — the
only way out is an exit zone.

==== PLANO PRIMERO (mandatory — sketch before you emit) ====
Before emitting the scene JSON, reason out a brief SITE PLAN in your head (a
few lines of thought, not part of the response). Scenes composed without it
come out as flat postcards: a row of aligned boxes inside a rectangle.
1. THE FOUR EDGES: for each edge (N/S/E/W), what is there? Which world-map
   links leave through it (those become exits), and what does the player SEE
   beyond it? What lies beyond each edge becomes `surroundings` — coherent
   with the neighbouring places (if the castle is up the east road, its mass
   belongs on the east skyline, not in the backdrop text).
2. COMPOSITION IN DEPTH (camera sits south): buildings/trees FLANKING east
   and west receding north; the street/path running south→north; the action
   (well, stalls, cart) in the MIDDLE ground; 1-2 framing props in the
   SOUTHERN THIRD (a barrel, a cart, a post near the apron corners) so the
   foreground is not an empty field.
3. ORIENTATION: real villages have no grid — give most buildings/props a
   small `angle` (±5..±30°), varied per building. Reserve 0° for one or two
   formal buildings (church, keep).
4. FOCAL: pick `focal_m` last — intimate room 6-8, street/plaza 10-14, wide
   establishing 16+. Prefer the LOW end: an over-retreated camera shrinks
   your foreground props into dots.

Call narrative_respond with a CLASSIC Format D scene PLUS the "stage" block:
{
  "scene_id": "<slug>",
  "place_id": "<the place from realize_place — REQUIRED>",
  "scene_description": "<2-3 Spanish sentences>",
  "style_ref": "stage_interior",         // style-pack reference id (world.style_refs.scene)
  "stage": { "interior": true, ... },    // roofed stage? see hard rules
  "size": { "cols": 24..80, "rows": 12..40, "meters_per_cell": 0.5 },
  "terrain": [ ... ],                    // rows × cols glyphs, as always
  "terrain_legend": { "_": "tierra", "c": "empedrado" },  // base wash under `ground` (and walkability grid)
  "ground": [                            // PREFERRED for streets, plazas, water and courtyards: typed VECTOR features painted OVER the terrain base — real curves, no grid teeth. Coordinates in cells of THIS scene (0..cols, 0..rows). Same language as the tile MAP PLAN.
    { "id": "calle", "kind": "path", "points": [[0, 18], [16, 14], [30, 16]], "w": 5, "material": "dirt" },   // polyline + width; the engine SMOOTHES it (Catmull-Rom) — 3+ points give a real curve
    { "id": "plaza", "kind": "area", "ellipse": { "center": [30, 12], "rx": 14, "ry": 7 }, "material": "cobble" },  // also "rect": [c,r,w,d] or "polygon": [[c,r],…] (3..32 pts). Materials: dirt|cobble|stone|sand|wood|gravel|grass
    { "id": "arroyo", "kind": "water", "rect": [40, 0, 4, 24] },              // NOT walkable — collision AND the reachability validator see it
    { "id": "puente", "kind": "deck", "rect": [40, 10, 4, 4], "material": "wood" }  // walkable OVER water: without one, an exit across a river is REJECTED
  ],
  "entities": [ ... ],                   // furniture, props, NPCs; include "player" ONLY on bootstrap or when no entry edge is known
  "volumes": [                           // PREFERRED for the main scenery: typed volumes with materials — richer clay than plain entities
    { "id": "posada", "label": "posada del Roble", "type": "building",
      "rect": [4, 0, 14, 6], "wall_h": 11, "angle": -12,
      "roof": { "kind": "gable", "material": "tile" },
      "walls": { "material": "timber" },
      "doors": [ { "edge": "s", "at": 9, "w": 3 } ] },
    { "id": "olmo", "label": "olmo viejo", "type": "tree", "at": [26, 14], "s": 1.5 },
    { "id": "carro", "label": "carro de toneles", "type": "prop",
      "rect": [12, 12, 4, 2], "shape": "box", "h": 3, "angle": 25 }
  ],
  "stage": {
    "focal_m": 12,                       // optional CAMERA DISTANCE in meters behind the south edge; ~6-8 = intimate room, 12-18 = street, 20+ = wide establishing shot. Clamped so the frame always covers the stage width.
    "exits": [
      { "id": "puerta_cocina", "edge": "north", "to_place_id": "posada_cocina",
        "zone": [14, 0, 4, 2], "kind": "door", "label": "Puerta a la cocina" },
      { "id": "salida_calle", "edge": "south", "to_place_id": "calle_mayor",
        "zone": [10, 18, 6, 2], "kind": "opening", "label": "Salida a la calle" }
    ],
    "backdrop": { "description": "Pared de piedra con chimenea encendida y estanterías" },
    "ambience": { "time_of_day": "atardecer", "mood": "calima dorada y humo de cocina" },  // optional; drives the clay's sun/sky/fog presets and the repaint's atmosphere
    "surroundings": [                    // optional, EXTERIOR sets: what the player SEES beyond the playable bounds. Pure scenery: no collision, never walkable. Units: METERS from the stage CENTER (x east, z south — beyond the backdrop is NEGATIVE z, past the wings |x| > width/2). Recommended z in [-15, -120] (farther drowns in haze)
      { "kind": "hill", "pos": [30, -60], "r": 70, "h": 12 },
      { "kind": "tower", "pos": [34, -55], "r": 4, "h": 24, "y_base": 11 },   // y_base = base height in m: the keep STANDS ON its hill
      { "kind": "house", "pos": [-18, -22], "w": 8, "d": 6, "h": 6, "angle": -18 },
      { "kind": "house", "pos": [-26, -34], "w": 7, "d": 6, "h": 5, "angle": 9 },
      { "kind": "wall", "pos": [22, -30], "len": 20, "h": 5, "angle": 35 },
      { "kind": "tree", "pos": [-15, 9], "s": 1.2 }
    ],
    "wall_h_m": 3.5,                     // optional, INTERIORS only: wall/ceiling height in meters, at the scale of the room — hut 2.4, tavern 3.5, noble hall 5+. Range [2.2, 8]; default 3.5
    "fourth_wall": { "present": true, "doors": [ { "col": 10, "w": 6 } ] }
  }
}

HARD RULES OF THE STAGE:
- "stage" is REQUIRED and "place_id" is REQUIRED. The server rejects the
  scene otherwise.
- EXITS ⇔ LINKS, exactly: every world-map link of this place needs ONE exit
  whose to_place_id is that link's destination, and every exit needs its
  link. Create places/links FIRST with map_upsert_place + map_link (with the
  correct edge), then declare the matching exits. The server validates both
  directions and rejects mismatches.
- Every exit zone must be walkable and REACHABLE from the player spawn/entry
  (flood-fill validated). Put door gaps in your walls where the zones are.
- exit.edge must agree with the link's edge as seen from THIS place
  (map_link edge is declared from the `from` place; walking a bidirectional
  link backwards flips it).
- EXIT KIND is about what is PHYSICALLY there, never symbolic:
  * "door" ONLY when there is literally a door or gate (a building entrance,
    a walled garden's gate, a city gate). The engine paints it.
  * "opening" for everything else: the street continuing past the edge of
    the set, a clearing in the woods, a path leaving a field, the open end
    of a bridge. The engine paints NO door — the set simply opens at that
    edge and the player walks off-frame. Most east/west exits and most
    exterior exits are openings. Make opening zones GENEROUS: on a side
    edge, span several rows (even the whole walkable strip if natural, e.g.
    [78, 6, 2, 20]); reaching the edge of the screen is enough.
  * "stairs" when a visible level change carries the player out.
  * A building's door on the north edge (entering a facade you SEE): the
    building occupies the top rows; put the exit zone on the WALKABLE ground
    directly under its facade (e.g. building rows 0-2 → zone [28, 3, 4, 2]).
    The zone is where the player STEPS, not the painted door itself.
- COMPOSE IN DEPTH, like a film shot — the camera is at the south edge, so a
  row of buildings across the north edge reads as a flat postcard seen from
  afar. Instead: place buildings/trees FLANKING the east and west sides,
  receding toward the north; let the street/path run south→north toward the
  backdrop; put the action (market stall, well, cart) in the MIDDLE ground;
  and drop 1-2 props near the south corners (a barrel, a post, a tree) — they
  frame the shot in the foreground. Keep street-like stages NARROW (≤ 40
  cols at 0.5 = 20 m): the camera gets closer and the player looks bigger.
- Scenery (buildings, trees, big props) goes PREFERABLY in the typed
  "volumes" block: `wall_h` (cells) sets the real height (11 = two storeys),
  `roof.kind/material`, `walls.material` (timber|stone|plaster|wood) and
  `doors` produce a far richer clay than a plain entity box. Furniture and
  small props can stay as entities (their `h` in meters IS respected).
  For a shape no preset fits — the curved arc of a ruined tower wall, a broken
  archway framing the stage — use a `prism`: FREE geometry
  { points:[[c,r],…] (3..24), h (cells), solid?=true, tall?=true, color? }.
  Sample curves into points (a semicircle ≈ 8-12).
- `angle` (buildings and rect-props, DEGREES −180..180, counter-clockwise
  from above): rotates the piece around its footprint center — collision and
  the vision manifest follow the rotation. USE IT: village houses at varied
  small angles (±5..±30°) are what makes the set read as a real place
  instead of a grid. Not allowed on `cutaway` buildings (the playable
  interior stays axis-aligned).
- `surroundings` (exterior sets): declare the world PAST the edges — the
  receding hamlet, the castle on its hill (`hill` + `y_base`), orchard walls,
  trees. The engine drops its generic background hills when you declare
  them. Everything there is scenery: no collision, no interaction, and its
  center must lie OUTSIDE the playable bounds (the server rejects it
  otherwise). Keep it coherent with the world map: what each neighbouring
  place is, seen from here.
- SURROUNDINGS SCALE IS REAL-WORLD SCALE. Never oversize a distant landmark
  "so it shows" — a fat tower near the backdrop reads as a silo glued to the
  set. Towers r 3-5 m; houses h 5-8 m; put structures at least ~15 m beyond
  the edge and let perspective + haze do the work. A `hill` must sit mostly
  BEHIND the set: its center at least half its radius beyond the nearest
  edge (the server rejects a hill hugging the bounds — its skirt would wall
  off the stage).
- TALL SURROUNDINGS GO BEHIND THE BACKDROP, NEVER PAST THE WINGS. The camera
  frames wider than the stage: anything past the east/west edge sits CLOSE to
  the lens, so a tower there becomes a giant pillar filling the frame. Rule:
  structures taller than ~8 m need z ≤ −(rows·mpc/2 + 20) — on the north
  skyline, where distance shrinks them. Past the wings only LOW scenery:
  houses, walls, trees. If a landmark lives to the east in the world map,
  express it as NORTH-EAST skyline (x positive, z far negative).
- FRAMING PROPS placement: the southern-third props go in the CENTRAL half
  of the width (|x| between ~w/6 and ~w/3 from center), NOT at the far
  corners of a wide stage — the camera crops wider than you think and corner
  props fall out of frame. And mind the APRON: the southernmost terrain row
  extends toward the camera as the foreground ground — give it the material
  you want to SEE up close (the plaza's cobbles, not a leftover dirt band),
  or better: extend a `ground` area/path into the southern rows.
- PORCHES: a building whose label says soportal/pórtico/porche/arcada/logia
  gets a real colonnade (columns + eave) on its south facade in the clay —
  the classic arcaded plaza front. Use it on inns and market halls.
- Fire and lamp props LIGHT UP: any volume/entity labelled chimenea, hogar,
  fogón, farol, vela, antorcha, candil, brasero or hoguera gets a warm
  practical light in the clay — use them to give interiors a focal point.
- Stages are GENEROUS, not corridors: a stage is a whole location the player
  can SPEND TIME in — several points of interest, NPCs with agendas, room to
  move and fight. Interiors: 24–48 cols × 12–24 rows at meters_per_cell 0.5
  (12–24 m wide). Exteriors (streets, plazas, fields, forest clearings):
  48–80 cols × 16–40 rows at 0.5, or meters_per_cell 1.0 for truly big open
  stages (up to 80 m wide — the camera rails along, the player walks). For
  very deep stages raise focal_m (camera further back, flatter) so the far
  end stays readable; for intimate close rooms lower it toward 6-8. Omit it
  otherwise (the engine derives a good default from the stage width).
- NEVER build a pass-through stage that exists only to be crossed: if a
  location is mere transit, FOLD it into a bigger neighbouring stage and
  save the transition. Every stage must justify itself: someone to talk to,
  something to examine or take, a hook — and usually 2+ exits (the way back
  plus somewhere NEW), so the world keeps opening instead of dead-ending.
- stage_request.entry_edge (when present) tells you which edge the player
  enters from: keep a walkable area at that exit's zone (the engine spawns
  the player just inside it). Do NOT include a "player" entity then.
- stage_request.bootstrap true = first scene of the session: DO include the
  "player" entity at a sensible spot.
- The fourth wall is optional flavour: use it for interiors (the "missing
  wall" the camera looks through); leave it out for open-air stages.
- "style_ref" is the id of the style-pack reference image guiding the
  repaint of this stage, chosen from world.style_refs.scene ({id,
  description} entries — ground-level SET references for proscenium worlds).
  Pick the one whose content best matches the stage; unknown/missing id
  degrades to the pack's first stage reference.
- HARD RULE: a roofed stage MUST declare "interior": true inside the stage
  block (and usually a fourth_wall). Without either signal the engine
  renders it as an EXTERIOR — open sky, distant hills, high 3.2 m camera
  eye. Declaring fourth_wall together with "interior": false is a
  contradiction and the scene is rejected.
- Backdrop description is what the player SEES at the north edge (Spanish,
  concrete, matches the world). It seeds future AI repainting — describe a
  view, not a wall of text.
- Everything else (entities in Spanish, terrain glyphs, ground/volumes) works
  exactly as in a normal scene. Where these stage rules and the generic scene
  reference that follows disagree (meters_per_cell, grid-size budgets, whether
  to include the "player" entity), THE STAGE RULES WIN.
