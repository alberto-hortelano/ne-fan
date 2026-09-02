/** UN `map_link` CREADO A MITAD DE SESIÓN LLEGA AL PANEL «SALIDAS» (#179), sin
 *  re-difundir la escena, y sobrevive a Reanudar.
 *
 *  El panel «Salidas» es la única vía de viaje a un lugar. Hasta #179 las
 *  `exits` eran un derivado del mapa HORNEADO dentro del `scene_data` al
 *  difundir la escena (el bridge mutaba el objeto persistido) y
 *  su único invalidador era esa difusión: un link que el motor creaba en
 *  mitad de la conversación —«te espera en la ermita»— quedaba en el save y no
 *  llegaba al panel hasta que la escena volviera a difundirse; y al reanudar
 *  el resume servía el sello congelado, así que cerrar y volver tampoco lo
 *  curaba. El diálogo prometía un destino que la única vía de viaje no ofrecía.
 *
 *  Lo que se afirma, y por dónde:
 *
 *   1 · Con la partida viva, `POST /map/place` + `POST /map/link` por el State
 *       API (el cable de las tools MCP, tal cual lo hace narrative-mcp) → el
 *       panel (`__nefan.exits` Y los botones de `#travel-panel`) muestra el
 *       destino nuevo.
 *   2 · Y llega SOLO: cero `scene_init` en el cable del juego desde la
 *       creación del link, cero `POST` de atlas (`/generate_surface_atlas`) y
 *       cero `POST /scene/…` del registro de arte. Re-difundir la escena para
 *       pintar un botón habría pasado otra vez por el atlas y `addEnemies`;
 *       esa era la forma prohibida de arreglarlo.
 *   3 · Cerrar → Reanudar → el destino sigue en el panel: las `exits` se
 *       calculan al SERVIR (broadcast y resume, una puerta) y no se sellan.
 *   4 · El hermano: renombrar el lugar de destino con `map_upsert_place` cambia
 *       el rótulo del botón sin tocar la escena.
 *
 *  Los frames del cable se leen con `page.on("websocket")` del propio socket
 *  del juego (no se abre otro): un `scene_init` que llegara por ahí es el que
 *  el cliente instalaría. Las peticiones, con `page.on("request")`.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, Maqueta 3D (el atlas del arranque
 *  solo RESUELVE la librería, `resolve_only`). Se espera el desenlace del atlas
 *  del tile de arranque ANTES de la marca «desde aquí, nada»: sin eso el POST
 *  del arranque contaría como del link.
 *
 *  Nació ROJO sobre `6d3d7ac` (medido el 2026-09-02): con `mapa: place 200 ·
 *  link 200`, el panel no cambia —`✘ #179 · el panel «Salidas» ofrece el
 *  destino nuevo … — no ocurrió en 30000 ms · 197 sondeo(s)` y `salidas tras el
 *  link: {"exits":["Molino del bench"],"botones":["→ Molino del bench
 *  (road)"]}`—; tras Reanudar tampoco (`exits` selladas en el save: las mismas);
 *  y el renombrado deja el botón con el nombre viejo. Lo único verde en la
 *  base es «cero scene_init / cero POST», que ahí es verde vacío: nada se
 *  difundió porque nada cambió.
 */
import { nuevaPartida, comenzar, recargarAlTitulo, reanudar } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Los dos lugares que siembra el motor falso en el bootstrap
 *  (`labs/narrative/fake-ai-server.ts`): el de la taberna es el place de la
 *  escena de arranque, el molino su única salida. */
const ORIGEN = "taberna_bench_place";
const MOLINO = "molino_bench_place";
const MOLINO_NOMBRE = "Molino del bench";
const ERMITA = "qa64_ermita";
const ERMITA_NOMBRE = "Ermita del guion 64";
const MOLINO_RENOMBRADO = "Molino renombrado por el guion 64";

/** Llamada al State API tal cual la hace narrative-mcp. */
async function api(method, path, body) {
  const res = await fetch(`${URLS.state_api}${path}`, {
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

/** Lo que el jugador tiene delante: los nombres de `__nefan.exits` y los
 *  rótulos de los botones del panel. Dos fuentes a propósito: el hook es lo
 *  que el cliente CREE y los botones lo que PINTA. */
const salidas = (ctx) =>
  ctx.page.evaluate(() => ({
    exits: (window.__nefan.exits ?? []).map((e) => e.name),
    botones: Array.from(document.querySelectorAll("#travel-panel button.travel-exit")).map(
      (b) => (b.textContent ?? "").trim(),
    ),
  }));

/** Espera a que el panel ofrezca `nombre` y lo AFIRMA (la expiración es el
 *  defecto que se busca, así que queda con sus sondeos delante). */
async function esperarSalida(ctx, nombre, aserto) {
  await ctx.expectEspera(
    `el panel «Salidas» ofrece «${nombre}»`,
    true,
    (n) => {
      const exits = (window.__nefan.exits ?? []).map((e) => e.name);
      const botones = Array.from(document.querySelectorAll("#travel-panel button.travel-exit")).map(
        (b) => (b.textContent ?? "").trim(),
      );
      return exits.includes(n) && botones.some((t) => t.includes(n)) ? { exits, botones } : null;
    },
    { ms: 30_000, arg: nombre, aserto },
  );
  return salidas(ctx);
}

/** El HUD conserva 8 líneas: se recogen TODAS las que entren desde ahora. */
const espiarHud = (ctx) =>
  ctx.page.evaluate(() => {
    window.__qaHud64 = [];
    const log = document.getElementById("combat-log");
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qaHud64.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  });

/** Desenlace del atlas de `key` en el HUD: instalado, restaurado, parcial, sin
 *  celdas o fallido. Cualquiera vale: lo que importa es que el POST del
 *  arranque ya ha salido. */
const esperarAtlasDe = (ctx, key) =>
  ctx.waitFor(
    `el atlas de ${key} llega a un desenlace`,
    (k) =>
      (window.__qaHud64 ?? []).find((l) =>
        new RegExp(`Atlas fps de ${k}( instalado| restaurado|: \\d+ superficies|: sin celdas)|atlas fps de ${k}( falló|: \\d+ celdas)`).test(l),
      ) ?? null,
    90_000,
    key,
  );

export default async function (ctx) {
  // Espías ANTES de recargar: el socket del juego se abre con la página.
  const frames = [];
  const peticiones = [];
  ctx.page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => frames.push(typeof f.payload === "string" ? f.payload : ""));
  });
  ctx.page.on("request", (r) => peticiones.push({ method: r.method(), url: r.url() }));
  await recargarAlTitulo(ctx);

  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="vector"]');
  const partida = await comenzar(ctx);
  await espiarHud(ctx);
  const tile0 = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const atlas = await esperarAtlasDe(ctx, tile0);
  ctx.log(`atlas del arranque (${tile0}): ${atlas}`);
  const antes = await esperarSalida(ctx, MOLINO_NOMBRE, "precondición: el panel arranca con la salida que sembró el motor");
  ctx.log(`salidas al arrancar: ${JSON.stringify(antes)}`);

  // ── 1 · Un lugar y un enlace nuevos por el cable de las tools ───────────
  const desdeFrame = frames.length;
  const desdePeticion = peticiones.length;
  const lugar = await api("POST", "/map/place", {
    id: ERMITA,
    kind: "site",
    parent_id: null,
    name: ERMITA_NOMBRE,
    description: "Cuatro paredes de piedra y un tejado hundido, a media hora del pueblo.",
  });
  const enlace = await api("POST", "/map/link", {
    from: ORIGEN,
    to: ERMITA,
    kind: "path",
    travel_hours: 1,
    description: "Una senda que sube entre encinas.",
  });
  ctx.log(`mapa: place ${lugar.status} · link ${enlace.status} ${JSON.stringify(enlace.body)}`);
  ctx.expect("el State API acepta el lugar y el enlace (el cable del motor está vivo)", lugar.status === 200 && enlace.status === 200, JSON.stringify({ lugar, enlace }));

  const tras = await esperarSalida(
    ctx,
    ERMITA_NOMBRE,
    "#179 · el panel «Salidas» ofrece el destino nuevo creado a mitad de sesión",
  );
  ctx.log(`salidas tras el link: ${JSON.stringify(tras)}`);
  ctx.expect(
    "…y conserva la salida que ya tenía (el link SUMA, no sustituye)",
    tras.exits.includes(MOLINO_NOMBRE),
    JSON.stringify(tras),
  );
  await ctx.shot("panel-con-el-destino-nuevo");

  // ── 2 · Y llegó SOLO: ni escena ni atlas ─────────────────────────────────
  const escenas = frames.slice(desdeFrame).filter((p) => p.includes('"type":"narrative_event"') && p.includes('"eventId":"scene_init"'));
  const posts = peticiones
    .slice(desdePeticion)
    .filter((r) => r.method === "POST" && /\/generate_surface_atlas|\/scene\//.test(r.url))
    .map((r) => r.url);
  ctx.log(`desde el link: ${frames.length - desdeFrame} frame(s) · scene_init ${escenas.length} · POST de atlas/escena ${posts.length}`);
  ctx.expect("#179 · el destino llegó SIN re-difundir la escena (cero scene_init desde el link)", escenas.length === 0, `${escenas.length} scene_init`);
  ctx.expect("#179 · …y sin pagar ni registrar arte (cero POST de atlas ni /scene/ desde el link)", posts.length === 0, JSON.stringify(posts));

  // ── 3 · Cerrar y Reanudar: el destino sigue ─────────────────────────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  const reanudado = await esperarSalida(
    ctx,
    ERMITA_NOMBRE,
    "#179 · tras Reanudar el panel sigue ofreciendo el destino creado a mitad de sesión",
  );
  ctx.log(`salidas tras reanudar: ${JSON.stringify(reanudado)}`);
  await ctx.shot("panel-tras-reanudar");

  // ── 4 · El hermano: renombrar el destino con map_upsert_place ───────────
  const renombre = await api("POST", "/map/place", {
    id: MOLINO,
    kind: "settlement",
    parent_id: "world",
    name: MOLINO_RENOMBRADO,
    description: "Un molino de agua río abajo, con su presa y cuatro casas alrededor.",
  });
  ctx.expect("el State API acepta el renombrado", renombre.status === 200, JSON.stringify(renombre));
  const renombrado = await esperarSalida(
    ctx,
    MOLINO_RENOMBRADO,
    "#179 · renombrar un lugar con map_upsert_place cambia el rótulo de su botón",
  );
  ctx.expect(
    "…y el nombre viejo ya no está en el panel",
    !renombrado.exits.includes(MOLINO_NOMBRE) && !renombrado.botones.some((t) => t.includes(MOLINO_NOMBRE)),
    JSON.stringify(renombrado),
  );
  ctx.log(`salidas tras renombrar: ${JSON.stringify(renombrado)}`);
  await ctx.shot("panel-tras-renombrar");
  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
