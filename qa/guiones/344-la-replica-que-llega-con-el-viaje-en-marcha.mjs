/** La réplica que llega CON EL VIAJE EN MARCHA (pasada adversarial de la QA de
 *  la tanda BW, 2026-09-30). El 343 mide la réplica que llega DESPUÉS de
 *  llegar al tile nuevo; aquí llega ANTES: el jugador ha pulsado la salida y
 *  el motor aún está generando el destino. Es el orden más probable con un
 *  motor real que atiende en serie (la réplica tarda 5-11 s, el tile 1-5 min).
 *
 *   · al llegar la réplica el tile activo y la posición son aún los de la
 *     Taberna, así que la entrega de core la da por VIGENTE y abre el panel;
 *   · el panel NO se cierra al llegar al tile nuevo: el jugador aparece en el
 *     Molino conversando con el tabernero que dejó a dos horas de camino — el
 *     síntoma de H1b con otro reloj.
 *
 *  LA MEDIDA (lo que pedía el usuario): al llegar al tile nuevo, la
 *  conversación con quien se quedó atrás no ocupa la pantalla ni bloquea el
 *  ataque. Rojo HOY (medido al escribirlo): es un hallazgo de la QA, no un
 *  candado de algo que ya funciona.
 *
 *  Cero créditos: preset `e2e-sin-creditos`. El motor falso tarda con los
 *  tiles (`POST /dev/tiles`) solo durante el viaje, y se devuelve en `finally`.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { pulsarSalida, sondaDeViaje } from "../lib/viaje.mjs";
import { MS_DEL_TILE } from "../lib/tile-episodio.mjs";
import { URLS } from "../lib/stack.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
const MARCA = "REPLICA TARDIA";
/** Lo que tarda el Molino en generarse: holgura para soltar la réplica con el
 *  viaje en marcha y ver dónde cae. */
const TILE_LENTO_MS = 15_000;

const frames = esperaDeFotogramas("mundo");

async function conductaDeTiles(ctx, cambio) {
  const res = await fetch(`${URLS.fake_ai}/dev/tiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cambio),
  });
  if (!res.ok) throw new Error(`POST /dev/tiles HTTP ${res.status}: ${await res.text()}`);
  ctx.log(`motor falso ante un tile: ${JSON.stringify(await res.json())}`);
}

async function textoLibre(ctx, frase) {
  await ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      return d.visible && botones > 0 && (document.getElementById("dialogue-text")?.textContent ?? "") === d.text ? true : null;
    },
    60_000,
  );
  await ctx.page.keyboard.press("t");
  await ctx.waitFor("T abre la caja de texto libre", () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null), 5_000);
  await ctx.page.keyboard.type(frase);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor("el panel se cierra al mandar", () => (window.__nefan.dialogue().visible ? null : true), 10_000);
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  await comenzar(ctx);
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador: sin paz no hay conversación que medir");
  ctx.expect("PREMISA: el jugador mata al bandido", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;

  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta al saludo (panel)", () => (window.__nefan.dialogue().visible ? true : null), 60_000);
  const FRASE = `${MARCA} me voy ya al molino`;
  await textoLibre(ctx, FRASE);
  const retenida =
    (await ctx.absorbe("si no se retiene, lo afirma el expect de abajo", () =>
      ctx.waitFor(
        "el motor falso retiene la réplica",
        async (b) => ((await (await fetch(`${b}/dev/counters`)).json()).replicaRetenida === true ? true : null),
        60_000,
        URLS.fake_ai,
      ),
    )) === true;
  ctx.expect("el motor falso retiene la réplica (la marca llegó)", retenida);
  if (!retenida) return;

  const antes = await ctx.page.evaluate(() => ({ tile: window.__nefan.currentTile, pedido: window.__nefan.viaje?.pedido ?? null }));
  await conductaDeTiles(ctx, { delay_ms: TILE_LENTO_MS });
  try {
    const pulsada = await pulsarSalida(ctx, "Molino del bench");
    if (!pulsada) ctx.sinMedir("no hay salida «Molino del bench» en el panel");
    await frames(ctx, 10);
    const enMarcha = await ctx.page.evaluate(() => ({ tile: window.__nefan.currentTile, v: window.__nefan.viaje }));
    ctx.expect(
      "PREMISA: el viaje está pedido y aún no ha llegado cuando se suelta la réplica",
      enMarcha.tile === antes.tile && enMarcha.v && enMarcha.v.pedido !== antes.pedido && !enMarcha.v.llegado,
      JSON.stringify(enMarcha),
    );
    await fetch(`${URLS.fake_ai}/dev/soltar-replica`, { method: "POST" }).then((r) => {
      if (!r.ok) throw new Error(`/dev/soltar-replica HTTP ${r.status}`);
    });
    const alSoltar = await ctx.waitFor(
      "la réplica aparece (en el panel o en el registro)",
      (f) => {
        const d = window.__nefan.dialogue();
        const linea = [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? "").find((t) => t.includes(f));
        if (d.visible && (d.text ?? "").includes(f)) return { donde: "panel", tile: window.__nefan.currentTile };
        if (linea) return { donde: "registro", tile: window.__nefan.currentTile };
        return null;
      },
      30_000,
      FRASE,
    );
    ctx.log(`con el viaje en marcha, la réplica cayó en: ${JSON.stringify(alSoltar)}`);
    await ctx.shot("replica-con-el-viaje-en-marcha");

    const llegada = await ctx.absorbe("si el viaje no llega, se AFIRMA abajo con el ledger y la foto del jugador", () =>
      ctx.waitFor("el viaje al Molino llega", sondaDeViaje, MS_DEL_TILE, { desde: antes.tile, pedidoPrevio: antes.pedido }),
    );
    const foto = await ctx.page.evaluate(() => ({
      tile: window.__nefan.currentTile,
      pos: window.__nefan.state().pos,
      ledger: window.__nefan.viaje,
      panel: window.__nefan.dialogue().visible,
    }));
    ctx.log(`tras el viaje: ${JSON.stringify(llegada?.estado ?? null)} · ${JSON.stringify(foto)}`);
    ctx.expect("el viaje pedido LLEGA: el jugador aparece en el Molino", llegada?.estado === "llegado", JSON.stringify(foto));
    if (llegada?.estado !== "llegado") {
      await ctx.shot("el-viaje-no-llega-con-el-panel-abierto");
      return;
    }
    await frames(ctx, 20);
    const trasLlegar = await ctx.page.evaluate(() => ({
      tile: window.__nefan.currentTile,
      panel: window.__nefan.dialogue().visible,
      hablante: window.__nefan.dialogue().speaker ?? null,
      dialogo: window.__nefan.puedeAtacar().dialogo,
    }));
    ctx.log(`al llegar al Molino: ${JSON.stringify(trasLlegar)}`);
    await ctx.shot("al-llegar-al-molino");
    ctx.expect(
      "al llegar a otro tile, la conversación con quien se quedó atrás NO ocupa la pantalla",
      trasLlegar.panel === false,
      JSON.stringify(trasLlegar),
    );
    ctx.expect("…ni bloquea el ataque", trasLlegar.dialogo === false, JSON.stringify(trasLlegar));
  } finally {
    await conductaDeTiles(ctx, { delay_ms: 0 });
  }
}
