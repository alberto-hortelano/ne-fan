import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WsBridge } from './ws-bridge.js';
import { bridgeGet, bridgePost, type BridgeResult } from './bridge-http-client.js';

/** Pre-flight check of a narrative_event response (kind === 'narrative_event')
 *  BEFORE it is forwarded to the Python ai_server. The ai_server applies the
 *  same strict rules (ai_server/narrative_schemas.py:validate_narrative_reaction)
 *  and returns HTTP 422 on any deviation — but that rejection never reaches this
 *  MCP session, so narrative_respond would report success while the player sees
 *  nothing. Validating here gives the engine the precise error so it can fix the
 *  shape and resend. Keep this mirror in sync with the Python validator. */
function validateNarrativeReaction(data: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const raw = (data as Record<string, unknown>).consequences;
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'payload missing list `consequences`' };
  }
  if (raw.length > 4) {
    return { ok: false, error: `returned ${raw.length} consequences, max is 4` };
  }
  const validTypes = new Set(['dialogue', 'story_update', 'spawn_entity', 'schedule_event', 'plugin_event', 'noop']);
  const validKinds = new Set(['npc', 'building', 'object']);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  for (let idx = 0; idx < raw.length; idx++) {
    const c = raw[idx];
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return { ok: false, error: `consequence[${idx}] is not an object` };
    }
    const o = c as Record<string, unknown>;
    const t = o.type;
    if (typeof t !== 'string' || !validTypes.has(t)) {
      return { ok: false, error: `consequence[${idx}].type='${String(t)}' is invalid; allowed: ${[...validTypes].sort().join(', ')}` };
    }
    if (t === 'noop') continue;
    if (t === 'dialogue') {
      if (!str(o.speaker)) return { ok: false, error: `dialogue[${idx}] missing required field \`speaker\`` };
      if (!str(o.text)) return { ok: false, error: `dialogue[${idx}] missing required field \`text\`` };
      if (o.choices !== undefined && o.choices !== null) {
        if (!Array.isArray(o.choices)) return { ok: false, error: `dialogue[${idx}].choices must be a list` };
        const trimmed = o.choices.map(str).filter(Boolean);
        if (trimmed.length > 3) return { ok: false, error: `dialogue[${idx}].choices has ${trimmed.length} entries, max is 3` };
      }
    } else if (t === 'story_update') {
      if (!str(o.delta)) return { ok: false, error: `story_update[${idx}] missing required field \`delta\` (non-empty string)` };
    } else if (t === 'spawn_entity') {
      if (typeof o.entity_kind !== 'string' || !validKinds.has(o.entity_kind)) {
        return { ok: false, error: `spawn_entity[${idx}].entity_kind='${String(o.entity_kind)}' invalid; allowed: ${[...validKinds].sort().join(', ')}` };
      }
      if (!str(o.description)) return { ok: false, error: `spawn_entity[${idx}] missing required field \`description\`` };
    } else if (t === 'schedule_event') {
      if (!str(o.description)) return { ok: false, error: `schedule_event[${idx}] missing required field \`description\`` };
    } else if (t === 'plugin_event') {
      if (!str(o.plugin_id)) return { ok: false, error: `plugin_event[${idx}] missing required field \`plugin_id\`` };
      if (!str(o.event_type)) return { ok: false, error: `plugin_event[${idx}] missing required field \`event_type\`` };
      if (o.payload !== undefined && (typeof o.payload !== 'object' || o.payload === null || Array.isArray(o.payload))) {
        return { ok: false, error: `plugin_event[${idx}].payload must be an object` };
      }
    }
  }
  return { ok: true };
}

/** Pre-flight de una respuesta blueprint_review, espejo de
 *  ai_server/narrative_schemas.py:validate_blueprint_review. Misma razón que
 *  validateNarrativeReaction: el 422 del ai_server no vuelve a esta sesión. */
function validateBlueprintReview(data: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: `payload must be an object, got ${Array.isArray(data) ? 'array' : typeof data}` };
  }
  const o = data as Record<string, unknown>;
  if (typeof o.approved !== 'boolean') {
    return { ok: false, error: 'missing boolean `approved`' };
  }
  if (o.issues !== undefined && (!Array.isArray(o.issues) || o.issues.some((i) => typeof i !== 'string'))) {
    return { ok: false, error: '`issues` must be a list of strings' };
  }
  if (o.approved === false && (!Array.isArray(o.issues) || o.issues.length === 0)) {
    return { ok: false, error: 'approved=false requires a non-empty `issues` list explaining what is wrong' };
  }
  if (o.fixes !== undefined && o.fixes !== null) {
    if (typeof o.fixes !== 'object' || Array.isArray(o.fixes)) {
      return { ok: false, error: '`fixes` must be an object' };
    }
    const f = o.fixes as Record<string, unknown>;
    const allowed = new Set(['terrain', 'terrain_features', 'entity_moves']);
    for (const k of Object.keys(f)) {
      if (!allowed.has(k)) return { ok: false, error: `fixes.${k} is not a valid fix; allowed: ${[...allowed].sort().join(', ')}` };
    }
    if (f.terrain !== undefined && (!Array.isArray(f.terrain) || f.terrain.some((r) => typeof r !== 'string'))) {
      return { ok: false, error: 'fixes.terrain must be the FULL list of terrain row strings' };
    }
    if (f.terrain_features !== undefined && !Array.isArray(f.terrain_features)) {
      return { ok: false, error: 'fixes.terrain_features must be the FULL replacement list' };
    }
    if (f.entity_moves !== undefined) {
      if (!Array.isArray(f.entity_moves)) return { ok: false, error: 'fixes.entity_moves must be a list' };
      for (let i = 0; i < f.entity_moves.length; i++) {
        const m = f.entity_moves[i] as Record<string, unknown>;
        if (typeof m !== 'object' || m === null || typeof m.id !== 'string' || !Array.isArray(m.cell) || m.cell.length !== 2) {
          return { ok: false, error: `fixes.entity_moves[${i}] must be { id: string, cell: [col,row] }` };
        }
      }
    }
  }
  return { ok: true };
}

// ── Per-kind response instructions ───────────────────────────────────────────
// Single source of truth for "how to answer each request kind". These are
// emitted INSIDE the narrative_listen return payload (adjacent to each request)
// so the schema is always in context when the engine decides its response —
// instead of living only in the (long, truncatable) narrative_listen tool
// description. Keep wording in sync with ai_server/narrative_schemas.py.

const SCENE_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "scene") ====
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
  "terrain_features": [   // OPTIONAL — vector shapes over the grid (see TERRAIN FEATURES)
    { "type": "river"|"path"|"bridge"|"stone"|"dirt"|"sand"|"wood"|"<free name>",
      "points": [[col,row], ...], "width": <cells>, "closed": true|false }
  ],
  "structures": [   // PREFERRED for any enterable room/building (see STRUCTURES)
    { "type": "room", "rect": [<col>, <row>, <w>, <h>], "wall_char": "W", "floor_char": "o",
      "doors": [ { "side": "north"|"south"|"east"|"west", "at": <cells>, "width": <cells> } ] }
  ],
  "vegetation_zones": [   // OPTIONAL — deterministic tree scatter (see VEGETATION ZONES)
    { "type": "<plant name>", "area": [<col>, <row>, <w>, <h>], "density": 0.05-0.25 }
  ],
  "entities": [
    { "id": "<unique slug>", "kind": "building"|"prop"|"item"|"tree"|"npc"|"player"|"decor",
      "name": "<spanish>", "cell": [col, row], "footprint": [w, h], "glyph": "<1 ASCII char>",
      "shape": "box"|"cylinder"|"sphere"|"cone" },   // optional; default box
    ...
  ],
  "ambient_event": "<one Spanish atmospheric line>"
}

COORDINATES: top-left is (0,0). col → east, row → south.

SCALE — meters_per_cell (CHOOSE IT per scene; do NOT default to 2):
A [1,1] footprint is meters_per_cell metres across, and the player is ~0.8 m.
So pick meters_per_cell to match the smallest thing that matters in the scene,
keeping cols/rows within the string budget (≤ 80×60). Real size = cols × mpc.
- INTERIOR (tavern, shop, room): meters_per_cell 0.5 → a [1,1] prop is a 0.5 m
  stool/keg (≈ the player). Size the room so cols×0.5 ≈ its real width: a tavern
  ~10×7 m ⇒ ~20×14 cells PLUS exterior margin. The room shell is a \`structures\`
  room (the engine stamps its walls), NOT a "building" entity. Furniture is
  small (stools/kegs 1×1, tables 2×2 to 3×2, counters [5..8]×1).
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
The engine scatters \`tree\` entities deterministically (seeded by scene_id) over
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

TERRAIN FEATURES (optional; USE THEM for anything linear or organic — they make
far better maps than cell rows)
The grid paints broad zones; terrain_features draw SMOOTH VECTOR SHAPES on top:
a river that meanders, a curving road, a round plaza. Each feature is either a
thick polyline (default) or a filled polygon ("closed": true).
- "points": list of [col,row] cell coordinates, FLOATS ALLOWED ([12.5, 3.0]).
  2+ points for a polyline, 3+ for a polygon.
- "width": stroke width in CELLS (rivers 2-4, roads 1-2, streams 0.5-1).
- "type": river|water|path|road|bridge|stone|paved|dirt|sand|wood|grass, or a
  free Spanish name ("arroyo", "sendero") — resolved by keywords. You can force
  a colour with "color": "#rrggbb".
- PAINT ORDER = array order: list the river FIRST, then the bridge across it,
  then roads that end at the bridge.
- Rule of thumb: a river/road drawn with terrain_features should follow the same
  course as its "w"/"_" cells in the grid (the grid stays the coarse base; the
  feature refines it with curves). For purely decorative curves you may skip the
  grid cells entirely and use only the feature.
Example — a meandering river crossed by a bridge, with a road reaching it:
  "terrain_features": [
    { "type": "river",  "points": [[0,18],[9,15],[20,13],[32,14],[47,12]], "width": 3 },
    { "type": "bridge", "points": [[23,11],[23,17]], "width": 2 },
    { "type": "path",   "points": [[24,29],[23.5,22],[23,17]], "width": 1.5 }
  ]

TERRAIN SVG (advanced, RARELY needed — only when grid + terrain_features cannot
express the shape): "terrain_svg" is an SVG string of pure shapes drawn over the
terrain, under the entities. viewBox EXACTLY "0 0 <cols> <rows>" (units = cells),
max 20 KB, only shape elements (path/rect/circle/ellipse/polygon/line) — no
<script>, no foreignObject, no href. Most scenes need no SVG at all.

ENTITY RULES
- Every entity has a UNIQUE id (slug). Two trees in different places need
  different ids ("tree_n1", "tree_w2") even if they share name ("roble").
- cell is the TOP-LEFT of the footprint. cell + footprint must stay inside the grid.
- Buildings (OUTDOOR scenes, mpc 2): ONE rectangular footprint each — a tavern
  seen from outside is one rectangle of 6×4 to 8×6 cells, NOT four wall slabs.
  (Indoors you are INSIDE the building, so there is no building entity; the
  walls come from its \`structures\` room.)
- Props are usually 1×1 (= mpc metres: 0.5 m indoors, 2 m outdoors). Indoor
  furniture stays 1×1/2×1; tables and counters a bit bigger. Carts/log piles 2×1.
- NPCs and player are always 1×1.
- Place NPCs at their workspot (smith near smithy, innkeeper at inn's door).
- Player starts where the narrative says they enter the scene.
- "decor" = purely aesthetic set dressing: wall torches, banners, rugs, cobwebs,
  hanging signs, stains. Visible on the map but NO collision and NO interaction.
  Use decor (never prop) for anything the player should walk past freely; a prop
  is a physical obstacle (table, barrel, cart).

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

ASSET REUSE: if available_assets contains a matching texture/model, add
"texture_hash" or "model_hash" to that entity.

VALIDATION before responding:
- [ ] every terrain row is exactly cols chars
- [ ] number of terrain rows equals rows
- [ ] every entity has id/kind/name/cell/footprint/glyph
- [ ] no two entities share an id
- [ ] no footprint runs off the grid
- [ ] every glyph differs from every terrain char
- [ ] PLAYABILITY: the player spawn is walkable; walking from it you can reach
      every structure door AND some map edge (the world continues there)
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
  ],
  "ambient_event": "Una rama cruje en algún lugar tras los pinos y el humo de la chimenea huele a pino quemado."
}

EXAMPLE — INTERIOR de taberna CON EXTERIOR alrededor, 28 cols × 16 rows,
meters_per_cell 0.5 (= 14×8 m). La sala es una entrada de \`structures\` — el
motor estampa los muros W cerrados, el suelo de madera y el hueco de puerta
transitable; tú escribes SOLO el terreno base (hierba). Un camino conecta la
puerta con el borde sur, por donde continúa el mundo. NO hay entidad "building".
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
    { "id": "mostrador", "kind": "prop", "name": "mostrador de roble",        "cell": [6, 3],  "footprint": [6, 1], "glyph": "=" },
    { "id": "barkeep",   "kind": "npc",  "name": "Tabernero corpulento",      "cell": [9, 4],  "footprint": [1, 1], "glyph": "n" },
    { "id": "mesa_1",    "kind": "prop", "name": "mesa con jarras vacías",    "cell": [7, 7],  "footprint": [3, 2], "glyph": "m" },
    { "id": "barril_1",  "kind": "prop", "name": "barril de cerveza",         "cell": [21, 3], "footprint": [1, 1], "glyph": "k" },
    { "id": "antorcha_1","kind": "decor","name": "antorcha de pared",         "cell": [8, 2],  "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "antorcha_2","kind": "decor","name": "antorcha de pared",         "cell": [18, 2], "footprint": [1, 1], "glyph": "i", "attach": "wall" },
    { "id": "player",    "kind": "player","name": "Tú",                       "cell": [13, 13],"footprint": [1, 1], "glyph": "@" }
  ],
  "ambient_event": "El fuego crepita dentro y el viento arrastra olor a resina desde los pinos."
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
Optionally add more links from the new place onward (future frontiers).`;

const ROOM_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "room", legacy enclosed-room schema) ====
You are the narrative engine for a Godot 4 dark fantasy RPG (legacy enclosed-room schema).
All units in METERS. Room centered at origin, floor at y=0.

When you receive a world state with entry_wall, generate this JSON structure
and call narrative_respond with the JSON:
{
  "room_id": "unique_id",
  "room_description": "2-3 sentences in Spanish",
  "dimensions": { "width": 8-15, "height": 3-5, "depth": 8-15 },
  "surfaces": { "floor": {...}, "ceiling": {...}, "walls": [...] },
  "exits": [{ "wall": "south", "offset": 0, "size": [2,3], ... }],
  "lighting": { "ambient": {...}, "lights": [...] },
  "objects": [...],
  "npcs": [...],
  "ambient_event": "atmospheric text in Spanish"
}
RULES: exit on entry_wall, objects.y=0 floor, descriptions in Spanish, prompts in English.`;

const WEAPON_ORIENT_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "weapon_orient") ====
You are looking at 3 orthographic renders of an isolated 3D weapon mesh
(front, side, top — in that order) generated by the AI 3D pipeline.

The mesh is centered on its bounding box. Coordinates you return are
NORMALIZED to [0,1]^3 where (0,0,0) is bbox min and (1,1,1) is bbox max.

The 3 view conventions:
- front: camera at +Z looking toward origin (X right, Y up)
- side:  camera at +X looking toward origin (Z right, Y up)
- top:   camera at +Y looking down (X right, -Z into screen)

Identify:
1. grip_point_normalized — where the hand wraps the weapon
   (cylindrical wrapped area for swords; center of back face for shields;
    bottom of haft for axes/maces; middle of riser for bows)
2. blade_direction — unit vector from grip toward tip/edge/front
3. up_direction — unit vector perpendicular to blade_direction, the "up" face
   (back of sword blade, front of shield, top of axe head)

Right-handed coordinates throughout. All vectors must be unit length.
Confidence: 0.9+ if grip and blade are clearly visible; 0.5-0.8 if uncertain;
<0.5 if the mesh looks broken or you cannot identify the weapon.

Respond with narrative_respond, passing this JSON:
{
  "grip_point_normalized": [x, y, z],
  "blade_direction":       [x, y, z],
  "up_direction":          [x, y, z],
  "weapon_type":           "sword" | "shield" | "axe" | "mace" | "staff" | "bow" | "dagger" | "spear" | "generic",
  "grip_length_normalized": 0.0..1.0,
  "confidence":             0.0..1.0,
  "notes":                  "short rationale"
}`;

const WEAPON_VERIFY_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "weapon_verify") ====
You see one image of a character holding a weapon. Verify the weapon is
correctly placed in the hand for combat stance. Call narrative_respond with:
{ "ok": bool, "issue": "string", "suggested_delta_euler": [rx, ry, rz] }`;

const NARRATIVE_EVENT_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "narrative_event") ====
A player has just answered an NPC. The request above carries: speaker,
chosen_text, free_text, and a context snapshot of the NarrativeState
(story_so_far, recent_dialogues, entities already in the world, current scene
id, available_assets).

Your answer is ALWAYS the object { "consequences": [ ... ] } passed to
narrative_respond. \`dialogue\` is one ENTRY inside that array — never a
top-level field, and the option list is \`choices\`, never \`options\`.

CRITICAL — when free_text is non-empty:
- The scripted scenario is PAUSED waiting for you. You MUST include at least
  one \`dialogue\` consequence so a visible NPC reacts in-world and the player
  sees something happen. Stay in character for the setting.
- A \`story_update\` ALONE is NOT a valid answer here: it only writes a
  3rd-person line to the log and the dialogue UI never opens, so the player
  sees nothing to interact with. Always include the \`dialogue\` consequence
  (you may ADD a story_update alongside it, never instead of it).
- APPROACH/GREETING: if chosen_text marks the player walking up to an NPC
  (e.g. "(el jugador se acerca y saluda)") or free_text is just a greeting,
  open with that NPC SPEAKING in first person via a \`dialogue\` consequence
  (speaker = the NPC you received). Do not merely narrate that they speak.
- Write the dialogue text in the SAME LANGUAGE the player used in free_text
  (Spanish for Spanish, English for English, etc.).
- The dialogue \`speaker\` should be an NPC already in \`entities\` — reuse
  the same display name so the game can route the line to them. It can be
  the speaker you received or another NPC present in the scene.
- If the player expressed intent to go somewhere or find something
  (forge, healer, captain), also add a spawn_entity consequence and have
  the dialogue reference the newly-spawned thing.

CRITICAL — when free_text is empty (numbered choice only):
- The scripted scenario advances on its own. Usually return an empty
  consequences array unless the choice strongly implies a world reaction.

Pass this JSON to narrative_respond:
{
  "consequences": [
    { "type": "dialogue", "speaker": "NPC display name",
      "text": "what they say (same language as free_text)",
      "choices": ["optional", "2-3 follow-up", "options"] },
    { "type": "story_update", "delta": "1-3 sentences appended to story_so_far" },
    { "type": "spawn_entity", "entity_kind": "npc"|"building"|"object",
      "description": "vivid English description for asset gen",
      "name": "optional NPC name", "position_hint": "near_player|distant_east|...",
      "texture_hash": "optional reused asset hash",
      "model_hash": "optional reused asset hash" },
    { "type": "schedule_event", "description": "what to schedule",
      "trigger": "next_scene|timer:60s|on_player_action:..." },
    { "type": "plugin_event", "plugin_id": "sha256 of an ACTIVE plugin",
      "event_type": "one of the plugin's events_consumed (e.g. trade_offered)",
      "payload": { "any": "fields the plugin's rules read as event.*" } }
  ]
}
Max 4 consequences. Reuse available_assets by hash when sensible.

STRICT SHAPE — the validator REJECTS aliases:
- type MUST be exactly one of "dialogue" | "story_update" | "spawn_entity"
  | "schedule_event" | "plugin_event" | "noop". "show_dialogue" is NOT valid.
- story_update REQUIRES a non-empty "delta" field. Do not use "text" or
  "summary" — they will be rejected.
- dialogue REQUIRES non-empty "speaker" and "text"; its options field is
  "choices" (max 3), NOT "options". spawn_entity REQUIRES "entity_kind"
  (npc/building/object) and "description". schedule_event REQUIRES
  "description". plugin_event REQUIRES "plugin_id" and "event_type" and only
  makes sense for plugins the session has active — the game engine runs the
  plugin's declarative rules (commerce, reputation, ...); emit it instead of
  hand-narrating what a plugin already models.
If you produce an alias, narrative_respond rejects it here (and ai_server would
return HTTP 422). Fix the response shape, not the validator.

OTHER ACTIONS during this turn (optional, alongside consequences): you may also
call the state tools to mutate authoritative state directly — inventory_add
(give/take items), npc_move_to_place / npc_arrive / npc_set_directive (move or
re-direct NPCs), map_upsert_place / map_link / map_add_trigger (extend the
world map the story just mentioned), plugin_inspect / plugin_register (read or
add declarative systems). Use these for bookkeeping; use \`consequences\` for
what the player should SEE happen.`;

const BLUEPRINT_REVIEW_INSTRUCTIONS = `==== HOW TO RESPOND (kind: "blueprint_review") ====
You are LOOKING at the blueprint image the image model (Meshy) will receive for
this scene, next to the scene JSON that produced it. Review it for coherence
BEFORE credits are spent. Look for:
- a river/stream that starts or ends abruptly mid-map (should reach the edges
  or a water body);
- a bridge that does not touch both banks, or crosses nothing;
- roads/paths that lead nowhere or stop short of the building they serve;
- buildings/props overlapping each other or sitting inside water;
- a described element (in scene_description) missing from the map;
- large empty regions that contradict the description.

Respond via narrative_respond with EXACTLY this JSON:
{
  "approved": true | false,
  "issues": ["<one short Spanish line per problem found>", ...],   // required when approved=false
  "fixes": {                    // optional — PARTIAL overrides, only what changes
    "terrain": ["<row>", ...],              // FULL grid replacement (all rows, exact cols)
    "terrain_features": [ ... ],            // FULL replacement list (same schema as the scene)
    "entity_moves": [ { "id": "<entity id>", "cell": [col, row] }, ... ]
  }
}
- approved=true with no issues → the client proceeds to generation untouched.
- approved=false SHOULD include "fixes" so the client can repair and re-render
  without another round-trip. Fixes replace whole fields: if you fix one terrain
  row you must return ALL rows; same for terrain_features.
- Do NOT return a full scene; only the three fix fields above are applied.`;

async function main() {
  const bridge = await WsBridge.create();

  const server = new McpServer({
    name: 'narrative',
    version: '1.0.0',
  });

  // Stored request_id and kind from the last listen call, so respond knows where to send
  let currentRequestId: string | null = null;
  let currentKind: 'room' | 'scene' | 'weapon_orient' | 'weapon_verify' | 'narrative_event' | 'blueprint_review' = 'room';

  server.tool(
    'narrative_listen',
    `Block until the Python AI server sends a generation request, then return it.

This is half of a request/response loop: call narrative_listen to receive a
request, decide your answer, then call narrative_respond exactly once with it.
Then call narrative_listen again. Repeat for the whole session.

Every returned message starts with a "kind" field AND embeds the full response
schema for that kind in its own body — read the schema there each time; you do
not need to memorise it from this description.

Request kinds you may receive:
- "scene"           → generate a top-down 2D map (Map Format D).
- "room"            → legacy enclosed-room schema (only when format != scene).
- "weapon_orient"   → orient a 3D weapon mesh from 3 orthographic renders.
- "weapon_verify"   → check a weapon is correctly placed in a character's hand.
- "narrative_event" → the player answered an NPC. Return world consequences as
                      { "consequences": [ ... ] } — entries are dialogue /
                      story_update / spawn_entity / schedule_event /
                      plugin_event. (dialogue is an ENTRY in that array, never a
                      top-level field; its option list is "choices", not
                      "options".)
- "blueprint_review" → LOOK at the rendered blueprint image and check it against
                      the scene JSON; return { approved, issues, fixes? }.

Beyond responding, at ANY time during a turn you may ALSO call the state tools
to query or mutate authoritative game state without dumping the whole world
into context:
- map_get / map_upsert_place / map_link / map_add_trigger  — the world map.
- plugin_list / plugin_inspect / plugin_register           — declarative systems.
- entity_get / inventory_get / inventory_add               — entities & items.
- npc_arrive / npc_move_to_place / npc_set_directive       — NPC placement & behaviour.`,
    {},
    async () => {
      try {
        const msg = await bridge.waitForRequest();
        currentRequestId = msg.request_id;

        if (msg.type === 'vision_request') {
          currentKind = msg.kind;
          // Build content blocks: text header + image blocks + footer
          const header = JSON.stringify({
            kind: msg.kind,
            weapon_type: msg.weapon_type,
            context: msg.context ?? {},
            num_images: msg.images.length,
          }, null, 2);

          const content: Array<
            { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
          > = [
            { type: 'text', text: `Vision request:\n${header}` },
          ];
          for (const img of msg.images) {
            content.push({
              type: 'image',
              data: img.data_b64,
              mimeType: img.media_type,
            });
            content.push({ type: 'text', text: `(view: ${img.view})` });
          }
          content.push({
            type: 'text',
            text: 'Examine the views, then respond.\n\n' +
              (msg.kind === 'weapon_verify' ? WEAPON_VERIFY_INSTRUCTIONS : WEAPON_ORIENT_INSTRUCTIONS),
          });
          return { content };
        }

        if (msg.type === 'blueprint_review') {
          currentKind = 'blueprint_review';
          const sceneJson = JSON.stringify(msg.scene ?? {}, null, 2);
          return {
            content: [
              { type: 'text', text: 'Blueprint review request. This is the image the generator will receive:' },
              { type: 'image', data: msg.image.data_b64, mimeType: msg.image.media_type },
              { type: 'text', text: `Scene JSON that produced it:\n${sceneJson}\n\n${BLUEPRINT_REVIEW_INSTRUCTIONS}` },
            ],
          };
        }

        if (msg.type === 'narrative_event') {
          currentKind = 'narrative_event';
          const payload = JSON.stringify({
            kind: 'narrative_event',
            event_kind: msg.kind,
            event_id: msg.event_id,
            speaker: msg.speaker,
            chosen_text: msg.chosen_text,
            free_text: msg.free_text,
            context: msg.context,
          }, null, 2);
          return {
            content: [{
              type: 'text',
              text: `Narrative event:\n${payload}\n\n${NARRATIVE_EVENT_INSTRUCTIONS}`,
            }],
          };
        }

        // room_request — distingue entre open-world ('scene') y legacy ('room')
        // según el campo `format` que envía el ai_server.
        const format = msg.format ?? 'extended';
        currentKind = format === 'scene' ? 'scene' : 'room';
        const kindLabel = currentKind;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ kind: kindLabel, world_state: msg.world_state }, null, 2) +
              '\n\n' + (kindLabel === 'scene' ? SCENE_INSTRUCTIONS : ROOM_INSTRUCTIONS),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'narrative_respond',
    'Send your answer back to the Python AI server. Call exactly once after each ' +
    'narrative_listen. The room_data field is a JSON string whose shape depends on ' +
    'the kind of the pending request (the listen message embedded the exact schema):\n' +
    '  scene          → Map Format D map JSON\n' +
    '  room           → legacy enclosed-room JSON\n' +
    '  weapon_orient  → { grip_point_normalized, blade_direction, up_direction, weapon_type, confidence, ... }\n' +
    '  weapon_verify  → { ok, issue, suggested_delta_euler }\n' +
    '  narrative_event→ { "consequences": [ ... ] }  (NOT a bare dialogue object)\n' +
    '  blueprint_review→ { approved, issues, fixes? }  (fixes = overrides parciales)',
    {
      room_data: z.string().describe(
        'JSON string matching the pending request kind. For narrative_event it MUST be ' +
        '{ "consequences": [ ... ] } whose entries each have a "type" ' +
        '(dialogue/story_update/spawn_entity/schedule_event/plugin_event/noop). A ' +
        'dialogue entry uses "speaker"+"text"+optional "choices" (max 3) — a top-level ' +
        '"dialogue" object or an "options" field is ignored. See the listen message for ' +
        'the full per-kind schema.'),
    },
    async ({ room_data }) => {
      try {
        if (!currentRequestId) {
          return { content: [{ type: 'text', text: 'No pending request. Call narrative_listen first.' }], isError: true };
        }

        const parsed = JSON.parse(room_data);
        const kind = currentKind;

        // Pre-flight: validar la forma de las consequences ANTES de reenviar.
        // El ai_server aplica las mismas reglas y devuelve 422, pero ese
        // rechazo no vuelve a esta sesión. Si falla, NO limpiamos la petición
        // pendiente: la sesión corrige la forma y vuelve a llamar a
        // narrative_respond sobre el mismo request_id.
        if (kind === 'narrative_event') {
          const check = validateNarrativeReaction(parsed);
          if (!check.ok) {
            return {
              content: [{ type: 'text', text: `Invalid consequences — fix the shape and call narrative_respond again: ${check.error}` }],
              isError: true,
            };
          }
        }
        if (kind === 'blueprint_review') {
          const check = validateBlueprintReview(parsed);
          if (!check.ok) {
            return {
              content: [{ type: 'text', text: `Invalid blueprint review — fix the shape and call narrative_respond again: ${check.error}` }],
              isError: true,
            };
          }
        }
        // Pre-flight de jugabilidad para escenas: el bridge valida con
        // flood-fill (muros cerrados con puerta alcanzable, spawn walkable,
        // borde de mapa alcanzable, place enlazado en el world map). Si falla,
        // NO limpiamos la petición pendiente: corrige la escena (o llama a
        // map_upsert_place/map_link) y vuelve a llamar a narrative_respond.
        // Bridge caído → se avisa y se deja pasar (el flujo de generación no
        // depende del state API).
        if (kind === 'scene') {
          const check = await bridgePost('/scene/validate', { scene: parsed });
          if (check.ok) {
            const v = check.data as { ok: boolean; errors: string[]; warnings: string[] };
            if (!v.ok) {
              const lines = [
                'Unplayable scene — fix these and call narrative_respond again (the request is still pending):',
                ...v.errors.map((e) => `- ${e}`),
              ];
              if (v.warnings?.length) lines.push('Warnings:', ...v.warnings.map((w) => `- ${w}`));
              return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
            }
            if (v.warnings?.length) {
              console.error(`[narrative-mcp] scene warnings: ${v.warnings.join(' | ')}`);
            }
          } else {
            console.error(`[narrative-mcp] scene pre-flight skipped (state API unreachable): ${check.error}`);
          }
        }

        const reqId = currentRequestId;
        currentRequestId = null;
        currentKind = 'room';

        if (kind === 'weapon_orient' || kind === 'weapon_verify') {
          bridge.sendVisionResponse(reqId, parsed);
          return { content: [{ type: 'text', text: `Vision response sent for request ${reqId}` }] };
        }

        if (kind === 'narrative_event') {
          bridge.sendNarrativeEventResponse(reqId, parsed);
          return { content: [{ type: 'text', text: `Narrative event response sent for request ${reqId}` }] };
        }

        if (kind === 'blueprint_review') {
          bridge.sendBlueprintReviewResponse(reqId, parsed);
          return { content: [{ type: 'text', text: `Blueprint review sent for request ${reqId}` }] };
        }

        bridge.sendResponse(reqId, parsed);
        return { content: [{ type: 'text', text: `Room sent for request ${reqId}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  // ── State tools ──────────────────────────────────────────────────────────
  // These talk to the bridge's HTTP State API, NOT through narrative_listen/
  // respond. Call them any time — during a narrative_event, while generating a
  // scene, or standalone — to query or mutate the authoritative game state
  // (world map, entities, inventories) without needing the whole world dumped
  // into your context.

  function reportBridge(result: BridgeResult) {
    const text = JSON.stringify(result.ok ? result.data : { error: result.error, data: result.data }, null, 2);
    return { content: [{ type: 'text' as const, text }], isError: !result.ok };
  }

  server.tool(
    'scene_validate',
    `Dry-run the playability validator on a Format D scene JSON BEFORE calling ` +
    `narrative_respond. Runs the same server-side checks as the respond ` +
    `pre-flight: expandable primitives, declared terrain chars, walkable player ` +
    `spawn, flood-fill reachability (doors, map edge, NPCs), and the world-map ` +
    `exterior link for place_id. Returns { ok, errors, warnings, stats }.`,
    {
      scene_json: z.string().describe('The Format D scene JSON string to validate.'),
    },
    async ({ scene_json }) => {
      let scene: unknown;
      try {
        scene = JSON.parse(scene_json);
      } catch {
        return { content: [{ type: 'text', text: 'scene_json is not valid JSON' }], isError: true };
      }
      return reportBridge(await bridgePost('/scene/validate', { scene }));
    },
  );

  server.tool(
    'map_get',
    `Read the world map. Without place_id: returns the full WorldMap (places, ` +
    `links, root_id, active_place_id). With place_id: returns that place plus ` +
    `its children, ancestors and outgoing links. Use this to learn where things ` +
    `are before reasoning about travel, NPC movement, or what a place contains.`,
    {
      place_id: z.string().optional().describe('Optional place id to zoom into. Omit for the whole map.'),
    },
    async ({ place_id }) => {
      const path = place_id ? `/map/place/${encodeURIComponent(place_id)}` : '/map';
      return reportBridge(await bridgeGet(path));
    },
  );

  server.tool(
    'map_upsert_place',
    `Create or update a place in the world map. Places form a containment tree ` +
    `(parent_id) across 3 levels: world > region > settlement|landmark > site > ` +
    `interior. Use this to add places the story mentions (a port, ruins, a ` +
    `castle) before the player ever goes there. Updating an existing id ` +
    `preserves fields you don't pass.`,
    {
      id: z.string().describe('Stable slug, e.g. "puerto_bajo".'),
      kind: z.enum(['world', 'region', 'settlement', 'landmark', 'site', 'interior']),
      parent_id: z.string().nullable().describe('Containing place id, or null only for the root world.'),
      name: z.string().describe('Display name shown to the player.'),
      description: z.string().optional().describe('Narrative description for reasoning.'),
      approx_position: z.array(z.number()).optional().describe('[x, y] in the parent local 2D space (layout only, no fixed scale).'),
      approx_radius: z.number().optional().describe('Approximate size, layout only.'),
      attrs_json: z.string().optional().describe('JSON object of free attributes, e.g. {"population":300,"faction":"neutral"}.'),
    },
    async ({ id, kind, parent_id, name, description, approx_position, approx_radius, attrs_json }) => {
      let attrs: Record<string, unknown> | undefined;
      if (attrs_json) {
        try {
          attrs = JSON.parse(attrs_json);
        } catch {
          return { content: [{ type: 'text', text: 'attrs_json is not valid JSON' }], isError: true };
        }
      }
      return reportBridge(await bridgePost('/map/place', {
        id, kind, parent_id, name, description, approx_position, approx_radius, attrs,
      }));
    },
  );

  server.tool(
    'map_link',
    `Create or update a lateral connection between two places (a road, river, ` +
    `path, sea route, passage, tunnel or door). Links cross the containment ` +
    `tree freely. Re-linking the same pair updates the existing link.`,
    {
      from: z.string(),
      to: z.string(),
      kind: z.enum(['road', 'river', 'path', 'sea_route', 'passage', 'tunnel', 'door']),
      travel_hours: z.number().optional().describe('Approximate travel time on foot.'),
      description: z.string().optional(),
      bidirectional: z.boolean().optional().describe('Default true.'),
      edge: z.enum(['north', 'south', 'east', 'west']).optional().describe(
        "Side of the FROM place's scene where this exit sits (north = top of " +
        'the grid, row 0). Walking off that scene edge follows this link; the ' +
        'reverse direction automatically uses the opposite edge. Set it ' +
        'whenever the two places are spatially adjacent.'),
    },
    async (args) => reportBridge(await bridgePost('/map/link', args)),
  );

  server.tool(
    'map_add_trigger',
    `Attach a narrative trigger to a place. When the player satisfies the ` +
    `condition (enters / leaves / gets near / first visit), the bridge fires ` +
    `the trigger's consequences. Re-using a trigger_id replaces it.`,
    {
      place_id: z.string(),
      trigger_id: z.string().describe('Unique within the place.'),
      when_type: z.enum(['player_entered', 'player_left', 'player_near', 'first_visit']),
      when_radius: z.number().optional().describe('Required only for when_type "player_near".'),
      consequences_json: z.string().describe('JSON array of consequences, same shape as narrative_event consequences (dialogue / story_update / spawn_entity / schedule_event / plugin_event).'),
    },
    async ({ place_id, trigger_id, when_type, when_radius, consequences_json }) => {
      let consequences: unknown;
      try {
        consequences = JSON.parse(consequences_json);
      } catch {
        return { content: [{ type: 'text', text: 'consequences_json is not valid JSON' }], isError: true };
      }
      if (!Array.isArray(consequences)) {
        return { content: [{ type: 'text', text: 'consequences_json must be a JSON array' }], isError: true };
      }
      const when =
        when_type === 'player_near'
          ? { type: 'player_near', radius: when_radius ?? 5 }
          : { type: when_type };
      return reportBridge(await bridgePost('/map/trigger', {
        place_id,
        trigger: { id: trigger_id, when, consequences },
      }));
    },
  );

  server.tool(
    'plugin_list',
    `List the declarative plugins active in the current session: id, name, ` +
    `version, description, events_consumed (types you can target with a ` +
    `plugin_event consequence), events_produced and derived_views (names you ` +
    `can pass to plugin_inspect for detail). Check this before emitting ` +
    `plugin_event or registering a new plugin with plugin_register. Note: a ` +
    `compact summary of each plugin (its derived_views) is already injected in ` +
    `your narrative context — use plugin_inspect only for deeper detail.`,
    {},
    async () => reportBridge(await bridgeGet('/plugins')),
  );

  server.tool(
    'plugin_register',
    `Register and activate a declarative plugin for this session. A plugin is ` +
    `a pure-JSON manifest the game engine interprets: it owns a state slice, ` +
    `consumes events (when-predicate → effects) and can read/write declared ` +
    `external paths. Use it when the story repeatedly needs a SYSTEM the core ` +
    `engine doesn't model (commerce, reputation, crafting, ...) instead of ` +
    `hand-narrating its bookkeeping. The manifest is validated (zod shape, ` +
    `static path/permission analysis) and EVERY fixture is replayed before ` +
    `activation — at least one fixture {before, event, after} is required; if ` +
    `anything fails the registration is rejected with the reason. On success ` +
    `the plugin survives save/load (manifest persisted in the session) and you ` +
    `can drive it with {"type": "plugin_event", "plugin_id", "event_type", ` +
    `"payload"} consequences. Required manifest fields: version (int ≥ 1), ` +
    `name, description, origin {author: "narrative_engine", rationale}, slice ` +
    `{schema, initial}, plus reads/writes/events_consumed/events_produced/` +
    `projections/derived_views/fixtures as needed. Writes outside your slice ` +
    `must be declared in "writes" and only player.gold|health|level|inventory ` +
    `and entities[i].data.* are accepted. In DSL strings, a bare string whose ` +
    `root is one of event/slice/world/player/entities/plugins/_/entity/acc is ` +
    `a PATH; anything else is a literal ('single quotes' or {"$lit": ...} ` +
    `force literals).`,
    {
      manifest_json: z.string().describe('The full PluginManifest as a JSON string. Omit "id" — the engine computes it (sha256 of the canonical manifest).'),
    },
    async ({ manifest_json }) => {
      let manifest: unknown;
      try {
        manifest = JSON.parse(manifest_json);
      } catch {
        return { content: [{ type: 'text', text: 'manifest_json is not valid JSON' }], isError: true };
      }
      return reportBridge(await bridgePost('/plugins/register', { manifest }));
    },
  );

  server.tool(
    'plugin_inspect',
    `Inspect an active plugin in detail. The narrative context (serializeForLlm) ` +
    `already carries a compact summary of every active plugin via its ` +
    `derived_views — use THIS tool only when you need more than that summary. ` +
    `Call with a 'view' (one of the plugin's derived_views) to get that view's ` +
    `full evaluated value; call without 'view' to get the plugin's complete raw ` +
    `state slice plus the list of available views. Use plugin_list first to get ` +
    `the plugin_id and the names of its derived_views.`,
    {
      plugin_id: z.string().describe('The id of an active plugin (from plugin_list).'),
      view: z.string().optional().describe('Optional derived_view name; omit to get the full slice.'),
    },
    async ({ plugin_id, view }) => {
      const qs = view ? `?view=${encodeURIComponent(view)}` : '';
      return reportBridge(await bridgeGet(`/plugins/${encodeURIComponent(plugin_id)}/inspect${qs}`));
    },
  );

  server.tool(
    'entity_get',
    `Read one entity's authoritative record: type, scene, position and its ` +
    `data blob (health, state, inventory, etc.). Pass "player" to read the ` +
    `player's state instead. Use this to keep the story consistent — e.g. ` +
    `before referencing where an NPC is or how hurt they are.`,
    {
      entity_id: z.string().describe('Entity id, or "player".'),
    },
    async ({ entity_id }) => reportBridge(await bridgeGet(`/entity/${encodeURIComponent(entity_id)}`)),
  );

  server.tool(
    'inventory_get',
    `Read an entity's inventory array. Pass "player" for the player's ` +
    `inventory. Returns [] for an entity with no inventory.`,
    {
      entity_id: z.string().describe('Entity id, or "player".'),
    },
    async ({ entity_id }) =>
      reportBridge(await bridgeGet(`/entity/${encodeURIComponent(entity_id)}/inventory`)),
  );

  server.tool(
    'inventory_add',
    `Append an item to an entity's inventory. Use this to materialize quest ` +
    `items the story needs — e.g. place a key in an NPC's pocket so the player ` +
    `can later get it. Pass "player" to give the item directly to the player.`,
    {
      entity_id: z.string().describe('Entity id, or "player".'),
      item_json: z.string().describe('JSON describing the item, e.g. {"id":"iron_key","name":"Llave de hierro","description":"..."}.'),
    },
    async ({ entity_id, item_json }) => {
      let item: unknown;
      try {
        item = JSON.parse(item_json);
      } catch {
        return { content: [{ type: 'text', text: 'item_json is not valid JSON' }], isError: true };
      }
      return reportBridge(await bridgePost(`/entity/${encodeURIComponent(entity_id)}/inventory`, { item }));
    },
  );

  server.tool(
    'npc_move_to_place',
    `Command an NPC to travel to a world-map place. The NPC is marked in_transit ` +
    `immediately; it does NOT arrive on its own. Declare its arrival later with ` +
    `npc_arrive when the story is ready for it (travel is narrative-paced, there ` +
    `is no game clock). Use this to keep NPCs moving with the story — e.g. send a ` +
    `messenger to the port, march a patrol toward the ruins.`,
    {
      npc_id: z.string().describe('Entity id of the NPC.'),
      place_id: z.string().describe('Destination world-map place id.'),
    },
    async ({ npc_id, place_id }) =>
      reportBridge(await bridgePost(`/npc/${encodeURIComponent(npc_id)}/move_to_place`, { place_id })),
  );

  server.tool(
    'npc_arrive',
    `Declare that an in-transit NPC has reached its destination: its ` +
    `current_place_id becomes the transit target and in_transit clears. Call ` +
    `this when the story reaches the moment the NPC should be there.`,
    {
      npc_id: z.string().describe('Entity id of an NPC currently in_transit.'),
    },
    async ({ npc_id }) =>
      reportBridge(await bridgePost(`/npc/${encodeURIComponent(npc_id)}/arrive`, {})),
  );

  server.tool(
    'npc_set_directive',
    `Set or clear a standing high-level order on an NPC (e.g. patrol a zone, ` +
    `defend a place, attack on sight). The directive is stored on the NPC; it ` +
    `records intent — pass clear=true to remove it.`,
    {
      npc_id: z.string(),
      type: z.string().optional().describe('Directive verb, e.g. "patrol", "defend", "attack". Required unless clear=true.'),
      target_place_id: z.string().optional().describe('Place the directive applies to, if any.'),
      params_json: z.string().optional().describe('Optional JSON object of extra directive params.'),
      clear: z.boolean().optional().describe('Pass true to remove the NPC\'s directive.'),
    },
    async ({ npc_id, type, target_place_id, params_json, clear }) => {
      if (clear) {
        return reportBridge(await bridgePost(`/npc/${encodeURIComponent(npc_id)}/directive`, { directive: null }));
      }
      if (!type) {
        return { content: [{ type: 'text', text: 'type is required unless clear=true' }], isError: true };
      }
      let params: Record<string, unknown> = {};
      if (params_json) {
        try {
          params = JSON.parse(params_json);
        } catch {
          return { content: [{ type: 'text', text: 'params_json is not valid JSON' }], isError: true };
        }
      }
      const directive = { type, target_place_id, ...params };
      return reportBridge(await bridgePost(`/npc/${encodeURIComponent(npc_id)}/directive`, { directive }));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[narrative-mcp] MCP server running on stdio');
}

main().catch((e) => {
  console.error('[narrative-mcp] Fatal:', e);
  process.exit(1);
});
