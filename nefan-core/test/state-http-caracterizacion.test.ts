/** Red de CARACTERIZACIÓN del State API: lo que el cable hace hoy, escrito
 *  antes de partir el router por concepto (#225) y sin editarlo después.
 *
 *  No prueba comportamiento nuevo: prueba lo que ya ocurre, y sobre todo lo
 *  que NINGUNA de las tres suites existentes miraba y un refactor puede
 *  romper en silencio.
 *
 *  El hueco caro es la TABLA DEL FLAG `mutated`. Ese flag es lo único que
 *  dispara `onMutation` —y con él la escritura del save—; perderlo en una de
 *  las 12 rutas mutadoras no rompe ninguna respuesta: el status sigue siendo
 *  200 y el body idéntico. El fallo solo se ve al hacer resume, cuando lo que
 *  el motor escribió no está. Por eso las 28 rutas con rama se ejercen aquí
 *  contra un contador real, las 12 exigiendo +1 y las 16 exigiendo +0.
 *
 *  Los demás huecos verificados por grep: /sessions/asset_refs sin
 *  sessionStorage, JSON inválido, body > 256 KiB, OPTIONS, GET /entity/player
 *  y la normalización de barras del path.
 *
 *  Y aquí viven los TRES cambios de comportamiento del corte, cada uno en su
 *  `describe("… CAMBIO DECLARADO n …")`. Están escritos aquí a propósito:
 *  `implementacion.md` no se commitea, así que este fichero es la única
 *  memoria que va a quedar dentro de un mes de qué dejó de funcionar igual y
 *  por qué se decidió que daba igual.
 *   1. Segmentos de más y barras dobles INTERIORES ⇒ 404 (antes contestaban
 *      por otra URL; uno de esos casos además escribía el save).
 *   2. TODO POST lee su body ⇒ un JSON roto es 500 en las dos rutas que lo
 *      ignoraban, y un cuerpo > 256 KiB corta el socket en tres que antes
 *      contestaban.
 *   3. `POST /vocabulary` ve el body antes que su propia comprobación de
 *      sesión activa. La guarda de SEGURIDAD `x-nefan-session` NO se movió, y
 *      hay un test que lo sujeta. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { escenaExpandidaDePrueba, FIXTURE_GAMES, makeNarrativeState } from "./helpers.js";
import { NarrativeState } from "../src/narrative/narrative-state.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { registerRuntimePlugin } from "../src/plugins/register.js";
import { inspectPlugin, pluginListSummary } from "../src/plugins/views.js";
import type { PluginManifest } from "../src/plugins/types.js";
import { WorldStateApi } from "../src/contracts/world-state.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import { pluginRegisterBody } from "../bridge/state-http/context.js";

const COUNTER_MANIFEST = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("fixtures/games/plugtest/plugins/test_counter.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, unknown>;

interface Harness {
  server: Server;
  baseUrl: string;
  narrative: NarrativeState;
  /** Cuántas veces se llamó a onMutation (el save del bridge). */
  mutaciones: () => number;
  /** Registra un plugin EN PROCESO (sin pasar por el cable) y devuelve su id.
   *  Hace falta para ejercer el camino de ÉXITO de GET /plugins/{id}/inspect:
   *  con un id inexistente el handler sale por `bad(...)` y nunca llega a su
   *  `ok(...)`, así que un `mutated` colado ahí no lo vería nadie. Sembrarlo
   *  aquí y no con un POST previo mantiene el test independiente del orden. */
  sembrarPlugin: (nombre: string) => string;
  cerrar: () => void;
}

function levantar(opts: { conStorage: boolean; gamesDir: string }): Promise<Harness> {
  const { narrative, storage } = makeNarrativeState();
  narrative.startNewSession("plugtest");
  const activePlugins = new Map<string, PluginManifest>();
  let mutaciones = 0;
  const server = createStateHttpServer({
    // El motor al que apuntaría el bridge: GET /health lo publica.
    aiServerUrl: "http://127.0.0.1:0",
    gatewayUrl: "ws://127.0.0.1:0",
    port: 0,
    narrative,
    npcDirector: new NpcDirector(narrative),
    gamesDir: opts.gamesDir,
    ...(opts.conStorage ? { sessionStorage: storage } : {}),
    onMutation: () => {
      mutaciones += 1;
    },
    onProgress: () => {},
    onMapChanged: () => {},
    plugins: {
      register: (raw) => pluginRegisterBody(registerRuntimePlugin(narrative, activePlugins, raw)),
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
  return new Promise<Harness>((resolve) => {
    server.on("listening", () =>
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        narrative,
        mutaciones: () => mutaciones,
        sembrarPlugin: (nombre) =>
          registerRuntimePlugin(narrative, activePlugins, { ...COUNTER_MANIFEST, name: nombre }).id,
        cerrar: () => server.close(),
      }),
    );
  });
}

/** Una petición al cable, sin azúcar: el método, el path y el body crudos. */
async function pedir(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  return { status: res.status, body: texto ? (JSON.parse(texto) as Record<string, unknown>) : {} };
}

let h: Harness;
let gamesDir: string;
let schedId: string;
/** Plugin YA registrado: lo necesita el camino de éxito de /plugins/{id}/inspect. */
let pluginVivo: string;

before(async () => {
  // Copia del juego de fixtures: GET /world_doc lee el world.md de disco y
  // POST /vocabulary escribe en world/, así que el gamesDir es real y tmp.
  gamesDir = mkdtempSync(join(tmpdir(), "nefan-carac-"));
  cpSync(join(FIXTURE_GAMES, "plugtest"), join(gamesDir, "plugtest"), { recursive: true });
  h = await levantar({ conStorage: true, gamesDir });
  // El vocabulario se sella con el hash del world.md de la sesión: sin él,
  // writeWorldVocabulary rebota y la ruta contestaría 400 en vez de mutar.
  h.narrative.world.world_doc_hash = "hash_del_world_doc";
  const wm = h.narrative.worldMap;
  wm.upsertPlace({ id: "millhaven", kind: "settlement", parent_id: "world", name: "Millhaven" });
  wm.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque" });
  h.narrative.recordEntitySpawned("boris", "npc", "escena_1", [0, 0, 0], { name: "Boris" });
  h.narrative.recordSceneLoaded("tile_carac", escenaExpandidaDePrueba("tile_carac"));
  schedId = h.narrative.addScheduledEvent("Vira se entera", "al volver", "evt_carac");
  pluginVivo = h.sembrarPlugin("contador_de_caracterizacion");
});

after(() => {
  h.cerrar();
  rmSync(gamesDir, { recursive: true, force: true });
});

/** Las 12 rutas que declaran `mutated: true` — cada una con una petición que
 *  DE VERDAD muta (un 400 de validación no persiste nada y no probaría nada).
 *  El orden importa: cada entrada deja el estado que necesita la siguiente. */
const MUTADORAS: Array<{ nombre: string; method: string; path: () => string; body?: unknown }> = [
  {
    nombre: "POST /plugins/register",
    method: "POST",
    path: () => "/plugins/register",
    body: { manifest: COUNTER_MANIFEST },
  },
  {
    nombre: "POST /map/place",
    method: "POST",
    path: () => "/map/place",
    body: { id: "aldea_carac", kind: "settlement", parent_id: "world", name: "Aldea" },
  },
  {
    nombre: "POST /scene/asset_refs",
    method: "POST",
    path: () => "/scene/asset_refs",
    body: { scene_id: "tile_carac", refs: ["hash_carac"] },
  },
  {
    nombre: "POST /map/link",
    method: "POST",
    path: () => "/map/link",
    body: { from: "millhaven", to: "bosque", kind: "road", travel_hours: 2 },
  },
  {
    nombre: "POST /map/trigger",
    method: "POST",
    path: () => "/map/trigger",
    body: {
      place_id: "millhaven",
      trigger: { id: "trig_carac", when: { type: "first_visit" }, consequences: [] },
    },
  },
  {
    nombre: "POST /entity/{id}/inventory",
    method: "POST",
    path: () => "/entity/boris/inventory",
    body: { item: { id: "cerveza", qty: 2 } },
  },
  {
    nombre: "POST /entity/{id}/inventory/remove",
    method: "POST",
    path: () => "/entity/boris/inventory/remove",
    body: { item_id: "cerveza" },
  },
  {
    nombre: "POST /vocabulary",
    method: "POST",
    path: () => "/vocabulary",
    body: {
      entries: [
        {
          id: "fachada_carac",
          kind: "surface",
          desc: "enlucido encalado sobre entramado de madera oscura",
        },
      ],
    },
  },
  {
    nombre: "POST /scheduled_event/{id}/resolve",
    method: "POST",
    path: () => `/scheduled_event/${schedId}/resolve`,
    body: {},
  },
  {
    nombre: "POST /npc/{id}/move_to_place",
    method: "POST",
    path: () => "/npc/boris/move_to_place",
    body: { place_id: "bosque" },
  },
  {
    nombre: "POST /npc/{id}/arrive",
    method: "POST",
    path: () => "/npc/boris/arrive",
    body: {},
  },
  {
    nombre: "POST /npc/{id}/directive",
    method: "POST",
    path: () => "/npc/boris/directive",
    body: { directive: { type: "guard", target_place_id: "bosque" } },
  },
];

/** Las 16 rutas con rama que NO mutan. Un `mutated: true` de más aquí
 *  escribiría el save en cada lectura del motor narrativo. */
const NO_MUTADORAS: Array<{
  nombre: string;
  method: string;
  path: string | (() => string);
  body?: unknown;
}> = [
  { nombre: "GET /health", method: "GET", path: "/health" },
  { nombre: "GET /map", method: "GET", path: "/map" },
  { nombre: "GET /map/place/{id}", method: "GET", path: "/map/place/millhaven" },
  { nombre: "GET /entities", method: "GET", path: "/entities" },
  { nombre: "GET /entity/{id}", method: "GET", path: "/entity/boris" },
  // El shape especial del jugador es OTRA rama del mismo handler, y es de lo
  // que más lee el motor narrativo: marcarla como mutadora reescribiría el
  // state.json entero en cada lectura. La fila de `/entity/boris` no la toca.
  { nombre: "GET /entity/{id}", method: "GET", path: "/entity/player" },
  { nombre: "GET /entity/{id}/inventory", method: "GET", path: "/entity/boris/inventory" },
  { nombre: "GET /world_doc", method: "GET", path: "/world_doc" },
  { nombre: "GET /ui_doc", method: "GET", path: "/ui_doc" },
  { nombre: "GET /story", method: "GET", path: "/story" },
  { nombre: "GET /npcs/in_transit", method: "GET", path: "/npcs/in_transit" },
  { nombre: "GET /npc/{id}", method: "GET", path: "/npc/boris" },
  { nombre: "GET /plugins", method: "GET", path: "/plugins" },
  // Con un id inexistente el handler sale por `bad(...)`: hace falta ADEMÁS
  // el camino de éxito, o su `ok(...)` no lo ejerce nadie con el contador.
  { nombre: "GET /plugins/{id}/inspect", method: "GET", path: "/plugins/deadbeef/inspect" },
  { nombre: "GET /plugins/{id}/inspect", method: "GET", path: () => `/plugins/${pluginVivo}/inspect` },
  { nombre: "GET /sessions/asset_refs", method: "GET", path: "/sessions/asset_refs" },
  {
    nombre: "POST /narrative_progress",
    method: "POST",
    path: "/narrative_progress",
    body: { message: "construyendo el mapa…" },
  },
  {
    nombre: "POST /scene/validate",
    method: "POST",
    path: "/scene/validate",
    body: {
      scene: {
        scene_id: "tile_0_0",
        scene_description: "Un claro.",
        tile: { tx: 0, ty: 0 },
        biome: "forest_floor",
        entities: [
          { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1] },
        ],
      },
    },
  },
];

describe("State API · caracterización del flag `mutated`", () => {
  it("las 12 rutas mutadoras persisten la sesión: onMutation +1 cada una", async () => {
    for (const ruta of MUTADORAS) {
      const antes = h.mutaciones();
      const res = await pedir(h.baseUrl, ruta.method, ruta.path(), ruta.body);
      assert.equal(res.status, 200, `${ruta.nombre} respondió ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(
        h.mutaciones() - antes,
        1,
        `${ruta.nombre} no disparó onMutation: el save DEJA DE ESCRIBIRSE y nada más lo delata`,
      );
    }
  });

  it("la tabla y la declaración `mutates` del contrato dicen lo mismo, en las dos direcciones", () => {
    // #453 puso la decisión en el contrato (`Endpoint.mutates`): el despacho
    // exige sesión a lo declarado, y el contador de arriba mide lo que cada
    // handler devuelve. Si una ruta muta sin declararlo, se acepta sin partida
    // y `save()` lanza; si se declara sin mutar, rebota lecturas legítimas.
    const declaradas = Object.values(WorldStateApi)
      .filter((ep) => ep.mutates)
      .map((ep) => `${ep.method} ${ep.path}`)
      .sort();
    assert.deepEqual(declaradas, MUTADORAS.map((r) => r.nombre).sort());
    for (const r of NO_MUTADORAS) {
      assert.ok(!declaradas.includes(r.nombre), `${r.nombre} está declarada mutadora y no persiste nada`);
    }
  });

  it("la tabla cubre las 28 rutas con rama: 12 mutadoras + 16 que no", () => {
    // Si alguien añade un endpoint, esta cuenta obliga a decidir a qué lado
    // cae — que es exactamente la decisión que un refactor pierde en silencio.
    assert.equal(MUTADORAS.length, 12);
    assert.equal(new Set(NO_MUTADORAS.map((r) => r.nombre)).size, 16);
    // Más sondas que rutas: dos rutas tienen DOS caminos de éxito distintos
    // (`/entity/player` frente a una entidad normal, y un plugin que existe
    // frente a uno que no), y el contador solo ve el camino que se recorre.
    // Un `mutated` colado en el camino no ejercido pasaba desapercibido con el
    // repo entero en verde: lo encontró QA, y estas dos filas lo cierran.
    assert.equal(NO_MUTADORAS.length, 18);
  });

  it("las 16 rutas restantes NO persisten: onMutation +0 cada una", async () => {
    for (const ruta of NO_MUTADORAS) {
      const antes = h.mutaciones();
      const path = typeof ruta.path === "function" ? ruta.path() : ruta.path;
      const res = await pedir(h.baseUrl, ruta.method, path, ruta.body);
      assert.notEqual(
        res.status,
        404 as number,
        `${ruta.nombre} (${path}) cayó al 404: ${JSON.stringify(res.body)}`,
      );
      assert.equal(
        h.mutaciones() - antes,
        0,
        `${ruta.nombre} (${path}) disparó onMutation: escribe el save en una LECTURA del motor`,
      );
    }
  });
});

describe("State API · bordes del transporte", () => {
  it("OPTIONS responde 204 con las cabeceras CORS, sin tocar el router", async () => {
    const antes = h.mutaciones();
    const res = await fetch(`${h.baseUrl}/map/place`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
    assert.equal(res.headers.get("access-control-allow-headers"), "Content-Type");
    assert.equal(h.mutaciones() - antes, 0);
  });

  it("toda respuesta lleva Access-Control-Allow-Origin (el cliente registra asset_refs)", async () => {
    const res = await fetch(`${h.baseUrl}/health`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("content-type"), "application/json");
  });

  it("JSON inválido en el body → 500 `invalid JSON body`, no un 200 con basura", async () => {
    const antes = h.mutaciones();
    const res = await fetch(`${h.baseUrl}/map/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{esto no es json",
    });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string };
    assert.match(String(body.error), /invalid JSON body/);
    assert.equal(h.mutaciones() - antes, 0);
  });

  it("body vacío en un POST llega como undefined y lo rebota el zod con 400", async () => {
    const res = await fetch(`${h.baseUrl}/map/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    assert.equal(res.status, 400);
  });

  it("las barras FINALES se recortan; una barra doble al principio NO", async () => {
    // Medido, no supuesto: el router hace `pathname.replace(/\/+$/, "")`, así
    // que `/health//` llega a /health pero `//health` no — y esa asimetría es
    // comportamiento vivo que el corte no puede cambiar sin decirlo.
    for (const path of ["/health", "/health/", "/health//"]) {
      const res = await pedir(h.baseUrl, "GET", path);
      assert.equal(res.status, 200, `${path} no llegó a /health`);
      assert.equal(res.body.ok, true);
    }
    assert.equal((await pedir(h.baseUrl, "GET", "//health")).status, 404);
  });

  it("un body de más de 256 KiB corta la conexión y no persiste nada", async () => {
    // Medido, y NO es lo que uno supondría: `readJson` rechaza y acto seguido
    // hace `req.destroy()`, que tumba el socket ANTES de que el `.catch` del
    // server pueda escribir su 500. El cliente ve un ECONNRESET. Queda escrito
    // porque el tope de 256 KiB es lo que impide que un motor narrativo
    // desbocado se coma la RAM del bridge, y un refactor que lo pierda no
    // cambiaría ninguna respuesta observable de las buenas.
    const antes = h.mutaciones();
    await assert.rejects(
      fetch(`${h.baseUrl}/scene/asset_refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: "tile_carac", refs: ["x".repeat(300 * 1024)] }),
      }),
      /fetch failed/,
    );
    assert.equal(h.mutaciones() - antes, 0, "un body cortado no puede persistir nada");
    assert.deepEqual(
      h.narrative.scenes_loaded["tile_carac"].asset_refs,
      ["hash_carac"],
      "el append no llegó a ejecutarse",
    );
  });

  it("GET /entity/player devuelve el shape especial del jugador, no un EntityRecord", async () => {
    const { status, body } = await pedir(h.baseUrl, "GET", "/entity/player");
    assert.equal(status, 200);
    assert.equal(body.id, "player");
    assert.equal(body.type, "player");
    assert.ok(body.player && typeof body.player === "object", "el estado del jugador viaja entero");
  });

  it("la guarda de sesión es ÚNICA y va antes del despacho: 409 en cualquier ruta, /health exento", async () => {
    const ajena = { "x-nefan-session": "sesion-pisada" };
    // Una lectura, una escritura y una ruta que NO EXISTE: si la guarda
    // viviera dentro de cada handler, la inexistente contestaría 404 y el
    // 409 dependería de acordarse de copiarla 27 veces.
    for (const [method, path] of [
      ["GET", "/story"],
      ["POST", "/map/place"],
      ["GET", "/no/existe"],
    ] as const) {
      const res = await fetch(`${h.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...ajena },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(res.status, 409, `${method} ${path} no rebotó por sesión ajena`);
      const body = (await res.json()) as { error?: string };
      assert.match(String(body.error), /session_mismatch/);
    }
    // /health es el único exento (diagnóstico de infra).
    const health = await fetch(`${h.baseUrl}/health`, { headers: ajena });
    assert.equal(health.status, 200);
    // Cabecera vacía = sin guarda (cliente y benches no la mandan).
    const vacia = await fetch(`${h.baseUrl}/story`, { headers: { "x-nefan-session": "" } });
    assert.equal(vacia.status, 200);
  });

  it("ruta desconocida → 404 `no route for METHOD path`", async () => {
    const { status, body } = await pedir(h.baseUrl, "GET", "/no/such/route");
    assert.equal(status, 404);
    assert.equal(body.ok, false);
    assert.equal(body.error, "no route for GET /no/such/route");
  });

  it("el método importa: GET a una ruta que solo es POST cae al 404 genérico", async () => {
    const { status, body } = await pedir(h.baseUrl, "GET", "/vocabulary");
    assert.equal(status, 404);
    assert.match(String(body.error), /^no route for GET/);
  });

  it("rutas hermanas no se confunden entre sí", async () => {
    // `/npcs/in_transit` vs `/npc/{id}`, `/plugins/register` vs
    // `/plugins/{id}/inspect`, `/map/place` (POST) vs `/map/place/{id}` (GET).
    assert.equal((await pedir(h.baseUrl, "GET", "/npcs/in_transit")).status, 200);
    assert.equal((await pedir(h.baseUrl, "GET", "/npc/in_transit")).status, 404);
    assert.equal((await pedir(h.baseUrl, "GET", "/plugins")).status, 200);
    assert.equal((await pedir(h.baseUrl, "GET", "/plugins/register")).status, 404);
    assert.equal((await pedir(h.baseUrl, "GET", "/map/place")).status, 404);
  });
});

describe("State API · CAMBIO DECLARADO 1: la ruta pedida es la ruta contestada", () => {
  it("segmentos de más y barras dobles INTERIORES dejan de colar", async () => {
    // El router de la cadena de ifs miraba `parts[2]` sin comprobar
    // `parts.length`, sobre un array del que `filter(Boolean)` ya había
    // quitado los huecos. Dos consecuencias, y la segunda es más ancha que la
    // primera: `/map/place/millhaven/lo-que-sea` devolvía 200 con el place
    // `millhaven`, y CUALQUIER barra doble interior se colapsaba, así que
    // `/map//place/world` o `/entity/player//inventory` también contestaban.
    // Una respuesta 200 para una URL que nadie pidió.
    //
    // `matchRoute` exige la plantilla EXACTA, así que todas pasan a 404.
    // Ningún emisor real las produce: narrative-mcp y los clientes tipados
    // pasan por `fillPath`, que percent-codifica el id (los 21 sitios de
    // narrative-mcp verificados por QA). Declarado en implementacion.md.
    for (const path of [
      // el hueco en posición de {param}
      "/map/place/millhaven/lo-que-sea",
      "/map/place//millhaven",
      "/entity//boris",
      "/entity//boris/inventory",
      // …y el hueco en cualquier OTRA posición, que es la mitad que faltaba
      // por escribir: la encontró QA midiendo main contra la rama.
      "/map//place/millhaven",
      "/entity/player//inventory",
      "/plugins//deadbeef/inspect",
      "/npcs//in_transit",
    ]) {
      const { status, body } = await pedir(h.baseUrl, "GET", path);
      assert.equal(status, 404, `${path} contestó ${status}`);
      assert.match(String(body.error), /^no route for GET/, `${path}: ${JSON.stringify(body)}`);
    }
    // Y la ruta bien escrita sigue contestando, que es la otra mitad.
    assert.equal((await pedir(h.baseUrl, "GET", "/map/place/millhaven")).status, 200);
    assert.equal((await pedir(h.baseUrl, "GET", "/entity/boris")).status, 200);
    assert.equal((await pedir(h.baseUrl, "GET", "/entity/player/inventory")).status, 200);
  });

  it("…incluido un POST que ANTES escribía el save", async () => {
    // `POST /entity/boris//inventory` daba 200 y MUTABA en el router viejo.
    // Ahora es un 404 que no toca nada. Es el único de los casos nuevos que
    // tenía efecto de escritura, y por eso se comprueba con el contador: un
    // 404 que aun así persistiera sería peor que el 200 de antes.
    const antes = h.mutaciones();
    const res = await pedir(h.baseUrl, "POST", "/entity/boris//inventory", { item: { id: "x" } });
    assert.equal(res.status, 404);
    assert.equal(h.mutaciones() - antes, 0, "una ruta que ya no existe no puede escribir el save");
  });
});

describe("State API · CAMBIO DECLARADO 4 (#453): sin partida, una mutadora es 409 antes de leer el body", () => {
  it("con la sesión cerrada, el body ya no manda: roto o bueno, `POST /vocabulary` es 409 `no_session`", async () => {
    // Sustituye al CAMBIO DECLARADO 3 del corte #225 («con la sesión cerrada
    // Y el body roto gana el body: 500»). Aquella asimetría existía porque la
    // comprobación de sesión vivía DENTRO del handler, después del body; #453
    // la sube al despacho para toda ruta que el contrato declare `mutates`,
    // así que vuelve a ir antes del body — y responde 409 en vez del 404 de
    // dominio que daba el handler, porque no es «no encontrado»: es «no hay
    // partida en la que aplicar esto».
    const sin = await levantar({ conStorage: true, gamesDir });
    try {
      sin.narrative.session_id = "";
      const roto = await fetch(`${sin.baseUrl}/vocabulary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{roto",
      });
      assert.equal(roto.status, 409);
      assert.match(String(((await roto.json()) as { error?: string }).error), /^no_session: POST \/vocabulary/);
      const bueno = await pedir(sin.baseUrl, "POST", "/vocabulary", { entries: [] });
      assert.equal(bueno.status, 409);
      assert.match(String(bueno.body.error), /^no_session/);
      assert.equal(sin.mutaciones(), 0, "un rechazo no llega a onMutation");
      // Y una LECTURA sin sesión conserva su 404 de dominio: la guardia nueva
      // no se come a las rutas de documento.
      const cronica = await pedir(sin.baseUrl, "GET", "/story");
      assert.equal(cronica.status, 404);
      assert.match(String(cronica.body.error), /no active session/);
    } finally {
      sin.cerrar();
    }
  });

  it("lo que NO se movió: la guarda de sesión sigue ANTES de leer el body", async () => {
    // Esto es lo que de verdad importa del orden. `x-nefan-session` es un
    // invariante de SEGURIDAD: una petición de otra sesión tiene que rebotar
    // sin que su cuerpo llegue a tocarse, por roto o por enorme que venga.
    const roto = await fetch(`${h.baseUrl}/vocabulary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nefan-session": "sesion-pisada" },
      body: "{roto",
    });
    assert.equal(roto.status, 409, "el body no puede adelantar a la guarda de sesión");
    assert.match(String(((await roto.json()) as { error?: string }).error), /session_mismatch/);
  });
});

describe("State API · CAMBIO DECLARADO 2: JSON inválido y body enorme en TODO POST", () => {
  it("JSON inválido en los dos POST que no leían el body ya no se ignora", async () => {
    // `POST /npc/{id}/arrive` y `POST /scheduled_event/{id}/resolve` eran las
    // dos únicas ramas que NUNCA leían el body: un cuerpo corrupto entraba y
    // el handler seguía como si nada. Ahora el despacho lee el body de TODO
    // POST, así que un JSON roto sale con 500 `invalid JSON body` en vez de
    // colar. Es más fail-loud y va en la buena dirección.
    for (const path of ["/npc/boris/arrive", `/scheduled_event/${schedId}/resolve`]) {
      const res = await fetch(`${h.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{roto",
      });
      assert.equal(res.status, 500, path);
      assert.match(String(((await res.json()) as { error?: string }).error), /invalid JSON body/);
    }
  });

  it("…y con más de 256 KiB esas mismas rutas pasan a cortar el socket", async () => {
    // La cara fea del mismo cambio, y hay que decirla: `readJson` hace
    // `req.destroy()`, así que un cuerpo enorme no da 500 — tumba la conexión.
    // Tres rutas que antes CONTESTABAN (arrive, resolve y /vocabulary) ahora
    // no contestan, y por la vía MCP eso sale como «bridge unreachable», que
    // señala al servicio caído cuando el problema es el tamaño del cuerpo.
    // Inalcanzable desde el motor (manda `{}`), pero es un modo de fallo nuevo
    // y engañoso. El arreglo de verdad —contestar 400 como pide el contrato en
    // vez de destruir el socket— es el item de backlog que ya estaba anotado, y
    // ahora abarca tres rutas más. No se hace aquí: cambiaría también
    // `POST /map/place`, que hoy ya se comporta así.
    const enorme = JSON.stringify({ entries: "x".repeat(300 * 1024) });
    for (const path of ["/npc/boris/arrive", `/scheduled_event/${schedId}/resolve`, "/vocabulary"]) {
      await assert.rejects(
        fetch(`${h.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: enorme,
        }),
        /fetch failed/,
        path,
      );
    }
  });
});

describe("State API · /sessions/asset_refs sin sessionStorage", () => {
  it("sin storage inyectado la ruta NO existe: 404 `no route for`", async () => {
    // Es el único endpoint cuya rama depende de una dependencia opcional, y
    // ninguna suite lo miraba: un refactor que la olvide deja al prune del
    // asset-store podando lo que un resume necesita.
    const sin = await levantar({ conStorage: false, gamesDir });
    try {
      const { status, body } = await pedir(sin.baseUrl, "GET", "/sessions/asset_refs");
      assert.equal(status, 404);
      assert.equal(body.error, "no route for GET /sessions/asset_refs");
    } finally {
      sin.cerrar();
    }
  });
});
