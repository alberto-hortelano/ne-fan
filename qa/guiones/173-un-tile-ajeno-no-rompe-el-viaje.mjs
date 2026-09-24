/** UN FALLO DE OTRO TILE NO ROMPE EL VIAJE QUE ESTÁ EN CURSO (#737).
 *
 *  Hasta la tanda AT, todo error de `kind:"tile"` salía del bridge SIN
 *  `placeId`, y el cliente se lo atribuía al viaje abierto «por ser la causa
 *  candidata»: el error de un tile vecino, con el «Viajando...» puesto,
 *  cerraba el ledger del viaje Y pintaba encima el muro «No se pudo llegar»;
 *  luego el viaje llegaba igual y el muro se iba solo. Un fallo falso a
 *  pantalla completa. Desde #737 el bridge marca con `placeId` lo que emite
 *  POR el viaje, y core (`deQuienEsElFallo`, `src/protocol/status-reparto.ts`)
 *  decide para el ledger y para el muro a la vez que lo que no lo trae es
 *  ajeno. Un solo viaje, dos errores ajenos, y el viaje tiene que llegar:
 *
 *   A · INSTANTÁNEO. Con el viaje esperando, un `request_tile` con coordenadas
 *       no enteras (`tx: 1.5` pasa el `z.number()` del intake y lo rechaza el
 *       handler, `bridge/handlers/tile.ts`): error de tile SIN `placeId` y sin
 *       `tile`, al momento. No depende de la cola.
 *   B · REALISTA. La generación de un tile LEJANO (prefetch 6,6) que revienta
 *       en el motor mientras el viaje espera en la cola detrás de ella (un job
 *       a la vez; el viaje bloqueante no expulsa al que está en vuelo). Es el
 *       caso que describe el issue: el `fail()` de `runTileGeneration` de un
 *       tile que no es el destino.
 *
 *  Tras cada uno: el ledger del viaje sigue SIN `error`, el muro sigue siendo
 *  «Viajando...» (sin `.error`) y el aviso está en la línea de mensajes
 *  (`#combat-log`). Y al final el viaje LLEGA con spawn: el control de que los
 *  verdes de arriba no salen de un viaje que no se pidió.
 *
 *  LO QUE ESTO NO MIDE: que el fallo DEL destino siga cerrando el viaje en
 *  segundos. Eso es el guion 168, y se corre con éste.
 *
 *  EN NEGATIVO (hecho a mano al escribirlo, cifras en `implementacion.md` de la
 *  tanda AT): con `deQuienEsElFallo` devolviendo `"del-viaje"` para todo lo
 *  que llega con un viaje abierto, A sale ROJO —ledger con `error`, muro
 *  «No se pudo llegar»— y el viaje sale `ViajeRoto`.
 *
 *  CÓMO SE SOSTIENE B SIN RELOJES: el retardo del motor falso es uno para
 *  todos los tiles y se lee VIVO (`/dev/tiles`). El prefetch duerme `MS_DEL_PREFETCH`;
 *  A cabe dentro de ese sueño; se pide `mode:"error"` y el prefetch revienta al
 *  despertar; el viaje empieza entonces su propio sueño, y en ese margen —el
 *  mismo `MS_DEL_PREFETCH`— se devuelve el motor a su conducta. Si A tardara
 *  más que el sueño, el prefetch LLEGARÍA en vez de fallar, y la espera de B lo
 *  dice con su nombre en vez de pasar en verde.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso; su conducta se
 *  cambia en caliente con `POST /dev/tiles` (#516) y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar, regenerarMundo } from "../lib/sesion.mjs";
import { ViajeRoto, viajarPorSalidas } from "../lib/viaje.mjs";
import { porElCable } from "../lib/cable.mjs";
import { URLS } from "../lib/stack.mjs";

/** Partida virgen y motor falso en su turno 0: este guion le CAMBIA la
 *  conducta, y `/dev/reset` es la red por si el `finally` no llegara. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Cuánto duerme el motor falso cada tile mientras se monta la escena. Tiene
 *  que cubrir A entero (un par de segundos con la máquina tranquila), y es a
 *  la vez el margen para devolver el motor a su conducta tras el fallo de B. */
const MS_DEL_PREFETCH = 8_000;
/** Techo de cada espera por condición de este guion: un socket local y un
 *  motor falso que habla en milisegundos, salvo el sueño de arriba. */
const TECHO_MS = 20_000;
/** El tile LEJANO del prefetch de B: nadie lo pide por su cuenta. */
const LEJANO = { tx: 6, ty: 6 };

/** Cómo se conforma el motor falso ante un tile. Devuelve la conducta vigente. */
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

/** Lo que el jugador tiene delante y lo que el juego recuerda del viaje. */
function foto(ctx) {
  return ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    const spinner = muro?.querySelector(".spinner");
    return {
      viaje: window.__nefan.viaje,
      muroVisible: Boolean(muro?.classList.contains("visible")),
      muroError: Boolean(muro?.classList.contains("error")),
      titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
      spinnerVisible: spinner ? getComputedStyle(spinner).display !== "none" : null,
      linea: document.getElementById("combat-log")?.textContent ?? "",
    };
  });
}

/** Los tres asertos de «el fallo ajeno no tocó el viaje». */
function afirmaIntacto(ctx, bloque, f, avisoEnLaLinea) {
  ctx.log(`${bloque} · ledger=${JSON.stringify(f.viaje)} · muro=«${f.titulo}» error=${f.muroError}`);
  ctx.expect(
    `${bloque} · el ledger del viaje sigue ABIERTO: el fallo ajeno no se le atribuye`,
    f.viaje !== null && f.viaje.error === null && f.viaje.spawnAplicado === null,
    JSON.stringify(f.viaje),
  );
  ctx.expect(
    `${bloque} · el muro sigue siendo «Viajando...», sin muro de fallo encima`,
    f.muroVisible && !f.muroError && f.titulo === "Viajando...",
    `visible=${f.muroVisible} · error=${f.muroError} · título=«${f.titulo}»`,
  );
  ctx.expect(
    `${bloque} · el aviso va a la línea de mensajes, no se calla`,
    avisoEnLaLinea(f.linea),
    f.linea.slice(-300),
  );
}

export default async function (ctx) {
  await regenerarMundo(ctx, GAME_ID);
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector", renderMode: "vector" });
  await comenzar(ctx);

  const salidas = await ctx.nefan("exits");
  ctx.expect("el panel «Salidas» ofrece un destino", salidas.length > 0, JSON.stringify(salidas));
  if (!salidas.length) return;
  const destino = salidas[0];

  const inicial = await fetch(`${URLS.fake_ai}/dev/tiles`).then((r) => r.json());
  ctx.log(`conducta inicial del motor falso: ${JSON.stringify(inicial)}`);

  let viaje = null;
  try {
    await conducta(ctx, { delay_ms: MS_DEL_PREFETCH });
    // El prefetch de B va PRIMERO, para que el viaje quede en la cola detrás
    // de él; la espera del cable es el guion entero, así el socket sigue
    // abierto y lo que el intake rechazara se diría al final.
    const { rechazos } = await porElCable(
      ctx,
      { type: "request_tile", tx: LEJANO.tx, ty: LEJANO.ty, reason: "prefetch" },
      async () => {
        const pedidoPrevio = await ctx.page.evaluate(() => window.__nefan.viaje?.pedido ?? null);
        viaje = viajarPorSalidas(ctx, destino.name, `el viaje a «${destino.name}» con fallos ajenos`).then(
          (llegada) => ({ llegada }),
          (err) => ({ err }),
        );
        await ctx.waitFor(
          "el bridge acusa el viaje y el jugador lee «Viajando...»",
          (previo) => {
            const v = window.__nefan.viaje;
            const t = document.getElementById("narrative-loader-title")?.textContent;
            return v && v.pedido !== previo && v.encolado !== null && t === "Viajando..." ? v : null;
          },
          TECHO_MS,
          pedidoPrevio,
        );

        // ── A · un error de tile sin lugar, al instante ─────────────────────
        await porElCable(ctx, { type: "request_tile", tx: 1.5, ty: 0, reason: "prefetch" }, () =>
          // Se espera a que el CLIENTE lo haya procesado —todo fallo pintado
          // pasa por el registro de errores, vaya al muro o a la línea—, no a
          // que vaya adonde se afirma: eso lo dicen los asertos de abajo, y
          // con su nombre si falla.
          ctx.waitFor(
            "el error del request_tile inválido llega al registro de errores del cliente",
            () => (document.getElementById("error-log")?.textContent ?? "").includes("coords inválidas"),
            TECHO_MS,
          ),
        );
        afirmaIntacto(ctx, "A", await foto(ctx), (l) => l.includes("request_tile con coords inválidas"));
        await ctx.shot("a-viajando-tras-error-ajeno");

        // ── B · la generación de un tile lejano revienta en el motor ────────
        await conducta(ctx, { mode: "error" });
        const key = `tile_${LEJANO.tx}_${LEJANO.ty}`;
        const ep = await ctx.waitFor(
          `la generación del tile lejano ${key} falla (y no llega)`,
          (k) => {
            const e = (window.__nefan.tileEpisodios ?? []).find((x) => x.key === k);
            if (e && e.error) return e;
            if (e && e.arrived) return { llegoEnVezDeFallar: e };
            return null;
          },
          TECHO_MS,
          key,
        );
        // El viaje empieza a dormir AHORA: el motor vuelve a su conducta ya.
        await conducta(ctx, { mode: inicial.mode });
        ctx.expect(
          `B · el prefetch de ${key} FALLÓ en el motor (si llegó, A tardó más que su sueño y B no mide nada)`,
          Boolean(ep?.error) && !ep.llegoEnVezDeFallar,
          JSON.stringify(ep),
        );
        // El motivo que la línea tiene que decir es el que el bridge difundió
        // para ESE tile (el ledger de tiles lo guarda tal cual).
        afirmaIntacto(ctx, "B", await foto(ctx), (l) => Boolean(ep?.error) && l.includes(ep.error));
        await ctx.shot("b-viajando-tras-tile-lejano-roto");
        await conducta(ctx, { delay_ms: 0 });
      },
    );
    ctx.expect("el intake no rechazó el prefetch de B", rechazos.length === 0, JSON.stringify(rechazos));
  } finally {
    await conducta(ctx, inicial);
  }

  // ── Control: el viaje LLEGA ─────────────────────────────────────────────
  const fin = await viaje;
  ctx.log(`desenlace: ${fin.err ? `${fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada.ledger)}`);
  ctx.expect(
    "control · el viaje LLEGA con spawn tras los dos fallos ajenos (no es ViajeRoto)",
    !fin.err && fin.llegada?.estado === "llegado" && fin.llegada.ledger.spawnAplicado !== null,
    fin.err ? `${fin.err instanceof ViajeRoto ? "ViajeRoto" : fin.err.name}: ${fin.err.message}` : JSON.stringify(fin.llegada),
  );
  await ctx.shot("llegado");
}
