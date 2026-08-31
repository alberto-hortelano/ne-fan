/** Lo que le HICISTE al enemigo sigue ahí después de cambiar de tile Y de
 *  cerrar la partida, y el enemigo tiene UN SOLO DUEÑO.
 *
 *  Las dos mitades que la tanda #323 arregló y que el guion 41 no recorre
 *  (bloques 1 y 2), más la que abrió #326 (bloque 3: el muerto no vuelve al
 *  reanudar). El mundo de RUNTIME —lo que el motor pone a mitad de
 *  conversación, que no está en el Format D de ninguna escena— lo mide su
 *  guion hermano, el 48.
 *
 *  1. **La herida sobrevive al cambio de tile.** El defecto que se retiró con
 *     `src/store/state-projection.ts` no era «falta un productor»: era que
 *     `broadcastScene` REEMPLAZABA `store.state.enemies` con una proyección
 *     vacía en cada escena difundida, y como `getEnemyStates` itera esa lista,
 *     el primer tile nuevo borraba del `state_update` a un enemigo que seguía
 *     vivo en el sim — barra congelada y pelea perdida. El guion 41 pelea y
 *     mata sin salir del tile de partida, así que ese borrado le pasa por
 *     debajo: con la proyección puesta seguiría en verde.
 *
 *  2. **Un hostil no entra en la vida ambiental.** `NpcBehaviorSystem` MUTA
 *     `record.position` cada tick y a un combatiente lo mueve la IA del sim:
 *     dos dueños de la misma posición. El guardia de `npcSync` lo impide y
 *     `bridge-npc.test.ts` lo canda por dentro; esto lo mira por FUERA, que es
 *     donde se vería el parpadeo — el hostil no puede salir NUNCA por
 *     `state_update.npcs` (el canal de la vida ambiental) y su registro del
 *     ledger no lo toca nadie, mientras el del mercader de al lado sí se mueve.
 *
 *  Sin píxeles y sin esperas de reloj: la vida se lee del HUD (`#hp-text-<id>`,
 *  lo que el jugador tiene delante), los frames se capturan envolviendo
 *  `WebSocket` ANTES de que cargue la app, y las condiciones de parada son
 *  cambios de ESTADO.
 *
 *  PROBADO EN NEGATIVO (2026-08-29, sobre el árbol de la tanda), y el primer
 *  negativo cazó un verde vacío MÍO — está contado porque es la lección:
 *   · Bloque 1 — devolviendo a `broadcastScene` su `dispatch("enemies_projected",
 *     {enemies: []})`, la PRIMERA versión de este guion seguía en VERDE. El
 *     cliente no borra la barra de un enemigo que el bridge deja de nombrar: la
 *     CONGELA, así que leer `#hp-text-<id>` y comprobar que no ha cambiado da
 *     el mismo número con y sin defecto. Reescrito para afirmar las dos cosas
 *     que sí distinguen los dos mundos —que el bridge siga NOMBRÁNDOLO tras el
 *     tile nuevo y que se le pueda VOLVER A HERIR—, se pone rojo por las dos.
 *   · Bloque 2 — quitando `if (isHostileRole(e.data.role)) continue` de
 *     `npcSync` (bridge/context.ts), el hostil empieza a salir por
 *     `state_update.npcs` (65 frames) y su registro del ledger empieza a
 *     moverse solo (`[11.41,0,-0.90] → [11.81,0,-1.04]`): los dos asertos del
 *     bloque se ponen rojos.
 *   · Bloque 3 (2026-08-31, #326) — quitando el guardado al morir de
 *     `handleInput` (bridge/handlers/simulation.ts), el muerto vuelve al
 *     reanudar y los dos asertos del bloque se ponen rojos: `bandido_1` sale
 *     otra vez en `enemies()` (`alive:true`, 34,9 PV — la herida del bloque 1,
 *     que sí se guardó con otro save) y su `#hp-text-bandido_1` vuelve al HUD
 *     marcando 35.
 *
 *  Lo que este guion NO afirma y está en `qa.md` de la tanda como hallazgo
 *  abierto va con la marca `⚠ HALLAZGO` en el registro: se ve en cada corrida
 *  sin poner el banco en rojo por un defecto que su dueño todavía no ha
 *  arreglado (misma convención que estrenó el guion 24).
 */
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes del guion), la misma
 *  que el 41 y por las mismas dos razones: la partida tiene que arrancar en el
 *  tile de bootstrap —el que trae al bandido— y `fakeDialogueTurn` tiene que
 *  estar a cero para que el motor falso sea determinista. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const MERCADER = "barkeep";
/** Alcance útil del golpe rápido (óptimo 1,5 m + tolerancia 1,0). Se pega
 *  desde dentro, nunca desde el filo. */
const DISTANCIA_DE_GOLPE = 1.6;
/** Hasta dónde se hiere antes de viajar. No se le mata: un cadáver no puede
 *  demostrar que la HERIDA viaja. */
const VIDA_OBJETIVO = 40;

/** La vida que el HUD enseña de un enemigo — literalmente lo que el jugador lee. */
const vidaEnElHud = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const el = document.getElementById(`hp-text-${eid}`);
    if (!el) return null;
    const n = Number(el.textContent);
    return Number.isFinite(n) ? n : null;
  }, id);

/** El enemigo tal y como lo tiene el cliente, con su distancia al jugador. */
const medir = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    if (!e) return null;
    const p = window.__nefan.state().pos;
    return {
      d: Math.hypot(e.pos.x - p.x, e.pos.z - p.z),
      hp: e.hp,
      alive: e.alive,
      pos: { x: e.pos.x, z: e.pos.z },
    };
  }, id);

/** Los registros del ledger narrativo, por el canal HTTP del bridge (State
 *  API). Es el dato que el motor lee y el que sobrevive al save; si la vida
 *  ambiental tocara al hostil, se vería aquí. */
const ledger = (ctx) =>
  ctx.page.evaluate(async () => {
    const base = String(window.__nefan.servicios()["world-state"] ?? "").replace(/\/+$/, "");
    const r = await fetch(`${base}/entities`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`State API /entities: HTTP ${r.status}`);
    const body = await r.json();
    return Object.fromEntries((body.entities ?? []).map((e) => [e.id, e.position]));
  });

/** Camina hasta ponerse a distancia de golpe. Por el camino del jugador —yaw +
 *  tecla de avance—, en tramos porque el enemigo también se mueve. */
async function acercarse(ctx, id, tramos = 12) {
  let m = await medir(ctx, id);
  for (let i = 0; i < tramos && m && m.d > DISTANCIA_DE_GOLPE; i++) {
    const p = await ctx.nefan("state");
    await ctx.nefan("setYaw", Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
    await ctx
      .holdUntil(
        "up",
        `el jugador se pone a ${DISTANCIA_DE_GOLPE} m de ${id} (tramo ${i + 1}, ahora ${m.d.toFixed(1)} m)`,
        (a) => {
          const e = window.__nefan.enemies().find((x) => x.id === a.id);
          if (!e) return null;
          const q = window.__nefan.state().pos;
          return Math.hypot(e.pos.x - q.x, e.pos.z - q.z) <= a.objetivo ? true : null;
        },
        4_000,
        { id, objetivo: DISTANCIA_DE_GOLPE },
      )
      .catch(() => null);
    m = await medir(ctx, id);
  }
  return m;
}

/** Pega hasta dejar al enemigo por debajo de `objetivo` SIN matarlo. Se
 *  re-encara y se cierra la distancia atacando, como quien juega; la condición
 *  de parada es la vida del HUD, no un reloj ni un número de intentos. */
async function herirHasta(ctx, id, objetivo, maxMs = 60_000) {
  await ctx.nefan("inputDriver.selectAttack", "quick");
  const fin = await ctx
    .waitFor(
      `la vida de ${id} baja de ${objetivo} en el HUD`,
      (a) => {
        const e = window.__nefan.enemies().find((x) => x.id === a.id);
        const p = window.__nefan.state().pos;
        const drv = window.__nefan.inputDriver;
        if (e && p) {
          window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
          if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > a.alcance) drv.press("up");
          else drv.release("up");
          drv.queueAttack();
        }
        const el = document.getElementById(`hp-text-${a.id}`);
        if (!el) return null;
        const n = Number(el.textContent);
        if (Number.isFinite(n) && n <= a.objetivo) return { hud: n, muerto: n <= 0 };
        // El jugador muerto deja de poder pegar: se corta aquí para que el
        // rojo diga «te mataron» y no agote el cortafuegos en silencio.
        if (Number(document.getElementById("player-hp-text")?.textContent ?? 0) <= 0) {
          return { hud: n, jugadorMuerto: true };
        }
        return null;
      },
      maxMs,
      { id, objetivo, alcance: DISTANCIA_DE_GOLPE },
    )
    .catch(() => null);
  await ctx.nefan("inputDriver.release", "up");
  return fin;
}

export default async function (ctx) {
  // La sonda de frames se instala ANTES de que cargue la app: el cliente abre
  // su WebSocket al bridge en el arranque y un wrap posterior no vería un solo
  // `state_update`. Se cuentan IDS por canal, no frames: lo que se afirma es
  // por dónde SALE cada quien.
  await ctx.page.addInitScript(() => {
    window.__qaCanales = { updates: 0, npcs: {}, enemies: {} };
    const Orig = window.WebSocket;
    class SondaWS extends Orig {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (ev) => {
          if (typeof ev.data !== "string") return;
          let m;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return; // un frame que no es JSON no es un state_update
          }
          if (m?.type !== "state_update") return;
          const c = window.__qaCanales;
          c.updates += 1;
          for (const n of m.npcs ?? []) c.npcs[n.id] = (c.npcs[n.id] ?? 0) + 1;
          for (const e of m.enemies ?? []) c.enemies[e.id] = (c.enemies[e.id] ?? 0) + 1;
        });
      }
    }
    window.WebSocket = SondaWS;
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));

  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  const enemigo = await ctx.waitFor(
    `el enemigo "${BANDIDO}" existe en el cliente`,
    (eid) => window.__nefan.enemies().find((x) => x.id === eid) ?? null,
    60_000,
    BANDIDO,
  );
  ctx.log(`enemigo de la escena: ${JSON.stringify(enemigo)}`);

  // ── 1 · LA HERIDA VIAJA ────────────────────────────────────────────────
  await acercarse(ctx, BANDIDO);
  const herido = await herirHasta(ctx, BANDIDO, VIDA_OBJETIVO);
  ctx.expect(
    "el jugador consigue HERIR al enemigo sin matarlo (si no, no hay herida que viajar)",
    Boolean(herido) && !herido.jugadorMuerto && !herido.muerto,
    JSON.stringify(herido),
  );
  if (!herido || herido.jugadorMuerto || herido.muerto) return;

  const vidaHerido = await vidaEnElHud(ctx, BANDIDO);
  ctx.log(`${BANDIDO} queda en ${vidaHerido} PV antes de viajar`);
  await ctx.shot("enemigo-herido-antes-de-viajar");

  // Al borde del tile y a cruzar. Se salta el paseo de 30 m con `setPlayerPos`
  // —igual que el guion 05— porque el sujeto no es andar: es lo que le pasa al
  // enemigo cuando llega un tile nuevo. Lo que NO se salta es la propuesta: se
  // pisa la frontera y se confirma, como quien juega.
  const antesTiles = await ctx.nefan("tiles");
  const plano = await ctx.page.evaluate(() => {
    const g = window.__nefan.scene.terrain_grid;
    return { origin: g.origin, mpc: g.meters_per_cell, cols: g.grid[0].length };
  });
  await ctx.nefan("setPlayerPos", plano.origin[0] + (plano.cols - 8) * plano.mpc, 0);
  await ctx.nefan("setYaw", Math.PI / 2); // este

  const propuesta = await ctx
    .holdUntil("up", "pisar la frontera propone explorar", () => window.__nefan.frontier.proposal ?? null, 120_000)
    .catch(() => null);
  ctx.expect("caminar al este propone explorar el tile vecino", Boolean(propuesta), JSON.stringify(propuesta));
  if (!propuesta) return;
  await ctx.nefan("inputDriver.queueTileConfirm");

  const nuevo = await ctx
    .holdUntil(
      "up",
      "el jugador entra en el tile recién generado",
      (previos) => {
        const s = window.__nefan.scene;
        return s && !previos.includes(s.scene_id) ? s.scene_id : null;
      },
      180_000,
      antesTiles.map((k) => k),
    )
    .catch(() => null);
  ctx.expect("el jugador cruza a un tile NUEVO (el que difundía la proyección)", Boolean(nuevo), String(nuevo));
  if (!nuevo) return;
  ctx.log(`tile nuevo: ${nuevo} · tiles ahora ${JSON.stringify(await ctx.nefan("tiles"))}`);

  // EL CRITERIO DEL BLOQUE, y hay que tener cuidado con CÓMO se afirma.
  //
  // La primera versión de este guion leía aquí `#hp-text-<id>` y comprobaba
  // que siguiera valiendo lo mismo. Salía verde CON EL DEFECTO PUESTO, y por
  // la peor de las razones: cuando el bridge deja de nombrar al enemigo, el
  // cliente no borra su barra — la CONGELA con el último valor recibido. O sea
  // que el número que se leía era exactamente el mismo con y sin proyección.
  // Un verde que no puede ponerse rojo por lo que dice medir.
  //
  // Lo que sí distingue los dos mundos son estas dos cosas:
  //  · que el bridge SIGA nombrando al enemigo en `state_update` DESPUÉS del
  //    tile nuevo (la proyección lo borraba de `store.state.enemies`, que es
  //    lo que itera `getEnemyStates`), y
  //  · que el jugador pueda VOLVER A HERIRLO y ver bajar el número. Con la
  //    barra congelada se puede pegar todo lo que se quiera: el HUD no se
  //    mueve, y eso es «el combate se perdió» visto por quien juega.
  const vidaTrasViajar = await vidaEnElHud(ctx, BANDIDO);
  ctx.expect(
    "la barra del enemigo sigue en el HUD tras cambiar de tile",
    typeof vidaTrasViajar === "number",
    `#hp-text-${BANDIDO} = ${JSON.stringify(vidaTrasViajar)}`,
  );
  const trasViajar = await medir(ctx, BANDIDO);
  ctx.log(`${BANDIDO} tras el viaje: ${JSON.stringify(trasViajar)}`);
  await ctx.shot("enemigo-tras-cambiar-de-tile");

  // (a) el bridge sigue nombrándolo. Se cuenta desde CERO a partir de aquí:
  // lo que importa no es cuántas veces salió antes del viaje.
  await ctx.page.evaluate(() => {
    window.__qaCanales.enemies = {};
  });
  const siguenLlegando = await ctx
    .waitFor(
      "el bridge SIGUE nombrando al enemigo en state_update después del tile nuevo",
      (eid) => (window.__qaCanales.enemies[eid] ?? 0) >= 5 ? window.__qaCanales.enemies[eid] : null,
      20_000,
      BANDIDO,
    )
    .catch(() => null);
  ctx.expect(
    "el bridge SIGUE nombrando al enemigo en state_update después del tile nuevo",
    Boolean(siguenLlegando),
    `frames con ${BANDIDO} tras el viaje: ${JSON.stringify(await ctx.page.evaluate(() => window.__qaCanales.enemies))}`,
  );

  // (b) y se le puede volver a pegar: el número BAJA otra vez.
  const cerca = await acercarse(ctx, BANDIDO, 30);
  ctx.log(`de vuelta a ${cerca?.d?.toFixed(2)} m de ${BANDIDO} (vida HUD ${vidaTrasViajar})`);
  const segundaHerida = await herirHasta(ctx, BANDIDO, vidaTrasViajar - 1, 90_000);
  const vidaFinal = await vidaEnElHud(ctx, BANDIDO);
  if (segundaHerida?.jugadorMuerto) {
    ctx.log(`☠ el jugador murió en la segunda pelea (vida del enemigo ${vidaFinal})`);
  }
  ctx.expect(
    "…y en el tile nuevo el enemigo SIGUE siendo alguien a quien pegar: su vida vuelve a bajar",
    typeof vidaFinal === "number" && vidaFinal < vidaTrasViajar,
    `${vidaHerido} (antes de viajar) → ${vidaTrasViajar} (al cruzar) → ${vidaFinal} (tras volver a pegarle)`,
  );
  await ctx.shot("enemigo-herido-de-nuevo-tras-el-viaje");

  // ── 2 · UN SOLO DUEÑO: el hostil no entra en la vida ambiental ──────────
  const canales = await ctx.page.evaluate(() => window.__qaCanales);
  ctx.log(
    `state_update: ${canales.updates} frames · npcs=${JSON.stringify(canales.npcs)} · ` +
      `enemies=${JSON.stringify(canales.enemies)}`,
  );
  ctx.expect(
    "el bridge está emitiendo state_update de verdad (si no, lo de abajo sería un verde vacío)",
    canales.updates > 0 && (canales.enemies[BANDIDO] ?? 0) > 0,
    JSON.stringify({ updates: canales.updates, enemies: canales.enemies }),
  );
  ctx.expect(
    "el hostil sale por el canal de COMBATE del state_update",
    (canales.enemies[BANDIDO] ?? 0) > 0,
    `enemies[${BANDIDO}] = ${canales.enemies[BANDIDO] ?? 0}`,
  );
  ctx.expect(
    "el hostil NUNCA sale por el canal de la VIDA AMBIENTAL (serían dos dueños de su posición)",
    (canales.npcs[BANDIDO] ?? 0) === 0,
    `npcs[${BANDIDO}] = ${canales.npcs[BANDIDO] ?? 0} · npcs vistos: ${JSON.stringify(Object.keys(canales.npcs))}`,
  );
  ctx.expect(
    "…y el control: el mercader del mismo tile SÍ sale por él (si no, el aserto de arriba no mediría nada)",
    (canales.npcs[MERCADER] ?? 0) > 0,
    `npcs[${MERCADER}] = ${canales.npcs[MERCADER] ?? 0}`,
  );

  // La otra cara del mismo guardia, en el dato que sobrevive al save: la vida
  // ambiental MUTA `record.position` in situ. El del mercader se ha movido; el
  // del hostil tiene que seguir donde lo puso el motor.
  const l1 = await ledger(ctx);
  const enemigoQuieto = await ctx.waitFor(
    "el mercader se mueve en el ledger (la vida ambiental está corriendo)",
    (a) =>
      fetch(`${a.base}/entities`)
        .then((r) => r.json())
        .then((b) => {
          const pos = Object.fromEntries((b.entities ?? []).map((e) => [e.id, e.position]));
          const movio = JSON.stringify(pos[a.mercader]) !== JSON.stringify(a.l1[a.mercader]);
          return movio ? { mercader: pos[a.mercader], hostil: pos[a.bandido] } : null;
        })
        .catch(() => null),
    60_000,
    {
      base: String(await ctx.page.evaluate(() => window.__nefan.servicios()["world-state"])).replace(/\/+$/, ""),
      mercader: MERCADER,
      bandido: BANDIDO,
      l1,
    },
  ).catch(() => null);
  if (enemigoQuieto) {
    ctx.log(
      `ledger: ${MERCADER} ${JSON.stringify(l1[MERCADER])} → ${JSON.stringify(enemigoQuieto.mercader)} · ` +
        `${BANDIDO} ${JSON.stringify(l1[BANDIDO])} → ${JSON.stringify(enemigoQuieto.hostil)}`,
    );
    ctx.expect(
      "el registro del hostil no lo mueve nadie mientras el del mercader sí se mueve",
      JSON.stringify(enemigoQuieto.hostil) === JSON.stringify(l1[BANDIDO]),
      `${JSON.stringify(l1[BANDIDO])} → ${JSON.stringify(enemigoQuieto.hostil)}`,
    );
  } else {
    ctx.log("⚠ el mercader no se movió en 60 s: la mitad del ledger no se pudo medir en esta corrida");
  }

  // ── Hallazgos abiertos de QA, medidos aquí y sin poner el banco en rojo ──
  const rotulo = await ctx.page.evaluate((eid) => {
    const fill = document.getElementById(`hp-${eid}`);
    const fila = fill?.closest(".nf-vital");
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    return {
      barra: fila?.querySelector(".nf-vital-label")?.textContent ?? null,
      nombre: e?.label ?? null,
      // Los rótulos de MUNDO que el juego tiene colocados ahora mismo.
      mundo: Array.from(document.querySelectorAll(".world-label")).map((n) => n.dataset.labelId),
    };
  }, BANDIDO);
  if (rotulo.barra !== rotulo.nombre) {
    ctx.log(
      `⚠ HALLAZGO: el HUD llama al enemigo por su ID interno, no por su nombre — ` +
        `barra="${rotulo.barra}" · nombre="${rotulo.nombre}" (qa.md de 2026-08-29-que-el-jugador-pueda-pelear)`,
    );
  }
  if (!rotulo.mundo.includes(BANDIDO)) {
    ctx.log(
      `⚠ HALLAZGO: un enemigo no recibe rótulo de mundo ni enciende la mirilla ` +
        `(updateWorldLabels solo recorre npcEntities) — rótulos colocados: ${JSON.stringify(rotulo.mundo)}`,
    );
  }

  // ── 3 · EL MUERTO NO VUELVE ────────────────────────────────────────────
  // La tercera mitad del mismo hecho, y la que se extendió con #326: lo que
  // le hiciste al enemigo sobrevive también a CERRAR LA PARTIDA. Hasta esa
  // tanda, `enemy_died` solo tocaba el store volátil y nadie escribía la
  // muerte en el ledger, así que reanudar devolvía `alive:true, hp:60` a un
  // enemigo matado dos veces (medido jugando en el QA de #323, que lo dejó en
  // backlog sin issue). Aquí se mata de verdad, se reanuda por la tarjeta del
  // save —como quien juega— y se afirma que NO está.
  const rematado = await herirHasta(ctx, BANDIDO, 0, 90_000);
  ctx.expect(
    "el jugador consigue MATAR al enemigo (si no, no hay muerte que persistir)",
    Boolean(rematado?.muerto),
    JSON.stringify(rematado),
  );
  if (!rematado?.muerto) {
    ctx.log("⚠ sin muerte no se puede medir el resume; el guion termina aquí");
    return;
  }
  await ctx.shot("enemigo-muerto-antes-de-reanudar");

  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(
    `button[data-action="resume"][data-session-id="${partida.sessionId}"]`,
  );
  ctx.expect("el título ofrece REANUDAR la partida recién jugada", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  await ctx.shot("partida-reanudada-sin-el-muerto");

  // PRECONDICIÓN, y no es ceremonia: sin ella «el muerto no está» saldría
  // verde también con un resume que no trajera NADA, que es el otro desenlace
  // malo. El mundo tiene que haber vuelto para que su ausencia signifique algo.
  const mundoVuelto = await ctx.waitFor(
    "el mundo vuelve al reanudar (el tabernero está en escena)",
    (id) => (window.__nefan.npcs().some((n) => n.id === id) ? window.__nefan.npcs().length : null),
    60_000,
    MERCADER,
  ).catch(() => null);
  ctx.expect(
    "el mundo vuelve al reanudar (si no, lo de abajo sería un verde vacío)",
    Boolean(mundoVuelto),
    `npcs tras reanudar: ${JSON.stringify(await ctx.nefan("npcs"))}`,
  );

  const trasReanudar = await ctx.page.evaluate((eid) => ({
    enemigos: window.__nefan.enemies(),
    barra: document.getElementById(`hp-text-${eid}`)?.textContent ?? null,
    // Los nombres que el HUD tiene puestos: dos filas con el mismo nombre son
    // la señal de la SEGUNDA PUERTA (el mismo enemigo entrando dos veces).
    nombres: Array.from(document.querySelectorAll(".nf-vital-label")).map((n) => n.textContent),
  }), BANDIDO);
  ctx.log(`tras reanudar: ${JSON.stringify(trasReanudar)}`);
  ctx.expect(
    "el enemigo MUERTO no vuelve al mundo tras reanudar",
    !trasReanudar.enemigos.some((e) => e.id === BANDIDO),
    JSON.stringify(trasReanudar.enemigos),
  );
  ctx.expect(
    "…y tampoco vuelve su barra de vida al HUD",
    trasReanudar.barra === null,
    `#hp-text-${BANDIDO} = ${JSON.stringify(trasReanudar.barra)}`,
  );

  // SIN DUPLICADOS: el riesgo peor de rehidratar el mundo es abrirle una
  // segunda puerta al mismo enemigo (vuelve por la escena Y por el ledger) —
  // dos barras en el HUD y un solo combatiente en el sim, o sea una barra que
  // no baja nunca.
  const ids = trasReanudar.enemigos.map((e) => e.id);
  ctx.expect(
    "ningún enemigo vuelve por dos puertas (ids sin repetir)",
    new Set(ids).size === ids.length,
    JSON.stringify(ids),
  );
  ctx.expect(
    "…ni hay dos barras con el mismo nombre en el HUD",
    new Set(trasReanudar.nombres).size === trasReanudar.nombres.length,
    JSON.stringify(trasReanudar.nombres),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
