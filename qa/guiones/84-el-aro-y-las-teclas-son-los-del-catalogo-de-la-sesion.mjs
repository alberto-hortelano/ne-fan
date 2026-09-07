/** El HUD de combate de una PARTIDA (no de una fixture): la barra es el
 *  catálogo del sistema de la sesión, las teclas 1..N del TECLADO REAL eligen
 *  el ataque de su posición, una tecla fuera del catálogo no cambia nada, y el
 *  aro del telegraph lleva los parámetros del ataque ELEGIDO calculados por
 *  core con el arma del jugador.
 *
 *  Nació con el corte 7 de #358 (`ui/hud-de-combate.ts`): lo que se movió es
 *  exactamente esto —catálogo → barra, catálogo → mapeo 1..N del proveedor, y
 *  `parametrosSeleccionados()` para el aro—, y hasta hoy ningún guion lo
 *  ejercía con el proveedor de teclado (el 03 usa el driver de bench sobre una
 *  fixture; el 22/23 miran la geometría del aro por dentro, no contra core).
 *
 *  SE CORRE SIN `?input=scripted`, como el 37 y el 43: el mapeo «qué tecla pide
 *  qué ataque» vive en `KeyboardInputProvider.setAttackBindings`, y el driver
 *  de bench no pasa por él.
 *
 *  La referencia del aro es `getEffectiveParams` de nefan-core (`dist/`): la
 *  misma función que acaba llamando el cliente, con `short_sword`, que es el
 *  arma con la que hoy nace el jugador (`game-store.ts`). Si el cliente pintara
 *  el aro con otra arma —o con otro ataque que el elegido— la distancia óptima
 *  no casa: espada/manos difieren en los cinco ataques (1,3/1,2 · 1,7/1,6 · …).
 *  Desde #504 el arma la dice el BRIDGE en cada `state_update` y el aro lo
 *  calcula `combat/params-de-telegraph.ts` (core), así que este guion mide
 *  además que ese dato llegue vivo por el wire: con el arma sin viajar, el
 *  cliente no tendría de dónde sacarla.
 *
 *  EN NEGATIVO (2026-09-06): con `armaDelJugador: "unarmed"` en `main.ts` —la
 *  dep de entonces; hoy es `arma()` y sale del wire— los cinco asertos del aro
 *  salen rojos (aro 1.2 · core 1.3, …); con `key: String(i + 2)` en el módulo,
 *  el de «un botón por ataque con su tecla».
 *
 *  Cero créditos: preset `e2e-sin-creditos`, `charMode: "vector"` (sin skins).
 *  Se ataca al aire a propósito: el aro se pinta con o sin objetivo, y así el
 *  guion no depende de dónde esté el bandido. */
import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARMA_DEL_JUGADOR = "short_sword";

/** La referencia de core, o `null` si `nefan-core/dist` no está construido. */
async function referenciaDeCore() {
  try {
    const { getEffectiveParams, loadConfig } = await import(
      path.join(RAIZ, "nefan-core", "dist", "src", "combat", "combat-data.js")
    );
    const config = loadConfig(JSON.parse(readFileSync(path.join(RAIZ, "nefan-core", "data", "combat_config.json"), "utf8")));
    return (tipo) => getEffectiveParams(tipo, config.attack_types, config.weapons[ARMA_DEL_JUGADOR]);
  } catch (err) {
    return { error: String(err) };
  }
}

const barra = async (ctx) => (await ctx.nefan("ui.actions")).attack ?? [];
const elegido = async (ctx) => (await ctx.nefan("state")).input.selectedAttack;

export default async function (ctx) {
  const esperado = await referenciaDeCore();
  if (typeof esperado !== "function") {
    ctx.sinMedir(`sin \`nefan-core/dist\` no hay referencia de core para el aro (cd nefan-core && npm run build): ${esperado.error}`);
  }

  // ── 0 · El proveedor de TECLADO ─────────────────────────────────────────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (el mapeo 1..N vive ahí)",
    await ctx.page.evaluate(() => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver),
    url.toString(),
  );
  await esperarTituloListo(ctx);

  // ── 1 · Con el título delante: la barra estándar ya está, las teclas no entran
  const enTitulo = await barra(ctx);
  ctx.expect(
    "sin sesión la barra ya lleva el catálogo estándar con «quick» activo",
    enTitulo.length === 5 && enTitulo[0].id === "attack:quick" && enTitulo[0].active,
    JSON.stringify(enTitulo.map((b) => [b.key, b.id, b.active])),
  );
  await ctx.page.keyboard.press("3");
  ctx.expect("con el título delante la tecla 3 no cambia el ataque (#285)", (await elegido(ctx)) === "quick", await elegido(ctx));

  // ── 2 · La partida: barra = catálogo de la SESIÓN ─────────────────────────
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  const st = await ctx.nefan("state");
  const catalogo = st.attackCatalog;
  const botones = await barra(ctx);
  ctx.log(`sistema ${st.combatSystem} · catálogo ${catalogo.join(",")} · botones ${botones.map((b) => `${b.key}:${b.label}`).join(" ")}`);
  ctx.expect("la sesión trae su sistema de combate y su catálogo", st.combatSystem === "standard" && catalogo.length === 5, `${st.combatSystem} · ${catalogo.length}`);
  ctx.expect(
    "un botón por ataque del catálogo, en su orden y con su tecla 1..N",
    botones.length === catalogo.length && botones.every((b, i) => b.key === String(i + 1) && b.id === `attack:${catalogo[i]}`),
    JSON.stringify(botones.map((b) => [b.key, b.id])),
  );
  const registro = await ctx.page.$$eval("#combat-log div", (els) => els.map((e) => e.textContent));
  ctx.expect(
    "el registro dice qué sistema y cuántos ataques («Combate: standard (5 ataques)»)",
    registro.some((l) => l.includes(`Combate: standard (${catalogo.length} ataques)`)),
    JSON.stringify(registro.slice(-4)),
  );

  // ── 3 · Las teclas REALES: 1..N eligen; fuera del catálogo, nada ──────────
  const pulsadas = [];
  for (let i = catalogo.length; i >= 1; i--) {
    await ctx.page.keyboard.press(String(i));
    pulsadas.push({ tecla: i, elegido: await elegido(ctx), activo: (await barra(ctx)).find((b) => b.active)?.id });
  }
  ctx.expect(
    "cada tecla 1..N elige el ataque de su posición y la barra lo marca",
    pulsadas.every((p) => p.elegido === catalogo[p.tecla - 1] && p.activo === `attack:${catalogo[p.tecla - 1]}`),
    JSON.stringify(pulsadas),
  );
  await ctx.page.keyboard.press("3");
  for (const t of ["6", "9", "0"]) await ctx.page.keyboard.press(t);
  const activos = (await barra(ctx)).filter((b) => b.active).map((b) => b.id);
  ctx.expect(
    "las teclas 6/9/0 (fuera del catálogo) no cambian la selección ni la barra",
    (await elegido(ctx)) === "medium" && activos.length === 1 && activos[0] === "attack:medium",
    `${await elegido(ctx)} · ${JSON.stringify(activos)}`,
  );
  await ctx.page.click('#action-bar button[data-action="attack:defensive"]');
  ctx.expect("el click en un botón de la barra elige ese ataque (mismo camino que la tecla)", (await elegido(ctx)) === "defensive", await elegido(ctx));
  await ctx.shot("barra-de-la-sesion");

  // ── 4 · El ratón capturado: la barra se queda de recordatorio ─────────────
  await ctx.page.click("#fps-canvas", { position: { x: 400, y: 300 } });
  await ctx.expectEspera(
    "el click en el mundo captura el ratón y la barra se atenúa (data-locked)",
    true,
    () => (window.__nefan.puedeAtacar().raton && document.getElementById("game-ui")?.dataset.locked === "true" ? true : null),
    { ms: 10_000 },
  );

  // ── 5 · El aro lleva los params del ataque ELEGIDO, con el arma del jugador
  for (let i = 0; i < catalogo.length; i++) {
    const tipo = catalogo[i];
    await ctx.page.keyboard.press(String(i + 1));
    const antes = (await ctx.nefan("fps")).telegraphEpisode?.episode ?? 0;
    await ctx.page.mouse.down();
    await ctx.page.mouse.up();
    const { ocurrio, ultimo: ep } = await ctx.expectEspera(
      `LMB con «${tipo}» abre y cierra un episodio del telegraph`,
      true,
      (n) => {
        const ep = window.__nefan.fps().telegraphEpisode;
        return ep && ep.episode > n && ep.ended ? ep : null;
      },
      { ms: 10_000, arg: antes },
    );
    const ref = esperado(tipo);
    ctx.expect(
      `el aro de «${tipo}» lleva la distancia óptima que core calcula para ${ARMA_DEL_JUGADOR}`,
      ocurrio && ep && Math.abs(ep.optimalDistance - ref.optimal_distance) < 1e-6,
      `aro ${ep?.optimalDistance} · core ${ref.optimal_distance} · wind-up ${ep?.windupFrames} f`,
    );
  }
  await ctx.shot("tras-los-cinco-aros");
}
