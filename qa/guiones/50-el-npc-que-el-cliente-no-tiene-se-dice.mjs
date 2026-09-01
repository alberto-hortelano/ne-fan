/** Un NPC que el bridge MUEVE y el cliente no tiene deja de caerse callado
 *  (criterio 6 de #326, QA 2026-08-31).
 *
 *  El defecto que tapaba el `continue` mudo de `main.ts`: `npcSync` rehidrata
 *  en el bridge al npc pacífico de un spawn de runtime, el `state_update` lo
 *  nombra frame a frame, y el cliente lo tiraba sin decir nada — el personaje
 *  **andaba invisible** por el mundo. La justificación escrita («es de un tile
 *  aún no cargado») tapaba justo eso. Desde #326 esa rama escribe en el
 *  registro de errores, y esto es su único candado: `nefan-html` no tiene
 *  tests, y el guion 48 mide el caso BUENO (el pacífico vuelve con cuerpo),
 *  que es el que NO pasa por aquí.
 *
 *  Cómo se llega al estado sin trucar el cliente: se rompe en el SAVE el
 *  bloque `combat` de la entity pacífica —un `data.combat` sin `max_health`,
 *  que es lo que trae un save anterior a la tanda—. Entonces `spawnsDeRuntime`
 *  la rechaza (el cliente no la materializa) mientras `npcSync` la sigue
 *  moviendo: exactamente «el bridge lo nombra y el cliente no lo tiene». El
 *  sabotaje va en el DISCO y por el camino del jugador (reanudar desde la
 *  tarjeta del título), como el guion 46.
 *
 *  Se afirman las dos mitades, porque la segunda es la que hace usable a la
 *  primera: que quede registro, y que quede UNA vez — el `state_update` llega
 *  a 60 fps y sin dedupe por id el panel sería una línea por frame y el
 *  jugador no vería nada más.
 *
 *  PROBADO EN NEGATIVO (2026-08-31): devolviendo el `continue` mudo a
 *  `nefan-html/src/main.ts` (el `if (!ne) continue;` de `result.npcs`), el
 *  primer aserto se pone rojo: el panel solo trae el error de sesión y del
 *  personaje que anda por ahí no dice nada.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el trío del turno 3 lo pone
 *  `labs/narrative/fake-ai-server.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";
const PACIFICO = "Nogala";


export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);
  await ctx.waitFor("el tabernero está en escena", (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null, 60_000, MERCADER);
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  await ctx.absorbe(
    "sincroniza con el turno 2 del motor (que es quien pone al hostil): si no llega, el que se " +
      "queda sin llegar es el turno 3, y eso lo dice el aserto «hay npc pacífico de runtime», " +
      "que es donde vive la medida de este bloque",
    () => ctx.waitFor("turno 2", () => (window.__nefan.enemies().length > 1 ? true : null), 90_000),
  );
  await ctx.nefan("chooseDialogue", 0);
  const nogala = await ctx
    .waitFor("aparece Nogala", (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null, 90_000, PACIFICO)
    .catch(() => null);
  ctx.expect("hay npc pacífico de runtime (precondición)", Boolean(nogala), String(nogala));
  if (!nogala) return;
  await ctx.nefan("advanceDialogue");

  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // Se rompe el bloque `combat` de la ENTITY PACÍFICA: `spawnsDeRuntime` la
  // rechaza (no la materializa el cliente) pero `npcSync` la sigue
  // rehidratando en el bridge, que es exactamente el estado que el criterio 6
  // dice que ya no puede caerse callado.
  const ruta = rutaDelSave(partida.sessionId);
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const rec = save.entities.find((e) => e.id === nogala.id);
  ctx.expect("la entity pacífica está en el save", Boolean(rec), nogala.id);
  if (!rec) return;
  rec.data.combat = { health: 5 };
  writeFileSync(ruta, JSON.stringify(save, null, 2));
  ctx.log(`saboteado ${nogala.id}: data.combat = {health:5} (sin max_health)`);

  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${partida.sessionId}"]`);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor("la escena vuelve", () => (window.__nefan.status().scene ? true : null), 120_000);
  const visto = await ctx
    .waitFor(
      "el cliente DICE que el bridge mueve a alguien que no tiene",
      (id) => {
        const txt = Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "");
        return txt.some((t) => t.includes(id) && t.includes("invisible")) ? txt : null;
      },
      60_000,
      nogala.id,
    )
    .catch(() => null);
  const errores = await ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim()),
  );
  ctx.log(`panel de errores: ${JSON.stringify(errores)}`);
  const npcs = await ctx.nefan("npcs");
  ctx.log(`npcs del cliente: ${JSON.stringify(npcs)}`);
  await ctx.shot("npc-sin-cuerpo");
  ctx.expect(
    "criterio 6: un id que el bridge mueve y el cliente no tiene deja registro (no se cae callado)",
    Boolean(visto),
    JSON.stringify(errores),
  );
  // EXACTAMENTE una, no «como mucho una»: con `<= 1` este aserto se quedaba
  // verde también cuando no había ninguna, o sea justo cuando el defecto está
  // puesto. Así se pone rojo por los dos lados — si no se dice, y si se dice
  // sesenta veces por segundo.
  const invisibles = errores.filter((t) => t.includes("invisible")).length;
  ctx.expect(
    "…y lo dice UNA vez, no una por frame (dedupe por id: el state_update llega a 60 fps)",
    invisibles === 1,
    `entradas con "invisible": ${invisibles}`,
  );
}
