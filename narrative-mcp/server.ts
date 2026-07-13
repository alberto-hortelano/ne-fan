import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateNarrativeReaction, validateBlueprintReview, validateSceneClassify } from './validators.js';
import { WsBridge } from './ws-bridge.js';
import { bridgeGet, bridgePost, postProgress, setActivityHook, type BridgeResult } from './bridge-http-client.js';

// ── Per-kind response instructions ───────────────────────────────────────────
// Single source of truth for "how to answer each request kind". These are
// emitted INSIDE the narrative_listen return payload (adjacent to each request)
// so the schema is always in context when the engine decides its response —
// instead of living only in the (long, truncatable) narrative_listen tool
// description. Keep wording in sync with ai_server/narrative_schemas.py.


// ── Prompts del contrato narrativo ─────────────────────────────────────────
// El texto canónico de las instrucciones vive en
// nefan-core/data/contract/prompts/*.md, COMPARTIDO con ai_server (que compone
// sus system prompts desde los mismos archivos). Editar allí, nunca aquí.
function findPromptsDir(): string {
  const override = process.env.NEFAN_CONTRACT_PROMPTS;
  if (override) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'nefan-core', 'data', 'contract', 'prompts');
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }
  throw new Error('nefan-core/data/contract/prompts no encontrado — fija NEFAN_CONTRACT_PROMPTS');
}
const PROMPTS_DIR = findPromptsDir();
const loadPrompt = (file: string): string => readFileSync(resolve(PROMPTS_DIR, file), 'utf-8');

const WORLD_RULES = loadPrompt('world_rules.md');

const TILE_INSTRUCTIONS = loadPrompt('tile_instructions.md');

const SCENE_INSTRUCTIONS = loadPrompt('scene_instructions.md');

const ROOM_INSTRUCTIONS = loadPrompt('room_instructions.md');

const WEAPON_ORIENT_INSTRUCTIONS = loadPrompt('weapon_orient.md');

const WEAPON_VERIFY_INSTRUCTIONS = loadPrompt('weapon_verify.md');

const SCENE_CLASSIFY_INSTRUCTIONS = loadPrompt('scene_classify.md');

const DEVELOP_WORLD_INSTRUCTIONS = loadPrompt('develop_world.md');

const NARRATIVE_EVENT_INSTRUCTIONS = loadPrompt('narrative_event.md');

const BLUEPRINT_REVIEW_INSTRUCTIONS = loadPrompt('blueprint_review.md');

/** Mensajes humanos para el latido de progreso según la ruta del State API
 *  que el motor acaba de llamar. Genérico para rutas nuevas. */
function describeStateCall(method: string, path: string): string {
  if (path.startsWith('/map/place')) return 'construyendo el mapa del mundo (lugar)…';
  if (path.startsWith('/map/link')) return 'construyendo el mapa del mundo (conexión)…';
  if (path.startsWith('/map/trigger')) return 'colocando disparadores del mapa…';
  if (path.startsWith('/map')) return 'consultando el mapa del mundo…';
  if (path === '/world_doc') return 'leyendo el documento del mundo…';
  if (path === '/scene/validate') return 'validando la escena generada…';
  if (path.startsWith('/plugins')) return 'trabajando con los sistemas de juego (plugins)…';
  if (path.startsWith('/npc')) return 'dirigiendo a los personajes…';
  if (path.startsWith('/entity') || path.startsWith('/inventory')) return 'consultando entidades e inventario…';
  return `el motor consulta el estado (${method} ${path})…`;
}

async function main() {
  const bridge = await WsBridge.create();

  const server = new McpServer({
    name: 'narrative',
    version: '1.0.0',
  });

  // Stored request_id and kind from the last listen call, so respond knows where to send
  let currentRequestId: string | null = null;
  let currentKind: 'room' | 'scene' | 'weapon_orient' | 'weapon_verify' | 'scene_classify' | 'narrative_event' | 'develop_world' | 'blueprint_review' = 'room';
  // Índices de región de la última petición scene_classify (para el pre-flight
  // de completitud de la respuesta).
  let currentClassifyIndices: number[] | null = null;

  // ── Latido de progreso ──────────────────────────────────────────────────
  // Cada paso observable del motor (recoger la petición, llamar una tool de
  // estado) se reporta por DOS canales: WS a ai_server (resetea su timeout de
  // inactividad — el motor sigue vivo aunque tarde 10 min) y HTTP al State
  // API del bridge (texto del loader del cliente). Best-effort ambos.
  const reportProgress = (message: string): void => {
    if (currentRequestId) bridge.sendProgress(currentRequestId, message);
    postProgress(message);
  };
  setActivityHook((method, path) => reportProgress(describeStateCall(method, path)));

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
- "scene_classify"  → classify segmented regions of a painted scene image
                      (solid / tall per region — the collision map is derived
                      from your answer).
- "develop_world"   → a player-submitted world draft to develop into a full
                      world document (template embedded in the message).
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
- entity_get / inventory_get / inventory_add / inventory_remove — entities & items.
- npc_arrive / npc_move_to_place / npc_set_directive       — NPC placement & behaviour.`,
    {},
    async () => {
      try {
        const msg = await bridge.waitForRequest();
        currentRequestId = msg.request_id;
        reportProgress('el motor narrativo ha recogido la petición y está trabajando…');

        if (msg.type === 'vision_request') {
          currentKind = msg.kind;
          // scene_classify: recordar los índices esperados para exigir una
          // clasificación completa en narrative_respond.
          const regions = (msg.context as { regions?: { index?: number }[] } | undefined)?.regions;
          currentClassifyIndices = msg.kind === 'scene_classify' && Array.isArray(regions)
            ? regions.map((r) => r.index).filter((i): i is number => Number.isInteger(i))
            : null;
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
          const instructions =
            msg.kind === 'weapon_verify' ? WEAPON_VERIFY_INSTRUCTIONS :
            msg.kind === 'scene_classify' ? SCENE_CLASSIFY_INSTRUCTIONS :
            WEAPON_ORIENT_INSTRUCTIONS;
          content.push({
            type: 'text',
            text: `Examine the views, then respond.\n\n${instructions}`,
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

        if (msg.type === 'narrative_event' && msg.kind === 'develop_world') {
          currentKind = 'develop_world';
          const ctx = msg.context as { draft_text?: string; available_styles?: unknown } | undefined;
          const payload = JSON.stringify({
            kind: 'develop_world',
            draft_text: ctx?.draft_text ?? '',
            available_styles: ctx?.available_styles ?? [],
          }, null, 2);
          return {
            content: [{
              type: 'text',
              text: `World draft to develop:\n${payload}\n\n${DEVELOP_WORLD_INSTRUCTIONS}`,
            }],
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
              text: `Narrative event:\n${payload}\n\n${NARRATIVE_EVENT_INSTRUCTIONS}\n\n${WORLD_RULES}`,
            }],
          };
        }

        // room_request — distingue entre open-world ('scene') y legacy ('room')
        // según el campo `format` que envía el ai_server. Dentro de 'scene',
        // una petición con generate_tile usa las instrucciones de TILE
        // (plano continuo) delante de la referencia estándar.
        const format = msg.format ?? 'extended';
        currentKind = format === 'scene' ? 'scene' : 'room';
        const kindLabel = currentKind;
        const isTileRequest = Boolean(
          (msg.world_state as { generate_tile?: unknown } | undefined)?.generate_tile,
        );
        const instructions = kindLabel !== 'scene'
          ? ROOM_INSTRUCTIONS
          : (isTileRequest
            ? TILE_INSTRUCTIONS + '\n\n' + SCENE_INSTRUCTIONS
            : SCENE_INSTRUCTIONS) + '\n\n' + WORLD_RULES;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ kind: kindLabel, world_state: msg.world_state }, null, 2) +
              '\n\n' + instructions,
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
    '  scene_classify → { segments: [{ index, label, solid, tall }] } (every region index)\n' +
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
        if (kind === 'develop_world') {
          const missing = ['game_id', 'title', 'description', 'world_brief', 'world_md']
            .filter((k) => typeof (parsed as Record<string, unknown>)[k] !== 'string' || !(parsed as Record<string, unknown>)[k]);
          const sections = typeof (parsed as { world_md?: string }).world_md === 'string'
            ? ((parsed as { world_md: string }).world_md.match(/^## /gm) ?? []).length
            : 0;
          const errs: string[] = [];
          if (missing.length) errs.push(`missing string fields: ${missing.join(', ')}`);
          if (sections < 10) errs.push(`world_md has ${sections} "## " sections, needs 10`);
          const brief = (parsed as { world_brief?: string }).world_brief ?? '';
          if (brief.length < 400) errs.push(`world_brief too short (${brief.length} chars, aim ~1200)`);
          if (errs.length) {
            return {
              content: [{ type: 'text', text: `Invalid develop_world response — fix and call narrative_respond again: ${errs.join(' · ')}` }],
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
        if (kind === 'scene_classify') {
          const check = validateSceneClassify(parsed, currentClassifyIndices);
          if (!check.ok) {
            return {
              content: [{ type: 'text', text: `Invalid scene classification — fix the shape and call narrative_respond again: ${check.error}` }],
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
        currentClassifyIndices = null;

        if (kind === 'weapon_orient' || kind === 'weapon_verify' || kind === 'scene_classify') {
          bridge.sendVisionResponse(reqId, parsed);
          return { content: [{ type: 'text', text: `Vision response sent for request ${reqId}` }] };
        }

        if (kind === 'narrative_event' || kind === 'develop_world') {
          bridge.sendNarrativeEventResponse(reqId, parsed);
          return { content: [{ type: 'text', text: `${kind} response sent for request ${reqId}` }] };
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
    'world_doc_get',
    `Read the FULL world document (world.md) of the active game: kingdoms, ` +
    `peoples, factions, magic rules, daily life, conflict seeds, NPC speech ` +
    `register. The per-turn context only carries the world brief ` +
    `(world.description) — call this whenever you need detail: naming NPCs, ` +
    `picking factions, checking what magic can or cannot do, matching tone.`,
    {},
    async () => {
      return reportBridge(await bridgeGet('/world_doc'));
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
      anchor: z.object({
        tx: z.number().int(),
        ty: z.number().int(),
        rect: z.array(z.number().int()).length(4).optional(),
      }).optional().describe(
        'Tile of the continuous plane where this place LIVES, optionally ' +
        'bounded to a cell rect [col,row,w,h] inside the tile. The bridge ' +
        'activates the place (and fires its triggers) when the player steps ' +
        'into the anchor.'),
    },
    async ({ id, kind, parent_id, name, description, approx_position, approx_radius, attrs_json, anchor }) => {
      let attrs: Record<string, unknown> | undefined;
      if (attrs_json) {
        try {
          attrs = JSON.parse(attrs_json);
        } catch {
          return { content: [{ type: 'text', text: 'attrs_json is not valid JSON' }], isError: true };
        }
      }
      return reportBridge(await bridgePost('/map/place', {
        id, kind, parent_id, name, description, approx_position, approx_radius, attrs, anchor,
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
    'inventory_remove',
    `Remove one item from an entity's inventory by its "id" field. Use this ` +
    `when the story consumes, hands over or destroys an item — e.g. the player ` +
    `pays with a purse, gives a letter away, an NPC surrenders a key. Pass ` +
    `"player" to take the item from the player. Errors if no item has that id ` +
    `(check with inventory_get first).`,
    {
      entity_id: z.string().describe('Entity id, or "player".'),
      item_id: z.string().describe('The "id" field of the inventory item to remove.'),
    },
    async ({ entity_id, item_id }) =>
      reportBridge(
        await bridgePost(`/entity/${encodeURIComponent(entity_id)}/inventory/remove`, { item_id }),
      ),
  );

  server.tool(
    'npc_move_to_place',
    `Command an NPC to travel to a world-map place. The NPC is marked in_transit ` +
    `immediately. If the destination is anchored nearby (same area of the tile ` +
    `plane), the game engine walks the NPC there physically and declares the ` +
    `arrival itself — you will see it in ambient_events. Otherwise travel is ` +
    `narrative-paced: declare the arrival later with npc_arrive when the story ` +
    `is ready. Use this to keep NPCs moving with the story — e.g. send a ` +
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
    `Set or clear a standing high-level order on an NPC. The game engine ` +
    `EXECUTES these directive types as ambient behaviour: "wander" {radius?}, ` +
    `"patrol" (double-radius wander), "goto_place" {target_place_id}, ` +
    `"visit_npc" {target_npc_id}, "hold". Other verbs are stored as intent but ` +
    `ignored by the engine (the NPC keeps wandering), so prefer that ` +
    `vocabulary. Pass clear=true to remove the directive.`,
    {
      npc_id: z.string(),
      type: z.string().optional().describe('Directive verb: wander | patrol | goto_place | visit_npc | hold. Required unless clear=true.'),
      target_place_id: z.string().optional().describe('Place the directive applies to (goto_place).'),
      target_npc_id: z.string().optional().describe('Entity id of the NPC to visit (visit_npc).'),
      params_json: z.string().optional().describe('Optional JSON object of extra directive params (e.g. {"radius": 10} for wander).'),
      clear: z.boolean().optional().describe('Pass true to remove the NPC\'s directive.'),
    },
    async ({ npc_id, type, target_place_id, target_npc_id, params_json, clear }) => {
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
      const directive = { type, target_place_id, target_npc_id, ...params };
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
