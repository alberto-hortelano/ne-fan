/** LA FRONTERA MOVIDA POR LA PR 5 de #241 (#489), medida ANDANDO: lo que el
 *  motor pone a mitad de partida frena al jugador, con la huella que deriva
 *  core, y sigue frenándolo después de reanudar.
 *
 *  QUÉ MIDE ESTE Y NO LOS DEMÁS. El 81 sondea con `probeCollide` que el centro
 *  y los cuatro bordes de la forja y del cofre bloquean; el 02, el 45 y el 06
 *  miden la solidez del PLAN (grid, vanos, puente) sobre fixtures. Ninguno
 *  comprueba DÓNDE ACABA la caja ni camina contra un spawn del MOTOR: una caja
 *  de 8×8 m también saldría verde en el 81, y el jugador se pararía a cuatro
 *  metros de una forja que ve a dos. Aquí se miden las dos cosas, y son
 *  distintas:
 *
 *   · **la pared, con sondas**: desde el centro hacia los cuatro ejes, a qué
 *     distancia deja de bloquear. La más corta tiene que caer en `media huella
 *     + radio` con la tolerancia del barrido (5 cm), y la huella es la que
 *     deriva `huellaEnMetros` de `nefan-core/dist` — la MISMA función que llenó
 *     el `sizeXZ` del effect (`⊘` con su motivo si no hay `dist`). Determinista:
 *     no depende de que el jugador pueda llegar.
 *   · **el motor de movimiento, andando**: el jugador empuja contra la forja y
 *     no acaba DENTRO de su caja, que es exactamente lo que #489 rompía. Que
 *     ANDE es un aserto propio y no una precondición escondida: sin él, «no
 *     entra» sale verde con el jugador parado.
 *
 *  Y mide las tres cosas que la PR prometió NO cambiar:
 *   · el edificio del TILE sigue frenando por el GRID de su plan (su caja la
 *     apaga `svgApplied`, igual que antes de esta PR; que esa caja se aplicara
 *     ADEMÁS del grid este bloque no lo vería, y ningún otro guion tampoco —ver
 *     el negativo de abajo—: lo ve `qa/equivalencia-de-cajas.mjs`);
 *   · ningún objeto del tile pasa a bloquear por su caja: al arrancar todos son
 *     de SU TILE y ese tile tiene el plan instalado, que son las dos mitades de
 *     la condición de la que depende (bloque 0);
 *   · un NPC no es una caja — ni el del tile ni el que pone el motor: el tipo
 *     `HuellaDelSpawn` no le deja llevar huella, y aquí se ve por donde se ve
 *     jugando (se le puede pisar el sitio, y no está en la lista de objetos).
 *
 *  SUS SONDAS PREGUNTAN POR `probePoint`, NO POR `probeCollide` (#644), y por
 *  eso este guion dejó de medir por azar. `probeCollide` es `collidesAt`, una
 *  consulta de MOVIMIENTO: las tres fuentes de solidez son «salir sí, entrar
 *  no», así que contestan que NO por donde el jugador ya está. Como aquí el
 *  jugador ANDA —es medio guion—, el veredicto dependía de dónde hubiera
 *  quedado: de las 121 muestras de la línea entre el cofre y la forja salieron
 *  **46 libres, 38 libres y 0 libres** en tres corridas del MISMO código, y dos
 *  de esas corridas estaban en VERDE. `probePoint` es `ocupadoEn`, la misma
 *  colisión preguntada SIN ORIGEN, así que dos corridas dan el mismo número.
 *  Lo que sigue midiéndose andando (el empujón, la parada) no ha cambiado: eso
 *  sí es movimiento.
 *
 *  LO QUE NO SE AFIRMA, y se DICE con su medida: que el jugador llegue a tocar
 *  el cofre. Los tres spawns de un turno caen entre los volúmenes del plan, así
 *  que a veces no queda una cara libre por la que encararlo — exigir contacto
 *  ahí sería afirmar la suerte del spawn, no la caja. El guion registra el
 *  hueco entre sus caras y cuántas sondas quedan libres en la línea que las
 *  une. Ese hueco era el dato de §9.1 de la PR 5 —la separación del turno no
 *  miraba el TAMAÑO de lo que separaba— y desde #524 lo mira: el reparto deja
 *  entre caras el cuerpo del jugador y un palmo, y quien lo AFIRMA es
 *  `test/reparto-de-spawns.test.ts`; aquí sigue siendo el dato que se registra.
 *
 *  POR QUÉ TRAS REANUDAR TAMBIÉN. El tamaño de un spawn sale de lo que el motor
 *  declaró (`footprint`, en celdas) o del defecto de su clase, y la cuenta la
 *  hace core (`huellaEnMetros`) en las dos vías: la de en vivo y la del resume.
 *  Si una de las dos se pusiera a medir por su cuenta, la misma forja mediría
 *  una cosa jugando y otra al volver a la partida. El bloque 5 es lo que se
 *  enteraría. (Lo que el motor falso pone aquí no declara `footprint`, así que
 *  éste mide los DEFECTOS; el que mide lo declarado es el guion 118.)
 *
 *  PROBADO EN NEGATIVO (2026-09-07), un sabotaje por vez sobre
 *  `nefan-core/src/simulation/obstaculos-del-jugador.ts` y restaurado byte a
 *  byte después:
 *   · quitándole al salto la mitad del ORIGEN (`obj.dueno.de === "tile" &&`),
 *     con lo que vuelve a ser solo por tile: #489 tal cual. NUEVE asertos rojos
 *     entre los bloques 3 y 5 — la pared de la forja se mide en 0,00 m por los
 *     cuatro ejes, el jugador llega a 0,19 m de su centro (le sobran −2,25 al
 *     borde) y lo mismo tras reanudar.
 *   · quitándole la OTRA mitad (`plan.planAplicadoEn(...)`), con lo que la caja
 *     ciega del tile se aplica ADEMÁS de su plan: este guion sigue verde, y
 *     también el 45, el 02, el 32, el 06 y el candado del agua — MEDIDO, no
 *     supuesto. Que ese lado no lo vea ningún guion de navegador es un dato:
 *     las cajas de las fixtures caen dentro de los volúmenes que el plan ya
 *     pinta, así que aplicarlas de más no cambia por dónde se anda. Lo cazan
 *     `test/obstaculos-del-jugador.test.ts` (3 rojos) y
 *     `qa/equivalencia-de-cajas.mjs` (370 sondas de 2.160 cambian de veredicto
 *     contra la base). Dicho aquí para que nadie cuente este guion como
 *     candado de esa mitad.
 *
 *  Y EL BENCH PEGA: el hostil que el motor suelta en el turno 2 mata al jugador
 *  a mitad del paseo, y entonces lo que se mide es una carrera contra su daño y
 *  no una caja. Así que antes de andar se acaba con él —lo que hace quien juega
 *  cuando le atacan— y, si aun así muere, se reaparece por la puerta del
 *  jugador (la R, repetida hasta que el sim la aplica). Si ni con la R se
 *  levanta, el aserto «el jugador ANDA» lo dice en rojo: un cadáver no anda.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los spawns los pone el motor falso
 *  en su turno 3. `aisla` deja saves y motor falso vírgenes (el guion depende
 *  del turno del falso, como el 81).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { comenzar, nuevaPartida, reanudar } from "../lib/sesion.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";
import { elJugadorSePara, limpiaLaParada, loQueVioLaParada, paradaEnSim } from "../lib/parada.mjs";
import { esperarEnElSave } from "../lib/saves.mjs";

export const aisla = ["saves", "fake-ai"];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** Lo que el motor falso pone en su turno 3, tal cual. */
const COFRE = "Cofre de la posada";
const FORJA = "Forja de Robledo";
const NOGALA = "Nogala";
/** Radio del cuerpo del jugador (`PLAYER_RADIUS_M`, core). */
const RADIO = 0.4;
/** Cuánto puede meterse el jugador en la caja al pararse: nada, salvo el error
 *  de leer la posición entre frames. Por debajo de −0,02 está DENTRO. */
const DENTRO_M = -0.02;
/** Tolerancia de la pared MEDIDA por sondas contra la que declara core: el paso
 *  del barrido (5 cm) más un pelo. */
const PASO_DEL_BARRIDO_M = 0.06;

/** El tamaño que declara core para un spawn —de su `footprint` en celdas si el
 *  motor lo declaró, del defecto de su clase si no—, o el error si
 *  `nefan-core/dist` no está construido. Los dos argumentos son el contrato de
 *  `huellaEnMetros` desde #532: con uno solo, este guion mediría siempre el
 *  defecto y daría por bueno un carro de 3 m pintado de 1,5. */
async function huellaDeCore() {
  try {
    const { huellaEnMetros } = await import(
      path.join(RAIZ, "nefan-core", "dist", "src", "scene", "scene-normalize.js")
    );
    return (kind, footprintCeldas = null) => huellaEnMetros(kind, footprintCeldas);
  } catch (err) {
    return { error: String(err) };
  }
}

const objetos = (ctx) => ctx.page.evaluate(() => window.__nefan.objects());
const posicion = (ctx) => ctx.page.evaluate(() => ({ ...window.__nefan.state().pos }));
const vidaDelHud = (ctx) =>
  ctx.page.evaluate(() => Number(document.getElementById("player-hp-text")?.textContent ?? "NaN"));

/** Camina en línea recta hacia el centro de `obj` hasta que el jugador DEJA DE
 *  AVANZAR, y devuelve dónde se quedó. Como quien juega: yaw + tecla, nunca
 *  `setPlayerPos`.
 *
 *  La condición de parada es ESTADO, no reloj (`qa-guiones-sin-espera-por-reloj`,
 *  que puso roja la primera versión de este guion): el predicado corre en la
 *  página, se acuerda de la última posición y se cumple cuando el jugador lleva
 *  tres muestras sin moverse más de 2 cm. El cortafuegos se ABSORBE y la parada
 *  se lee después, porque una parada tardía no invalida la medida: quien afirma
 *  es el aserto de la caja.
 *
 *  Y DESDE #545 LAS MUESTRAS LAS CUENTA EL RELOJ DEL MUNDO, no el de la máquina
 *  (`qa/lib/parada.mjs`). Esto estaba escrito aquí a mano y muestreaba cada 150
 *  ms de PARED: bajo carga, entre dos sondeos puede no haber corrido ni un
 *  frame, y entonces el jugador está donde estaba **porque el mundo no se ha
 *  simulado**. Tres de esas seguidas y este guion leía una parada que no
 *  existía, a mitad de camino, y el aserto de la caja la daba por buena. Era
 *  literalmente el defecto que da título a #545, en el guion que el issue manda
 *  investigar. Ni el umbral, ni las tres muestras, ni la puerta del arranque,
 *  ni lo que se afirma después han cambiado: solo con qué reloj se cuenta. */
async function empujarContra(ctx, centro, sim = 12) {
  const p0 = await posicion(ctx);
  await ctx.nefan("setYaw", Math.atan2(centro.x - p0.x, centro.z - p0.z));
  const molde = paradaEnSim({ slot: "__qa91", arranque: 0.15, destino: centro });
  await limpiaLaParada(ctx, molde);
  let arranco = false;
  const parada = await ctx.absorbe(
    `cortafuegos del empujón hacia (${centro.x.toFixed(1)}, ${centro.z.toFixed(1)}): la parada se lee ` +
      `justo después y la AFIRMA el aserto de la caja, que es donde vive la medida`,
    () =>
      ctx.holdUntil(
        "up",
        "el jugador anda y se para contra lo que tiene delante",
        elJugadorSePara,
        { sim },
        molde,
      ),
  );
  arranco = Boolean(parada?.arranco);
  // Qué vio el molde, haya habido parada o no: cuántas muestras de MUNDO contó
  // y cuántos sondeos se saltó por no haber corrido ni un frame.
  //
  // OJO con leer `saltadas` como «cuánta carga había»: va al REVÉS (medido por
  // QA — 26 y 8 en reposo, 0 y 0 a ×40) y el motivo está escrito en
  // `qa/lib/parada.mjs`. Lo que registra es cuántas veces el muestreo se quedó
  // por debajo del paso de mundo; se apunta porque es el diagnóstico de la
  // espera, no porque mida el dial.
  const visto = await loQueVioLaParada(ctx, molde);
  ctx.log(
    `empujón hacia (${centro.x.toFixed(1)}, ${centro.z.toFixed(1)}): ${visto.muestras} muestras de mundo, ` +
      `${visto.saltadas} sondeos saltados sin frame, ${parada ? "parado" : "sin parada dentro del cortafuegos"}`,
  );
  // Si el cortafuegos expiró, el jugador puede haber andado igualmente (un
  // trayecto largo, o un roce que no le deja quedarse tres muestras quieto): lo
  // que dice si ANDUVO es la distancia recorrida, no quién resolvió la espera.
  const fin = await posicion(ctx);
  return { ...fin, arranco: arranco || Math.hypot(fin.x - p0.x, fin.z - p0.z) > 0.15 };
}

/** El aserto geométrico: el jugador se paró JUSTO FUERA del rectángulo de la
 *  caja inflado por su radio. `sobra` es lo que le sobra al eje que más
 *  penetra: negativo = está DENTRO de la caja; mayor que el margen = se paró
 *  antes de llegar (o no llegó a andar). */
function sobraDelBorde(p, obj) {
  const hx = obj.sizeXZ.x / 2 + RADIO;
  const hz = obj.sizeXZ.z / 2 + RADIO;
  return Math.max(Math.abs(p.x - obj.pos.x) - hx, Math.abs(p.z - obj.pos.z) - hz);
}

/** El bench tiene un hostil pegando desde el turno 2 y el jugador se muere
 *  mientras camina. Un cadáver no anda, así que la parada no diría nada de la
 *  caja: se reaparece por la puerta del jugador (la R, `queueRespawn`) y se
 *  sigue midiendo. Que reaparecer no meta al jugador dentro de un sólido lo
 *  candan el 32 y el 34; aquí solo hace falta que ande. */
async function revivirSiHaceFalta(ctx) {
  if ((await vidaDelHud(ctx)) > 0) return false;
  // La R es one-shot y el bucle del juego solo la aplica con el jugador ya
  // muerto PARA EL SIM (el HUD puede ir un tick por delante), así que se vuelve
  // a pulsar en cada muestra —como haría quien juega— hasta que la vida sube.
  // Espera por ESTADO: la vida del HUD, no un reloj.
  const vivo = await ctx.absorbe(
    "cortafuegos del respawn: si no revive, el guion lo declara SIN MEDIR justo debajo en vez de teñir de rojo " +
      "una parada que no llegó a medirse",
    () =>
      ctx.waitFor(
        "el jugador vuelve a la vida tras pulsar R",
        () => {
          const hp = Number(document.getElementById("player-hp-text")?.textContent ?? "0");
          if (hp > 0) return { hp };
          window.__nefan.inputDriver.queueRespawn();
          return null;
        },
        15_000,
      ),
  );
  ctx.log(
    vivo
      ? `el bench mató al jugador: reaparecido (R) con ${vivo.hp} de vida para seguir midiendo`
      : "el bench mató al jugador y la R no lo levantó: el aserto «el jugador ANDA» de abajo lo dirá en rojo",
  );
  return true;
}

/** Empuja al jugador contra `obj` y afirma que el MOTOR DE MOVIMIENTO respeta
 *  su caja: anda (precondición afirmada, no escondida) y no acaba DENTRO del
 *  rectángulo inflado por su radio — que es exactamente lo que #489 rompía, la
 *  forja se atravesaba entera.
 *
 *  DÓNDE está la pared no se mide aquí sino en `afirmaLaCaja`, con sondas: en
 *  este bench el jugador no siempre puede LLEGAR a la cara de un spawn (los
 *  tres caen entre los volúmenes del plan del tile), y exigirle contacto sería
 *  afirmar la suerte del spawn en vez de la caja. Andar y sondear miden dos cosas distintas y las dos hacen falta. */
async function chocaConLaCajaQueDice(ctx, obj, etiqueta, cuando) {
  const antes = await vidaDelHud(ctx);
  const p = await empujarContra(ctx, obj.pos);
  const sobra = sobraDelBorde(p, obj);
  const d = Math.hypot(p.x - obj.pos.x, p.z - obj.pos.z);
  const detalle =
    `parada (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) · a ${d.toFixed(2)} m del centro · le sobra ${sobra.toFixed(2)} m al borde ` +
    `· vida ${antes} → ${await vidaDelHud(ctx)}`;
  // La precondición se AFIRMA, no se esconde: si el jugador no anduvo, «no
  // entra en la caja» sería verde sin haber medido nada.
  ctx.expect(`${cuando}: el jugador ANDA hacia ${etiqueta} (si no, nada de lo de abajo mide)`, p.arranco === true, detalle);
  ctx.expect(
    `${cuando}: empujando contra ${etiqueta}, el jugador NO entra en su caja (${obj.sizeXZ.x}×${obj.sizeXZ.z} m + radio ${RADIO}) — #489`,
    sobra >= DENTRO_M,
    detalle,
  );
  ctx.log(`${cuando}: ${etiqueta} — ${detalle}`);
  return { p, sobra };
}

/** DÓNDE ESTÁ LA PARED, medida y no supuesta: desde el centro del objeto hacia
 *  los cuatro ejes, a qué distancia deja de bloquear. Determinista (no depende
 *  de que el jugador pueda llegar) y es la medida que el 81 no hace: él
 *  pregunta «¿bloquea el borde?» —una caja más grande también diría que sí—;
 *  esto pregunta DÓNDE acaba.
 *
 *  Se afirma sobre el MÍNIMO de los cuatro: un lado puede seguir bloqueado más
 *  allá porque tiene otra cosa pegada (en este bench, el cofre al lado), pero
 *  ninguno puede acabar ANTES de lo que dice core ni los cuatro pueden pasarse. */
async function paredMedida(ctx, obj) {
  return ctx.page.evaluate((e) => {
    const pc = window.__nefan.probePoint;
    const paso = 0.05;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => {
      let d = 0;
      for (; d <= 8; d = Number((d + paso).toFixed(2))) {
        if (!pc(e.pos.x + dx * d, e.pos.z + dz * d)) break;
      }
      return d;
    });
  }, obj);
}

/** Los dos asertos que hacen de una caja LA caja: es sólida donde debe (centro
 *  y cuatro bordes) y se ACABA donde core dice (el eje más corto de la pared
 *  medida cae en `media huella + radio ± 6 cm`, que es el paso del barrido). */
async function afirmaLaCaja(ctx, obj, etiqueta, cuando) {
  const m = await sondaDeCaja(ctx, obj);
  ctx.expect(
    `${cuando}, ${etiqueta} es sólida en su centro y en sus cuatro bordes (antes de #489 se atravesaba entera)`,
    m.centro === true && m.borde.every((b) => b === true),
    JSON.stringify(m),
  );
  const pared = await paredMedida(ctx, obj);
  const teorica = obj.sizeXZ.x / 2 + RADIO;
  const min = Math.min(...pared);
  ctx.expect(
    `${cuando}, la pared de ${etiqueta} está a ${teorica} m de su centro (media huella + radio), medida y no supuesta`,
    Math.abs(min - teorica) <= PASO_DEL_BARRIDO_M,
    `pared por eje [+x, −x, +z, −z] = ${JSON.stringify(pared)} · la más corta ${min.toFixed(2)} vs core ${teorica}`,
  );
  return { m, pared };
}

/** El HUECO entre dos cajas, sondeado sobre la línea que une sus centros: no
 *  depende de que el jugador pueda llegar, y es el dato de §9.1 de la PR 5. */
async function huecoEntre(ctx, a, b) {
  return ctx.page.evaluate(({ a, b }) => {
    const pc = window.__nefan.probePoint;
    const n = 120;
    let libres = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!pc(a.pos.x + (b.pos.x - a.pos.x) * t, a.pos.z + (b.pos.z - a.pos.z) * t)) libres++;
    }
    const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    return { libres, sondas: n + 1, separacion: dist, hueco: dist - a.sizeXZ.x / 2 - b.sizeXZ.x / 2 };
  }, { a, b });
}

/** Dónde está la pared de una caja, sin depender de que el jugador pueda
 *  llegar: el centro y los cuatro bordes (media huella + radio, un dedo por
 *  dentro) bloquean. */
async function sondaDeCaja(ctx, obj) {
  return ctx.page.evaluate((e) => {
    const pc = window.__nefan.probePoint;
    const d = e.sizeXZ.x / 2 + 0.4 - 0.1;
    return {
      centro: pc(e.pos.x, e.pos.z),
      borde: [pc(e.pos.x + d, e.pos.z), pc(e.pos.x - d, e.pos.z), pc(e.pos.x, e.pos.z + d), pc(e.pos.x, e.pos.z - d)],
    };
  }, obj);
}

export default async function (ctx) {
  const huella = await huellaDeCore();
  if (typeof huella !== "function") {
    ctx.sinMedir(
      `sin \`nefan-core/dist\` no hay con qué comparar la huella del spawn (cd nefan-core && npm run build): ${huella.error}`,
    );
  }

  // ── 0 · La partida, y la condición de la que depende que nada más cambie ──
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "image" });
  const partida = await comenzar(ctx);
  const delTile = (await objetos(ctx)).filter((o) => o.category === "building" || o.category === "prop");
  const deRuntime = delTile.filter((o) => o.dueno?.de !== "tile");
  ctx.expect(
    "al arrancar, TODO objeto bloqueable es de SU TILE (por eso su caja la sigue apagando el plan del tile y su solidez no cambió)",
    delTile.length > 0 && deRuntime.length === 0,
    `${delTile.length} bloqueables · no son del tile: ${deRuntime.map((o) => o.id).join(", ") || "ninguno"}`,
  );
  // Y la otra mitad de esa condición: el plan de ese tile llegó a instalarse
  // (`svgApplied`). Sin él, las cajas del tile SÍ aplicarían — es la red de
  // seguridad que la PR conserva, y aquí se afirma que no está en juego.
  const derivado = await ctx.page.evaluate(() => window.__nefan.colision());
  ctx.expect(
    "y el plan de su tile está INSTALADO (derivado al llegar): es lo que apaga esas cajas",
    derivado.length > 0 && derivado.every((t) => t.derivaciones + t.restauraciones > 0),
    JSON.stringify(derivado),
  );
  const edificio = delTile.find((o) => o.category === "building");
  ctx.log(`edificio del tile: ${edificio.id} en (${edificio.pos.x}, ${edificio.pos.z}) · ${JSON.stringify(edificio.sizeXZ)} · dueno=${JSON.stringify(edificio.dueno)}`);

  // ── 1 · El edificio del TILE frena donde frenaba ─────────────────────────
  await chocaConLaCajaQueDice(ctx, edificio, `«${edificio.id}» (edificio del tile)`, "el plan del tile");

  // ── 2 · Los spawns del motor: la huella la pone core ─────────────────────
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  const hostil = await ctx.waitFor(
    "el motor materializa al hostil (turno 2)",
    () => window.__nefan.enemies().find((e) => e.label === "Secuaz") ?? null,
    90_000,
  );
  await ctx.nefan("chooseDialogue", 0);
  const trio = await ctx.waitFor(
    "el motor pone la forja, el cofre y a Nogala (turno 3)",
    (n) => {
      const o = window.__nefan.objects();
      const forja = o.find((x) => x.label === n.f);
      const cofre = o.find((x) => x.label === n.c);
      const nogala = window.__nefan.npcs().find((x) => x.label === n.p);
      return forja && cofre && nogala ? { forja, cofre, nogala } : null;
    },
    90_000,
    { f: FORJA, c: COFRE, p: NOGALA },
  );
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera("la conversación se cierra", true, () => (window.__nefan.dialogueVisible ? null : true), { ms: 15_000 });

  // Y antes de medir nada andando, se acaba con el hostil que el motor soltó en
  // el turno 2. No es un apaño: es lo que hace quien juega cuando le atacan, y
  // sin ello lo que se mide es una carrera contra su daño — el jugador muere a
  // mitad del paseo, reaparece lejos y la parada ya no dice nada de la caja.
  // No se AFIRMA (matarlo no es el sujeto de este guion): se dice cómo acabó.
  const pelea = await herirHasta(ctx, hostil.id, 0, { sim: 45 });
  ctx.log(`el hostil del turno 2 (${hostil.label}): ${JSON.stringify(pelea)}`);
  await revivirSiHaceFalta(ctx);

  for (const [etiqueta, obj, kind] of [["la forja", trio.forja, "building"], ["el cofre", trio.cofre, "object"]]) {
    const dice = huella(kind);
    ctx.expect(
      `${etiqueta} que pone el motor mide lo que deriva core para un \`${kind}\` (${dice.x}×${dice.z} m), no lo que se inventara el cliente`,
      obj.sizeXZ?.x === dice.x && obj.sizeXZ?.z === dice.z,
      `${JSON.stringify(obj.sizeXZ)} vs core ${JSON.stringify(dice)}`,
    );
    ctx.expect(
      `${etiqueta} es de RUNTIME y no de ningún tile (su caja es lo único que puede frenar al jugador)`,
      obj.dueno?.de === "runtime",
      `dueno=${JSON.stringify(obj.dueno)}`,
    );
  }

  // La MISMA línea, medida ANTES de andar: el jugador está donde lo dejó la
  // conversación y la pelea. Abajo se vuelve a medir con él pegado a la forja,
  // y los dos números tienen que ser el mismo (#644).
  const huecoAntes = await huecoEntre(ctx, trio.cofre, trio.forja);

  // ── 3 · #489: son sólidos, su pared está donde core la pone, y el jugador
  //        andando se para en ella ────────────────────────────────────────
  for (const [etiqueta, obj] of [["la forja", trio.forja], ["el cofre", trio.cofre]]) {
    await afirmaLaCaja(ctx, obj, etiqueta, "en vivo");
  }
  // …y luego, andando contra la forja, que es la medida fuerte: dónde está la
  // pared del spawn cuando quien la prueba es el motor de movimiento.
  await chocaConLaCajaQueDice(ctx, trio.forja, `«${FORJA}»`, "en vivo");
  // Del cofre se DICE el hueco que deja con la forja. Era el dato de §9.1 —la
  // separación del turno era fija y no miraba el tamaño de lo que separaba— y
  // desde #524 la mira; quien lo afirma es `test/reparto-de-spawns.test.ts`,
  // aquí se registra lo que salió en el juego.
  const hueco = await huecoEntre(ctx, trio.cofre, trio.forja);
  ctx.log(
    `hueco entre «${COFRE}» y «${FORJA}»: centros a ${hueco.separacion.toFixed(2)} m, caras a ` +
      `${hueco.hueco.toFixed(2)} m (el cuerpo del jugador mide ${(RADIO * 2).toFixed(2)}); de ${hueco.sondas} sondas ` +
      `en la línea que los une, ${hueco.libres} libres`,
  );
  // EL ASERTO DE #644, y es el que este guion no podía hacer: la misma línea,
  // las mismas 121 muestras, los mismos objetos quietos — y el jugador en tres
  // sitios distintos, el tercero DENTRO de la forja.
  //
  // El tercero no es ceremonia y se midió: entre «antes de andar» y «pegado a
  // la forja» los dos orígenes están LIBRES, y desde un origen libre la
  // consulta de movimiento contesta lo mismo que la de punto — o sea que con
  // esos dos solos el aserto salía VERDE aunque se volviera a sondear con
  // `probeCollide` (probado el 2026-09-17: verde con el defecto puesto). Donde
  // `collidesAt` miente es desde DENTRO, que es donde acababa el jugador
  // cuando este guion daba 46, 38 y 0 libres en tres corridas del mismo código.
  // Por eso aquí se usa `setPlayerPos`: no para PROTEGER la sonda —eso es el
  // protocolo que #644 viene a quitar— sino para demostrar que no le hace
  // falta. Se deja al jugador donde estaba.
  //
  // (Entre CORRIDAS el número sigue variando, y esa es OTRA causa, que NO es
  // del motor falso: él emite `position_hint: "near_player"` y quien resuelve
  // es core —`consequence-handler.ts`, `resolvePositionHint`: jugador +
  // forward × 5—. O sea que dónde cae la forja depende de dónde para y hacia
  // dónde mira el jugador en el turno 3, que es cosa de ESTE guion. Medido:
  // paradas en (7,49, −12,58) y (8,94, −1,32) → 46, 45 y 9 muestras libres.
  // Por eso el hueco se DICE y lo que se AFIRMA es que no depende de dónde
  // esté el jugador cuando se pregunta.)
  const dondeEstaba = await posicion(ctx);
  await ctx.nefan("setPlayerPos", trio.forja.pos.x, trio.forja.pos.z);
  const desdeDentro = await huecoEntre(ctx, trio.cofre, trio.forja);
  await ctx.nefan("setPlayerPos", dondeEstaba.x, dondeEstaba.z);
  ctx.expect(
    `la misma línea da las mismas ${hueco.sondas} muestras desde tres sitios del jugador, uno DENTRO de la forja`,
    hueco.libres === huecoAntes.libres && desdeDentro.libres === huecoAntes.libres,
    `antes de andar ${huecoAntes.libres} libres · pegado a la forja ${hueco.libres} · desde su centro ` +
      `${desdeDentro.libres} — si difieren, la sonda vuelve a depender del origen`,
  );
  await ctx.shot("chocando-con-lo-que-puso-el-motor");

  // ── 4 · Un NPC no es una caja ────────────────────────────────────────────
  const npcSolido = await ctx.page.evaluate((id) => {
    const n = window.__nefan.npcs().find((x) => x.id === id);
    return n ? { pos: n.pos, solido: window.__nefan.probePoint(n.pos.x, n.pos.z) } : null;
  }, TABERNERO);
  ctx.expect(
    "donde está un NPC no hay caja: su sitio se puede pisar",
    npcSolido !== null && npcSolido.solido === false,
    JSON.stringify(npcSolido),
  );
  const listas = await ctx.page.evaluate((n) => ({
    enObjetos: window.__nefan.objects().some((o) => o.label === n),
    enNpcs: window.__nefan.npcs().some((x) => x.label === n),
  }), NOGALA);
  ctx.expect(
    `el NPC que pone el motor («${NOGALA}») entra como personaje y no como objeto: no hay huella que aplicarle`,
    listas.enNpcs && !listas.enObjetos,
    JSON.stringify(listas),
  );

  // ── 5 · Tras REANUDAR siguen ahí y siguen frenando ───────────────────────
  // El SAVE no guarda la huella: se deriva al leer el ledger. Se espera a que
  // el fichero en disco tenga ya los tres records de runtime —espera por
  // ESTADO, no por reloj— para que reanudar mida el camino del resume y no una
  // carrera con el autoguardado.
  const enDisco = await esperarEnElSave(
    partida.sessionId,
    (s) => (s.entities ?? []).filter((e) => e.spawn_reason === "narrative_request").length >= 3 || null,
    30_000,
  );
  ctx.expect(
    "el save tiene los records de runtime… y NINGUNA huella escrita (se deriva al leer)",
    Boolean(enDisco),
    `records de runtime en disco: ${enDisco}`,
  );
  const vuelta = await reanudar(ctx, partida.sessionId);
  ctx.expect("la partida vuelve", Boolean(vuelta), JSON.stringify(vuelta));
  const trasResume = await ctx.waitFor(
    "la forja y el cofre vuelven del save",
    (n) => {
      const o = window.__nefan.objects();
      const forja = o.find((x) => x.label === n.f);
      const cofre = o.find((x) => x.label === n.c);
      return forja && cofre ? { forja, cofre } : null;
    },
    90_000,
    { f: FORJA, c: COFRE },
  );
  for (const [etiqueta, obj, kind] of [["la forja", trasResume.forja, "building"], ["el cofre", trasResume.cofre, "object"]]) {
    const dice = huella(kind);
    ctx.expect(
      `${etiqueta} vuelve del save con la huella DERIVADA al leer (${dice.x}×${dice.z} m) — no está en disco`,
      obj.sizeXZ?.x === dice.x && obj.sizeXZ?.z === dice.z,
      `${JSON.stringify(obj.sizeXZ)} vs core ${JSON.stringify(dice)}`,
    );
  }
  for (const [etiqueta, obj] of [["la forja", trasResume.forja], ["el cofre", trasResume.cofre]]) {
    await afirmaLaCaja(ctx, obj, etiqueta, "tras reanudar");
  }
  await ctx.shot("tras-reanudar");
}
