/** LAS TRES RAMAS CARAS DE LA FRONTERA, QUE NINGÚN GUION PODÍA EJERCER — y el
 *  texto del velo, que hasta hoy se calculaba para nadie.
 *
 *  La cabecera del guion 86 declara lo que no podía medir, y lo dice con el
 *  motivo exacto: «la promoción a `blocking` a 2 m, el timeout de 5 min y el
 *  cooldown de 15 s tras un error necesitan un tile que TARDE o que FALLE, y
 *  eso es una variable de entorno de SU proceso (`TILE_MODE=error`,
 *  `TILE_DELAY_MS`) que el guion no arranca». El motor falso leía las dos a la
 *  CARGA DEL MÓDULO, así que la conducta era del proceso entero y de toda la
 *  corrida: quien las quisiera tenía que levantar su propio stack. #516 le
 *  añade `POST /dev/tiles`, que las cambia en caliente, y este guion es su
 *  primer ocupante: pide la conducta, la ejerce y la devuelve a su sitio.
 *
 *  QUÉ SE MIDE, y por qué cada cosa cuesta dinero o lo ahorra:
 *
 *  A · **El velo DICE qué es** (#515). Core calculaba tres estados —«Zona sin
 *      generar», el progreso que manda el motor, «Explorando lo desconocido»—
 *      con sus tres tests, y el cliente se quedaba con el borde y TIRABA el
 *      texto (`deps.velo(velo?.edge ?? null)`). El jugador llegaba al muro y no
 *      recibía ningún motivo de por qué no puede cruzar. Aquí se leen los dos
 *      estados que se alcanzan sin trucar nada: el de antes de pedir y el de
 *      mientras se genera.
 *  B · **La promoción a `blocking` a 2 m.** Con el tile EN VUELO, pegarse al
 *      muro re-envía la petición como `blocking` para que el bridge la ponga
 *      por delante de los prefetch — y **una sola vez**: sin el `#bloqueoEnviado`
 *      sería una petición por fotograma contra un motor que ya está trabajando.
 *  C · **El cooldown de 15 s tras un error.** Con el motor devolviendo 500, la
 *      propuesta NO vuelve inmediatamente: un jugador parado junto a la
 *      frontera con el motor caído re-pediría el tile en cada frame. Y vuelve
 *      DESPUÉS, porque un error no es un veto.
 *
 *  LO QUE SIGUE SIN ESTAR AQUÍ, y ahora por una razón distinta: el **timeout de
 *  5 min**. `POST /dev/tiles` ya lo hace ejercitable (`delay_ms` por encima de
 *  `TIMEOUT_DE_TILE_MS`), pero cuesta 300 s de reloj de PARED en una batería
 *  cuyo guion más largo no llega a 90, y el umbral vive en una constante de
 *  core que el banco no puede mover. Sigue en `nefan-core/test/frontera.test.ts`
 *  (reloj inyectado) y en la comprobación a mano de qa-2.md de #512.
 *
 *  Cero créditos: motor falso, `aisla` deja su estado virgen —este guion le
 *  CAMBIA la conducta y `/dev/reset` la devuelve al arranque— y personajes en
 *  vector. El `aisla` incluye **`mundo`**: ver la nota de abajo, es lo que hace
 *  que el tile vecino tenga que venir del MOTOR y no del snapshot.
 */

import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

// `mundo` además de `saves` y `fake-ai`, y es una precondición DURA: con el
// snapshot de mundo pre-generado en disco, el bridge sirve el tile vecino desde
// él —$0 y al instante— sin llamar al motor, así que el `delay_ms` que este
// guion pide no llega a aplicarse a nada. Medido en la batería del 2026-09-10:
// en solitario verde, detrás de un guion que había dejado el snapshot escrito
// el jugador CRUZABA la frontera (−63,52 m del borde) con el tile «en vuelo».
export const aisla = ["saves", "mundo", "fake-ai"];

/** Cómo se conforma el motor falso ante un tile. `null` en un campo = no se
 *  toca. Devuelve la conducta vigente, que es lo que el fake contesta. */
async function conducta(ctx, cambio) {
  const res = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  if (!res.ok) throw new Error(`POST /dev/tiles HTTP ${res.status}: ${await res.text()}`);
  const vigente = await res.json();
  ctx.log(`motor falso ante un tile: ${JSON.stringify(vigente)}`);
  return vigente;
}

/** Los `request_tile` que SALEN por el socket, con su motivo. Molde del 86: el
 *  ledger de tiles apunta el pedido pero NO el `reason`, y `blocking` vs
 *  `prefetch` es justo lo que aquí se mide. */
async function espiarElSocket(ctx) {
  await ctx.page.addInitScript(() => {
    window.__peticionesDeTile = [];
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      send(datos) {
        try {
          const m = JSON.parse(datos);
          if (m.type === "request_tile") {
            window.__peticionesDeTile.push({ tx: m.tx, ty: m.ty, reason: m.reason });
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
/** El rótulo del muro de niebla, tal y como lo lee el jugador. `null` = no está
 *  en pantalla (el elemento existe siempre; lo que se mira es `hidden`). */
const rotuloDelVelo = (ctx) =>
  ctx.page.evaluate(() => {
    const el = document.getElementById("frontier-veil");
    if (!el || el.hidden) return null;
    return el.textContent;
  });

/** Avanza `n` fotogramas del bucle: la frontera se recalcula UNA vez por
 *  `tick`, no por reloj de pared. */
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

/** Anda al este hasta que haya propuesta sobre la mesa. `null` si no la hay. */
async function andarHastaLaPropuesta(ctx, maxMs = 120_000) {
  await ctx.page.keyboard.down("w");
  try {
    const { ocurrio, ultimo } = await ctx.expectEspera(
      "andando hacia el borde, el juego PROPONE generar la zona vecina",
      true,
      () => window.__nefan.frontier.proposal ?? null,
      { ms: maxMs },
    );
    return ocurrio ? ultimo : null;
  } finally {
    await ctx.page.keyboard.up("w");
  }
}

/** Anda al este hasta pegarse al muro (el jugador deja de avanzar: la colisión
 *  direccional lo retiene) y devuelve a cuántos metros del borde se quedó. */
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

export default async function (ctx) {
  await espiarElSocket(ctx);
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input"); // la `Y` de la propuesta la lee el TECLADO
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
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
  const bordeEste = plano.origin[0] + plano.cols * plano.mpc;
  ctx.log(`borde este del tile de partida en x=${bordeEste} m`);

  // ── 0 · La palanca existe y contesta lo que le piden ─────────────────────
  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  ctx.expect(
    "el motor falso publica cómo se conforma ante un tile (#516)",
    inicial.mode === "" && inicial.delay_ms === 0,
    JSON.stringify(inicial),
  );
  const basura = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "explota" }),
  });
  ctx.expect(
    "y RECHAZA una conducta que no existe en vez de ignorarla (un guion que la pide mide otra cosa)",
    basura.status === 400,
    `HTTP ${basura.status}`,
  );

  // ── A · El velo dice qué es, ANTES de pedir nada ─────────────────────────
  // A 5 m del borde (dentro de los 8 m del velo, dentro de los 16 de la
  // propuesta) y sin haber dicho que sí: nadie ha pedido ese tile.
  await ctx.nefan("setPlayerPos", bordeEste - 5, 0);
  await ctx.nefan("setYaw", Math.PI / 2);
  await frames(ctx, 4);
  const sinPedir = await rotuloDelVelo(ctx);
  ctx.log(`rótulo del velo sin pedir: ${JSON.stringify(sinPedir)}`);
  ctx.expect(
    "pegado a un borde que nadie ha pedido, el muro de niebla DICE que la zona está sin generar",
    sinPedir === "Zona sin generar",
    JSON.stringify(sinPedir),
  );
  ctx.expect(
    "y hasta aquí no ha salido una sola petición al motor",
    (await peticiones(ctx)).length === 0,
    JSON.stringify(await peticiones(ctx)),
  );
  await ctx.shot("velo-sin-generar");

  // ── C · El motor que FALLA: cooldown de 15 s y vuelta ─────────────────────
  // VA ANTES QUE EL BLOQUE DEL TILE LENTO, y es el orden lo que lo hace medible:
  // el bridge sirve los tiles POR COLA, así que con el vecino del este dormido
  // 400 s la petición del sur no llega al motor y el error no ocurre nunca
  // (medido: 198 sondeos, `requested` sin moverse). Se ejerce sobre el borde
  // SUR para no gastar el este, que es el del bloque siguiente.
  await conducta(ctx, { delay_ms: 0, mode: "error" });
  const bordeSur = plano.origin[1] + plano.cols * plano.mpc;
  await ctx.nefan("setPlayerPos", 0, bordeSur - 6);
  await ctx.nefan("setYaw", Math.PI); // mirando al sur
  await frames(ctx, 4);
  const enElSur = await frontera(ctx);
  if (enElSur.proposal?.edge !== "south") {
    return ctx.sinMedirBloque(
      `no se ofreció el borde sur: ${JSON.stringify(enElSur.proposal)} — sin propuesta no hay error que medir`,
    );
  }
  const claveSur = enElSur.proposal.key;
  const antesDelError = (await peticiones(ctx)).length;
  await mantener(ctx, "y", 3);

  const { ocurrio: fallo } = await ctx.expectEspera(
    "el motor rechaza el tile y la frontera se entera (deja de estar pedido)",
    true,
    (k) => (window.__nefan.frontier.requested.includes(k) ? null : { ok: true }),
    { ms: 30_000, arg: claveSur },
  );
  if (!fallo) return ctx.sinMedirBloque("el error no llegó: sin él no hay cooldown que medir");
  const trasElError = (await peticiones(ctx)).length;
  ctx.expect(
    "el error del motor gastó exactamente UNA petición",
    trasElError === antesDelError + 1,
    `${antesDelError} → ${trasElError}`,
  );

  // El cooldown son 15 s de reloj de PARED (`COOLDOWN_TRAS_ERROR_MS`), y es lo
  // único de este guion que se mide contra un reloj: el de core entra por
  // parámetro y aquí lo pone `performance.now()`. Se afirma en las dos
  // direcciones — que NO vuelve antes, y que vuelve.
  const { ocurrio: volvioPronto } = await ctx.expectEspera(
    "pegado al borde con el motor caído, la propuesta NO vuelve enseguida (sin cooldown sería spam por fotograma)",
    false,
    (k) => (window.__nefan.frontier.proposal?.key === k ? { vuelta: true } : null),
    { ms: 8_000, arg: claveSur },
  );
  const durante = (await peticiones(ctx)).length;
  ctx.expect(
    "y en esos segundos no sale ni una petición más",
    durante === trasElError,
    `${trasElError} → ${durante}`,
  );
  if (!volvioPronto) {
    await ctx.expectEspera(
      "pasado el cooldown la propuesta VUELVE: un error no es un veto",
      true,
      (k) => (window.__nefan.frontier.proposal?.key === k ? { vuelta: true } : null),
      { ms: 20_000, arg: claveSur },
    );
  }
  const alFinal = await frontera(ctx);
  ctx.log(`frontera al final: ${JSON.stringify(alFinal)}`);
  await ctx.shot("tras-el-error-del-motor");

  // ── B · El tile que TARDA: «explorando», y blocking al pegarse al muro ────
  // Un tile que no llega nunca dentro de este guion (400 s ≫ lo que dura), que
  // es lo que hace observable el estado «pedido y en vuelo». Y `mode: ""` de
  // vuelta: el bloque anterior dejó el motor rechazando tiles.
  await conducta(ctx, { delay_ms: 400_000, mode: "" });
  await ctx.nefan("setPlayerPos", bordeEste - 19, 0);
  await ctx.nefan("setYaw", Math.PI / 2); // mirando al este otra vez (el bloque C miraba al sur)
  await frames(ctx, 4);
  const propuesta = await andarHastaLaPropuesta(ctx);
  if (!propuesta) return ctx.sinMedir("sin propuesta no hay tile en vuelo que medir");
  const dPropuesta = bordeEste - (await donde(ctx)).x;
  ctx.log(`propuesta ${propuesta.key} a ${dPropuesta.toFixed(2)} m del borde`);
  await mantener(ctx, "y", 3);
  await frames(ctx, 4);

  const enVuelo = await frontera(ctx);
  ctx.expect(
    "tras la `Y` el tile queda PEDIDO",
    enVuelo.requested.includes(propuesta.key),
    JSON.stringify(enVuelo.requested),
  );
  // Se cuentan las de ESTE tile: el bloque anterior gastó una en el borde sur.
  const delVecino = (lista) => lista.filter((p) => p.tx === 1 && p.ty === 0);
  const trasPedir = delVecino(await peticiones(ctx));
  ctx.expect(
    "y sale UNA petición, como `prefetch`",
    trasPedir.length === 1 && trasPedir[0].reason === "prefetch",
    JSON.stringify(trasPedir),
  );
  // El velo se enciende a 8 m del borde (`VELO_A_M`) y la propuesta nace a 16,
  // así que aquí todavía no hay rótulo que leer: se lee pegado al muro, que es
  // además donde el jugador se queda preguntándose por qué no puede pasar.
  await andarHastaElMuro(ctx, bordeEste);
  const generando = await rotuloDelVelo(ctx);
  ctx.log(`rótulo del velo con el tile en vuelo: ${JSON.stringify(generando)}`);
  ctx.expect(
    "y el muro de niebla deja de decir «sin generar»: ahora cuenta que se está explorando",
    typeof generando === "string" && generando.length > 0 && generando !== "Zona sin generar",
    JSON.stringify(generando),
  );
  await ctx.shot("velo-explorando");

  const dMuro = bordeEste - (await donde(ctx)).x;
  ctx.log(`pegado al muro a ${dMuro.toFixed(2)} m del borde`);
  ctx.expect(
    "el jugador NO cruza la frontera de un tile que aún no ha llegado",
    dMuro > 0,
    `${dMuro.toFixed(2)} m del borde`,
  );
  const conBlocking = delVecino(await peticiones(ctx));
  ctx.log(`peticiones del vecino tras pegarse al muro: ${JSON.stringify(conBlocking)}`);
  ctx.expect(
    "pegado al muro con el tile en vuelo, la petición se PROMUEVE a blocking (el bridge la adelanta)",
    conBlocking.some((p) => p.reason === "blocking"),
    JSON.stringify(conBlocking),
  );
  // Y una sola vez: 40 fotogramas más contra el muro no añaden ninguna.
  await frames(ctx, 40);
  const despues = delVecino(await peticiones(ctx));
  ctx.expect(
    "y SOLO UNA: quedarse contra el muro no re-pide el tile en cada fotograma",
    despues.filter((p) => p.reason === "blocking").length === 1 && despues.length === 2,
    JSON.stringify(despues),
  );

  // Devolver el motor falso a como estaba: `/dev/reset` entre guiones lo hace
  // igual, pero un guion que deja el retardo puesto se lo lleva al siguiente y
  // eso es exactamente lo que #516 vino a hacer visible.
  await conducta(ctx, { delay_ms: 0, mode: "" });
}
