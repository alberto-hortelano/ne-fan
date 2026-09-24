/** El world map en zod (#465, #578): el rect del anchor con sus cotas, igual
 *  en las TRES puertas por donde entra, y el mapa entero del snapshot.
 *
 *  Las tres puertas:
 *   · `AnchorSchema` a secas (`src/contracts/world-map-schema.ts`);
 *   · `POST /map/place` del State API del bridge, por HTTP de verdad
 *     (`PlaceUpsertSchema` lo incluye);
 *   · el pre-flight de la tool `map_upsert_place` de narrative-mcp
 *     (`validateAnchor`, `narrative-mcp/validators.ts`).
 *  Cada negativo se pasa por las tres y el veredicto tiene que ser el mismo:
 *  hasta #465 eran dos copias y ninguna miraba que el rect cupiera en el tile.
 *
 *  Y el mapa del snapshot: hasta #578 `world_map` era `z.record(unknown)` en
 *  `WorldSnapshotSchema` y dos comentarios decían que lo re-validaba
 *  `fromSerialized`, que solo lo envuelve. */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { AnchorSchema, WorldMapSchema } from "../src/contracts/world-map-schema.js";
import { WorldMapManager } from "../src/world-map/world-map.js";
import { WORLD_SNAPSHOT_SCHEMA_VERSION, WorldSnapshotSchema } from "../src/games/world-snapshot.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { createStateHttpServer } from "../bridge/state-http-server.js";
import type { NpcDirector } from "../src/world-map/npc-director.js";
import { makeNarrativeState } from "./helpers.js";

/** Los rects que tienen que RECHAZAR las tres puertas, con la palabra que el
 *  motivo tiene que nombrar para que el motor sepa qué corregir. */
const MALOS: Array<{ que: string; rect: unknown; dice: RegExp }> = [
  { que: "fraccionario", rect: [10.5, 10, 4, 4], dice: /ENTERO/ },
  { que: "col negativo", rect: [-1, 10, 4, 4], dice: /negativo/ },
  { que: "row negativo", rect: [10, -3, 4, 4], dice: /negativo/ },
  { que: "w = 0", rect: [10, 10, 0, 4], dice: /al menos 1 celda/ },
  { que: "h negativo", rect: [10, 10, 4, -2], dice: /al menos 1 celda/ },
  { que: "se sale por el este (col + w = 129)", rect: [125, 10, 4, 4], dice: /este.*129 > 128/ },
  { que: "se sale por el sur (row + h = 130)", rect: [0, 120, 4, 10], dice: /sur.*130 > 128/ },
  { que: "tres números", rect: [1, 2, 3], dice: /rect/ },
];

/** Los que tienen que ACEPTAR: los bordes exactos del tile y los rects que ya
 *  escriben el motor falso (`labs/narrative/fake-scenes.ts`) y la QA del 144. */
const BUENOS: Array<[number, number, number, number]> = [
  [0, 0, 128, 128],
  [127, 127, 1, 1],
  [0, 0, 1, 1],
  [52, 48, 24, 16],
];

let server: Server;
let baseUrl: string;
let narrative: ReturnType<typeof makeNarrativeState>["narrative"];
let validateAnchor: (data: unknown) => { ok: true } | { ok: false; error: string };

/** La raíz del repo, buscada HACIA ARRIBA y no con un salto fijo: el sandbox
 *  de Stryker vive dentro de `nefan-core/` a otra profundidad (mismo patrón que
 *  `raizDelRepo` de `entity-vocabulary.test.ts`). */
function raizDelRepo(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "narrative-mcp")) && existsSync(join(dir, "nefan-core"))) return dir;
    const arriba = dirname(dir);
    if (arriba === dir) break;
    dir = arriba;
  }
  throw new Error(`no encuentro la raíz del repo subiendo desde ${dirname(fileURLToPath(import.meta.url))}`);
}

before(async () => {
  // El pre-flight de la tool, tal cual lo carga narrative-mcp.
  ({ validateAnchor } = (await import(
    pathToFileURL(join(raizDelRepo(), "narrative-mcp", "validators.ts")).href
  )) as { validateAnchor: typeof validateAnchor });
  narrative = makeNarrativeState().narrative;
  narrative.startNewSession("plugtest");
  server = createStateHttpServer({
    aiServerUrl: "http://127.0.0.1:0",
    gatewayUrl: "ws://127.0.0.1:0",
    port: 0,
    narrative,
    // Las rutas de mapa no lo tocan; un NpcDirector real metería este test en
    // la batería de mutación de `npc-director`, que no puede matar nada aquí.
    npcDirector: {} as NpcDirector,
    gamesDir: fileURLToPath(new URL("../data/games", import.meta.url)),
    onMutation: async () => {},
    onProgress: () => {},
    onMapChanged: () => {},
    plugins: {
      register: () => {
        throw new Error("este test no registra plugins");
      },
      list: () => [],
      inspect: () => {
        throw new Error("este test no inspecciona plugins");
      },
    },
  });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

async function postLugar(id: string, rect: unknown): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}/map/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      kind: "settlement",
      parent_id: "world",
      name: `Lugar ${id}`,
      anchor: { tx: 0, ty: 0, rect },
    }),
  });
  return { status: res.status, body: await res.text() };
}

describe("el rect del anchor: tres puertas, un veredicto (#465)", () => {
  for (const { que, rect, dice } of MALOS) {
    it(`RECHAZA un rect ${que} en las tres puertas, diciendo qué cota falla`, async () => {
      const zod = AnchorSchema.safeParse({ tx: 0, ty: 0, rect });
      assert.equal(zod.success, false, "AnchorSchema lo dejó pasar");

      const tool = validateAnchor({ tx: 0, ty: 0, rect });
      assert.equal(tool.ok, false, "el pre-flight de map_upsert_place lo dejó pasar");
      assert.match(tool.ok ? "" : tool.error, dice);

      const http = await postLugar(`malo_${MALOS.findIndex((m) => m.que === que)}`, rect);
      assert.equal(http.status, 400, `POST /map/place contestó ${http.status}: ${http.body}`);
      assert.match(http.body, dice);
    });
  }

  for (const rect of BUENOS) {
    it(`ACEPTA ${JSON.stringify(rect)} en las tres puertas`, async () => {
      assert.equal(AnchorSchema.safeParse({ tx: 0, ty: 0, rect }).success, true);
      assert.deepEqual(validateAnchor({ tx: 0, ty: 0, rect }), { ok: true });
      const id = `bueno_${rect.join("_")}`;
      const http = await postLugar(id, rect);
      assert.equal(http.status, 200, http.body);
      assert.deepEqual(narrative.worldMap.get(id)?.anchor?.rect, rect);
    });
  }

  it("sin rect el anchor sigue valiendo: el lugar es el tile entero", () => {
    assert.deepEqual(validateAnchor({ tx: 3, ty: -2 }), { ok: true });
  });
});

/** Un mapa sano, construido por las mutaciones de `WorldMapManager` — que es
 *  como nace todo mapa que acaba en un fichero. */
function mapaSano() {
  const wm = new WorldMapManager(WorldMapManager.createEmpty());
  wm.upsertPlace({
    id: "aldea",
    kind: "settlement",
    parent_id: "world",
    name: "Aldea",
    anchor: { tx: 0, ty: 0, rect: [52, 48, 24, 16] },
  });
  wm.upsertPlace({ id: "molino", kind: "settlement", parent_id: "world", name: "Molino" });
  wm.addLink({ from: "aldea", to: "molino", kind: "road", edge: "east" });
  // Por JSON, como llega del disco: los opcionales `undefined` desaparecen.
  return JSON.parse(JSON.stringify(wm.serialize()));
}

describe("el world_map de un snapshot pasa por su zod (#578)", () => {
  it("un mapa construido por WorldMapManager pasa", () => {
    const r = WorldMapSchema.safeParse(mapaSano());
    assert.equal(r.success, true, r.success ? "" : r.error.message);
  });

  const roturas: Array<[string, (m: ReturnType<typeof mapaSano>) => void, RegExp]> = [
    ["un anchor con el rect fuera del tile", (m) => (m.places.aldea.anchor.rect = [120, 0, 20, 4]), /este/],
    ["un enlace a un lugar que no está", (m) => (m.links[0].to = "fantasma"), /fantasma/],
    ["un parent_id que no está", (m) => (m.places.molino.parent_id = "region_perdida"), /region_perdida/],
    ["la raíz que no está", (m) => (m.root_id = "otro_mundo"), /root_id/],
    ["el lugar activo que no está", (m) => (m.active_place_id = "nadie"), /active_place_id/],
    ["un lugar cuya clave no es su id", (m) => (m.places.molino.id = "otro"), /molino.*declara id.*otro/],
    ["otra versión del mapa", (m) => (m.schema_version = 99), /schema_version/],
    ["un lugar sin triggers", (m) => delete m.places.molino.triggers, /triggers/],
  ];
  for (const [que, romper, dice] of roturas) {
    it(`RECHAZA ${que}`, () => {
      const m = mapaSano();
      romper(m);
      const r = WorldMapSchema.safeParse(m);
      assert.equal(r.success, false, `WorldMapSchema dejó pasar ${que}`);
      assert.match(r.success ? "" : r.error.message, dice);
    });
  }

  it("y el snapshot entero lo rechaza: el mapa ya no entra como `record(unknown)`", () => {
    const snap = {
      schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
      game_id: "plugtest",
      world_doc_hash: "h",
      generated_at: "2026-09-24T00:00:00.000Z",
      world_map: mapaSano(),
      scenes: {
        tile_0_0: expandScenePrimitives({
          scene_id: "tile_0_0",
          scene_description: "Arranque",
          tile: { tx: 0, ty: 0 },
          biome: "grass",
          entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }],
        }),
      },
      entry_scene_id: "tile_0_0",
    };
    assert.equal(WorldSnapshotSchema.safeParse(snap).success, true, "control: el snapshot sano pasa");
    snap.world_map.places.aldea.anchor.rect = [10.5, 0, 4, 4];
    const r = WorldSnapshotSchema.safeParse(snap);
    assert.equal(r.success, false, "un rect fraccionario en el fichero entró en el snapshot");
    assert.match(r.success ? "" : r.error.message, /ENTERO/);
  });
});

/** La tool usa el pre-flight: que `validateAnchor` diga lo mismo que el bridge
 *  no sirve de nada si `map_upsert_place` deja de llamarlo (QA de BE, H3).
 *  Se mira en el ÁRBOL de `narrative-mcp/server.ts` —no por grafía—: dentro
 *  del manejador de `server.tool("map_upsert_place", …)` tiene que haber una
 *  llamada a `validateAnchor(anchor)` ANTES de la de `bridgePost`.
 *
 *  Lo que esto NO sujeta: que el resultado se USE (un `validateAnchor(anchor)`
 *  cuyo veredicto se ignore saldría verde); solo que la llamada está y va
 *  primero. Levantar el servidor MCP entero para una tool no compensa. */
describe("la tool map_upsert_place hace el pre-flight del anchor (#465)", () => {
  it("su manejador llama a validateAnchor(anchor) antes de reenviar al bridge", () => {
    const ruta = join(raizDelRepo(), "narrative-mcp", "server.ts");
    const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true);
    let manejador: ts.Node | null = null;
    const buscar = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "tool" &&
        n.arguments[0] &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        n.arguments[0].text === "map_upsert_place"
      ) {
        manejador = n.arguments[n.arguments.length - 1];
      }
      ts.forEachChild(n, buscar);
    };
    buscar(fuente);
    assert.ok(manejador, "no encuentro server.tool('map_upsert_place', …) en narrative-mcp/server.ts");
    const llamadas: Array<{ nombre: string; pos: number; args: string[] }> = [];
    const recoger = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        llamadas.push({ nombre: n.expression.text, pos: n.getStart(), args: n.arguments.map((a) => a.getText()) });
      }
      ts.forEachChild(n, recoger);
    };
    recoger(manejador!);
    const pre = llamadas.find((c) => c.nombre === "validateAnchor");
    const post = llamadas.find((c) => c.nombre === "bridgePost");
    assert.ok(pre, "map_upsert_place ya no llama a validateAnchor: el motor perdería el error temprano");
    assert.deepEqual(pre.args, ["anchor"], "validateAnchor no valida el anchor que recibe la tool");
    assert.ok(post, "map_upsert_place ya no reenvía al bridge (¿se movió la tool?)");
    assert.ok(pre.pos < post.pos, "validateAnchor corre DESPUÉS de reenviar al bridge");
  });
});
