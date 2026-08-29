/** MIRAR UNA FIXTURE NO SE LLEVA LA PARTIDA GUARDADA.
 *
 *  Este guion nace de la DESVIACIÓN del plan de la tanda #245/#249/#246. El
 *  plan pedía gatear `handleInput` con «¿está suscrito a la sesión?»; el
 *  ingeniero implementó en su lugar `simDriver` —«quién tomó el mundo»
 *  (`start_session`, `resume_session`, `load_room`)— y justificó el cambio con
 *  un caso que dijo ser real y no un artefacto del bench:
 *
 *      «F5 → título → cerrar el título → modo fixtures»
 *
 *  Ese caso tiene DOS mitades, y ninguna de las dos la mide ningún guion:
 *
 *   1. Que el modo fixtures SIGA siendo jugable después de que en ese mismo
 *      bridge haya habido una partida. Es lo que rompía la propuesta del plan
 *      (los guiones 22 y 23 se cayeron con ella): el bridge conserva
 *      `session_id`, el cliente de fixtures nunca abre sesión, y el jugador se
 *      quedaba clavado sin poder andar. Aquí se comprueba andando.
 *
 *   2. Que asomarse a las fixtures NO toque el `state.json` de la partida que
 *      se estaba jugando. Ahora que el save arrastra la posición VIVA del
 *      combatiente del sim (#245), un socket que conduce sin ser el de la
 *      partida se lleva por delante dónde estaba el jugador — y el jugador se
 *      entera la próxima vez que pulsa «Reanudar», no antes.
 *
 *  Los dos pasos se dan por el camino de quien juega: partida nueva desde el
 *  título, andar, F5, y el botón «✕ Cerrar (modo fixtures)» del título — que
 *  es el ÚNICO camino a las fixtures que tiene el jugador. Nada de ocultar
 *  overlays ni de fabricar estado.
 *
 *  El guardado se PROVOCA con una escritura del motor por el State API, igual
 *  que hace el guion 17: sin ella el fichero no se reescribe mientras el
 *  jugador mira fixtures y el aserto sería un verde incapaz de ponerse rojo.
 *  Y es lo que pasa de verdad — una generación en vuelo, un evento de la
 *  agenda: el bridge guarda por su cuenta mientras el jugador está en otra
 *  pantalla, y es justo entonces cuando la posición se pierde.
 *
 *  ESTADO: VERDE desde el 2026-08-25. Nació ROJO por un hallazgo de esta misma
 *  tanda y se arregló en su ronda de corrección; lo que sigue describe el bug
 *  tal como se midió, en pasado, porque es lo que este guion existe para
 *  impedir que vuelva. Medido tres veces seguidas, determinista y con la GPU real:
 *
 *      dejó la partida en {x:0.25, z:5.49} → el save pasa a [-10.25, 0, -1.68]
 *      (la posición del muñeco de la fixture) y «Reanudar» le deja ahí.
 *
 *  El mecanismo ERA: `handleLoadRoom` (el único sitio del bridge que soltaba la
 *  atadura del jugador) era inalcanzable desde el cliente. `nefan-html` solo manda `load_room` para escenas que NO son
 *  tile (rama `else` de `isGridTile`), y las TRES fixtures de
 *  `nefan-core/data/scenes/` son Format D con `tile` — el candado se probó
 *  contra un mensaje que nadie mandaba ya. Ese es el modo de fallo que hay que
 *  recordar: no un bug, un CANDADO VERDE SOBRE CÓDIGO MUERTO. Y tras un F5 `simDriver` vuelve a
 *  `null` (`ws-server.ts`, `ws.on("close")`), así que el socket nuevo conduce
 *  sin haber tomado el mundo.
 *
 *  CÓMO SE ARREGLÓ: `bridge/world-claim.ts` juntó los dos hechos que estaban
 *  sueltos y se movían a mano desde cuatro sitios — «quién conduce el sim» y «a
 *  qué escucha el save». Y `load_room` dejó de ser código muerto: el selector
 *  «Room» vuelve a mandarlo, porque cargar una fixture ES tomar el mundo.
 *
 *  CÓMO SE PONE ROJO (probado): que la atadura del save sobreviva al dueño del
 *  mundo. Entonces este guion reproduce la medida de arriba clavada. Si alguien
 *  lo ve verde sin creerse que discrimina, ese es el experimento.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar, esperarTituloListo, esperarListaDeSaves } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

const GAME_ID = "alta_fantasia";
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

/** Ruta del `state.json` de la sesión en el disco efímero del bench. */
function rutaDelSave(sessionId) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp");
  if (!existsSync(raiz)) return null;
  for (const corrida of readdirSync(raiz)) {
    const f = join(raiz, corrida, "saves", sessionId, "state.json");
    if (existsSync(f)) return f;
  }
  return null;
}

function leerSave(sessionId) {
  const f = rutaDelSave(sessionId);
  if (!f) return null;
  try {
    return JSON.parse(readFileSync(f, "utf-8"));
  } catch {
    return null;
  }
}

/** Un lugar cualquiera por el State API: lo que importa es que el bridge
 *  ESCRIBA el save mientras el jugador está en otra pantalla. */
async function escrituraDelMotor(id, nombre) {
  return api("POST", "/map/place", {
    id,
    kind: "site",
    parent_id: null,
    name: nombre,
    description: "Fuerza un guardado del bridge desde fuera de la partida.",
  });
}

export default async function (ctx) {
  // ── 1. Una partida real, y el jugador se ALEJA de su punto de arranque ──
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  await comenzar(ctx);

  const salud = await api("GET", "/health");
  const sessionId = salud.body?.session_id;
  ctx.expect(
    "la partida tiene sesión viva en el State API",
    salud.status === 200 && Boolean(sessionId),
    `${salud.status} ${JSON.stringify(salud.body)}`,
  );
  if (!sessionId) return;

  const posArranque = await ctx.nefan("playerPos");
  await ctx.nefan("setYaw", 0); // +z: la calle abierta del tile del bench
  await ctx
    .holdUntil(
      "up",
      "el jugador anda por la calle, lejos de su punto de arranque",
      (a) => {
        const p = window.__nefan.playerPos;
        return Math.hypot(p.x - a.x, p.z - a.z) >= 2 ? p : null;
      },
      15_000,
      { x: posArranque.x, z: posArranque.z },
    )
    .catch(() => null);
  const posJugando = await ctx.nefan("playerPos");
  const separacion = Math.hypot(posJugando.x - posArranque.x, posJugando.z - posArranque.z);
  ctx.log(
    `el jugador dejó la partida en ${JSON.stringify(posJugando)} (${separacion.toFixed(1)} m del arranque)`,
  );
  // Sin separación, lo de abajo no distingue «se conservó» de «volvió al
  // arranque»: NO CONCLUYENTE antes que verde.
  ctx.expect(
    "el jugador se ha ALEJADO del arranque (si no, el resto no prueba nada)",
    separacion >= 1.5,
    `arranque ${JSON.stringify(posArranque)} · ahora ${JSON.stringify(posJugando)}`,
  );

  await escrituraDelMotor("qa25_testigo_jugando", "Piedra de la partida");
  const guardadoJugando = leerSave(sessionId);
  ctx.expect(
    "el save de disco lleva dónde dejó el jugador la partida",
    Array.isArray(guardadoJugando?.player?.position) &&
      Math.abs(guardadoJugando.player.position[0] - posJugando.x) <= 0.5 &&
      Math.abs(guardadoJugando.player.position[2] - posJugando.z) <= 0.5,
    `save ${JSON.stringify(guardadoJugando?.player?.position)} · vivo ${JSON.stringify(posJugando)}`,
  );
  const posGuardada = guardadoJugando?.player?.position;
  await ctx.shot("la-partida-donde-el-jugador-la-dejo");

  // ── 2. F5 y el jugador se va a mirar fixtures, sin reanudar ─────────────
  // El camino real: recargar deja el título delante, y el ÚNICO acceso a las
  // fixtures es su botón «✕ Cerrar (modo fixtures, sin sesión)».
  await ctx.page.goto(ctx.page.url(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await ctx.nefan("closeTitle");
  await ctx.waitFor(
    "el título se ha ido y queda el modo fixtures",
    () => window.__nefan.status().title === false,
    10_000,
  );

  // ── 3. MITAD A: el modo fixtures sigue siendo jugable ───────────────────
  // Es lo que rompía el gate por suscripción del plan: el bridge conserva la
  // sesión de la partida anterior y el cliente de fixtures no abre ninguna.
  const fixtura = await ctx.page.$eval("#room-selector", (s) => {
    const v = [...s.options].map((o) => o.value).filter(Boolean)[0] ?? "";
    return v ? v.split("/").pop().replace(/\.json$/, "") : "";
  });
  ctx.expect("el selector «Room» ofrece alguna fixture", Boolean(fixtura), fixtura);
  if (!fixtura) return;
  await ctx.nefan("loadFixture", fixtura);
  await ctx.waitFor(
    `la fixture ${fixtura} carga y el mundo 3D la instala`,
    (f) => {
      const n = window.__nefan;
      const g = n.fps();
      return n.scene?.scene_id === f && g && g.ready && g.activeTile ? true : null;
    },
    30_000,
    fixtura,
  );

  const posFixturaAntes = await ctx.nefan("playerPos");
  await ctx
    .holdUntil(
      "up",
      "el muñeco de la fixture anda",
      (a) => {
        const p = window.__nefan.playerPos;
        return Math.hypot(p.x - a.x, p.z - a.z) >= 0.5 ? p : null;
      },
      15_000,
      { x: posFixturaAntes.x, z: posFixturaAntes.z },
    )
    .catch(() => null);
  const posFixturaDespues = await ctx.nefan("playerPos");
  const anduvo = Math.hypot(
    posFixturaDespues.x - posFixturaAntes.x,
    posFixturaDespues.z - posFixturaAntes.z,
  );
  ctx.log(
    `en la fixture: ${JSON.stringify(posFixturaAntes)} → ${JSON.stringify(posFixturaDespues)} (${anduvo.toFixed(2)} m)`,
  );
  ctx.expect(
    "el modo fixtures SIGUE siendo jugable después de una partida en el mismo bridge",
    anduvo >= 0.4,
    `${JSON.stringify(posFixturaAntes)} → ${JSON.stringify(posFixturaDespues)}`,
  );
  await ctx.shot("mirando-una-fixture");

  // ── 4. MITAD B: y la partida guardada no se ha enterado ─────────────────
  // El motor escribe mientras el jugador anda por la fixture (una generación
  // en vuelo, un evento de la agenda): el bridge guarda, y ese guardado NO
  // puede llevarse la posición del muñeco de la fixture.
  const escrito = await escrituraDelMotor("qa25_testigo_fixtures", "Piedra de las fixtures");
  ctx.expect(
    "el motor puede escribir en la partida mientras el jugador mira fixtures",
    escrito.status === 200,
    `${escrito.status} ${JSON.stringify(escrito.body).slice(0, 160)}`,
  );
  const guardadoFixtures = leerSave(sessionId);
  ctx.expect(
    "mirar una fixture NO cambia dónde dice el save que está el jugador",
    JSON.stringify(guardadoFixtures?.player?.position) === JSON.stringify(posGuardada),
    `${JSON.stringify(posGuardada)} → ${JSON.stringify(guardadoFixtures?.player?.position)} · muñeco de la fixture ${JSON.stringify(posFixturaDespues)}`,
  );
  ctx.expect(
    "…ni cuánta vida le queda",
    guardadoFixtures?.player?.health === guardadoJugando?.player?.health,
    `${guardadoJugando?.player?.health} → ${guardadoFixtures?.player?.health}`,
  );

  // ── 5. Y al volver, la partida sigue donde estaba ───────────────────────
  // El aserto que ve el jugador: reanudar después de haberse asomado a las
  // fixtures le devuelve a su calle, no al muñeco de la cripta.
  await ctx.page.goto(ctx.page.url(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  // La tarjeta de una partida NO se pinta con el título: llega después, con la
  // respuesta de `list_sessions` del bridge. Buscarla justo tras
  // `esperarTituloListo` era una carrera —verde en solitario, roja dentro de la
  // batería, donde hay más saves acumulados y el listado tarda más (#224,
  // #287)— y este guion era el único de los siete que leen la lista que no la
  // esperaba. Mismo par que 27 y 29: el título llega, y luego su lista.
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(
    `button[data-action="resume"][data-session-id="${sessionId}"]`,
  );
  ctx.expect("el título sigue ofreciendo la partida", Boolean(tarjeta), sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  const posReanudada = await ctx.nefan("playerPos");
  ctx.log(`reanudó en ${JSON.stringify(posReanudada)}`);
  ctx.expect(
    "reanudar tras mirar fixtures deja al jugador DONDE ESTABA jugando",
    Math.abs(posReanudada.x - posJugando.x) <= 0.5 &&
      Math.abs(posReanudada.z - posJugando.z) <= 0.5,
    `dejó la partida en ${JSON.stringify(posJugando)} y reanudó en ${JSON.stringify(posReanudada)}`,
  );
  await ctx.shot("de-vuelta-a-la-partida");
}
