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
 *  LO QUE NO SE AFIRMA, y se DICE con su medida: que el jugador llegue a tocar
 *  el cofre. Los tres spawns de un turno caen a 1,8 m unos de otros
 *  (`SEPARACION_M`) y entre los volúmenes del plan, así que a veces queda
 *  encajonado sin una cara libre por la que encararlo — exigir contacto ahí
 *  sería afirmar la suerte del spawn, no la caja. El guion registra el hueco
 *  entre sus caras y cuántas sondas quedan libres en la línea que las une: es
 *  el dato de §9.1 de la PR 5 (la separación no mira el TAMAÑO de lo que separa).
 *
 *  POR QUÉ TRAS REANUDAR TAMBIÉN. La huella NO está en el save: el resume la
 *  deriva del `type` del record (`spawnsDeRuntime` → `huellaEnMetros`). Si
 *  alguien la escribiera en disco «para no recalcularla», el día que cambie el
 *  defecto la partida guardada seguiría con la vieja y nadie se enteraría. El
 *  bloque 5 es lo que se enteraría.
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

/** La huella que declara core para cada clase de spawn, o el error si
 *  `nefan-core/dist` no está construido. */
async function huellaDeCore() {
  try {
    const { huellaEnMetros } = await import(
      path.join(RAIZ, "nefan-core", "dist", "src", "scene", "scene-normalize.js")
    );
    return (kind) => huellaEnMetros(kind);
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
 *  página, se acuerda de la última posición en `window.__qa91` y se cumple
 *  cuando el jugador lleva tres muestras sin moverse más de 2 cm. El
 *  cortafuegos se ABSORBE y la parada se lee después, porque una parada tardía
 *  no invalida la medida: quien afirma es el aserto de la caja. */
async function empujarContra(ctx, centro, maxMs = 12_000) {
  const p0 = await posicion(ctx);
  await ctx.nefan("setYaw", Math.atan2(centro.x - p0.x, centro.z - p0.z));
  await ctx.page.evaluate((p) => { window.__qa91 = { inicio: p, ult: null, quieto: 0, arranco: false }; }, p0);
  await ctx.nefan("inputDriver.press", "up");
  let arranco = false;
  try {
    const parada = await ctx.absorbe(
      `cortafuegos del empujón hacia (${centro.x.toFixed(1)}, ${centro.z.toFixed(1)}): la parada se lee ` +
        `justo después y la AFIRMA el aserto de la caja, que es donde vive la medida`,
      () =>
        ctx.waitFor(
          "el jugador anda y se para contra lo que tiene delante",
          (destino) => {
            const p = window.__nefan.state().pos;
            const w = window.__qa91;
            // Re-encarar en cada muestra, dentro de la página (mismo patrón que
            // `herirHasta`): el deslizamiento por ejes desvía al jugador en
            // cuanto roza algo, y sin corregir el rumbo acaba en el borde del
            // tile en vez de contra lo que se mide. Es lo que hace quien juega.
            window.__nefan.setYaw(Math.atan2(destino.x - p.x, destino.z - p.z));
            // Que el jugador ANDE es parte de la condición: si no, un jugador ya
            // parado contra otra cosa cumpliría «no avanza» sin haber medido nada.
            if (Math.hypot(p.x - w.inicio.x, p.z - w.inicio.z) > 0.15) w.arranco = true;
            if (!w.arranco) return null;
            if (!w.ult || Math.hypot(p.x - w.ult.x, p.z - w.ult.z) > 0.02) {
              w.ult = { x: p.x, z: p.z };
              w.quieto = 0;
              return null;
            }
            w.quieto++;
            return w.quieto >= 3 ? { x: p.x, z: p.z, arranco: true } : null;
          },
          maxMs,
          centro,
        ),
    );
    arranco = Boolean(parada?.arranco);
  } finally {
    await ctx.nefan("inputDriver.releaseAll");
  }
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
 *  tres caen a 1,8 m unos de otros y entre los volúmenes del plan, §9.1 de la
 *  PR 5), y exigirle contacto sería afirmar la suerte del spawn en vez de la
 *  caja. Andar y sondear miden dos cosas distintas y las dos hacen falta. */
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
 *  allá porque tiene otra cosa pegada (en este bench, el cofre a 1,8 m), pero
 *  ninguno puede acabar ANTES de lo que dice core ni los cuatro pueden pasarse. */
async function paredMedida(ctx, obj) {
  return ctx.page.evaluate((e) => {
    const pc = window.__nefan.probeCollide;
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
    const pc = window.__nefan.probeCollide;
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
    const pc = window.__nefan.probeCollide;
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
  await nuevaPartida(ctx, { gameId: GAME_ID });
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
  const pelea = await herirHasta(ctx, hostil.id, 0, { maxMs: 45_000 });
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

  // ── 3 · #489: son sólidos, su pared está donde core la pone, y el jugador
  //        andando se para en ella ────────────────────────────────────────
  for (const [etiqueta, obj] of [["la forja", trio.forja], ["el cofre", trio.cofre]]) {
    await afirmaLaCaja(ctx, obj, etiqueta, "en vivo");
  }
  // …y luego, andando contra la forja, que es la medida fuerte: dónde está la
  // pared del spawn cuando quien la prueba es el motor de movimiento.
  await chocaConLaCajaQueDice(ctx, trio.forja, `«${FORJA}»`, "en vivo");
  // Del cofre se DICE el hueco que deja con la forja, que no es un aserto sino
  // el dato de §9.1: la separación del motor es fija (1,8 m) y no mira el
  // tamaño de lo que separa.
  const hueco = await huecoEntre(ctx, trio.cofre, trio.forja);
  ctx.log(
    `hueco entre «${COFRE}» y «${FORJA}»: centros a ${hueco.separacion.toFixed(2)} m, caras a ` +
      `${hueco.hueco.toFixed(2)} m (el cuerpo del jugador mide ${(RADIO * 2).toFixed(2)}); de ${hueco.sondas} sondas ` +
      `en la línea que los une, ${hueco.libres} libres`,
  );
  await ctx.shot("chocando-con-lo-que-puso-el-motor");

  // ── 4 · Un NPC no es una caja ────────────────────────────────────────────
  const npcSolido = await ctx.page.evaluate((id) => {
    const n = window.__nefan.npcs().find((x) => x.id === id);
    return n ? { pos: n.pos, solido: window.__nefan.probeCollide(n.pos.x, n.pos.z) } : null;
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
