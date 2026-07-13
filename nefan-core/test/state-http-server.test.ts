/** Tests del state HTTP API (bridge/state-http-server.ts) sobre un servidor
 *  real en puerto efímero, con NarrativeState en memoria y los mismos hooks de
 *  plugins que monta ws-server.ts. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { NarrativeState } from "../src/narrative/narrative-state.js";
import { makeNarrativeState } from "./helpers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";

const COUNTER_MANIFEST = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("fixtures/games/plugtest/plugins/test_counter.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, unknown>;

let server: Server;
let baseUrl: string;
let narrative: NarrativeState;
let activePlugins: Map<string, PluginManifest>;
let mutations = 0;
let progressMessages: string[] = [];

before(async () => {
  narrative = makeNarrativeState().narrative;
  narrative.startNewSession("plugtest");
  activePlugins = new Map();
  server = createStateHttpServer({
    port: 0, // efímero
    narrative,
    npcDirector: new NpcDirector(narrative),
    stylesDir: fileURLToPath(new URL("../data/styles", import.meta.url)),
    gamesDir: fileURLToPath(new URL("../data/games", import.meta.url)),
    onMutation: async () => {
      mutations += 1;
    },
    onProgress: (message) => {
      progressMessages.push(message);
    },
    plugins: {
      register: (raw) => {
        const result = registerRuntimePlugin(narrative, activePlugins, raw);
        return {
          id: result.id,
          name: result.manifest.name,
          version: result.manifest.version,
          fixturesPassed: result.fixturesPassed,
        };
      },
      list: () =>
        [...activePlugins.entries()].map(([id, m]) => ({ id, name: m.name, version: m.version })),
      inspect: (id, view) =>
        inspectPlugin(
          {
            plugins: narrative.plugins,
            world: narrative.world,
            player: narrative.player,
            entities: narrative.entities,
          },
          activePlugins,
          id,
          view,
        ) as unknown as Record<string, unknown>,
    },
  });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("state HTTP API", () => {
  it("GET /health refleja la sesión activa", async () => {
    const { status, body } = await get("/health");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.has_session, true);
    assert.equal(body.game_id, "plugtest");
  });

  it("GET /world_doc devuelve el world.md del juego activo", async () => {
    const { status, body } = await get("/world_doc");
    // La sesión activa es "plugtest", cuyo world.md vive en fixtures, no en
    // data/games — el endpoint responde 404 explicando el motivo (fail-loud).
    assert.equal(status, 404);
    assert.match(String((body as { error?: string }).error), /world\.md unavailable/);
  });

  it("ruta desconocida → 404 con error", async () => {
    const { status, body } = await get("/no/such/route");
    assert.equal(status, 404);
    assert.equal(body.ok, false);
  });

  it("POST /narrative_progress difunde el latido (y valida el body)", async () => {
    progressMessages = [];
    const res = await fetch(`${baseUrl}/narrative_progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "construyendo el mapa del mundo…" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(progressMessages, ["construyendo el mapa del mundo…"]);

    const bad = await fetch(`${baseUrl}/narrative_progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(bad.status, 400);
    assert.equal(progressMessages.length, 1);
  });

  it("POST /map/place + GET /map/place/{id} + onMutation", async () => {
    const beforeMutations = mutations;
    const created = await post("/map/place", {
      id: "millhaven",
      kind: "settlement",
      parent_id: "world",
      name: "Millhaven",
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.ok(mutations > beforeMutations, "onMutation llamado tras la mutación");

    const fetched = await get("/map/place/millhaven");
    assert.equal(fetched.status, 200);
    const place = fetched.body.place as { name: string };
    assert.equal(place.name, "Millhaven");
  });

  it("POST /scene/validate valida jugabilidad y la regla de link exterior", async () => {
    const scene = {
      scene_id: "val_e2e",
      place_id: "millhaven_inn",
      size: { cols: 16, rows: 12, meters_per_cell: 0.5 },
      terrain: Array.from({ length: 12 }, () => "g".repeat(16)),
      terrain_legend: {},
      structures: [
        { type: "room", rect: [2, 1, 10, 7], wall_char: "W", floor_char: "o", doors: [{ side: "south", at: 4, width: 2 }] },
      ],
      entities: [{ id: "player", kind: "player", name: "Tú", cell: [7, 9], footprint: [1, 1], glyph: "@" }],
    };

    // Place inexistente → error que instruye a crear el place.
    const missing = await post("/scene/validate", { scene });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.ok, false);
    assert.ok((missing.body.errors as string[]).some((e) => e.includes("map_upsert_place")));

    // Con place pero sin link saliente → error que instruye a enlazar.
    await post("/map/place", { id: "millhaven_inn", kind: "interior", parent_id: "millhaven", name: "Posada" });
    const unlinked = await post("/scene/validate", { scene });
    assert.equal(unlinked.body.ok, false);
    assert.ok((unlinked.body.errors as string[]).some((e) => e.includes("map_link")));

    // Con link → jugable.
    await post("/map/link", { from: "millhaven_inn", to: "millhaven", kind: "door" });
    const linked = await post("/scene/validate", { scene });
    assert.equal(linked.body.ok, true, JSON.stringify(linked.body.errors));
    assert.equal((linked.body.stats as { border_reachable: boolean }).border_reachable, true);
  });

  it("POST /scene/validate sin scene → 400", async () => {
    const { status, body } = await post("/scene/validate", {});
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });

  it("POST /map/place sin id → 400", async () => {
    const { status, body } = await post("/map/place", { kind: "settlement" });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });

  it("GET /map/place/{id} inexistente → 404", async () => {
    const { status } = await get("/map/place/nowhere");
    assert.equal(status, 404);
  });

  it("POST /map/link crea el enlace", async () => {
    await post("/map/place", {
      id: "forest",
      kind: "wilderness",
      parent_id: "world",
      name: "Bosque",
    });
    const { status, body } = await post("/map/link", {
      from: "millhaven",
      to: "forest",
      kind: "road",
      travel_hours: 2,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("inventario de entidad: 404 para entidad desconocida, alta y lectura", async () => {
    const missing = await post("/entity/ghost/inventory", { item: { id: "sword" } });
    assert.equal(missing.status, 404);

    narrative.recordEntitySpawned("boris", "npc", "scene_1", [0, 0, 0], { name: "Boris" });
    const added = await post("/entity/boris/inventory", { item: { id: "ale", qty: 2 } });
    assert.equal(added.status, 200);
    const inv = await get("/entity/boris/inventory");
    assert.equal(inv.status, 200);
    assert.equal((inv.body.inventory as unknown[]).length, 1);
  });

  it("plugins: register → list → inspect", async () => {
    const empty = await get("/plugins");
    assert.deepEqual(empty.body.plugins, []);

    const reg = await post("/plugins/register", { manifest: COUNTER_MANIFEST });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.ok, true);
    assert.equal(reg.body.name, "test_counter");
    const pluginId = reg.body.id as string;

    const listed = await get("/plugins");
    assert.equal((listed.body.plugins as unknown[]).length, 1);

    const inspected = await get(`/plugins/${pluginId}/inspect`);
    assert.equal(inspected.status, 200);
    assert.ok("slice" in inspected.body || "available_views" in inspected.body);
  });

  it("plugins: register sin manifest → 400; duplicado → 400", async () => {
    const missing = await post("/plugins/register", {});
    assert.equal(missing.status, 400);

    const dup = await post("/plugins/register", { manifest: COUNTER_MANIFEST });
    assert.equal(dup.status, 400);
  });

  it("GET /plugins/{id}/inspect inexistente → 400 con motivo", async () => {
    const { status, body } = await get("/plugins/deadbeef/inspect");
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });
});
