/** HTTP state API — lets the narrative engine (Claude, via narrative-mcp tools)
 * query and mutate the authoritative NarrativeState without dumping the whole
 * world into the LLM context.
 *
 * The bridge owns NarrativeState; this server exposes a thin request/response
 * surface over it. It runs alongside the WebSocket server in ws-server.ts.
 *
 * Two cycles, as designed with the user:
 *  - generation cycle: bridge → ai_server → narrative-mcp → Claude (unchanged)
 *  - state cycle:      Claude → narrative-mcp → THIS server (new)
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";

import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { PlaceUpsert, LinkSpec } from "../src/world-map/world-map.js";
import type { PlaceTriggerSpec } from "../src/world-map/types.js";
import type { NpcDirector, NpcDirective } from "../src/world-map/npc-director.js";

export interface StateHttpServerOptions {
  port: number;
  narrative: NarrativeState;
  npcDirector: NpcDirector;
  /** Called after any mutation so the bridge can persist the session. */
  onMutation: () => void | Promise<void>;
  /** Hooks de plugins (F5) — viven en ws-server porque el registry activo del
   *  dispatcher (`activePlugins`) es estado del bridge. */
  plugins: {
    /** Valida y activa un manifest runtime. Lanza PluginRegisterError con el
     *  motivo si es inválido. */
    register: (raw: unknown) => { id: string; name: string; version: number; fixturesPassed: number };
    /** Plugins activos de la sesión, resumidos para el motor narrativo. */
    list: () => Array<Record<string, unknown>>;
  };
}

interface RouteResult {
  status: number;
  body: unknown;
  mutated?: boolean;
}

const MAX_BODY_BYTES = 256 * 1024;

export function createStateHttpServer(opts: StateHttpServerOptions): Server {
  const { narrative, npcDirector, onMutation } = opts;

  const server = createServer((req, res) => {
    handle(req, res, narrative, npcDirector, opts.plugins)
      .then(async (result) => {
        if (result.mutated) {
          try {
            await onMutation();
          } catch (err) {
            console.warn("StateHttpServer: onMutation failed:", err);
          }
        }
        sendJson(res, result.status, result.body);
      })
      .catch((err) => {
        sendJson(res, 500, { ok: false, error: String((err as Error)?.message ?? err) });
      });
  });

  server.listen(opts.port, "127.0.0.1", () => {
    console.log(`NEFan State HTTP API listening on http://127.0.0.1:${opts.port}`);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  _res: ServerResponse,
  narrative: NarrativeState,
  npcDirector: NpcDirector,
  plugins: StateHttpServerOptions["plugins"],
): Promise<RouteResult> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const parts = path.split("/").filter(Boolean); // e.g. ["entity", "boris", "inventory"]
  const wm = narrative.worldMap;

  // ── Plugins (F5) ──
  if (method === "GET" && path === "/plugins") {
    return ok({ plugins: plugins.list() });
  }

  if (method === "POST" && path === "/plugins/register") {
    const body = (await readJson(req)) as { manifest?: unknown };
    if (!body || body.manifest === undefined) {
      return bad("body requires { manifest: <PluginManifest> }");
    }
    try {
      const result = plugins.register(body.manifest);
      return mutated({ ok: true, ...result });
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  // ── Health ──
  if (method === "GET" && path === "/health") {
    return ok({
      ok: true,
      session_id: narrative.session_id,
      has_session: Boolean(narrative.session_id),
      game_id: narrative.game_id,
    });
  }

  // ── Map ──
  if (method === "GET" && path === "/map") {
    return ok(wm.serialize());
  }

  if (method === "GET" && parts[0] === "map" && parts[1] === "place" && parts[2]) {
    const place = wm.get(parts[2]);
    if (!place) return notFound(`place "${parts[2]}" not found`);
    return ok({
      place,
      children: wm.getChildren(place.id),
      ancestors: wm.getAncestors(place.id).slice(1), // drop self
      outgoing_links: wm.getOutgoingLinks(place.id),
      npcs: npcDirector.getNpcsAtPlace(place.id),
    });
  }

  if (method === "POST" && path === "/map/place") {
    const body = (await readJson(req)) as PlaceUpsert;
    if (!body || typeof body.id !== "string" || typeof body.kind !== "string") {
      return bad("body requires at least { id, kind, parent_id, name }");
    }
    try {
      const place = wm.upsertPlace(body);
      narrative.markDirty();
      return mutated({ ok: true, place });
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (method === "POST" && path === "/map/link") {
    const body = (await readJson(req)) as LinkSpec;
    if (!body || typeof body.from !== "string" || typeof body.to !== "string") {
      return bad("body requires { from, to, kind }");
    }
    try {
      const link = wm.addLink(body);
      narrative.markDirty();
      return mutated({ ok: true, link });
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (method === "POST" && path === "/map/trigger") {
    const body = (await readJson(req)) as { place_id?: string; trigger?: PlaceTriggerSpec };
    const placeId = body?.place_id;
    const trigger = body?.trigger;
    if (typeof placeId !== "string" || !trigger || typeof trigger.id !== "string" || !trigger.when) {
      return bad("body requires { place_id, trigger: { id, when, consequences } }");
    }
    if (!Array.isArray(trigger.consequences)) trigger.consequences = [];
    try {
      wm.addTrigger(placeId, trigger);
      narrative.markDirty();
      return mutated({ ok: true, place_id: placeId, trigger_id: trigger.id });
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  // ── Entities ──
  if (method === "GET" && path === "/entities") {
    return ok({
      entities: narrative.entities.map((e) => ({
        id: e.id,
        type: e.type,
        scene_id: e.scene_id,
        position: e.position,
        spawn_reason: e.spawn_reason,
      })),
    });
  }

  if (method === "GET" && parts[0] === "entity" && parts[1] && parts.length === 2) {
    if (parts[1] === "player") {
      return ok({ id: "player", type: "player", player: narrative.player });
    }
    const entity = narrative.getEntity(parts[1]);
    if (!entity) return notFound(`entity "${parts[1]}" not found`);
    return ok(entity);
  }

  if (
    method === "GET" &&
    parts[0] === "entity" &&
    parts[1] &&
    parts[2] === "inventory" &&
    parts.length === 3
  ) {
    return ok({ entity_id: parts[1], inventory: narrative.getInventory(parts[1]) });
  }

  if (
    method === "POST" &&
    parts[0] === "entity" &&
    parts[1] &&
    parts[2] === "inventory" &&
    parts.length === 3
  ) {
    const body = (await readJson(req)) as { item?: unknown };
    if (!body || body.item === undefined) {
      return bad("body requires { item }");
    }
    const added = narrative.addInventoryItem(parts[1], body.item);
    if (!added) return notFound(`entity "${parts[1]}" not found`);
    return mutated({
      ok: true,
      entity_id: parts[1],
      inventory: narrative.getInventory(parts[1]),
    });
  }

  // ── NPC high-level movement ──
  if (method === "GET" && path === "/npcs/in_transit") {
    return ok({ npcs: npcDirector.getNpcsInTransit() });
  }

  if (method === "GET" && parts[0] === "npc" && parts[1] && parts.length === 2) {
    const info = npcDirector.getNpcPlace(parts[1]);
    if (!info) return notFound(`npc "${parts[1]}" not found`);
    return ok(info);
  }

  if (
    method === "POST" &&
    parts[0] === "npc" &&
    parts[1] &&
    parts[2] === "move_to_place" &&
    parts.length === 3
  ) {
    const body = (await readJson(req)) as { place_id?: string };
    if (!body || typeof body.place_id !== "string") {
      return bad("body requires { place_id }");
    }
    const result = npcDirector.moveNpcToPlace(parts[1], body.place_id);
    if (!result.ok) return bad(result.error ?? "move failed");
    return mutated(result);
  }

  if (
    method === "POST" &&
    parts[0] === "npc" &&
    parts[1] &&
    parts[2] === "arrive" &&
    parts.length === 3
  ) {
    const result = npcDirector.arriveNpc(parts[1]);
    if (!result.ok) return bad(result.error ?? "arrive failed");
    return mutated(result);
  }

  if (
    method === "POST" &&
    parts[0] === "npc" &&
    parts[1] &&
    parts[2] === "directive" &&
    parts.length === 3
  ) {
    const body = (await readJson(req)) as { directive?: NpcDirective | null };
    if (!body || !("directive" in body)) {
      return bad("body requires { directive } (pass null to clear)");
    }
    const directive = body.directive ?? null;
    if (directive !== null && (typeof directive !== "object" || typeof directive.type !== "string")) {
      return bad("directive must be null or an object with a string `type`");
    }
    const result = npcDirector.setDirective(parts[1], directive);
    if (!result.ok) return bad(result.error ?? "set directive failed");
    return mutated(result);
  }

  return { status: 404, body: { ok: false, error: `no route for ${method} ${path}` } };
}

// ── Helpers ──

function ok(body: unknown): RouteResult {
  return { status: 200, body };
}

function mutated(body: unknown): RouteResult {
  return { status: 200, body, mutated: true };
}

function bad(message: string): RouteResult {
  return { status: 400, body: { ok: false, error: message } };
}

function notFound(message: string): RouteResult {
  return { status: 404, body: { ok: false, error: message } };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
