/** CARGA SINTÉTICA SOBRE LA PÁGINA DEL BENCH, Y LA MEDIDA QUE DEMUESTRA QUE ES REAL (#545).
 *
 *  Los 48 guiones que #545 señala están señalados **por inspección**: nadie ha
 *  visto ni uno de sus rojos. Un arreglo sobre eso no se puede juzgar —no hay
 *  contra qué—, así que lo primero que hacía falta no era arreglar nada sino
 *  poder **provocar el rojo a demanda**. Esto es la palanca.
 *
 *  ## Qué palanca, y por qué no la otra
 *
 *  La carga se mete con **`Emulation.setCPUThrottlingRate`** por CDP, que frena
 *  el hilo principal de **ese renderer y de nadie más**: no sube el load de la
 *  máquina, no le quita núcleos al que esté delante y es un **dial** (un número,
 *  reproducible), no un accidente.
 *
 *  **`NEFAN_QA_GPU=0` (SwiftShader) NO se usa, y queda escrito para que nadie lo
 *  reintente.** Está medido en `qa/lib/navegador.mjs:1-23`, en esta misma
 *  máquina: pone el `gpu-process` al **791 % de CPU** y el load average a **25
 *  sobre 16 hilos**. O sea, la forma de reproducir el defecto sería quitarle la
 *  máquina a los demás agentes — exactamente lo que esta tanda existe para no
 *  hacer. Además no es un dial: no tiene grados, y lo que frena es el pintado,
 *  no el hilo que corre el `gameLoop`. Sigue valiendo para lo que nació (imitar
 *  el runner de CI, descartar el driver ante una captura rara); como palanca de
 *  carga, no.
 *
 *  ## Qué se mide, y por qué esa magnitud y no «los fps»
 *
 *  El `gameLoop` del cliente avanza el mundo con `delta = min(Δpared, 0,1 s)`
 *  (`nefan-html/src/main.ts:566`). El tope es una protección buena —un frame de
 *  dos segundos no debe teletransportar a nadie—, pero tiene un corolario que
 *  es justo el defecto de #545: **cuando un frame tarda más de 100 ms, el mundo
 *  avanza MENOS tiempo del que pasa en el reloj de pared**. Un guion que
 *  presupuesta «0,5 m en 8 s de pared» presupone que esas dos escalas son la
 *  misma, y bajo carga dejan de serlo.
 *
 *  Así que la magnitud es la **razón sim/pared**: cuánto tiempo de simulación
 *  acumula la página por cada segundo de reloj. Vale ~1 con la máquina
 *  tranquila y baja en cuanto el frame pasa de 100 ms. Es la misma cuenta que
 *  hace el juego, con el mismo tope, sobre los mismos timestamps de rAF — la
 *  sonda se registra en `requestAnimationFrame` igual que el `gameLoop`, así
 *  que ve la MISMA secuencia de `now`.
 *
 *  «Los fps» no serviría: 12 fps con frames de 83 ms no roba ni un milisegundo
 *  de simulación (83 < 100), y 8 fps sí. El umbral no está en la tasa, está en
 *  el tope — y la razón lo lleva dentro.
 *
 *  **El tope está duplicado aquí a propósito, y tiene ancla**: `CLAMP_DEL_LOOP`
 *  vale lo que vale la constante de `main.ts`, y lo AFIRMA
 *  `nefan-core/test/carga-sintetica.test.ts` leyendo el fuente del cliente. Si
 *  alguien cambia el tope del juego y no éste, el test se pone rojo; sin ancla,
 *  la sonda seguiría midiendo en verde contra un tope que ya no existe.
 *
 *  ## Lo que esta sonda NO puede medir, dicho aquí
 *
 *  Con la pestaña OCULTA el cliente abandona rAF y sigue con `setTimeout` a ~15
 *  fps (`scheduleNextFrame`), mientras que Chrome congela el rAF de la sonda:
 *  las dos dejarían de ver la misma secuencia y la razón sería un invento. Por
 *  eso la sonda se entera de la ocultación (`visibilitychange`) y la medida sale
 *  marcada `oculta: true`, que el juicio trata como **no medido**, nunca como
 *  «no hubo carga».
 *
 *  Este módulo es el banco: `qa/` nunca entra en producción (regla
 *  `el-banco-no-entra-en-produccion`), y la dirección de la medida es test →
 *  banco (`test/qa-lib-tiene-quien-lo-mire.test.ts`).
 */

/** El tope del `delta` del game loop, en SEGUNDOS. Duplicado de
 *  `nefan-html/src/main.ts:566` y anclado por `test/carga-sintetica.test.ts`:
 *  no es una constante de este banco, es una LECTURA de la del juego. */
export const CLAMP_DEL_LOOP = 0.1;

/** Por debajo de esto la carga cuenta como REAL: la página perdió al menos un
 *  10 % del tiempo de simulación que le tocaba.
 *
 *  **Medido, no elegido a ojo.** Corrida de control del guion 91 en esta
 *  máquina el 2026-09-15: razón **0,981** sobre 23,3 s de pared, 28,7 fps, con
 *  un frame suelto de 313 ms. O sea, el bench NO corre con margen de sobra: ya
 *  pierde un 2 % de simulación sin que nadie lo frene, y el peor frame de una
 *  corrida tranquila triplica el tope. El umbral se pone en 0,90 y no en 0,95
 *  **a propósito, hacia el lado seguro**: el error caro de esta herramienta no
 *  es negarse a firmar una carga floja, es firmar como «carga reproducida» un
 *  hipo de la máquina — un rojo así se atribuiría a #545 y se «arreglaría» algo
 *  que no estaba roto. Margen por donde importa, con las razones MEDIDAS de
 *  verdad: ×8 → 0,774 · ×20 → 0,465-0,551 · ×40 → 0,152-0,309. Y por debajo
 *  todavía vota la cola (`COLA_MS`), que es donde vive el defecto. */
export const UMBRAL_DE_CARGA_REAL = 0.9;

/** Ventana mínima de reloj de pared para que una razón signifique algo.
 *
 *  Sale de un fallo medido el 2026-09-15: la corrida de CONTROL del guion 91
 *  dio razón 0,935 —por debajo del umbral, o sea «carga real» sin haber frenado
 *  nada— porque la sonda solo había visto **0,8 s**, y en esa ventana un único
 *  frame de 125 ms pesa el 6,5 %. Una ventana corta no da una razón mala: da
 *  una razón que no es una razón. Se dice como «no se pudo medir», que es lo
 *  que es, y no como «no hubo carga». */
export const PARED_MINIMA_MS = 3_000;

/** Un frame de al menos esto ya crea las condiciones del defecto, aunque la
 *  MEDIA no se haya movido. Hallazgo H-5 de QA, y es de los que cambian el
 *  instrumento, no la prosa.
 *
 *  La razón sim/pared es una media y **el defecto de #545 vive en la cola**.
 *  Medido por QA: a ×4 la corrida trae un frame de **1.150 ms** y la razón
 *  global se queda en 0,951 — el reproductor la rechazaba diciendo «no se ha
 *  reproducido nada», cuando ese frame solo se come **1.050 ms de simulación de
 *  un presupuesto de 4.000 ms** —el del tramo de `qa/lib/combate.mjs`, que con
 *  #545 pasó a `{sim: 4}` y ya no se mide con este reloj; el de los 28 guiones
 *  que presupuestan a mano, sí—, o sea el 26 %. Un
 *  frame así basta para tumbar un aserto y mueve la media 1,6 puntos.
 *
 *  1.000 ms = diez veces el tope. Elegido con margen sobre lo medido: el peor
 *  frame de una corrida de CONTROL en este árbol es de 237-342 ms en seis
 *  corridas (mías y de QA), así que el control sigue sin colarse. Y el número
 *  dice algo: un frame de un segundo se come **un cuarto** del presupuesto más
 *  repetido de la batería y un octavo del más apretado (8.000 ms para 0,5 m). */
export const COLA_MS = 1_000;

/** El nombre del pote donde la sonda deja su cuenta, dentro de la página. */
export const POTE = "__qaCarga";

/** Una opción numérica de línea de comandos, validada o LANZANDO.
 *
 *  Existe por el hallazgo H-2 de QA, que es el tercer «verde que no comprueba
 *  nada» de esta herramienta y el más barato de todos: `--umbral abc` daba
 *  `Number("abc") = NaN`, `razon > NaN` es siempre `false`, y **toda corrida
 *  pasaba por «carga real»** — incluida la de `--factor 1`, que es justo la que
 *  tiene que negarse. El factor sí era fail-loud desde el primer día; el umbral,
 *  que es la otra mitad del mismo juicio, no. Un umbral tampoco se imprime en
 *  ningún sitio donde se note, así que el informe que salga de ahí dirá «carga
 *  real» sin que nada lo contradiga.
 *
 *  Un solo validador para las cuatro opciones: cuatro `Number(...)` sueltos son
 *  cuatro sitios donde volver a olvidarse. */
export function opcionNumerica(nombre, raw, { min, max, entero = false, porDefecto }) {
  if (raw === undefined || raw === "") {
    if (porDefecto === undefined) throw new Error(`${nombre} necesita un valor`);
    return porDefecto;
  }
  const n = Number(raw);
  const mal =
    !Number.isFinite(n) ||
    n < min ||
    n > max ||
    (entero && !Number.isInteger(n));
  if (mal) {
    throw new Error(
      `${nombre}=«${raw}» no vale: se espera un número${entero ? " ENTERO" : ""} entre ${min} y ${max}. ` +
        `Se para aquí en vez de seguir con un NaN que haría pasar por buena cualquier medida.`,
    );
  }
  return n;
}

/** ¿Qué factor pide el entorno? `null` = corrida normal, sin carga.
 *
 *  Fail-loud con un valor que no se entiende: una variable mal escrita que se
 *  interpretara como «sin carga» daría una corrida tranquila presentada como
 *  corrida bajo carga, que es la mentira exacta que este módulo existe para no
 *  contar. Y `1` NO es un error —es el control, la corrida quieta con el mismo
 *  camino de código—, pero sí lo es un factor menor que 1: CDP no acelera nada,
 *  así que pedirlo es pedir algo que no puede ocurrir. */
export function factorDelEntorno(env) {
  const raw = env?.NEFAN_QA_CPU_FACTOR;
  if (raw === undefined || raw === "") return null;
  try {
    return opcionNumerica("NEFAN_QA_CPU_FACTOR", raw, { min: 1, max: FACTOR_MAXIMO });
  } catch (e) {
    throw new Error(
      `${e.message} No es un factor de frenado (1 = sin frenar, que es el control). Se para aquí en ` +
        `vez de medir una corrida tranquila y presentarla como corrida bajo carga.`,
    );
  }
}

/** Techo del dial. Hallazgo H-7 de QA: un `--factor 200` por el cero de más que
 *  todo el mundo teclea alguna vez es una tarde sin un solo aviso, sobre una
 *  máquina compartida. Medido: ×1 → 27 s · ×20 → 67-80 s · ×40 → 187-224 s, y el
 *  crecimiento no es lineal. 100 deja sitio de sobra por encima de ×40 —que es
 *  el régimen donde el rojo sale 5 de 6— y corta el dedazo. */
export const FACTOR_MAXIMO = 100;

/** La sonda que se instala en la página ANTES de que cargue nada.
 *
 *  Devuelve una función para `page.addInitScript`; el tope viaja como argumento
 *  porque dentro del navegador no hay módulos de este banco.
 *
 *  Acumula lo mismo que el `gameLoop` (`min(Δ, tope)`) sobre los timestamps de
 *  rAF, cuenta frames, se queda con el Δ más largo —que es lo que diagnostica
 *  el aliasing del muestreo de 150 ms— y anota si la pestaña llegó a ocultarse.
 *
 *  **Y SOBREVIVE A LAS NAVEGACIONES**, que no es un detalle: `addInitScript`
 *  corre otra vez en cada `goto` y en cada `reload`, y media batería recarga la
 *  página para reanudar la partida (`qa/lib/sesion.mjs:234,444`). Sin acumular,
 *  la medida de un guion con resume era la del ÚLTIMO tramo: medido el
 *  2026-09-15 sobre el guion 91, 0,8 s de los 27 que duró, con una razón de
 *  0,935 que no era carga sino un frame largo suelto sobre una ventana
 *  minúscula. El total se guarda en `sessionStorage`, que es lo único que
 *  atraviesa una navegación del mismo origen, y se vuelca en `pagehide` y cada
 *  60 frames (el `pagehide` de un reload duro puede no llegar). Si no hay
 *  almacén, la medida sale marcada `almacen: false` en vez de mentir por
 *  defecto. */
export function sondaDeReloj() {
  return (args) => {
    const [pote, tope] = args;
    let almacen = true;
    const previo = (() => {
      try {
        return JSON.parse(sessionStorage.getItem(pote) ?? "null");
      } catch {
        almacen = false;
        return null;
      }
    })();
    const w = {
      // Totales, ya con lo que traían las navegaciones anteriores.
      sim: previo?.sim ?? 0,
      frames: previo?.frames ?? 0,
      deltaMaxMs: previo?.deltaMaxMs ?? 0,
      // La COLA, que es donde vive el defecto: cuántos frames pasaron del tope
      // —o sea, cuántas veces el mundo se quedó atrás— y no solo el peor.
      sobreTope: previo?.sobreTope ?? 0,
      oculta: Boolean(previo?.oculta) || document.hidden === true,
      navegaciones: (previo?.navegaciones ?? 0) + 1,
      almacen: almacen && (previo?.almacen ?? true),
      // El reloj de pared de las navegaciones anteriores; el de ésta se cuenta
      // aparte porque `performance.now()` arranca de cero en cada una.
      paredBaseMs: previo?.paredMs ?? 0,
      t0: performance.now(),
    };
    window[pote] = w;
    const total = () => ({
      sim: w.sim,
      frames: w.frames,
      deltaMaxMs: w.deltaMaxMs,
      sobreTope: w.sobreTope,
      oculta: w.oculta,
      navegaciones: w.navegaciones,
      almacen: w.almacen,
      paredMs: w.paredBaseMs + (performance.now() - w.t0),
    });
    w.total = total;
    const guarda = () => {
      try {
        sessionStorage.setItem(pote, JSON.stringify(total()));
      } catch {
        w.almacen = false;
      }
    };
    addEventListener("visibilitychange", () => {
      if (document.hidden) w.oculta = true;
    });
    addEventListener("pagehide", guarda);
    let ult = w.t0;
    const tic = (now) => {
      const d = (now - ult) / 1000;
      ult = now;
      if (d > 0) {
        w.sim += Math.min(d, tope);
        w.frames++;
        if (d > tope) w.sobreTope++;
        if (d * 1000 > w.deltaMaxMs) w.deltaMaxMs = d * 1000;
        if (w.frames % 60 === 0) guarda();
      }
      requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
  };
}

/** Frena el hilo principal de ESTA página, y de ninguna otra.
 *
 *  `factor` 1 no es un no-op disfrazado: se manda igual, para que la corrida de
 *  control recorra exactamente el mismo camino (sesión CDP incluida) que la
 *  corrida frenada. Si el control se midiera por otro camino, la comparación
 *  entre las dos mediría también el camino. */
export async function aplicarCarga(page, factor) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: factor });
  return cdp;
}

/** Lo que la sonda tenga acumulado AHORA, más el reloj de pared transcurrido.
 *
 *  `null` si la sonda no está: es un hecho distinto de «no hubo carga» y quien
 *  juzga lo trata como no medido. */
export async function leerLaSonda(page, pote = POTE) {
  return await page.evaluate((p) => window[p]?.total() ?? null, pote);
}

/** La razón sim/pared de una medida, o `null` si no se puede calcular.
 *
 *  Sin pared no hay razón (división por cero) y sin frames tampoco dice nada:
 *  una página que no pintó ni una vez no ha demostrado estar frenada, ha
 *  demostrado estar muerta, y son diagnósticos distintos. */
export function razonDeLaMedida(m) {
  if (!m || !(m.paredMs > 0) || !(m.frames > 0)) return null;
  return (m.sim * 1000) / m.paredMs;
}

/** ¿La carga fue REAL? El juicio que impide que un reproductor que no reproduce
 *  se lea como prueba de que no hay defecto.
 *
 *  Tres desenlaces y ninguno se colapsa con otro:
 *   · `medido: false` — no se pudo mirar (sin sonda, sin frames, pestaña
 *     oculta). No dice nada del defecto, ni a favor ni en contra.
 *   · `real: false` — se miró y la razón NO bajó: esta corrida es tan tranquila
 *     como una normal, así que su verde no vale como «aguanta la carga».
 *   · `real: true` — el mundo avanzó menos de lo que marcó el reloj. */
export function juzgaLaCarga({ factor, medida, umbral = UMBRAL_DE_CARGA_REAL }) {
  if (!medida) {
    return { medido: false, real: false, razon: null, motivo: "la sonda de reloj no llegó a instalarse en la página" };
  }
  if (medida.oculta) {
    return {
      medido: false,
      real: false,
      razon: null,
      motivo:
        "la pestaña estuvo OCULTA: el cliente pasa a `setTimeout` y Chrome congela el rAF de la sonda, " +
        "así que las dos dejan de ver la misma secuencia de frames y la razón sería un invento",
    };
  }
  if (medida.paredMs < PARED_MINIMA_MS) {
    return {
      medido: false,
      real: false,
      razon: null,
      motivo:
        `la sonda solo vio ${Math.round(medida.paredMs)} ms de pared (mínimo ${PARED_MINIMA_MS}): en una ` +
        `ventana así un frame largo suelto ya mueve la razón varios puntos, así que no es una razón` +
        (medida.almacen === false
          ? " — y esta corrida no tuvo `sessionStorage`, así que solo midió el último tramo tras una navegación"
          : ""),
    };
  }
  const razon = razonDeLaMedida(medida);
  if (razon === null) {
    return {
      medido: false,
      real: false,
      razon: null,
      motivo: `la página no emitió ni un frame en ${Math.round(medida.paredMs)} ms: eso no es estar frenada, es estar muerta`,
    };
  }
  // DOS criterios, y el segundo no es un adorno: la razón es una MEDIA y el
  // defecto vive en la COLA (H-5). Un frame de 1.150 ms dentro de una corrida de
  // 66 s mueve la media 1,6 puntos y se come el 26 % de un presupuesto de
  // 4.000 ms. Se dice CUÁL de los dos disparó, porque no significan lo mismo:
  // la media es «el mundo entero va lento», la cola es «hubo parones».
  const porMedia = razon <= umbral;
  const porCola = medida.deltaMaxMs >= COLA_MS;
  if (!porMedia && !porCola) {
    return {
      medido: true,
      real: false,
      razon,
      por: null,
      motivo:
        `razón sim/pared ${razon.toFixed(3)} > umbral ${umbral} y el peor frame ` +
        `(${Math.round(medida.deltaMaxMs)} ms) no llega a ${COLA_MS}: con factor ×${factor} ni la media ` +
        `ni la cola se movieron, así que NO se ha reproducido ninguna carga. Un veredicto de esta ` +
        `corrida no dice nada del defecto — sube el factor`,
    };
  }
  const trozos = [];
  if (porMedia) {
    trozos.push(
      `la MEDIA: razón ${razon.toFixed(3)} ≤ ${umbral}, el mundo avanzó ${((1 - razon) * 100).toFixed(0)} % ` +
        `menos de lo que marcó el reloj`,
    );
  }
  if (porCola) {
    trozos.push(
      `la COLA: el peor frame duró ${Math.round(medida.deltaMaxMs)} ms (≥ ${COLA_MS}), y ` +
        `${medida.sobreTope ?? "?"} frame(s) pasaron del tope — un solo parón así se come un cuarto de ` +
        `un presupuesto de 4.000 ms`,
    );
  }
  return {
    medido: true,
    real: true,
    razon,
    por: porMedia && porCola ? "media+cola" : porMedia ? "media" : "cola",
    motivo: `con factor ×${factor} la carga es real por ${trozos.join(" · y por ")}`,
  };
}

/** ¿Vale como BASE la corrida de control?
 *
 *  Hallazgo H-8 de QA: el control se medía y no se juzgaba nunca, por decisión
 *  escrita («existe para salir con razón ≈ 1»). Hoy no muerde —QA lo comprobó a
 *  propósito: con la máquina a load 4,74 el control siguió en 0,981—, pero
 *  **toda la comparación de colores cuelga de él**, así que un control que
 *  hubiera corrido frenado entraría como base sin que nada lo dijera.
 *
 *  Se juzga por la MEDIA y no por la cola, y la asimetría es deliberada: la
 *  media dice «esta máquina va lenta», que invalida una base; un hipo suelto no
 *  la invalida, así que la cola larga en el control sale como AVISO y no mata la
 *  corrida. Un control que ya viene frenado no se puede arreglar bajando el
 *  listón: se vuelve a correr con la máquina tranquila. */
export function juzgaElControl({ medida, umbral = UMBRAL_DE_CARGA_REAL }) {
  if (!medida) return { vale: true, aviso: null, motivo: null };
  // La MISMA puerta que el juicio de la carga: una ventana corta no da una razón
  // mala, da una razón que no es una razón. Sin esto, el control del guion 80
  // —0,798 sobre 1,9 s, medido— tumbaría la corrida entera por «base frenada»
  // cuando lo único que pasa es que el guion dura dos segundos.
  if (medida.paredMs < PARED_MINIMA_MS) {
    return {
      vale: true,
      aviso:
        `el CONTROL solo vio ${Math.round(medida.paredMs)} ms de pared (mínimo ${PARED_MINIMA_MS}): su razón ` +
        `no es una razón, así que no se le puede exigir nada — la base se acepta sin juzgar`,
      motivo: null,
    };
  }
  const razon = razonDeLaMedida(medida);
  if (razon !== null && razon <= umbral) {
    return {
      vale: false,
      aviso: null,
      motivo:
        `la corrida de CONTROL ya venía frenada (razón ${razon.toFixed(3)} ≤ ${umbral}) sin que nadie la ` +
        `frenara: la máquina estaba ocupada. Toda la comparación de colores cuelga de esa base, así que ` +
        `no se compara nada — vuelve a correrlo con la máquina tranquila`,
    };
  }
  if (medida.deltaMaxMs >= COLA_MS) {
    return {
      vale: true,
      aviso:
        `el CONTROL trae un frame de ${Math.round(medida.deltaMaxMs)} ms (≥ ${COLA_MS}): la media aguanta, ` +
        `así que la base vale, pero ese parón ya crea las condiciones del defecto también sin frenar nada`,
      motivo: null,
    };
  }
  return { vale: true, aviso: null, motivo: null };
}

/** Una línea legible de una medida, para el log de la corrida. */
export function lineaDeMedida(m, factor) {
  if (!m) return `⏱ sin medida de carga (factor ×${factor})`;
  const razon = razonDeLaMedida(m);
  const fps = m.paredMs > 0 ? (m.frames * 1000) / m.paredMs : 0;
  return (
    `⏱ ×${factor} · razón sim/pared ${razon === null ? "—" : razon.toFixed(3)} · ` +
    `${fps.toFixed(1)} fps · frame más largo ${Math.round(m.deltaMaxMs)} ms · ` +
    `${m.sobreTope ?? "?"} sobre el tope · ` +
    `${m.sim.toFixed(1)} s de sim en ${(m.paredMs / 1000).toFixed(1)} s de pared` +
    // Una ventana corta imprime una razón que no es una razón (el control del
    // guion 80: 0,798 sobre 1,9 s). El juicio ya la rechaza; la LÍNEA también
    // tiene que decirlo, porque es lo que se lee y lo que se pega en un informe.
    (m.paredMs < PARED_MINIMA_MS ? " · VENTANA CORTA: esa razón no es una razón" : "") +
    (m.navegaciones > 1 ? ` (${m.navegaciones} navegaciones)` : "") +
    (m.almacen === false ? " · SIN sessionStorage: solo el último tramo" : "") +
    (m.oculta ? " · PESTAÑA OCULTA" : "")
  );
}

/** ¿Lleva este fallo la FIRMA de un presupuesto de reloj de pared?
 *
 *  Es la mitad honesta de lo que el reproductor puede decir sobre a QUIÉN
 *  pertenece un rojo, y nace del hallazgo H-4 de QA, que es el más grave de la
 *  vuelta: `node qa/bajo-carga.mjs 75 --factor 20` pone el 75 **rojo bajo carga**
 *  —y el reproductor imprimía «ROJO REPRODUCIDO», etiqueta definida en este
 *  mismo fichero como «el entregable de #545»— cuando el aserto que cae es un
 *  CONTADOR contaminado por la vida ambiental (`2 derivaciones (había 1) — la
 *  escena servida cambió en: npcs (barkeep: position)`), o sea familia
 *  **#496/#497**. El instrumento le estaba atribuyendo a #545 un rojo que no es
 *  suyo, y sobre esa atribución se iba a apoyar la PR siguiente.
 *
 *  Lo único que este banco puede mirar sin inventar nada es **el texto del
 *  fallo**, que es exactamente el primero de los tres controles que la crítica
 *  escribió. Las tres firmas son las tres bocas por las que una espera de reloj
 *  se convierte en fallo:
 *   · `no ocurrió en N ms` — `ctx.expectEspera` (`qa/run.mjs:1003`)
 *   · `timeout esperando:` — un `waitFor` que propagó (`qa/lib/sonda.mjs:128`)
 *   · `expiró a los N ms … y nadie la observó` — el libro de esperas
 *     (`qa/lib/esperas.mjs:268`)
 *
 *  **Y es un indicio POSITIVO, no una prueba, en ninguna de las dos
 *  direcciones.** Que haya firma no demuestra que el rojo sea de #545 (una
 *  espera puede expirar por veinte motivos); que no la haya no demuestra que sea
 *  de #496. Lo que sí hace es impedir el error caro: **sin firma, el veredicto
 *  no puede llamarlo el rojo de #545**. */
export function firmaDePresupuesto(fallos) {
  const FIRMAS = [/no ocurrió en \d+\s*ms/i, /timeout esperando/i, /expiró a los \d+\s*ms/i];
  return (fallos ?? []).some((f) => FIRMAS.some((re) => re.test(String(f))));
}

/** Qué le pasó a cada guion entre la corrida quieta y las corridas bajo carga.
 *
 *  Toma **todas** las corridas frenadas, no una: el defecto de #545 es
 *  PROBABILÍSTICO —medido en dos árboles: a ×20 el 91 sale rojo 4 de 8 veces y a
 *  ×40, 5 de 6— y un desenlace binario sobre una sola muestra es una impresión,
 *  no una medida (H-1). Por eso cada fila trae `rojas` de `corridas`.
 *
 *  `cambio` tiene CINCO valores y ninguno es un adorno:
 *   · `igual-verde` — verde quieto y verde en todas las frenadas.
 *   · `igual-rojo` — **rojo en las dos**: ya estaba roto sin carga, así que no ha
 *     aguantado nada y su rojo no es de la carga. Estaba colapsado con
 *     `igual-verde` y el veredicto decía «lo que se midió la aguantó» sobre un
 *     guion rojo (H-3).
 *   · `se-rompio` — verde quieto y rojo en al menos una frenada: **el rojo
 *     reproducido BAJO CARGA**. Y nada más: a quién pertenece ese rojo lo dice
 *     `firma`, no esta etiqueta (H-4).
 *   · `se-arreglo` — rojo quieto y verde en al menos una frenada. No es un
 *     éxito: es un aviso de que ese rojo no era carga.
 *   · `no-comparable` — falta en alguna, o alguna no llegó a medir (⊘). Un guion
 *     que no midió no puede votar, y colapsarlo con «igual» fabricaría un verde. */
export function comparaCorridas(quieta, cargadas) {
  // `cargadas` es SIEMPRE una lista de corridas (cada una, su lista de guiones).
  // Una corrida que no dejó medida entra como `undefined` y se queda: su guion
  // sale `no-comparable`, que es lo que es. Descartarla encogería la N y haría
  // de «1 de 1» lo que en realidad fue «1 de 2».
  const porNombre = (rs) => new Map((rs ?? []).map((r) => [r.nombre, r]));
  const q = porNombre(quieta);
  const cs = (cargadas ?? []).map(porNombre);
  const nombres = [...new Set([...q.keys(), ...cs.flatMap((m) => [...m.keys()])])].sort();
  return nombres.map((nombre) => {
    const a = q.get(nombre);
    const bs = cs.map((m) => m.get(nombre));
    const medido = (r) => Boolean(r && r.estado !== "sin-medir");
    const comparable = medido(a) && bs.length > 0 && bs.every(medido);
    const rojas = bs.filter((b) => b?.estado === "rojo").length;
    const fallosCargado = bs.flatMap((b) => b?.fallos ?? []);
    let cambio = "no-comparable";
    if (comparable) {
      if (a.estado === "verde") cambio = rojas > 0 ? "se-rompio" : "igual-verde";
      else cambio = rojas < bs.length ? "se-arreglo" : "igual-rojo";
    }
    return {
      nombre,
      quieto: a?.estado ?? null,
      cargado: bs[0]?.estado ?? null,
      cargados: bs.map((b) => b?.estado ?? null),
      rojas,
      corridas: bs.length,
      cambio,
      firma: cambio === "se-rompio" ? (firmaDePresupuesto(fallosCargado) ? "presupuesto" : "sin-firma") : null,
      fallosQuieto: a?.fallos ?? [],
      fallosCargado,
    };
  });
}

/** El veredicto del REPRODUCTOR, que no es el veredicto de los guiones.
 *
 *  Un reproductor que no reproduce se lee como prueba de que no hay defecto, y
 *  eso es peor que no tenerlo: por eso el desenlace bueno de esta herramienta no
 *  es «los guiones salieron verdes» sino «la carga fue real y se puede decir qué
 *  hizo». Salidas:
 *    0  la carga fue real en todas las corridas frenadas y hay comparación
 *    1  la carga NO fue real: nada reproducido (el caso de `--factor 1`)
 *    2  no se pudo medir */
export function veredictoDelReproductor({ juicios, comparacion, control }) {
  // La base primero: sin base buena no hay comparación que valga (H-8).
  if (control && !control.vale) {
    return { exit: 2, titulo: "LA BASE NO VALE", detalle: [control.motivo] };
  }
  const noMedidos = juicios.filter((j) => !j.medido);
  if (noMedidos.length) {
    return {
      exit: 2,
      titulo: `NO SE PUDO MEDIR la carga en ${noMedidos.length} de ${juicios.length} corrida(s)`,
      detalle: noMedidos.map((j) => j.motivo),
    };
  }
  const flojos = juicios.filter((j) => !j.real);
  if (flojos.length) {
    return {
      exit: 1,
      titulo: `LA CARGA NO FUE REAL en ${flojos.length} de ${juicios.length} corrida(s): no se ha reproducido nada`,
      detalle: flojos.map((j) => j.motivo),
    };
  }
  const rotos = comparacion.filter((c) => c.cambio === "se-rompio");
  const arreglados = comparacion.filter((c) => c.cambio === "se-arreglo");
  const yaRojos = comparacion.filter((c) => c.cambio === "igual-rojo");
  const incomparables = comparacion.filter((c) => c.cambio === "no-comparable");
  // «Cero rotos» sobre cero comparables no es «aguantó la carga»: es no haber
  // comparado nada. El mismo agujero que la sexta condición de `comparar`
  // (comparables > 0) existe para tapar, y por la misma razón: un veredicto
  // tranquilizador que se cumple sin mirar.
  if (comparacion.length && !comparacion.some((c) => c.cambio !== "no-comparable")) {
    return {
      exit: 2,
      titulo: `NO SE COMPARÓ NADA: los ${incomparables.length} guion(es) no midieron en alguna de las dos corridas`,
      detalle: incomparables.map((c) => `${c.nombre}: quieto=${c.quieto ?? "—"} · bajo carga=${c.cargado ?? "—"}`),
    };
  }
  const detalle = [];
  for (const r of rotos) {
    // NUNCA «el rojo de #545»: el reproductor no puede atribuir (H-4). Dice la
    // FRECUENCIA, que es el dato que #545 necesita para juzgar un arreglo, y
    // dice si el fallo lleva firma de presupuesto de reloj o no.
    detalle.push(
      `ROJO BAJO CARGA en ${r.nombre}: ${r.rojas} de ${r.corridas} corrida(s) frenada(s) ` +
        (r.firma === "presupuesto"
          ? "— el fallo lleva FIRMA de presupuesto de reloj (una espera expirada), que es COMPATIBLE con " +
            "#545 pero no lo prueba: mira el texto del aserto"
          : "— el fallo NO lleva firma de presupuesto de reloj, así que **no es atribuible a #545**: " +
            "puede ser un contador sobre un canal compartido (#496/#497, como el guion 75) o el " +
            "escenario dejando de ser determinista. Mira el texto del aserto antes de tocar una espera"),
    );
  }
  if (yaRojos.length) {
    detalle.push(
      `ya estaban ROJOS sin carga: ${yaRojos.map((c) => c.nombre).join(", ")} — no han aguantado nada, ` +
        `y su rojo no es de la carga`,
    );
  }
  if (incomparables.length) {
    detalle.push(
      `sin comparar (no midieron en una de las dos): ${incomparables.map((c) => c.nombre).join(", ")}`,
    );
  }
  if (arreglados.length) {
    detalle.push(
      `cambió al revés (rojo quieto → verde en alguna frenada) en: ${arreglados.map((r) => r.nombre).join(", ")} — ` +
        `eso NO es un éxito: ese rojo no era carga`,
    );
  }
  if (!comparacion.length) {
    // `--sin-quieto`: hay medida de carga pero NO hay con qué comparar el color.
    // Decir aquí «ningún guion cambió de color» sería la mentira barata: nadie
    // ha mirado si cambió.
    detalle.push("sin corrida de control: la carga está medida, pero NINGÚN color se ha comparado con nada");
  } else if (!rotos.length && !arreglados.length && !yaRojos.length) {
    // «Aguantó» es una afirmación FUERTE sobre un defecto probabilístico, y con
    // pocas muestras no se sostiene: medido, el 91 a ×20 sale rojo 1 de cada 5.
    // Así que se dice el número de muestras, siempre (H-1).
    const n = Math.max(...comparacion.map((c) => c.corridas));
    detalle.push(
      n >= 5
        ? `0 rojos en ${n} corridas frenadas de cada guion: con esa muestra, lo medido aguanta la carga`
        : `0 rojos en ${n} corrida(s) frenada(s) de cada guion — con ${n} muestra(s) eso NO es «aguanta»: ` +
          `el defecto de #545 es probabilístico (medido: el 91 a ×20 sale rojo 1 de cada 5). Sube ` +
          `\`--repeticiones\` o \`--factor\` antes de concluir nada`,
    );
  }
  return { exit: 0, titulo: "la carga fue REAL y está medida", detalle };
}
