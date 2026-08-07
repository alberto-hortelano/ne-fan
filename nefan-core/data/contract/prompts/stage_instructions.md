==== HOW TO RESPOND (kind: "scene" — PROSCENIUM STAGE) ====
world_state.stage_request is present: this world uses the PROSCENIUM view.
The world is NOT a continuous plane — it is a chain of discrete STAGES
(theatre sets / classic film sets), one per world-map place, connected ONLY
through physical exits. Walking into an exit zone transitions to the linked
place's stage with a fade (think classic survival-horror doors). There are NO
tiles here: never emit "tile", "biome", "ground" or "volumes"-only tiles.

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

Call narrative_respond with a CLASSIC Format D scene PLUS the "stage" block:
{
  "scene_id": "<slug>",
  "place_id": "<the place from realize_place — REQUIRED>",
  "scene_description": "<2-3 Spanish sentences>",
  "style_tag": "stage_interior",         // kind of SET (see hard rules)
  "size": { "cols": 24..80, "rows": 12..40, "meters_per_cell": 0.5 },
  "terrain": [ ... ],                    // rows × cols glyphs, as always
  "terrain_legend": { "_": "tierra", "c": "empedrado" },  // ground bands ARE painted — use them (dirt street, cobbles, grass)
  "structures": [ ],                     // optional interior sub-rooms
  "entities": [ ... ],                   // furniture, props, NPCs; include "player" ONLY on bootstrap or when no entry edge is known
  "volumes": [                           // PREFERRED for the main scenery: typed volumes with materials — richer clay than plain entities
    { "id": "posada", "label": "posada del Roble", "type": "building",
      "rect": [4, 0, 14, 6], "wall_h": 11,
      "roof": { "kind": "gable", "material": "tile" },
      "walls": { "material": "timber" },
      "doors": [ { "edge": "s", "at": 9, "w": 3 } ] },
    { "id": "olmo", "label": "olmo viejo", "type": "tree", "at": [26, 14], "s": 1.5 },
    { "id": "carro", "label": "carro de toneles", "type": "prop",
      "rect": [12, 12, 4, 2], "shape": "box", "h": 3 }
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
    "fourth_wall": { "present": true, "doors": [ { "col": 10, "w": 6 } ] }
  },
  "ambient_event": "…"
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
- "style_tag" is the kind of SET this stage is — one of
  stage_interior|stage_street|stage_plaza|stage_nature|stage_harbor|stage_gate.
  It picks the game's style reference for the repaint. Without it the engine
  infers one (fourth_wall present → stage_interior; otherwise a default).
- Backdrop description is what the player SEES at the north edge (Spanish,
  concrete, matches the world). It seeds future AI repainting — describe a
  view, not a wall of text.
- Everything else (entities in Spanish, terrain glyphs, structures) works
  exactly as in a normal scene.
