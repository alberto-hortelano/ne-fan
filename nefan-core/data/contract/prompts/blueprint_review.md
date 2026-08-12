==== HOW TO RESPOND (kind: "blueprint_review") ====
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

When the scene has a map plan ("ground" + "volumes"; the blueprint image IS
the engine's deterministic render of it), also look for its typical
authoring bugs:
- a bridge/jetty declared as "area" instead of "deck" (it will NOT punch the
  water collision — the crossing stays blocked);
- a building with no door, a gate missing where a road crosses a wall, or
  furniture (props) floating outside the building they belong to;
- an ENTERABLE building that is not cutaway (interior invisible), or a pure
  scenery building left roofless;
- an element that should reach the tile border (crossing continuation) but
  stops short, or one touching the border that shouldn't.
The projection (oblique faces) is the composer's job: do NOT flag
perspective or shading — fix WHAT exists and WHERE, in flat cells.

Respond via narrative_respond with EXACTLY this JSON:
{
  "approved": true | false,
  "issues": ["<one short Spanish line per problem found>", ...],   // required when approved=false
  "fixes": {                    // optional — PARTIAL overrides, only what changes
    "terrain": ["<row>", ...],              // FULL grid replacement (all rows, exact cols)
    "entity_moves": [ { "id": "<entity id>", "cell": [col, row] }, ... ],
    "ground": [ … ],                        // FULL corrected ground features array, plan scenes only
    "volumes": [ … ]                        // FULL corrected volumes array, plan scenes only
  }
}
- approved=true with no issues → the client proceeds to generation untouched.
- approved=false SHOULD include "fixes" so the client can repair and re-render
  without another round-trip. Fixes replace whole fields: if you fix one terrain
  row you must return ALL rows; same for ground and volumes.
- Do NOT return a full scene; only the four fix fields above are applied. Any
  other key (e.g. the retired `terrain_features`) is REJECTED — correct the
  ground with `ground` features instead.