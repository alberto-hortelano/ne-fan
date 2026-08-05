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
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SAFE_ID, loadWorldDoc } from "../src/games/loader.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SceneRecord } from "../src/narrative/types.js";
import { validateScene, type TileValidationContext } from "../src/scene/scene-validate.js";
import { oppositeEdge, resolveExitEdge } from "../src/world-map/edges.js";
import type { Edge } from "../src/world-map/types.js";
import type { PlaceUpsert, LinkSpec } from "../src/world-map/world-map.js";
import { isEdge } from "../src/world-map/types.js";
import type { NpcDirector, NpcDirective } from "../src/world-map/npc-director.js";
import type { ErrorResponse, PluginInspectResult } from "../src/contracts/common.js";
import { WorldStateApi } from "../src/contracts/world-state.js";
import type { ResponseOf } from "../src/contracts/http.js";
import type {
  MapTriggerRequest,
  PlayerEntityResponse,
  EntityListResponse,
  InventoryGetResponse,
  InventoryMutationResponse,
  PlaceDetailResponse,
  PlaceUpsertResponse,
  MapLinkResponse,
  MapTriggerResponse,
  PluginListResponse,
  PluginRegisterResponse,
  UiDocResponse,
  WorldDocResponse,
  WorldStateHealthResponse,
  NpcsInTransitResponse,
} from "../src/contracts/world-state.js";

export interface StateHttpServerOptions {
  port: number;
  narrative: NarrativeState;
  npcDirector: NpcDirector;
  /** Directorio de style packs (data/styles). Sus archivos se sirven como
   *  estáticos en GET /styles/{style_id}/{file} para la title screen —
   *  funciona sin ai_server (preset 4). */
  stylesDir: string;
  /** Directorio de juegos (data/games) — GET /world_doc lee de ahí el
   *  world.md del juego de la sesión activa (tool MCP world_doc_get). */
  gamesDir: string;
  /** Called after any mutation so the bridge can persist the session. */
  onMutation: () => void | Promise<void>;
  /** Latido de progreso del motor narrativo (POST /narrative_progress desde
   *  narrative-mcp): el bridge lo difunde como narrative_status "progress"
   *  para que el loader del cliente muestre qué está pasando. */
  onProgress: (message: string) => void;
  /** Hooks de plugins (F5) — viven en ws-server porque el registry activo del
   *  dispatcher (`activePlugins`) es estado del bridge. */
  plugins: {
    /** Valida y activa un manifest runtime. Lanza PluginRegisterError con el
     *  motivo si es inválido. */
    register: (raw: unknown) => { id: string; name: string; version: number; fixturesPassed: number };
    /** Plugins activos de la sesión, resumidos para el motor narrativo. */
    list: () => Array<Record<string, unknown>>;
    /** Detalle de un plugin (F6): una derived_view concreta o el slice
     *  completo. Lanza con el motivo si el plugin o la vista no existen. */
    inspect: (id: string, view?: string) => PluginInspectResult;
  };
}

interface RouteResult {
  status: number;
  body: unknown;
  mutated?: boolean;
}

const MAX_BODY_BYTES = 256 * 1024;

/** Documento canónico de sistemas de UI (compartido con el resto de prompts
 *  del contrato) — lo sirve GET /ui_doc para la tool MCP ui_doc_get. */
const UI_SYSTEMS_DOC = fileURLToPath(
  new URL("../data/contract/prompts/ui_systems.md", import.meta.url),
);

export function createStateHttpServer(opts: StateHttpServerOptions): Server {
  const { narrative, npcDirector, onMutation } = opts;

  const server = createServer((req, res) => {
    // Estáticos de estilo (imágenes binarias): rama propia, fuera del ciclo
    // JSON de handle().
    if ((req.method ?? "GET") === "GET" && (req.url ?? "").startsWith("/styles/")) {
      serveStyleFile(req, res, opts.stylesDir);
      return;
    }
    handle(req, res, narrative, npcDirector, opts.plugins, opts.gamesDir, opts.onProgress)
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
  gamesDir: string,
  onProgress: StateHttpServerOptions["onProgress"],
): Promise<RouteResult> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  const parts = path.split("/").filter(Boolean); // e.g. ["entity", "boris", "inventory"]
  const wm = narrative.worldMap;

  // ── Plugins (F5) ──
  if (method === "GET" && path === "/plugins") {
    return ok({ plugins: plugins.list() } satisfies PluginListResponse);
  }

  // Detalle de un plugin (F6): GET /plugins/{id}/inspect?view=<name>
  if (
    method === "GET" &&
    parts[0] === "plugins" &&
    parts[1] &&
    parts[2] === "inspect" &&
    parts.length === 3
  ) {
    try {
      const view = url.searchParams.get("view") ?? undefined;
      return ok(plugins.inspect(parts[1], view) satisfies ResponseOf<typeof WorldStateApi.inspectPlugin>);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (method === "POST" && path === "/plugins/register") {
    const body = (await readJson(req)) as { manifest?: unknown };
    if (!body || body.manifest === undefined) {
      return bad("body requires { manifest: <PluginManifest> }");
    }
    try {
      const result = plugins.register(body.manifest);
      return mutated({ ok: true, ...result } satisfies PluginRegisterResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  // ── Progreso del motor narrativo ──
  // narrative-mcp lo envía en cada paso observable (tool MCP llamada,
  // petición recogida). Sin sesión que mutar: solo difusión al cliente.
  if (method === "POST" && path === "/narrative_progress") {
    const body = (await readJson(req)) as { message?: unknown };
    const message = typeof body?.message === "string" ? body.message.slice(0, 300) : "";
    if (!message) return bad("body requires { message: string }");
    onProgress(message);
    return { status: 200, body: { ok: true } satisfies ResponseOf<typeof WorldStateApi.narrativeProgress> };
  }

  // ── Escenas ──
  // Validación de jugabilidad (pre-flight de narrative_respond y tool
  // scene_validate). No muta nada; el contexto de world map alimenta la regla
  // de contexto exterior (place existente + link saliente).
  if (method === "POST" && path === "/scene/validate") {
    const body = (await readJson(req)) as { scene?: unknown };
    if (!body || typeof body.scene !== "object" || body.scene === null) {
      return bad("body requires { scene: <Format D scene JSON> }");
    }
    const scene = body.scene as Record<string, unknown>;
    // Para tiles, el contexto de costuras lo construye el SERVIDOR desde los
    // edges de los vecinos registrados — el motor no puede olvidarse de
    // pasarlo y el pre-flight de narrative_respond no cambia.
    let tileCtx: TileValidationContext | undefined;
    const rawTile = scene.tile as { tx?: number; ty?: number } | undefined;
    if (rawTile && Number.isInteger(rawTile.tx) && Number.isInteger(rawTile.ty)) {
      const required: TileValidationContext["required_crossings"] = [];
      const neighbors = narrative.neighborsOf(rawTile.tx!, rawTile.ty!);
      for (const [edge, rec] of Object.entries(neighbors) as [Edge, SceneRecord][]) {
        // El borde del vecino que da a NUESTRO tile es el opuesto; el `at` es
        // espejo sin transformación.
        const shared = rec.edges?.[oppositeEdge(edge)];
        for (const c of shared?.crossings ?? []) required.push({ edge, ...c });
      }
      const hasAnyTile = Object.values(narrative.scenes_loaded).some((r) => r.tile);
      tileCtx = { required_crossings: required, bootstrap: !hasAnyTile };
    }
    const result = validateScene(
      scene,
      (placeId) => {
        const place = wm.get(placeId);
        if (!place) return { exists: false, outgoing_links: 0 };
        // links con destino + edge efectivo desde este place: los necesita la
        // regla proscenio (cada link ⇔ una salida física declarada en stage).
        const links = wm.getOutgoingLinks(placeId).map((l) => ({
          to: l.from === placeId ? l.to : l.from,
          edge: resolveExitEdge(wm, placeId, l) ?? undefined,
        }));
        return {
          exists: true,
          kind: place.kind,
          outgoing_links: links.length,
          links,
        };
      },
      tileCtx,
    );
    return ok(result satisfies ResponseOf<typeof WorldStateApi.validateScene>);
  }

  // ── Health ──
  if (method === "GET" && path === "/health") {
    return ok({
      ok: true,
      session_id: narrative.session_id,
      has_session: Boolean(narrative.session_id),
      game_id: narrative.game_id,
    } satisfies WorldStateHealthResponse);
  }

  // ── Map ──
  if (method === "GET" && path === "/map") {
    return ok(wm.serialize() satisfies ResponseOf<typeof WorldStateApi.getMap>);
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
    } satisfies PlaceDetailResponse);
  }

  if (method === "POST" && path === "/map/place") {
    const body = (await readJson(req)) as PlaceUpsert;
    if (!body || typeof body.id !== "string" || typeof body.kind !== "string") {
      return bad("body requires at least { id, kind, parent_id, name }");
    }
    if (body.anchor !== undefined) {
      const a = body.anchor as { tx?: unknown; ty?: unknown };
      if (!a || !Number.isInteger(a.tx) || !Number.isInteger(a.ty)) {
        return bad("anchor requires integer { tx, ty } (optional rect [col,row,w,h])");
      }
    }
    try {
      const place = wm.upsertPlace(body);
      narrative.markDirty();
      return mutated({ ok: true, place } satisfies PlaceUpsertResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (method === "POST" && path === "/map/link") {
    const body = (await readJson(req)) as LinkSpec;
    if (!body || typeof body.from !== "string" || typeof body.to !== "string") {
      return bad("body requires { from, to, kind }");
    }
    if (body.edge !== undefined && !isEdge(body.edge)) {
      return bad(`edge must be one of north|south|east|west, got "${body.edge}"`);
    }
    try {
      const link = wm.addLink(body);
      narrative.markDirty();
      return mutated({ ok: true, link } satisfies MapLinkResponse);
    } catch (err) {
      return bad((err as Error).message);
    }
  }

  if (method === "POST" && path === "/map/trigger") {
    const body = (await readJson(req)) as Partial<MapTriggerRequest>;
    const placeId = body?.place_id;
    const trigger = body?.trigger;
    if (typeof placeId !== "string" || !trigger || typeof trigger.id !== "string" || !trigger.when) {
      return bad("body requires { place_id, trigger: { id, when, consequences } }");
    }
    if (!Array.isArray(trigger.consequences)) trigger.consequences = [];
    try {
      wm.addTrigger(placeId, trigger);
      narrative.markDirty();
      return mutated({ ok: true, place_id: placeId, trigger_id: trigger.id } satisfies MapTriggerResponse);
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
    } satisfies EntityListResponse);
  }

  if (method === "GET" && parts[0] === "entity" && parts[1] && parts.length === 2) {
    if (parts[1] === "player") {
      return ok({ id: "player", type: "player", player: narrative.player } satisfies PlayerEntityResponse);
    }
    const entity = narrative.getEntity(parts[1]);
    if (!entity) return notFound(`entity "${parts[1]}" not found`);
    return ok(entity satisfies ResponseOf<typeof WorldStateApi.getEntity>);
  }

  if (
    method === "GET" &&
    parts[0] === "entity" &&
    parts[1] &&
    parts[2] === "inventory" &&
    parts.length === 3
  ) {
    return ok({ entity_id: parts[1], inventory: narrative.getInventory(parts[1]) } satisfies InventoryGetResponse);
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
    } satisfies InventoryMutationResponse);
  }

  if (
    method === "POST" &&
    parts[0] === "entity" &&
    parts[1] &&
    parts[2] === "inventory" &&
    parts[3] === "remove" &&
    parts.length === 4
  ) {
    const body = (await readJson(req)) as { item_id?: unknown };
    if (!body || typeof body.item_id !== "string" || !body.item_id) {
      return bad("body requires { item_id: string }");
    }
    const removed = narrative.removeInventoryItem(parts[1], body.item_id);
    if (!removed) {
      return notFound(
        `entity "${parts[1]}" not found or no inventory item with id "${body.item_id}"`,
      );
    }
    return mutated({
      ok: true,
      entity_id: parts[1],
      inventory: narrative.getInventory(parts[1]),
    } satisfies InventoryMutationResponse);
  }

  // ── Documento del mundo (bajo demanda para el motor narrativo) ──
  if (method === "GET" && path === "/world_doc") {
    if (!narrative.session_id || !narrative.game_id) {
      return notFound("no active session — world_doc belongs to a game session");
    }
    try {
      return ok({
        game_id: narrative.game_id,
        world_name: narrative.world.name,
        world_doc: loadWorldDoc(gamesDir, narrative.game_id),
      } satisfies WorldDocResponse);
    } catch (err) {
      return notFound(`world.md unavailable for "${narrative.game_id}": ${(err as Error).message}`);
    }
  }

  // ── Guía de sistemas de UI (tool MCP ui_doc_get) ──
  // Documento canónico (data/contract/prompts/ui_systems.md) + el estado
  // ACTIVO de la sesión: qué vista/modo/combate están congelados y qué
  // plugins corren — el motor adapta su salida a lo activo, nunca lo cambia.
  if (method === "GET" && path === "/ui_doc") {
    if (!narrative.session_id) {
      return notFound("no active session — ui_doc describes a running session's UI");
    }
    try {
      return ok({
        ui_state: {
          view: narrative.world.view || "overworld",
          render_mode: narrative.world.render_mode || "image",
          combat_system: narrative.world.combat_system || "standard",
          style_id: narrative.world.style_id,
          plugins: plugins.list(),
        },
        ui_doc: readFileSync(UI_SYSTEMS_DOC, "utf-8"),
      } satisfies UiDocResponse);
    } catch (err) {
      return notFound(`ui_systems.md unavailable: ${(err as Error).message}`);
    }
  }

  // ── NPC high-level movement ──
  if (method === "GET" && path === "/npcs/in_transit") {
    return ok({ npcs: npcDirector.getNpcsInTransit() } satisfies NpcsInTransitResponse);
  }

  if (method === "GET" && parts[0] === "npc" && parts[1] && parts.length === 2) {
    const info = npcDirector.getNpcPlace(parts[1]);
    if (!info) return notFound(`npc "${parts[1]}" not found`);
    return ok(info satisfies ResponseOf<typeof WorldStateApi.getNpc>);
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
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.moveNpcToPlace>);
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
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.arriveNpc>);
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
    return mutated(result satisfies ResponseOf<typeof WorldStateApi.setNpcDirective>);
  }

  return { status: 404, body: { ok: false, error: `no route for ${method} ${path}` } satisfies ErrorResponse };
}

// ── Helpers ──

function ok(body: unknown): RouteResult {
  return { status: 200, body };
}

function mutated(body: unknown): RouteResult {
  return { status: 200, body, mutated: true };
}

function bad(message: string): RouteResult {
  return { status: 400, body: { ok: false, error: message } satisfies ErrorResponse };
}

function notFound(message: string): RouteResult {
  return { status: 404, body: { ok: false, error: message } satisfies ErrorResponse };
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

const STYLE_FILE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** GET /styles/{style_id}/{file} — sirve las imágenes/manifest de un style
 *  pack. Los dos segmentos se validan contra SAFE_ID/extensión conocida, así
 *  que no hay traversal posible (`..` no pasa el regex). */
function serveStyleFile(req: IncomingMessage, res: ServerResponse, stylesDir: string): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean); // ["styles", id, file]
  const styleId = parts[1] ?? "";
  const file = parts[2] ?? "";
  const ext = extname(file).toLowerCase();
  const mime = STYLE_FILE_MIME[ext];
  const safeFile = SAFE_ID.test(file); // sin "/" ni "..": el regex solo admite [A-Za-z0-9_.-]
  if (parts.length !== 3 || !SAFE_ID.test(styleId) || !safeFile || !mime || file.includes("..")) {
    sendJson(res, 400, { ok: false, error: "expected GET /styles/{style_id}/{file.(jpg|png|webp|json)}" });
    return;
  }
  const path = join(stylesDir, styleId, file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    sendJson(res, 404, { ok: false, error: `style file not found: ${styleId}/${file}` });
    return;
  }
  const body = readFileSync(path);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": body.byteLength,
    // Las tarjetas del título se re-piden en cada visita; las imágenes de un
    // pack solo cambian al regenerar el estilo.
    "Cache-Control": "max-age=300",
  });
  res.end(body);
}
