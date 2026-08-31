/** Test de contrato F0: cada endpoint de la tabla `WorldStateApi`
 *  (src/contracts/world-state.ts) tiene una rama real en el router de
 *  bridge/state-http/routes.ts — ninguna petición cae al 404 genérico
 *  "no route for". Los 400/404 de dominio VALEN (la ruta existe y respondió).
 *
 *  Nombre elegido para no colisionar con contract-fixtures/contract-prompts
 *  (que van del contrato del LLM en data/contract/, otra cosa). */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { escenaExpandidaDePrueba, makeNarrativeState } from "./helpers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import { sceneRoutes } from "../bridge/state-http/scene-routes.js";
import { pluginRegisterBody } from "../bridge/state-http/context.js";
import { WorldStateApi } from "../src/contracts/world-state.js";
import { fillPath, type Endpoint } from "../src/contracts/http.js";
import { PLANNED_ROUTES } from "../bridge/state-http/routes.js";

/** Los endpoints del contrato SIN handler los declara el propio router
 *  (`PLANNED_ROUTES`), que es de donde sale el tipo `RouteKey`: una lista
 *  aparte aquí se desincronizaría en silencio y este test aprobaría el
 *  endpoint que alguien acaba de dejar sin implementar. */
const SKIP = new Set<string>(PLANNED_ROUTES);

let server: Server;
let baseUrl: string;
let narrativeRef: ReturnType<typeof makeNarrativeState>["narrative"];

before(async () => {
  const { narrative, storage } = makeNarrativeState();
  narrativeRef = narrative;
  narrative.startNewSession("plugtest");
  const activePlugins = new Map<string, PluginManifest>();
  server = createStateHttpServer({
    // El motor al que apuntaría el bridge: GET /health lo publica.
    aiServerUrl: "http://127.0.0.1:0",
    gatewayUrl: "ws://127.0.0.1:0",
    port: 0,
    narrative,
    npcDirector: new NpcDirector(narrative),
    gamesDir: fileURLToPath(new URL("../data/games", import.meta.url)),
    sessionStorage: storage,
    onMutation: () => {},
    onProgress: () => {},
    plugins: {
      register: (raw) =>
        pluginRegisterBody(registerRuntimePlugin(narrative, activePlugins, raw)),
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
        ),
    },
  });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe("contrato WorldStateApi ↔ router real", () => {
  it("toda ruta de la tabla tiene rama (nada cae al 404 genérico)", async () => {
    for (const [name, ep] of Object.entries(WorldStateApi) as Array<
      [string, Endpoint<unknown, unknown, string>]
    >) {
      if (SKIP.has(name)) continue;
      // Params dummy: cualquier id vale — un 404 "not found" de dominio
      // demuestra que la rama existe; el fallo es el 404 "no route for".
      const params: Record<string, string> = {};
      for (const m of ep.path.matchAll(/\{(\w+)\}/g)) params[m[1]] = "dummy";
      const url = `${baseUrl}${fillPath(ep.path, params)}`;
      const res = await fetch(url, {
        method: ep.method,
        headers: { "Content-Type": "application/json" },
        // Body vacío {}: los POST validan y devuelven 400 de dominio, no 404.
        body: ep.method === "POST" ? "{}" : undefined,
      });
      const body = (await res.json()) as { error?: string };
      assert.ok(
        !(res.status === 404 && typeof body.error === "string" && body.error.startsWith("no route for")),
        `WorldStateApi.${name} (${ep.method} ${ep.path}) no tiene rama en el router: ${body.error}`,
      );
    }
  });

  it("getAssetRefs: unión de refs de escenas/entidades/snapshot de todos los saves", async () => {
    narrativeRef.recordSceneLoaded("plaza", escenaExpandidaDePrueba("plaza"), ["hash_a", "hash_b"]);
    narrativeRef.recordEntitySpawned("npc1", "npc", "plaza", [0, 0, 0], {}, "test", "", ["hash_c"]);
    await narrativeRef.establecer();
    const res = await fetch(`${baseUrl}/sessions/asset_refs`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { refs: string[] };
    for (const h of ["hash_a", "hash_b", "hash_c"]) {
      assert.ok(body.refs.includes(h), `falta ${h} en la keep-list`);
    }
  });

  // GET /styles/{id}/{file} migró al asset-store en F2 — cubierto en
  // test/asset-store.test.ts.
});

describe("POST /scene/validate — una escena mal formada nunca es un 500 (#195)", () => {
  // Los tres vectores medidos el 2026-08-30: cada uno tumbaba la ruta con un
  // throw (computeTileEdges / TypeError / resolveBiome) que state-http-server
  // servía como 500 mudo. El handler se invoca SIN servidor: el gate vive en
  // `openTile`, no en un catch de última línea (ver scene-routes.ts).
  const vectores: Array<[string, Record<string, unknown>]> = [
    ["__expanded con terrain vacío", { tile: { tx: 0, ty: 0 }, scene_id: "v1", biome: "meadow", __expanded: true, terrain: [], entities: [] }],
    ["__expanded sin terrain", { tile: { tx: 0, ty: 0 }, scene_id: "v2", biome: "meadow", __expanded: true, entities: [] }],
    [
      "__expanded con grid perfecto y biome fuera de catálogo",
      {
        tile: { tx: 0, ty: 0 }, scene_id: "v3", biome: "bogus", __expanded: true,
        terrain: Array.from({ length: 128 }, () => "g".repeat(128)), entities: [],
      },
    ],
  ];

  for (const [nombre, scene] of vectores) {
    it(`${nombre} → {ok:false} accionable, no un throw`, async () => {
      const { narrative } = makeNarrativeState();
      const ctx = { narrative } as Parameters<NonNullable<typeof sceneRoutes.validateScene>>[0];
      const res = await sceneRoutes.validateScene!(ctx, { params: {}, query: new URLSearchParams(), body: { scene } });
      assert.ok(res, "la ruta está montada siempre");
      assert.equal(res.status, 200, "la escena mal formada es un veredicto, no un error HTTP");
      const body = res.body as { ok: boolean; errors: string[] };
      assert.equal(body.ok, false);
      assert.ok(body.errors.length > 0, "el motor necesita el defecto nombrado para corregir");
    });
  }
});
