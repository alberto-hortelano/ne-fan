/** El mundo que puso el motor aguanta REANUDAR DOS VECES, y el hostil de
 *  runtime al que mataste tampoco vuelve (#326, QA 2026-08-31).
 *
 *  El guion 48 mide UN resume: los cuatro vuelven y el herido vuelve herido.
 *  Esto mide lo que aquel deja fuera y que es donde vive el riesgo peor de
 *  rehidratar —la SEGUNDA PUERTA—, porque una puerta de más no se ve en el
 *  primer resume: se ve cuando el mundo rehidratado se vuelve a guardar y a
 *  rehidratar encima. Si el resume dejara al spawn en el ledger por partida
 *  doble, o si el `materializeSpawn` del resume acabara escribiendo una
 *  entity nueva, el segundo resume traería dos Nogalas, dos cofres o dos
 *  barras con el mismo nombre. Hoy no: se afirma id a id.
 *
 *  Y la otra mitad del criterio 1 de `requisitos.md` que ningún guion recorre
 *  andando: «el muerto no vuelve» **para la procedencia de RUNTIME**. El 42
 *  lo mide con el enemigo de la ESCENA (`bandido_1`, que vuelve por la escena)
 *  y el unitario `mundo-persistido.test.ts` lo mide con un `EntityRecord` a
 *  mano; entre los dos falta el camino entero: el motor pone un enemigo a
 *  mitad de conversación, el jugador lo mata, reanuda y el enemigo no está —
 *  mientras el resto de lo que puso el motor sí.
 *
 *  PROBADO EN NEGATIVO (2026-08-31, sobre el árbol de la tanda):
 *   · Bloque 1 — quitando el `for (const spawn of spawns) materializeSpawn(spawn)`
 *     del resume (`nefan-html/src/main.ts`), «los cuatro siguen ahí tras el
 *     SEGUNDO resume» se pone rojo: vuelven `bandido_1` y el tabernero (los de
 *     la escena) y nada más.
 *   · Bloque 3 — quitando el guardado al morir de `handleInput`
 *     (`nefan-core/bridge/handlers/simulation.ts`), «el hostil de RUNTIME al
 *     que mataste no vuelve al reanudar» se pone rojo: la muerte no llega al
 *     ledger y el Secuaz vuelve entero.
 *   · Y un negativo que NO sirve, contado porque cuesta descubrirlo dos veces:
 *     quitar el filtro de muertos de `spawnsDeRuntime` deja el guion VERDE. El
 *     muerto sí sale de ahí, pero el cliente lo rechaza en su segunda puerta
 *     (`enemigoDesdeCombat` exige `health > 0`); lo único que cambia es que el
 *     registro de errores se llena de un descarte que no es un fallo. Ese
 *     filtro lo mide `test/mundo-persistido.test.ts`, no esto.
 *
 *  ⚠ HALLAZGO que este guion MIDE y no pone en rojo (su dueño aún no lo ha
 *  arreglado; convención del guion 24): un OBJETO o EDIFICIO de runtime
 *  desaparece del cliente cuando su tile se vuelve a difundir —viajar por el
 *  panel «Salidas» y volver—, porque `addTile` purga `objectEntities` por
 *  rect. El resume lo repara (vuelven del ledger), así que no incumple el
 *  criterio 5, pero es la misma promesa rota en un estado que el jugador
 *  alcanza antes.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el trío del turno 3 y el hostil
 *  del turno 2 los pone `labs/narrative/fake-ai-server.ts`.
 */
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";

/** El motor falso es determinista POR TURNO de diálogo, así que hace falta
 *  empezar de cero: saves vírgenes y el contador a 0. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";
const HOSTIL = "Secuaz";
const PACIFICO = "Nogala";
const OBJETO = "Cofre de la posada";
const EDIFICIO = "Forja de Robledo";
/** Alcance útil del golpe rápido (óptimo 1,5 m + tolerancia 1,0). */
const DISTANCIA_DE_GOLPE = 1.6;

/** Lo que el cliente tiene en escena AHORA, por las tres listas y el HUD. */
const mundo = (ctx) =>
  ctx.page.evaluate(() => ({
    enemigos: window.__nefan.enemies().map((e) => ({ id: e.id, label: e.label, hp: e.hp, maxHp: e.maxHp })),
    npcs: window.__nefan.npcs().map((n) => ({ id: n.id, label: n.label })),
    objetos: window.__nefan.objects().map((o) => ({ id: o.id, label: o.label })),
    barras: Array.from(document.querySelectorAll(".nf-vital-label")).map((n) => n.textContent),
    tile: window.__nefan.currentTile,
    exits: (window.__nefan.exits ?? []).map((e) => ({ place_id: e.place_id, name: e.name })),
  }));

/** Reanuda por la tarjeta del save, como quien juega. */
async function reanudar(ctx, sessionId, etiqueta) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect(`el título ofrece REANUDAR la partida (${etiqueta})`, Boolean(tarjeta), sessionId);
  if (!tarjeta) return false;
  await tarjeta.click();
  await ctx.waitFor(
    `la escena vuelve tras reanudar (${etiqueta})`,
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  // El mundo del save llega en el mismo `session_started`; se espera al
  // tabernero, que es de la escena, para no medir a mitad de montaje.
  await ctx.absorbe(
    "solo evita medir a mitad de montaje; lo que el mundo TRAE tras reanudar lo afirman los " +
      "asertos del bloque que llamó a `reanudar` (los cuatro siguen ahí, ninguno duplicado…), " +
      "que es donde vive la medida",
    () =>
      ctx.waitFor(
        `el mundo se monta tras reanudar (${etiqueta})`,
        (id) => (window.__nefan.npcs().some((n) => n.id === id) ? true : null),
        60_000,
        MERCADER,
      ),
  );
  return true;
}

/** Pulsa el botón del panel «Salidas» que nombra `nombre` (el camino del
 *  jugador: un click, no una llamada a la API). */
async function pulsarSalida(ctx, nombre) {
  const botones = await ctx.page.$$eval("#travel-panel button.travel-exit", (bs) =>
    bs.map((b) => b.textContent ?? ""),
  );
  const idx = botones.findIndex((t) => t.includes(nombre));
  if (idx < 0) return false;
  await ctx.page.$$eval("#travel-panel button.travel-exit", (bs, i) => bs[i].click(), idx);
  return true;
}

const sinRepetir = (xs) => new Set(xs).size === xs.length;

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  // ── 0 · EL MOTOR PUEBLA EL MUNDO A MITAD DE CONVERSACIÓN ────────────────
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);

  await ctx.nefan("chooseDialogue", 0);
  const hostil = await ctx
    .waitFor(
      `el motor materializa a "${HOSTIL}" (turno 2)`,
      (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
      90_000,
      HOSTIL,
    )
    .catch(() => null);
  await ctx.nefan("chooseDialogue", 0);
  const trio = await ctx
    .waitFor(
      "el motor materializa npc pacífico + objeto + edificio (turno 3)",
      (n) => {
        const npc = window.__nefan.npcs().find((x) => x.label === n.pacifico);
        const cofre = window.__nefan.objects().find((o) => o.label === n.objeto);
        const forja = window.__nefan.objects().find((o) => o.label === n.edificio);
        return npc && cofre && forja ? { npc, cofre, forja } : null;
      },
      90_000,
      { pacifico: PACIFICO, objeto: OBJETO, edificio: EDIFICIO },
    )
    .catch(() => null);
  if (!hostil || !trio) {
    ctx.sinMedir(
      `el motor falso no pobló el mundo (hostil=${Boolean(hostil)}, trío=${Boolean(trio)}): ` +
        `sin las cuatro clases no hay nada que rehidratar. Mundo: ${JSON.stringify(await mundo(ctx))}`,
    );
    return;
  }
  await ctx.nefan("advanceDialogue");
  // Con el panel abierto el cliente SUPRIME el ataque: sin este cierre no hay
  // pelea que medir, así que se AFIRMA (#261) en vez de tragarlo.
  await ctx.expectEspera(
    "la conversación se cierra (con el panel abierto el cliente suprime el ataque)",
    true,
    () => (window.__nefan.dialogueVisible ? null : true),
    { ms: 15_000 },
  );
  ctx.log(`spawns de runtime: ${JSON.stringify({ hostil: hostil.id, npc: trio.npc.id, cofre: trio.cofre.id, forja: trio.forja.id })}`);

  // ── 1 · DOS RESUMES SEGUIDOS, SIN SEGUNDA PUERTA ────────────────────────
  if (!(await reanudar(ctx, partida.sessionId, "1ª"))) return;
  const uno = await mundo(ctx);
  ctx.log(`tras el PRIMER resume: ${JSON.stringify(uno)}`);
  if (!(await reanudar(ctx, partida.sessionId, "2ª"))) return;
  const dos = await mundo(ctx);
  ctx.log(`tras el SEGUNDO resume: ${JSON.stringify(dos)}`);
  await ctx.shot("segundo-resume");

  ctx.expect(
    "los cuatro siguen ahí tras el SEGUNDO resume (hostil, pacífico, objeto y edificio)",
    dos.enemigos.some((e) => e.label === HOSTIL) &&
      dos.npcs.some((n) => n.label === PACIFICO) &&
      dos.objetos.some((o) => o.label === OBJETO) &&
      dos.objetos.some((o) => o.label === EDIFICIO),
    JSON.stringify(dos),
  );
  ctx.expect(
    "…y ninguno se duplicó por rehidratarse dos veces (ids de enemigos, npcs y objetos)",
    sinRepetir(dos.enemigos.map((e) => e.id)) &&
      sinRepetir(dos.npcs.map((n) => n.id)) &&
      sinRepetir(dos.objetos.map((o) => o.id)),
    JSON.stringify({ e: dos.enemigos.map((x) => x.id), n: dos.npcs.map((x) => x.id), o: dos.objetos.map((x) => x.id) }),
  );
  ctx.expect(
    "…ni hay dos barras con el mismo nombre en el HUD (la señal de la segunda puerta)",
    sinRepetir(dos.barras),
    JSON.stringify(dos.barras),
  );
  ctx.expect(
    "el hostil de runtime vuelve con su denominador entero también al segundo resume",
    dos.enemigos.find((e) => e.label === HOSTIL)?.maxHp === 60,
    JSON.stringify(dos.enemigos.find((e) => e.label === HOSTIL)),
  );

  // ── 2 · ⚠ HALLAZGO: re-emitir el tile se lleva los objetos de runtime ────
  // Se MIDE y se cuenta, no se pone en rojo: el defecto es anterior a #326
  // (`addTile` purga `objectEntities` por rect) y su dueño no lo ha arreglado.
  //
  // Este bloque MIDE y CUENTA, no afirma: por eso cuando no se puede ejercer
  // (sin salidas, sin vuelta, el viaje que no llega) lo dice por el canal ⊘
  // —`ctx.sinMedirBloque`, que no aborta— en vez de por un `ctx.log("⚠ … no se
  // midió")` que salía verde y nadie leía (#261). El guion sigue midiendo el
  // bloque 3.
  const viajado = dos.exits.length > 0 && (await pulsarSalida(ctx, dos.exits[0].name));
  if (!viajado) {
    ctx.sinMedirBloque(
      "el panel «Salidas» no ofrecía destino: sin ida y vuelta no se puede mirar qué le hace la " +
        "re-emisión del tile a los objetos de runtime",
    );
  } else {
    const fuera = await ctx.absorbe(
      "si el viaje no llega, este bloque se DECLARA sin medir aquí debajo: ningún verde de este " +
        "guion depende de esta espera",
      () =>
        ctx.waitFor(
          "el jugador llega al destino (otro tile)",
          (t) => (window.__nefan.currentTile && window.__nefan.currentTile !== t ? window.__nefan.currentTile : null),
          180_000,
          dos.tile,
        ),
    );
    const alli = fuera ? await mundo(ctx) : null;
    const vuelta = alli?.exits.find((e) => e.place_id !== dos.exits[0].place_id) ?? alli?.exits[0];
    if (!fuera) {
      ctx.sinMedirBloque(
        "el jugador no llegó al tile vecino en 180 s: la re-emisión del tile no se pudo mirar",
      );
    } else if (!vuelta || !(await pulsarSalida(ctx, vuelta.name))) {
      ctx.sinMedirBloque(
        "el destino no ofrecía vuelta: sin regresar al tile de partida no hay re-emisión que mirar",
      );
    } else {
      const volvio = await ctx.absorbe(
        "si la vuelta no llega, este bloque se DECLARA sin medir aquí debajo: mirar los objetos " +
          "del tile equivocado no es medir nada",
        () =>
          ctx.waitFor(
            "el jugador vuelve al tile de partida",
            (t) => (window.__nefan.currentTile === t ? t : null),
            180_000,
            dos.tile,
          ),
      );
      if (!volvio) {
        ctx.sinMedirBloque(
          "el jugador no volvió al tile de partida en 180 s: la re-emisión del tile no se pudo mirar",
        );
      } else {
        const regreso = await mundo(ctx);
        const sobreviven = {
          cofre: regreso.objetos.some((o) => o.label === OBJETO),
          forja: regreso.objetos.some((o) => o.label === EDIFICIO),
          pacifico: regreso.npcs.some((n) => n.label === PACIFICO),
          hostil: regreso.enemigos.some((e) => e.label === HOSTIL),
        };
        ctx.log(
          `⚠ HALLAZGO re-emisión del tile (ida y vuelta por «Salidas»): ${JSON.stringify(sobreviven)} · ` +
            `objetos ahora ${JSON.stringify(regreso.objetos.map((o) => o.label))}`,
        );
      }
    }
  }

  // ── 3 · EL MUERTO DE RUNTIME TAMPOCO VUELVE ─────────────────────────────
  // La otra procedencia del criterio 1. El 42 lo mide con el enemigo de la
  // escena; aquí se mata al que puso el motor a mitad de conversación.
  const trasViaje = await mundo(ctx);
  const elHostil = trasViaje.enemigos.find((e) => e.label === HOSTIL);
  if (!elHostil) {
    // `sinMedir` y no un `ctx.log` + `return`. El comentario que había aquí
    // decía que un ⊘ taparía un rojo del bloque 1, y era falso: el runner ya lo
    // impide desde #331 — un guion que declara con fallos ya empujados se queda
    // ROJO, porque un ⊘ es una declaración, no una amnistía. Lo que sí hacía el
    // `return` mudo era acabar en VERDE sin haber medido el bloque 3.
    ctx.sinMedir(
      `el hostil de runtime ya no está antes de poder matarlo (${JSON.stringify(trasViaje.enemigos)}): ` +
        `sin él, el bloque 3 —el muerto de runtime tampoco vuelve— no se puede medir`,
    );
  }
  const rematado = await herirHasta(ctx, elHostil.id, 0, {
    maxMs: 120_000,
    alcance: DISTANCIA_DE_GOLPE,
  });
  if (!rematado?.muerto) {
    ctx.log(`partida ${partida.sessionId} · fin del guion`);
    ctx.sinMedir(
      `no se pudo matar al hostil de runtime (${JSON.stringify(rematado)}): sin muerte no hay ` +
        `muerto que dejar de volver, y el bloque 3 no se puede medir`,
    );
  }
  await ctx.shot("hostil-de-runtime-muerto");
  if (!(await reanudar(ctx, partida.sessionId, "3ª, tras matarlo"))) return;
  const final = await mundo(ctx);
  ctx.log(`tras matar al hostil de runtime y reanudar: ${JSON.stringify(final)}`);
  ctx.expect(
    "el hostil de RUNTIME al que mataste no vuelve al reanudar",
    !final.enemigos.some((e) => e.id === elHostil.id),
    JSON.stringify(final.enemigos),
  );
  ctx.expect(
    "…ni vuelve su barra al HUD",
    !final.barras.includes(HOSTIL),
    JSON.stringify(final.barras),
  );
  ctx.expect(
    "…y el resto de lo que puso el motor SÍ vuelve (si no, esto sería un verde vacío)",
    final.npcs.some((n) => n.label === PACIFICO) && final.objetos.some((o) => o.label === EDIFICIO),
    JSON.stringify({ npcs: final.npcs, objetos: final.objetos }),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
