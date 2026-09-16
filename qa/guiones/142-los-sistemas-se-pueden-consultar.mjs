/** #360: arranque/resume reales; evento controlado por el onmessage de producción
 * para probar actualización, aislamiento entre sesiones y texto no ejecutable. */
import { nuevaPartida, comenzar, recargarAlTitulo, reanudar } from "../lib/sesion.mjs";
export default async function (ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaSockets = [];
    window.WebSocket = class extends Original {
      constructor(...args) { super(...args); window.__qaSockets.push(this); }
    };
  });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  await ctx.page.click("#plugins-open");
  await ctx.waitFor("se ve el sistema economy del arranque", () => !document.querySelector("#plugins-panel").hidden && document.querySelector('[data-plugin-name="economy"]'));
  const posicion = await ctx.nefan("state");
  const reloj = await ctx.nefan("reloj");
  await ctx.holdUntil("up", "el mundo avanza mientras se consulta", t => window.__nefan.reloj().frames >= t + 30, { sim: 5 }, reloj.frames);
  const quieto = await ctx.nefan("state");
  ctx.expect("el panel bloquea caminar", quieto.pos.x === posicion.pos.x && quieto.pos.z === posicion.pos.z);
  const emitir = sessionId => ctx.page.evaluate(({ sessionId }) => {
    const sock = window.__qaSockets.find(s => s.readyState === WebSocket.OPEN && typeof s.onmessage === "function");
    sock.onmessage({ data: JSON.stringify({ type: "narrative_event", eventId: "qa-plugins", sessionId, consequences: [], effects: [{
      kind: "plugin_applied", pluginId: "qa-counter", eventType: "inc", changedPaths: ["slice"], emitted: [],
      plugin: { id: "qa-counter", name: "Contador de prueba", version: 1, slice: { materiales: { hierro: 17 }, disponible: true, nota: '<img src=x onerror="window.__qaXss=true">' } },
    }] }) });
  }, { sessionId });
  await emitir("otra-partida");
  ctx.expect("los datos de otra sesión no entran en el panel", await ctx.page.$('[data-plugin-id="qa-counter"]') === null);
  await emitir(partida.sessionId);
  await ctx.waitFor("el valor del evento llega al panel abierto", () => document.querySelector('[data-plugin-id="qa-counter"]')?.textContent.includes("17"));
  ctx.expect("los valores anidados son texto seguro", await ctx.page.evaluate(() => !window.__qaXss && !document.querySelector("#plugins-panel img") && document.querySelector("#plugins-panel").textContent.includes("<img")));
  await ctx.page.setViewportSize({ width: 500, height: 600 });
  ctx.expect("panel y cierre caben en una ventana estrecha", await ctx.page.$eval("#plugins-panel", e => {
    const r = e.getBoundingClientRect(); const b = e.querySelector("button").getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e.querySelector("button");
  }));
  await ctx.shot("sistemas-en-ventana-estrecha");
  await ctx.page.keyboard.press("Escape");
  ctx.expect("Escape cierra", await ctx.page.$eval("#plugins-panel", e => e.hidden));
  await ctx.page.keyboard.press("p");
  ctx.expect("P vuelve a abrir", await ctx.page.$eval("#plugins-panel", e => !e.hidden));
  await ctx.page.click("#plugins-panel button");
  await ctx.page.setViewportSize({ width: 1280, height: 800 });
  await reanudar(ctx, partida.sessionId);
  await ctx.page.click("#plugins-open");
  ctx.expect("reanudar recupera los sistemas persistidos", await ctx.page.$('[data-plugin-name="economy"]') !== null);
  ctx.expect("el valor de ensayo no persiste ni se hereda", await ctx.page.$('[data-plugin-id="qa-counter"]') === null);
  await ctx.page.click("#plugins-panel button");
  await ctx.page.click("#fps-canvas");
  await ctx.waitFor("el jugador captura el ratón", () => !!document.pointerLockElement);
  await ctx.page.keyboard.press("p");
  await ctx.waitFor("el panel devuelve el cursor para consultar", () => !document.pointerLockElement && !document.querySelector("#plugins-panel").hidden);
  await ctx.page.click("#plugins-panel button");
  await ctx.waitFor("Cerrar devuelve el ratón que soltó el panel", () => !!document.pointerLockElement);
}
