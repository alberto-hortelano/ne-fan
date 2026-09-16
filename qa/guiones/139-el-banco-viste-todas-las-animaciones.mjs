/** #498: el banco no dispara el fusible de producción por carecer de walk/run. */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

export const aisla = ["fake-ai"];
export default async function (ctx) {
  const fallos = [];
  let peticion;
  ctx.page.on("request", r => {
    if (r.url().includes("/skin_sprite_sheet") && r.method() === "POST") peticion ??= { url: r.url(), body: r.postDataJSON() };
  });
  ctx.page.on("response", r => {
    if (r.url().includes("/skin_sprite_sheet") && !r.ok()) fallos.push(`${r.status()} ${r.url()}`);
  });
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "image", renderMode: "vector" });
  await comenzar(ctx);
  const npc = await ctx.waitFor("hay un tabernero", () => window.__nefan.npcs().find(n => n.id === "barkeep") ?? null, 30000);
  await ctx.nefan("setPlayerPos", npc.pos.x + 1.2, npc.pos.z);
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible, 30000);
  await ctx.nefan("chooseDialogue", 0);
  const vestidos = await ctx.waitFor("tres personajes tienen idle, walk y run listas", () => {
    const skins = window.__nefan.skins;
    return skins.length >= 3 && skins.every(s => !s.failed && ["idle", "walk", "run"].every(a => s.ready.includes(a))) ? skins : null;
  }, 90000);
  ctx.log(`personajes vestidos: ${JSON.stringify(vestidos)}`);
  ctx.expect("ninguna hoja del banco falla por falta de animación", fallos.length === 0, fallos.join("\n"));
  const anims = await ctx.page.evaluate(async () => (await (await fetch("/sprites/index.json")).json()).required.anims);
  for (const anim of anims) {
    const r = await ctx.page.request.post(peticion.url, { data: { ...peticion.body, anim } });
    const hoja = await r.json();
    ctx.expect(`el banco sirve la animación del contrato ${anim}`, r.ok() && hoja.meta?.anim === anim, JSON.stringify(hoja).slice(0, 200));
    if (!r.ok()) continue;
    const frame = await ctx.page.request.get(new URL(hoja.frame_urls[0][0], peticion.url).toString());
    ctx.expect(`su frame ${anim} existe`, frame.ok());
  }
  const registro = await ctx.page.$eval("#error-log", e => e.textContent ?? "");
  ctx.expect("el banco no dispara el fusible de skins", !registro.includes("skins IA desactivados"), registro);
}
