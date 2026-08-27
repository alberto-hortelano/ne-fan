/** El motor evoluciona un sistema a mitad de partida y el jugador NO pierde
 *  lo que tenía (issue #164).
 *
 *  Un plugin es un sistema de juego completo —comercio, reputación— que el
 *  motor narrativo puede crear y hacer EVOLUCIONAR sin recargar la partida.
 *  Hasta #164, un `plugin_register` con la versión siguiente no migraba:
 *  añadía un SEGUNDO sistema con el mismo nombre y el slice de cero. Traducido
 *  a lo que le pasa a quien juega: el mercado en el que acaba de comprar se
 *  queda huérfano, su stock desaparece del sistema vigente y los dos
 *  ejemplares del plugin se suscriben al mismo evento.
 *
 *  Aquí se juega ese caso ENTERO por el camino real, sin fixtures:
 *   1. partida nueva de `toledo_1200`, que trae `commerce` v1 en disco;
 *   2. el motor (State API, el mismo cable de la tool MCP) siembra TRES
 *      zonas con map triggers: la primera paga al jugador, abre el mercado y
 *      le vende una espada;
 *   3. el jugador CAMINA hasta la zona: oro y espada cambian de verdad;
 *   4. el motor evoluciona `commerce` a v2 (`plugin_register`) — a mitad de
 *      partida, con el mercado ya usado;
 *   5. el jugador camina a la segunda zona y vuelve a comprar;
 *   6. y a la TERCERA, cuyo trigger se escribió antes de la migración.
 *
 *  Lo que se afirma es lo que nota quien juega: hay UN comercio y no dos, el
 *  stock recuerda la compra anterior, el oro se cobra UNA vez por compra, y el
 *  inventario sigue teniendo lo comprado antes de la migración. Los rechazos
 *  (salto sin `migrate`, degradación) tienen que dejar la partida como estaba.
 *
 *  NACIÓ EN ROJO por el paso 6, y se arregló en la vuelta de QA: migrar cambia
 *  el `plugin_id` —es el hash del manifest— y los que el motor dejó escritos en
 *  los map triggers del save quedaban apuntando a un plugin que ya no existía;
 *  el jugador llegaba al mismo tenderete, no podía comprar y se comía un
 *  overlay con `unknown_plugin` y un hash de 64 caracteres. Ahora el record
 *  guarda su dirección anterior (`superseded_ids`) y el id viejo sigue llegando
 *  al sistema vigente, y un evento que NO se puede entregar se salta sin
 *  llevarse por delante el resto del turno.
 *
 *  Probado en negativo contra `main` (los seis ficheros de producción de la PR
 *  revertidos): 12 asertos en rojo, incluidos «un solo comercio», «la segunda
 *  espada se cobra una vez» y los tres rechazos, que en main devuelven 200. Y
 *  los dos asertos del paso 6, en negativo por separado: sin la dirección de
 *  reenvío la daga no se compra; sin el salto del evento no entregable vuelve
 *  el overlay; y con el mensaje crudo vuelve el `unknown_plugin` en pantalla.
 *
 *  Dos cosas del ARMAZÓN (no de los asertos) se ajustaron cuando el paso 6
 *  empezó a funcionar de verdad, porque estaban calibradas contra un paso 6 que
 *  no hacía nada: los tramos que anda el jugador (8 m → 6 m, o el segundo se
 *  comía ya la tercera zona) y la foto de referencia de los rechazos, que ahora
 *  se toma justo antes de ellos en vez de dos paradas atrás.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 *  El `plugin_register` no pasa por el LLM: es una llamada del motor al bridge.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const aisla = ["saves"];

const GAME_ID = "toledo_1200";
/** El State API del bridge. Sale de la fuente única de puertos, no de un
 *  literal: dos corridas a la vez no comparten stack. */
const API = URLS.state_api;

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

const plugins = async () => (await api("GET", "/plugins")).body.plugins ?? [];
const jugador = async () => (await api("GET", "/entity/player")).body.player ?? {};
const slice = async (id) => (await api("GET", `/plugins/${id}/inspect`)).body?.slice;

/** commerce v2: MISMO name, versión siguiente y cadena `migrate` que conserva
 *  los mercados (el stock que el jugador ya movió) y estrena el fiado. */
function commerceV2(v1) {
  return {
    version: 2,
    name: "commerce",
    description:
      "Comercio v2: además de vender con stock y oro, el mercader fía. " +
      "El slice conserva los mercados de la v1 y añade el contador de fiado.",
    origin: { author: "narrative_engine", rationale: "el herrero empieza a fiar a los conocidos" },
    slice: {
      schema: { type: "object", properties: { markets: { type: "object" }, fiado: { type: "number" } } },
      initial: { markets: {}, fiado: 0 },
    },
    reads: v1.reads,
    writes: v1.writes,
    events_consumed: [
      ...v1.events_consumed,
      {
        type: "fiar",
        when: { op: "has", path: "event.amount" },
        do: [{ op: "inc", path: "slice.fiado", value: "event.amount" }],
      },
    ],
    events_produced: v1.events_produced,
    projections: v1.projections,
    derived_views: v1.derived_views,
    migrate: { 1: [{ op: "set", path: "slice.fiado", value: 0 }] },
    fixtures: v1.fixtures,
  };
}

/** Celda del tile en la que cae una posición de mundo (tiles de 64 m a 0,5 m
 *  por celda; el origen lo declara la propia escena). */
function celdaDe(scene, x, z) {
  const g = scene.terrain_grid;
  const [ox, oz] = g.origin;
  const m = g.meters_per_cell;
  return [Math.floor((x - ox) / m), Math.floor((z - oz) / m)];
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);

  const scene = await ctx.nefan("scene");
  const [, txs, tys] = scene.scene_id.match(/^tile_(-?\d+)_(-?\d+)$/) ?? [];
  const tx = Number(txs);
  const ty = Number(tys);
  ctx.expect("la partida arranca en un tile del plano continuo", Number.isFinite(tx), scene.scene_id);
  if (!Number.isFinite(tx)) return;

  // ── 1. El juego trae su sistema de comercio de disco ────────────────────
  const iniciales = await plugins();
  ctx.log(`plugins de la partida: ${iniciales.map((p) => `${p.name} v${p.version} (${p.origin_author})`).join(", ")}`);
  const c1 = iniciales.find((p) => p.name === "commerce");
  ctx.expect("toledo_1200 arranca con el sistema de comercio del juego", !!c1, JSON.stringify(iniciales));
  if (!c1) return;
  ctx.expect("…y es el del disco (origin developer)", c1.origin_author === "developer", c1.origin_author);
  // El oro de partida es 0. Quien lo mueve es un sistema aparte: `economy`,
  // que el juego trae en `data/plugins/` (común a todos los mundos). Este
  // sistema de pega se registra igualmente por el MISMO cable que usaría el
  // motor para crear uno nuevo —ejerce el desenlace `created` en una sesión de
  // verdad— pero cobra por un evento SUYO (`qa_jornal`): `economy` consume
  // `gold_granted` y escribe en `player.gold`, así que compartir el tipo de
  // evento haría que el jugador cobrara DOS veces la misma jornada. Es la
  // otra cara del multi-consumer por `type` de §7.4: la deseable cuando dos
  // sistemas deben reaccionar a lo mismo, y la trampa cuando no.
  const arcas = {
    version: 1,
    name: "qa_arcas",
    description: "Arcas del jugador: alguien le paga y el oro sube.",
    origin: { author: "narrative_engine", rationale: "el alarife paga la jornada" },
    slice: { schema: { type: "object", properties: { cobrado: { type: "number" } } }, initial: { cobrado: 0 } },
    reads: ["player.gold"],
    writes: ["player.gold"],
    events_consumed: [
      {
        type: "qa_jornal",
        when: { op: "gt", path: "event.amount", value: 0 },
        do: [
          { op: "inc", path: "player.gold", value: "event.amount" },
          { op: "inc", path: "slice.cobrado", value: "event.amount" },
        ],
      },
    ],
    fixtures: [
      {
        before: { cobrado: 0 },
        event: { type: "qa_jornal", amount: 10 },
        context: { player: { gold: 0 } },
        after: { cobrado: 10 },
      },
    ],
  };
  const altaArcas = await api("POST", "/plugins/register", { manifest: arcas });
  ctx.expect(
    "el motor puede crear un sistema nuevo en caliente",
    altaArcas.status === 200 && altaArcas.body?.action === "created",
    `${altaArcas.status} ${JSON.stringify(altaArcas.body)}`,
  );
  const eco = { id: altaArcas.body?.id };
  if (!eco.id) return;
  // El manifest que el juego trae en disco: la v2 se construye SOBRE él, como
  // haría el motor (que lo tiene delante en `plugin_inspect`).
  const v1Manifest = JSON.parse(
    readFileSync(join(repoRoot, "nefan-core/data/games/toledo_1200/plugins/commerce.json"), "utf-8"),
  );

  // ── 2. El motor siembra dos zonas con sus consecuencias ─────────────────
  // Hacia dónde puede andar: se mira el terreno del propio juego
  // (`probeCollide`, la misma colisión que frena al jugador) y se elige el
  // primer rumbo con 26 m despejados. Sin esto, el guion sería una moneda al
  // aire sobre dónde le tocó nacer al jugador en el tile generado.
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
      async (d) => {
        for (let t = 0.5; t <= 26; t += 0.5) {
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
  ctx.expect("el jugador tiene por dónde caminar en el tile de entrada", !!rumbo, "los cuatro rumbos chocan a menos de 26 m");
  if (!rumbo) return;
  ctx.log(`rumbo despejado: ${rumbo.nombre}`);
  await ctx.nefan("setYaw", rumbo.yaw);
  const dir = { x: p0.x, z: p0.z };
  const { ux, uz } = rumbo;
  const banda = (dist, ancho) => {
    const cx = dir.x + ux * dist;
    const cz = dir.z + uz * dist;
    const [c, r] = celdaDe(scene, cx, cz);
    const half = Math.round(ancho / 2);
    return { rect: [c - half, r - half, half * 2, half * 2], cx, cz };
  };
  const zonaA = banda(4, 12); // ~6 m de lado, centrada 4 m por delante
  const zonaB = banda(12, 12); // la siguiente, 8 m más allá
  const zonaC = banda(20, 12); // la tercera, sembrada YA con el id de la v1
  // Cuánto anda el jugador en cada tramo. Las zonas ocupan [1,7], [9,15] y
  // [17,23] m; con tramos de 8 m el jugador acababa el SEGUNDO tramo en ~17 m,
  // o sea pisando ya la tercera zona, y la daga se compraba una parada antes
  // de tiempo. No se veía mientras el trigger de la tercera zona estaba roto
  // (el id viejo abortaba el tick): en cuanto empezó a funcionar, dos asertos
  // se pusieron rojos por solaparse los tramos, no por el sistema. Con 6 m
  // cada tramo muere DENTRO de su zona (≈6, ≈12, ≈18) y le sobran casi 5 m
  // hasta la siguiente.
  const PASO = 6;

  const mercado = "qa_herreria";
  await api("POST", "/map/place", {
    id: "qa_zona_mercado",
    kind: "site",
    parent_id: null,
    name: "Puesto del herrero",
    description: "Un tenderete con hierro colgado de una cuerda.",
    anchor: { tx, ty, rect: zonaA.rect },
    triggers: [
      {
        id: "qa_compra_1",
        when: { type: "player_entered" },
        consequences: [
          { type: "plugin_event", plugin_id: eco.id, event_type: "qa_jornal", payload: { amount: 100, reason: "paga del alarife" } },
          {
            type: "plugin_event",
            plugin_id: c1.id,
            event_type: "market_open",
            payload: { market_id: mercado, name: "Herrería de Yusuf", stock: { espada_ropera: 3, daga: 2 } },
          },
          {
            type: "plugin_event",
            plugin_id: c1.id,
            event_type: "trade_offered",
            payload: { market_id: mercado, item_id: "espada_ropera", price: 20 },
          },
        ],
      },
    ],
  });

  // Tercera zona, sembrada AHORA (commerce va por la v1) y pisada DESPUÉS de
  // que el motor evolucione el sistema. Es el caso corriente: el motor deja
  // triggers escritos por el mapa y sigue narrando; cuando el jugador llega,
  // el sistema al que apuntan puede haber cambiado de versión. El `plugin_id`
  // de la consequence es el de la v1, porque cuando se escribió no había otro.
  await api("POST", "/map/place", {
    id: "qa_zona_mercado_3",
    kind: "site",
    parent_id: null,
    name: "El herrero, más tarde",
    description: "El mismo tenderete, ya de vuelta.",
    anchor: { tx, ty, rect: zonaC.rect },
    triggers: [
      {
        id: "qa_compra_3",
        when: { type: "player_entered" },
        consequences: [
          {
            type: "plugin_event",
            plugin_id: c1.id,
            event_type: "trade_offered",
            payload: { market_id: mercado, item_id: "daga", price: 10 },
          },
        ],
      },
    ],
  });

  const antesDeAndar = await jugador();
  ctx.log(`jugador antes de pisar la zona: oro=${antesDeAndar.gold} inventario=${JSON.stringify(antesDeAndar.inventory)}`);

  // ── 3. El jugador CAMINA hasta la zona y compra ─────────────────────────
  await ctx.holdUntil(
    "up",
    "el jugador cruza el puesto del herrero",
    (a) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - a.x, p.z - a.z) >= a.paso ? { x: p.x, z: p.z } : null;
    },
    40_000,
    { x: dir.x, z: dir.z, paso: PASO },
  );
  await ctx.shot("tras-cruzar-el-mercado");

  const trasCompra = await jugador();
  const sliceV1 = await slice(c1.id);
  ctx.log(`tras la compra: oro=${trasCompra.gold} inventario=${JSON.stringify(trasCompra.inventory)} slice=${JSON.stringify(sliceV1)}`);
  ctx.expect(
    "pisar el puesto paga al jugador y le cobra la espada (100 − 20)",
    trasCompra.gold === (antesDeAndar.gold ?? 0) + 80,
    `oro=${trasCompra.gold} (antes ${antesDeAndar.gold})`,
  );
  ctx.expect(
    "la espada entra en el inventario",
    (trasCompra.inventory ?? []).some((i) => i.id === "espada_ropera"),
    JSON.stringify(trasCompra.inventory),
  );
  ctx.expect(
    "el mercado descuenta el stock (3 → 2)",
    sliceV1?.markets?.[mercado]?.stock?.espada_ropera === 2,
    JSON.stringify(sliceV1),
  );
  const oroTrasCompra = trasCompra.gold;

  // ── 4. El motor evoluciona el sistema a mitad de partida ────────────────
  const v2 = commerceV2(v1Manifest);
  const alta = await api("POST", "/plugins/register", { manifest: v2 });
  ctx.log(`plugin_register v2 → ${alta.status} ${JSON.stringify(alta.body)}`);
  ctx.expect("el motor puede evolucionar el sistema en caliente", alta.status === 200, JSON.stringify(alta.body));
  ctx.expect("…y el bridge lo declara migración, no alta nueva", alta.body?.action === "migrated", JSON.stringify(alta.body));
  ctx.expect("…diciendo de qué versión venía", alta.body?.from_version === 1, JSON.stringify(alta.body));
  ctx.expect(
    "…y avisando de que el sistema era del disco (el commerce.json queda inerte)",
    alta.body?.from_origin_author === "developer",
    JSON.stringify(alta.body),
  );

  const trasMigrar = await plugins();
  const comercios = trasMigrar.filter((p) => p.name === "commerce");
  ctx.expect(
    "queda UN solo comercio, no dos (el bug de #164)",
    comercios.length === 1,
    JSON.stringify(trasMigrar.map((p) => `${p.name} v${p.version}`)),
  );
  ctx.expect("…y es la versión nueva", comercios[0]?.version === 2, JSON.stringify(comercios));
  const idV2 = comercios[0]?.id;
  const sliceV2 = idV2 ? await slice(idV2) : null;
  ctx.expect(
    "el mercado SOBREVIVE a la migración con el stock que dejó la compra",
    sliceV2?.markets?.[mercado]?.stock?.espada_ropera === 2,
    JSON.stringify(sliceV2),
  );
  ctx.expect("…y el sistema estrena lo suyo de la v2", sliceV2?.fiado === 0, JSON.stringify(sliceV2));

  // Que el sistema con el que estaba tratando ha cambiado bajo sus pies tiene
  // que VERSE, no solo quedar en un log del servidor y en la respuesta HTTP al
  // motor: el feed de la partida es el único canal de estos que el cliente
  // pinta hoy (un narrative_status `ready/consequences` lo descarta en
  // silencio). Y cuando el sustituido es un plugin DEL JUEGO, el cambio no
  // tiene vuelta atrás para este save, así que el aviso lo dice.
  // Se espera por ESTADO: la respuesta del POST vuelve por HTTP y el aviso al
  // jugador viaja por el WebSocket, así que leer el feed en la línea siguiente
  // es una carrera.
  const aviso = await ctx.waitFor(
    "el aviso de que el sistema cambió llega al feed de la partida",
    () =>
      [...(document.getElementById("combat-log")?.children ?? [])]
        .map((n) => n.textContent ?? "")
        .find((l) => /commerce/.test(l) && /v1 → v2/.test(l)) ?? null,
    10_000,
  );
  ctx.expect(
    "el jugador VE que un sistema del juego ha cambiado de versión",
    !!aviso,
    String(aviso),
  );
  ctx.expect(
    "…y que a partir de ahora manda el motor, no el juego (no tiene vuelta atrás)",
    /motor narrativo/.test(String(aviso)),
    String(aviso),
  );

  const trasMigrarJugador = await jugador();
  ctx.expect(
    "el oro del jugador no se toca al evolucionar el sistema",
    trasMigrarJugador.gold === oroTrasCompra,
    `oro=${trasMigrarJugador.gold} (antes ${oroTrasCompra})`,
  );
  ctx.expect(
    "…ni lo que había comprado",
    (trasMigrarJugador.inventory ?? []).some((i) => i.id === "espada_ropera"),
    JSON.stringify(trasMigrarJugador.inventory),
  );

  // ── 5. Segunda compra, ya con el sistema evolucionado ───────────────────
  await api("POST", "/map/place", {
    id: "qa_zona_mercado_2",
    kind: "site",
    parent_id: null,
    name: "Vuelta al puesto",
    description: "El herrero sigue ahí, y ahora fía.",
    anchor: { tx, ty, rect: zonaB.rect },
    triggers: [
      {
        id: "qa_compra_2",
        when: { type: "player_entered" },
        consequences: [
          {
            type: "plugin_event",
            plugin_id: idV2,
            event_type: "trade_offered",
            payload: { market_id: mercado, item_id: "espada_ropera", price: 20 },
          },
          { type: "plugin_event", plugin_id: idV2, event_type: "fiar", payload: { amount: 5 } },
        ],
      },
    ],
  });

  const desde = (await ctx.nefan("state")).pos;
  await ctx.holdUntil(
    "up",
    "el jugador vuelve a pasar por el puesto",
    (a) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - a.x, p.z - a.z) >= a.paso ? { x: p.x, z: p.z } : null;
    },
    40_000,
    { x: desde.x, z: desde.z, paso: PASO },
  );
  await ctx.shot("segunda-compra");

  const finalJugador = await jugador();
  const sliceFinal = idV2 ? await slice(idV2) : null;
  ctx.log(`tras la segunda compra: oro=${finalJugador.gold} inventario=${JSON.stringify(finalJugador.inventory)} slice=${JSON.stringify(sliceFinal)}`);
  ctx.expect(
    "la segunda espada se cobra UNA vez (20, no 40 por un sistema duplicado)",
    finalJugador.gold === oroTrasCompra - 20,
    `oro=${finalJugador.gold} (esperado ${oroTrasCompra - 20})`,
  );
  ctx.expect(
    "el jugador tiene las DOS espadas",
    (finalJugador.inventory ?? []).filter((i) => i.id === "espada_ropera").length === 2,
    JSON.stringify(finalJugador.inventory),
  );
  ctx.expect(
    "el stock sigue la cuenta desde antes de migrar (3 → 2 → 1)",
    sliceFinal?.markets?.[mercado]?.stock?.espada_ropera === 1,
    JSON.stringify(sliceFinal),
  );
  ctx.expect(
    "y las reglas NUEVAS de la v2 están vivas (el fiado sube)",
    sliceFinal?.fiado === 5,
    JSON.stringify(sliceFinal),
  );

  // ── 6. Lo que el motor dejó escrito ANTES de evolucionar sigue sirviendo ─
  //
  // El motor escribe triggers en el mapa y sigue narrando; el jugador llega
  // cuando llega. Si entre una cosa y otra el sistema cambió de versión, lo
  // que el jugador tiene delante es el MISMO tenderete, y comprarle una daga
  // tiene que costarle 10 y darle la daga. Que el sistema haya cambiado de
  // versión por dentro no es cosa suya.
  const antesDeC = await jugador();
  const desdeC = (await ctx.nefan("state")).pos;
  await ctx.holdUntil(
    "up",
    "el jugador llega al tenderete de la tercera zona",
    (a) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - a.x, p.z - a.z) >= a.paso ? { x: p.x, z: p.z } : null;
    },
    40_000,
    { x: desdeC.x, z: desdeC.z, paso: PASO },
  );
  await ctx.shot("tercera-zona-trigger-viejo");
  const pantalla = await ctx.page.evaluate(() => ({
    loader: document.getElementById("narrative-loader")?.className ?? "",
    titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
    detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
  }));
  if (/visible/.test(pantalla.loader)) {
    ctx.log(`el jugador se come un overlay: «${pantalla.titulo}» — «${pantalla.detalle}»`);
  }
  const trasC = await jugador();
  const sliceC = idV2 ? await slice(idV2) : null;
  ctx.log(`tras la zona sembrada antes de migrar: oro=${trasC.gold} inventario=${JSON.stringify(trasC.inventory)} slice=${JSON.stringify(sliceC)}`);
  ctx.expect(
    "un trigger escrito ANTES de la migración sigue funcionando para el jugador",
    trasC.gold === antesDeC.gold - 10 && (trasC.inventory ?? []).some((i) => i.id === "daga"),
    `oro=${trasC.gold} (antes ${antesDeC.gold}) · inventario=${JSON.stringify(trasC.inventory)} · ` +
      `pantalla=«${pantalla.titulo}: ${pantalla.detalle}» — la consequence lleva el plugin_id de la v1 ` +
      `y la migración le cambia el id al sistema, así que el tick entero se aborta con unknown_plugin`,
  );
  ctx.expect(
    "…y si algo falla, el jugador no se come un error de tripas del motor",
    !/unknown_plugin|not_consumed|pluginId/.test(pantalla.detalle),
    `«${pantalla.titulo}: ${pantalla.detalle}»`,
  );

  // ── 7. Reintentos y saltos ilegales no pueden estropear la partida ──────
  // «Como estaba» es como estaba JUSTO ANTES de esto, no como estaba dos
  // paradas atrás: el paso 6 ya no es un no-op (la daga se compra de verdad
  // con el id viejo), así que la foto del paso 5 dejó de valer de referencia.
  const antesDeLosRechazos = {
    slice: idV2 ? await slice(idV2) : null,
    oro: (await jugador()).gold,
  };
  const repetido = await api("POST", "/plugins/register", { manifest: v2 });
  ctx.expect(
    "reenviar el mismo sistema (reintento del motor) es un no-op, no un error",
    repetido.status === 200 && repetido.body?.action === "unchanged",
    JSON.stringify(repetido.body),
  );
  const sliceRepetido = idV2 ? await slice(idV2) : null;
  ctx.expect(
    "…y no resetea el mercado ni el fiado",
    JSON.stringify(sliceRepetido) === JSON.stringify(antesDeLosRechazos.slice),
    `${JSON.stringify(sliceRepetido)} vs ${JSON.stringify(antesDeLosRechazos.slice)}`,
  );

  const v4 = { ...commerceV2(v2), version: 4, description: `${v2.description} (salto ilegal)` };
  const salto = await api("POST", "/plugins/register", { manifest: v4 });
  ctx.log(`salto v2→v4 sin migrate[2] → ${salto.status} ${JSON.stringify(salto.body)}`);
  ctx.expect(
    "un salto de versión sin la cadena completa se rechaza",
    salto.status >= 400 && salto.status < 500,
    `${salto.status} ${JSON.stringify(salto.body)}`,
  );
  ctx.expect(
    "…diciendo exactamente qué paso falta",
    typeof salto.body?.error === "string" && salto.body.error.includes("falta 'migrate[2]'"),
    JSON.stringify(salto.body?.error),
  );
  ctx.expect(
    "…y sin decirle al motor que restaure un archivo que él nunca tuvo",
    typeof salto.body?.error === "string" && !/archivo|disco/i.test(salto.body.error),
    JSON.stringify(salto.body?.error),
  );

  const degradado = await api("POST", "/plugins/register", { manifest: { ...v1Manifest, description: `${v1Manifest.description} ` } });
  ctx.expect(
    "y volver a una versión anterior se rechaza en vez de deshacer la partida",
    degradado.status >= 400 && degradado.status < 500,
    `${degradado.status} ${JSON.stringify(degradado.body)}`,
  );

  const trasRechazos = await plugins();
  const sliceTrasRechazos = idV2 ? await slice(idV2) : null;
  const jugadorFinal = await jugador();
  ctx.expect(
    "los rechazos dejan la partida EXACTAMENTE como estaba",
    trasRechazos.filter((p) => p.name === "commerce").length === 1 &&
      JSON.stringify(sliceTrasRechazos) === JSON.stringify(antesDeLosRechazos.slice) &&
      jugadorFinal.gold === antesDeLosRechazos.oro,
    `${JSON.stringify(trasRechazos.map((p) => `${p.name} v${p.version}`))} · ${JSON.stringify(sliceTrasRechazos)} · oro=${jugadorFinal.gold}`,
  );
}
