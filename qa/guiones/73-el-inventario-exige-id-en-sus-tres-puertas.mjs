/** El inventario del jugador exige `id` en sus TRES puertas (#452).
 *
 *  `InventoryItem.id` es por lo que `inventory_remove` encuentra un ítem: uno
 *  sin `id` no se puede sacar nunca. Hasta #452 solo lo exigía el State API;
 *  un plugin podía dejar `{name:"x"}` en `player.inventory` por
 *  `PLAYER_WRITABLE`, y `loadSession` conservaba lo que trajera el save.
 *
 *  Aquí se juegan las tres puertas por el camino real, sin fixtures:
 *   1. STATE API — `POST /entity/player/inventory {item:{name:"x"}}` → 400
 *      nombrando `item.id` (ya existía; se canda que sigue).
 *   2. PLUGIN — un plugin de prueba (`qa_regalo`) entra por el DISCO del juego
 *      (`data/games/toledo_1200/plugins/`, copia efímera de la corrida) o, si la
 *      corrida no tiene disco propio (`--url`/`--adoptar`), por `plugin_register`.
 *      El motor (State API, el mismo cable de la tool MCP) siembra cuatro zonas
 *      con map triggers que le mandan un evento cada una; el jugador CAMINA:
 *        · zona 1: `push {name:"x"}` → el turno se aborta, el jugador lee el
 *          overlay «Un sistema del juego falló» con el nombre del sistema y sin
 *          códigos, y el inventario sigue vacío;
 *        · zona 2: `push {id:"x"}` (dos veces) → aterriza, sin overlay: es el
 *          caso que separa «exige id» de «rechaza todo push»;
 *        · zona 3: `push {id:""}` → rechazado (el `id` vacío no es un id);
 *        · zona 4: `set player.inventory = "no-es-un-array"` → rechazado (el
 *          gate mira cómo QUEDA el inventario, no la operación).
 *      Tras cada rechazo lo que había sigue intacto (transaccional).
 *   3. SAVE — la partida vuelve al título; el `state.json` del disco se
 *      corrompe con `[{id:"x"},{name:"x"}]`; el resume por el cable contesta
 *      `save_invalido` nombrando `player.inventory[1].id` (distinguible de
 *      `session_not_found`); pulsar «Reanudar» sobre la tarjeta vuelve al título
 *      con un error legible y sin mundo montado; restaurado el fichero, revive.
 *
 *  Probado en negativo (2026-09-05, QA de la PR #457): con `inventarioInvalido`
 *  devolviendo siempre `null` en `src/plugins/dispatcher.ts`, la zona 1 deja
 *  `{name:"x"}` en el inventario y no hay overlay → rojos en «zona 1: no
 *  aterriza nada» y «zona 1: el jugador VE que un sistema falló»; con la
 *  comprobación de `loadSession` anulada, el resume del save corrupto carga →
 *  rojo en «el resume contesta save_invalido…». El guion distingue el mundo
 *  con las tres puertas del mundo sin ellas.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server. Ni
 *  el plugin ni los triggers pasan por el LLM: son llamadas del motor al bridge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

const GAME_ID = "toledo_1200";
const API = URLS.state_api;

/** El plugin de prueba: deja en el inventario lo que le digan, tal cual. Sus
 *  fixtures pasan (el replay de fixtures solo compara el slice), así que el
 *  loader lo acepta: el gate del `id` vive en el tick, no en el alta. */
const QA_REGALO = {
  version: 1,
  name: "qa_regalo",
  description: "Plugin de prueba de QA (#452): deja en el inventario del jugador lo que le digan, tal cual.",
  origin: { author: "developer", rationale: "QA de #452: ejercer el gate del id del inventario desde un plugin" },
  slice: { schema: { type: "object", properties: { dados: { type: "number" } } }, initial: { dados: 0 } },
  reads: ["player.inventory"],
  writes: ["player.inventory"],
  events_consumed: [
    {
      type: "qa_regalo_sin_id",
      do: [
        { op: "push", path: "player.inventory", value: { $lit: { name: "x" } } },
        { op: "inc", path: "slice.dados", value: 1 },
      ],
    },
    {
      type: "qa_regalo_con_id",
      do: [
        { op: "push", path: "player.inventory", value: { $lit: { id: "x" } } },
        { op: "inc", path: "slice.dados", value: 1 },
      ],
    },
    {
      type: "qa_regalo_evento",
      do: [
        { op: "push", path: "player.inventory", value: "event.item" },
        { op: "inc", path: "slice.dados", value: 1 },
      ],
    },
    {
      type: "qa_inventario_set",
      do: [{ op: "set", path: "player.inventory", value: "event.items" }],
    },
  ],
  fixtures: [
    {
      before: { dados: 0 },
      event: { type: "qa_regalo_con_id" },
      context: { player: { inventory: [] } },
      after: { dados: 1 },
    },
  ],
};

/** Llamada al State API tal cual la hace narrative-mcp. */
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }
  return { status: res.status, body: json };
}

const plugins = async () => (await api("GET", "/plugins")).body?.plugins ?? [];
const inventario = async () => (await api("GET", "/entity/player/inventory")).body?.inventory ?? null;
const slice = async (id) => (await api("GET", `/plugins/${id}/inspect`)).body?.slice;

/** Un resume_session crudo por el cable del bridge, DESDE la página (la URL
 *  la da el propio juego, con sus overrides de query — mismo patrón que el
 *  guion 46). Devuelve el `session_started`. */
async function resumePorElCable(ctx, sessionId) {
  return ctx.page.evaluate(
    (sid) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar a resume_session`));
        };
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-73" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-73") return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    sessionId,
  );
}

/** Celda del tile en la que cae una posición de mundo. */
function celdaDe(scene, x, z) {
  const g = scene.terrain_grid;
  const [ox, oz] = g.origin;
  const m = g.meters_per_cell;
  return [Math.floor((x - ox) / m), Math.floor((z - oz) / m)];
}

/** El overlay de error, si está en pantalla. */
const overlayVisible = () => {
  const el = document.getElementById("narrative-loader");
  if (!el || !/visible/.test(el.className)) return null;
  return {
    titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
    detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
  };
};

export default async function (ctx) {
  // ── 0. El plugin de prueba entra por la puerta del DISCO del juego ───────
  // El runner copia `data/games` al disco efímero de la corrida y lo dice en
  // `QA_RUN_TMP`; ahí se deja el manifest ANTES de la partida nueva, que es
  // cuando el loader lee `data/games/{id}/plugins/*.json` (génesis). Contra un
  // stack ajeno no hay disco que tocar: entra por `plugin_register`, el otro
  // cable real del motor. El gate que se mide es el mismo (el tick).
  const tmp = process.env.QA_RUN_TMP;
  const puertaPlugin = tmp ? "disco" : "plugin_register";
  if (tmp) {
    const dir = join(tmp, "games", GAME_ID, "plugins");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "qa_regalo.json"), JSON.stringify(QA_REGALO, null, 2) + "\n", "utf8");
  }
  ctx.log(`el plugin de prueba entra por: ${puertaPlugin}`);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  const { sessionId } = await comenzar(ctx);

  let regalo;
  if (puertaPlugin === "disco") {
    const lista = await plugins();
    regalo = lista.find((p) => p.name === "qa_regalo");
    ctx.expect(
      "el plugin de prueba entra desde data/games/toledo_1200/plugins/ (origin developer)",
      regalo?.origin_author === "developer",
      JSON.stringify(lista.map((p) => `${p.name} (${p.origin_author})`)),
    );
  } else {
    const alta = await api("POST", "/plugins/register", { manifest: QA_REGALO });
    ctx.expect(
      "el plugin de prueba se registra por el cable del motor",
      alta.status === 200 && alta.body?.action === "created",
      `${alta.status} ${JSON.stringify(alta.body)}`,
    );
    regalo = alta.body?.id ? { id: alta.body.id } : undefined;
  }
  if (!regalo?.id) ctx.sinMedir(`el plugin de prueba no está activo en la partida (puerta ${puertaPlugin})`);

  // ── 1. Puerta STATE API ──────────────────────────────────────────────────
  const rechazo = await api("POST", "/entity/player/inventory", { item: { name: "x" } });
  ctx.expect(
    "State API: {item:{name:'x'}} → 400 nombrando item.id",
    rechazo.status === 400 && /item\.id: Required/.test(rechazo.body?.error ?? ""),
    `${rechazo.status} ${JSON.stringify(rechazo.body)}`,
  );
  const inv0 = await inventario();
  ctx.expect("…y no deja nada en el inventario", Array.isArray(inv0) && inv0.length === 0, JSON.stringify(inv0));

  // ── 2. Puerta PLUGIN: cuatro zonas que el jugador pisa ───────────────────
  const scene = await ctx.nefan("scene");
  const [, txs, tys] = scene.scene_id.match(/^tile_(-?\d+)_(-?\d+)$/) ?? [];
  const tx = Number(txs);
  const ty = Number(tys);
  ctx.expect("la partida arranca en un tile del plano continuo", Number.isFinite(tx), scene.scene_id);
  if (!Number.isFinite(tx)) ctx.sinMedir("sin tile no hay dónde anclar las zonas");

  // Rumbo despejado (misma colisión que frena al jugador), como el guion 14.
  const p0 = (await ctx.nefan("state")).pos;
  const rumbos = [
    { nombre: "norte", yaw: 0, ux: 0, uz: -1 },
    { nombre: "este", yaw: Math.PI / 2, ux: 1, uz: 0 },
    { nombre: "sur", yaw: Math.PI, ux: 0, uz: 1 },
    { nombre: "oeste", yaw: -Math.PI / 2, ux: -1, uz: 0 },
  ];
  let rumbo = null;
  for (const r of rumbos) {
    const libre = await ctx.page.evaluate(
      (d) => {
        for (let t = 0.5; t <= 24; t += 0.5) {
          if (window.__nefan.probeCollide(d.x + d.ux * t, d.z + d.uz * t)) return false;
        }
        return true;
      },
      { x: p0.x, z: p0.z, ux: r.ux, uz: r.uz },
    );
    if (libre) {
      rumbo = r;
      break;
    }
  }
  if (!rumbo) ctx.sinMedir("los cuatro rumbos chocan a menos de 24 m: no hay pasillo para las cuatro zonas");
  ctx.log(`rumbo despejado: ${rumbo.nombre}`);
  await ctx.nefan("setYaw", rumbo.yaw);

  // Zonas de 4 m de lado centradas a 4, 9, 14 y 19 m; el jugador anda 5 m por
  // tramo y para DENTRO de cada zona (≈5, 10, 15, 20) con 3 m de margen hasta
  // la siguiente.
  const PASO = 5;
  const zona = (dist) => {
    const [c, r] = celdaDe(scene, p0.x + rumbo.ux * dist, p0.z + rumbo.uz * dist);
    return [c - 4, r - 4, 8, 8];
  };
  const evento = (type, payload) => ({ type: "plugin_event", plugin_id: regalo.id, event_type: type, ...(payload ? { payload } : {}) });
  const zonas = [
    {
      id: "qa73_z1_sin_id",
      nombre: "zona 1: push {name:'x'}",
      consequences: [evento("qa_regalo_sin_id")],
      rechaza: true,
      inventarioDespues: [],
    },
    {
      id: "qa73_z2_con_id",
      nombre: "zona 2: push {id:'x'} ×2",
      consequences: [evento("qa_regalo_con_id"), evento("qa_regalo_con_id")],
      rechaza: false,
      inventarioDespues: [{ id: "x" }, { id: "x" }],
    },
    {
      id: "qa73_z3_id_vacio",
      nombre: "zona 3: push {id:''}",
      consequences: [evento("qa_regalo_evento", { item: { id: "" } })],
      rechaza: true,
      inventarioDespues: [{ id: "x" }, { id: "x" }],
    },
    {
      id: "qa73_z4_no_array",
      nombre: "zona 4: set inventory = string",
      consequences: [evento("qa_inventario_set", { items: "no-es-un-array" })],
      rechaza: true,
      inventarioDespues: [{ id: "x" }, { id: "x" }],
    },
  ];
  for (let i = 0; i < zonas.length; i++) {
    const z = zonas[i];
    const alta = await api("POST", "/map/place", {
      id: z.id,
      kind: "site",
      parent_id: null,
      name: z.nombre,
      description: z.nombre,
      anchor: { tx, ty, rect: zona(4 + PASO * i) },
      triggers: [{ id: `${z.id}_t`, when: { type: "player_entered" }, consequences: z.consequences }],
    });
    if (alta.status !== 200) ctx.sinMedir(`el motor no pudo sembrar ${z.id}: ${alta.status} ${JSON.stringify(alta.body)}`);
  }

  for (const z of zonas) {
    // Un overlay anterior se cierra como lo cierra el jugador: con su botón.
    if (await ctx.page.evaluate(overlayVisible)) {
      await ctx.page.click("#narrative-loader-dismiss");
      await ctx.waitFor("el overlay anterior se cierra", () => !document.getElementById("narrative-loader")?.className.includes("visible"), 5_000);
    }
    // El tile de bench trae un hostil que puede haber matado al jugador en el
    // tramo anterior (medido en la corrida manual del 05-09: «Bandido de
    // camino», HP 0). Un muerto no pisa zonas: se reaparece con R, como haría
    // quien juega, antes de andar el siguiente tramo. El HP del State API se
    // refresca con cada save, así que puede venir rancio: un R de más con el
    // jugador vivo no hace nada (el game loop solo lo aplica muerto).
    const hp = (await api("GET", "/entity/player")).body?.player?.health ?? 0;
    if (hp <= 0) {
      ctx.log(`${z.nombre}: el servidor da al jugador por muerto (hp=${hp}); reaparece con R antes de andar`);
      await ctx.nefan("inputDriver.queueRespawn");
    }
    const desde = (await ctx.nefan("state")).pos;
    await ctx.holdUntil(
      "up",
      `el jugador cruza la ${z.nombre}`,
      (a) => {
        const p = window.__nefan.state().pos;
        return Math.hypot(p.x - a.x, p.z - a.z) >= a.paso ? { x: p.x, z: p.z } : null;
      },
      40_000,
      { x: desde.x, z: desde.z, paso: PASO },
    );
    const { ocurrio, ultimo } = await ctx.expectEspera(
      `${z.nombre}: el jugador VE que un sistema del juego falló (overlay)`,
      z.rechaza,
      overlayVisible,
      { ms: 8_000, aserto: z.rechaza ? `${z.nombre}: el jugador VE que un sistema del juego falló` : `${z.nombre}: aterriza SIN overlay de error` },
    );
    if (z.rechaza && ocurrio) {
      ctx.expect(
        `${z.nombre}: el aviso nombra el sistema y habla de inventario, sin códigos ni rutas`,
        /qa_regalo/.test(ultimo.detalle) && /inventario/.test(ultimo.detalle) && !/write_invalid|player\.inventory|Required|\[\d+\]/.test(`${ultimo.titulo} ${ultimo.detalle}`),
        `«${ultimo.titulo}: ${ultimo.detalle}»`,
      );
    }
    const inv = await inventario();
    ctx.expect(
      z.rechaza ? `${z.nombre}: no aterriza nada (transaccional)` : `${z.nombre}: los ítems con id aterrizan`,
      JSON.stringify(inv) === JSON.stringify(z.inventarioDespues),
      `inventario=${JSON.stringify(inv)} esperado=${JSON.stringify(z.inventarioDespues)}`,
    );
    await ctx.shot(z.id);
  }
  const dados = await slice(regalo.id);
  ctx.expect(
    "el slice del plugin solo cuenta los turnos que aterrizaron (2), no los abortados",
    dados?.dados === 2,
    JSON.stringify(dados),
  );

  // ── 3. Puerta SAVE ───────────────────────────────────────────────────────
  // Al título: el bridge queda quieto y el fichero deja de reescribirse.
  await recargarAlTitulo(ctx);
  const ruta = rutaDelSave(sessionId);
  if (!ruta) {
    ctx.sinMedirBloque("la puerta del save exige el disco efímero de la corrida (stack adoptado: no se conoce su saves/)");
  } else {
    const original = readFileSync(ruta, "utf8");
    const conItemSinId = (() => {
      const data = JSON.parse(original);
      data.player.inventory = [{ id: "x" }, { name: "x" }];
      return JSON.stringify(data);
    })();
    writeFileSync(ruta, conItemSinId);

    const res1 = await resumePorElCable(ctx, sessionId);
    ctx.expect(
      "el resume de un save con un ítem sin id contesta save_invalido nombrando player.inventory[1].id",
      res1.ok === false && /^save_invalido:/.test(res1.error) && res1.error.includes("player.inventory[1].id: Required"),
      JSON.stringify(res1),
    );
    ctx.expect(
      "…con la salida que le queda a quien juega (#336: bórralo o partida nueva)",
      /bórralo o empieza partida nueva/.test(res1.error),
      res1.error,
    );
    const res2 = await resumePorElCable(ctx, "qa_fantasma_73");
    ctx.expect(
      "un save inexistente sigue siendo session_not_found (canal distinguible)",
      res2.ok === false && res2.error === "session_not_found",
      JSON.stringify(res2),
    );
    ctx.expect(
      "el fichero corrupto sigue intacto tras el intento (nadie lo reescribió ni lo «reparó»)",
      readFileSync(ruta, "utf8") === conItemSinId,
      ruta,
    );

    // JUGADOR: «Reanudar» sobre la tarjeta vuelve al título con un error legible.
    const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
    ctx.expect("el título ofrece la tarjeta del save (el jugador no sabe que está corrupto)", Boolean(tarjeta), sessionId);
    if (tarjeta) {
      await tarjeta.click();
      const aviso = await ctx.waitFor(
        "el título vuelve con un error visible",
        () => {
          const el = document.getElementById("ts-error");
          const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
          return visible ? el.textContent.trim() : null;
        },
        30_000,
      );
      ctx.log(`lo que lee el jugador: «${aviso}»`);
      ctx.expect(
        "…y lo que lee da la salida real (borrar o empezar de nuevo), no «inténtalo de nuevo»",
        /ya no vale/.test(aviso) && /bórrala|empieza una nueva/.test(aviso) && !/inténtalo/.test(aviso),
        aviso,
      );
      ctx.expect(
        "tras el intento no hay escena montada: el inventario corrupto no llegó al cliente",
        !(await ctx.nefan("status")).scene,
        JSON.stringify(await ctx.nefan("status")),
      );
      await ctx.shot("titulo-tras-reanudar-save-con-item-sin-id");
    }

    writeFileSync(ruta, original);
    const res4 = await resumePorElCable(ctx, sessionId);
    ctx.expect(
      "restaurado el fichero, el mismo resume carga (el rechazo era por el ítem, no por la ruta)",
      res4.ok === true,
      JSON.stringify(res4),
    );
  }
}
