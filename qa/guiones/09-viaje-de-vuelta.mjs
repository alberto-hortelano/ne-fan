/** El viaje del panel «Salidas», DE VUELTA: ida y regreso al lugar de origen.
 *
 *  El guion 08 cubre la ida a un lugar que todavía no existe (se ancla a un
 *  tile libre del plano y se genera). Lo que nadie comprobaba andando es la
 *  otra mitad del bucle, que es justo lo que un jugador hace a continuación:
 *  volver por donde vino. Ese camino NO genera nada — entra por la rama de
 *  escena CACHEADA de `handlePlayerEnteredPlace`— y las salidas que se
 *  difunden con ella se resuelven por otra vía que las del tile recién
 *  generado.
 *
 *  Lo que este guion protege, andando y no leyendo JSON:
 *   1. desde el destino, el panel ofrece la vuelta y NO ofrece el lugar donde
 *      el jugador ya está (ofrecerlo significa que el panel está pintando las
 *      salidas de OTRO lugar);
 *   2. clicar la vuelta devuelve al jugador al tile de partida, en suelo libre;
 *   3. ya de vuelta, el panel vuelve a ofrecer el destino y sigue sin ofrecer
 *      el lugar donde está — el bucle ida/vuelta se puede repetir.
 *
 *  Un panel que ofrece "viajar a donde ya estás" no es solo feo: es la vía de
 *  viaje viva del cliente 2D, y mientras muestre las salidas de otro lugar el
 *  destino de verdad no es clicable.
 *
 *  Cero créditos: preset 5, el motor es el fake-ai-server.
 */
import { abrirSelectorDeMundos, nuevaPartida, comenzar } from "../lib/sesion.mjs";

const GAME_ID = "alta_fantasia";

/** Pre-genera el mundo desde el título (mismo motivo que en el guion 08: el
 *  world map viaja en el snapshot de `data/games/{id}/world/` y un snapshot
 *  escrito antes de que el motor de bench sembrara el destino no lo trae).
 *  Copiado a propósito en vez de compartido: `qa/lib/` lo importan varios
 *  guiones y tocarlo aquí cambiaría el 08. */
async function regenerarMundo(ctx) {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click(`#ts-view [data-view="overworld"]`);

  await ctx.page.click("#ts-gen-world");
  const armado = await ctx.page.$eval("#ts-gen-world", (b) => b.textContent ?? "");
  if (armado.startsWith("¿Regenerar")) await ctx.page.click("#ts-gen-world");

  await ctx.waitFor(
    "la pre-generación del mundo termina",
    () => {
      const t = document.getElementById("ts-gen-progress")?.textContent ?? "";
      return /generado:/.test(t) || /falló|error/i.test(t) ? t : null;
    },
    240_000,
  );
  await ctx.page.click("#ts-back");
}

/** Estado que el jugador puede ver: en qué tile está, dónde, y qué le ofrece
 *  el panel de salidas. */
const mirar = () => ({
  tile: window.__nefan.currentTile,
  pos: window.__nefan.state().pos,
  rect: window.__nefan.scene?.world_rect ?? null,
  exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
});

/** Pulsa el botón del panel que nombra `nombre` (el camino del jugador: un
 *  click en «Salidas», no una llamada a la API). */
async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) throw new Error(`el panel no ofrece "${nombre}"; ofrece: ${JSON.stringify(botones)}`);
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
}

/** El viaje ha terminado cuando el JUGADOR está en otro tile — no cuando
 *  llega la escena (el scene_init se adelanta al `ready` que trae el spawn). */
async function esperarLlegada(ctx, tileAnterior, desc) {
  return ctx.waitFor(
    desc,
    (anterior) => {
      const t = window.__nefan.currentTile;
      if (!t || t === anterior) return null;
      return {
        tile: t,
        pos: window.__nefan.state().pos,
        rect: window.__nefan.scene?.world_rect ?? null,
        exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
      };
    },
    240_000,
    tileAnterior,
  );
}

/** El home del título pinta el botón "Nueva partida" ANTES de colgarle su
 *  handler (`renderHome` lo enchufa tras `await listSessions()` y tras pintar
 *  las tarjetas de saves). Clicarlo dentro de esa ventana no hace nada y no
 *  avisa de nada. Esperar al "Bridge OK" del status es esperar por ESTADO, que
 *  es la regla de estos guiones. Sin esto el guion es una moneda al aire en
 *  cuanto la máquina acumula partidas guardadas. */
async function homeListo(ctx) {
  await ctx.waitFor(
    "el título termina de cargar sus saves (status 'Bridge OK')",
    () => /Bridge OK/.test(document.getElementById("ts-status")?.textContent ?? ""),
    60_000,
  );
}

export default async function (ctx) {
  await homeListo(ctx);
  await regenerarMundo(ctx);
  await homeListo(ctx);
  await nuevaPartida(ctx, { gameId: GAME_ID, view: "overworld", charMode: "vector" });
  await comenzar(ctx);

  // ── Punto de partida ────────────────────────────────────────────────────
  const partida = await ctx.page.evaluate(mirar);
  ctx.log(`partida: ${partida.tile} · salidas ${JSON.stringify(partida.exits.map((e) => e.place_id))}`);
  ctx.expect("el panel «Salidas» ofrece un destino desde el punto de partida", partida.exits.length > 0);
  if (!partida.exits.length) return;
  const destino = partida.exits[0];

  // ── 1. Ida ──────────────────────────────────────────────────────────────
  await pulsarSalida(ctx, destino.name);
  const enDestino = await esperarLlegada(ctx, partida.tile, "el jugador llega al tile del destino").catch(
    (err) => {
      ctx.expect(`clicar «${destino.name}» lleva al jugador al destino`, false, err.message);
      return null;
    },
  );
  if (!enDestino) {
    await ctx.shot("ida-fallida");
    return;
  }
  ctx.log(`en el destino: ${enDestino.tile} · salidas ${JSON.stringify(enDestino.exits.map((e) => e.place_id))}`);
  await ctx.shot("en-el-destino");

  ctx.expect(
    `el panel NO ofrece viajar al lugar donde el jugador ya está (${destino.place_id})`,
    !enDestino.exits.some((e) => e.place_id === destino.place_id),
    JSON.stringify(enDestino.exits),
  );
  ctx.expect("el panel ofrece la vuelta", enDestino.exits.length > 0, JSON.stringify(enDestino.exits));
  if (!enDestino.exits.length) return;
  const vuelta = enDestino.exits.find((e) => e.place_id !== destino.place_id) ?? enDestino.exits[0];

  // ── 2. Vuelta ───────────────────────────────────────────────────────────
  await pulsarSalida(ctx, vuelta.name);
  const regreso = await esperarLlegada(ctx, enDestino.tile, "el jugador vuelve al tile de partida").catch(
    (err) => {
      ctx.expect(`clicar «${vuelta.name}» devuelve al jugador al punto de partida`, false, err.message);
      return null;
    },
  );
  if (!regreso) {
    await ctx.shot("vuelta-fallida");
    return;
  }
  ctx.log(`de vuelta: ${regreso.tile} · salidas ${JSON.stringify(regreso.exits.map((e) => e.place_id))}`);
  await ctx.shot("de-vuelta");
  ctx.expect("la vuelta acaba en el tile de partida", regreso.tile === partida.tile, regreso.tile);
  ctx.expect(
    "el punto de aparición de la vuelta no es sólido (no aparece incrustado)",
    (await ctx.nefan("probeCollide", regreso.pos.x, regreso.pos.z)) === false,
    JSON.stringify(regreso.pos),
  );

  // ── 3. El panel del origen vuelve a ser el del origen ────────────────────
  ctx.expect(
    `de vuelta, el panel NO ofrece viajar al lugar donde el jugador está (${vuelta.place_id})`,
    !regreso.exits.some((e) => e.place_id === vuelta.place_id),
    JSON.stringify(regreso.exits),
  );
  ctx.expect(
    `de vuelta, el panel vuelve a ofrecer el destino (${destino.place_id})`,
    regreso.exits.some((e) => e.place_id === destino.place_id),
    JSON.stringify(regreso.exits),
  );
}
