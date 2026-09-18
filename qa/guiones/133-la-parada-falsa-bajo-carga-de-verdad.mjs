/** LA PARADA FALSA, BAJO LA CARGA QUE LA CAUSA — Y EL MOLDE AGUANTÁNDOLA (#545).
 *
 *  ── POR QUÉ EXISTE, si ya está el 132 ────────────────────────────────────
 *  El guion 132 reproduce la parada falsa **apagando el game loop**, que es un
 *  estado limpio y determinista pero NO es el estado que produce la carga de la
 *  máquina. Con eso quedan dos cosas sin medir, y las dos están escritas como
 *  hechos en `qa/README.md` a partir de esta PR:
 *
 *   1 · «el throttling de CDP no puede producir la parada falsa, porque el
 *       `page.evaluate` de la sonda corre en el mismo hilo que se frena». Es un
 *       razonamiento, y esta casa no da por bueno un razonamiento sin medirlo:
 *       aquí se mide contando, sondeo a sondeo, cuántos vuelven SIN que el
 *       mundo haya corrido, y cuál es la RACHA más larga de esos. Tres seguidos
 *       es exactamente lo que el patrón viejo necesitaba para mentir.
 *   2 · **el molde nuevo no se ha ejercido nunca bajo carga real**: la batería
 *       sin navegador mueve el reloj a mano y el 132 lo apaga del todo. Lo que
 *       aquí se mira es lo que le pasa cuando hay frames, pero pocos y tarde —
 *       que es el caso del jugador, no el del loop muerto.
 *
 *  ── Y LA MITAD QUE EL 132 NO PRUEBA: que la parada declarada sea FALSA ────
 *  En el estado C del 132 el jugador **no tiene ninguna tecla pulsada**, así
 *  que la parada que el patrón viejo declara allí no es demostrablemente falsa:
 *  con el mundo corriendo, ese jugador también estaría parado. Lo que el patrón
 *  viejo hace mal es AFIRMAR sin haber mirado; aquí se da el paso que falta —
 *  el jugador está **siendo conducido**, y en cuanto el loop vuelve, anda. Una
 *  parada declarada sobre un jugador que estaba andando es falsa y se demuestra
 *  que lo era, sin depender de la opinión de nadie (bloque D).
 *
 *  ── QUÉ MIDE, en orden ────────────────────────────────────────────────────
 *   A · la carga es REAL (razón sim/pared quieta vs. frenada). Si no bajó, este
 *       guion no puede decir nada y lo declara: ⊘, no verde.
 *   B · bajo carga, la TRAZA de sondeos: cuántos vuelven sin mundo corrido y
 *       cuál es la racha más larga. Es la medida de la afirmación 1.
 *   C · bajo carga y andando por campo libre: el patrón VIEJO no declara una
 *       parada (si la declarara, el dial SÍ reproduce el defecto) y el MOLDE
 *       tampoco; y contra un muro, el molde SÍ la declara — un arreglo que
 *       dejara de ver las paradas de verdad bajo carga no serviría.
 *   D · con el loop PAUSADO y la tecla MANTENIDA: el patrón viejo declara una
 *       parada, y al soltar la pausa el jugador anda — luego era falsa.
 *
 *  El loop se pausa capturando `requestAnimationFrame` en vez de tirarlo: las
 *  callbacks del juego se guardan y se vuelven a soltar al reanudar, así que el
 *  loop se para y se reanuda sin tocar una línea del cliente.
 *
 *  Cero créditos: fixture del selector «Room», nunca arranca partida.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): fixture del selector, sin
 *  motor y sin partida. */
export const sinMotor = "carga una fixture del selector y mide el muestreo bajo carga sintética; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";
import { aplicarCarga } from "../lib/carga.mjs";
import { relojDeSimNoAvanzoEn } from "../lib/esperas.mjs";
import { elJugadorSePara, limpiaLaParada, loQueVioLaParada, paradaEnSim } from "../lib/parada.mjs";

/** Cuánto se frena el hilo principal. ×40 es el defecto del reproductor
 *  (`qa/bajo-carga.mjs`), medido como el dial donde el 91 se ponía rojo 5 de 6
 *  veces antes de PR-4a. */
const FACTOR = Number(process.env.QA133_FACTOR ?? 40);
/** Cuántos sondeos tiene la traza del bloque B. Los hace el bucle de `waitFor`
 *  (`qa/lib/sonda.mjs`), con su cadencia de 150 ms, porque lo que se mide es
 *  exactamente lo que le pasa a una espera de la batería. */
const SONDEOS = 40;

/** EL PATRÓN VIEJO, copiado de `guiones/91-…` antes de PR-4b: tres muestras
 *  seguidas sin moverse 2 cm, separadas por lo que separe la cadencia de
 *  `waitFor` — o sea, por reloj de PARED. */
const LA_PARADA_DE_PARED = () => {
  const p = window.__nefan.state().pos;
  const w = (window.__qa133pared ??= { ult: null, quietas: 0 });
  if (!w.ult || Math.hypot(p.x - w.ult.x, p.z - w.ult.z) > 0.02) {
    w.ult = { x: p.x, z: p.z };
    w.quietas = 0;
    return null;
  }
  w.quietas++;
  return w.quietas >= 3 ? { x: p.x, z: p.z } : null;
};

/** Con qué VEREDICTO termina una espera en el estado en el que está la página:
 *  `"⊘"`, `"afirmó"` (se agotó el presupuesto sin ocurrir) o `"se cumplió"`. */
async function veredictoDe(ctx, desc, predicado, presupuesto, arg) {
  try {
    const r = await ctx.absorbe(
      "esta espera es su PROPIO sujeto: lo que se mide es con qué veredicto termina, y eso lo afirma el ctx.expect de debajo",
      () => ctx.waitFor(desc, predicado, presupuesto, arg),
    );
    return r === null ? "afirmó" : "se cumplió";
  } catch (err) {
    return relojDeSimNoAvanzoEn(err) ? "⊘" : `otro (${err?.name}: ${String(err?.message).slice(0, 80)})`;
  }
}

/** LA TRAZA, sondeada por el bucle de la propia sonda (`qa/lib/sonda.mjs`, 150 ms
 *  de cadencia): cada sondeo apunta el reloj y la posición y no se cumple hasta
 *  tener `n`. Así el muestreo lo hace el banco, con su ritmo, y este guion no
 *  duerme — que es la regla `qa-guiones-sin-espera-por-reloj`. */
const TRAZA = (n) => {
  const p = window.__nefan.state().pos;
  const c = window.__nefan.reloj();
  const w = (window.__qa133traza ??= []);
  w.push({ sim: c.sim, frames: c.frames, x: p.x, z: p.z, t: Date.now() });
  return w.length >= n ? w : null;
};

/** La razón sim/pared de la página AHORA mismo, medida sobre la ventana que
 *  tarda una espera en agotarse. La ventana es de PARED a propósito: lo que se
 *  mide es precisamente cuánto mundo corre por segundo de máquina, y eso no se
 *  puede medir con el reloj del mundo. La expiración se ABSORBE nombrando dónde
 *  vive la medida, que es el `ctx.expect` de A. */
async function razonSimPared(ctx, ms) {
  const a = await ctx.nefan("reloj");
  const t0 = Date.now();
  await ctx.absorbe(
    "la ventana de medida de la razón sim/pared: esta espera no afirma nada, solo acota los segundos " +
      "de pared sobre los que se leen los dos relojes; la medida la afirma el aserto A",
    () => ctx.waitFor("ventana de medida de la carga", () => null, ms),
  );
  const b = await ctx.nefan("reloj");
  const pared = Date.now() - t0;
  return { razon: ((b.sim - a.sim) * 1000) / pared, sim: b.sim - a.sim, paredMs: pared, frames: b.frames - a.frames };
}

/** Un rumbo con al menos `metros` de campo libre por delante (`probeCollide`
 *  cada 25 cm), para que «anda y no choca» sea cierto y no una carrera contra
 *  un muro. Mismo método que `93:rumboLibre`. */
async function rumboLibre(ctx, metros = 25) {
  return ctx.page.evaluate((m) => {
    const p = window.__nefan.state().pos;
    const pc = window.__nefan.probeCollide;
    let mejor = { yaw: 0, libre: -1 };
    for (let i = 0; i < 72; i++) {
      const yaw = (i * Math.PI * 2) / 72;
      let libre = 0;
      for (let d = 0.25; d <= m; d += 0.25) {
        if (pc(p.x + Math.sin(yaw) * d, p.z + Math.cos(yaw) * d)) break;
        libre = d;
      }
      if (libre > mejor.libre) mejor = { yaw, libre };
    }
    return mejor;
  }, metros);
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, "robledo_tile");

  // ── A · LA CARGA ES REAL ─────────────────────────────────────────────────
  const quieta = await razonSimPared(ctx, 2_000);
  ctx.log(`quieta   · razón ${quieta.razon.toFixed(3)} · ${quieta.frames} frames en ${quieta.paredMs} ms`);
  await aplicarCarga(ctx.page, FACTOR);
  const cargada = await razonSimPared(ctx, 4_000);
  ctx.log(`carga×${FACTOR} · razón ${cargada.razon.toFixed(3)} · ${cargada.frames} frames en ${cargada.paredMs} ms`);
  if (!(cargada.razon < quieta.razon * 0.9) || !(cargada.frames > 0)) {
    ctx.sinMedir(
      `la carga no frenó esta página (razón quieta ${quieta.razon.toFixed(3)} vs frenada ` +
        `${cargada.razon.toFixed(3)}, ${cargada.frames} frames): sin carga real, nada de lo de abajo dice ` +
        `si el dial puede producir la parada falsa`,
    );
  }
  ctx.expect(
    "A · la carga sintética frena el mundo de verdad (razón sim/pared por debajo del 90 % de la quieta)",
    cargada.razon < quieta.razon * 0.9,
    `quieta ${quieta.razon.toFixed(3)} → frenada ${cargada.razon.toFixed(3)}`,
  );

  // ── B · LA TRAZA: ¿vuelve algún sondeo sin que el mundo haya corrido? ─────
  const r = await rumboLibre(ctx);
  await ctx.nefan("setYaw", r.yaw);
  await ctx.page.evaluate(() => {
    delete window.__qa133traza;
  });
  const traza = await ctx.holdUntil(
    "up",
    `${SONDEOS} sondeos de traza mientras el jugador anda bajo carga`,
    TRAZA,
    { sim: 20 },
    SONDEOS,
  );
  let rachaSinMundo = 0;
  let peorRacha = 0;
  let sondeosSinMundo = 0;
  let quietasSeguidas = 0;
  let peorQuietas = 0;
  for (let i = 1; i < traza.length; i++) {
    const dSim = traza[i].sim - traza[i - 1].sim;
    const dPos = Math.hypot(traza[i].x - traza[i - 1].x, traza[i].z - traza[i - 1].z);
    if (dSim <= 0) {
      sondeosSinMundo++;
      rachaSinMundo++;
      peorRacha = Math.max(peorRacha, rachaSinMundo);
    } else rachaSinMundo = 0;
    // Lo que contaría el patrón VIEJO: sondeos seguidos moviéndose < 2 cm.
    if (dPos <= 0.02) {
      quietasSeguidas++;
      peorQuietas = Math.max(peorQuietas, quietasSeguidas);
    } else quietasSeguidas = 0;
  }
  const paredTotal = traza[traza.length - 1].t - traza[0].t;
  const simTotal = traza[traza.length - 1].sim - traza[0].sim;
  ctx.log(
    `B · ${traza.length} sondeos en ${paredTotal} ms de pared y ${simTotal.toFixed(2)} s de mundo · ` +
      `${sondeosSinMundo} volvieron SIN mundo corrido (racha máxima ${peorRacha}) · racha máxima de ` +
      `sondeos moviéndose <2 cm: ${peorQuietas}`,
  );
  ctx.expect(
    "B · bajo carga, NINGÚN tramo de tres sondeos seguidos vuelve sin que el mundo haya corrido — que es lo que el patrón de pared necesitaba para declarar una parada que nadie simuló",
    peorRacha < 3,
    `racha máxima sin mundo ${peorRacha} sondeo(s) de ${traza.length}; racha máxima quieta ${peorQuietas}`,
  );

  // ── C · EL PATRÓN VIEJO Y EL MOLDE, andando bajo carga ───────────────────
  await ctx.page.evaluate(() => {
    delete window.__qa133pared;
  });
  const rumbo = await rumboLibre(ctx);
  await ctx.nefan("setYaw", rumbo.yaw);
  // El presupuesto va en sim aunque lo que se mida sea el patrón de PARED: el
  // sujeto de la espera es el jugador andando, y el candado de #545
  // (`test/esperas-que-conducen.test.ts`) tiene razón en exigirlo — de hecho
  // esta línea nació con `{ms: 8_000}` y el candado la puso roja, que es lo que
  // se esperaba de él con un guion recién escrito.
  const viejoAndando = await ctx.absorbe(
    "el sujeto es si el patrón de PARED declara una parada mientras el jugador anda: la afirmación es el ctx.expect de debajo",
    () =>
      ctx.holdUntil(
        "up",
        "el patrón de PARED declara una parada mientras el jugador ANDA bajo carga",
        LA_PARADA_DE_PARED,
        { sim: 3 },
      ),
  );
  ctx.expect(
    "C1 · bajo carga y andando por campo libre, el patrón VIEJO NO declara una parada (si la declarase, el dial de CDP sí reproduciría el defecto de #545)",
    viejoAndando === null,
    JSON.stringify(viejoAndando),
  );
  // Rumbo NUEVO y punto de partida nuevo: tras los 8 s de C1 el jugador puede
  // haberse comido los 25 m de campo libre que se midieron antes de andar, y
  // entonces «no declara parada» se estaría midiendo contra un muro. Medido:
  // sin esto, C2 salía rojo con el jugador legítimamente parado contra algo.
  await ctx.nefan("setPlayerPos", 0, 0);
  const rumbo2 = await rumboLibre(ctx);
  await ctx.nefan("setYaw", rumbo2.yaw);
  ctx.log(`C2 · rumbo ${rumbo2.yaw.toFixed(2)} rad con ${rumbo2.libre} m libres por delante`);
  const andando = paradaEnSim({ slot: "__qa133sim" });
  await limpiaLaParada(ctx, andando);
  const moldeAndando = await ctx.absorbe(
    "el sujeto es si el MOLDE declara una parada mientras el jugador anda: la afirmación es el ctx.expect de debajo",
    () => ctx.holdUntil("up", "el molde de SIM declara una parada mientras el jugador ANDA bajo carga", elJugadorSePara, { sim: 3 }, andando),
  );
  const vioAndando = await loQueVioLaParada(ctx, andando);
  ctx.expect(
    "C2 · …y el molde de SIM tampoco (control: el arreglo no consiste en no declarar nunca — eso lo comprueba C3)",
    moldeAndando === null,
    `${JSON.stringify(moldeAndando)} · ${JSON.stringify(vioAndando)}`,
  );

  // C3 · la parada DE VERDAD, bajo la misma carga: contra un muro sí se declara.
  const edificio = await ctx.page.evaluate(() => {
    const b = (window.__nefan.scene?.objects ?? []).find((o) => o.category === "building");
    return b ? { x: b.position[0], z: b.position[2] } : null;
  });
  ctx.expect("la fixture trae un edificio contra el que empujar", Boolean(edificio), JSON.stringify(edificio));
  if (!edificio) return;
  const zBorde = await ctx.page.evaluate((o) => {
    for (let z = o.z + 20; z > o.z; z -= 0.25) if (window.__nefan.probePoint(o.x, z)) return z;
    return null;
  }, edificio);
  await ctx.nefan("setPlayerPos", edificio.x, zBorde + 3);
  await ctx.nefan("setYaw", Math.PI);
  const contraElMuro = paradaEnSim({ slot: "__qa133muro", arranque: 0.15, destino: edificio });
  await limpiaLaParada(ctx, contraElMuro);
  const choque = await ctx.absorbe(
    "si la parada llega tarde no invalida nada: quien afirma es el ctx.expect de debajo, que mira si se declaró",
    () => ctx.holdUntil("up", "el jugador empuja contra el muro y se para, bajo carga", elJugadorSePara, { sim: 12 }, contraElMuro),
  );
  const vioMuro = await loQueVioLaParada(ctx, contraElMuro);
  ctx.expect(
    "C3 · bajo la MISMA carga, la parada de verdad (contra el muro) SÍ se declara — el molde no se ha vuelto ciego, solo honesto",
    Boolean(choque),
    `${JSON.stringify(choque)} · ${JSON.stringify(vioMuro)}`,
  );
  await ctx.shot("133-parado-contra-el-muro-bajo-carga");

  // ── D · LA PARADA FALSA DEMOSTRADA FALSA ─────────────────────────────────
  // Se quita la carga (lo que se mide aquí es el desacoplo, no la lentitud) y
  // se PAUSA el loop guardando las callbacks del rAF en vez de tirarlas, para
  // poder reanudarlo después con la misma tecla pulsada.
  await aplicarCarga(ctx.page, 1);
  const libre2 = await rumboLibre(ctx);
  await ctx.nefan("setYaw", libre2.yaw);
  await ctx.nefan("inputDriver.press", "up");
  await ctx.page.evaluate(() => {
    window.__qa133rAF = { orig: window.requestAnimationFrame.bind(window), cola: [] };
    window.requestAnimationFrame = (cb) => {
      window.__qa133rAF.cola.push(cb);
      return 0;
    };
  });
  // El frame que ya estaba pedido con el rAF de verdad todavía corre: se espera
  // a que el loop quede quieto (dos lecturas seguidas iguales) ANTES de tomar la
  // referencia, o «el mundo no ha corrido» mediría ese frame en vuelo.
  await ctx.waitFor(
    "el loop queda pausado del todo (dos lecturas seguidas con el mismo reloj)",
    () => {
      const c = window.__nefan.reloj();
      const w = (window.__qa133pausa ??= { ult: null });
      const igual = w.ult !== null && c.sim === w.ult.sim && c.loop === w.ult.loop;
      w.ult = c;
      return igual ? true : null;
    },
    10_000,
  );
  const antes = await ctx.nefan("reloj");
  const posAntes = (await ctx.nefan("state")).pos;

  // EL CONTROL DE LA MEDIDA DE B, y sin él B sería un verde que no comprueba
  // nada: la misma cuenta de rachas, sobre el estado en el que el desacoplo SÍ
  // existe. Si esta cuenta no viera ni aquí tres sondeos seguidos sin mundo,
  // sería la cuenta la que está rota, no el dial el que no descuelga.
  await ctx.page.evaluate(() => {
    delete window.__qa133traza;
  });
  // Presupuesto de PARED y no de sim, por el mismo motivo que la espera de
  // abajo: aquí el mundo NO corre, así que un presupuesto de sim no se gastaría
  // nunca y saldría ⊘ en vez de dejar sondear.
  const trazaPausa = await ctx.waitFor("6 sondeos de traza con el loop pausado", TRAZA, 6_000, 6);
  let rachaPausa = 0;
  let peorRachaPausa = 0;
  for (let i = 1; i < trazaPausa.length; i++) {
    if (trazaPausa[i].sim - trazaPausa[i - 1].sim <= 0) {
      rachaPausa++;
      peorRachaPausa = Math.max(peorRachaPausa, rachaPausa);
    } else rachaPausa = 0;
  }
  ctx.expect(
    "D0 · CONTROL de la medida de B: con el loop pausado, la MISMA cuenta sí ve tres o más sondeos seguidos sin mundo corrido — o sea que el 0 de B es un hecho del dial, no una cuenta rota",
    peorRachaPausa >= 3,
    `racha máxima con el loop pausado: ${peorRachaPausa} de ${trazaPausa.length - 1} intervalos`,
  );

  await ctx.page.evaluate(() => {
    delete window.__qa133pared;
  });
  // Ésta SÍ se presupuesta en pared a propósito y no se puede escribir de otra
  // forma: su sujeto es qué hace el patrón viejo mientras el mundo NO corre, así
  // que un presupuesto de sim no se gastaría nunca y saldría ⊘ en vez de medir.
  // Nótese que el candado de #545 no la ve —es `ctx.waitFor` con la tecla
  // mantenida aparte, no `holdUntil`—, que es exactamente el agujero que este
  // guion deja apuntado en su informe de QA.
  const veredictoPausado = await veredictoDe(
    ctx,
    "el patrón de PARED declara una parada con el loop PAUSADO y la tecla mantenida",
    LA_PARADA_DE_PARED,
    4_000,
  );
  const durante = await ctx.nefan("reloj");
  ctx.expect(
    "D1 · con el loop pausado y la tecla MANTENIDA, el patrón VIEJO declara una parada (y el mundo no ha corrido: 0 frames)",
    veredictoPausado === "se cumplió" && durante.frames === antes.frames,
    `terminó «${veredictoPausado}» · frames ${antes.frames} → ${durante.frames} · sim ${antes.sim.toFixed(2)} → ${durante.sim.toFixed(2)}`,
  );
  // Se reanuda el loop soltando las callbacks guardadas, con la MISMA tecla
  // pulsada: si el jugador anda, la parada que se acaba de declarar era falsa.
  await ctx.page.evaluate(() => {
    const g = window.__qa133rAF;
    window.requestAnimationFrame = g.orig;
    for (const cb of g.cola.splice(0)) g.orig(cb);
  });
  const anduvo = await ctx.waitFor(
    "al reanudar el loop, el jugador que «estaba parado» anda",
    (p) => {
      const q = window.__nefan.state().pos;
      return Math.hypot(q.x - p.x, q.z - p.z) > 0.3 ? { x: q.x, z: q.z } : null;
    },
    { sim: 3 },
    { x: posAntes.x, z: posAntes.z },
  );
  await ctx.nefan("inputDriver.releaseAll");
  ctx.expect(
    "D2 · …y esa parada era FALSA: al reanudar el loop, con la misma tecla, el jugador anda — no estaba parado, era que no había frame",
    Boolean(anduvo),
    JSON.stringify(anduvo),
  );
}
