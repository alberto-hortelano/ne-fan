/** LA ÚNICA REGLA DE GASTO DEL JUGADOR, POR EL LADO QUE NADIE MEDÍA: la `N`.
 *
 *  La frontera (`nefan-core/src/scene/frontera.ts` desde la PR 2 de #241,
 *  #512) es el único sitio del juego donde una tecla dispara un
 *  `generate_scene` del motor y, con imagen IA, el atlas del tile. Su mitad
 *  cara —la `Y`— ya tiene quien la mire: el 05 y el 42 la aceptan por el
 *  driver de bench y el 58 con la tecla REAL. Lo que hasta hoy no tenía
 *  ocupante es **la otra mitad**, que es justo la que protege la cartera:
 *
 *  1 · **`N` no gasta.** Rechazar retira la pregunta y NO manda ni una
 *      petición al bridge. Un `rechazar()` que se olvidara de vaciar la
 *      propuesta —o un cliente que confundiera las dos ramas de
 *      `consumeTileConfirm`/`consumeTileDecline`— generaría mundo (y en el
 *      juego de verdad, cobraría) con el jugador diciendo que no.
 *  2 · **El rechazo se RECUERDA mientras se sigue cerca.** Acercarse más al
 *      mismo borde no vuelve a preguntar: sin el conjunto de rechazados, la
 *      pregunta reaparecería en el fotograma siguiente y el jugador tendría
 *      que decir que no en cada paso, pegado a un muro que no se puede cruzar.
 *  3 · **Y CADUCA al alejarse.** Rechazo ≠ veto permanente: a más de
 *      `PROPONER_A_M` (16 m) el rechazo se olvida y al volver se vuelve a
 *      ofrecer. Un `#rechazados` que no se limpiara dejaría ese borde muerto
 *      para el resto de la partida — el mundo dejaría de continuar por ahí y
 *      nada lo diría.
 *  4 · **Rechazar un borde no veta el otro.** En la esquina hay dos vecinos
 *      que faltan: decir que no al que se ofrece deja al de al lado ofreciéndose
 *      en el fotograma siguiente. Un `#rechazados` por POSICIÓN en vez de por
 *      clave de tile —o un `rechazar()` que apuntara la propuesta equivocada—
 *      cerraría los dos bordes de golpe y el jugador se quedaría encajonado en
 *      la esquina sin saber por qué.
 *
 *  Las cuatro se conducen con el TECLADO REAL (sin `?input=scripted`, como el
 *  58, el 83 y el 84): la `N` de la propuesta la lee solo
 *  `KeyboardInputProvider`, tras el mismo gate `propuestaDeTileAbierta()` que
 *  la `Y`, y el driver de bench no pasa por él.
 *
 *  LO QUE ESTE GUION NO PUEDE MEDIR, y dónde vive. Las tres ramas que necesitan
 *  un tile QUE TARDE: la promoción a **`blocking`** a 2 m, el **timeout de
 *  5 min** y el **cooldown de 15 s tras un error del bridge**. El motor falso
 *  del banco contesta al instante, así que el tile ya está instalado antes de
 *  que el jugador llegue al muro (y un tile que existe ni se mira: la promoción
 *  deja de tener sentido); y decidir que falle o que tarde es una variable de
 *  entorno de SU proceso (`TILE_MODE=error`, `TILE_DELAY_MS`) que el guion no
 *  arranca — falsear `performance.now()` desde la página movería el reloj del
 *  game loop entero, y eso ya no sería el juego. Las tres viven en
 *  `nefan-core/test/frontera.test.ts` (reloj inyectado) y QA las comprobó a mano
 *  en el juego real con esas dos variables (qa-2.md de #512: `blocking` a 1,61 m
 *  y solo uno en 40 fotogramas; timeout a los 300 s exactos con su aviso;
 *  propuesta de vuelta al segundo 15 tras el error, con cero re-peticiones).
 *
 *  PROBADO EN NEGATIVO (QA, 2026-09-07, un sabotaje cada vez y revertido después):
 *   · `rechazar()` sin `this.#rechazados.add(this.#propuesta.key)` — la `N`
 *     olvida el rechazo: **6 asertos rojos**, entre ellos «tras la `N` el tile
 *     queda apuntado como RECHAZADO» (`[]`), «la propuesta se retira» y
 *     «acercarse MÁS al borde rechazado no vuelve a preguntar» (la pregunta
 *     vuelve en el fotograma siguiente, a 0,52 m del muro).
 *   · `rechazar()` apuntando también el tile del borde de al lado: **2 rojos**
 *     — «rechazar el borde de al lado NO lo veta» (`proposal: null` en la
 *     esquina) y «el rechazado es exactamente el que se rechazó»
 *     (`["tile_1_0","tile_0_1"]`). Los otros trece siguen verdes: miden otra cosa.
 *   · Y el que sujeta la cartera, en el cliente: `deps.frontier.rechazar()` →
 *     `deps.frontier.confirmar(ahora, pedir)` en `world/frontera-del-jugador.ts`
 *     (confundir las dos ramas de la respuesta): **6 rojos**, el primero «tras
 *     la `N` NO sale ninguna petición al bridge: decir que no no gasta», con el
 *     `prefetch` que no debería existir pegado en el detalle.
 *
 *  Cero créditos: motor falso (`aisla: ["saves", "fake-ai"]`), personajes en
 *  modo vector. */

import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Los `request_tile` que SALEN por el socket, con su motivo. El ledger de
 *  tiles (`__nefan.tileEpisodios`) apunta el pedido pero NO el `reason`, y
 *  `blocking` vs `prefetch` es justo lo que aquí se mide. Molde del 85. */
async function espiarElSocket(ctx) {
  await ctx.page.addInitScript(() => {
    window.__peticionesDeTile = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      send(datos) {
        try {
          const m = JSON.parse(datos);
          if (m.type === "request_tile") {
            window.__peticionesDeTile.push({ tx: m.tx, ty: m.ty, reason: m.reason, edge: m.edge });
          }
        } catch {
          // no-JSON (binario): no es una petición de tile
        }
        return super.send(datos);
      }
    };
  });
}

const peticiones = (ctx) => ctx.page.evaluate(() => window.__peticionesDeTile ?? []);
const frontera = (ctx) => ctx.page.evaluate(() => window.__nefan.frontier);
const donde = (ctx) => ctx.page.evaluate(() => ({ ...window.__nefan.playerPos }));
const laPregunta = (ctx) =>
  ctx.page.evaluate(() => window.__nefan.ui.actions().confirm.map((a) => a.label));

/** Avanza `n` fotogramas del bucle: la unidad de espera de este guion, porque
 *  la frontera se recalcula UNA vez por `tick` y no por reloj de pared. */
async function frames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  return ctx.waitFor(
    `el bucle avanza ${n} fotograma(s)`,
    (m) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= m.desde + m.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** Mantiene una tecla `n` fotogramas y la suelta pase lo que pase. */
async function mantener(ctx, tecla, nFrames = 4) {
  await ctx.page.keyboard.down(tecla);
  try {
    await frames(ctx, nFrames);
  } finally {
    await ctx.page.keyboard.up(tecla);
  }
}

/** Anda al este hasta pegarse al muro de la frontera: se para cuando el
 *  jugador deja de avanzar (la colisión direccional lo retiene), no tras un
 *  número de fotogramas — cuántos hagan falta depende de la velocidad y del
 *  reloj del bucle, y con una cuenta fija el bloque medía a veces a 6 m. */
async function andarHastaElMuro(ctx, bordeEste, maxMs = 60_000) {
  await ctx.page.keyboard.down("w");
  try {
    await ctx.absorbe(
      "el tope contra el muro se AFIRMA justo después con la distancia leída; esta espera solo lleva al jugador hasta ahí",
      () =>
        ctx.waitFor(
          "el jugador se pega al muro de la frontera y deja de avanzar",
          (b) => {
            const x = window.__nefan.playerPos.x;
            const previo = window.__ultimaX;
            window.__ultimaX = x;
            return b - x < 2 && previo !== undefined && Math.abs(x - previo) < 0.01 ? { x } : null;
          },
          maxMs,
          bordeEste,
        ),
    );
  } finally {
    await ctx.page.keyboard.up("w");
    await ctx.page.evaluate(() => { delete window.__ultimaX; });
  }
}

/** Anda al este hasta que haya propuesta sobre la mesa, y devuelve a qué
 *  distancia del borde nació. `null` si no llega a haberla. */
async function andarHastaLaPropuesta(ctx, bordeEste, maxMs = 120_000) {
  await ctx.page.keyboard.down("w");
  try {
    const { ocurrio, ultimo } = await ctx.expectEspera(
      "andando hacia el borde, el juego PROPONE generar la zona vecina",
      true,
      () => window.__nefan.frontier.proposal ?? null,
      { ms: maxMs },
    );
    if (!ocurrio) return null;
    const pos = await donde(ctx);
    return { propuesta: ultimo, distancia: bordeEste - pos.x };
  } finally {
    await ctx.page.keyboard.up("w");
  }
}

export default async function (ctx) {
  await espiarElSocket(ctx);

  // ── 0 · El proveedor de TECLADO: la `N` de la propuesta solo vive ahí ────
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (la N de la propuesta se lee ahí)",
    await ctx.page.evaluate(
      () => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver,
    ),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor("el mundo está pintado", () => window.__nefan.ready());

  const plano = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    return { origin: g?.origin ?? null, mpc: g?.meters_per_cell ?? null, cols: g?.grid?.[0]?.length ?? 0 };
  });
  if (!Number.isFinite(plano.mpc) || !Array.isArray(plano.origin) || plano.cols === 0) {
    return ctx.sinMedir(`el grid del tile no da origen/paso: ${JSON.stringify(plano)}`);
  }
  /** Borde ESTE del tile de partida, en metros de mundo. */
  const bordeEste = plano.origin[0] + plano.cols * plano.mpc;
  ctx.log(`borde este del tile de partida en x=${bordeEste} m`);

  // ── 1 · La propuesta nace acercándose, y no antes ────────────────────────
  await ctx.nefan("setPlayerPos", bordeEste - 19, 0);
  await ctx.nefan("setYaw", Math.PI / 2); // mirando al este
  await frames(ctx, 4);
  const lejos = await frontera(ctx);
  ctx.expect(
    "a 19 m del borde no hay propuesta (si la hubiera, el resto del guion no mediría nada)",
    lejos.proposal === null,
    JSON.stringify(lejos),
  );

  const primera = await andarHastaLaPropuesta(ctx, bordeEste);
  if (!primera) return ctx.sinMedirBloque("sin propuesta no hay `N` que medir");
  ctx.log(`propuesta ${primera.propuesta.key} a ${primera.distancia.toFixed(2)} m del borde`);
  ctx.expect(
    "la propuesta nace dentro de los 16 m del borde",
    primera.distancia < 16,
    `${primera.distancia.toFixed(2)} m`,
  );
  ctx.expect(
    "la pregunta ofrece las dos salidas (sí / no)",
    (await laPregunta(ctx)).length === 2,
    JSON.stringify(await laPregunta(ctx)),
  );
  ctx.expect(
    "y hasta aquí NO se le ha pedido nada al motor (la generación no se auto-dispara)",
    (await peticiones(ctx)).length === 0,
    JSON.stringify(await peticiones(ctx)),
  );
  await ctx.shot("propuesta-antes-de-la-N");

  // ── 2 · `N`: no gasta, y la pregunta se retira ───────────────────────────
  await mantener(ctx, "n", 3);
  await frames(ctx, 4);
  const trasN = await frontera(ctx);
  ctx.log(`tras la N: ${JSON.stringify(trasN)}`);
  ctx.expect(
    "tras la `N` NO sale ninguna petición al bridge: decir que no no gasta",
    (await peticiones(ctx)).length === 0,
    JSON.stringify(await peticiones(ctx)),
  );
  ctx.expect(
    "tras la `N` el tile queda apuntado como RECHAZADO",
    trasN.declined.includes(primera.propuesta.key),
    JSON.stringify(trasN.declined),
  );
  ctx.expect("tras la `N` la propuesta se retira", trasN.proposal === null, JSON.stringify(trasN.proposal));
  ctx.expect("y la pregunta desaparece de la pantalla", (await laPregunta(ctx)).length === 0, JSON.stringify(await laPregunta(ctx)));
  await ctx.shot("tras-la-N");

  // ── 3 · El rechazo se RECUERDA mientras se sigue cerca ───────────────────
  // Se sigue andando hacia el mismo borde: la colisión de frontera para al
  // jugador antes de cruzar, así que aquí se acaba PEGADO al muro. En ningún
  // momento se vuelve a preguntar.
  await andarHastaElMuro(ctx, bordeEste);
  const pegado = await donde(ctx);
  const dPegado = bordeEste - pegado.x;
  const cerca = await frontera(ctx);
  ctx.log(`pegado al borde rechazado, a ${dPegado.toFixed(2)} m: ${JSON.stringify(cerca)}`);
  ctx.expect(
    "acercarse MÁS al borde rechazado no vuelve a preguntar",
    cerca.proposal === null && (await laPregunta(ctx)).length === 0,
    `d=${dPegado.toFixed(2)} m · ${JSON.stringify(cerca.proposal)}`,
  );
  ctx.expect(
    "y sigue sin salir una sola petición al motor",
    (await peticiones(ctx)).length === 0,
    JSON.stringify(await peticiones(ctx)),
  );
  ctx.expect(
    "el jugador NO ha cruzado la frontera sin tile (la retención es real)",
    dPegado > 0,
    `${dPegado.toFixed(2)} m del borde`,
  );

  // ── 4 · Pero CADUCA: alejarse y volver lo vuelve a ofrecer ───────────────
  await ctx.nefan("setPlayerPos", bordeEste - 20, 0);
  await frames(ctx, 4);
  const olvidado = await frontera(ctx);
  ctx.expect(
    "a más de 16 m el rechazo se OLVIDA (rechazar no es vetar para siempre)",
    olvidado.declined.length === 0,
    JSON.stringify(olvidado.declined),
  );
  await ctx.nefan("setYaw", Math.PI / 2);
  const segunda = await andarHastaLaPropuesta(ctx, bordeEste, 60_000);
  if (!segunda) return ctx.sinMedirBloque("el rechazo no caducó: sin propuesta no hay blocking que medir");
  ctx.log(`vuelve a proponerse a ${segunda.distancia.toFixed(2)} m del borde`);
  ctx.expect(
    "al volver, el MISMO borde se vuelve a ofrecer",
    segunda.propuesta.key === primera.propuesta.key,
    `${primera.propuesta.key} → ${segunda.propuesta.key}`,
  );

  // ── 5 · En la esquina, rechazar un borde no veta el de al lado ──────────
  // Dos vecinos que faltan a la vez: el juego ofrece el más cercano, y decir
  // que no a ese tiene que dejar el otro sobre la mesa. El rechazo es por
  // TILE, no «no me hables de la frontera».
  const bordeSur = plano.origin[1] + plano.cols * plano.mpc;
  await ctx.nefan("setPlayerPos", bordeEste - 5, bordeSur - 11);
  await frames(ctx, 4);
  const enLaEsquina = await frontera(ctx);
  if (enLaEsquina.proposal?.edge !== "east") {
    return ctx.sinMedirBloque(
      `en la esquina no se ofreció primero el borde más cercano: ${JSON.stringify(enLaEsquina.proposal)}`,
    );
  }
  ctx.log(`en la esquina se ofrece ${enLaEsquina.proposal.edge} (${enLaEsquina.proposal.key})`);
  await mantener(ctx, "n", 3);
  await frames(ctx, 4);
  const trasRechazarElEste = await frontera(ctx);
  ctx.log(`tras rechazar el este: ${JSON.stringify(trasRechazarElEste)}`);
  ctx.expect(
    "rechazar el borde de al lado NO lo veta: el otro vecino se sigue ofreciendo",
    trasRechazarElEste.proposal !== null && trasRechazarElEste.proposal.edge === "south",
    JSON.stringify(trasRechazarElEste.proposal),
  );
  ctx.expect(
    "y el rechazado es exactamente el tile que se rechazó, no los dos",
    trasRechazarElEste.declined.length === 1 && trasRechazarElEste.declined[0] === enLaEsquina.proposal.key,
    JSON.stringify(trasRechazarElEste.declined),
  );
  ctx.expect(
    "en toda la partida no ha salido UNA sola petición al motor: cuatro `N` y cero gasto",
    (await peticiones(ctx)).length === 0,
    JSON.stringify(await peticiones(ctx)),
  );
  await ctx.shot("en-la-esquina-tras-rechazar-el-este");
}
