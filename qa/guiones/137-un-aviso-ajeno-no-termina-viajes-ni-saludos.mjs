/** #593: caso latente. Retiene las peticiones e inyecta el aviso por el
 * onmessage real; es un ensayo de concurrencia, no un camino normal de juego. */
import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";

export default async function (ctx) {
  await ctx.page.addInitScript(() => {
    const Original = window.WebSocket;
    window.__qaSockets = [];
    window.__qaPedidos = [];
    window.WebSocket = class extends Original {
      constructor(...args) { super(...args); window.__qaSockets.push(this); }
      send(data) {
        const msg = JSON.parse(data);
        if (window.__qaRetener && ["interact_entity", "player_entered_place"].includes(msg.type)) {
          window.__qaPedidos.push(msg);
          return;
        }
        super.send(data);
      }
    };
  });
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
  const partida = await comenzar(ctx);
  const npc = await ctx.waitFor("hay un hablante", () => window.__nefan.npcs().find(n => n.id === "barkeep") ?? null, 30000);
  await ctx.nefan("setPlayerPos", npc.pos.x + 1.2, npc.pos.z);
  await ctx.waitFor("se ofrece saludar", () => !!document.querySelector('#interact-prompt [data-action="interact"]'), 10000);
  await ctx.page.evaluate(() => { window.__qaRetener = true; });
  const saludar = async () => {
    await ctx.page.evaluate(() => document.querySelector('#interact-prompt [data-action="interact"]').click());
    await ctx.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const entregar = kind => ctx.page.evaluate(({ kind, sessionId }) => {
    const sock = window.__qaSockets.find(s => s.readyState === WebSocket.OPEN && typeof s.onmessage === "function");
    if (!sock) throw new Error("no hay socket del juego");
    sock.onmessage({ data: JSON.stringify({ type: "narrative_status", phase: "error", kind, sessionId, message: "Aviso de ensayo" }) });
  }, { kind, sessionId: partida.sessionId });
  await saludar();
  await ctx.waitFor("saludo pendiente", () => window.__qaPedidos.filter(m => m.type === "interact_entity").length === 1, 5000);
  await entregar("combatientes");
  await saludar();
  ctx.expect("un aviso de enemigos no permite duplicar el saludo pendiente",
    await ctx.page.evaluate(() => window.__qaPedidos.filter(m => m.type === "interact_entity").length === 1));
  await entregar("consequences");
  await ctx.page.click("#narrative-loader-dismiss");
  await saludar();
  await ctx.waitFor("el fallo propio sí libera el saludo", () => window.__qaPedidos.filter(m => m.type === "interact_entity").length === 2, 5000);
  await ctx.page.$eval("#travel-panel button.travel-exit", b => b.click());
  await ctx.waitFor("viaje pendiente", () => window.__nefan.viaje?.pedido, 5000);
  await entregar("combatientes");
  ctx.expect("el aviso de enemigos conserva el viaje pendiente", await ctx.page.evaluate(() => window.__nefan.viaje.error === null));
  await entregar("tile");
  ctx.expect("el fallo de viaje sí queda registrado", await ctx.page.evaluate(() => window.__nefan.viaje.error === "Aviso de ensayo"));
}
