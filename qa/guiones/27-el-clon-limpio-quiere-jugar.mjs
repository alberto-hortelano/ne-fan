/** Un clon limpio pulsa «Comenzar»: qué se le dice cuando no hay hojas (#255 p2).
 *
 *  El criterio de la tanda es que «un clon sin hojas se entera al arrancar».
 *  El guion 13 (bloque 4) mide ese enterarse en el REGISTRO de errores y lo
 *  mira con el título ya cerrado (`closeTitle`, el botón «✕ modo fixtures»).
 *  Eso deja fuera al jugador que hace lo único que se hace en esa pantalla:
 *  elegir un mundo y darle a empezar. Este guion recorre ESE camino.
 *
 *  Lo que pasa hoy, medido: `setPlayerAppearance` espera a `baseSheetsReady`,
 *  que en un clon rechaza; el fallo llega DESPUÉS de `session.enter`, así que
 *  `unIntentoDeArrancar` (main.ts) lo caza, abandona la partida y vuelve al
 *  título con `aviso`. El aviso lo redacta `motivoDeSesionParaElJugador`
 *  (nefan-core/src/protocol/status-labels.ts), que no reconoce «faltan 10 de
 *  10 hojas … HTTP 404 on /sprites/y_bot/…» y cae a su rama por defecto:
 *  «El servidor del juego no pudo completarlo; inténtalo de nuevo». El
 *  servidor no tiene nada que ver y reintentar no puede funcionar: la única
 *  línea que dice qué hacer («…docs/assets-de-personaje.md») va al error-log,
 *  que en el título está oculto por CSS (#246, dev-ui.css). Un fallo de
 *  ficheros que falta se disfraza de servidor con hipo — la misma familia de
 *  mentira que arregla esta tanda, un piso más arriba.
 *
 *  NACE ROJO (QA, 2026-08-25): los dos asertos del aviso son el hallazgo. El
 *  primero y el último SÍ están verdes hoy y son los que impiden que este
 *  fichero se vuelva un guion de una sola nota: que el juego no deje colgado
 *  al jugador, y que el registro lo sepa aunque no se lea.
 *
 *  EN NEGATIVO (2026-08-25):
 *  - sin el `route("**\/sprites\/**" → 404)` de la primera línea (o sea, con
 *    las hojas puestas) el desenlace medido es `{"arrancó":"tile_0_0"}` y se
 *    ponen rojos los dos asertos que HOY están verdes —«vuelve al título con
 *    un aviso» y «el cliente tiene escrito el remedio» (0 entradas,
 *    `#error-log display:block`)—: cuelgan del fallo, no del reloj ni de la
 *    pantalla.
 *  - los dos asertos del texto están rojos HOY: su capacidad de ponerse rojos
 *    no hay que demostrarla, hay que arreglarla.
 */
import { esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";
import { listarSaves } from "../lib/saves.mjs";

/** Puede disparar GENERACIÓN (escena del motor, página de atlas o skin): el
 *  runner ejerce el guardarraíl de cero créditos antes de lanzarlo y, contra
 *  un backend que no declare ser falso, este guion no corre (#295). Lo señaló
 *  el contador de rutas de pago del motor falso, no una lectura del código:
 *  `gasta` es «PUEDE gastar», no «gastó esta vez». */
export const gasta = true;

/** La entrada accionable que el cliente escribe en el registro (main.ts). */
const REMEDIO = "docs/assets-de-personaje.md";

export default async function (ctx) {
  // El estado del clon limpio, producido en el BORDE: `public/sprites/` está
  // en .gitignore (28 MB de renders de FBX que Adobe no deja redistribuir),
  // así que quien clona el repo arranca exactamente así. No se toca nada del
  // lado del juego.
  //
  // El 404 se contesta CUANDO EL MUNDO YA ESTÁ PINTADO, no al instante. No es
  // un adorno ni un sleep: es la única forma de que este guion mida la
  // CONJUNCIÓN de #279 en vez de solo su primera mitad. Medido el 2026-08-26
  // instrumentando `main.ts`: con el 404 instantáneo, `baseSheetsReady` ya está
  // rechazada cuando el jugador pulsa «Comenzar», así que el orden real es
  //   sesión → abandonar → sesión:(ninguna) → addTile(active=false)
  // y lo que impide el save es el reset de la faceta, no la conjunción —
  // disparar el ack solo con `mundoPintado()` dejaba el guion VERDE. Con el
  // 404 esperando al tile, el orden pasa a ser el del issue:
  //   sesión → addTile(active=true) → abandonar
  // que es el de cualquier máquina donde cargar 10 hojas tarde más que un
  // round-trip por WebSocket. La espera es por ESTADO (que el tile esté en el
  // mundo), con cortafuegos de deadlock.
  //
  // Y ESA ESPERA SE AFIRMA, que es lo que le faltaba a la primera versión de
  // este arreglo: si el cortafuegos saltaba, el `catch` se lo tragaba, el 404
  // salía igual y el guion seguía midiendo el orden DÉBIL sin decirlo — QA lo
  // reprodujo el 2026-08-26 poniendo el tope a 1 ms con la conjunción rota y
  // obtuvo `1/1 guiones en verde`. Un guion que depende de una precondición
  // que no afirma es exactamente la enfermedad que esta tanda vino a curar.
  // Ahora el corte se registra y se comprueba abajo: si el mundo no llegó a
  // tiempo, este guion se pone ROJO POR SU PRECONDICIÓN en vez de mentir por
  // omisión (`corte.sinMundo`), y si nunca se pidió una hoja (`peticiones`)
  // tampoco había clon limpio que medir.
  const corte = { peticiones: 0, conMundo: 0, sinMundo: 0 };
  await ctx.page.route("**/sprites/**", async (route) => {
    corte.peticiones++;
    const pintado = await ctx
      .waitFor("el mundo llega antes que el fallo de las hojas", () => window.__nefan?.tiles.length > 0, 60_000)
      .then(() => true)
      .catch(() => false);
    if (pintado) corte.conMundo++;
    else corte.sinMundo++;
    // El `catch` no es pereza: una petición que el navegador ya dio por muerta
    // (la recarga de abajo aborta las que estuvieran esperando) hace que
    // `fulfill` lance «Route is already handled», y una promesa suelta ahí mata
    // el RUNNER ENTERO con un uncaught rejection — se pierde el veredicto de
    // los otros 27 guiones. Mismo motivo escrito que en el guion 29.
    await route
      .fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "clon sin hojas (simulado por QA)" }),
      })
      .catch(() => null);
  });
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin hojas", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);

  // Lo que hay en `saves/` ANTES de intentarlo. Se mide el DELTA y no el
  // total porque este guion no aísla nada: corre sobre el disco que dejaron
  // los anteriores, y aislar añadiría otra corrida con stack propio a un
  // runner con los puertos clavados (#271, #274).
  const savesAntes = await listarSaves(ctx);
  ctx.log(`saves antes de intentarlo: ${savesAntes.ids.length} · fuente: ${savesAntes.fuente}`);

  // El camino del jugador, entero: Nueva partida → mundo → Comenzar.
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-start");

  // Se espera al DESENLACE, sea cual sea: o se está jugando, o el título
  // vuelve con su aviso. Un `waitFor` sobre uno solo de los dos convertiría
  // el otro desenlace en un timeout opaco.
  //
  // «Se está jugando» NO es «hay escena»: el tile del bridge llega ANTES de
  // que se resuelva la apariencia, así que durante unos ms hay escena y
  // título a la vez — medido, este guion nació dando por arrancada una
  // partida que un instante después volvía al título. El juego solo esconde
  // el título cuando todo el arranque salió bien (`unIntentoDeArrancar`,
  // main.ts), y eso es lo que publica `data-titulo`.
  const desenlace = await ctx
    .waitFor(
      "el juego resuelve el intento de empezar (se juega, o vuelta al título)",
      () => {
        const enElTitulo = document.documentElement.dataset.titulo === "1";
        const el = document.getElementById("ts-error");
        const texto = (el?.textContent ?? "").trim();
        if (enElTitulo && el && getComputedStyle(el).display !== "none" && texto) return { aviso: texto };
        const scene = window.__nefan.status().scene ? window.__nefan.scene.scene_id : null;
        return !enElTitulo && scene ? { arrancó: scene } : null;
      },
      60_000,
    )
    .catch(() => null);
  ctx.log(`desenlace: ${JSON.stringify(desenlace)}`);
  await ctx.shot("clon-limpio-pulsa-comenzar");

  ctx.expect(
    "sin hojas, «Comenzar» no deja al jugador colgado: vuelve al título con un aviso VISIBLE",
    Boolean(desenlace?.aviso),
    JSON.stringify(desenlace ?? "(ni escena ni aviso en 60 s)"),
  );

  const aviso = desenlace?.aviso ?? "";
  // El aviso es lo ÚNICO que se lee en esta pantalla: el error-log está
  // oculto mientras el título está delante (#246). Si aquí no está el motivo,
  // el jugador no tiene ninguno.
  ctx.expect(
    "…y ese aviso nombra lo que de verdad falta (las hojas del personaje, o dónde se generan)",
    /hoja|sprite|personaje|assets-de-personaje/i.test(aviso),
    aviso,
  );
  ctx.expect(
    "…y no le manda reintentar lo que no puede funcionar, ni culpa al servidor",
    aviso.length > 0 && !/inténtalo de nuevo|servidor del juego/i.test(aviso),
    aviso,
  );

  // El otro lado de la moneda, y el que hace que el hallazgo sea de
  // VISIBILIDAD y no de diagnóstico: el cliente SÍ sabe qué pasa y lo tiene
  // escrito; lo que no puede es enseñarlo en la pantalla donde ocurre.
  const registro = await ctx.page.evaluate((remedio) => {
    const panel = document.getElementById("error-log");
    const entradas = [...document.querySelectorAll(".error-log__entry .error-log__msg")].map(
      (e) => e.textContent ?? "",
    );
    return {
      display: panel ? getComputedStyle(panel).display : "(sin panel)",
      remedioEnElDom: entradas.some((m) => m.includes(remedio)),
      entradas: entradas.length,
    };
  }, REMEDIO);
  ctx.log(
    `registro: ${registro.entradas} entradas, remedio en el DOM: ${registro.remedioEnElDom}, ` +
      `#error-log display:${registro.display} (con el título delante — #246)`,
  );
  ctx.expect(
    "el cliente SÍ tiene escrito el remedio (aunque el título no lo deje ver)",
    registro.remedioEnElDom,
    JSON.stringify(registro),
  );

  // ── Y el arranque que falló NO deja partida (#279, criterio 1) ──────────
  // Aquí es donde vive el caso: el tile del bridge YA llegó (el bootstrap va
  // por delante de las hojas), y aun así no puede haber nacido nada, porque
  // la partida se escribe con la conjunción vestido ∧ mundo pintado y el
  // vestido no ocurrió. Se mide en el disco Y en lo que el título ofrece,
  // que son dos fallos distintos: un save huérfano y una tarjeta muerta.
  //
  // Pero PRIMERO se afirma la precondición, porque los dos asertos de abajo
  // solo significan lo que dicen si el orden fue el construido. Va antes que
  // ellos a propósito: quien lea el rojo tiene que ver el motivo arriba, no
  // deducirlo de dos verdes que no probaron nada.
  ctx.log(`corte de las hojas: ${JSON.stringify(corte)}`);
  ctx.expect(
    "PRECONDICIÓN — el mundo ya estaba pintado cuando falló el vestido (si no, esto no mide la conjunción)",
    corte.peticiones > 0 && corte.sinMundo === 0,
    corte.peticiones === 0
      ? "nadie pidió una hoja de personaje: no hubo clon limpio que medir"
      : `${corte.sinMundo} de ${corte.peticiones} corte(s) salieron SIN mundo pintado — ` +
        `el guion recorrió el orden débil y sus asertos no son concluyentes`,
  );

  const savesDespues = await listarSaves(ctx);
  const nuevos = savesDespues.ids.filter((id) => !savesAntes.ids.includes(id));
  ctx.log(`saves después: ${savesDespues.ids.length} · nuevos: ${JSON.stringify(nuevos)}`);
  ctx.expect(
    "un arranque que falla no deja NINGÚN directorio nuevo en saves/",
    nuevos.length === 0,
    `aparecieron ${JSON.stringify(nuevos)} (fuente: ${savesDespues.fuente})`,
  );

  // Se RECARGA antes de mirar «Continuar», y no es ceremonia: medido en la
  // prueba en negativo de esta tanda, el título de vuelta lista las partidas
  // ANTES de que el bootstrap termine, así que con el candado roto el save
  // nacía después y este aserto se quedaba verde igual. Un título recién
  // pintado pregunta de nuevo, y entonces sí puede ponerse rojo.
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve tras recargar", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  const ofrecidas = await ctx.page.$$eval(
    '#ts-sessions [data-action="resume"]',
    (els) => els.map((e) => e.dataset.sessionId),
  );
  ctx.log(`«Continuar» ofrece: ${JSON.stringify(ofrecidas)}`);
  ctx.expect(
    "…y «Continuar» no ofrece ninguna partida que no se llegó a jugar",
    ofrecidas.every((id) => savesAntes.ids.includes(id)),
    `${JSON.stringify(ofrecidas)} vs. antes ${JSON.stringify(savesAntes.ids)}`,
  );
}
