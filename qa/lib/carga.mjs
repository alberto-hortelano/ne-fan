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
 *  que no estaba roto. Con ×20 la razón medida es 0,165, así que el margen
 *  sobra por donde importa. */
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

/** El nombre del pote donde la sonda deja su cuenta, dentro de la página. */
export const POTE = "__qaCarga";

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
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      `NEFAN_QA_CPU_FACTOR=«${raw}» no es un factor de frenado: se espera un número ≥ 1 ` +
        `(1 = sin frenar, que es el control). Se para aquí en vez de medir una corrida ` +
        `tranquila y presentarla como corrida bajo carga.`,
    );
  }
  return n;
}

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
  if (razon > umbral) {
    return {
      medido: true,
      real: false,
      razon,
      motivo:
        `razón sim/pared ${razon.toFixed(3)} > umbral ${umbral}: con factor ×${factor} el mundo avanzó ` +
        `al ritmo del reloj, así que NO se ha reproducido ninguna carga. Un veredicto de esta corrida ` +
        `no dice nada del defecto — sube el factor`,
    };
  }
  return {
    medido: true,
    real: true,
    razon,
    motivo:
      `razón sim/pared ${razon.toFixed(3)} ≤ umbral ${umbral}: con factor ×${factor} el mundo avanzó ` +
      `${((1 - razon) * 100).toFixed(0)} % menos de lo que marcó el reloj de pared`,
  };
}

/** Una línea legible de una medida, para el log de la corrida. */
export function lineaDeMedida(m, factor) {
  if (!m) return `⏱ sin medida de carga (factor ×${factor})`;
  const razon = razonDeLaMedida(m);
  const fps = m.paredMs > 0 ? (m.frames * 1000) / m.paredMs : 0;
  return (
    `⏱ ×${factor} · razón sim/pared ${razon === null ? "—" : razon.toFixed(3)} · ` +
    `${fps.toFixed(1)} fps · frame más largo ${Math.round(m.deltaMaxMs)} ms · ` +
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

/** Qué le pasó a cada guion entre la corrida quieta y la corrida bajo carga.
 *
 *  `cambio` tiene CUATRO valores y ninguno es un adorno:
 *   · `igual` — el mismo color en las dos.
 *   · `se-rompio` — verde quieto, rojo bajo carga: **el rojo reproducido**, que
 *     es el entregable de #545.
 *   · `se-arreglo` — rojo quieto, verde bajo carga. No es un éxito: es un aviso
 *     de que ese rojo no era carga (o de que la carga tapó otra cosa), y por eso
 *     tiene nombre propio en vez de contarse como «cambió».
 *   · `no-comparable` — falta en una de las dos, o alguna no llegó a medir (⊘).
 *     Un guion que no midió no puede votar, y colapsarlo con «igual» fabricaría
 *     un verde. */
export function comparaCorridas(quieta, cargada) {
  const porNombre = (rs) => new Map((rs ?? []).map((r) => [r.nombre, r]));
  const q = porNombre(quieta);
  const c = porNombre(cargada);
  const nombres = [...new Set([...q.keys(), ...c.keys()])].sort();
  return nombres.map((nombre) => {
    const a = q.get(nombre);
    const b = c.get(nombre);
    const comparable = Boolean(a && b && a.estado !== "sin-medir" && b.estado !== "sin-medir");
    let cambio = "no-comparable";
    if (comparable) {
      if (a.estado === b.estado) cambio = "igual";
      else if (a.estado === "verde" && b.estado === "rojo") cambio = "se-rompio";
      else cambio = "se-arreglo";
    }
    return {
      nombre,
      quieto: a?.estado ?? null,
      cargado: b?.estado ?? null,
      cambio,
      fallosQuieto: a?.fallos ?? [],
      fallosCargado: b?.fallos ?? [],
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
export function veredictoDelReproductor({ juicios, comparacion }) {
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
  if (rotos.length) detalle.push(`ROJO REPRODUCIDO en: ${rotos.map((r) => r.nombre).join(", ")}`);
  if (incomparables.length) {
    detalle.push(
      `sin comparar (no midieron en una de las dos): ${incomparables.map((c) => c.nombre).join(", ")}`,
    );
  }
  if (arreglados.length) {
    detalle.push(
      `cambió al revés (rojo quieto → verde bajo carga) en: ${arreglados.map((r) => r.nombre).join(", ")} — ` +
        `eso NO es un éxito: ese rojo no era carga`,
    );
  }
  if (!comparacion.length) {
    // `--sin-quieto`: hay medida de carga pero NO hay con qué comparar el color.
    // Decir aquí «ningún guion cambió de color» sería la mentira barata: nadie
    // ha mirado si cambió.
    detalle.push("sin corrida de control: la carga está medida, pero NINGÚN color se ha comparado con nada");
  } else if (!rotos.length && !arreglados.length) {
    detalle.push("ningún guion cambió de color: la carga fue real y lo que se midió la aguantó");
  }
  return { exit: 0, titulo: "la carga fue REAL y está medida", detalle };
}
