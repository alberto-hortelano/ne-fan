/** El enemigo que mataste sigue muerto al reaparecer también fuera del caso
 *  del guion 240 (#613, pieza C2 — pasada adversarial de la QA de la tanda BK).
 *
 *   1 · MISMO TILE, y se va a VER el cadáver: se mata al bandido, el Secuaz
 *       mata al jugador, R, se anda a 3 m del bandido y se le encara.
 *   2 · CAMBIO DE TILE por la salida del panel «Salidas», como quien juega:
 *       el bandido sigue muerto al cruzar; el Secuaz (enganchado) sigue al
 *       jugador, lo mata al otro lado, R, y el bandido sigue muerto.
 *   3 · RESUME por la tarjeta del título: el bandido no vuelve; el Secuaz
 *       vuelve y mata al jugador, R, y el bandido sigue sin volver.
 *   4 · EL ÚLTIMO ENEMIGO: se mata al Secuaz (ya no queda nadie vivo), R con el
 *       jugador en pie (el cliente lo ignora), 3 s, y un segundo resume.
 *
 *  Deja constancia (⚠ HALLAZGO, sin poner el banco en rojo) de que la barra de
 *  acciones sigue ofreciendo «R · reaparecer» con el jugador de pie.
 *
 *  QUÉ DISCRIMINA LA GUARDA Y QUÉ NO (medido en negativo el 2026-09-29,
 *  quitando `if (c.health <= 0) continue;` de `GameSimulation.respawn`): los
 *  bloques 1 y 2 se ponen ROJOS (el bandido vuelve `alive:true` a 60). Los 3
 *  y 4 siguen verdes sin la guarda: tras reanudar el muerto ya no está en el
 *  sim (lo cubre el save, `mundo-persistido.ts`), y R en pie lo filtra el
 *  cliente. Son candados de las puertas VECINAS, no de este arreglo.
 *
 *  «El muerto es el último del mapa» y «varios muertos a la vez» no caben en
 *  el motor falso (un solo hostil de spawn): se midieron a nivel de sim, ver
 *  el qa.md de la tanda.
 *
 *  Para VER el cadáver tumbado hay que correrlo con `SKIN_SPRITE_MODEL=y_bot`:
 *  el skin por defecto del banco (paladin) solo tiene `idle` y pinta al muerto
 *  DE PIE, igual que a un vivo.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse, esperarElDespertar, herirHasta } from "../lib/combate.mjs";
import { viajarSiSePuede } from "../lib/viaje.mjs";

/** `saves` para arrancar en el tile de bootstrap (el del bandido); `fake-ai`
 *  para que el Secuaz llegue en el turno 2 de diálogo. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
const OBSERVAR = 3;

const estadoDe = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    return {
      enLista: Boolean(e),
      alive: e?.alive ?? null,
      hp: e?.hp ?? null,
      barra: document.getElementById(`hp-text-${eid}`)?.textContent ?? null,
    };
  }, id);

/** Espera (en segundos de sim) a que el jugador caiga, quieto. `null` si no cae. */
const esperarMuerte = (ctx, quien) =>
  ctx.absorbe(
    `cortafuegos de la espera a que ${quien} mate al jugador: PRECONDICIÓN del bloque, no la medida`,
    () =>
      ctx.waitFor(
        `${quien} mata al jugador`,
        () => (Number(document.getElementById("player-hp-text")?.textContent ?? 1) <= 0 ? true : null),
        { sim: 120 },
      ),
  );

/** Despertar y volver a donde se cayó; devuelve la vida con la que se vuelve.
 *
 *  Desde #613 (tanda BN) dónde despierta lo decide el MOTOR, sin tecla, y el
 *  motor falso despierta lejos. Este guion no mide el despertar sino que el
 *  enemigo MUERTO no se levante (C2), y sus bloques siguen andando desde donde
 *  se cayó: así que, despierto, el banco le devuelve allí (`setPlayerPos`, su
 *  teletransporte). Es lo que antes hacía R al reaparecer en el sitio. */
const reaparecer = async (ctx) => {
  const cayo = await ctx.nefan("state");
  const r = await esperarElDespertar(ctx, "el jugador caído", { velo: false });
  await ctx.nefan("setPlayerPos", cayo.pos.x, cayo.pos.z);
  await ctx.waitFor(
    "el banco devuelve al jugador a donde cayó",
    (a) => {
      const p = window.__nefan.state().pos;
      return Math.hypot(p.x - a.x, p.z - a.z) < 0.05 ? true : null;
    },
    5_000,
    cayo.pos,
  );
  return r.hp;
};

/** La medida: durante OBSERVAR s de sim el muerto no está vivo ni con vida. */
const sigueMuerto = async (ctx, id, etiqueta, { puedeFaltar = false } = {}) => {
  await ctx.expectEspera(
    `${etiqueta}: el ${id} que mataste NO vuelve a estar vivo`,
    false,
    (a) => {
      const e = window.__nefan.enemies().find((x) => x.id === a.id);
      if (!e) return a.puedeFaltar ? null : { desaparecido: true };
      if (e.alive !== false || (e.hp ?? 0) > 0) return { alive: e.alive, hp: e.hp };
      return null;
    },
    { sim: OBSERVAR, arg: { id, puedeFaltar } },
  );
  const fin = await estadoDe(ctx, id);
  ctx.log(`${etiqueta}: ${id} → ${JSON.stringify(fin)}`);
  ctx.expect(
    `${etiqueta}: la barra del HUD de ${id} no marca vida`,
    fin.barra === null || Number(fin.barra) <= 0,
    JSON.stringify(fin),
  );
};

/** ⚠ HALLAZGO de experiencia: qué ofrece la barra de acciones con el jugador en pie. */
const promptTrasReaparecer = async (ctx, etiqueta) => {
  const p = await ctx.page.evaluate(() => ({
    hp: Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"),
    barra: (document.getElementById("interact-prompt")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    visible: (() => {
      const el = document.getElementById("interact-prompt");
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
    })(),
  }));
  ctx.log(`${etiqueta}: barra de acciones ${JSON.stringify(p)}`);
  if (p.hp > 0 && p.visible && /reaparecer/i.test(p.barra)) {
    ctx.log(`⚠ HALLAZGO: con el jugador en pie (${p.hp} PV) la barra sigue ofreciendo «R · reaparecer»`);
  }
};

/** Encara al cadáver (lo que haría el jugador con el ratón) para la captura. */
const mirarA = async (ctx, id) => {
  const d = await ctx.page.evaluate((eid) => {
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    const p = window.__nefan.state().pos;
    if (!e || !p) return null;
    window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
    return Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
  }, id);
  ctx.log(`mirando a ${id}: ${d === null ? "no está" : `${d.toFixed(1)} m`}`);
};

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  const partida = await comenzar(ctx);

  await ctx.waitFor(
    `el bandido "${BANDIDO}" está en escena`,
    (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null,
    60_000,
    BANDIDO,
  );

  // ── 1 · SE MATA AL BANDIDO Y EL SECUAZ TE MATA (el camino del 240) ────
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) {
    ctx.sinMedir("el bandido mató al jugador antes de caer: sin muerto no hay escenario");
  }
  ctx.expect("el jugador mata al bandido (su barra llega a 0)", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;

  const idsAntes = await ctx.page.evaluate(() => window.__nefan.enemies().map((e) => e.id));
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const secuaz = await ctx.waitFor(
    "el motor materializa al Secuaz (spawn_entity del turno 2)",
    (previos) => window.__nefan.enemies().find((e) => !previos.includes(e.id)) ?? null,
    90_000,
    idsAntes,
  );
  ctx.log(`secuaz: ${JSON.stringify(secuaz)}`);
  await ctx.nefan("advanceDialogue");
  await ctx.waitFor("la conversación se cierra", () => (window.__nefan.dialogueVisible ? null : true), 15_000);

  const muerte1 = await esperarMuerte(ctx, "el Secuaz");
  if (!muerte1) {
    ctx.sinMedir("el Secuaz no mató al jugador en 120 s de sim: sin morir no hay R");
  }
  const hp1 = await reaparecer(ctx);
  ctx.log(`bloque 1: en pie con ${hp1} PV`);
  await promptTrasReaparecer(ctx, "bloque 1");
  await ctx.shot("b1-tras-reaparecer");
  // Ir a ver el cadáver (a 3 m) y encararlo ANTES de la observación de 3 s:
  // la cámara gira suavizada y esos segundos de sim le dan tiempo a llegar.
  await acercarse(ctx, BANDIDO, { objetivo: 3, tramos: 14 });
  await mirarA(ctx, BANDIDO);
  await sigueMuerto(ctx, BANDIDO, "bloque 1 (mismo tile)");
  await ctx.shot("b1-mirando-al-bandido-caido");

  // ── 2 · CAMBIO DE TILE ─────────────────────────────────────────────────
  const tileA = await ctx.page.evaluate(() => window.__nefan.currentTile);
  const viaje = await viajarSiSePuede(
    ctx,
    "Molino",
    "el jugador cruza por la salida «Molino del bench»",
    "si la salida no está o el viaje no llega, el bloque 2 se declara sin medir aquí debajo",
  );
  if (!viaje.llegada) {
    ctx.sinMedirBloque(`no se pudo cambiar de tile: ${viaje.causa ?? "sin causa"}`);
  } else {
    ctx.log(`bloque 2: ${tileA} → ${viaje.llegada.tile}`);
    await sigueMuerto(ctx, BANDIDO, "bloque 2 (tras cruzar de tile)", { puedeFaltar: true });
    const muerte2 = await esperarMuerte(ctx, "el Secuaz (que te sigue al otro tile)");
    if (!muerte2) {
      ctx.sinMedirBloque("el Secuaz no siguió al jugador al otro tile ni lo mató: no hay R que pulsar ahí");
    } else {
      await ctx.shot("b2-muerto-en-el-otro-tile");
      const hp2 = await reaparecer(ctx);
      ctx.log(`bloque 2: en pie con ${hp2} PV en ${await ctx.page.evaluate(() => window.__nefan.currentTile)}`);
      await sigueMuerto(ctx, BANDIDO, "bloque 2 (morir y reaparecer en otro tile)", { puedeFaltar: true });
    }
  }

  // ── 3 · RESUME ─────────────────────────────────────────────────────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return; // `reanudar` ya afirmó con ctx.expect que la tarjeta no estaba
  const conSecuaz = await ctx.absorbe(
    "si el Secuaz no vuelve al reanudar, los bloques 3 y 4 se declaran sin medir aquí debajo",
    () =>
      ctx.waitFor(
        "el Secuaz vuelve al reanudar (el mundo está de vuelta)",
        (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null,
        60_000,
        secuaz.id,
      ),
  );
  const bandidoTrasReanudar = await estadoDe(ctx, BANDIDO);
  ctx.log(`bloque 3: tras reanudar, bandido → ${JSON.stringify(bandidoTrasReanudar)} · secuaz → ${JSON.stringify(conSecuaz)}`);
  await sigueMuerto(ctx, BANDIDO, "bloque 3 (recién reanudado)", { puedeFaltar: true });
  if (!conSecuaz) {
    ctx.sinMedirBloque("el Secuaz no volvió al reanudar: no hay quien mate al jugador ni último enemigo");
    return;
  }
  // A 6 m basta: dentro del radio de enganche (10 m) el Secuaz viene solo. Ir
  // hasta 1,6 m falló 1 de 4 corridas (un edificio en medio tras reanudar).
  await acercarse(ctx, secuaz.id, { objetivo: 6, tramos: 30 });
  const muerte3 = await esperarMuerte(ctx, "el Secuaz tras reanudar");
  if (!muerte3) {
    ctx.sinMedirBloque("tras reanudar, el Secuaz no mató al jugador: no hay R que pulsar");
  } else {
    const hp3 = await reaparecer(ctx);
    ctx.log(`bloque 3: en pie con ${hp3} PV`);
    await promptTrasReaparecer(ctx, "bloque 3");
    await sigueMuerto(ctx, BANDIDO, "bloque 3 (reanudar, morir y reaparecer)", { puedeFaltar: true });
  }

  // ── 4 · EL ÚLTIMO ENEMIGO TAMBIÉN MUERE ────────────────────────────────
  await acercarse(ctx, secuaz.id, { objetivo: 6, tramos: 30 });
  const ultimo = await herirHasta(ctx, secuaz.id, 0, { sim: 90 });
  if (!ultimo?.muerto) {
    ctx.sinMedirBloque(`el jugador no llegó a matar al Secuaz: ${JSON.stringify(ultimo)}`);
    return;
  }
  const enemigosVivos = await ctx.page.evaluate(() =>
    window.__nefan.enemies().filter((e) => e.alive !== false).map((e) => e.id),
  );
  ctx.expect("con el Secuaz muerto no queda ningún enemigo vivo", enemigosVivos.length === 0, JSON.stringify(enemigosVivos));
  const r = await ctx.page.evaluate(() => {
    window.__nefan.inputDriver.queueRespawn();
    return Number(document.getElementById("player-hp-text")?.textContent ?? "NaN");
  });
  ctx.log(`bloque 4: R con el jugador vivo (${r} PV) — el cliente debe ignorarlo`);
  // Retroceder un par de metros para ver el cadáver entero, y encararlo.
  await ctx.absorbe(
    "retroceder para la captura del cadáver: encuadre, no medida",
    () =>
      ctx.holdUntil(
        "down",
        "el jugador retrocede a 3 m del Secuaz caído",
        (id) => {
          const e = window.__nefan.enemies().find((x) => x.id === id);
          const p = window.__nefan.state().pos;
          return e && p && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) >= 3 ? true : null;
        },
        { sim: 4 },
        secuaz.id,
      ),
  );
  await mirarA(ctx, secuaz.id);
  await sigueMuerto(ctx, secuaz.id, "bloque 4 (todos muertos, R en pie)");
  await sigueMuerto(ctx, BANDIDO, "bloque 4 (todos muertos, R en pie)", { puedeFaltar: true });
  await ctx.shot("b4-todos-muertos-mirando-al-secuaz");
  const vuelta2 = await reanudar(ctx, partida.sessionId);
  if (!vuelta2) return; // afirmado dentro de `reanudar`
  await ctx.waitFor(
    "el mundo vuelve al segundo resume (el tabernero está)",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await sigueMuerto(ctx, secuaz.id, "bloque 4 (tras el segundo resume)", { puedeFaltar: true });
  await sigueMuerto(ctx, BANDIDO, "bloque 4 (tras el segundo resume)", { puedeFaltar: true });
  await ctx.shot("b4-tras-segundo-resume");
}
