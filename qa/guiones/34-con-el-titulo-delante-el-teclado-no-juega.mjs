/** Las NUEVE entradas de juego que #285 gatea, en el estado real y con su
 *  control; y las dos cosas que el aviso de #251 y la cota de #250 no pueden
 *  decir de sí mismas.
 *
 *  POR QUÉ EXISTE, teniendo el 29 y el 33 delante. Tres agujeros medidos por
 *  QA el 2026-08-28, cada uno con su motivo:
 *
 *  1 · **La batería entera corre con `?input=scripted`** (`run.mjs`), y ese id
 *      instala `ScriptedInputProvider`: `KeyboardInputProvider` **no se
 *      construye**, así que sus `keydown`/`mousedown` —WASD, las flechas,
 *      `1..N`, `E`, `R` y el clic de ataque— **no están registrados** en
 *      ninguno de los 32 guiones. De las nueve entradas que #285 gatea, la
 *      batería solo recorre `H` (guion 29, bloque 3). Este guion abre la
 *      página SIN `input=scripted` a propósito: el sujeto es el proveedor de
 *      teclado de verdad, que es el que usa quien juega.
 *
 *  2 · **El estado se alcanza por el selector «Room»**, sin tocar el borde.
 *      `#room-selector` vive dentro de `#dev-status` (`index.html`), fuera de
 *      `#game-ui` y a `z-index:10000`: se usa CON EL TÍTULO DELANTE y pinta un
 *      mundo detrás del overlay sin abrir sesión. Es el camino que el plan de
 *      esta tanda nombró como no cubierto, y es la forma más barata de tener
 *      «mundo detrás, título delante» sin retener ningún fichero.
 *
 *  3 · **El control es obligatorio.** Medir un no-evento da un verde
 *      indistinguible de un guion que no mide nada: si la tecla no responde
 *      porque no hay mundo, porque el bucle no corre o porque el provider ni
 *      existe, el aserto sale igual de verde. Por eso las nueve se pulsan dos
 *      veces —con el título delante y con el título cerrado por su BOTÓN— y lo
 *      que se afirma es la DIFERENCIA.
 *
 *  Y EL CONTROL SE MIDE POR TECLA (#320), que es la corrección de 2026-08-30.
 *  Comparar la posición de antes con la de después convertía a `w a s d` en dos
 *  pares OPUESTOS: el neto era un residuo del 1-15 % de lo que mueve una sola
 *  tecla (medido, 8 rondas: 0,0056–0,503 m contra 0,58–1,13 m por tecla), y una
 *  ronda pasó a 0,0006 m del umbral de `toFixed(2)`. De ahí la fama de guion
 *  intermitente. Pero lo peor no era la intermitencia: era que ese control
 *  pasaba VERDE con `s`, `a` y `d` MUERTAS —comprobado el 2026-08-30 borrándolas
 *  del provider—, o sea que no comprobaba «las cuatro teclas responden» sino
 *  «alguna pata quedó asimétrica». `lasNueveEntradas` ya pulsaba una tecla cada
 *  vez: ahora, en vez de tirar esa medida, devuelve el LIBRO por tecla. Una
 *  tecla muerta da su propia fila a 0,000 m, no puede cancelarse consigo misma,
 *  y el rojo la nombra.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { clonarSaves } from "../lib/saves.mjs";
import {
  alcanceDelCursor,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
  nuevaPartida,
} from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

const ESTRECHA = { width: 500, height: 480 };
const ANCHA = { width: 1280, height: 800 };

/** La fixture del bloque 1, NOMBRADA. Antes se cogía «la primera opción con
 *  valor», que hoy es esta por orden alfabético de etiqueta: una fixture nueva
 *  le cambiaba el sujeto sin avisar. Y el sujeto importa, porque una tecla
 *  bloqueada por colisión se lee igual que una muerta — los márgenes de abajo
 *  están medidos AQUÍ. */
const FIXTURE = "puerto_tile";

/** Las cuatro que mueven al jugador, y que el control mide UNA A UNA. */
const TECLAS_DE_MOVIMIENTO = ["w", "a", "s", "d"];

/** Cuánto tiene que mover una tecla viva para contar como viva, en metros.
 *  Medido sobre `puerto_tile` con teclado real: viva 0,58–1,13 m en los 3-5
 *  fotogramas que dura la pulsación; muerta, 0,000 m exacto. El umbral deja
 *  5,8× de margen por abajo y 100× por arriba del ruido de una tecla que no
 *  responde. */
const MUEVE_M = 0.1;

/** Y cuánto se tolera con el título delante: 0,001 m es 580 veces menos que lo
 *  que mueve la tecla más floja, y cinco veces menos de lo que sabe imprimir el
 *  `toFixed(2)` de `foto()`. */
const QUIETO_M = 0.001;

/** La huella que dejan en la línea del juego las teclas cuyo efecto dura UN
 *  frame (B cicla la vista, G pide el atlas, R revive). Sin esto tres de las
 *  nueve se medirían con los ojos cerrados: para cuando se lee el estado, ya
 *  se han consumido. */
const HUELLA_DE_TECLA = /^(B · fps|Respawned|Atlas fps|GENERANDO)/;

/** Todo lo que una tecla de juego puede mover, en una foto. Se toma dos veces
 *  —con el título delante y sin él— y lo que vale es la diferencia. */
function foto() {
  const i = window.__nefan.input;
  const libro = document.getElementById("history-browser");
  return {
    mov: [i.state.up, i.state.down, i.state.left, i.state.right, i.state.sprint].join(","),
    giro: [i.state.turnLeft, i.state.turnRight, i.state.turnUp, i.state.turnDown].join(","),
    pos: `${window.__nefan.playerPos.x.toFixed(2)},${window.__nefan.playerPos.z.toFixed(2)}`,
    ataque: i.state.selectedAttack,
    // Qué ataque DEBE quedar seleccionado si la tecla «5» llega: se lee del
    // catálogo de la sesión, no se escribe aquí. El control lo compara contra
    // `ataque`, que es un aserto absoluto — comparar antes/después degenera
    // cuando el bloque anterior ya lo dejó puesto (pasa justo cuando la puerta
    // está rota, o sea cuando más falta hace que el control valga).
    ataqueDeLaTecla5: i.attackKeys?.["5"] ?? null,
    atacando: i.state.attackRequested,
    interact: i.state.interact,
    respawn: i.respawnRequested,
    debugView: window.__nefan.fps()?.debugView ?? null,
    libroOculto: libro?.hidden ?? null,
    lineas: [...document.querySelectorAll("#combat-log > *")].map((e) => e.textContent ?? ""),
    frames: window.__nefan.fps()?.frames ?? 0,
  };
}

/** Espera a que el bucle de juego avance `n` fotogramas. Es la forma honesta
 *  de «ya ha dado tiempo»: esperar por reloj no es determinista —y lo prohíbe
 *  `qa-guiones-sin-espera-por-reloj`—, y un efecto de input se consume EN un
 *  frame, así que sin frames por medio el «no pasó nada» solo diría que se
 *  miró pronto. */
async function esperarUnosFrames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  // Los dos valores viajan EN el `arg`: el probe se serializa a texto, así que
  // una variable del cierre (`n`) no existe dentro de la página.
  return ctx.waitFor(
    `el bucle de juego avanza ${n} fotograma(s)`,
    (meta) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= meta.desde + meta.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** La posición del jugador en metros y SIN redondear. `foto().pos` la trae con
 *  `toFixed(2)`, que no sabe distinguir 0,004 m de cero: para decidir si una
 *  tecla respondió hace falta el número. */
function posDelJugador(ctx) {
  return ctx.page.evaluate(() => ({ x: window.__nefan.playerPos.x, z: window.__nefan.playerPos.z }));
}

/** Pulsa las nueve entradas de juego que #285 nombra y devuelve el LIBRO: qué
 *  movió cada una, por separado.
 *
 *  Teclado y ratón REALES (CDP), nunca `inputDriver`: el driver programático
 *  escribe en el provider por debajo de `window`, así que con él la puerta no
 *  está en el camino y el guion mediría el vacío.
 *
 *  El libro no mide nada que esto no midiera ya —las teclas siempre se han
 *  pulsado de una en una—: lo que cambia es que deja de tirarse. Comparar solo
 *  los extremos hacía que `w` y `s` se cancelaran, y `a` con `d` también: el
 *  neto era un residuo, y tres teclas muertas pasaban en verde (#320). */
async function lasNueveEntradas(ctx) {
  const k = ctx.page.keyboard;
  const libro = [];
  /** Ejerce UNA entrada y anota lo que movió al jugador. */
  const anota = async (tecla, ejercer) => {
    const antes = await posDelJugador(ctx);
    await ejercer();
    const despues = await posDelJugador(ctx);
    libro.push({
      tecla,
      deltaM: Math.hypot(despues.x - antes.x, despues.z - antes.z),
      desde: `${antes.x.toFixed(2)},${antes.z.toFixed(2)}`,
      hasta: `${despues.x.toFixed(2)},${despues.z.toFixed(2)}`,
    });
  };

  // Las mantenidas: se sueltan SIEMPRE (una `w` que se quede pulsada deja al
  // resto del guion andando solo).
  for (const tecla of [...TECLAS_DE_MOVIMIENTO, "Shift", "ArrowLeft", "ArrowUp"]) {
    await anota(tecla, async () => {
      await k.down(tecla);
      try {
        await esperarUnosFrames(ctx, 3);
      } finally {
        await k.up(tecla);
      }
    });
  }
  // Las de un golpe: catálogo de ataques, interactuar, respawn y las dos de
  // desarrollo (G pide el atlas —y ESA puede gastar—, B cicla la vista).
  for (const tecla of ["1", "2", "3", "4", "5", "e", "r", "g", "b", "h"]) {
    await anota(tecla, async () => {
      await k.press(tecla);
      await esperarUnosFrames(ctx, 3);
    });
  }
  // Y el clic de ataque, que es la novena.
  const centro = await ctx.page.evaluate(() => ({
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight * 0.75),
  }));
  await anota("LMB", async () => {
    await ctx.page.mouse.move(centro.x, centro.y);
    await ctx.page.mouse.down();
    try {
      await esperarUnosFrames(ctx, 3);
    } finally {
      await ctx.page.mouse.up();
    }
    await esperarUnosFrames(ctx, 8);
  });
  return libro;
}

/** El libro en una línea, para que toda corrida publique la evidencia por
 *  tecla y no solo el veredicto. */
function enUnaLinea(libro) {
  return libro.map((e) => `${e.tecla} ${e.deltaM.toFixed(3)}`).join(" · ");
}

/** Qué cambió entre dos fotos, sin contar los fotogramas (que cambian siempre)
 *  ni las líneas del juego, que se comparan aparte por su HUELLA: en la línea
 *  del juego escribe también lo asíncrono (skins, atlas), y compararla entera
 *  haría intermitente al guion. */
function loQueSeMovio(antes, despues) {
  const campos = Object.keys(antes).filter(
    (k) => k !== "frames" && k !== "lineas" && antes[k] !== despues[k],
  );
  const nuevas = despues.lineas.slice(0, Math.max(0, despues.lineas.length - antes.lineas.length));
  const deTecla = nuevas.filter((l) => HUELLA_DE_TECLA.test(l.trim()));
  return { campos, nuevas, deTecla };
}

export default async function (ctx) {
  // ── 0 · El proveedor de teclado REAL ────────────────────────────────────
  // `run.mjs` abre todos los guiones con `?input=scripted`, y con ese id
  // `KeyboardInputProvider` ni se construye. La URL se DERIVA de la que el
  // runner ya abrió (hereda `?ai=`, `?offset=`, `?raf=`): este fichero no se
  // sabe ningún puerto, que además lo prohíbe `nadie-inventa-un-puerto`.
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.setViewportSize(ANCHA);
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO, no con el de bench (si no, no hay puerta que probar)",
    await ctx.page.evaluate(
      () => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver,
    ),
    url.toString(),
  );
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // ── 1 · #285: con el título delante, ninguna entrada de juego responde ───
  // El mundo se pinta por el camino del jugador: el selector «Room» del panel
  // de dev, que está POR ENCIMA del título (z-index 10000) y por eso se puede
  // usar con él delante. Nada se fuerza y nada se oculta.
  const opcion = await ctx.page.evaluate((f) => {
    const sel = document.getElementById("room-selector");
    const op = [...sel.options].find((o) => o.value.includes(f));
    return op ? { valor: op.value, etiqueta: op.text } : null;
  }, FIXTURE);
  ctx.expect(
    `el panel de dev ofrece «${FIXTURE}», que es la fixture donde están medidos los márgenes de este bloque`,
    Boolean(opcion),
    JSON.stringify(opcion),
  );
  // Y LA PRECONDICIÓN CORTA. Sin ella, la línea de abajo revienta con un
  // `TypeError` sobre `null` y el veredicto que se lee es ese, no el que
  // importa: una precondición perdida contada como un fallo de otra cosa es
  // exactamente lo que esta tanda vino a eliminar del 22. Los bloques 2 y 3 se
  // quedan sin correr a propósito — son medidas, y una corrida que perdió su
  // precondición no es el sitio donde leerlas.
  if (!opcion) {
    ctx.log(
      `⊘ sin «${FIXTURE}» en el selector no hay «mundo detrás del título» que medir: ` +
        `se paran también los bloques 2 (#250) y 3 (#251)`,
    );
    return;
  }
  await ctx.page.selectOption("#room-selector", opcion.valor);

  const conMundoDetras = await ctx.waitFor(
    "la fixture se pinta DETRÁS del título (mundo sí, sesión no)",
    () => {
      if (window.__nefan.tiles.length === 0) return null;
      if (document.documentElement.dataset.titulo !== "1") return null;
      return {
        tiles: window.__nefan.tiles,
        escena: window.__nefan.scene?.scene_id ?? null,
        npcs: (window.__nefan.npcs() ?? []).length,
        sesion: window.__nefan.sesion().sessionId,
        gameUiPx: Math.round(document.getElementById("game-ui").getBoundingClientRect().height),
      };
    },
    30_000,
  );
  ctx.log(`estado del issue #285: ${JSON.stringify(conMundoDetras)}`);
  // NO CONCLUYENTE ANTES QUE VERDE. Si no hubiera mundo detrás, las nueve
  // teclas «no harían nada» por no tener sobre qué, y el bloque entero sería
  // un verde vacío.
  ctx.expect(
    "hay un mundo pintado detrás y el título sigue delante (es el estado de #285)",
    conMundoDetras.tiles.length > 0 && conMundoDetras.npcs > 0 && conMundoDetras.gameUiPx === 0,
    JSON.stringify(conMundoDetras),
  );
  await ctx.shot("mundo-detras-del-titulo");

  const antes = await ctx.page.evaluate(foto);
  const libroConTitulo = await lasNueveEntradas(ctx);
  const despues = await ctx.page.evaluate(foto);
  const movido = loQueSeMovio(antes, despues);
  ctx.log(`con el título delante, tras las nueve entradas: ${JSON.stringify(movido)}`);
  ctx.log(`libro por tecla con el título delante (m): ${enUnaLinea(libroConTitulo)}`);
  ctx.expect(
    "el bucle de juego SÍ corrió mientras se pulsaba (si no, el «no pasó nada» no dice nada)",
    despues.frames > antes.frames,
    `${antes.frames} → ${despues.frames} fotogramas`,
  );
  ctx.expect(
    "con el título delante NINGUNA de las nueve entradas de juego responde (#285)",
    movido.campos.length === 0 && movido.deTecla.length === 0,
    `estado: ${movido.campos.map((k) => `${k} ${antes[k]}→${despues[k]}`).join(" · ")} · ` +
      `línea del juego: ${JSON.stringify(movido.deTecla)}`,
  );
  // Y ninguna mueve al jugador POR SÍ SOLA. El aserto de arriba compara la
  // posición redondeada a 2 decimales entre los extremos: dos teclas opuestas
  // que sí respondieran se cancelarían y saldría igual de verde.
  const andando = libroConTitulo.filter((e) => e.deltaM >= QUIETO_M);
  ctx.expect(
    "…y con el título delante ninguna entrada mueve al jugador ni un milímetro, medida una a una",
    andando.length === 0,
    andando.map((e) => `«${e.tecla}» ${e.deltaM.toFixed(3)} m (${e.desde} → ${e.hasta})`).join(" · "),
  );

  // ── 1b · EL CONTROL: cerrado el título por su botón, las mismas responden ─
  // Se cierra con un CLIC DE RATÓN REAL sobre `#ts-close`, no con
  // `__nefan.closeTitle()`: la puerta gatea también `mousedown`, y un cierre
  // por la puerta de atrás no probaría que el botón del título sigue vivo —
  // que es el riesgo que el plan de esta tanda nombró.
  //
  // Se pulsa el CENTRO del botón, que es donde apunta quien juega. Aquí hubo
  // que pulsar una rendija: hasta #310 el botón vivía en `top:12px`, dentro de
  // la banda que el título le reserva a `#dev-status`, y la barra —opaca, con
  // `z-index` 10000 sobre el título— le tapaba el centro. Ese comentario
  // sobrevivió al arreglo y describía un obstáculo que ya no existe: el click
  // seguía pasando, pero por una razón distinta de la que decía.
  //
  // El aserto es por tanto que el centro LLEGA, no que exista una rendija. Si
  // alguien vuelve a meter el botón bajo la barra, esto se pone rojo aquí y en
  // `qa/guiones/33-…`, que es donde vive el candado de la derivación.
  const donde = await alcanceDelCursor(ctx, "ts-close");
  ctx.log(`«✕ cerrar» frente a la barra de dev: ${JSON.stringify(donde)}`);
  ctx.expect(
    "el cursor llega al centro de «✕ cerrar»: la barra de dev no lo tapa (#310)",
    donde.loGolpea && !donde.solapaLaBarra,
    JSON.stringify(donde),
  );
  await ctx.page.mouse.click(donde.centro.x, donde.centro.y);
  await ctx.waitFor(
    "el título se cierra por su propio botón (la puerta no se ha tragado el clic)",
    () => (document.documentElement.dataset.titulo === "0" ? { titulo: "0" } : null),
    15_000,
  );

  const antesControl = await ctx.page.evaluate(foto);
  const libroControl = await lasNueveEntradas(ctx);
  const despuesControl = await ctx.page.evaluate(foto);
  const movidoControl = loQueSeMovio(antesControl, despuesControl);
  ctx.log(`control, sin título: ${JSON.stringify(movidoControl)}`);
  ctx.log(`libro por tecla sin título (m): ${enUnaLinea(libroControl)}`);
  // El control FUERTE: no basta con que «algo» cambie. Se exige que se muevan
  // las tres familias, que son tres registros de listener distintos —el
  // proveedor de teclado, las teclas de desarrollo y el libro—, y las tres
  // pasan por la misma puerta.
  //
  // El movimiento se mide POR TECLA, y ahí está el arreglo de #320: comparar la
  // posición de antes con la de después dejaba que `w` se cancelara con `s` y
  // `a` con `d`, así que el control pasaba en verde con tres de las cuatro
  // teclas MUERTAS (comprobado borrándolas del provider). Cada una tiene su
  // fila, ninguna puede cancelarse consigo misma y el rojo NOMBRA la que no
  // respondió.
  const porTecla = new Map(libroControl.map((e) => [e.tecla, e.deltaM]));
  const mudas = TECLAS_DE_MOVIMIENTO.filter((t) => !((porTecla.get(t) ?? 0) >= MUEVE_M));
  const movimiento = mudas.length === 0;
  const combate =
    Boolean(despuesControl.ataqueDeLaTecla5) &&
    despuesControl.ataque === despuesControl.ataqueDeLaTecla5;
  const dev =
    antesControl.debugView !== despuesControl.debugView ||
    movidoControl.deTecla.some((l) => /^B · fps/.test(l.trim()));
  ctx.expect(
    "CONTROL: cerrado el título, esas mismas entradas SÍ responden (LAS CUATRO de movimiento, ataque y teclas dev)",
    movimiento && combate && dev,
    `movimiento=${movimiento} (` +
      TECLAS_DE_MOVIMIENTO.map((t) => `${t} ${(porTecla.get(t) ?? 0).toFixed(3)} m`).join(" · ") +
      (mudas.length ? ` — NO RESPONDEN: ${mudas.map((t) => `«${t}»`).join(", ")}` : "") +
      `, mínimo exigido ${MUEVE_M} m) · ` +
      `ataque=${combate} (${antesControl.ataque}→${despuesControl.ataque}, la tecla 5 pide ${despuesControl.ataqueDeLaTecla5}) · dev=${dev} · ` +
      `cambiaron: ${movidoControl.campos.join(",")} · línea: ${JSON.stringify(movidoControl.deTecla)}`,
  );
  ctx.log(`el libro (H) sin título: oculto ${antesControl.libroOculto} → ${despuesControl.libroOculto}`);
  await ctx.shot("control-sin-titulo-el-teclado-juega");

  // ── 2 · La cota del panel de dev y el gasto en € (#250, efecto lateral) ──
  // `dev-ui.css` declara que este panel existe para VIGILAR EL GASTO. La cota
  // de `--dev-status-alto` lo deja en tres líneas envueltas a 500 px de ancho;
  // lo que ningún aserto de la tanda pregunta es si el gasto sigue leyéndose
  // en el instante en que el panel está gastando, que es cuando su línea de
  // generación crece y empuja al resto hacia abajo.
  //
  // Se mide con un observador DENTRO de la página (el instante dura lo que
  // tarde la llamada) y sobre una generación REAL: `aisla: ["fake-ai"]` deja
  // el motor falso sin superficies, así que la primera partida las pinta.
  await ctx.page.setViewportSize(ESTRECHA);
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await ctx.page.evaluate(() => {
    window.__qaGasto = [];
    const dev = document.getElementById("dev-status");
    const gen = document.getElementById("ds-gen");
    const gasto = document.getElementById("ds-spend");
    const anota = () => {
      const d = dev.getBoundingClientRect();
      const g = gasto.getBoundingClientRect();
      window.__qaGasto.push({
        gen: (gen.textContent ?? "").slice(0, 30),
        dentro: g.top >= d.top - 0.5 && g.bottom <= d.bottom + 0.5,
        alto: Math.round(d.height),
        natural: dev.scrollHeight,
      });
    };
    anota();
    new MutationObserver(anota).observe(dev, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });

  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const jugada = await comenzar(ctx);
  const generando = await ctx.waitFor(
    "el panel entra en «GENERANDO…» al pintar el atlas del primer tile",
    () => {
      const m = (window.__qaGasto ?? []).filter((x) => x.gen.startsWith("GENERANDO"));
      return m.length ? { muestras: m } : null;
    },
    120_000,
  );
  // NO CONCLUYENTE ANTES QUE VERDE: sin haber visto el estado de generación,
  // «el gasto se leía» solo diría que se miró en reposo.
  ctx.expect(
    "se ha observado al panel GENERANDO (si no, no se mide el instante que importa)",
    generando.muestras.length > 0,
    JSON.stringify(generando.muestras[0]),
  );
  const enReposo = await ctx.page.evaluate(() =>
    (window.__qaGasto ?? []).filter((x) => !x.gen.startsWith("GENERANDO")).pop(),
  );
  ctx.expect(
    "en reposo, el gasto en € se lee dentro de la barra acotada",
    Boolean(enReposo?.dentro),
    JSON.stringify(enReposo),
  );
  const ciegos = generando.muestras.filter((x) => !x.dentro);
  // HALLAZGO ABIERTO (QA 2026-08-28), por eso `log` y no `expect`: a 500 px de
  // ancho, mientras el panel dice «GENERANDO atlas…» —el aviso destacado que
  // precede a una llamada de pago— la línea del gasto cae FUERA de la cota y
  // hay que desplazar dentro del panel para verla. El arreglo es subir
  // `--dev-status-alto` (medido: con 110 px el guion 33 sigue verde y el botón
  // no se mueve). Cuando se suba, esta línea pasa a `ctx.expect`.
  ctx.log(
    ciegos.length
      ? `⚠ HALLAZGO ABIERTO: el gasto en € NO se lee mientras el panel genera ` +
          `(${ciegos.length}/${generando.muestras.length} muestras fuera de la cota) — ${JSON.stringify(ciegos[0])}`
      : `el gasto en € se lee también generando: ${JSON.stringify(generando.muestras[0])}`,
  );
  const fuera = await ctx.page.evaluate(() => {
    const dev = document.getElementById("dev-status");
    const d = dev.getBoundingClientRect();
    return [...dev.children]
      .map((el) => ({ id: el.id || el.className, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.height > 0 && x.r.bottom > d.bottom + 0.5)
      .map((x) => `${x.id} (${Math.round(x.r.top)}–${Math.round(x.r.bottom)} vs cota ${Math.round(d.bottom)})`);
  });
  ctx.log(`fuera de la cota del panel a ${ESTRECHA.width}px de ancho: ${JSON.stringify(fuera)}`);
  await ctx.shot("panel-de-dev-acotado");

  // ── 3 · #251: el aviso no puede nombrar un número que la pantalla desmiente ─
  // El aviso cuenta las tarjetas cuyo borde inferior cae fuera de la caja. El
  // scroller desborda también por el `margin-bottom` de la lista, así que hay
  // una banda de alturas —tan ancha como ese margen— en la que la columna
  // «desborda» sin que ninguna tarjeta quede fuera.
  const clones = clonarSaves(jugada.sessionId, 4);
  ctx.log(`sembradas ${clones.length + 1} partidas para medir el aviso`);
  await ctx.page.setViewportSize(ANCHA);
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await ctx.waitFor(
    "el título pinta las partidas guardadas",
    (n) => (document.querySelectorAll(".ts-save").length >= n ? { n } : null),
    30_000,
    clones.length + 1,
  );

  // La altura de ventana en la que el desborde es MENOR que el margen de la
  // lista: se despeja de la página, no se adivina.
  const objetivo = await ctx.page.evaluate(() => {
    const c = document.getElementById("title-screen").firstElementChild;
    const lista = document.getElementById("ts-sessions");
    const margen = Math.round(parseFloat(getComputedStyle(lista).marginBottom)) || 0;
    const fijo = window.innerHeight - c.clientHeight;
    return { alto: Math.round(c.scrollHeight + fijo - Math.max(2, Math.floor(margen / 2))), margen };
  });
  await ctx.page.setViewportSize({ width: ANCHA.width, height: objetivo.alto });
  const marginal = await ctx.waitFor(
    "la columna desborda por menos que el margen de la lista",
    () => {
      const c = document.getElementById("title-screen").firstElementChild;
      const delta = c.scrollHeight - c.clientHeight;
      if (delta <= 1) return null;
      const caja = c.getBoundingClientRect();
      const el = document.getElementById("ts-mas");
      return {
        delta,
        aviso: el?.hidden === false ? (el.textContent ?? "").trim() : null,
        tarjetasFuera: [...document.querySelectorAll(".ts-save")].filter(
          (f) => f.getBoundingClientRect().bottom > caja.bottom + 1,
        ).length,
      };
    },
    20_000,
  );
  ctx.log(`desborde marginal (margen de la lista ${objetivo.margen}px): ${JSON.stringify(marginal)}`);
  const dice = marginal.aviso ? Number((/hay (\d+) partida/.exec(marginal.aviso) ?? [])[1] ?? NaN) : null;
  // HALLAZGO ABIERTO (QA 2026-08-28), por eso `log` y no `expect`: en esa banda
  // el aviso se pinta diciendo «↓ hay 0 partidas más — desplaza la lista» con
  // todas las tarjetas a la vista. Medido a 1280×800 con CINCO partidas, que
  // es el viewport por defecto de la batería. El aserto del guion 33
  // (`/hay .* más/`) pasa sobre ese texto: no puede ver el número. Cuando el
  // aviso deje de aparecer sin tarjetas fuera, esta línea pasa a
  // `ctx.expect("…", dice === null || dice === marginal.tarjetasFuera)`.
  ctx.log(
    marginal.aviso && dice === 0
      ? `⚠ HALLAZGO ABIERTO: el aviso de #251 dice «${marginal.aviso}» con ` +
          `${marginal.tarjetasFuera} tarjetas fuera (alto ${objetivo.alto}px, desborde ${marginal.delta}px)`
      : `el aviso no miente en el desborde marginal: ${JSON.stringify({ aviso: marginal.aviso, dice, fuera: marginal.tarjetasFuera })}`,
  );
  await ctx.shot("aviso-en-el-desborde-marginal");

  // Lo que sí se puede afirmar hoy sin tocar nada: cuando el aviso NOMBRA un
  // número, ese número es el de tarjetas que de verdad quedan fuera. Es la
  // mitad del invariante que está bien, y se pone roja si alguien cambia la
  // cuenta por el total de partidas — que es la salida que proponía el issue.
  //
  // Se espera a que el aviso SE REESCRIBA tras el cambio de tamaño, no a que
  // diga lo que se quiere oír: el aviso lo recalcula un `ResizeObserver`, y
  // leerlo en el mismo tick devuelve el texto de la ventana anterior — una
  // lectura que daría una roja de la prueba y no del juego (medido: 0 → 4 en
  // ~200 ms). Si nunca se reescribiera, este `waitFor` expira, que también es
  // el veredicto correcto.
  await ctx.page.evaluate(() => {
    window.__qaAviso = 0;
    new MutationObserver(() => window.__qaAviso++).observe(document.getElementById("ts-mas"), {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  await ctx.page.setViewportSize({ width: ANCHA.width, height: 460 });
  const cortado = await ctx.waitFor(
    "con la ventana baja, el aviso se recalcula y nombra un número",
    () => {
      if ((window.__qaAviso ?? 0) === 0) return null;
      const el = document.getElementById("ts-mas");
      if (el?.hidden !== false) return null;
      const c = document.getElementById("title-screen").firstElementChild;
      const caja = c.getBoundingClientRect();
      return {
        texto: (el.textContent ?? "").trim(),
        fuera: [...document.querySelectorAll(".ts-save")].filter(
          (f) => f.getBoundingClientRect().bottom > caja.bottom + 1,
        ).length,
        total: document.querySelectorAll(".ts-save").length,
      };
    },
    20_000,
  );
  const nombrado = Number((/hay (\d+) partida/.exec(cortado.texto) ?? [])[1] ?? NaN);
  ctx.log(`aviso con la ventana baja: ${JSON.stringify(cortado)}`);
  ctx.expect(
    "el aviso cuenta las partidas que quedan FUERA, no las que hay (#251)",
    nombrado === cortado.fuera && nombrado !== cortado.total,
    `dice ${nombrado} · fuera ${cortado.fuera} · total ${cortado.total} — «${cortado.texto}»`,
  );

  // Se deja el viewport como lo encontró: el siguiente guion lee el defecto
  // del runner y no un residuo de este.
  await ctx.page.setViewportSize(ANCHA);
}
