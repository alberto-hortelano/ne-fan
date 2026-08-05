/** Test de contrato F0: cada endpoint de la tabla `WorldStateApi`
 *  (src/contracts/world-state.ts) tiene una rama real en el router de
 *  bridge/state-http-server.ts — ninguna petición cae al 404 genérico
 *  "no route for". Los 400/404 de dominio VALEN (la ruta existe y respondió).
 *
 *  Nombre elegido para no colisionar con contract-fixtures/contract-prompts
 *  (que van del contrato del LLM en data/contract/, otra cosa). */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { makeNarrativeState } from "./helpers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import { WorldStateApi } from "../src/contracts/world-state.js";
import { fillPath, type Endpoint } from "../src/contracts/http.js";

/** Endpoints del contrato SIN rama en el router de hoy (documentados así):
 *  - getLlmContext (PLANNED F5) y getAssetRefs (PLANNED F2)
 *  - getStyleFile: rama binaria aparte (serveStyleFile), probada abajo a mano */
const SKIP = new Set(["getLlmContext", "getAssetRefs", "getStyleFile"]);

let server: Server;
let baseUrl: string;

before(async () => {
  const { narrative } = makeNarrativeState();
  narrative.startNewSession("plugtest");
  const activePlugins = new Map<string, PluginManifest>();
  server = createStateHttpServer({
    port: 0,
    narrative,
    npcDirector: new NpcDirector(narrative),
    stylesDir: fileURLToPath(new URL("../data/styles", import.meta.url)),
    gamesDir: fileURLToPath(new URL("../data/games", import.meta.url)),
    onMutation: () => {},
    onProgress: () => {},
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

  it("getStyleFile (rama binaria): sirve un fichero real de data/styles", async () => {
    // La rama /styles/ es un bypass binario fuera del ciclo JSON; se prueba
    // con un manifest real de un style pack shipped.
    const res = await fetch(`${baseUrl}${fillPath(WorldStateApi.getStyleFile.path, {
      style_id: "medievo_crudo",
      file: "style.json",
    })}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(typeof body.style_token === "string");
  });
});
