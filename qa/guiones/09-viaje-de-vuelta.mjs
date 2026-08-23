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
 *   2. clicar la vuelta devuelve al jugador al tile de partida, en suelo libre,
 *      y lo hace VIAJANDO (el ledger de `__nefan.viaje` prueba que la escena
 *      del destino se difundió y que el spawn se aplicó, no que el jugador
 *      apareciera allí por otra vía);
 *   3. ya de vuelta, el panel vuelve a ofrecer el destino y sigue sin ofrecer
 *      el lugar donde está — el bucle ida/vuelta se puede repetir.
 *
 *  Un panel que ofrece "viajar a donde ya estás" no es solo feo: es la vía de
 *  viaje viva del cliente, y mientras muestre las salidas de otro lugar el
 *  destino de verdad no es clicable.
 *
 *  Cero créditos: preset 5, el motor es el fake-ai-server.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";

const GAME_ID = "alta_fantasia";

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

/** Qué paso del viaje está muerto, leído del ledger que el juego RECUERDA
 *  (`window.__nefan.viaje`). Sin esto, un viaje que no llega NUNCA y uno que
 *  tarda dan exactamente el mismo veredicto —«timeout esperando… (último
 *  valor: null)»—, que es lo que dejó el cuelgue del 12,5 % sin diagnosticar
 *  durante ocho corridas. */
function pasoMuerto(l, tileAnterior) {
  if (!l) return "el cliente no registró el viaje: no llegó ni a pedírselo al bridge";
  if (l.error) return `el bridge abortó el viaje: ${l.error}`;
  if (!l.encolado && !l.escenaRecibida)
    return "el bridge no acusó recibo (ni «Viajando a…» ni escena): la petición murió antes de la cola";
  if (!l.escenaRecibida)
    return `el bridge encoló el viaje (${l.encolado}) pero nunca difundió la escena del destino: el job murió en la cola`;
  if (!l.spawnAplicado)
    return `la escena ${l.escenaRecibida} llegó, pero nadie pidió el spawn: el jugador se quedó donde estaba`;
  return `el spawn se aplicó en ${JSON.stringify(l.spawnAplicado)} y aun así el jugador sigue en ${tileAnterior}`;
}

/** El viaje ha terminado cuando el JUGADOR está en otro tile — no cuando
 *  llega la escena (el scene_init se adelanta al `ready` que trae el spawn).
 *  Se espera por ESTADO contra el ledger: un fallo declarado corta al
 *  instante, y el tope de 240 s queda como cortafuegos de deadlock, no como
 *  condición de parada. Al saltar, el fallo NOMBRA el paso muerto. */
async function esperarLlegada(ctx, tileAnterior, desc) {
  const roto = (l) => new Error(`${desc}: ${pasoMuerto(l, tileAnterior)} · ledger=${JSON.stringify(l)}`);
  const r = await ctx
    .waitFor(
      desc,
      (anterior) => {
        const t = window.__nefan.currentTile;
        const v = window.__nefan.viaje;
        // Viaje declarado roto por el bridge: no hay nada más que esperar.
        if (v && v.error) return { __roto: v };
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
    )
    .catch(async () => {
      throw roto(await ctx.nefan("viaje"));
    });
  if (r.__roto) throw roto(r.__roto);
  r.ledger = await ctx.nefan("viaje");
  return r;
}

/** El viaje se hizo VIAJANDO: el bridge difundió la escena del destino y pidió
 *  el spawn. Sin esto, llegar al tile andando (o por un spawn de otra cosa)
 *  contaría como viaje bueno. */
function comprobarLedger(ctx, llegada, desc) {
  const l = llegada.ledger;
  ctx.log(`viaje: ${JSON.stringify(l)}`);
  ctx.expect(
    `${desc}: el bridge difundió la escena del destino y pidió el spawn`,
    Boolean(l && l.escenaRecibida && l.spawnAplicado && !l.error),
    JSON.stringify(l),
  );
}

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
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
  comprobarLedger(ctx, enDestino, "la ida");
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
  comprobarLedger(ctx, regreso, "la vuelta");
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
