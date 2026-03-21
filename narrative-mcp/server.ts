import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WsBridge } from './ws-bridge.js';

async function main() {
  const bridge = await WsBridge.create();

  const server = new McpServer({
    name: 'narrative',
    version: '1.0.0',
  });

  // Stored request_id from the last listen call, so respond knows where to send
  let currentRequestId: string | null = null;

  server.tool(
    'narrative_listen',
    `Block until the Python AI server sends a room generation request.
Returns the world state JSON that needs a room response.

Usage: call narrative_listen in a loop. When it returns, generate a complete 3D room
based on the world state, then call narrative_respond with the room JSON.

IMPORTANT - You are the narrative engine for a Godot 4 dark fantasy RPG.
All units in METERS. Room centered at origin, floor at y=0.

When you receive a world state with entry_wall, generate this JSON structure:
{
  "room_id": "unique_id",
  "room_description": "2-3 sentences in Spanish",
  "dimensions": { "width": 8-15, "height": 3-5, "depth": 8-15 },
  "surfaces": {
    "floor": { "texture_prompt": "English SD prompt, seamless tiling", "tiling": [2,2] },
    "ceiling": { "texture_prompt": "...", "tiling": [2,2] },
    "walls": [
      { "side": "north", "texture_prompt": "...", "tiling": [2,1] },
      { "side": "east", ... }, { "side": "south", ... }, { "side": "west", ... }
    ]
  },
  "exits": [
    { "wall": "south", "offset": 0, "size": [2,3], "description": "...", "target_hint": "..." }
  ],
  "lighting": {
    "ambient": { "color": [0.05,0.03,0.02], "intensity": 0.3 },
    "lights": [{ "type": "point", "position": [0,3,0], "color": [1,0.7,0.3], "intensity": 2, "range": 8 }]
  },
  "objects": [
    { "id": "obj_01", "mesh": "box|sphere|cylinder|capsule|cone", "generate_3d": false,
      "texture_prompt": "English prompt", "position": [x,0,z], "rotation": [0,0,0],
      "scale": [width,height,depth], "description": "Spanish", "category": "prop|item|building|terrain",
      "state": "intact", "mood": "neutral", "interactive": false }
  ],
  "npcs": [
    { "id": "npc_01", "name": "Name", "sprite_prompt": "English prompt for sprite",
      "position": [x,0,z], "description": "Spanish", "dialogue_hint": "what they know" }
  ],
  "ambient_event": "atmospheric text in Spanish"
}

RULES:
- MUST include an exit on entry_wall (from world state) leading back.
- Objects position.y=0 = floor. scale = actual size in meters.
- Place objects inside room bounds with 0.5m wall clearance.
- Descriptions in Spanish, prompts in English.`,
    {},
    async () => {
      try {
        const msg = await bridge.waitForRequest();
        currentRequestId = msg.request_id;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(msg.world_state, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
    },
  );

  server.tool(
    'narrative_respond',
    'Send the generated room data back to the Python AI server. Must be called after narrative_listen.',
    {
      room_data: z.string().describe('JSON string with the room data: { room_id, room_description, dimensions, surfaces, exits, lighting, objects, npcs, ambient_event }'),
    },
    async ({ room_data }) => {
      try {
        if (!currentRequestId) {
          return { content: [{ type: 'text', text: 'No pending request. Call narrative_listen first.' }], isError: true };
        }

        const parsed = JSON.parse(room_data);
        bridge.sendResponse(currentRequestId, parsed);
        const reqId = currentRequestId;
        currentRequestId = null;

        return { content: [{ type: 'text', text: `Room sent for request ${reqId}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      }
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
