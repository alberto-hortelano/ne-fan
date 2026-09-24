/** EL ESTILO LLEGA ANTES QUE EL ATLAS (#730, tanda AX).
 *
 *  El atlas del tile no resuelve nada sin el estilo de la sesión, y nadie lo
 *  re-dispara cuando el estilo llega: si una escena se instalara antes que su
 *  estilo, el tile se quedaría en clay para siempre. No se construyó ese
 *  re-disparo porque el protocolo no produce ese estado, y el orden tiene dos
 *  mitades:
 *
 *   · el BRIDGE manda `session_started` (con `world.style_id`) antes de
 *     difundir ninguna escena — candado en
 *     `nefan-core/test/el-estilo-llega-antes-que-la-escena.test.ts`;
 *   · el CLIENTE fija el estilo en la continuación de esa respuesta, antes de
 *     procesar el siguiente mensaje del bridge. Esa mitad es del navegador y
 *     es la de ESTE guion.
 *
 *  Se mide en los tres caminos por los que una partida recibe su primer tile:
 *  (1) partida nueva con el bootstrap vivo del motor falso, (2) partida nueva
 *  sobre el mundo PRE-GENERADO —el más apretado: el bridge difunde la escena
 *  en el mismo turno que el `session_started`— y (3) reanudar. En cada uno:
 *  el registro dice «Estilo visual: …» ANTES de la primera línea del atlas,
 *  nunca «sin estilo de sesión», y el POST del atlas del tile lleva el
 *  `style_id` de la partida.
 *
 *  Corre en MAQUETA y en `produccion`: el activo solo pregunta a la librería
 *  (`resolve_only`), así que el POST sale siempre y no se paga nada.
 *
 *  PROBADO EN NEGATIVO: aplazando `applySessionStyle` (`main.ts`) 1,5 s con un
 *  `setTimeout`, rojos los tres casos (el registro dice «sin estilo de sesión»
 *  y el tile no manda POST). Aplazándolo UN macrotask (`setTimeout 0`), rojo
 *  solo el 3: en partida nueva la escena llega en un mensaje WS posterior y el
 *  macrotask se le adelanta; en el resume el bucle de `addTile` corre síncrono
 *  tras `enter`. O sea que en partida nueva este guion caza un retraso que
 *  dure más que la llegada de la escena, no cualquiera. Salida en
 *  `docs/agents/2026-09-24-tanda-ax-el-atlas-se-dispara-cuando-toca/`.
 *
 *  LO QUE NO MIDE: el orden del bridge por dentro (el test de core) ni la
 *  fixture del selector «Room» sin partida, donde no hay estilo que esperar y
 *  el clay es lo correcto.
 *
 *  CERO CRÉDITOS: motor falso, y nada pide pintar.
 */
import { comenzar, nuevaPartida, reanudar, recargarAlTitulo, regenerarMundo } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["mundo", "saves", "fake-ai"];

/** Todo lo que entra en `#combat-log` desde que carga la página (y tras cada
 *  reload): el registro conserva pocas líneas. */
function espiarElRegistro() {
  window.__qa183 = [];
  const enganchar = () => {
    const log = document.getElementById("combat-log");
    if (!log) return;
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) window.__qa183.push(n.textContent ?? "");
    }).observe(log, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enganchar);
  else enganchar();
}

/** Espera a que el atlas del tile activo haya terminado de preguntar. */
const esperarElAtlas = (ctx, desc) =>
  ctx.waitFor(
    desc,
    () => {
      const n = window.__nefan;
      const f = n.fps();
      return f.ready && f.activeTile && !n.status().painting && n.status().restaurando === 0
        ? { activeTile: f.activeTile, styleId: n.sesion().styleId ?? null }
        : null;
    },
    90_000,
  );

/** Tiles que ha escrito el motor falso (`/generate_scene`). */
async function escenasDelFalso() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  return (await res.json()).gasto.rutas["/generate_scene"] ?? 0;
}

export default async function (ctx) {
  await ctx.page.addInitScript(espiarElRegistro);
  await ctx.page.evaluate(espiarElRegistro);
  /** `style_id` de cada POST del atlas, en orden. */
  const posts = [];
  ctx.page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/generate_surface_atlas")) return;
    let body;
    try {
      body = JSON.parse(r.postData() ?? "null");
    } catch {
      body = null; // sin cuerpo legible: sin estilo que leer
    }
    posts.push({ style_id: body?.style_id ?? null, resolve_only: body?.resolve_only === true });
  });

  /** Los tres asertos de un caso, sobre el registro y los POST desde que
   *  empezó. `estilo` es el del título (o el del save, al reanudar). */
  async function afirmarElOrden(caso, desdePost, estilo) {
    const reg = await ctx.page.evaluate(() => window.__qa183 ?? []);
    const iEstilo = reg.findIndex((l) => l.includes(`Estilo visual: ${estilo}`));
    const iAtlas = reg.findIndex((l) => /Atlas fps/.test(l));
    ctx.log(`${caso} · estilo #${iEstilo} · atlas #${iAtlas} · ${JSON.stringify(reg.filter((l) => /Estilo|Atlas fps/.test(l)))}`);
    ctx.expect(
      `${caso} · el registro dice «Estilo visual: ${estilo}» ANTES de la primera línea del atlas`,
      iEstilo >= 0 && iAtlas >= 0 && iEstilo < iAtlas,
      JSON.stringify({ iEstilo, iAtlas }),
    );
    ctx.expect(
      `${caso} · nunca «sin estilo de sesión»: el atlas no se disparó antes que el estilo`,
      !reg.some((l) => l.includes("sin estilo de sesión")),
      JSON.stringify(reg.filter((l) => l.includes("estilo"))),
    );
    const suyos = posts.slice(desdePost);
    ctx.expect(
      `${caso} · el tile preguntó a la librería CON el estilo de la partida (style_id = ${estilo})`,
      suyos.length > 0 && suyos.every((p) => p.style_id === estilo),
      JSON.stringify(suyos),
    );
  }

  // ══ 1 · Partida nueva, bootstrap vivo ═════════════════════════════════════
  const p1 = posts.length;
  const { styleId } = await nuevaPartida(ctx, { charMode: "vector", renderMode: "vector" });
  if (!styleId) ctx.sinMedir("el título no ofrece estilo para el mundo por defecto");
  await comenzar(ctx);
  const q1 = await esperarElAtlas(ctx, "1 · el tile de la partida nueva termina de preguntar a la librería");
  await afirmarElOrden("1 · bootstrap vivo", p1, styleId);

  // ══ 2 · Partida nueva sobre el mundo pre-generado ═════════════════════════
  await recargarAlTitulo(ctx);
  await regenerarMundo(ctx);
  await recargarAlTitulo(ctx);
  const p2 = posts.length;
  const escenas2 = await escenasDelFalso();
  await nuevaPartida(ctx, { charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  await esperarElAtlas(ctx, "2 · el tile del mundo pre-generado termina de preguntar a la librería");
  ctx.expect(
    "2 · PRECONDICIÓN — el tile salió del mundo pre-generado: el motor no escribió ninguno",
    (await escenasDelFalso()) === escenas2,
    JSON.stringify({ antes: escenas2, ahora: await escenasDelFalso() }),
  );
  await afirmarElOrden("2 · mundo pre-generado", p2, styleId);

  // ══ 3 · Reanudar ══════════════════════════════════════════════════════════
  const p3 = posts.length;
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) ctx.sinMedir("no se pudo reanudar la partida");
  await esperarElAtlas(ctx, "3 · el tile de la partida reanudada termina de preguntar a la librería");
  await afirmarElOrden("3 · reanudar", p3, styleId);
  ctx.log(`1 · ${JSON.stringify(q1)}`);
  await ctx.shot("183-reanudada-con-su-estilo");
}
