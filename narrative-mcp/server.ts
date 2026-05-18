import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WsBridge } from './ws-bridge.js';
import { bridgeGet, bridgePost, type BridgeResult } from './bridge-http-client.js';

async function main() {
  const bridge = await WsBridge.create();

  const server = new McpServer({
    name: 'narrative',
    version: '1.0.0',
  });

  // Stored request_id and kind from the last listen call, so respond knows where to send
  let currentRequestId: string | null = null;
  let currentKind: 'room' | 'scene' | 'weapon_orient' | 'weapon_verify' | 'narrative_event' = 'room';

  server.tool(
    'narrative_listen',
    `Block until the Python AI server sends a generation request.

The returned content has a "kind" field indicating the request type:

==== kind: "scene" ====
You generate TOP-DOWN 2D MAPS as a structured grid plus a list of named
entities. The game renders them; the narrative engine uses them to know where
everything is. Output schema is "Map Format D":

{
  "scene_id": "<slug>",
  "scene_description": "<2-3 Spanish sentences>",
  "size":  { "cols": <int>, "rows": <int>, "meters_per_cell": 2 },
  "terrain": [
    "<string of EXACTLY cols chars>",
    ...   // EXACTLY rows strings total
  ],
  "terrain_legend": { "<char>": "<terrain name>", ... },
  "entities": [
    { "id": "<unique slug>", "kind": "building"|"prop"|"item"|"tree"|"npc"|"player",
      "name": "<spanish>", "cell": [col, row], "footprint": [w, h], "glyph": "<1 ASCII char>" },
    ...
  ],
  "ambient_event": "<one Spanish atmospheric line>"
}

COORDINATES: top-left is (0,0). col → east, row → south. meters_per_cell is
always 2 (so 30×20 cells = 60m × 40m).

GRID SIZES (pick what fits the scene)
- small clearing/cabin: 16×10 to 24×16
- village / square:     32×24 to 48×30
- big town:             48×30 to 60×40
- never larger than     80×60

RESERVED TERRAIN CHARS (you can use without declaring in legend)
- g grass (default)   _ path/dirt road    s stone/paved
- w water             b bridge (wood over water)
- d dirt/tilled       a sand              o wood/dock planks

Any other char you use MUST be declared in terrain_legend.

ENTITY RULES
- Every entity has a UNIQUE id (slug). Two trees in different places need
  different ids ("tree_n1", "tree_w2") even if they share name ("roble").
- cell is the TOP-LEFT of the footprint. cell + footprint must stay inside the grid.
- Buildings: ONE rectangular footprint each (a tavern is one rectangle of 6×4
  to 8×6 cells, NOT four wall slabs).
- Props are usually 1×1. Carts/log piles can be 2×1.
- NPCs and player are always 1×1.
- Place NPCs at their workspot (smith near smithy, innkeeper at inn's door).
- Player starts where the narrative says they enter the scene.

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

==== kind: "room" (legacy — only when format != "scene") ====
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
RULES: exit on entry_wall, objects.y=0 floor, descriptions in Spanish, prompts in English.

==== kind: "weapon_orient" ====
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
}

==== kind: "weapon_verify" ====
You see one image of a character holding a weapon. Verify the weapon is
correctly placed in the hand for combat stance. Respond:
{ "ok": bool, "issue": "string", "suggested_delta_euler": [rx, ry, rz] }

==== kind: "narrative_event" ====
A player has just answered an NPC. You receive: speaker, chosen_text,
free_text, and a context snapshot of the NarrativeState (story_so_far,
recent_dialogues, entities already in the world, current scene id,
available_assets).

CRITICAL — when free_text is non-empty:
- The scripted scenario is PAUSED waiting for you. You MUST respond with at
  least one \`dialogue\` consequence so a visible NPC reacts in-world and the
  player sees something happen. Stay in character for the setting.
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

Respond with narrative_respond, passing this JSON:
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
      "trigger": "next_scene|timer:60s|on_player_action:..." }
  ]
}
Max 4 consequences. Reuse available_assets by hash when sensible.

STRICT SHAPE — the validator REJECTS aliases:
- type MUST be exactly one of "dialogue" | "story_update" | "spawn_entity"
  | "schedule_event" | "noop". "show_dialogue" is NOT valid.
- story_update REQUIRES a non-empty "delta" field. Do not use "text" or
  "summary" — they will be rejected.
- dialogue REQUIRES non-empty "speaker" and "text". spawn_entity REQUIRES
  "entity_kind" (npc/building/object) and "description". schedule_event
  REQUIRES "description".
If you produce an alias, ai_server returns HTTP 422 to the bridge and the
client surfaces the error in its log. Fix the response shape, not the
validator.`,
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

          // deno-lint-ignore no-explicit-any
          const content: any[] = [
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
            text: 'Examine the views and call narrative_respond with the JSON described in the tool docs.',
          });
          return { content };
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
              text: `Narrative event:\n${payload}\n\nDecide consequences and call narrative_respond with the JSON described in the tool docs (kind: narrative_event).`,
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
            text: JSON.stringify({ kind: kindLabel, world_state: msg.world_state }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'narrative_respond',
    'Send the response back to the Python AI server. Must be called after narrative_listen. ' +
    'The room_data field accepts a JSON string with the room data OR the vision result, ' +
    'depending on the kind of the most recent listen request.',
    {
      room_data: z.string().describe('JSON string. For kind=room: full room data. For kind=weapon_orient: { grip_point_normalized, blade_direction, up_direction, weapon_type, confidence, ... }'),
    },
    async ({ room_data }) => {
      try {
        if (!currentRequestId) {
          return { content: [{ type: 'text', text: 'No pending request. Call narrative_listen first.' }], isError: true };
        }

        const parsed = JSON.parse(room_data);
        const reqId = currentRequestId;
        const kind = currentKind;
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
      consequences_json: z.string().describe('JSON array of consequences, same shape as narrative_event consequences (dialogue / story_update / spawn_entity / schedule_event).'),
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
