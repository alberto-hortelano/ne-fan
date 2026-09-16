/** #584: el muro puesto por la caída del socket se retira al reconectar.
 * Procesos y disco propios. Se mide la propiedad del muro, no la reanudación
 * del sim: reiniciar el bridge no equivale a reanudar una partida.
 * Negativo: retirar el ocultar() del evento resuelto deja rojo el guion. */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { puertosLibres, esperarPuertoArriba, esperarPuertoLibre } from "../lib/puertos.mjs";
import { nuevaPartida, diagnosticoDeCreditos } from "../lib/sesion.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export default async function (ctx) {
  const [ws, state, ai] = await puertosLibres(3);
  const dir = mkdtempSync(join(tmpdir(), "qa140-"));
  mkdirSync(join(dir, "saves"));
  cpSync(join(RAIZ, "nefan-core/data/games"), join(dir, "games"), { recursive: true });
  cpSync(join(RAIZ, "nefan-core/data/plugins"), join(dir, "plugins"), { recursive: true });
  const env = { ...process.env, NEFAN_BRIDGE_PORT: String(ws), NEFAN_STATE_HTTP_PORT: String(state),
    NEFAN_AI_SERVER: `http://127.0.0.1:${ai}`, NEFAN_SAVES_DIR: join(dir, "saves"),
    NEFAN_GAMES_DIR: join(dir, "games"), PORT: String(ai), STATE_API: `http://127.0.0.1:${state}` };
  const procesos = [];
  async function arrancar(script, port) {
    const salida = [];
    const proc = spawn("npx", ["tsx", script], { cwd: join(RAIZ, "nefan-core"), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    procesos.push(proc);
    proc.stdout.on("data", b => salida.push(String(b)));
    proc.stderr.on("data", b => salida.push(String(b)));
    await esperarPuertoArriba(port, { maxMs: 90000, quien: script, siMuere: () => proc.exitCode !== null ? salida.join("").slice(-1000) : null });
    return proc;
  }
  function parar(proc) {
    try { process.kill(-proc.pid, "SIGTERM"); }
    catch (e) { if (e.code !== "ESRCH") throw e; }
  }
  try {
    await arrancar("../labs/narrative/fake-ai-server.ts", ai);
    const bridge = await arrancar("bridge/ws-server.ts", ws);
    const url = new URL(ctx.page.url());
    url.searchParams.set("bridge", `ws://127.0.0.1:${ws}`);
    url.searchParams.set("state", `http://127.0.0.1:${state}`);
    url.searchParams.set("ai", `http://127.0.0.1:${ai}`);
    await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    await ctx.waitFor("el cliente conoce sus servicios propios", () => !!window.__nefan?.servicios, 30000);
    const gratis = await diagnosticoDeCreditos(ctx);
    if (!gratis.ok) throw new Error(gratis.motivo);
    await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector", renderMode: "vector" });
    await ctx.page.click("#ts-continue");
    await ctx.page.waitForSelector("#ts-start");
    await ctx.page.click("#ts-start");
    await ctx.waitFor("la partida propia está en marcha", () => !window.__nefan.status().title && window.__nefan.status().scene && window.__nefan.sesion().sessionId, 60000);
    await ctx.page.evaluate(() => { window.__qa140SinRecarga = true; });
    parar(bridge);
    await esperarPuertoLibre(ws, { maxMs: 15000 });
    await ctx.waitFor("la caída pone el muro de conexión", () => document.getElementById("narrative-loader")?.classList.contains("visible") && document.getElementById("narrative-loader-title")?.textContent === "Sin conexión con la partida", 20000);
    await arrancar("bridge/ws-server.ts", ws);
    await ctx.waitFor("reconectar retira su muro sin pulsar botones", () => !document.getElementById("narrative-loader")?.classList.contains("visible") && document.getElementById("connection-status")?.textContent === "Bridge", 20000);
    const desde = await ctx.page.evaluate(() => window.__nefan.reloj().frames);
    await ctx.waitFor("la página sigue avanzando tras reconectar", f => window.__nefan.reloj().frames >= f + 120, 20000, desde);
    const estado = await ctx.page.evaluate(() => ({ recarga: !window.__qa140SinRecarga, muro: document.getElementById("narrative-loader")?.classList.contains("visible"), chip: document.getElementById("connection-status")?.textContent }));
    ctx.expect("el muro permanece retirado y el chip conectado, sin recargar", !estado.recarga && !estado.muro && estado.chip === "Bridge", JSON.stringify(estado));
    await ctx.shot("reconexion-sin-muro");
  } finally {
    for (const proc of procesos) parar(proc);
    await Promise.all([ws, state, ai].map(p => esperarPuertoLibre(p, { maxMs: 15000 })));
    rmSync(dir, { recursive: true, force: true });
  }
}
