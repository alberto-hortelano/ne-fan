/** BORRAR LA PARTIDA ACTIVA SE LLEVA SUS PLUGINS.
 *
 *  Escrito por QA al validar la tanda BG (#368 F9) en la pasada adversarial:
 *  «¿queda algún camino que deje plugins huérfanos?». El arreglo vacía los
 *  plugins en las dos transiciones que nombraba el issue (cierre de la
 *  efímera y `load_room`); ésta es la TERCERA forma en que el bridge se queda
 *  sin partida, y la única que la UI ofrece con un botón: «Borrar» en la
 *  tarjeta del título. `NarrativeState.deleteSession` suelta la identidad de
 *  la sesión activa (#365: `session_id = ""`) y nadie toca ni
 *  `ctx.activePlugins` ni `narrative.plugins`.
 *
 *  El camino del jugador: partida nueva → F5 (el título delante, la partida
 *  sigue en el bridge) → Borrar esa partida. El botón abre un `confirm()` que
 *  bloquea al harness, así que el frame va por el cable (`delete_session`,
 *  misma ruta del router que usa la UI; patrón del guion 18).
 *
 *  Afirma lo mismo que el 210 en su bloque 1: sin partida no hay sistemas.
 *  `/health` sin sesión y `/plugins` VACÍO; el `inspect` de cada id de la
 *  partida borrada, «desconocido».
 *
 *  ESTADO AL NACER (2026-09-24): ROJO — tras el borrado `/plugins` sigue
 *  listando los sistemas de la partida que ya no existe. Queda como hallazgo
 *  de la QA de la tanda BG; el 210 no lo incluye para que el arreglo de #368
 *  se pueda medir en verde por su cuenta.
 *  VERDE desde la misma tanda: `NarrativeState.soltarLaSesion` (records) y
 *  `sinPartidaNoHayPlugins` (registry del bridge) en el borrado.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso, `renderMode:
 *  "vector"`.
 */
import { borrarSaveComoOtroCliente, comenzar, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

const GAME_ID = "alta_fantasia";
const API = URLS.state_api;

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

async function pluginsActivos() {
  const r = await api("/plugins");
  const ids = Array.isArray(r.body?.plugins) ? r.body.plugins.map((p) => p.id).sort() : null;
  return { status: r.status, ids };
}

const corto = (ids) => (ids ?? []).map((id) => id.slice(0, 8)).join(",") || "∅";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  const { sessionId } = await comenzar(ctx);
  const enPartida = await pluginsActivos();
  ctx.expect(
    "premisa: la partida tiene sistemas activos",
    enPartida.status === 200 && enPartida.ids?.length > 0,
    `${enPartida.status} ${corto(enPartida.ids)}`,
  );
  if (!enPartida.ids?.length) return;

  // F5: el título delante y la partida sigue siendo la del bridge.
  await ctx.page.goto(ctx.page.url(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  const antes = await api("/health");
  ctx.expect(
    "premisa: tras F5 el bridge conserva la partida",
    antes.body?.session_id === sessionId,
    JSON.stringify(antes.body),
  );

  await borrarSaveComoOtroCliente(ctx, sessionId);
  const salud = await api("/health");
  const tras = await pluginsActivos();
  ctx.log(`borrada ${sessionId}: sesión «${salud.body?.session_id}» · plugins ${corto(tras.ids)}`);
  ctx.expect(
    "borrar la partida activa deja el bridge sin sesión",
    salud.status === 200 && salud.body?.has_session === false,
    JSON.stringify(salud.body),
  );
  ctx.expect(
    "…y sin sus plugins: GET /plugins vacío (sin partida no hay sistemas)",
    tras.status === 200 && Array.isArray(tras.ids) && tras.ids.length === 0,
    `${tras.status} ${corto(tras.ids)}`,
  );
  for (const id of enPartida.ids) {
    const insp = await api(`/plugins/${id}/inspect`);
    ctx.expect(
      `plugin_inspect(${id.slice(0, 8)}…) de la partida borrada contesta «desconocido», no un slice`,
      insp.status === 400 && /desconocido/.test(JSON.stringify(insp.body)),
      `${insp.status} ${JSON.stringify(insp.body).slice(0, 160)}`,
    );
  }
}
