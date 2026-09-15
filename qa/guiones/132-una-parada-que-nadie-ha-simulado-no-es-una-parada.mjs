/** UNA PARADA QUE NADIE HA SIMULADO NO ES UNA PARADA (#545).
 *
 *  ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *  «El jugador empuja contra algo y deja de avanzar» se leía muestreando
 *  `state().pos` cada 150 ms de RELOJ DE PARED y declarando parada cuando tres
 *  muestras seguidas se movían menos de 2 cm. Bajo carga eso lee paradas que no
 *  existen: entre dos sondeos puede no haber corrido ni un frame, y entonces la
 *  posición es la misma **porque el mundo no se ha simulado**. Es el título de
 *  #545, y estaba escrito en el guion que el issue manda investigar (el 91).
 *
 *  ── POR QUÉ NO BASTA CON LA BATERÍA SIN NAVEGADOR ─────────────────────────
 *  `nefan-core/test/parada-de-qa.test.ts` ejerce el molde con una página falsa
 *  cuyo reloj se mueve a mano — que es lo que ningún navegador deja hacer— y
 *  ahí el candado se prueba en las dos direcciones. Lo que esa batería NO puede
 *  decir es si el predicado sobrevive el viaje a la página (Playwright lo
 *  serializa a texto) ni si el cliente real publica `reloj()` con la semántica
 *  que se le supone. Eso es lo que se mide aquí, y por eso este guion existe
 *  aparte: el mismo reparto que `sonda-de-qa.test.ts` + guion 131 en PR-4a.
 *
 *  ── LAS TRES DIRECCIONES ──────────────────────────────────────────────────
 *   A · **CONTROL POSITIVO**: con el mundo corriendo y el jugador empujando
 *       contra un muro, la parada SE DECLARA. Sin esto, un molde que no
 *       declarase nunca nada pasaría B y C sin medir una sola cosa — es el
 *       error que esta casa lleva trece apariciones cazando.
 *   B · **CONTROL NEGATIVO**: con el mundo corriendo y campo libre delante, la
 *       parada NO se declara. Un molde que declarase siempre pasaría A.
 *   C · **EL DEFECTO, REPRODUCIDO**: con el game loop apagado (sin rAF) la
 *       página sigue contestando y el jugador sigue exactamente donde estaba.
 *       C1: el patrón VIEJO —tres muestras separadas por reloj de pared, el
 *       código que había en el 91— declara una parada ahí, en menos de un
 *       segundo. C2: el molde nuevo no cuenta ni una muestra y la espera
 *       declara **⊘**, que es lo único honesto: nadie ha mirado.
 *
 *  C1 y C2 son el mismo material con dos veredictos, sobre la misma página y en
 *  el mismo estado. Eso es lo que hace que C2 signifique algo.
 *
 *  ── CÓMO SE LLEGA AL ESTADO 3, sin tocar el cliente ───────────────────────
 *  Quitándole a la PÁGINA su `requestAnimationFrame`: `scheduleNextFrame`
 *  (`nefan-html/src/main.ts`) se reprograma con él mientras la pestaña es
 *  visible, así que sin él el loop se apaga sin cambiar una línea del juego.
 *  Es el mismo verbo que usa el guion 131. Ni `display:none`, ni estado
 *  sintético, ni sabotaje del cliente.
 *
 *  Cero créditos: fixture del selector «Room», nunca arranca partida.
 */

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion carga una fixture y
 *  mide el molde de la parada sobre ella; no le pide NADA al motor. */
export const sinMotor = "carga una fixture del selector y mide el molde de la parada; nunca arranca partida";

import { cargarFixture } from "../lib/fixtures.mjs";
import { relojDeSimNoAvanzoEn } from "../lib/esperas.mjs";
import { elJugadorSePara, limpiaLaParada, loQueVioLaParada, paradaEnSim } from "../lib/parada.mjs";

/** EL PATRÓN VIEJO, tal y como estaba escrito en `guiones/91-…` antes de esta
 *  PR: tres muestras seguidas sin moverse 2 cm, separadas por lo que separe la
 *  cadencia de `waitFor` — o sea, por reloj de PARED. Vive aquí porque es el
 *  material del contraste: sin él, «el molde nuevo declara ⊘» no se distingue
 *  de «aquí no pasaba nada». */
const LA_PARADA_DE_PARED = () => {
  const p = window.__nefan.state().pos;
  const w = (window.__qa132pared ??= { ult: null, quietas: 0 });
  if (!w.ult || Math.hypot(p.x - w.ult.x, p.z - w.ult.z) > 0.02) {
    w.ult = { x: p.x, z: p.z };
    w.quietas = 0;
    return null;
  }
  w.quietas++;
  return w.quietas >= 3 ? { x: p.x, z: p.z } : null;
};

/** Qué hace una espera en el estado en el que está la página AHORA: `"⊘"` si
 *  declaró no poder medir, `"afirmó"` si se agotó el presupuesto y terminó
 *  diciendo «no ocurrió», o el nombre de lo que saliera. */
async function veredictoDe(ctx, desc, predicado, presupuesto, arg) {
  try {
    const r = await ctx.absorbe(
      `esta espera es su PROPIO sujeto: lo que se mide es con qué VEREDICTO termina (⊘ o afirmación), ` +
        `y eso se afirma con ctx.expect justo debajo`,
      () => ctx.waitFor(desc, predicado, presupuesto, arg),
    );
    return r === null ? "afirmó" : "se cumplió";
  } catch (err) {
    return relojDeSimNoAvanzoEn(err) ? "⊘" : `otro (${err?.name}: ${String(err?.message).slice(0, 90)})`;
  }
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece", () => Boolean(document.getElementById("ts-close")));
  await ctx.nefan("closeTitle");
  await cargarFixture(ctx, "robledo_tile");

  // ── El muro contra el que se empuja, sondeado (sin coordenadas mágicas) ──
  const edificio = await ctx.page.evaluate(() => {
    const b = (window.__nefan.scene?.objects ?? []).find((o) => o.category === "building");
    return b ? { id: b.id, x: b.position[0], z: b.position[2] } : null;
  });
  ctx.expect("la fixture trae un edificio con huella contra el que empujar", Boolean(edificio), JSON.stringify(edificio));
  if (!edificio) return;
  const zBorde = await ctx.page.evaluate((o) => {
    for (let z = o.z + 20; z > o.z; z -= 0.25) if (window.__nefan.probeCollide(o.x, z)) return z;
    return null;
  }, edificio);
  ctx.expect("se encuentra su borde sur sondeando", zBorde !== null, String(zBorde));
  if (zBorde === null) return;

  const arg = paradaEnSim({ slot: "__qa132", arranque: 0.15, destino: { x: edificio.x, z: edificio.z } });

  // ── A · CONTROL POSITIVO: con el mundo corriendo, la parada se declara ───
  await ctx.nefan("setPlayerPos", edificio.x, zBorde + 4);
  await ctx.nefan("setYaw", Math.PI);
  await limpiaLaParada(ctx, arg);
  const choque = await ctx.holdUntil("up", "el jugador empuja contra el muro y se para", elJugadorSePara, { sim: 12 }, arg);
  ctx.expect(
    "A · con el MUNDO corriendo, empujar contra un muro SÍ declara una parada (control: un molde que no declarase nunca pasaría B y C sin medir nada)",
    Boolean(choque),
    JSON.stringify(choque),
  );
  ctx.log(`A · parada en (${choque.x.toFixed(2)}, ${choque.z.toFixed(2)}) tras ${choque.muestras} muestras de mundo y ${choque.saltadas} sondeos saltados`);
  await ctx.shot("132-A-parado-contra-el-muro");

  // ── B · CONTROL NEGATIVO: campo libre delante, no hay parada ─────────────
  await ctx.nefan("setPlayerPos", edificio.x, zBorde + 6);
  await ctx.nefan("setYaw", 0); // de espaldas al edificio: hacia campo abierto
  const libre = paradaEnSim({ slot: "__qa132libre", arranque: 0.15 });
  await limpiaLaParada(ctx, libre);
  await ctx.expectEspera(
    "el jugador andando por campo libre se para",
    false,
    elJugadorSePara,
    {
      sim: 4,
      arg: libre,
      tecla: "up",
      aserto: "B · con campo libre delante NO se declara parada (control: un molde que declarase siempre pasaría A)",
    },
  );

  // ── C · EL DEFECTO: el mundo apagado, la página contestando ──────────────
  // Sin `requestAnimationFrame` el game loop no se reprograma: el jugador se
  // queda exactamente donde está y el reloj de sim deja de correr, pero la
  // página sigue contestando a todo. Es el estado en el que una muestra de
  // PARED no significa nada — y el que la carga produce a ratos.
  await ctx.nefan("setPlayerPos", edificio.x, zBorde + 4);
  await ctx.nefan("setYaw", Math.PI);
  const antesDeApagar = await ctx.nefan("reloj");
  await ctx.page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
  const quieto = await ctx.waitFor(
    "el game loop se ha apagado del todo (dos lecturas seguidas con el mismo reloj)",
    (base) => {
      const r = window.__nefan.reloj();
      const w = (window.__qa132apagado ??= { ult: null });
      const igual = w.ult !== null && r.sim === w.ult.sim && r.loop === w.ult.loop;
      w.ult = r;
      return igual ? { sim: r.sim - base.sim, loop: r.loop - base.loop } : null;
    },
    10_000,
    antesDeApagar,
  );
  ctx.log(`C · loop apagado: el reloj se movió ${quieto.sim.toFixed(2)} s de sim y ${quieto.loop} frames desde que se le quitó el rAF`);

  // C1 · el patrón VIEJO declara una parada aquí. Es el defecto, reproducido.
  await ctx.page.evaluate(() => {
    delete window.__qa132pared;
  });
  const veredictoViejo = await veredictoDe(
    ctx,
    "el patrón de PARED declara una parada con el mundo apagado",
    LA_PARADA_DE_PARED,
    4_000,
  );
  ctx.expect(
    "C1 · el patrón VIEJO (tres muestras separadas por reloj de PARED) declara una parada con el mundo APAGADO — el defecto de #545, reproducido sobre la página real",
    veredictoViejo === "se cumplió",
    `terminó «${veredictoViejo}» · el jugador no se ha movido porque no ha habido frame, y aun así se lee una parada`,
  );

  // C2 · el molde nuevo no cuenta ni una muestra, y lo DICE.
  const soloSim = paradaEnSim({ slot: "__qa132sim" });
  await limpiaLaParada(ctx, soloSim);
  const veredictoNuevo = await veredictoDe(
    ctx,
    "el molde de sim declara una parada con el mundo apagado",
    elJugadorSePara,
    { sim: 2, ms: 4_000 },
    soloSim,
  );
  const visto = await loQueVioLaParada(ctx, soloSim);
  ctx.expect(
    "C2 · el molde de SIM no puede declararla: sin mundo simulado no hay muestra, así que la espera sale ⊘ en vez de afirmar una parada que nadie ha visto",
    veredictoNuevo === "⊘",
    `terminó «${veredictoNuevo}» · ${JSON.stringify(visto)}`,
  );
  ctx.expect(
    "C2-bis · …y ni una sola muestra llegó a contar (todos los sondeos quedaron apuntados como saltados)",
    visto.muestras === 0 && visto.saltadas > 0,
    JSON.stringify(visto),
  );
  ctx.log(`C · mismo material, dos veredictos: pared «${veredictoViejo}» vs sim «${veredictoNuevo}»`);
}
