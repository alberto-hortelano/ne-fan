/** La réplica del motor que llega cuando la conversación YA NO ES LA ACTUAL no
 *  abre el panel modal: va al registro, entera (tanda BW, H1).
 *
 *  Lo que salió jugando el 2026-09-30: el jugador elige una opción, el panel se
 *  cierra, y la réplica tarda. Si mientras tanto empieza una pelea o el jugador
 *  se va, la réplica abría el panel igual — soltaba el ratón y apagaba el
 *  ataque (murió así contra Brasco), o seguía la conversación a cuatro horas
 *  de camino. Decide el bridge al llegar la réplica (`narrative/entrega-de-la-
 *  replica.ts`, core); aquí se mira lo que ve el jugador.
 *
 *   0 · PREMISA: se mata al bandido de la escena. Está a 4,6 m del tabernero,
 *       dentro de su radio de enganche (10 m), y PEGA mientras se habla: el
 *       jugador puede morir a mitad del guion. Con la opción B (2026-09-30,
 *       «en combate» = el JUGADOR ha atacado mientras el motor pensaba) su
 *       enganche ya no decide nada — ese es el hueco conocido: si te pegan y
 *       tú no atacas, el panel se abre —, pero la pelea sí estorba al guion.
 *   1 · CONTROL (el caso normal no cambia): E junto al tabernero → el panel se
 *       abre; texto libre con la marca que retiene la réplica, quieto a su
 *       lado, se suelta → el panel se abre con la réplica.
 *   2 · LEJOS: texto libre con la marca, el jugador se va a más de 18 m (el
 *       alcance del nombre del HUD) ANTES de que llegue, se suelta → el panel
 *       NO se abre, el ataque no se bloquea y el registro trae la línea del
 *       tabernero con su texto.
 *   3 · SE PUSO A PELEAR: de vuelta al lado del tabernero, texto libre con la
 *       marca, el jugador ATACA (un golpe al aire, quieto a su lado) antes de
 *       que llegue, se suelta → registro, con la pista «cuando acabe la
 *       pelea». Es el caso de H1a: Brasco bajó de 60 a 21 antes de la réplica.

 *  El motor falso RETIENE la réplica (`MARCA_REPLICA_TARDIA`, `POST
 *  /dev/soltar-replica`) en vez de tardar un tiempo fijo: el jugador tiene que
 *  haberse ido ANTES de que llegue, y con un reloj eso es una carrera.
 *
 *  ROJO EN MAIN (medido): sin la entrega de core, el bloque 2 abre el panel.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

/** `saves` para arrancar en el tile de bootstrap (el del bandido y el
 *  tabernero); `fake-ai` para que no haya réplica retenida heredada. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const BANDIDO = "bandido_1";
const TABERNERO = "barkeep";
/** La marca del motor falso (`labs/narrative/fake-ai-server.ts`,
 *  `MARCA_REPLICA_TARDIA`), copiada porque el guion es `.mjs`: si una cambia
 *  sin la otra, el bloque 1 se pone rojo (el motor no retiene nada). */
const MARCA = "REPLICA TARDIA";
/** A cuánto se va el jugador: más que el alcance del nombre (18 m). */
const LEJOS_M = 25;

/** "mundo": lo que tiene que correr mientras se espera es el sim (el bridge
 *  aprende la posición nueva del jugador por el input de cada frame). */
const frames = esperaDeFotogramas("mundo");

async function urlDelFake(ctx) {
  const url = await ctx.page.evaluate(() => window.__nefan.servicios?.()?.["narrative-llm"] ?? null);
  if (!url) throw new Error("el cliente no dice dónde está el motor (servicios()['narrative-llm'])");
  return url.replace(/\/$/, "");
}

/** Espera a que el motor falso tenga la réplica RETENIDA: el texto libre
 *  llegó. Se pregunta desde la página (el fake pone CORS) para que la espera
 *  sea la de `waitFor`, con su libro de esperas, y no un bucle a mano. */
const esperarRetenida = async (ctx, base) =>
  (await ctx.absorbe("si el motor no retiene la réplica, lo afirma el `expect` del sitio de llamada", () =>
    ctx.waitFor(
      "el motor falso tiene la réplica retenida (el texto libre llegó)",
      async (b) => ((await (await fetch(`${b}/dev/counters`)).json()).replicaRetenida === true ? true : null),
      60_000,
      base,
    ),
  )) === true;

async function soltar(base) {
  const r = await fetch(`${base}/dev/soltar-replica`, { method: "POST" });
  if (!r.ok) throw new Error(`/dev/soltar-replica: HTTP ${r.status} ${await r.text()}`);
}

/** Texto libre por el camino del jugador: T, escribir, Enter. */
async function textoLibre(ctx, frase) {
  // Las OPCIONES en pantalla, y no solo el texto completo: el typewriter las
  // pinta al acabar, y una T con él aún en marcha solo completa el texto (la
  // primera versión de este guion esperaba solo el texto y la T se perdía).
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
  await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(frase);
  await ctx.page.keyboard.press("Enter");
  await ctx.waitFor("el panel se cierra al mandar", () => (window.__nefan.dialogue().visible ? null : true), 10_000);
}

const lineasDelRegistro = (ctx) =>
  ctx.page.evaluate(() => [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? ""));

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  await comenzar(ctx);
  const base = await urlDelFake(ctx);

  // ── 0 · PREMISA: una conversación en paz ──────────────────────────────────
  await ctx.waitFor(`el bandido "${BANDIDO}" está en escena`, (id) => window.__nefan.enemies().find((x) => x.id === id) ?? null, 60_000, BANDIDO);
  await acercarse(ctx, BANDIDO, { objetivo: 1.6, tramos: 14 });
  const caido = await herirHasta(ctx, BANDIDO, 0, { sim: 90 });
  if (caido?.jugadorMuerto) ctx.sinMedir("el bandido mató al jugador antes de caer: sin paz no hay caso normal");
  ctx.expect("PREMISA: el jugador mata al bandido (sin pelea de fondo al hablar)", Boolean(caido?.muerto), JSON.stringify(caido));
  if (!caido?.muerto) return;

  // ── 1 · CONTROL: esperar al lado abre el panel, como siempre ─────────────
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  const saludo = await ctx.waitFor("el tabernero contesta al saludo y el panel se abre", () => (window.__nefan.dialogue().visible ? window.__nefan.dialogue() : null), 60_000);
  ctx.log(`saludo: ${JSON.stringify(saludo.text).slice(0, 100)}`);

  const FRASE_QUIETO = `${MARCA} me quedo aqui`;
  await textoLibre(ctx, FRASE_QUIETO);
  const retenida1 = await esperarRetenida(ctx, base);
  ctx.expect("el motor falso retiene la réplica (la marca llegó)", retenida1);
  if (!retenida1) return;
  await soltar(base);
  const control = await ctx.absorbe("si el panel no se abre, lo afirma el `expect` CONTROL de abajo", () =>
    ctx.waitFor(
      "CONTROL: quieto al lado, la réplica abre el panel",
      (f) => {
        const d = window.__nefan.dialogue();
        return d.visible && (d.text ?? "").includes(f) ? { texto: d.text, dialogo: window.__nefan.puedeAtacar().dialogo } : null;
      },
      30_000,
      FRASE_QUIETO,
    ),
  );
  ctx.expect("CONTROL: esperando al lado del hablante, su réplica abre el panel como hoy", Boolean(control), JSON.stringify(control));
  await ctx.shot("control-panel-abierto");
  if (!control) return;

  // ── 2 · LA RÉPLICA TARDÍA: el jugador se va antes de que llegue ──────────
  const FRASE_LEJOS = `${MARCA} ahora vuelvo`;
  await textoLibre(ctx, FRASE_LEJOS);
  const retenida2 = await esperarRetenida(ctx, base);
  ctx.expect("el motor falso retiene la segunda réplica", retenida2);
  if (!retenida2) return;
  // Lejos del tabernero, hacia el oeste del tile (campo abierto, sin salir de
  // él: así el motivo es la distancia y no el cambio de tile).
  const tab = await ctx.page.evaluate((id) => window.__nefan.npcs().find((n) => n.id === id)?.pos ?? null, TABERNERO);
  await ctx.nefan("setPlayerPos", tab.x - LEJOS_M, tab.z + 3);
  await frames(ctx, 20);
  const lejos = await ctx.page.evaluate((id) => {
    const n = window.__nefan.npcs().find((x) => x.id === id);
    const p = window.__nefan.state().pos;
    return { d: Math.hypot(n.pos.x - p.x, n.pos.z - p.z), tile: window.__nefan.currentTile };
  }, TABERNERO);
  ctx.log(`el jugador está a ${lejos.d.toFixed(1)} m del tabernero (tile ${lejos.tile})`);
  ctx.expect("PREMISA: el jugador está a más de 18 m del tabernero antes de que llegue la réplica", lejos.d > 18, JSON.stringify(lejos));
  ctx.expect(
    "PREMISA: la frase todavía no está en el registro antes de soltar la réplica",
    !(await lineasDelRegistro(ctx)).some((t) => t.includes(FRASE_LEJOS)),
  );
  await soltar(base);
  // El registro PREPENDE (la línea nueva va arriba) y tiene tope: se busca la
  // frase, que es única, y no «las líneas a partir de la N».
  const linea = await ctx.absorbe("si la línea no llega al registro, lo afirman los tres `expect` de abajo", () =>
    ctx.waitFor(
      "la réplica tardía llega al REGISTRO",
      (frase) =>
        [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? "").find((t) => t.includes(frase)) ??
        null,
      30_000,
      FRASE_LEJOS,
    ),
  );
  await frames(ctx, 10);
  const trasLlegar = await ctx.page.evaluate(() => ({
    panel: window.__nefan.dialogue().visible,
    dialogo: window.__nefan.puedeAtacar().dialogo,
  }));
  ctx.log(`línea: ${JSON.stringify(linea)} · tras llegar: ${JSON.stringify(trasLlegar)}`);
  ctx.expect("la réplica tardía NO abre el panel modal", trasLlegar.panel === false, JSON.stringify(trasLlegar));
  ctx.expect("la réplica tardía NO bloquea el ataque (puedeAtacar().dialogo === false)", trasLlegar.dialogo === false, JSON.stringify(trasLlegar));
  ctx.expect(
    "la réplica no se pierde: el registro trae la línea del hablante con su texto y la pista de volver a hablarle",
    typeof linea === "string" && linea.includes("💬") && linea.includes("(vuelve a hablarle con E)"),
    JSON.stringify(linea),
  );
  await ctx.shot("replica-tardia-en-el-registro");

  // ── 3 · SE PUSO A PELEAR: atacar mientras el motor piensa ───────────────
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  const otraVez = await ctx.absorbe("si el panel no se abre, lo afirma el `expect` de abajo", () =>
    ctx.waitFor("el tabernero vuelve a contestar al saludo (panel)", () => (window.__nefan.dialogue().visible ? true : null), 60_000),
  );
  ctx.expect("de vuelta a su lado, saludarle abre el panel (sin haber atacado)", otraVez === true);
  if (otraVez !== true) return;
  const FRASE_PELEA = `${MARCA} espera que me defiendo`;
  await textoLibre(ctx, FRASE_PELEA);
  const retenida3 = await esperarRetenida(ctx, base);
  ctx.expect("el motor falso retiene la tercera réplica", retenida3);
  if (!retenida3) return;
  // Un golpe al aire con el driver de bench (el mismo camino que `herirHasta`).
  // Si no llegara a empezar, la réplica abriría el panel y el bloque saldría
  // ROJO, no verde: no hace falta sondear el ataque para confiar en el aserto.
  await ctx.nefan("inputDriver.selectAttack", "quick");
  await ctx.nefan("inputDriver.queueAttack");
  await frames(ctx, 20);
  await soltar(base);
  const lineaPelea = await ctx.absorbe("si la línea no llega al registro, lo afirman los `expect` de abajo", () =>
    ctx.waitFor(
      "la réplica de quien se puso a pelear llega al REGISTRO",
      (frase) =>
        [...(document.getElementById("combat-log")?.children ?? [])].map((c) => c.textContent ?? "").find((t) => t.includes(frase)) ??
        null,
      30_000,
      FRASE_PELEA,
    ),
  );
  await frames(ctx, 10);
  const trasPelear = await ctx.page.evaluate(() => ({
    panel: window.__nefan.dialogue().visible,
    dialogo: window.__nefan.puedeAtacar().dialogo,
  }));
  ctx.log(`línea (pelea): ${JSON.stringify(lineaPelea)} · tras llegar: ${JSON.stringify(trasPelear)}`);
  ctx.expect("haber ATACADO mientras el motor pensaba: la réplica NO abre el panel", trasPelear.panel === false, JSON.stringify(trasPelear));
  ctx.expect(
    "…va al registro con la pista de volver cuando acabe la pelea",
    typeof lineaPelea === "string" && lineaPelea.includes("(vuelve a hablarle cuando acabe la pelea)"),
    JSON.stringify(lineaPelea),
  );
  await ctx.shot("replica-tras-atacar-en-el-registro");
}
