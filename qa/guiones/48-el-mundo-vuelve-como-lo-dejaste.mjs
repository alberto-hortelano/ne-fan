/** Lo que el motor puso delante SIGUE ahí después de reanudar (#326).
 *
 *  El otro lado del guion 42. Aquel mide lo que declara una ESCENA (el
 *  bandido del tile de bootstrap); este mide lo que el motor materializa a
 *  mitad de conversación —consequences `spawn_entity`— y que no está en el
 *  Format D de ninguna escena: un hostil, un NPC pacífico, un objeto y un
 *  edificio. Es la decisión de diseño central de CLAUDE.md («las entidades se
 *  materializan en runtime»), y hasta esta tanda bastaba reanudar para
 *  borrarla entera.
 *
 *  Lo que se afirma, y por qué cada cosa:
 *   1 · LOS CUATRO VUELVEN Y SE PINTAN. El enemigo en `enemies()` con su
 *       barra, el pacífico en `npcs()`, el cofre y la forja en `objects()`.
 *   2 · EL HERIDO VUELVE HERIDO. Al Secuaz se le baja la vida antes de
 *       cerrar, y al volver el HUD lee ESE número, no los 60 del contrato —
 *       sobre denominador 60, que es la otra mitad (un herido con la barra
 *       llena se ve exactamente igual que uno entero).
 *   3 · Y SE LE PUEDE PEGAR. Volver PINTADO no basta: si el alta en el sim no
 *       llega, el jugador ve al enemigo y le atraviesa la espada sin efecto.
 *       Es el hallazgo I-3 de #323 literal, y es el rojo de partida.
 *   4 · EL PACÍFICO NO ANDA INVISIBLE. `npcSync` ya lo rehidrataba en el
 *       bridge y el cliente lo tiraba mudo en un `continue`: existía a medias
 *       —el bridge lo movía, la pantalla no lo tenía—. Se afirma por los DOS
 *       canales: que el bridge lo nombre en `state_update.npcs` y que el
 *       cliente tenga su cuerpo en escena.
 *   5 · SIN DUPLICADOS. El riesgo peor de rehidratar es abrir una SEGUNDA
 *       puerta al mismo id (que vuelva por la escena Y por el ledger): dos
 *       barras en el HUD y un solo combatiente en el sim, o sea una barra que
 *       no baja nunca. Ids repetidos y nombres repetidos, los dos.
 *
 *  PROBADO EN NEGATIVO (2026-08-31, sobre el árbol de la tanda): quitando la
 *  rehidratación del resume —el `for (const spawn of spawns)
 *  materializeSpawn(spawn)` de `nefan-html/src/main.ts`— el guion se pone
 *  rojo en «lo que el motor puso a mitad de partida SIGUE ahí tras reanudar»,
 *  y el volcado enseña el defecto entero: tras reanudar solo quedan
 *  `bandido_1` y el tabernero (los de la escena), sin Secuaz, sin Nogala, sin
 *  cofre y sin forja.
 *
 *  Contra `main` a secas no se puede correr —el hook `__nefan.objects()` con
 *  el que nombra el cofre y la forja nace con esta tanda—, que es la razón de
 *  medir el rojo quitando la pieza en vez de retroceder el árbol.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server;
 *  el turno 3 de `labs/narrative/fake-ai-server.ts` es quien manda el trío.
 */
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { URLS } from "../lib/stack.mjs";

/** El fake es determinista por turno de diálogo (`fakeDialogueTurn`), así que
 *  hace falta empezar de cero: saves vírgenes y contador a 0. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";
/** Los nombres que el motor falso pone en los turnos 2 y 3. Se buscan por
 *  NOMBRE y no por id porque los ids de un spawn de runtime los genera el
 *  bridge (`narr_npc_<epoch>_<n>`) y nadie los puede predecir. */
const HOSTIL = "Secuaz";
const PACIFICO = "Nogala";
const OBJETO = "Cofre de la posada";
const EDIFICIO = "Forja de Robledo";
/** Alcance útil del golpe rápido (óptimo 1,5 m + tolerancia 1,0). */
const DISTANCIA_DE_GOLPE = 1.6;
/** Hasta dónde se hiere al Secuaz antes de cerrar. No se le mata: un cadáver
 *  no puede demostrar que la HERIDA sobrevive al resume. */
const VIDA_OBJETIVO = 40;

const vidaEnElHud = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const el = document.getElementById(`hp-text-${eid}`);
    if (!el) return null;
    const n = Number(el.textContent);
    return Number.isFinite(n) ? n : null;
  }, id);

/** Pega hasta dejar al enemigo por debajo de `objetivo` SIN matarlo, como
 *  quien juega: re-encarándose y cerrando la distancia. La condición de
 *  parada es la vida del HUD, no un reloj. Mismo molde que el guion 42. */
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

/** Camina hasta el NPC por el camino del jugador (yaw + tecla de avance). */
async function acercarseAlNpc(ctx, id, objetivo = 2.2, tramos = 12) {
  for (let i = 0; i < tramos; i++) {
    const n = await ctx.page.evaluate((npcId) => {
      const e = window.__nefan.npcs().find((x) => x.id === npcId);
      if (!e) return null;
      const p = window.__nefan.state().pos;
      return { d: Math.hypot(e.pos.x - p.x, e.pos.z - p.z), dx: e.pos.x - p.x, dz: e.pos.z - p.z };
    }, id);
    if (!n || n.d <= objetivo) return n;
    await ctx.nefan("setYaw", Math.atan2(n.dx, n.dz));
    await ctx
      .holdUntil(
        "up",
        `el jugador se acerca a ${id} (tramo ${i + 1}, ahora ${n.d.toFixed(1)} m)`,
        (a) => {
          const e = window.__nefan.npcs().find((x) => x.id === a.id);
          if (!e) return null;
          const p = window.__nefan.state().pos;
          return Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= a.objetivo ? true : null;
        },
        4_000,
        { id, objetivo },
      )
      .catch(() => null);
  }
  return null;
}

/** Lo que el cliente tiene en escena AHORA, por las tres listas y el HUD. */
const mundo = (ctx) =>
  ctx.page.evaluate(() => ({
    enemigos: window.__nefan.enemies(),
    npcs: window.__nefan.npcs(),
    objetos: window.__nefan.objects(),
    barras: Array.from(document.querySelectorAll(".nf-vital-label")).map((n) => n.textContent),
  }));

export default async function (ctx) {
  // La sonda de frames va ANTES de que cargue la app y SOBREVIVE al reload:
  // se cuentan ids por canal para poder afirmar por dónde sale cada quien.
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
            return;
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

  // ── 1 · EL MOTOR PUEBLA EL MUNDO A MITAD DE CONVERSACIÓN ────────────────
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarseAlNpc(ctx, MERCADER);
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);

  // Turno 2: el hostil. Turno 3: el NPC pacífico, el objeto y el edificio.
  await ctx.nefan("chooseDialogue", 0);
  const hostil = await ctx
    .waitFor(
      `el motor materializa a "${HOSTIL}" (spawn_entity hostil, sin recargar la escena)`,
      (n) => window.__nefan.enemies().find((e) => e.label === n || e.id === n) ?? null,
      90_000,
      HOSTIL,
    )
    .catch(() => null);
  ctx.expect("el turno 2 del motor pone un enemigo delante", Boolean(hostil), JSON.stringify(hostil));
  if (!hostil) return;

  await ctx.nefan("chooseDialogue", 0);
  const trio = await ctx
    .waitFor(
      "el motor materializa el resto del mundo: npc pacífico + objeto + edificio",
      (n) => {
        const npc = window.__nefan.npcs().find((x) => x.label === n.pacifico);
        const objetos = window.__nefan.objects();
        const cofre = objetos.find((o) => o.label === n.objeto);
        const forja = objetos.find((o) => o.label === n.edificio);
        return npc && cofre && forja ? { npc, cofre, forja } : null;
      },
      90_000,
      { pacifico: PACIFICO, objeto: OBJETO, edificio: EDIFICIO },
    )
    .catch(() => null);
  ctx.expect(
    "el turno 3 del motor pone un NPC pacífico, un objeto y un edificio",
    Boolean(trio),
    JSON.stringify(await mundo(ctx)),
  );
  if (!trio) return;
  ctx.log(`spawns de runtime: ${JSON.stringify({ hostil: hostil.id, ...Object.fromEntries(Object.entries(trio).map(([k, v]) => [k, v.id]))})}`);

  // Cerrar la conversación para poder pelear (con el panel abierto el cliente
  // suprime el ataque) y herir al Secuaz SIN matarlo.
  await ctx.nefan("advanceDialogue");
  await ctx
    .waitFor("la conversación se cierra", () => (window.__nefan.dialogueVisible ? null : true), 15_000)
    .catch(() => null);
  const herido = await herirHasta(ctx, hostil.id, VIDA_OBJETIVO);
  ctx.expect(
    "el jugador HIERE al enemigo de runtime sin matarlo (si no, no hay herida que sobreviva)",
    Boolean(herido) && !herido.jugadorMuerto && !herido.muerto,
    JSON.stringify(herido),
  );
  if (!herido || herido.jugadorMuerto || herido.muerto) return;
  const vidaAntes = await vidaEnElHud(ctx, hostil.id);
  const antes = await mundo(ctx);
  ctx.log(`${HOSTIL} queda en ${vidaAntes} PV · mundo antes: ${JSON.stringify(antes)}`);
  await ctx.shot("mundo-poblado-antes-de-reanudar");

  // HACE FALTA UN GUARDADO, y decirlo entero: el trío ya está en el save (el
  // bridge guarda en cada turno de diálogo), pero la HERIDA no — pegarle a
  // alguien no guarda la partida, igual que andar tampoco guarda la posición
  // del jugador. La garantía que esta tanda añade es «la vida VIVA viaja en
  // los saves que ya existen», ni mejor ni peor que la del jugador desde
  // #245, así que el guion tiene que provocar uno.
  //
  // Se provoca por el cable del MOTOR (State API → `onMutation` → save), como
  // el guion 17: es una escritura que ocurre de verdad en cualquier partida
  // —el motor toca el mapa a mitad de turno— y no exige meter al jugador en
  // otra conversación con un enemigo pegándole, que es lo que haría el
  // camino de diálogo y lo que convertiría este guion en una carrera contra
  // la barra de vida del jugador.
  const eco = await fetch(`${URLS.state_api}/map/place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "qa48_testigo",
      kind: "site",
      parent_id: null,
      name: "Piedra testigo",
      description: "Fuerza un guardado tras herir al enemigo (guion 48).",
    }),
  });
  ctx.expect(
    "el motor puede escribir en la partida (es lo que fuerza el guardado de la herida)",
    eco.status === 200,
    `POST /map/place → ${eco.status}`,
  );

  // ── 2 · SE REANUDA POR LA TARJETA DEL SAVE, COMO QUIEN JUEGA ────────────
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(
    `button[data-action="resume"][data-session-id="${partida.sessionId}"]`,
  );
  ctx.expect("el título ofrece REANUDAR la partida", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );

  // ── 3 · LOS CUATRO VUELVEN ──────────────────────────────────────────────
  const vuelto = await ctx
    .waitFor(
      "el mundo de runtime vuelve entero: enemigo + npc pacífico + objeto + edificio",
      (n) => {
        const enemigo = window.__nefan.enemies().find((e) => e.label === n.hostil);
        const npc = window.__nefan.npcs().find((x) => x.label === n.pacifico);
        const cofre = window.__nefan.objects().find((o) => o.label === n.objeto);
        const forja = window.__nefan.objects().find((o) => o.label === n.edificio);
        return enemigo && npc && cofre && forja ? { enemigo, npc, cofre, forja } : null;
      },
      60_000,
      { hostil: HOSTIL, pacifico: PACIFICO, objeto: OBJETO, edificio: EDIFICIO },
    )
    .catch(() => null);
  const despues = await mundo(ctx);
  ctx.log(`mundo tras reanudar: ${JSON.stringify(despues)}`);
  await ctx.shot("mundo-reanudado");
  ctx.expect(
    "lo que el motor puso a mitad de partida SIGUE ahí tras reanudar (las cuatro clases)",
    Boolean(vuelto),
    JSON.stringify(despues),
  );
  if (!vuelto) return;

  // 3.a · el herido vuelve HERIDO, y sobre su denominador.
  const vidaDespues = await vidaEnElHud(ctx, vuelto.enemigo.id);
  ctx.expect(
    "el enemigo herido vuelve CON SU HERIDA, no con la vida del contrato",
    typeof vidaDespues === "number" && vidaDespues <= VIDA_OBJETIVO,
    `antes ${vidaAntes} PV · tras reanudar ${vidaDespues} PV (el contrato son 60)`,
  );
  ctx.expect(
    "…y su barra se pinta sobre el denominador entero (60), no sobre lo que le queda",
    vuelto.enemigo.maxHp === 60,
    `hp ${vuelto.enemigo.hp} / maxHp ${vuelto.enemigo.maxHp}`,
  );

  // 3.b · y se le puede PEGAR: volver pintado no basta (I-3 de #323).
  const segundaHerida = await herirHasta(ctx, vuelto.enemigo.id, (vidaDespues ?? VIDA_OBJETIVO) - 1, 90_000);
  const vidaFinal = await vidaEnElHud(ctx, vuelto.enemigo.id);
  if (segundaHerida?.jugadorMuerto) ctx.log(`☠ el jugador murió peleando (enemigo en ${vidaFinal})`);
  ctx.expect(
    "…y el enemigo que vuelve es alguien a quien PEGAR: el sim lo tiene y su vida baja otra vez",
    typeof vidaFinal === "number" && vidaFinal < vidaDespues,
    `${vidaAntes} (antes de cerrar) → ${vidaDespues} (al reanudar) → ${vidaFinal} (tras volver a pegarle)`,
  );
  await ctx.shot("enemigo-de-runtime-herido-tras-reanudar");

  // 3.c · el pacífico no anda invisible: los DOS canales.
  const canales = await ctx.page.evaluate(() => window.__qaCanales);
  ctx.log(`state_update: ${canales.updates} frames · npcs=${JSON.stringify(canales.npcs)}`);
  // Que el cliente TIENE su cuerpo ya lo afirma el `waitFor` de arriba (sin él
  // no se llega hasta aquí); lo que falta es la otra mitad de «no anda
  // invisible»: que el bridge lo esté MOVIENDO. Un aserto `Boolean(vuelto.npc)`
  // aquí sería una tautología detrás de su propio `if (!vuelto) return` — así
  // nació y así lo cazó QA (H-9).
  ctx.expect(
    "el pacífico no anda invisible: el bridge lo MUEVE y el cliente tiene su cuerpo",
    (canales.npcs[vuelto.npc.id] ?? 0) > 0,
    `npcs[${vuelto.npc.id}] = ${canales.npcs[vuelto.npc.id] ?? 0} · vistos: ${JSON.stringify(Object.keys(canales.npcs))} · npcs del cliente: ${JSON.stringify(despues.npcs)}`,
  );

  // 3.d · SIN DUPLICADOS, que es la señal de una segunda puerta.
  const ids = despues.enemigos.map((e) => e.id);
  ctx.expect(
    "ningún enemigo vuelve por dos puertas (ids sin repetir)",
    new Set(ids).size === ids.length,
    JSON.stringify(ids),
  );
  ctx.expect(
    "…ni hay dos barras con el mismo nombre en el HUD",
    new Set(despues.barras).size === despues.barras.length,
    JSON.stringify(despues.barras),
  );
  const idsNpc = despues.npcs.map((n) => n.id);
  const idsObj = despues.objetos.map((o) => o.id);
  ctx.expect(
    "…ni el pacífico, el cofre o la forja se duplican al rehidratarse",
    new Set(idsNpc).size === idsNpc.length && new Set(idsObj).size === idsObj.length,
    `npcs: ${JSON.stringify(idsNpc)} · objetos: ${JSON.stringify(idsObj)}`,
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
