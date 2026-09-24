/** EL `ready` REAL DEL BRIDGE y los CLICS RÁPIDOS del título (#731, #673 —
 *  escrito por QA de la tanda BB).
 *
 *  El 198 mide la carrera del refresco del selector ENTREGANDO el `ready` por
 *  el socket desde el guion y RETENIENDO la respuesta de `list_games`
 *  (`qa/lib/retener.mjs`): así el orden malo se da siempre. Lo que ese molde
 *  no dice es que el mismo defecto se dé POR EL CAMINO DEL JUGADOR, con el
 *  `ready` que publica el bridge al acabar una pre-generación de verdad y sin
 *  retener nada. Es justo el camino en que se vio (#731: `regenerarMundo` →
 *  «Volver» → `#ts-new` arrancado), y es lo que aquí se conduce:
 *
 *   A · PRE-GENERACIÓN REAL. Se pide «Generar mundo» al motor falso y un
 *       `MutationObserver` sobre `data-gen-phase` pulsa «← Volver» en la
 *       MISMA vuelta en que el título apunta `ready` (el observador corre en
 *       los microtasks del mismo mensaje, antes de que pueda llegar la
 *       respuesta de la `list_games` que el refresco acaba de pedir). Se
 *       espera a VER esa `list_games` contestada y entregada —no un plazo— y
 *       se afirma que la pantalla sigue siendo el home y que «Nueva partida»
 *       responde. Sin el arreglo de `title-screen.ts`, rojo (medido por QA:
 *       el selector aplasta al home ~15 ms después del clic).
 *   B · DOBLE CLIC en «← Volver». Dos `ir({a:"home"})` seguidos: la pantalla
 *       final es el home, con UN solo «Nueva partida» que responde.
 *   C · «← Volver» y «Nueva partida» EN LA MISMA TAREA. El home se pinta y se
 *       abandona antes de que vuelva su `list_sessions`: la pantalla final es
 *       el selector y la lista tardía del home no lo pisa.
 *
 *  B y C NO se ponen rojos sin el arreglo (medido): son guardas de regresión
 *  del turno de `pedida` —lo que un cambio futuro del enrutador podría romper—
 *  y lo dicen aquí para que nadie lea su verde como prueba del defecto. La
 *  prueba del defecto es A.
 *
 *  `aisla: mundo` porque el bloque A NECESITA que la pre-generación corra
 *  (un mundo ya generado devuelve «¿Regenerar?» y otra secuencia de fases);
 *  `fake-ai` porque el censo de gasto del motor falso tiene que ser de esta
 *  corrida. Cero créditos: motor falso, sin partida y sin Imagen IA.
 */
import { abrirSelectorDeMundos, recargarAlTitulo } from "../lib/sesion.mjs";
import {
  contadores,
  instrumentarRetenciones,
  pantallaDelTitulo,
  soltarYVerResuelto,
} from "../lib/retener.mjs";

export const aisla = ["mundo", "fake-ai"];

const GAME_ID = "alta_fantasia";

/** «Nueva partida» responde: el clic abre el selector. */
async function nuevaPartidaResponde(ctx, nombre) {
  const unico = await ctx.page.evaluate(() => document.querySelectorAll("#ts-new").length);
  ctx.expect(`${nombre}: hay UN solo «Nueva partida» en pantalla`, unico === 1, `hay ${unico}`);
  await ctx.page.click("#ts-new", { timeout: 5_000 });
  const llega = await ctx.page
    .waitForSelector("#ts-gen", { timeout: 30_000 })
    .then(() => true, () => false);
  ctx.expect(`${nombre}: «Nueva partida» responde y abre el selector`, llega);
}

export default async function (ctx) {
  await ctx.page.addInitScript(instrumentarRetenciones);
  await recargarAlTitulo(ctx);

  // ── A · el `ready` REAL y «Volver» en la misma vuelta ───────────────────
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  // `attached` y no «visible»: la línea de progreso nace VACÍA (sin alto) y
  // Playwright la da por oculta hasta que tiene texto.
  await ctx.page.waitForSelector("#ts-gen-progress", { state: "attached", timeout: 30_000 });
  const antes = (await contadores(ctx)).pedidas.list_games ?? 0;
  await ctx.page.evaluate(() => {
    const el = document.getElementById("ts-gen-progress");
    if (!el) throw new Error("no hay #ts-gen-progress que observar");
    window.__qa200 = { pulsado: false, fase: null, pedidasAlFin: null, error: null };
    const obs = new MutationObserver(() => {
      const fase = el.dataset.genPhase ?? "";
      if (fase !== "ready" && fase !== "error") return;
      obs.disconnect();
      window.__qa200.fase = fase;
      window.__qa200.pedidasAlFin = window.__qaRet.pedidas.list_games ?? 0;
      const back = document.querySelector("#ts-back");
      if (!back) {
        window.__qa200.error = "no hay #ts-back en el instante del fin";
        return;
      }
      back.click();
      window.__qa200.pulsado = true;
      // El home se pinta en el MISMO bloque síncrono del clic (`pintarHome`
      // escribe el esqueleto antes de su primer `await`): se apunta aquí para
      // que el guion no tenga que ESPERARLO después — sin el arreglo el home
      // vive ~15 ms y una espera de Playwright llegaría tarde y saldría como
      // ERROR de cortafuegos en vez de como el aserto que lo nombra.
      window.__qa200.homePintado = document.querySelector("#ts-new") !== null;
    });
    obs.observe(el, { attributes: true, attributeFilter: ["data-gen-phase"] });
  });
  await ctx.page.click("#ts-gen-world");
  const armado = await ctx.page.$eval("#ts-gen-world", (b) => b.textContent ?? "");
  if (armado.startsWith("¿Regenerar")) await ctx.page.click("#ts-gen-world");

  const fin = await ctx.waitFor(
    "la pre-generación llega a un estado terminal y «Volver» se pulsa en esa misma vuelta",
    () => (window.__qa200.pulsado || window.__qa200.error ? { ...window.__qa200 } : null),
    240_000,
  );
  ctx.log(`A: ${JSON.stringify(fin)} · list_games antes ${antes}`);
  ctx.expect("A: la pre-generación real termina en ready", fin.fase === "ready", String(fin.fase));
  ctx.expect("A: «Volver» se pulsó en la vuelta del fin", fin.pulsado === true, String(fin.error));
  ctx.expect(
    "A: el ready real lanza el refresco del selector (sale una list_games más)",
    fin.pedidasAlFin === antes + 1,
    `list_games pedidas ${antes} → ${fin.pedidasAlFin}`,
  );
  ctx.expect("A: «Volver» pintó el home en esa misma vuelta", fin.homePintado === true);
  const cuentaA = await soltarYVerResuelto(ctx, { pares: [["list_games", "games_listed"]] });
  const finalA = await pantallaDelTitulo(ctx);
  ctx.log(`A: ${JSON.stringify(cuentaA)} · pantalla final ${finalA}`);
  await ctx.shot("a-home-tras-el-ready-real");
  ctx.expect(
    "A: resuelto el refresco del ready REAL, la pantalla sigue siendo el home y no el selector",
    finalA === "home",
    `pantalla final: ${finalA}`,
  );
  if (finalA === "home") await nuevaPartidaResponde(ctx, "A");
  else await recargarAlTitulo(ctx).then(() => abrirSelectorDeMundos(ctx));

  // ── B · doble clic en «Volver» ──────────────────────────────────────────
  await ctx.page.waitForSelector("#ts-back", { timeout: 30_000 });
  await ctx.page.evaluate(() => {
    const b = document.querySelector("#ts-back");
    b.click();
    b.click();
  });
  await ctx.page.waitForSelector("#ts-new", { timeout: 30_000 });
  const cuentaB = await soltarYVerResuelto(ctx, { pares: [["list_sessions", "sessions_listed"]] });
  const finalB = await pantallaDelTitulo(ctx);
  ctx.log(`B: ${JSON.stringify(cuentaB)} · pantalla final ${finalB}`);
  await ctx.shot("b-home-tras-doble-volver");
  ctx.expect("B: tras el doble clic en «Volver» la pantalla es el home", finalB === "home", finalB);
  await nuevaPartidaResponde(ctx, "B");

  // ── C · «Volver» y «Nueva partida» en la misma tarea ────────────────────
  await ctx.page.waitForSelector("#ts-back", { timeout: 30_000 });
  await ctx.page.evaluate(() => {
    document.querySelector("#ts-back").click();
    const nuevo = document.querySelector("#ts-new");
    if (!nuevo) throw new Error("«Volver» no pintó el home en la misma tarea");
    nuevo.click();
  });
  await ctx.page.waitForSelector("#ts-gen", { timeout: 30_000 });
  const cuentaC = await soltarYVerResuelto(ctx, {
    pares: [["list_sessions", "sessions_listed"], ["list_games", "games_listed"]],
  });
  const finalC = await pantallaDelTitulo(ctx);
  ctx.log(`C: ${JSON.stringify(cuentaC)} · pantalla final ${finalC}`);
  await ctx.shot("c-selector-tras-volver-y-nueva-partida");
  ctx.expect(
    "C: resuelta la lista tardía del home, la pantalla sigue siendo el selector",
    finalC === "selector",
    `pantalla final: ${finalC}`,
  );
  await ctx.page.click("#ts-back");
}
