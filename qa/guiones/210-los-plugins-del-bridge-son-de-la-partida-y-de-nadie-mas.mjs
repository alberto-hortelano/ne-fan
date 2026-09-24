/** LOS PLUGINS DEL BRIDGE SON DE LA PARTIDA, Y DE NADIE MÁS (#368 F9).
 *
 *  Escrito por QA al validar la tanda BG. «Qué plugins están activos» es un
 *  hecho DE LA SESIÓN (`bridge/plugins-activos.ts`), y hasta #368 sobrevivía a
 *  dos transiciones en las que la sesión se va: el cierre de la sesión
 *  efímera de la pre-generación (`sesion-efimera.ts` vaciaba al ENTRAR y no al
 *  SALIR) y el `load_room` del selector «Room» (`handleLoadRoom` soltaba la
 *  atadura del save pero no los manifests). Una fixture cargada después
 *  heredaba los sistemas de una partida que no existe: el dispatcher les
 *  entregaba sus eventos y `GET /plugins` los listaba.
 *
 *  Los tests de bridge de la tanda ejercen el arreglo con `porElBorde`; esto
 *  lo recorre por el camino del JUGADOR, en el juego real, y lo lee por donde
 *  lo lee el motor narrativo: el State API (`GET /plugins`, que no exige
 *  sesión — es justo por eso por lo que un residuo ahí se ve). Un estado por
 *  bloque, y el mismo endpoint en todos:
 *
 *   1 · PRE-GENERACIÓN («Generar mundo» del título, sin partida). Mientras el
 *       motor contesta, `/plugins` lista los del juego (premisa: la efímera
 *       los activa de verdad); al terminar, `/plugins` está VACÍO y el
 *       `inspect` de cada id que se vio en vuelo contesta «desconocido» — los
 *       records se fueron con la efímera, no solo el registry.
 *   2 · PARTIDA VIVA. `start_session` + Comenzar → `/plugins` lista los del
 *       juego. Los ids se guardan para el bloque 4.
 *   3 · FIXTURE ENCIMA DE LA PARTIDA. F5 → título → «✕ Cerrar (modo
 *       fixtures)» → una fixture del selector «Room» (el ÚNICO camino del
 *       jugador a las fixtures). El bridge CONSERVA la partida (`/health`
 *       sigue diciendo su `session_id`) y aun así `/plugins` está VACÍO: la
 *       purga es del `load_room`, no de que la partida se haya ido.
 *   4 · REANUDAR devuelve EXACTAMENTE los mismos ids del bloque 2 (los re-ata
 *       desde el save, no los reinventa).
 *   5 · `load_room` DE OTRO SOCKET mientras la partida tiene el mundo: el
 *       claim se niega (`claimForFixture` devuelve `false`) y `/plugins` NO
 *       cambia — la purga cuelga de que la fixture TOME el mundo, no de que
 *       alguien lo pida. Es la pestaña ajena que no puede quitarle los
 *       sistemas a quien está jugando.
 *
 *  Lo que NO mide: que el dispatcher no ENTREGUE eventos a lo que no está
 *  activo (el motor falso no emite `plugin_event`; lo mide
 *  `test/game-gen.test.ts` con `runPluginTick`), ni el `delete_session` de la
 *  partida activa (guion 211, hallazgo aparte).
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server;
 *  `renderMode: "vector"` porque nada de esto mide imagen.
 */
import {
  comenzar,
  esperarTituloListo,
  nuevaPartida,
  reanudar,
  regenerarMundo,
} from "../lib/sesion.mjs";
import { cargarFixture } from "../lib/fixtures.mjs";
import { porElCable, preguntarPorElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";

/** La pre-generación escribe el snapshot del mundo y la partida un save: los
 *  dos en el disco efímero del bench, virgen para este guion. */
export const aisla = ["mundo", "saves"];

const GAME_ID = "alta_fantasia";
const FIXTURE = "robledo_tile";
const API = URLS.state_api;

/** `GET` al State API, como lo hace narrative-mcp. */
async function api(path) {
  const res = await fetch(`${API}${path}`);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __raw: text };
  }
  return { status: res.status, body };
}

/** Los ids que `/plugins` lista ahora, ordenados; y el status por si no es 200. */
async function pluginsActivos() {
  const r = await api("/plugins");
  const ids = Array.isArray(r.body?.plugins) ? r.body.plugins.map((p) => p.id).sort() : null;
  const nombres = Array.isArray(r.body?.plugins) ? r.body.plugins.map((p) => p.name) : [];
  return { status: r.status, ids, nombres };
}

const corto = (ids) => (ids ?? []).map((id) => id.slice(0, 8)).join(",") || "∅";

export default async function (ctx) {
  // ── 1. La pre-generación no deja plugins colgando ───────────────────────
  // Se muestrea `/plugins` mientras el título pre-genera: sin la premisa de
  // que la efímera ACTIVÓ plugins, el «vacío al terminar» no discrimina nada.
  // Sin reloj: cada vuelta espera a que el bridge CONTESTE (otro proceso), y
  // el bucle para cuando la pre-generación llega a su estado terminal.
  let vistosEnVuelo = [];
  let muestreando = true;
  let muestras = 0;
  const muestreo = (async () => {
    while (muestreando) {
      const { ids } = await pluginsActivos();
      muestras++;
      if (ids && ids.length > 0 && vistosEnVuelo.length === 0) vistosEnVuelo = ids;
    }
  })();
  try {
    await regenerarMundo(ctx, GAME_ID);
  } finally {
    muestreando = false;
    await muestreo;
  }
  const trasPregen = await pluginsActivos();
  const salud1 = await api("/health");
  ctx.log(
    `pre-generación: en vuelo ${corto(vistosEnVuelo)} (${muestras} muestras) · al terminar ${corto(trasPregen.ids)} · ` +
      `sesión «${salud1.body?.session_id ?? "?"}»`,
  );
  if (vistosEnVuelo.length === 0) {
    ctx.sinMedirBloque(
      "no se llegó a muestrear ningún plugin activo durante la pre-generación: sin esa premisa, " +
        "el vacío de después no demuestra la purga de la efímera",
    );
  } else {
    ctx.expect(
      "la efímera activó los plugins del juego mientras el motor generaba (premisa)",
      vistosEnVuelo.length > 0,
      corto(vistosEnVuelo),
    );
    ctx.expect(
      "al cerrarse la efímera el bridge no tiene partida",
      salud1.status === 200 && salud1.body?.has_session === false,
      JSON.stringify(salud1.body),
    );
    ctx.expect(
      "…y GET /plugins está VACÍO: los sistemas de la pre-generación no se quedan colgando",
      trasPregen.status === 200 && Array.isArray(trasPregen.ids) && trasPregen.ids.length === 0,
      `${trasPregen.status} ${corto(trasPregen.ids)}`,
    );
    for (const id of vistosEnVuelo) {
      const insp = await api(`/plugins/${id}/inspect`);
      ctx.expect(
        `plugin_inspect(${id.slice(0, 8)}…) de un sistema de la efímera contesta «desconocido», no un slice`,
        insp.status === 400 && /desconocido/.test(String(insp.body?.error ?? insp.body?.message ?? JSON.stringify(insp.body))),
        `${insp.status} ${JSON.stringify(insp.body).slice(0, 160)}`,
      );
    }
  }

  // ── 2. Partida viva: los plugins del juego están activos ────────────────
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  const enPartida = await pluginsActivos();
  ctx.log(`partida ${sessionId}: plugins ${enPartida.nombres.join(", ")} (${corto(enPartida.ids)})`);
  ctx.expect(
    "con la partida en marcha GET /plugins lista los sistemas del juego",
    enPartida.status === 200 && Array.isArray(enPartida.ids) && enPartida.ids.length > 0,
    `${enPartida.status} ${corto(enPartida.ids)}`,
  );
  if (!enPartida.ids?.length) return;

  // ── 5 (antes del 3, con la partida aún dueña del mundo). load_room ajeno ─
  // Otro socket pide una fixture mientras esta página tiene el mundo: el
  // bridge lo ignora («otra pestaña no le quita el mundo a quien está
  // jugando») y los plugins no se tocan. `load_room` no tiene respuesta, así
  // que la espera es una PREGUNTA por otro cable: cuando el bridge contesta
  // el `list_sessions` abierto después, ya despachó el frame anterior.
  await porElCable(
    ctx,
    { type: "load_room", roomId: FIXTURE, enemies: [] },
    () =>
      preguntarPorElCable(
        ctx,
        { type: "list_sessions", requestId: "qa210-tras-load-room-ajeno" },
        { respuesta: "sessions_listed" },
      ),
  );
  const trasAjeno = await pluginsActivos();
  const saludAjeno = await api("/health");
  ctx.expect(
    "un load_room de OTRO socket no le quita los plugins a la partida que tiene el mundo",
    JSON.stringify(trasAjeno.ids) === JSON.stringify(enPartida.ids),
    `${corto(enPartida.ids)} → ${corto(trasAjeno.ids)}`,
  );
  ctx.expect(
    "…ni la partida",
    saludAjeno.body?.session_id === sessionId,
    JSON.stringify(saludAjeno.body),
  );
  const sigueSuya = await ctx.nefan("scene");
  ctx.expect(
    "y la página sigue en su partida, no en la fixture del intruso",
    sigueSuya?.scene_id !== FIXTURE,
    String(sigueSuya?.scene_id),
  );

  // ── 3. F5 → título → modo fixtures → una fixture: sin plugins ───────────
  await ctx.page.goto(ctx.page.url(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await ctx.nefan("closeTitle");
  await ctx.waitFor(
    "el título se ha ido y queda el modo fixtures",
    () => window.__nefan.status().title === false,
    10_000,
  );
  await cargarFixture(ctx, FIXTURE);
  const enFixture = await pluginsActivos();
  const saludFixture = await api("/health");
  ctx.log(
    `fixture ${FIXTURE}: plugins ${corto(enFixture.ids)} · el bridge conserva la partida «${saludFixture.body?.session_id}»`,
  );
  ctx.expect(
    "el bridge CONSERVA la partida mientras el jugador mira una fixture (premisa: lo que se vacía no es la sesión)",
    saludFixture.body?.session_id === sessionId,
    JSON.stringify(saludFixture.body),
  );
  ctx.expect(
    "una fixture del selector «Room» no hereda los plugins de la partida: GET /plugins vacío",
    enFixture.status === 200 && Array.isArray(enFixture.ids) && enFixture.ids.length === 0,
    `${enFixture.status} ${corto(enFixture.ids)}`,
  );
  // Observación, no aserto: qué le contesta `plugin_inspect` al motor si
  // pregunta por un sistema de la partida MIENTRAS el jugador mira la fixture.
  // Los records siguen en el estado (la partida existe) y el registry está
  // vacío: la respuesta es una decisión de diseño que se deja escrita en qa.md.
  for (const id of enPartida.ids) {
    const insp = await api(`/plugins/${id}/inspect`);
    ctx.log(`inspect(${id.slice(0, 8)}…) durante la fixture → ${insp.status} ${JSON.stringify(insp.body).slice(0, 140)}`);
  }
  await ctx.shot("fixture-sin-plugins");

  // ── 4. Reanudar devuelve los MISMOS sistemas ────────────────────────────
  const vuelta = await reanudar(ctx, sessionId);
  if (!vuelta) return;
  const reanudada = await pluginsActivos();
  ctx.expect(
    "reanudar re-ata EXACTAMENTE los plugins de la partida (mismos ids que antes de la fixture)",
    JSON.stringify(reanudada.ids) === JSON.stringify(enPartida.ids),
    `${corto(enPartida.ids)} → ${corto(reanudada.ids)}`,
  );
  await ctx.shot("de-vuelta-con-sus-plugins");
}
