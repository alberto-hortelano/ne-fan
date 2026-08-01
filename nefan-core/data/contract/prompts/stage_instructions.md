==== HOW TO RESPOND (kind: "scene" — PROSCENIUM STAGE) ====
world_state.stage_request is present: this world uses the PROSCENIUM view.
The world is NOT a continuous plane — it is a chain of discrete STAGES
(theatre sets / classic film sets), one per world-map place, connected ONLY
through physical exits. Walking into an exit zone transitions to the linked
place's stage with a fade (think classic survival-horror doors). There are NO
tiles here: never emit "tile", "biome", "map_ground" or "volumes"-only tiles.

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
  "size": { "cols": 16..40, "rows": 10..24, "meters_per_cell": 0.5 },
  "terrain": [ ... ],                    // rows × cols glyphs, as always
  "terrain_legend": { },
  "structures": [ ],                     // optional interior sub-rooms
  "entities": [ ... ],                   // furniture, props, NPCs; include "player" ONLY on bootstrap or when no entry edge is known
  "stage": {
    "focal_m": 12,                       // optional, ground perspective f/(f+z)
    "exits": [
      { "id": "puerta_cocina", "edge": "north", "to_place_id": "posada_cocina",
        "zone": [14, 0, 4, 2], "kind": "door", "label": "Puerta a la cocina" },
      { "id": "salida_calle", "edge": "south", "to_place_id": "calle_mayor",
        "zone": [10, 18, 6, 2], "kind": "opening", "label": "Salida a la calle" }
    ],
    "backdrop": { "description": "Pared de piedra con chimenea encendida y estanterías" },
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
- Keep stages intimate: 16–40 cols × 10–24 rows at meters_per_cell 0.5
  (8–20 m wide, 5–12 m deep). A stage is one room, one courtyard, one street
  section — not a whole village. Split big locations into several linked
  places, each with its own stage.
- stage_request.entry_edge (when present) tells you which edge the player
  enters from: keep a walkable area at that exit's zone (the engine spawns
  the player just inside it). Do NOT include a "player" entity then.
- stage_request.bootstrap true = first scene of the session: DO include the
  "player" entity at a sensible spot.
- The fourth wall is optional flavour: use it for interiors (the "missing
  wall" the camera looks through); leave it out for open-air stages.
- Backdrop description is what the player SEES at the north edge (Spanish,
  concrete, matches the world). It seeds future AI repainting — describe a
  view, not a wall of text.
- Everything else (entities in Spanish, terrain glyphs, structures) works
  exactly as in a normal scene.
