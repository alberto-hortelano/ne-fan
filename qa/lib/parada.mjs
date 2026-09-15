/** LA PARADA DEL JUGADOR, CONTADA POR EL RELOJ DEL MUNDO (#545).
 *
 *  ## Qué se rompía
 *
 *  «El jugador empuja contra algo y deja de avanzar» se leía muestreando
 *  `state().pos` cada 150 ms de RELOJ DE PARED (la cadencia de `waitFor`,
 *  `qa/lib/sonda.mjs`) y declarando parada cuando tres muestras seguidas se
 *  movían menos de 2 cm. Bajo carga eso lee paradas que no existen: entre dos
 *  sondeos puede no haber corrido ni un frame, y entonces la posición es la
 *  misma **porque el mundo no se ha simulado**, no porque el jugador se haya
 *  parado. Con el `delta` del loop topado en 0,1 s (`nefan-html/src/main.ts`),
 *  a 2,5 fps el mundo avanza 0,25 s por cada segundo de pared: tres sondeos
 *  caben de sobra dentro de un solo frame.
 *
 *  Es literalmente el título de #545, y el sitio exacto que el issue manda
 *  investigar (`guiones/91-…`, la pared de la forja).
 *
 *  ## Qué se hace aquí
 *
 *  **Una muestra solo cuenta si el MUNDO ha corrido.** El predicado lee
 *  `window.__nefan.reloj().sim` y no cuenta muestra hasta que han pasado `paso`
 *  segundos de SIMULACIÓN desde la anterior; el presupuesto de la espera se
 *  escribe `{sim: N}`, así que quien decide la expiración es el reloj del mundo
 *  y el cortafuegos de pared solo puede declarar ⊘ (ver `qa/lib/sonda.mjs`).
 *
 *  Con eso **la parada falsa deja de poder escribirse**: sin frame no hay
 *  muestra, y sin muestras no hay parada. No es que se detecte mejor — es que
 *  el estado malo deja de ser expresable, que es lo que esta casa pide de un
 *  candado.
 *
 *  ## Lo que NO cambia, y es la mitad del trabajo
 *
 *  Ni el umbral (2 cm), ni cuántas muestras hacen una parada (3), ni contra qué
 *  se comparan, ni la puerta del arranque, ni lo que el guion afirma después.
 *  Lo único que cambia es **con qué reloj se espera** y **qué cuenta como
 *  muestra**. Los dos parámetros que traducen el reloj viejo al nuevo se
 *  derivan, no se eligen: `PASO_DE_SIM_S` es la cadencia de `waitFor` leída en
 *  segundos, o sea exactamente lo que el mundo corría entre dos sondeos en una
 *  máquina ociosa (razón sim/pared medida en reposo: 0,96-0,98).
 *
 *  ## Por qué un módulo y no cuatro copias
 *
 *  El patrón está escrito a mano en cuatro guiones y **cada uno lo escribió
 *  copiando al anterior**, con divergencias que nadie eligió (uno compara
 *  contra la última posición donde SE MOVIÓ, otro contra la muestra anterior;
 *  uno pide tres muestras, otro una). Mientras el molde esté suelto, el quinto
 *  nace igual de roto — es la misma historia de `qa/lib/combate.mjs`. Aquí hay
 *  un molde, con sus opciones declaradas y fail-loud, y una batería que lo
 *  ejerce sin navegador (`nefan-core/test/parada-de-qa.test.ts`).
 */

import { CADENCIA_MS } from "./sonda.mjs";

/** Cuántos segundos de MUNDO tienen que correr entre dos muestras.
 *
 *  Derivado, no elegido: es la cadencia de `waitFor` (150 ms) leída en
 *  segundos. En una máquina ociosa el mundo corre ~0,96 s por segundo de pared,
 *  así que ésta es la traducción literal de «una muestra cada 150 ms» al reloj
 *  bueno — mismo ritmo de muestreo, otro reloj. Si `CADENCIA_MS` cambiara, esto
 *  cambia con él: dos definiciones del mismo ritmo es como nació el defecto. */
export const PASO_DE_SIM_S = CADENCIA_MS / 1000;

/** Las opciones que este molde entiende, o LANZA.
 *
 *  Misma puerta que `qa/lib/combate.mjs`, por el mismo hallazgo (H-3 de QA en
 *  PR-4a): una clave desconocida se desestructura en silencio y el helper se
 *  queda con su defecto, así que un `umbralM` mal escrito mediría 2 cm creyendo
 *  medir otra cosa y nadie se enteraría. */
const OPCIONES = [
  "slot",
  "paso",
  "muestras",
  "umbral",
  "eje",
  "referencia",
  "destino",
  "arranque",
  "dentroDe",
];

/** Monta el `arg` del predicado, con sus defectos y su fail-loud.
 *
 *  · `slot`        dónde recuerda el predicado su estado dentro de la página.
 *  · `paso`        segundos de SIM entre muestras (defecto `PASO_DE_SIM_S`).
 *  · `muestras`    cuántas quietas seguidas hacen una parada.
 *  · `umbral`      metros que cuentan como haberse movido.
 *  · `eje`         `null` = distancia euclídea; `"x"`/`"z"` = solo ese eje.
 *  · `referencia`  contra qué se compara cada muestra: `"desde-que-se-movio"`
 *                  (la última posición donde el jugador SÍ se movió) o
 *                  `"muestra-anterior"`. Son dos cosas distintas y las dos
 *                  están escritas hoy en la batería; colapsarlas cambiaría lo
 *                  que un guion mide, que es justo lo que esta tanda no hace.
 *  · `destino`     `{x, z}`: si se da, el predicado RE-ENCARA al jugador en
 *                  cada sondeo (el deslizamiento por ejes lo desvía en cuanto
 *                  roza algo, y es lo que hace quien juega).
 *  · `arranque`    metros que el jugador tiene que haberse alejado del punto de
 *                  partida antes de que se pueda declarar parada; `null` = sin
 *                  puerta. Sin ella, un jugador ya parado contra otra cosa
 *                  cumpliría «no avanza» sin haber medido nada.
 *  · `dentroDe`    `null` o `{eje, de, holgura}`: no se declara parada mientras
 *                  `de - pos[eje] >= holgura`. Es la banda del muro de frontera
 *                  de los guiones 86 y 109. */
export function paradaEnSim(opciones = {}) {
  if (opciones === null || typeof opciones !== "object" || Array.isArray(opciones)) {
    throw new Error(
      `paradaEnSim: las opciones son un OBJETO (\`{ ${OPCIONES.join(", ")} }\`) y llegó ` +
        `${JSON.stringify(opciones)}.`,
    );
  }
  const desconocidas = Object.keys(opciones).filter((k) => !OPCIONES.includes(k));
  if (desconocidas.length) {
    throw new Error(
      `paradaEnSim: opción(es) que no existen: ${desconocidas.map((k) => `\`${k}\``).join(", ")}. ` +
        `Las que hay son ${OPCIONES.map((k) => `\`${k}\``).join(", ")}. Ojo con los presupuestos en ` +
        `milisegundos: aquí no hay ninguno — la parada se cuenta en SEGUNDOS DE MUNDO (#545).`,
    );
  }
  const {
    slot,
    paso = PASO_DE_SIM_S,
    muestras = 3,
    umbral = 0.02,
    eje = null,
    referencia = "desde-que-se-movio",
    destino = null,
    arranque = null,
    dentroDe = null,
  } = opciones;
  if (typeof slot !== "string" || !slot.startsWith("__")) {
    throw new Error(
      `paradaEnSim: \`slot\` es el nombre de la ranura de la página donde el predicado recuerda su ` +
        `estado y empieza por \`__\` (p. ej. \`"__qa91"\`); llegó ${JSON.stringify(slot)}.`,
    );
  }
  if (!Number.isFinite(paso) || paso <= 0) {
    throw new Error(`paradaEnSim: \`paso\` son SEGUNDOS DE MUNDO > 0 y llegó ${JSON.stringify(paso)}.`);
  }
  if (!Number.isInteger(muestras) || muestras < 1) {
    throw new Error(`paradaEnSim: \`muestras\` es un entero ≥ 1 y llegó ${JSON.stringify(muestras)}.`);
  }
  if (!Number.isFinite(umbral) || umbral < 0) {
    throw new Error(`paradaEnSim: \`umbral\` son METROS ≥ 0 y llegó ${JSON.stringify(umbral)}.`);
  }
  if (eje !== null && eje !== "x" && eje !== "z") {
    throw new Error(`paradaEnSim: \`eje\` es null, "x" o "z" y llegó ${JSON.stringify(eje)}.`);
  }
  if (referencia !== "desde-que-se-movio" && referencia !== "muestra-anterior") {
    throw new Error(
      `paradaEnSim: \`referencia\` es "desde-que-se-movio" o "muestra-anterior" y llegó ` +
        `${JSON.stringify(referencia)}.`,
    );
  }
  return { slot, paso, muestras, umbral, eje, referencia, destino, arranque, dentroDe };
}

/** Borra la ranura de la página: cada empujón empieza de cero.
 *
 *  Va aparte y no dentro del predicado porque el predicado no puede saber si
 *  esta llamada es la primera de una espera nueva o la enésima de la de antes —
 *  y un molde que se reinicia solo cada vez no contaría nunca dos muestras. */
export async function limpiaLaParada(ctx, arg) {
  await ctx.page.evaluate((s) => {
    delete window[s];
  }, arg.slot);
}

/** EL PREDICADO, que corre DENTRO DE LA PÁGINA.
 *
 *  Se pasa tal cual a `ctx.waitFor` / `ctx.holdUntil` con el `arg` de
 *  `paradaEnSim`, así que no puede capturar nada de este módulo: todo lo que
 *  necesita viaja en `a`.
 *
 *  Devuelve `null` mientras no haya parada y `{x, z, arranco, muestras,
 *  saltadas, sim}` cuando la hay. `saltadas` son los sondeos que NO contaron
 *  porque el mundo no había corrido `paso` segundos — o sea, exactamente las
 *  muestras falsas que la versión de pared se habría apuntado. Es el número que
 *  dice si este arreglo hizo algo, y por eso se devuelve y se registra. */
export function elJugadorSePara(a) {
  const nefan = window.__nefan;
  const p = nefan.state().pos;

  // Re-encarar en cada muestra, dentro de la página: el deslizamiento por ejes
  // desvía al jugador en cuanto roza algo, y sin corregir el rumbo acaba en el
  // borde del tile en vez de contra lo que se mide. Es lo que hace quien juega.
  if (a.destino) nefan.setYaw(Math.atan2(a.destino.x - p.x, a.destino.z - p.z));

  const w = (window[a.slot] ??= {
    base: { x: p.x, z: p.z },
    ult: null,
    sim: null,
    quietas: 0,
    muestras: 0,
    saltadas: 0,
    arranco: false,
  });

  // LA PUERTA DEL ARRANQUE. Que el jugador ANDE es parte de la condición: si no,
  // uno ya parado contra otra cosa cumpliría «no avanza» sin haber medido nada.
  if (Math.hypot(p.x - w.base.x, p.z - w.base.z) > (a.arranque ?? 0)) w.arranco = true;
  if (a.arranque !== null && !w.arranco) return null;

  // LA BANDA en la que la parada significa algo (el muro de la frontera).
  if (a.dentroDe && a.dentroDe.de - p[a.dentroDe.eje] >= a.dentroDe.holgura) return null;

  // EL RELOJ DEL MUNDO. Sin él no hay muestra que contar; y no hace falta
  // declarar nada aquí, porque con presupuesto `{sim}` la sonda ya se niega a
  // medir contra un cliente que no lo publica (`qa/lib/sonda.mjs`) y lo dice
  // con su ⊘ antes del primer sondeo.
  const reloj = typeof nefan.reloj === "function" ? nefan.reloj() : null;
  const sim = reloj !== null && typeof reloj === "object" && Number.isFinite(reloj.sim) ? reloj.sim : null;
  if (sim === null) {
    w.saltadas++;
    return null;
  }

  // La primera lectura es la BASE de la comparación, no una muestra.
  if (w.ult === null) {
    w.ult = { x: p.x, z: p.z };
    w.sim = sim;
    return null;
  }

  // ── AQUÍ MUERE LA PARADA FALSA ──────────────────────────────────────────
  // Si el mundo no ha corrido `paso` segundos desde la muestra anterior, esto
  // NO es una muestra: el jugador no se ha movido porque no ha habido frame.
  // Antes esta misma comparación se hacía cada 150 ms de PARED y se apuntaba
  // igual, que es toda la historia de #545.
  if (sim - w.sim < a.paso) {
    w.saltadas++;
    return null;
  }

  w.muestras++;
  w.sim = sim;
  const movio =
    a.eje === null ? Math.hypot(p.x - w.ult.x, p.z - w.ult.z) : Math.abs(p[a.eje] - w.ult[a.eje]);
  if (a.referencia === "muestra-anterior") w.ult = { x: p.x, z: p.z };
  if (movio > a.umbral) {
    // Se movió: la referencia vuelve a ser DONDE ESTÁ y la cuenta, a cero.
    w.ult = { x: p.x, z: p.z };
    w.quietas = 0;
    return null;
  }
  w.quietas++;
  return w.quietas >= a.muestras
    ? { x: p.x, z: p.z, arranco: w.arranco, muestras: w.muestras, saltadas: w.saltadas, sim }
    : null;
}

/** Lo que quedó apuntado en la ranura, para el diagnóstico del guion: haya o no
 *  haya habido parada, esto dice cuántas muestras contaron y cuántos sondeos se
 *  saltaron por no haber mundo. */
export async function loQueVioLaParada(ctx, arg) {
  return ctx.page.evaluate((s) => {
    const w = window[s];
    const p = window.__nefan.state().pos;
    return {
      x: p.x,
      z: p.z,
      arranco: w?.arranco ?? false,
      muestras: w?.muestras ?? 0,
      saltadas: w?.saltadas ?? 0,
      quietas: w?.quietas ?? 0,
    };
  }, arg.slot);
}
