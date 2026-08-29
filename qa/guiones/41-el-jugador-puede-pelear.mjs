/** El jugador PELEA: un enemigo del motor narrativo pierde vida en una partida
 *  real, desde el arranque.
 *
 *  Es el criterio de la tanda #323, y hasta hoy no había forma de escribirlo.
 *  Este juego tiene una fórmula de calidad, una matriz táctica 5×7, cinco
 *  tipos de ataque, tres armas y una IA por personalidad… y en seis meses
 *  NADIE HIRIÓ NUNCA A NADA: rastreados los `runs/`, los saves y 225 capturas,
 *  el único rastro de combate es un bandido de julio que le pegó once veces al
 *  jugador y se quedó quieto en `hp:200`. Cero `enemy_damaged`. La razón era
 *  que el motor no podía poner nada hostil delante: la única vía a
 *  `GameStore.enemies` filtraba por un `type:"enemy"` que ninguna vía de
 *  producción puede emitir, y `formatDToWorld` nunca emitía el bloque
 *  `combat` que la vía VIVA (world scene → cliente → `add_combatants` →
 *  `sim.addCombatant`) necesita.
 *
 *  LO QUE ESTE GUION NO HACE, y es su razón de ser: no se fabrica la entidad.
 *  Ese es el defecto exacto del test que esta tanda borró
 *  (`state-projection.test.ts`), que construía a mano la entrada que la
 *  producción no puede producir y por eso pasaba siempre. Aquí la entidad
 *  hostil la pone EL MOTOR (el falso, cero créditos) por sus dos vías, y con
 *  el mismo contrato que el motor de verdad — `role:"hostile"` y nada más: ni
 *  bloque `combat`, ni vida, ni `entity_kind` inventado. Los números los
 *  deriva el core.
 *
 *  Dos actos, con afirmaciones independientes:
 *
 *   1. LA ESCENA INICIAL. El tile de bootstrap trae un `role:"hostile"`. Se
 *      comprueba que llega con su combate derivado, que tiene barra de vida, y
 *      que tras atacarlo el NÚMERO de su barra BAJA y el `#combat-log` trae su
 *      línea de daño. Eso es el `enemy_damaged` visto por quien juega.
 *   2. EL SPAWN EN RUNTIME. Hablando con el tabernero, el motor manda un
 *      secuaz con una consequence `spawn_entity`. Barra nueva y segundo
 *      descenso. Cierra de paso el «`spawn_entity` no lo ejerce nadie» que se
 *      midió al abrir la tanda (`grep spawn_entity qa/guiones/*.mjs` → 0).
 *
 *  Sin píxeles y sin esperas de reloj: la vida se lee del HUD (`#hp-text-<id>`,
 *  lo que el jugador tiene delante), la posición del estado del juego, y las
 *  condiciones de parada son cambios de ESTADO — los `maxMs` son cortafuegos.
 *
 *  EN NEGATIVO: con el código anterior a la tanda el bloque 1 se pone rojo en
 *  su primer aserto (el hostil llega sin `combat`, así que no hay barra que
 *  esperar); quitando el alta en el sim de `materializeSpawn` se pone rojo el
 *  bloque 2 sin tocar el 1. Las dos salidas están en el implementacion.md de
 *  la tanda 2026-08-29-que-el-jugador-pueda-pelear.
 */
import { nuevaPartida, comenzar } from "../lib/sesion.mjs";

/** Precondición DECLARADA (la ejecuta qa/run.mjs antes de lanzar el guion):
 *   · `saves`   — la partida tiene que arrancar en el tile de bootstrap, que
 *                 es el que trae al bandido; reanudar la de otro guion la
 *                 dejaría en cualquier sitio.
 *   · `fake-ai` — el motor falso lleva estado de proceso, y `fakeDialogueTurn`
 *                 es lo que hace determinista que el secuaz llegue en el
 *                 segundo turno de diálogo. Heredarlo caliente movería el
 *                 spawn de acto.
 *
 *  NO se declara `sinMotor`: este guion arranca una partida de verdad y le
 *  pide el tile al motor. Va contra el fake del preset `e2e-sin-creditos`, así
 *  que el guardarraíl lo deja pasar leyendo el `fake:true` de las dos vías. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** El hostil del tile de bootstrap y el que manda el motor a mitad de charla. */
const BANDIDO = "bandido_1";
/** Alcance útil del golpe rápido: distancia óptima 1,5 m + tolerancia 1,0.
 *  Se ataca desde dentro, no desde el filo: el filo es donde el factor de
 *  distancia vale 0 y un rojo ahí no distinguiría "no llegó" de "no funciona". */
const DISTANCIA_DE_GOLPE = 1.6;

/** La vida que el HUD enseña de un enemigo: el número del `#hp-text-<id>`, que
 *  es literalmente lo que el jugador lee. `null` si no hay barra. */
const vidaEnElHud = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const el = document.getElementById(`hp-text-${eid}`);
    if (!el) return null;
    const n = Number(el.textContent);
    return Number.isFinite(n) ? n : null;
  }, id);

/** El enemigo tal y como lo tiene el cliente (posición viva + vida del sim), y
 *  su distancia al jugador. Del estado del juego, nunca de píxeles. */
const medir = (ctx, id) =>
  ctx.page.evaluate((eid) => {
    const e = window.__nefan.enemies().find((x) => x.id === eid);
    if (!e) return null;
    const p = window.__nefan.state().pos;
    return {
      enemigo: { x: e.pos.x, z: e.pos.z },
      jugador: { x: p.x, z: p.z },
      d: Math.hypot(e.pos.x - p.x, e.pos.z - p.z),
      hp: e.hp,
      alive: e.alive,
    };
  }, id);

/** Espera a que el enemigo aparezca en el cliente (llega con la escena o con
 *  el effect del spawn) y devuelve su ficha. */
const esperarEnemigo = (ctx, id, maxMs = 60_000) =>
  ctx.waitFor(
    `el enemigo "${id}" existe en el cliente`,
    (eid) => window.__nefan.enemies().find((x) => x.id === eid) ?? null,
    maxMs,
    id,
  );

/** Encara al enemigo y camina hasta ponerse a distancia de golpe.
 *
 *  Por el camino del jugador: yaw + tecla de avance, nunca `setPlayerPos` —
 *  teletransportarse sería fabricar el escenario que el guion viene a medir.
 *  En tramos porque el enemigo también se mueve (nos está persiguiendo, que es
 *  medio punto de que exista). */
async function acercarse(ctx, id, objetivo = DISTANCIA_DE_GOLPE, tramos = 14) {
  let m = await medir(ctx, id);
  for (let i = 0; i < tramos && m && m.d > objetivo; i++) {
    await ctx.nefan("setYaw", Math.atan2(m.enemigo.x - m.jugador.x, m.enemigo.z - m.jugador.z));
    await ctx
      .holdUntil(
        "up",
        `el jugador se pone a ${objetivo} m de ${id} (tramo ${i + 1}, ahora ${m.d.toFixed(1)} m)`,
        (a) => {
          const e = window.__nefan.enemies().find((x) => x.id === a.id);
          if (!e) return null;
          const p = window.__nefan.state().pos;
          return Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= a.objetivo ? true : null;
        },
        4_000,
        { id, objetivo },
      )
      .catch(() => null);
    m = await medir(ctx, id);
  }
  return m;
}

/** Pega hasta que la vida DEL HUD baje del valor de partida.
 *
 *  Se re-encola el ataque en cada sondeo y se re-encara al enemigo: el golpe
 *  tiene wind-up y el enemigo se mueve, así que un solo click puede fallar sin
 *  que eso signifique nada. La condición de parada es el DESCENSO, no un
 *  número de intentos ni un reloj. */
async function golpearHasta(ctx, id, vidaInicial, maxMs = 60_000) {
  await ctx.nefan("inputDriver.selectAttack", "quick");
  const bajo = await ctx
    .waitFor(
      `la vida de ${id} baja de ${vidaInicial} en el HUD`,
      (a) => {
        const e = window.__nefan.enemies().find((x) => x.id === a.id);
        const p = window.__nefan.state().pos;
        const drv = window.__nefan.inputDriver;
        if (e && p) {
          // Encarar y pegar: el sim resuelve el golpe contra el cono frontal.
          window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
          // Y AVANZAR mientras se pega si todavía no se llega. El alcance del
          // golpe rápido (≈2,3 m con espada corta) es más corto que el del
          // enemigo, así que quedarse quieto esperando a que entre es dejarse
          // pegar desde fuera del propio alcance: se cierra la distancia
          // atacando, que es lo que hace quien juega.
          if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > a.alcance) drv.press("up");
          else drv.release("up");
        }
        drv.queueAttack();
        const el = document.getElementById(`hp-text-${a.id}`);
        if (!el) return null;
        const n = Number(el.textContent);
        if (Number.isFinite(n) && n < a.v0) return { hud: n };
        // Si el jugador MUERE, deja de haber quien pegue: se corta aquí para
        // que el rojo diga «te mataron» en vez de agotar el cortafuegos en
        // silencio, que es el rojo del que nadie saca nada.
        const vidaJugador = Number(document.getElementById("player-hp-text")?.textContent ?? 0);
        if (vidaJugador <= 0) {
          const d = e && p ? Math.hypot(e.pos.x - p.x, e.pos.z - p.z) : -1;
          return { hud: n, jugadorMuerto: true, d, jug: { x: p?.x, z: p?.z }, ene: e ? { x: e.pos.x, z: e.pos.z } : null };
        }
        return null;
      },
      maxMs,
      { id, v0: vidaInicial, alcance: DISTANCIA_DE_GOLPE },
    )
    .catch(() => null);
  await ctx.nefan("inputDriver.release", "up");
  if (bajo?.jugadorMuerto) ctx.log(`☠ el jugador murió peleando con ${id} — a ${bajo.d?.toFixed(2)} m · jugador ${JSON.stringify(bajo.jug)} · enemigo ${JSON.stringify(bajo.ene)}`);
  return bajo?.jugadorMuerto ? null : bajo;
}

/** Las líneas del registro de combate, tal cual se le enseñan al jugador. */
const lineasDelLog = (ctx) =>
  ctx.page.$$eval("#combat-log div", (ds) => ds.map((d) => d.textContent ?? ""));

/** Remata al enemigo. No es adorno: mientras siga vivo PEGA, y el acto 2
 *  empieza con un paseo hasta el tabernero durante el cual el bandido va
 *  detrás. Sin rematarlo, el guion se juega a los dados que el jugador llegue
 *  vivo — y un guion intermitente es peor que uno que no existe. De paso
 *  ejerce la otra mitad del combate (`enemy_died`), que tampoco había ocurrido
 *  nunca en este repositorio. */
async function rematar(ctx, id, maxMs = 90_000) {
  await ctx.nefan("inputDriver.selectAttack", "quick");
  const muerto = await ctx
    .waitFor(
      `${id} cae`,
      (a) => {
        const e = window.__nefan.enemies().find((x) => x.id === a.id);
        const p = window.__nefan.state().pos;
        const drv = window.__nefan.inputDriver;
        if (!e) return null;
        if (!e.alive || (e.hp ?? 1) <= 0) return { hp: e.hp };
        if (Number(document.getElementById("player-hp-text")?.textContent ?? 0) <= 0) {
          return { hp: e.hp, jugadorMuerto: true };
        }
        window.__nefan.setYaw(Math.atan2(e.pos.x - p.x, e.pos.z - p.z));
        if (Math.hypot(e.pos.x - p.x, e.pos.z - p.z) > a.alcance) drv.press("up");
        else drv.release("up");
        drv.queueAttack();
        return null;
      },
      maxMs,
      { id, alcance: DISTANCIA_DE_GOLPE },
    )
    .catch(() => null);
  await ctx.nefan("inputDriver.release", "up");
  if (muerto?.jugadorMuerto) {
    ctx.log(`☠ el jugador murió rematando a ${id}`);
    return null;
  }
  return muerto;
}

/** La vida del jugador tal y como la enseña su barra. */
const vidaDelJugador = (ctx) =>
  ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? 0));

/** ¿Sigue vivo el jugador? Si muere a mitad, todo lo de después se cae por
 *  otra razón y hay que decirlo con su nombre en vez de esperar a un timeout
 *  mudo. */
const jugadorVivo = (ctx) =>
  ctx.page.evaluate(() => {
    const t = document.getElementById("player-hp-text");
    return Number(t?.textContent ?? 0) > 0;
  });

/** Un acto entero: enemigo en escena → acercarse → pegar → afirmar.
 *
 *  `cunaEsPrecondicion` distingue quién ELIGIÓ la celda. En la escena inicial
 *  la elige el motor (aquí, el falso) y por tanto es una precondición del
 *  banco que puedo afirmar. En el spawn en runtime la elige el código de
 *  PRODUCCIÓN (`resolvePositionHint`: jugador + forward × 5) y hoy no consulta
 *  la colisión, así que exigirlo sería afirmar algo que nadie garantiza y
 *  poner el guion rojo por un defecto que no es su sujeto. Se OBSERVA y se
 *  dice, que es lo que hace un hallazgo abierto. */
async function pelearContra(
  ctx,
  id,
  etiqueta,
  { cunaEsPrecondicion = true, acercarseAndando = true } = {},
) {
  const enemigo = await esperarEnemigo(ctx, id);
  ctx.log(`${etiqueta}: ${JSON.stringify(enemigo)}`);

  const vida0 = await vidaEnElHud(ctx, id);
  ctx.expect(
    `${etiqueta}: el enemigo tiene barra de vida en el HUD`,
    typeof vida0 === "number" && vida0 > 0,
    `#hp-text-${id} = ${JSON.stringify(vida0)}`,
  );

  // Precondición que costó dos investigaciones en el guion 15: un personaje
  // que nace DENTRO de un sólido puede salir pero no entrar, así que se
  // despega unos centímetros y se queda encajonado. Si pasara aquí, el rojo
  // de abajo diría "no se puede pelear" cuando lo que pasa es que el bench
  // colocó mal al enemigo.
  const cuna = await ctx.page.evaluate(
    ([x, z]) => window.__nefan.probeCollide(x, z),
    [enemigo.pos.x, enemigo.pos.z],
  );
  const dondeNace = `probeCollide(${enemigo.pos.x.toFixed(2)}, ${enemigo.pos.z.toFixed(2)}) = ${cuna}`;
  if (cunaEsPrecondicion) {
    ctx.expect(
      `${etiqueta}: el enemigo nace en suelo libre (empotrado no podría pelear, y el rojo mentiría)`,
      cuna === false,
      dondeNace,
    );
  } else if (cuna) {
    // HALLAZGO ABIERTO, no aserto: `resolvePositionHint` coloca el spawn a
    // jugador + forward × 5 sin preguntar por la colisión, y el bridge le pasa
    // un forward FIJO (0,0,−1) en vez de hacia dónde mira el jugador. Con las
    // dos cosas, un `near_player` puede materializar al enemigo dentro de un
    // muro. Que la pelea de abajo funcione igual no lo absuelve: funciona
    // porque la IA de combate no consulta `blocksMove` y lo saca atravesando
    // el sólido. Las dos son de OTRA tanda; aquí se dejan medidas.
    ctx.log(`⚠ ${etiqueta}: el spawn nació DENTRO de un sólido — ${dondeNace}`);
  }

  // Quién cierra la distancia. En la escena inicial la cierra EL JUGADOR
  // andando, y eso se afirma: es lo que demuestra que llega por su propio pie
  // y no teletransportado. En el spawn en runtime la cierra el ENEMIGO —para
  // eso tiene `preferred_distance` 1,5 m— y el jugador pega mientras llega:
  // andarle encima añadía un tramo de segundos comiendo golpes sin devolver
  // ninguno, y el guion se decidía por quién llegaba antes al suelo.
  if (acercarseAndando) {
    const cerca = await acercarse(ctx, id);
    ctx.log(`${etiqueta}: a ${cerca?.d?.toFixed(2)} m antes de atacar (vida HUD ${vida0})`);
    ctx.expect(
      `${etiqueta}: el jugador LLEGA a distancia de golpe andando (sin teletransportarse)`,
      Boolean(cerca) && cerca.d <= DISTANCIA_DE_GOLPE + 1.0,
      `distancia final ${cerca?.d?.toFixed(2)} m`,
    );
    await ctx.shot(`${etiqueta}-antes-del-golpe`);
  } else {
    // Sin captura ni medidas antes de pegar, A PROPÓSITO: el enemigo ya está
    // encima y golpeando desde que se materializa, así que cada segundo que
    // el guion pasa midiendo es un segundo en el que el jugador encaja golpes
    // sin devolver ninguno. Con la captura aquí, el jugador llegaba MUERTO al
    // primer ataque y el rojo decía "no le quitó vida" cuando lo que pasaba
    // era que el guion se quedó mirando. La captura va después.
    const m = await medir(ctx, id);
    ctx.log(`${etiqueta}: el enemigo viene solo — a ${m?.d?.toFixed(2)} m al empezar a pegar`);
  }

  const bajo = await golpearHasta(ctx, id, vida0);
  const vida1 = await vidaEnElHud(ctx, id);
  ctx.log(`${etiqueta}: vida ${vida0} → ${vida1} (HUD)`);

  // EL CRITERIO DE LA TANDA. Todo lo demás de este guion existe para que este
  // aserto pueda ponerse rojo por la razón correcta.
  ctx.expect(
    `${etiqueta}: UN ATAQUE QUE IMPACTA LE QUITA VIDA — el número del HUD baja`,
    Boolean(bajo) && typeof vida1 === "number" && vida1 < vida0,
    `${vida0} → ${vida1}`,
  );

  ctx.log(`${etiqueta}: al jugador le quedan ${await vidaDelJugador(ctx)} PV`);
  const log = await lineasDelLog(ctx);
  const linea = log.find((l) => l.startsWith(`${id} hit:`));
  ctx.expect(
    `${etiqueta}: y el registro de combate se lo DICE al jugador`,
    Boolean(linea),
    `líneas: ${JSON.stringify(log.slice(0, 4))}`,
  );
  if (linea) ctx.log(`${etiqueta}: «${linea}»`);
  await ctx.shot(`${etiqueta}-tras-el-golpe`);
  return { vida0, vida1, linea };
}

/** Estado de la PUERTA REAL del ataque: pointer lock + diálogo cerrado, leído
 *  de la misma fuente que `keyboard-input-provider.ts`. El driver de bench
 *  (`?input=scripted`) NO pasa por ahí, así que sin esto el guion puede pegar
 *  y ver daño mientras el jugador de verdad aporrea el ratón sin hacer nada. */
const puertaDelAtaque = (ctx) => ctx.nefan("puedeAtacar");

/** Captura el ratón como lo captura el jugador: un click en el mundo. */
async function capturarElRaton(ctx) {
  await ctx.page.click("#fps-canvas, canvas", { position: { x: 200, y: 200 } }).catch(() => null);
  return ctx
    .waitFor("el ratón queda capturado (click en el mundo)",
      () => (window.__nefan.puedeAtacar().raton ? true : null), 10_000)
    .catch(() => false);
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  await comenzar(ctx);

  // ── ACTO 1 · el hostil de la ESCENA INICIAL ────────────────────────────
  // El motor lo declaró en el tile de bootstrap con `role:"hostile"`. Antes
  // de pegarle se comprueba lo que el cliente recibió, que es donde estaba el
  // corte: la world scene tiene que traerle el bloque `combat` derivado.
  const enEscena = await ctx.waitFor(
    "el motor declara un NPC hostil en la escena de entrada",
    () => (window.__nefan.scene?.npcs ?? []).find((n) => n.role === "hostile") ?? null,
    60_000,
  );
  ctx.log(`hostil de la escena: ${JSON.stringify(enEscena)}`);
  ctx.expect(
    "el hostil llega al cliente con su bloque `combat` derivado por el core",
    Boolean(enEscena.combat) && typeof enEscena.combat.health === "number" && enEscena.combat.health > 0,
    JSON.stringify(enEscena.combat),
  );
  ctx.expect(
    "…y con la personalidad que la IA de combate necesita para venir a por él",
    Number(enEscena.combat?.personality?.aggression) > 0 &&
      Array.isArray(enEscena.combat?.personality?.preferred_attacks) &&
      enEscena.combat.personality.preferred_attacks.length > 0,
    JSON.stringify(enEscena.combat?.personality),
  );
  ctx.expect(
    "…y sigue siendo un NPC con nombre y descripción (de ahí sale su aspecto)",
    typeof enEscena.description === "string" && enEscena.description.length > 0 &&
      enEscena.description !== enEscena.name,
    `${JSON.stringify(enEscena.name)} / ${JSON.stringify(enEscena.description)}`,
  );

  const acto1 = await pelearContra(ctx, BANDIDO, "escena-inicial");

  // Y hasta el final: el enemigo no solo se hiere, se MATA.
  const caido = await rematar(ctx, BANDIDO);
  ctx.expect(
    "el jugador puede LLEVARSE POR DELANTE al enemigo, no solo arañarlo",
    Boolean(caido),
    `vida final ${JSON.stringify(caido)}`,
  );
  const logMuerte = await lineasDelLog(ctx);
  ctx.expect(
    "…y el juego lo anuncia",
    logMuerte.some((l) => l.includes(`${BANDIDO} killed`)),
    JSON.stringify(logMuerte.slice(0, 4)),
  );
  await ctx.shot("escena-inicial-enemigo-abatido");

  ctx.expect(
    "el jugador llega vivo al segundo acto (si no, lo de abajo se caería por otra razón)",
    await jugadorVivo(ctx),
    "el bandido mató al jugador durante el primer acto",
  );

  // ── ACTO 1 bis · TRAS HABLAR, ¿se puede devolver el golpe? ─────────────
  // La puerta real del ataque es `pointer lock && !diálogo`
  // (`keyboard-input-provider.ts`), y el panel de diálogo SUELTA el pointer
  // lock al abrirse. Hasta #323 no lo devolvía nadie: quien hablaba con un NPC
  // se quedaba pegando a un enemigo a 1,5 m SIN HACER DAÑO, y nada se lo
  // decía (QA lo midió: 50 s a cero de daño y muerto).
  //
  // Esto NO se puede medir con `inputDriver.queueAttack()`, que se salta esa
  // puerta: el guion vería daño donde el jugador no lo ve. Se mide la puerta.
  const capturado = await capturarElRaton(ctx);
  ctx.expect(
    "el jugador puede capturar el ratón haciendo click en el mundo (precondición: sin esto lo de abajo no distingue nada)",
    capturado === true,
    JSON.stringify(await puertaDelAtaque(ctx)),
  );
  if (capturado) {
    const antes = await puertaDelAtaque(ctx);
    ctx.expect("con el ratón capturado y sin diálogo, el jugador PUEDE atacar", antes.ok === true, JSON.stringify(antes));
  }

  // ── ACTO 2 · el hostil que llega por SPAWN EN RUNTIME ──────────────────
  // Sin recargar la escena: el motor lo manda como consequence a mitad de una
  // conversación, que es la decisión de diseño que CLAUDE.md declara y que
  // hasta hoy no ejercía ningún guion.
  const idsAntes = await ctx.page.evaluate(() => window.__nefan.enemies().map((e) => e.id));

  const barkeep = await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    () => window.__nefan.npcs().find((n) => n.id === "barkeep") ?? null,
    30_000,
  );
  // Acercarse a hablar por el camino del jugador (E, no una llamada interna).
  await ctx.nefan("setYaw", Math.atan2(barkeep.pos.x, barkeep.pos.z));
  for (let i = 0; i < 12; i++) {
    const cerca = await ctx.page.evaluate((id) => {
      const n = window.__nefan.npcs().find((x) => x.id === id);
      if (!n) return null;
      const p = window.__nefan.state().pos;
      return Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
    }, "barkeep");
    if (cerca !== null && cerca <= 2.2) break;
    const n = await ctx.page.evaluate((id) => {
      const e = window.__nefan.npcs().find((x) => x.id === id);
      const p = window.__nefan.state().pos;
      return e ? { dx: e.pos.x - p.x, dz: e.pos.z - p.z } : null;
    }, "barkeep");
    if (!n) break;
    await ctx.nefan("setYaw", Math.atan2(n.dx, n.dz));
    await ctx
      .holdUntil(
        "up",
        `el jugador se acerca al tabernero (tramo ${i + 1})`,
        (id) => {
          const e = window.__nefan.npcs().find((x) => x.id === id);
          if (!e) return null;
          const p = window.__nefan.state().pos;
          return Math.hypot(e.pos.x - p.x, e.pos.z - p.z) <= 2.2 ? true : null;
        },
        4_000,
        "barkeep",
      )
      .catch(() => null);
  }

  // Turno 1 de diálogo: hablar. Turno 2: contestar — y es ahí donde el motor
  // manda al secuaz.
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);

  const nuevo = await ctx
    .waitFor(
      "el motor MATERIALIZA un enemigo nuevo en la escena viva (spawn_entity)",
      (previos) => window.__nefan.enemies().find((e) => !previos.includes(e.id)) ?? null,
      90_000,
      idsAntes,
    )
    .catch(() => null);

  ctx.expect(
    "una consequence `spawn_entity` hostil se materializa como ENEMIGO, sin recargar la escena",
    Boolean(nuevo),
    `enemigos antes: ${JSON.stringify(idsAntes)}`,
  );

  if (nuevo) {
    ctx.log(`spawn en runtime: ${JSON.stringify(nuevo)}`);
    // Cerrar la conversación ANTES de pelear, como haría quien juega: con el
    // panel abierto el cliente SUPRIME el ataque (`main.ts`: «attackRequested
    // = dialoguePanel.isVisible ? false : …»), así que el secuaz pegaba y el
    // jugador no podía devolver un solo golpe. Sin este cierre, el guion
    // medía "no le quitó vida" cuando lo que pasaba es que no dejaba atacar.
    await ctx.nefan("advanceDialogue");
    const cerrado = await ctx
      .waitFor("la conversación se cierra y el jugador vuelve a poder pelear",
        () => (window.__nefan.dialogueVisible ? null : true), 15_000)
      .catch(() => false);
    ctx.expect(
      "con el enemigo encima, el jugador puede salir del diálogo",
      cerrado === true,
      "el panel de diálogo sigue abierto",
    );
    // Y AQUÍ está el aserto que antes era verde por el driver: cerrar el panel
    // no basta: hay que poder ATACAR, y eso exige que la conversación devuelva
    // el ratón que se llevó al abrirse.
    if (capturado) {
      const tras = await ctx
        .waitFor("la conversación DEVUELVE el ratón al cerrarse",
          () => (window.__nefan.puedeAtacar().ok ? window.__nefan.puedeAtacar() : null), 10_000)
        .catch(() => null);
      ctx.expect(
        "tras hablar, el jugador puede DEVOLVER EL GOLPE por la puerta real (ratón capturado, sin diálogo)",
        tras?.ok === true,
        JSON.stringify(tras ?? (await puertaDelAtaque(ctx))),
      );
    }
    const acto2 = await pelearContra(ctx, nuevo.id, "spawn-en-runtime", {
      cunaEsPrecondicion: false,
      acercarseAndando: false,
    });
    ctx.expect(
      "los dos enemigos —el de la escena y el del spawn— han perdido vida en la MISMA partida",
      acto1.vida1 < acto1.vida0 && acto2.vida1 < acto2.vida0,
      `${BANDIDO}: ${acto1.vida0}→${acto1.vida1} · ${nuevo.id}: ${acto2.vida0}→${acto2.vida1}`,
    );
  }
}
