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
import { escenaExpandidaDePrueba, makeNarrativeState } from "./helpers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin, pluginListSummary } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import { pluginRegisterBody } from "../bridge/state-http/context.js";

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
let mapChanges = 0;
let progressMessages: string[] = [];

before(async () => {
  narrative = makeNarrativeState().narrative;
  narrative.startNewSession("plugtest");
  activePlugins = new Map();
  server = createStateHttpServer({
    // El motor al que apuntaría el bridge: GET /health lo publica.
    aiServerUrl: "http://127.0.0.1:0",
    gatewayUrl: "ws://127.0.0.1:0",
    port: 0, // efímero
    narrative,
    npcDirector: new NpcDirector(narrative),
    gamesDir: fileURLToPath(new URL("../data/games", import.meta.url)),
    onMutation: async () => {
      mutations += 1;
    },
    onProgress: (message) => {
      progressMessages.push(message);
    },
    onMapChanged: () => {
      mapChanges += 1;
    },
    plugins: {
      register: (raw) =>
        pluginRegisterBody(registerRuntimePlugin(narrative, activePlugins, raw)),
      list: () =>
        [...activePlugins.entries()].map(([id, m]) =>
          pluginListSummary(id, m, narrative.getPluginRecord(id)?.origin.author),
        ),
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
        ),
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
  it("cabecera x-nefan-session: mismatch → 409 en cualquier ruta; sesión correcta o sin cabecera → pasa", async () => {
    // Mismatch: la petición pertenece a otra sesión (takeover con request en
    // vuelo) — 409 fail-loud en lectura Y escritura.
    const mism = await fetch(`${baseUrl}/story`, {
      headers: { "x-nefan-session": "sesion-pisada" },
    });
    assert.equal(mism.status, 409);
    const mismBody = (await mism.json()) as Record<string, unknown>;
    assert.match(String(mismBody.error), /session_mismatch/);
    const mismPost = await fetch(`${baseUrl}/map/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nefan-session": "sesion-pisada" },
      body: JSON.stringify({ id: "no_debe_entrar", name: "No", kind: "settlement" }),
    });
    assert.equal(mismPost.status, 409);
    assert.equal(narrative.worldMap.get("no_debe_entrar"), undefined);
    // /health queda fuera de la guardia (diagnóstico de infra).
    const health = await fetch(`${baseUrl}/health`, {
      headers: { "x-nefan-session": "sesion-pisada" },
    });
    assert.equal(health.status, 200);
    // Sesión correcta → pasa.
    const okRes = await fetch(`${baseUrl}/story`, {
      headers: { "x-nefan-session": narrative.session_id },
    });
    assert.equal(okRes.status, 200);
  });

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

  it("GET /ui_doc devuelve la guía de UI + el estado activo de la sesión", async () => {
    const { status, body } = await get("/ui_doc");
    assert.equal(status, 200);
    const uiState = body.ui_state as Record<string, unknown>;
    // Sesión de test sin campos congelados → defaults explícitos.
    assert.equal(uiState.render_mode, "image");
    assert.equal(uiState.combat_system, "standard");
    assert.ok(Array.isArray(uiState.plugins));
    const doc = String(body.ui_doc);
    assert.ok(doc.includes("UI SYSTEMS REFERENCE") && doc.includes("dialogue"), "doc canónico servido");
  });

  it("GET /story devuelve la crónica completa de la sesión activa", async () => {
    narrative.appendStory("El herrero juró venganza contra el gremio.");
    narrative.appendStory("La forastera pagó la deuda de Yishaq.");
    const { status, body } = await get("/story");
    assert.equal(status, 200);
    assert.equal(body.session_id, narrative.session_id);
    const story = String(body.story_so_far);
    assert.ok(story.includes("herrero") && story.includes("forastera"), "crónica entera");
    assert.equal(body.total_chars, story.length);
  });

  it("GET /entities incluye el name de data.name", async () => {
    narrative.recordEntitySpawned("herrero_1", "npc", "s1", [0, 0, 0], { name: "Álvar" });
    const { body } = await get("/entities");
    const list = body.entities as Array<Record<string, unknown>>;
    const herrero = list.find((e) => e.id === "herrero_1");
    assert.ok(herrero, "entidad listada");
    assert.equal(herrero.name, "Álvar");
  });

  it("POST /scheduled_event/{id}/resolve retira el evento; id desconocido → 404 con los pendientes", async () => {
    const schedId = narrative.addScheduledEvent("Vira se entera de la venta", "al volver a la plaza", "evt_1");
    const before = mutations;
    const okRes = await post(`/scheduled_event/${schedId}/resolve`, {});
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.ok, true);
    assert.equal(okRes.body.id, schedId);
    assert.equal(okRes.body.remaining, 0);
    assert.ok(mutations > before, "resolver persiste (onMutation)");

    const missing = await post("/scheduled_event/sched_9999/resolve", {});
    assert.equal(missing.status, 404);
    assert.match(String(missing.body.error), /pending ids/);
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

  it("POST /scene/asset_refs: append con dedupe, keep-list y 404 sin escena", async () => {
    narrative.recordSceneLoaded("tile_refs", escenaExpandidaDePrueba("tile_refs"));
    const r1 = await post("/scene/asset_refs", { scene_id: "tile_refs", refs: ["h1", "h2"] });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.total, 2);
    // Append idempotente: repetir h2 no duplica, h3 se añade.
    const r2 = await post("/scene/asset_refs", { scene_id: "tile_refs", refs: ["h2", "h3"] });
    assert.equal(r2.body.total, 3);
    // Los refs quedan en el record de la escena — /sessions/asset_refs (la
    // keep-list del prune, cubierta por sus tests F2) los recoge del save.
    assert.deepEqual(narrative.scenes_loaded["tile_refs"].asset_refs, ["h1", "h2", "h3"]);
    // Escena desconocida → 404 (solo protegen escenas vivas).
    const r404 = await post("/scene/asset_refs", { scene_id: "no_such", refs: ["x1"] });
    assert.equal(r404.status, 404);
    // Body inválido → 400.
    const r400 = await post("/scene/asset_refs", { scene_id: "", refs: "no" });
    assert.equal(r400.status, 400);
  });

  it("POST /map/place + GET /map/place/{id} + onMutation + onMapChanged", async () => {
    const beforeMutations = mutations;
    const beforeMap = mapChanges;
    const created = await post("/map/place", {
      id: "millhaven",
      kind: "settlement",
      parent_id: "world",
      name: "Millhaven",
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.ok(mutations > beforeMutations, "onMutation llamado tras la mutación");
    // Un lugar nuevo o renombrado cambia el panel «Salidas» (#179).
    assert.equal(mapChanges, beforeMap + 1, "onMapChanged llamado UNA vez por el place");

    const fetched = await get("/map/place/millhaven");
    assert.equal(fetched.status, 200);
    const place = fetched.body.place as { name: string };
    assert.equal(place.name, "Millhaven");
  });

  it("POST /scene/validate valida la jugabilidad del tile con el contexto de costuras", async () => {
    // El servidor construye el TileValidationContext desde los vecinos ya
    // registrados: el motor no puede olvidarse de pasarlo.
    const tile = {
      scene_id: "tile_0_0",
      scene_description: "Un claro con una posada.",
      tile: { tx: 0, ty: 0 },
      biome: "forest_floor",
      ground: [{ id: "camino", kind: "path", points: [[0, 41], [128, 52]], w: 2 }],
      volumes: [
        { id: "posada", label: "posada", type: "building", rect: [10, 70, 10, 7], cutaway: true, doors: [{ edge: "s", at: 4, w: 3 }] },
      ],
      entities: [{ id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1] }],
    };
    // Sin ningún tile registrado ⇒ bootstrap: el player es obligatorio y el
    // tile es jugable.
    const ok = await post("/scene/validate", { scene: tile });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body.errors));
    assert.equal((ok.body.stats as { doors_total: number }).doors_total, 3);

    // Una escena sin `tile` ya no es Format D: la suelta y el plató murieron.
    const suelta = await post("/scene/validate", {
      scene: { scene_id: "x", scene_description: "d", size: { cols: 4, rows: 3, meters_per_cell: 2 }, terrain: ["gggg", "gggg", "gggg"], entities: [] },
    });
    assert.equal(suelta.body.ok, false);
    assert.ok((suelta.body.errors as string[]).some((e) => e.includes("`tile`")), JSON.stringify(suelta.body.errors));
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

  // ── Borde zod (contracts/request-schemas.ts): lo que antes colaba con un
  // cast ahora rebota con 400 y ruta+motivo ──

  it("POST /map/place con kind fuera del vocabulario → 400 con la ruta", async () => {
    const { status, body } = await post("/map/place", {
      id: "paramo",
      kind: "wilderness",
      parent_id: "world",
      name: "Páramo",
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /kind/);
  });

  it('POST /map/place con parent_id "null" (string) → 400 pidiendo el null de JSON', async () => {
    // El emisor que escribe la CADENA "null" quería el null de JSON; aceptarla
    // colgaría el place de un padre fantasma (o dependería de que el harness
    // MCP la coercione en silencio, que es lo que vio el playtest 2026-08-13).
    const { status, body } = await post("/map/place", {
      id: "mundo_raiz",
      kind: "world",
      parent_id: "null",
      name: "Mundo",
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /JSON null.*not the string/);
  });

  it("POST /map/place sin name → 400 (antes guardaba name undefined)", async () => {
    const { status, body } = await post("/map/place", {
      id: "sin_nombre",
      kind: "settlement",
      parent_id: "world",
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /name/);
  });

  it("POST /map/link con kind inválido → 400 (antes colaba al world map)", async () => {
    const { status, body } = await post("/map/link", {
      from: "millhaven",
      to: "millhaven_inn",
      kind: "teleport",
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /kind/);
  });

  it("POST /map/trigger player_near sin radius → 400 (antes when colaba sin validar)", async () => {
    const { status, body } = await post("/map/trigger", {
      place_id: "millhaven",
      trigger: { id: "t1", when: { type: "player_near" }, consequences: [] },
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /radius/);
  });

  it("POST /map/trigger con consequences no-array → 400 (antes se MACHACABA a [])", async () => {
    const { status } = await post("/map/trigger", {
      place_id: "millhaven",
      trigger: { id: "t2", when: { type: "first_visit" }, consequences: "luego" },
    });
    assert.equal(status, 400);
  });

  it("POST /npc/{id}/directive con directive no-objeto → 400", async () => {
    const { status } = await post("/npc/alguien/directive", { directive: 42 });
    assert.equal(status, 400);
  });

  it("GET /map/place/{id} inexistente → 404", async () => {
    const { status } = await get("/map/place/nowhere");
    assert.equal(status, 404);
  });

  it("POST /map/link crea el enlace", async () => {
    // "wilderness" (dato anterior del test) NO es un PlaceKind: el borde
    // zod ahora lo rebota — antes colaba en silencio y corrompía el kind.
    await post("/map/place", {
      id: "forest",
      kind: "landmark",
      parent_id: "world",
      name: "Bosque",
    });
    const beforeMap = mapChanges;
    const { status, body } = await post("/map/link", {
      from: "millhaven",
      to: "forest",
      kind: "road",
      travel_hours: 2,
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    // Un enlace nuevo es una salida nueva: el bridge tiene que difundirla (#179).
    assert.equal(mapChanges, beforeMap + 1, "onMapChanged llamado UNA vez por el link");
  });

  it("POST /map/link inválido y POST /map/trigger NO tocan el panel «Salidas»", async () => {
    const beforeMap = mapChanges;
    await post("/map/link", { from: "millhaven", to: "forest", kind: "teleport" });
    await post("/map/trigger", {
      place_id: "millhaven",
      trigger: { id: "t_sin_salidas", when: { type: "first_visit" }, consequences: [] },
    });
    assert.equal(mapChanges, beforeMap, "ni un link rechazado ni un trigger cambian las salidas");
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

  it("inventario: un ítem SIN `id` es 400 con el campo nombrado, no una entrada que nadie podrá quitar", async () => {
    // `inventory_remove` busca por `id` (#231b tipó `InventoryItem`): aceptar
    // un ítem sin él es crear un objeto que ninguna tool puede sacar del
    // inventario. El gate lo dice al motor en vez de guardarlo en silencio.
    const sinId = await post("/entity/boris/inventory", { item: { name: "una nota suelta" } });
    assert.equal(sinId.status, 400);
    assert.equal(sinId.body.error, "item.id: Required");
    const inv = await get("/entity/boris/inventory");
    assert.equal((inv.body.inventory as unknown[]).length, 1, "el inventario no cambió");
  });

  it("plugins: register → list → inspect", async () => {
    const empty = await get("/plugins");
    assert.deepEqual(empty.body.plugins, []);

    const reg = await post("/plugins/register", { manifest: COUNTER_MANIFEST });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.ok, true);
    assert.equal(reg.body.name, "test_counter");
    assert.equal(reg.body.action, "created");
    const pluginId = reg.body.id as string;

    const listed = await get("/plugins");
    assert.equal((listed.body.plugins as unknown[]).length, 1);

    const inspected = await get(`/plugins/${pluginId}/inspect`);
    assert.equal(inspected.status, 200);
    assert.ok("slice" in inspected.body || "available_views" in inspected.body);
  });

  it("plugins: register sin manifest → 400; el MISMO manifest → 200 unchanged", async () => {
    const missing = await post("/plugins/register", {});
    assert.equal(missing.status, 400);

    // Reintento de la tool (timeout, doble envío): mismo hash ⇒ no-op, no un
    // error que el motor solo pueda esquivar inventándose un bump de versión.
    const again = await post("/plugins/register", { manifest: COUNTER_MANIFEST });
    assert.equal(again.status, 200);
    assert.equal(again.body.action, "unchanged");
    assert.equal(((await get("/plugins")).body.plugins as unknown[]).length, 1);
  });

  it("plugins: versión mayor con migrate → 200 migrated; salto sin migrate → 400 con el motivo", async () => {
    // v2 del mismo `name`: renombra count→hits y trae la cadena migrate[1].
    const v2 = {
      ...COUNTER_MANIFEST,
      version: 2,
      description: "Contador v2: el valor se llama hits.",
      slice: { schema: { type: "object" }, initial: { hits: 0 } },
      events_consumed: [
        { type: "counter_inc", do: [{ op: "inc", path: "slice.hits", value: 1 }] },
      ],
      events_produced: [],
      migrate: {
        "1": [
          { op: "set", path: "slice.hits", value: "slice.count" },
          { op: "remove", path: "slice.count" },
        ],
      },
      fixtures: [{ before: { hits: 4 }, event: { type: "counter_inc" }, after: { hits: 5 } }],
    };
    const migrated = await post("/plugins/register", { manifest: v2 });
    assert.equal(migrated.status, 200);
    assert.equal(migrated.body.action, "migrated");
    assert.equal(migrated.body.from_version, 1);
    assert.equal(migrated.body.from_origin_author, "developer");
    assert.equal(migrated.body.version, 2);
    // Sustituye: sigue habiendo UN plugin con ese name, no dos.
    assert.equal(((await get("/plugins")).body.plugins as unknown[]).length, 1);

    // v4 desde v2 sin migrate[3]: rechazo 4xx con el motivo, nunca un 200.
    const v4 = { ...v2, version: 4, description: "Contador v4", migrate: { "2": [] } };
    const hueco = await post("/plugins/register", { manifest: v4 });
    assert.equal(hueco.status, 400);
    assert.match(String(hueco.body.error), /falta 'migrate\[2\]'/);
    const vigentes = (await get("/plugins")).body.plugins as Array<{ version: number }>;
    assert.deepEqual(vigentes.map((p) => p.version), [2], "el rechazo no muta nada");
  });

  it("GET /plugins/{id}/inspect inexistente → 400 con motivo", async () => {
    const { status, body } = await get("/plugins/deadbeef/inspect");
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });
});
