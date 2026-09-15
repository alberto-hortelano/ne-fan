/** La sonda mínima sobre una página del juego: `nefan` y `waitFor`, los dos
 *  verbos con los que se conduce y se espera POR ESTADO.
 *
 *  Vivían dentro de `makeCtx` (qa/run.mjs) y los scripts sueltos que no corren
 *  bajo el runner —`fixtures-sin-bridge.mjs`, `captura-de-fixture.mjs`,
 *  `presupuesto-de-volumenes.mjs`— tenían cada uno su copia de la espera, con
 *  relojes ya divergidos (150/200 ms) y sin el último valor en el timeout. La
 *  extracción es la que permite que `cargarFixture(ctx, …)` (qa/lib/fixtures)
 *  sirva también fuera del runner (#332): exige `ctx.{page, nefan, waitFor}`,
 *  y eso es exactamente lo que devuelve `ctxDeSonda(page)`.
 *
 *  `makeCtx` DELEGA aquí: una implementación, todos los consumidores. Los
 *  cuerpos se movieron VERBATIM — cambiarles el reloj o los mensajes es
 *  cambiar el timing de la batería entera.
 *
 *  Desde #261 `waitFor` se APUNTA en el libro de esperas
 *  (`qa/lib/esperas.mjs`) al arrancar y lo cierra al posarse: cumplida si la
 *  condición se dio, expirada si no. El reloj y el mensaje no se tocan; lo
 *  nuevo es que la espera deja rastro desde el primer instante —también
 *  mientras corre—, y que el runner exige que alguien haya observado toda
 *  expiración, y que no quede ninguna en vuelo, antes de dar el guion por
 *  verde.
 *
 *  ── EL PRESUPUESTO DE SIMULACIÓN (#545) ───────────────────────────────────
 *  Desde esta tanda `waitFor` admite DOS relojes y solo uno de ellos decide.
 *
 *  El problema medido: el `gameLoop` del cliente topa su delta en 0,1 s
 *  (`nefan-html/src/main.ts`), así que un frame de 300 ms mueve el mundo 100.
 *  Un guion que presupuesta «0,5 m en 8 s» presupone que el reloj de pared y el
 *  del mundo son el mismo, y bajo carga dejan de serlo: el jugador no se ha
 *  parado, es que no ha habido frame. Eso es lo que leía el 91.
 *
 *  Así que con `{sim: N}` **quien decide la expiración es el reloj de
 *  simulación**: se sigue sondeando hasta que el MUNDO ha avanzado N segundos,
 *  los tarde en pared los que tarde. El cortafuegos de pared no desaparece —el
 *  rAF no corre en una pestaña oculta y de ahí hay que poder salir—, pero
 *  cuando salta ANTES que el sim no puede afirmar nada: declara **⊘**
 *  (`RelojDeSimNoAvanzo`, exit 2, que degrada más que el rojo) diciendo «sim
 *  pedido vs. sim avanzado». Nunca «no ocurrió».
 *
 *  Esa asimetría es el mecanismo entero: un guion que no pudo medir no puede
 *  terminar diciendo que midió. Y con presupuesto de PARED —un número, como
 *  siempre— no se lee el reloj del juego ni una vez: el camino es byte a byte
 *  el de antes, porque cambiarle la cadencia o los mensajes a `waitFor` es
 *  cambiarle el timing a la batería entera.
 *
 *  Lo que esto NO arregla, dicho aquí: la espera cuyo sujeto no es el juego
 *  progresando (que conteste el bridge, que llegue un frame de websocket) se
 *  mide en pared y así se queda — el sim no dice nada de un servidor. */

import {
  EsperaExpirada,
  RelojDeSimNoAvanzo,
  esperaExpiradaEn,
  libroDeEsperas,
  quejaDelMotivo,
  sitioDeLlamada,
} from "./esperas.mjs";

/** Cada cuánto se vuelve a mirar. Era un literal y ahora tiene nombre: es la
 *  cadencia contra la que se mide el aliasing del muestreo, y el mismo número
 *  de siempre (150 ms). */
export const CADENCIA_MS = 150;

/** Cuánta pared se le da a un presupuesto de sim antes de rendirse, en veces el
 *  propio presupuesto. **Proporcional SIEMPRE, sin techo absoluto**, y esa
 *  palabra es el arreglo de un defecto medido.
 *
 *  MEDIDO, no elegido a ojo: `qa/bajo-carga.mjs` midió la razón sim/pared de
 *  esta máquina a ×20 (0,465-0,551) y a ×40 (0,152-0,309), que es el régimen
 *  donde el 91 sale rojo 5 de 6 veces. Para que un segundo de sim quepa con
 *  razón 0,152 hacen falta 6,6 de pared: ×10 los cubre con margen y deja el ⊘
 *  para cuando el mundo de verdad no avanza.
 *
 *  POR QUÉ NO HAY TECHO ABSOLUTO, y lo hubo. La primera versión topaba esto en
 *  300 s «para no mirar un cadáver quince minutos», y con el tope puesto el ×10
 *  solo era ×10 para el presupuesto más pequeño (QA, H-4): `{sim:45}` era
 *  ×6,67, `{sim:60}` ×5,00 y `{sim:90}` **×3,33** — o sea que un `{sim:90}`
 *  bajo una carga de razón 0,3 (la que yo mismo medí a factor 40) se rendía por
 *  PARED en vez de medir. El cortafuegos volvía a decidir justo en el régimen
 *  que motivó la tanda. El cadáver se ataja mucho mejor con el LATIDO del loop
 *  (`LOOP_COLGADO_MS`), que lo caza en diez segundos y no en cinco minutos,
 *  así que el techo no compraba nada que no estuviera ya comprado. */
export const CORTAFUEGOS_POR_SIM = 10;

/** Cuánto se tolera que el reloj de la página no se pueda LEER antes de
 *  declarar ⊘. Una navegación tumba el contexto de ejecución un par de
 *  segundos y eso es normal; diez, no. */
export const RELOJ_ILEGIBLE_MS = 10_000;

/** Cuánto se tolera que no se mueva NADA —ni el mundo ni el game loop— antes de
 *  declarar ⊘. Es el cortafuegos contra el rAF desacoplado, y por eso el de
 *  pared puede ser proporcional al sim pedido en vez de estar topado (H-4).
 *
 *  ── LO QUE ESTO CAZA NO ES LENTITUD, Y LA PRIMERA VERSIÓN LO DIJO MAL ──────
 *  Aquí había escrito «una página viva emite frames aunque vaya a 3 fps (un
 *  frame cada ~330 ms)», y eso es la MEDIA. QA midió el peor frame ENTRE
 *  LECTURAS y el número es otro: ×1 → **242 ms**; ×40 → **10.300-11.500 ms**;
 *  ×100, el máximo del dial → **19.112 ms**. O sea que en los dos regímenes de
 *  carga de esta tanda **un solo frame ya dura más que este guardia entero**, y
 *  la justificación que había era falsa aunque su conclusión fuese correcta.
 *
 *  Por qué el guardia no se dispara aun así, que es lo que faltaba escribir:
 *  solo puede dispararse en una lectura que **VUELVE** con el reloj sin mover, y
 *  mientras el hilo principal está bloqueado `page.evaluate` está bloqueado con
 *  él — no vuelve nadie a quien contarle nada. Cuando el frame larguísimo
 *  termina, la lectura trae el avance de golpe y el latido se renueva. Así que
 *  lo que este guardia caza **no es que la página vaya lenta: es que está viva,
 *  contesta, y aun así no avanza** — el rAF que dejó de reprogramarse, que es el
 *  estado 3 del guion 131. Con carga, cuanto más lento va el frame, MENOS puede
 *  disparar esto.
 *
 *  Diez segundos son, entonces, «diez segundos contestando sin haber movido ni
 *  un milisegundo de mundo ni un frame de loop», no «diez segundos lento». */
export const LOOP_COLGADO_MS = 10_000;

/** El reloj de sim TAL Y COMO LO PUBLICA EL JUEGO, leído dentro de la página.
 *  `null` si el cliente no lo publica (bundle de producción, o la página
 *  todavía no ha evaluado `main.ts`). */
const RELOJ_DE_LA_PAGINA = () => {
  const r = window.__nefan && window.__nefan.reloj;
  return typeof r === "function" ? r() : null;
};

/** Qué reloj mide esta espera: un número son MILISEGUNDOS de pared (lo de
 *  siempre) y `{sim: N}` son SEGUNDOS de simulación, con `ms` opcional para
 *  fijar el cortafuegos a mano.
 *
 *  Fail-loud con cualquier otra cosa: un presupuesto que no se entiende caería
 *  en `timeoutMs = undefined`, `Date.now() - t0 < undefined` es siempre falso y
 *  la espera haría UN sondeo y se daría por expirada. O sea, un guion que mide
 *  una vez y afirma un negativo. */
export function presupuestoDeEspera(presupuesto, desc) {
  if (typeof presupuesto === "number") {
    if (!Number.isFinite(presupuesto) || presupuesto < 0) {
      throw new Error(
        `waitFor(«${desc}»): el cortafuegos de pared son milisegundos ≥ 0 y llegó ${JSON.stringify(presupuesto)}.`,
      );
    }
    return { sim: null, techoMs: presupuesto, rotulo: null };
  }
  if (presupuesto !== null && typeof presupuesto === "object" && !Array.isArray(presupuesto)) {
    const { sim, ms } = presupuesto;
    // `{ms: N}` A SECAS: pared DECLARADA, exactamente igual que el número suelto
    // —mismo techo, mismo camino, sin leer el reloj del juego ni una vez—, pero
    // con la unidad escrita. Existe desde #545 porque `holdUntil` dejó de
    // aceptar números: una espera que conduce al jugador y de verdad depende de
    // OTRO proceso (que el bridge genere un tile) tiene que poder escribirse, y
    // tiene que verse en el diff que se está escribiendo pared. Quién vigila que
    // no se abuse de esto: `test/esperas-que-conducen.test.ts`, que la exige
    // apuntada con su motivo en `data/contract/esperas-que-conducen.json`.
    if (sim === undefined) {
      if (typeof ms !== "number" || !Number.isFinite(ms)) {
        throw new Error(
          `waitFor(«${desc}»): un presupuesto \`{ms: N}\` son MILISEGUNDOS de pared y llegó ` +
            `${JSON.stringify(ms)}.`,
        );
      }
      // SUELO, y es el que la forma de objeto necesita y el número suelto no
      // (QA, H-4): `{ms: 4}` es lo que sale de teclear `{sim: 4}` con la clave
      // equivocada, y con 4 ms la espera hace UN sondeo — o sea que un
      // `expectEspera(desc, false, …)` saldría ✔ afirmando un negativo con una
      // sola mirada, que es exactamente el defecto que `presupuestoDeEspera`
      // existe para cerrar. Por debajo de la CADENCIA no hay presupuesto que
      // gastar: hay una mirada. El número suelto no lleva suelo porque no se
      // puede teclear por error en lugar de `{sim: N}`.
      if (ms < CADENCIA_MS) {
        throw new Error(
          `waitFor(«${desc}»): un presupuesto \`{ms: ${ms}}\` no llega ni a la cadencia de sondeo ` +
            `(${CADENCIA_MS} ms), así que solo puede mirar UNA vez — y una mirada no es un presupuesto. ` +
            `¿Querías \`{sim: ${ms}}\`, o sea ${ms} SEGUNDOS DE MUNDO? Si de verdad querías pared corta, ` +
            `escríbela como número suelto: la forma de objeto existe para declarar la unidad.`,
        );
      }
      return { sim: null, techoMs: ms, rotulo: null };
    }
    if (typeof sim !== "number" || !Number.isFinite(sim) || sim <= 0) {
      throw new Error(
        `waitFor(«${desc}»): un presupuesto de simulación son SEGUNDOS de mundo > 0 (\`{sim: 4}\`) y ` +
          `llegó ${JSON.stringify(sim)}.`,
      );
    }
    if (ms !== undefined && (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0)) {
      throw new Error(
        `waitFor(«${desc}»): el cortafuegos de pared de un presupuesto de sim son milisegundos > 0 y ` +
          `llegó ${JSON.stringify(ms)}.`,
      );
    }
    const techoMs = ms ?? Math.round(sim * 1000 * CORTAFUEGOS_POR_SIM);
    return { sim, techoMs, rotulo: `${sim.toFixed(2)} s de sim (cortafuegos de pared ${techoMs} ms)` };
  }
  throw new Error(
    `waitFor(«${desc}»): el presupuesto es un número de MILISEGUNDOS de pared o un objeto ` +
      `\`{sim: SEGUNDOS de simulación}\`; llegó ${JSON.stringify(presupuesto)}.`,
  );
}

/** El presupuesto con el que espera una ESPERA CONDUCIDA, armado desde las
 *  opciones de `ctx.expectEspera({ms, sim})`.
 *
 *  Vive aquí, y no dentro de `expectEspera` (`qa/run.mjs`), por el hallazgo H-1
 *  de QA: allí era una línea suelta que pasaba `ms` **a pelo**, y cuando
 *  `holdUntil` dejó de aceptar números —en esta misma tanda— el guion 80 se
 *  quedó sin correr. El fichero del 80 estaba intacto, el contrato de exenciones
 *  bendecía ese sitio por escrito, y aun así el runner se negaba a ejecutarlo:
 *  dos candados describiendo estados incompatibles, y nadie entre ellos.
 *
 *  Sacándolo aquí, la regla se puede EJERCER sin navegador —que es donde el
 *  defecto se habría visto— y queda una sola definición de «con qué presupuesto
 *  espera una espera conducida». Lo que garantiza: **siempre devuelve un objeto**
 *  (la forma que `holdUntil` exige) y siempre uno que `presupuestoDeEspera`
 *  entiende. */
export function presupuestoConducido({ ms = 30_000, sim = null } = {}) {
  return sim === null ? { ms } : { sim, ms };
}

/** Cuánto ha avanzado el reloj entre dos lecturas.
 *
 *  Sin lectura previa, nada: la primera lectura es la BASE, no un avance. Y si
 *  el reloj ha ido hacia atrás, la página ha navegado (un `reload` para reanudar
 *  la partida arranca el contador de cero, y media batería lo hace): lo que se
 *  cuenta entonces es todo lo que lleva el reloj nuevo, que es el mundo que ha
 *  corrido desde la recarga. Restar daría negativo y el presupuesto no se
 *  agotaría jamás. */
export function avanceDelReloj(previa, actual) {
  const desdeCero = { sim: actual.sim, frames: actual.frames, loop: actual.loop };
  if (!previa) return { sim: 0, frames: 0, loop: 0 };
  if (actual.sim >= previa.sim) {
    return {
      sim: actual.sim - previa.sim,
      frames: actual.frames - previa.frames,
      loop: actual.loop - previa.loop,
    };
  }
  return desdeCero;
}

/** ¿Se entiende esta lectura del reloj?
 *
 *  `typeof NaN === "number"`, y ese detalle abría la misma puerta que
 *  `presupuestoDeEspera` cierra en la entrada (QA, H-6): con `sim` a `NaN` el
 *  acumulado es `NaN`, `NaN < presupuesto` es falso, y la espera sale del bucle
 *  **por el camino de la AFIRMACIÓN** tras un solo sondeo — «el mundo avanzó
 *  sus N segundos y no ocurrió» con cero segundos mirados. Un reloj que no se
 *  entiende es un reloj que no se puede leer, y eso es ⊘. */
export function lecturaDelRelojValida(r) {
  return (
    r !== null &&
    typeof r === "object" &&
    Number.isFinite(r.sim) &&
    Number.isFinite(r.frames) &&
    Number.isFinite(r.loop)
  );
}

/** El subconjunto de `ctx` que no necesita runner: para scripts con page
 *  cruda de Playwright. */
export function ctxDeSonda(page) {
  /** El libro de esperas de ESTE ctx (#261): toda expiración se anota aquí y
   *  el runner exige, al terminar el guion, que alguien la haya observado. Los
   *  scripts sueltos que usan `ctxDeSonda` sin runner lo llevan igual —cuesta
   *  un Map vacío— y así `absorbe` y el `cause` funcionan también ahí; quien no
   *  lo lee, no paga nada. */
  const esperas = libroDeEsperas();
  return {
    page,
    esperas,
    log: (msg) => console.log(`    ${msg}`),

    /** Consume una expiración DICIENDO dónde vive la medida de verdad: corre
     *  `fn`, y si de ahí sale una `EsperaExpirada` (suya o de su cadena de
     *  causas) la da por observada y devuelve `null`.
     *
     *  El motivo es obligatorio y es una FRASE, no un booleano — mismo
     *  criterio que `exentoDeMotor` y `sinMedir`: hay que escribirlo, se ve en
     *  el diff y dice qué clase de espera es. Un motivo que no nombre dónde se
     *  mide lo que aquí se deja de medir es exactamente la exención callada que
     *  este candado viene a impedir.
     *
     *  Solo absorbe expiraciones: cualquier otro error sigue subiendo. */
    async absorbe(motivo, fn) {
      const queja = quejaDelMotivo(motivo);
      if (queja) {
        throw new Error(
          `ctx.absorbe exige el MOTIVO por el que esta expiración es legítima —una frase que diga ` +
            `DÓNDE vive la medida—, y el que llegó ${queja}.`,
        );
      }
      try {
        return await fn();
      } catch (err) {
        const exp = esperaExpiradaEn(err);
        if (!exp) throw err;
        esperas.resuelve(exp.esperaId, `absorbida: ${motivo}`);
        return null;
      }
    },

    /** Llama a window.__nefan.<path>(...args), o lo lee si no es función. */
    async nefan(path, ...fnArgs) {
      return page.evaluate(
        ([p, a]) => {
          const hook = window.__nefan;
          if (!hook) throw new Error("window.__nefan no existe (¿build de producción?)");
          const keys = p.split(".");
          const owner = keys.slice(0, -1).reduce((o, k) => (o == null ? o : o[k]), hook);
          const target = keys.length === 1 ? hook[p] : owner?.[keys[keys.length - 1]];
          if (target === undefined) throw new Error(`__nefan.${p} no existe`);
          return typeof target === "function" ? target.apply(keys.length === 1 ? hook : owner, a) : target;
        },
        [path, fnArgs],
      );
    },

    /** Espera a que `probeFn` (evaluada en la página) devuelva algo truthy.
     *  `arg` viaja serializado a la página: los guiones comparan contra
     *  valores que midieron antes, sin ensuciar `window` con globales.
     *
     *  `presupuesto` es un número de MILISEGUNDOS de pared (lo de siempre) o un
     *  `{sim: SEGUNDOS}` de simulación, que es el reloj con el que progresa el
     *  juego (#545) — ver la cabecera del fichero.
     *
     *  NO es `async` a propósito: la espera se APUNTA en el libro nada más
     *  arrancar y se le enlaza su propia promesa, para que el runner pueda
     *  saber al cerrar el guion si sigue en vuelo (#261, hallazgo 1 de QA). El
     *  reloj y el mensaje son los de siempre; lo único nuevo es que la espera
     *  deja rastro desde que empieza, no solo cuando expira. */
    waitFor(desc, probeFn, presupuesto = 30_000, arg = undefined) {
      const p = presupuestoDeEspera(presupuesto, desc);
      const id = esperas.abre(desc, p.techoMs, sitioDeLlamada(new Error().stack), p.rotulo);
      const posada = (async () => {
        const t0 = Date.now();
        let last;
        // Cuántas veces se llegó a MIRAR, y cuántas de ellas fue la sonda la
        // que falló: sin esto, una sonda rota (`window.__nefan.noExiste`) es
        // indistinguible de una condición que no se cumple, y un negativo
        // deliberado la afirmaría como éxito (hallazgo 3 de QA).
        let muestras = 0;
        let rotos = 0;
        // El reloj de SIM de la página. Solo con presupuesto de sim: con el de
        // pared no se lee ni una vez y el camino es exactamente el de antes.
        let previa = null;
        let consumido = 0;
        let frames = 0;
        let loop = 0;
        let ilegibleDesde = null;
        let porQueIlegible = null;
        // EL LATIDO: cuándo fue la última vez que se movió ALGO — el mundo o el
        // propio game loop. Es lo que permite que el cortafuegos de pared sea
        // proporcional al sim pedido en vez de estar topado (H-4): el cadáver lo
        // caza esto en diez segundos.
        //
        // «ALGO» y no «el loop», y la diferencia costó un defecto (H-11 de QA):
        // mirando solo `loop`, el guardia declaraba MUERTA una página que estaba
        // viva y simulando —medido sobre el juego real, `{sim:1.7166, frames:96,
        // loop:0}` con 10,02 s de mundo corridos en 10 s de pared— porque
        // descansaba en un invariante de `main.ts` (`loop ≥ frames`) que **nada
        // sujetaba**. Un mundo que avanza no se puede declarar muerto: ésa es la
        // regla, y se escribe aquí para que no dependa de cómo esté cableado el
        // cliente. `loop` sigue contándose porque es lo que DIAGNOSTICA el estado
        // —late pero no simula— y eso no lo dice ninguna otra cifra.
        let ultimoLatido = Date.now();
        const leeElReloj = async (base = false) => {
          if (p.sim === null) return;
          let r = null;
          let contestó = false;
          try {
            r = await page.evaluate(RELOJ_DE_LA_PAGINA);
            contestó = true;
          } catch (e) {
            porQueIlegible = `la página no contestó (${String(e?.message ?? e)})`;
          }
          if (!lecturaDelRelojValida(r)) {
            if (contestó) {
              porQueIlegible =
                r === null
                  ? "el cliente no publica `window.__nefan.reloj()`"
                  : `el reloj contestó algo que no se entiende (${JSON.stringify(r)})`;
            }
            // En la BASE es fatal y no hay que esperar diez segundos a decirlo:
            // si el cliente contestó y no tiene reloj, no lo va a tener luego —
            // es un bundle de producción o una página que no es el juego, y ese
            // guion no puede presupuestar en sim. Un fallo de contexto sí puede
            // ser transitorio, así que ése espera como los demás.
            if (base && contestó) throw sinMedirElReloj();
            ilegibleDesde ??= Date.now();
            if (Date.now() - ilegibleDesde >= RELOJ_ILEGIBLE_MS) throw sinMedirElReloj();
            return;
          }
          ilegibleDesde = null;
          const av = avanceDelReloj(previa, r);
          consumido += av.sim;
          frames += av.frames;
          loop += av.loop;
          if (previa === null || av.loop > 0 || av.sim > 0 || av.frames > 0) ultimoLatido = Date.now();
          previa = r;
          if (Date.now() - ultimoLatido >= LOOP_COLGADO_MS) throw nadaSeMueve();
        };
        /** El ⊘ del rAF DESACOPLADO: la página contesta y aun así no se mueve
         *  nada, ni el mundo ni el loop. No es lentitud —con el hilo bloqueado
         *  la lectura tampoco vuelve, así que esto no puede dispararse— y no es
         *  «el mundo no corre», que es el título delante y sale por el otro ⊘
         *  con sus dos cifras. */
        const nadaSeMueve = () => {
          const paradoMs = Date.now() - ultimoLatido;
          esperas.expira(id);
          esperas.resuelve(id, `⊘ no se mueve nada desde hace ${Math.round(paradoMs)} ms`);
          return new RelojDeSimNoAvanzo(
            `no se pudo medir «${desc}»: sim pedido ${p.sim.toFixed(2)} s vs. sim avanzado ` +
              `${consumido.toFixed(2)} s, y en ${Math.round(paradoMs)} ms no se ha movido NADA (mínimo ` +
              `${LOOP_COLGADO_MS} ms): ni el mundo (${frames} frames) ni el propio game loop (${loop}). La ` +
              `página CONTESTA —si estuviera bloqueada, esta lectura tampoco habría vuelto—, así que no va ` +
              `lenta: está desacoplada, el rAF dejó de reprogramarse. Se declara ⊘ en vez de esperar al ` +
              `cortafuegos entero para afirmar algo que nadie ha medido.`,
            { esperaId: id, desc, sitio: p.rotulo, pedido: p.sim, avanzado: consumido, frames, paredMs: Date.now() - t0 },
          );
        };

        /** El ⊘ de «no se pudo leer el reloj», hermano del de «no avanzó».
         *
         *  Cierra el asiento del libro ANTES de devolver el error: si no, la
         *  espera se queda ABIERTA para siempre y el runner la cobra además
         *  como «seguía en vuelo». Un ⊘ no puede traerse un fallo de regalo. */
        const sinMedirElReloj = () => {
          esperas.expira(id);
          esperas.resuelve(id, `⊘ el reloj de sim no se pudo leer: ${porQueIlegible}`);
          return new RelojDeSimNoAvanzo(
            `no se pudo medir «${desc}»: se pidió un presupuesto de ${p.sim.toFixed(2)} s de SIMULACIÓN y el ` +
              `reloj del juego no se pudo leer — ${porQueIlegible}. Sin reloj de sim no hay presupuesto que ` +
              `gastar, así que esta espera no dice si la condición se cumple: se declara ⊘ en vez de ` +
              `afirmar un hecho que nadie ha mirado.`,
            { esperaId: id, desc, sitio: p.rotulo, pedido: p.sim, avanzado: consumido, frames, paredMs: Date.now() - t0 },
          );
        };
        await leeElReloj(true);
        /** ¿Sigue viva la espera? Con presupuesto de pared, EXACTAMENTE la
         *  condición de siempre. Con presupuesto de sim manda el sim, y la
         *  pared es solo la puerta de emergencia. */
        const sigue = () =>
          Date.now() - t0 < p.techoMs && (p.sim === null || consumido < p.sim);
        // `primera` garantiza UN sondeo aunque el presupuesto sea 0: si no, el
        // último valor sería `undefined` y tampoco habría mirado nadie.
        for (let primera = true; primera || sigue(); primera = false) {
          last = await page.evaluate(probeFn, arg).catch((e) => ({ __err: String(e) }));
          muestras++;
          if (last && last.__err) rotos++;
          if (last && !last.__err) {
            esperas.cumple(id);
            return last;
          }
          await new Promise((r) => setTimeout(r, CADENCIA_MS));
          await leeElReloj();
        }
        const paredMs = Date.now() - t0;
        // EL CORTAFUEGOS DE PARED SALTÓ ANTES QUE EL RELOJ DE SIM: no hay hecho
        // que afirmar. Se anota la expiración y se da por OBSERVADA aquí mismo
        // —el ⊘ que sale es su observador— para que el libro no la cuente además
        // como pendiente, y se lanza algo que ninguna de las bocas que consumen
        // expiraciones va a tragarse.
        if (p.sim !== null && consumido < p.sim) {
          esperas.expira(id);
          esperas.resuelve(id, `⊘ el reloj de sim no llegó al presupuesto: ${consumido.toFixed(2)}/${p.sim} s`);
          throw new RelojDeSimNoAvanzo(
            `no se pudo medir «${desc}»: sim pedido ${p.sim.toFixed(2)} s vs. sim avanzado ` +
              `${consumido.toFixed(2)} s (${frames} frames de MUNDO y ${loop} del LOOP en ` +
              `${(paredMs / 1000).toFixed(1)} s de pared, cortafuegos ${p.techoMs} ms). Saltó el cortafuegos ` +
              `de PARED antes que el reloj de SIMULACIÓN, así que el juego no llegó a correr los segundos que ` +
              `se le pidieron: esto NO es «no ocurrió», es que nadie ha mirado. Se declara ⊘ (exit 2, que ` +
              `degrada más que el rojo).` +
              (loop > 0 && frames === 0
                ? ` Y las dos cifras dicen QUÉ pasó: la página late (${loop} frames) pero el mundo no se ` +
                  `simula ni uno — el título delante, o una partida sin empezar.`
                : ""),
            { esperaId: id, desc, sitio: p.rotulo, pedido: p.sim, avanzado: consumido, frames, paredMs },
          );
        }
        // La expiración es un HECHO y queda en el libro con su reloj y su
        // sitio. Que la excepción llegue o no a alguien ya no decide si se
        // midió — eso lo decide quién la RESUELVA.
        esperas.expira(id);
        throw new EsperaExpirada(
          p.sim === null
            ? `timeout esperando: ${desc} (último valor: ${JSON.stringify(last)})`
            : `timeout esperando: ${desc} (el mundo avanzó los ${p.sim} s de simulación pedidos, en ` +
              `${(paredMs / 1000).toFixed(1)} s de pared, y no ocurrió; último valor: ${JSON.stringify(last)})`,
          id,
          last,
          { muestras, rotos },
        );
      })();
      esperas.enlaza(id, posada);
      return posada;
    },
  };
}
