/** El State API SIN servidor.
 *
 *  Es el criterio de aceptación de #225 hecho test: si una pieza del router
 *  necesita un puerto abierto para ejercerse, no está partida por concepto —
 *  está partida por líneas. Aquí no hay `createServer`, ni `fetch`, ni
 *  `AddressInfo`: se llama a `dispatchStateRequest` y a un handler de CADA
 *  concepto directamente. Lo mismo lo canda `handlers-sin-servidor` en
 *  data/contract/arch-rules.json, mirando los imports.
 *
 *  Y hace falta por una razón concreta: `bridge/` no está en el reparto de
 *  `data/contract/mutation-targets.json`, así que no hay score de mutación que
 *  demuestre por nosotros que estos tests se enterarían de un cambio. Lo único
 *  que SÍ se mide es `matchRoute` (módulo `state-http-dispatch`), que es la
 *  pieza capaz de desviar una ruta en silencio. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { makeNarrativeState } from "./helpers.js";
import { NpcDirector } from "../src/world-map/npc-director.js";
import { matchRoute, fillPath, normalizePath, type EndpointTable } from "../src/contracts/http.js";
import { WorldStateApi } from "../src/contracts/world-state.js";
import { dispatchStateRequest } from "../bridge/state-http/dispatch.js";
import { PLANNED_ROUTES, ROUTES, type RouteKey } from "../bridge/state-http/routes.js";
import type { RouteRequest, StateHttpContext } from "../bridge/state-http/context.js";
import { mapRoutes } from "../bridge/state-http/map-routes.js";
import { entityRoutes } from "../bridge/state-http/entity-routes.js";
import { npcRoutes } from "../bridge/state-http/npc-routes.js";
import { sceneRoutes } from "../bridge/state-http/scene-routes.js";
import { docRoutes } from "../bridge/state-http/doc-routes.js";
import { pluginRoutes } from "../bridge/state-http/plugin-routes.js";
import { sessionRoutes } from "../bridge/state-http/session-routes.js";

const GAMES_DIR = fileURLToPath(new URL("../data/games", import.meta.url));

/** Un contexto de handlers a pelo: ni servidor, ni puerto, ni sockets. */
/** A qué motor narrativo dice apuntar el bridge de estas pruebas. GET /health
 *  lo publica: es la vía de gasto que el `?ai=` del cliente nunca cubrió. */
const MOTOR_DE_PRUEBA = "http://127.0.0.1:18765";
/** Y con qué gateway está emparejada esa State API: la IDENTIDAD de la vía. */
const GATEWAY_DE_PRUEBA = "ws://127.0.0.1:9877";

function makeCtx(): { ctx: StateHttpContext; progreso: string[]; cambiosDeMapa: { n: number } } {
  const { narrative, storage } = makeNarrativeState();
  narrative.startNewSession("plugtest");
  const progreso: string[] = [];
  const cambiosDeMapa = { n: 0 };
  const ctx: StateHttpContext = {
    narrative,
    npcDirector: new NpcDirector(narrative),
    gamesDir: GAMES_DIR,
    sessionStorage: storage,
    aiServerUrl: MOTOR_DE_PRUEBA,
    gatewayUrl: GATEWAY_DE_PRUEBA,
    onProgress: (m) => progreso.push(m),
    onMapChanged: () => {
      cambiosDeMapa.n += 1;
    },
    plugins: {
      register: () => {
        throw new Error("no debería llamarse en este test");
      },
      list: () => [],
      inspect: (id) => {
        throw new Error(`plugin "${id}" not found`);
      },
    },
  };
  return { ctx, progreso, cambiosDeMapa };
}

/** El `RouteRequest` mínimo: la mayoría de handlers no miran query ni body. */
function req(over: Partial<RouteRequest> = {}): RouteRequest {
  return { params: {}, query: new URLSearchParams(), body: undefined, ...over };
}

/** Un body que nadie pide: si el despacho lo leyera en un GET, saltaría. */
const NO_LEER = () => Promise.reject(new Error("readBody no debería llamarse"));

describe("matchRoute · la inversa exacta de fillPath", () => {
  it("cada endpoint del contrato se reconoce desde el path que fillPath produce", () => {
    for (const [nombre, ep] of Object.entries(WorldStateApi)) {
      const params: Record<string, string> = {};
      for (const m of ep.path.matchAll(/\{(\w+)\}/g)) params[m[1]] = "abc";
      const match = matchRoute(WorldStateApi, ep.method, fillPath(ep.path, params));
      assert.ok(match, `${nombre}: ${ep.method} ${ep.path} no casa consigo mismo`);
      assert.equal(match.key, nombre);
      assert.deepEqual(match.params, params);
    }
  });

  it("el método forma parte de la identidad de la ruta", () => {
    assert.equal(matchRoute(WorldStateApi, "POST", "/vocabulary")?.key, "setVocabulary");
    assert.equal(matchRoute(WorldStateApi, "GET", "/vocabulary"), null);
    assert.equal(matchRoute(WorldStateApi, "DELETE", "/map"), null);
  });

  it("los segmentos son exactos: ni de más, ni vacíos, ni de menos", () => {
    assert.equal(matchRoute(WorldStateApi, "GET", "/map/place/x")?.params.id, "x");
    assert.equal(matchRoute(WorldStateApi, "GET", "/map/place/x/y"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "/map/place//x"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "/map/place/"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "/entity//boris"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "//health"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "/"), null);
  });

  it("las barras finales se recortan, una o varias", () => {
    for (const path of ["/health", "/health/", "/health///"]) {
      assert.equal(matchRoute(WorldStateApi, "GET", path)?.key, "health", path);
    }
    assert.equal(matchRoute(WorldStateApi, "GET", "/npc/boris/")?.params.id, "boris");
  });

  it("un literal gana a un {param} de la misma forma, esté antes o después", () => {
    // Precedencia probada con una tabla sintética: `WorldStateApi` no tiene
    // hoy una colisión así, y una regla que nunca se ejerce es folclore. Se
    // prueba en los DOS órdenes porque «gana el literal» y «gana el primero
    // que aparece» son indistinguibles con un solo orden.
    const paramPrimero = {
      porId: { method: "GET", path: "/npc/{id}" },
      enTransito: { method: "GET", path: "/npc/in_transit" },
    } as const satisfies EndpointTable;
    const literalPrimero = {
      enTransito: { method: "GET", path: "/npc/in_transit" },
      porId: { method: "GET", path: "/npc/{id}" },
    } as const satisfies EndpointTable;
    for (const tabla of [paramPrimero, literalPrimero]) {
      assert.equal(matchRoute(tabla, "GET", "/npc/in_transit")?.key, "enTransito");
      const otro = matchRoute(tabla, "GET", "/npc/boris");
      assert.equal(otro?.key, "porId");
      assert.deepEqual(otro?.params, { id: "boris" });
    }
  });

  it("los ids llegan sin decodificar, como los dejaba el router viejo", () => {
    // `fillPath` percent-codifica; decodificar aquí sería un cambio de
    // contrato disfrazado de refactor (y `%2F` partiría el path en dos).
    assert.equal(matchRoute(WorldStateApi, "GET", "/npc/a%20b")?.params.id, "a%20b");
  });

  it("un {param} VACÍO no cuela aunque los segmentos cuadren", () => {
    // Estos tres tienen la longitud EXACTA de su plantilla, así que la
    // comprobación de segmentos no los caza: es la guarda del segmento vacío
    // la que tiene que rebotarlos. Sin ella, el handler recibiría el id ""
    // y buscaría el npc "" o la entidad "" — un 400 de dominio en vez de un
    // 404, contestando por una URL que nadie pidió.
    assert.equal(matchRoute(WorldStateApi, "POST", "/npc//arrive"), null);
    assert.equal(matchRoute(WorldStateApi, "GET", "/entity//inventory"), null);
    assert.equal(matchRoute(WorldStateApi, "POST", "/scheduled_event//resolve"), null);
    // Y con el id puesto, las mismas tres sí casan.
    assert.equal(matchRoute(WorldStateApi, "POST", "/npc/boris/arrive")?.params.id, "boris");
    assert.equal(matchRoute(WorldStateApi, "GET", "/entity/boris/inventory")?.params.id, "boris");
    assert.equal(matchRoute(WorldStateApi, "POST", "/scheduled_event/s1/resolve")?.params.id, "s1");
  });

  it("un {param} ocupa el segmento ENTERO: `x{id}` es un literal", () => {
    // `fillPath` sustituye `{id}` en MEDIO de un segmento (su regex no está
    // anclada); `matchRoute` solo reconoce el segmento completo. Mientras
    // ningún endpoint escriba una plantilla así, las dos son inversas — y eso
    // se canda abajo sobre la tabla real. Aquí se fija la regla del matcher.
    const rara = { rara: { method: "GET", path: "/a/x{id}" } } as const satisfies EndpointTable;
    assert.equal(matchRoute(rara, "GET", "/a/xfoo"), null, "`x{id}` no es un parámetro");
    assert.deepEqual(matchRoute(rara, "GET", "/a/x{id}"), { key: "rara", params: {} });
    const cerrada = { c: { method: "GET", path: "/a/{id}x" } } as const satisfies EndpointTable;
    assert.equal(matchRoute(cerrada, "GET", "/a/foox"), null, "`{id}x` tampoco");
  });

  it("ningún endpoint del contrato escribe un {param} a medio segmento", () => {
    // El invariante que hace que fillPath y matchRoute sean inversas de
    // verdad. Si alguien declara "/a/x{id}", fillPath produciría "/a/xfoo" y
    // matchRoute no lo reconocería nunca: la ruta existiría en el contrato y
    // sería inalcanzable en el router, en verde.
    for (const [nombre, ep] of Object.entries(WorldStateApi)) {
      for (const seg of ep.path.split("/")) {
        if (!seg.includes("{")) continue;
        assert.match(seg, /^\{[^}]+\}$/, `${nombre}: el segmento "${seg}" de ${ep.path} no es un {param} entero`);
      }
    }
  });

  it("normalizePath recorta las barras finales y deja la raíz en pie", () => {
    assert.equal(normalizePath("/health"), "/health");
    assert.equal(normalizePath("/health/"), "/health");
    assert.equal(normalizePath("/health///"), "/health");
    assert.equal(normalizePath("/"), "/", "la raíz no puede quedar en cadena vacía");
    assert.equal(normalizePath("///"), "/");
    assert.equal(normalizePath("//health"), "//health", "las barras del PRINCIPIO no se tocan");
  });

  it("fillPath falla ruidosamente si le falta un param", () => {
    // La otra mitad del par: si esto se degradara a devolver la plantilla con
    // el `{id}` dentro, el cliente pediría literalmente `/npc/{id}` y se
    // comería un 404 sin saber por qué.
    assert.throws(
      () => fillPath("/npc/{id}/arrive", {}),
      /missing path param "id" for \/npc\/\{id\}\/arrive/,
    );
    assert.equal(fillPath("/npc/{id}", { id: "a b" }), "/npc/a%20b");
  });

  it("una tabla vacía no casa con nada (y no revienta)", () => {
    assert.equal(matchRoute({}, "GET", "/health"), null);
  });
});

describe("la tabla ROUTES está completa por construcción", () => {
  it("hay exactamente un handler por endpoint del contrato, salvo los PLANNED", () => {
    const contrato = Object.keys(WorldStateApi).filter((k) => !PLANNED_ROUTES.includes(k as never));
    assert.deepEqual(Object.keys(ROUTES).sort(), contrato.sort());
    assert.equal(contrato.length, 28);
    // El tipo `Record<RouteKey, RouteHandler>` es quien lo garantiza (un
    // endpoint sin handler NO COMPILA); esto solo lo hace visible en la
    // salida del test y caza un PLANNED_ROUTES que ya no lo esté.
    for (const planned of PLANNED_ROUTES) {
      assert.ok(planned in WorldStateApi, `PLANNED_ROUTES nombra "${planned}", que ya no está en el contrato`);
      assert.ok(!(planned in ROUTES), `"${planned}" ya tiene handler: sácalo de PLANNED_ROUTES`);
    }
  });

  it("cada handler responde por el concepto de su fichero", () => {
    const porFichero: Record<string, readonly string[]> = {
      "session-routes": Object.keys(sessionRoutes),
      "map-routes": Object.keys(mapRoutes),
      "entity-routes": Object.keys(entityRoutes),
      "npc-routes": Object.keys(npcRoutes),
      "scene-routes": Object.keys(sceneRoutes),
      "doc-routes": Object.keys(docRoutes),
      "plugin-routes": Object.keys(pluginRoutes),
    };
    const todos = Object.values(porFichero).flat();
    assert.equal(new Set(todos).size, todos.length, "un mismo endpoint lo sirven dos ficheros");
    assert.deepEqual(todos.sort(), Object.keys(ROUTES).sort());
  });
});

describe("handlers invocados a pelo, uno por concepto", () => {
  it("map: upsertPlace muta, marca el save y avisa del cambio de mapa; el cuerpo inválido rebota con 400", () => {
    const { ctx, cambiosDeMapa } = makeCtx();
    const creado = mapRoutes.upsertPlace(ctx, req({
      body: { id: "millhaven", kind: "settlement", parent_id: "world", name: "Millhaven" },
    }));
    assert.equal(creado.status, 200);
    assert.equal(creado.mutated, true);
    assert.equal(ctx.narrative.worldMap.get("millhaven")?.name, "Millhaven");
    // Las salidas del tile activo pueden haber cambiado (#179): se avisa UNA vez.
    assert.equal(cambiosDeMapa.n, 1);

    const malo = mapRoutes.upsertPlace(ctx, req({ body: { id: "x", kind: "teleport" } }));
    assert.equal(malo.status, 400);
    assert.equal(malo.mutated, undefined, "un 400 no puede persistir el save");
    assert.equal(cambiosDeMapa.n, 1, "un 400 tampoco toca el panel «Salidas»");
  });

  it("map: getPlace responde 404 sin tocar nada cuando el lugar no existe", () => {
    const { ctx } = makeCtx();
    const res = mapRoutes.getPlace(ctx, req({ params: { id: "nowhere" } }));
    assert.equal(res.status, 404);
    assert.match(String((res.body as { error: string }).error), /place "nowhere" not found/);
  });

  it("entity: el jugador tiene shape propio y una entidad desconocida es 404", () => {
    const { ctx } = makeCtx();
    const jugador = entityRoutes.getEntity(ctx, req({ params: { id: "player" } }));
    assert.equal(jugador.status, 200);
    assert.equal((jugador.body as { type: string }).type, "player");
    assert.equal(entityRoutes.getEntity(ctx, req({ params: { id: "fantasma" } })).status, 404);
  });

  it("entity: alta y baja de inventario mutan; la baja de lo que no hay es 404", () => {
    const { ctx } = makeCtx();
    ctx.narrative.recordEntitySpawned("boris", "npc", "s1", [0, 0, 0], { name: "Boris" });
    const alta = entityRoutes.addInventoryItem(ctx, req({
      params: { id: "boris" },
      body: { item: { id: "cerveza" } },
    }));
    assert.equal(alta.mutated, true);
    const baja = entityRoutes.removeInventoryItem(ctx, req({
      params: { id: "boris" },
      body: { item_id: "cerveza" },
    }));
    assert.equal(baja.mutated, true);
    const otraVez = entityRoutes.removeInventoryItem(ctx, req({
      params: { id: "boris" },
      body: { item_id: "cerveza" },
    }));
    assert.equal(otraVez.status, 404);
    assert.equal(otraVez.mutated, undefined);
  });

  it("npc: el viaje y la llegada mutan; un npc que no existe es 400 con motivo", () => {
    const { ctx } = makeCtx();
    ctx.narrative.worldMap.upsertPlace({ id: "bosque", kind: "landmark", parent_id: "world", name: "Bosque" });
    ctx.narrative.recordEntitySpawned("boris", "npc", "s1", [0, 0, 0], { name: "Boris" });
    const viaje = npcRoutes.moveNpcToPlace(ctx, req({
      params: { id: "boris" },
      body: { place_id: "bosque" },
    }));
    assert.equal(viaje.mutated, true);
    assert.equal(npcRoutes.npcsInTransit(ctx, req()).status, 200);
    const llegada = npcRoutes.arriveNpc(ctx, req({ params: { id: "boris" } }));
    assert.equal(llegada.mutated, true);
    assert.equal(ctx.npcDirector.getNpcPlace("boris")?.current_place_id, "bosque");

    const fantasma = npcRoutes.arriveNpc(ctx, req({ params: { id: "nadie" } }));
    assert.equal(fantasma.status, 400);
    assert.match(String((fantasma.body as { error: string }).error), /npc "nadie" not found/);
  });

  it("scene: validar NO muta, y el contexto de costuras lo construye el server", () => {
    const { ctx } = makeCtx();
    const tile = {
      scene_id: "tile_0_0",
      scene_description: "Un claro con una posada.",
      tile: { tx: 0, ty: 0 },
      biome: "forest_floor",
      entities: [
        { id: "player", kind: "player", name: "Tú", cell: [15, 80], footprint: [1, 1], glyph: "@" },
      ],
    };
    const res = sceneRoutes.validateScene(ctx, req({ body: { scene: tile } }));
    assert.equal(res.status, 200);
    assert.equal(res.mutated, undefined, "el pre-flight del motor no puede escribir el save");
    assert.equal((res.body as { ok: boolean }).ok, true, JSON.stringify(res.body));
  });

  it("scene: registrar refs de una escena que no existe es 404, no un 200 vacío", () => {
    const { ctx } = makeCtx();
    const res = sceneRoutes.appendSceneAssetRefs(ctx, req({
      body: { scene_id: "no_existe", refs: ["h1"] },
    }));
    assert.equal(res.status, 404);
    assert.equal(res.mutated, undefined);
  });

  it("doc: la agenda del director resuelve, y un id desconocido lista los pendientes", () => {
    const { ctx } = makeCtx();
    const id = ctx.narrative.addScheduledEvent("Vira se entera", "al volver", "evt_1");
    const res = docRoutes.resolveScheduledEvent(ctx, req({ params: { id } }));
    assert.equal(res.mutated, true);
    assert.equal((res.body as { remaining: number }).remaining, 0);

    const otro = docRoutes.resolveScheduledEvent(ctx, req({ params: { id: "sched_9999" } }));
    assert.equal(otro.status, 404);
    assert.match(String((otro.body as { error: string }).error), /pending ids/);
  });

  it("doc: sin sesión activa, la crónica no existe", () => {
    const { ctx } = makeCtx();
    ctx.narrative.session_id = null;
    const res = docRoutes.getStory(ctx, req());
    assert.equal(res.status, 404);
    assert.match(String((res.body as { error: string }).error), /no active session/);
  });

  it("plugin: inspeccionar lo que no existe es 400 con el motivo, no una lista vacía", () => {
    const { ctx } = makeCtx();
    const res = pluginRoutes.inspectPlugin(ctx, req({ params: { id: "deadbeef" } }));
    assert.equal(res.status, 400);
    assert.match(String((res.body as { error: string }).error), /deadbeef/);
  });

  it("plugin: inspect pasa la `view` del query al hook", () => {
    const { ctx } = makeCtx();
    let vista: string | undefined = "sin-llamar";
    ctx.plugins.inspect = (_id, view) => {
      vista = view;
      return { available_views: [] } as never;
    };
    pluginRoutes.inspectPlugin(ctx, req({
      params: { id: "p1" },
      query: new URLSearchParams("view=marcador"),
    }));
    assert.equal(vista, "marcador");
    pluginRoutes.inspectPlugin(ctx, req({ params: { id: "p1" } }));
    assert.equal(vista, undefined, "sin ?view= el hook recibe undefined, no una cadena vacía");
  });

  it("session: el latido se trunca a 300 chars antes de difundirse", () => {
    const { ctx, progreso } = makeCtx();
    const res = sessionRoutes.narrativeProgress(ctx, req({ body: { message: "x".repeat(500) } }));
    assert.equal(res.status, 200);
    assert.equal(res.mutated, undefined, "un latido no es una mutación del mundo");
    assert.equal(progreso[0].length, 300);
  });

  it("session: sin sessionStorage, la keep-list NO existe (null, no una lista vacía)", async () => {
    const { ctx } = makeCtx();
    ctx.sessionStorage = undefined;
    assert.equal(await sessionRoutes.getAssetRefs(ctx, req()), null);
  });
});

describe("dispatchStateRequest · sesión, ruta y body, sin abrir un puerto", () => {
  it("la guarda de sesión se aplica UNA vez y antes de mirar la ruta", async () => {
    const { ctx } = makeCtx();
    // Incluso una ruta que NO existe rebota por sesión: si la guarda viviera
    // dentro de los handlers, esto sería un 404 y el agujero estaría abierto.
    for (const url of ["/story", "/map/place", "/ruta/que/no/existe"]) {
      const res = await dispatchStateRequest(ctx, {
        method: "GET",
        url,
        session: "sesion-pisada",
        readBody: NO_LEER,
      });
      assert.equal(res.status, 409, url);
      const body = res.body as { ok: boolean; error: string };
      assert.equal(body.ok, false, `${url}: un 409 no puede ir marcado como ok`);
      assert.match(body.error, /session_mismatch/);
    }
  });

  it("el 409 dice LAS DOS sesiones y qué hacer, que es para lo que existe", async () => {
    // El mensaje ES el producto: lo lee el motor narrativo, y de él depende
    // que se pare en vez de seguir escribiendo en el save equivocado. Si se
    // degradara a "session_mismatch:" a secas, el status seguiría siendo 409
    // y el motor no sabría ni de qué sesión se trata ni que debe abandonar.
    const { ctx } = makeCtx();
    const res = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/story",
      session: "sesion-pisada",
      readBody: NO_LEER,
    });
    const error = String((res.body as { error: string }).error);
    assert.match(error, /la petición pertenece a la sesión sesion-pisada/);
    assert.match(error, new RegExp(`sesión activa del bridge es ${ctx.narrative.session_id}`));
    assert.match(error, /start\/resume_session/);
    assert.match(error, /NO sigas leyendo ni mutando estado/);
    assert.match(error, /deja caducar la petición sin responder/);
  });

  it("/health es el único exento de la guarda, y la sesión correcta pasa", async () => {
    const { ctx } = makeCtx();
    const salud = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/health",
      session: "sesion-pisada",
      readBody: NO_LEER,
    });
    assert.equal(salud.status, 200);
    // Y publica A QUÉ MOTOR habla el bridge (criterio 5 bis): sin esto, la
    // única vía de gasto observable desde fuera era el `?ai=` del cliente, y
    // las escenas las pide el bridge por su cuenta.
    assert.equal((salud.body as { ai_server_url?: string }).ai_server_url, MOTOR_DE_PRUEBA);
    // Y de QUIÉN es esa respuesta: sin `gateway_url`, la State API del bloque
    // base podía avalar a un bridge que la página no estaba usando.
    assert.equal((salud.body as { gateway_url?: string }).gateway_url, GATEWAY_DE_PRUEBA);
    const propia = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/story",
      session: ctx.narrative.session_id ?? "",
      readBody: NO_LEER,
    });
    assert.equal(propia.status, 200);
  });

  it("sin cabecera de sesión —o con ella vacía— no hay guarda", async () => {
    const { ctx } = makeCtx();
    for (const session of [undefined, ""]) {
      const res = await dispatchStateRequest(ctx, {
        method: "GET",
        url: "/story",
        session,
        readBody: NO_LEER,
      });
      assert.equal(res.status, 200);
    }
  });

  it("un GET no lee el body: el cuerpo de la petición ni se toca", async () => {
    const { ctx } = makeCtx();
    const res = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/health",
      readBody: NO_LEER,
    });
    assert.equal(res.status, 200);
  });

  it("un POST lee el body UNA vez y se lo pasa al handler", async () => {
    const { ctx } = makeCtx();
    let lecturas = 0;
    const res = await dispatchStateRequest(ctx, {
      method: "POST",
      url: "/map/place",
      readBody: () => {
        lecturas += 1;
        return Promise.resolve({ id: "millhaven", kind: "settlement", parent_id: "world", name: "Millhaven" });
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.mutated, true);
    assert.equal(lecturas, 1);
  });

  it("si leer el body falla, el error SALE: no se despacha con basura dentro", async () => {
    const { ctx } = makeCtx();
    await assert.rejects(
      dispatchStateRequest(ctx, {
        method: "POST",
        url: "/map/place",
        readBody: () => Promise.reject(new Error("invalid JSON body")),
      }),
      /invalid JSON body/,
    );
    assert.equal(ctx.narrative.worldMap.get("millhaven"), undefined);
  });

  it("el query llega al handler ya parseado", async () => {
    const { ctx } = makeCtx();
    let vista: string | undefined;
    ctx.plugins.inspect = (_id, view) => {
      vista = view;
      return { available_views: [] } as never;
    };
    await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/plugins/p1/inspect?view=marcador",
      readBody: NO_LEER,
    });
    assert.equal(vista, "marcador");
  });

  it("ruta desconocida y endpoint PLANNED caen al mismo 404 genérico", async () => {
    const { ctx } = makeCtx();
    const inventada = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/no/such/route",
      readBody: NO_LEER,
    });
    assert.equal(inventada.status, 404);
    const cuerpo = inventada.body as { ok: boolean; error: string };
    assert.equal(cuerpo.ok, false, "un 404 no puede ir marcado como ok");
    assert.equal(cuerpo.error, "no route for GET /no/such/route");

    // getLlmContext está en el contrato y en PLANNED_ROUTES: sin handler,
    // contesta como si no existiera, igual que antes del corte.
    const planeada = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/session/abc/llm_context",
      readBody: NO_LEER,
    });
    assert.equal(planeada.status, 404);
    assert.match(String((planeada.body as { error: string }).error), /^no route for GET/);
  });

  it("una ruta no montada (sin sessionStorage) contesta el mismo 404 que una inexistente", async () => {
    const { ctx } = makeCtx();
    ctx.sessionStorage = undefined;
    const res = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/sessions/asset_refs",
      readBody: NO_LEER,
    });
    assert.equal(res.status, 404);
    assert.equal((res.body as { error: string }).error, "no route for GET /sessions/asset_refs");
  });

  it("el 404 nombra el path YA normalizado, no el crudo — y la raíz sigue siendo /", async () => {
    const { ctx } = makeCtx();
    const conCola = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/no/such/route/?a=1",
      readBody: NO_LEER,
    });
    assert.equal((conCola.body as { error: string }).error, "no route for GET /no/such/route");
    // La raíz es el caso que distingue «recortar las barras» de «dejar el
    // path en cadena vacía»: sin el suelo, el error diría "no route for GET ".
    const raiz = await dispatchStateRequest(ctx, { method: "GET", url: "/", readBody: NO_LEER });
    assert.equal((raiz.body as { error: string }).error, "no route for GET /");
  });

  it("la exención de /health sobrevive a las barras finales", async () => {
    // Si el despacho recortara UNA barra y el matcher TODAS, `/health//`
    // sería /health para la ruta y otra cosa para la guarda de sesión: la
    // petición de diagnóstico rebotaría con 409 justo cuando hace falta.
    const { ctx } = makeCtx();
    for (const url of ["/health", "/health/", "/health///"]) {
      const res = await dispatchStateRequest(ctx, {
        method: "GET",
        url,
        session: "sesion-pisada",
        readBody: NO_LEER,
      });
      assert.equal(res.status, 200, `${url} no quedó exento de la guarda`);
    }
  });

  it("el flag `mutated` viaja intacto del handler al borde", async () => {
    // Es lo único que dispara la escritura del save; que el despacho lo
    // pierda por el camino no cambiaría ninguna respuesta.
    const { ctx } = makeCtx();
    const lectura = await dispatchStateRequest(ctx, {
      method: "GET",
      url: "/health",
      readBody: NO_LEER,
    });
    assert.equal(lectura.mutated, undefined);
    const escritura = await dispatchStateRequest(ctx, {
      method: "POST",
      url: "/scheduled_event/" + ctx.narrative.addScheduledEvent("algo", undefined, "e1") + "/resolve",
      readBody: () => Promise.resolve({}),
    });
    assert.equal(escritura.mutated, true);
  });
});

/** Comprobación de tipo, no de runtime: si algún día un endpoint del contrato
 *  se queda sin handler, esta línea deja de compilar antes de que ningún test
 *  llegue a correr. Es la garantía puesta en el tipo, no en un aserto. */
const _exhaustiva: Record<RouteKey, unknown> = ROUTES;
void _exhaustiva;
