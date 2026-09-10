/** Los estados del HOME que la batería no visitaba, escritos por QA al
 *  validar la PR 4 de #346 (el home sale de `title-screen.ts` a
 *  `ui/titulo/home.ts`).
 *
 *  El informe de esa PR declara tres de ellos cubiertos «por el verbatim y no
 *  por ejecución», y son exactamente aquellos en los que un movimiento se
 *  rompe sin que nadie lo vea: el 18, el 19 y el 52 conducen el home SIEMPRE
 *  con partidas en la lista, SIEMPRE por los botones Reanudar/Borrar y NUNCA
 *  por el badge de modo. O sea que las dos ramas de `sessions.length`, el
 *  estado «armado» de los badges y los DOS `catch` del home —el de
 *  `setRenderMode` y el de `listSessions`— no los pisaba nadie.
 *
 *  **A · el home VACÍO.** La rama `sessions.length === 0` no la ejerce ningún
 *  guion: todos siembran una partida antes de mirar. Es la primera pantalla
 *  que ve quien instala el juego.
 *
 *  **B · el ARMADO de los badges de modo, y su TTL.** El badge de escenarios
 *  es un botón de PAGO: encenderlo pone la partida en Imagen IA, que gasta
 *  créditos al entrar. Por eso encender pide dos clicks y el armado se
 *  desarma solo a los 5 s (`ARM_TTL_MS`). Lo que este bloque afirma no es que
 *  el texto cambie, sino que **el desarme OLVIDA de verdad**: pasados los 5 s
 *  el siguiente click vuelve a pedir confirmación en vez de gastar. Si el
 *  `setTimeout` restaurase el rótulo sin borrar la llave, la pantalla diría
 *  «Maqueta 3D» y el click siguiente encendería el gasto sin preguntar — un
 *  fallo invisible para cualquier aserto de texto.
 *
 *  **C · el armado NO sobrevive a un repintado.** Es la medida del ÚNICO
 *  cambio estructural que declara la PR 4: `modeArmed` pasó de campo de
 *  instancia a const de módulo, y lo que hace ese cambio equivalente es que
 *  `modeArmed.clear()` abre cada pintado del home. Aquí se comprueba por el
 *  camino del jugador (armar → «Nueva partida» → «Volver» → click), no
 *  leyendo el código: tras el repintado el badge vuelve a pedir confirmación.
 *  Un `clear()` que se pierda en un corte futuro convierte un mapa de módulo
 *  en memoria que sobrevive a la pantalla, y esa memoria autoriza un gasto.
 *
 *  **D · `set_render_mode` que FALLA.** El `catch` de `onModeBadge` repinta el
 *  home y escribe el motivo en `#ts-status`. No lo ejercía nadie. El fallo se
 *  inyecta EN EL BORDE, sin tocar una línea de cliente ni fabricar estado: al
 *  directorio del save se le quita el permiso de escritura (`0o500`, el mismo
 *  repro del guion 52), con lo que el bridge lee la partida y revienta al
 *  escribirla — lo que le pasa a cualquiera cuyo `saves/` esté en un volumen
 *  de solo lectura. Se afirma además que NO se persistió nada: el modo del
 *  disco sigue donde estaba.
 *
 *  **E · `listSessions` que REVIENTA.** El otro `catch` sin visitas. Mismo
 *  método: la carpeta de partidas se deja ilegible (`0o000`) y el almacén del
 *  bridge lanza. Se afirma que el título no se queda en «Cargando saves…»,
 *  que el motivo va TRADUCIDO (sin `./start.sh` ni jerga del transporte, que
 *  es lo que se leía antes de #306) y que «Nueva partida» sigue siendo una
 *  salida. Nota medida para quien lo intente por el otro camino: con
 *  `?bridge=` a un puerto muerto el TÍTULO NO SE PINTA (el cliente cae al
 *  visor de fixtures), así que ese camino no ejerce este `catch`.
 *
 *  Todo se hace sobre CLONES del save (`clonarSaves`), no sobre la partida
 *  jugada: un clon nunca es la sesión activa del bridge, así que
 *  `set_render_mode` toma siempre la rama de partida INACTIVA, que es la que
 *  el badge del título existe para ejercer. La partida real se deja intacta.
 *
 *  CERO CRÉDITOS: el preset es `e2e-sin-creditos` (motor falso) y la partida
 *  se abre en maqueta (`renderMode: vector`, `charMode: vector`). Encender
 *  Imagen IA en el badge escribe un campo del `state.json` de un CLON que
 *  nunca se reanuda: no dispara ninguna generación. Y se apaga al terminar.
 */
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { comenzar, esperarListaDeSaves, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { clonarSaves, dirDelSave, rutaDelSave } from "../lib/saves.mjs";

export const aisla = ["saves"];

const ARMADO = "¿Confirmar? Gastará créditos";
const MAQUETA = "🧱 Maqueta 3D";
const IMAGEN = "🎨 Imagen IA";

const badge = (id) => `button[data-mode-facet="scenes"][data-session-id="${id}"]`;

/** Lo que el home ENSEÑA ahora mismo, de un vistazo. */
const fotoDelHome = () => ({
  status: document.getElementById("ts-status")?.textContent?.trim() ?? "",
  sesiones: document.getElementById("ts-sessions")?.textContent?.trim() ?? "",
  tarjetas: document.querySelectorAll(".ts-save").length,
  nuevaPartida: {
    hay: Boolean(document.getElementById("ts-new")),
    texto: document.getElementById("ts-new")?.textContent ?? "",
    apagado: document.getElementById("ts-new")?.disabled ?? null,
  },
  errorVisible: (document.getElementById("ts-error")?.style.display ?? "") !== "none",
});

/** El estado VISIBLE de un badge de escenarios: su rótulo, los dos colores que
 *  el armado escribe inline y los COMPUTADOS, que son los que el jugador ve.
 *  Los dos hacen falta: el inline dice qué escribió el código y el computado
 *  dice con qué se pinta cuando el inline se borra. */
const fotoDelBadge = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    texto: el.textContent ?? "",
    borde: el.style.borderColor ?? "",
    color: el.style.color ?? "",
    apagado: el.disabled,
    pintado: { borde: cs.borderTopColor, color: cs.color },
  };
};

/** El modo de escenarios que hay EN DISCO para ese save. Es la única fuente
 *  que dice si se persistió algo: el rótulo del badge puede ir por detrás. */
function modoEnDisco(sessionId) {
  const f = rutaDelSave(sessionId);
  if (!f) return null;
  return JSON.parse(readFileSync(f, "utf-8")).world?.render_mode ?? null;
}

/** Pulsa un badge y espera a que la pantalla ACABE de reaccionar: o el rótulo
 *  del badge cambió, o `#ts-status` cambió (el repintado del catch). Nunca por
 *  reloj. */
async function pulsarBadge(ctx, sel, desc) {
  const antes = await ctx.page.evaluate(
    ([s]) => ({
      texto: document.querySelector(s)?.textContent ?? "",
      status: document.getElementById("ts-status")?.textContent ?? "",
    }),
    [sel],
  );
  await ctx.page.click(sel);
  return ctx.waitFor(
    desc,
    ([s, previo]) => {
      const el = document.querySelector(s);
      const status = document.getElementById("ts-status")?.textContent ?? "";
      const texto = el?.textContent ?? "";
      // Sin badge todavía = el home está a medio repintar: seguir esperando.
      if (!el) return null;
      if (texto === previo.texto && status === previo.status) return null;
      const cs = getComputedStyle(el);
      return {
        texto,
        status: status.trim(),
        borde: el instanceof HTMLElement ? el.style.borderColor : "",
        color: el instanceof HTMLElement ? el.style.color : "",
        pintado: { borde: cs.borderTopColor, color: cs.color },
      };
    },
    30_000,
    [sel, antes],
  );
}

export default async function (ctx) {
  // ── A · EL HOME VACÍO ────────────────────────────────────────────────────
  // `aisla: ["saves"]` deja el disco de partidas a cero: esto es exactamente
  // lo que ve quien abre el juego por primera vez.
  await recargarAlTitulo(ctx);
  const vacio = await ctx.page.evaluate(fotoDelHome);
  await ctx.shot("home-sin-ninguna-partida");
  ctx.log(`vacío → status: "${vacio.status}" · sesiones: "${vacio.sesiones}"`);

  ctx.expect(
    "sin ninguna partida, el título DICE que el bridge contestó y que hay cero",
    /^Bridge OK/.test(vacio.status) && /\b0 partidas guardadas/.test(vacio.status),
    vacio.status || "(#ts-status vacío)",
  );
  ctx.expect(
    "…y el hueco de la lista no se queda en blanco: dice que todavía no hay ninguna",
    /Ninguna partida todavía/i.test(vacio.sesiones) && vacio.tarjetas === 0,
    `"${vacio.sesiones}" · tarjetas=${vacio.tarjetas}`,
  );
  ctx.expect(
    "…y el jugador SÍ tiene por dónde empezar: «Nueva partida», encendido",
    vacio.nuevaPartida.hay && vacio.nuevaPartida.apagado === false &&
      /Nueva partida/.test(vacio.nuevaPartida.texto),
    JSON.stringify(vacio.nuevaPartida),
  );
  ctx.expect(
    "…y no se le enseña ningún aviso de error: no ha pasado nada malo",
    !vacio.errorVisible,
    `#ts-error visible: ${vacio.errorVisible}`,
  );

  // ── Siembra: una partida real en MAQUETA, y dos clones para los badges ───
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="vector"]');
  const { sessionId } = await comenzar(ctx);

  if (!dirDelSave(sessionId)) {
    ctx.sinMedir(
      "esta corrida no tiene disco efímero propio (stack adoptado): sin él no se pueden " +
        "clonar saves ni producir un EACCES real, y los badges de modo no se pueden medir",
    );
  }
  const [paraArmar, paraFallar] = clonarSaves(sessionId, 2);
  ctx.log(`saves: real=${sessionId} · armado=${paraArmar} · fallo=${paraFallar}`);

  await recargarAlTitulo(ctx);
  const conSaves = await ctx.page.evaluate(fotoDelHome);
  ctx.expect(
    "con partidas, la MISMA pantalla cuenta cuántas hay y pinta una tarjeta por cada una",
    /\b3 partidas guardadas/.test(conSaves.status) && conSaves.tarjetas === 3,
    `"${conSaves.status}" · tarjetas=${conSaves.tarjetas}`,
  );
  const badgeInicial = await ctx.page.evaluate(fotoDelBadge, badge(paraArmar));
  ctx.expect(
    "el save en maqueta trae su badge de escenarios, y es EL DE MAQUETA",
    modoEnDisco(paraArmar) === "vector" && badgeInicial?.texto === MAQUETA,
    `disco=${modoEnDisco(paraArmar)} · badge=${JSON.stringify(badgeInicial)}`,
  );

  // ── B · ARMAR, Y QUE EL TTL OLVIDE DE VERDAD ─────────────────────────────
  const armado = await pulsarBadge(ctx, badge(paraArmar), "el badge pide confirmación al encender");
  await ctx.shot("badge-armado");
  ctx.log(`badge armado → "${armado.texto}" (borde ${armado.borde})`);
  ctx.expect(
    "encender Imagen IA NO se hace de un click: el badge pide confirmar y AVISA del gasto",
    armado.texto === ARMADO && /créditos/i.test(armado.texto),
    armado.texto,
  );
  ctx.expect(
    "…y se ve que está armado sin leerlo: el badge cambia de color",
    armado.borde !== "" && armado.color !== "",
    `borde="${armado.borde}" color="${armado.color}"`,
  );
  ctx.expect(
    "…y todavía no se ha escrito nada: el save sigue en maqueta",
    modoEnDisco(paraArmar) === "vector",
    `render_mode en disco: ${modoEnDisco(paraArmar)}`,
  );

  // El TTL: a los 5 s el badge se desarma SOLO. Se espera al rótulo, no al
  // reloj (`ARM_TTL_MS` puede cambiar; lo que no puede cambiar es que vuelva).
  const desarmado = await ctx.waitFor(
    "el badge se desarma solo, sin que el jugador toque nada",
    ([s, rotulo]) => {
      const el = document.querySelector(s);
      if (!el || el.textContent !== rotulo) return null;
      const cs = getComputedStyle(el);
      return {
        texto: el.textContent,
        borde: el.style.borderColor,
        color: el.style.color,
        pintado: { borde: cs.borderTopColor, color: cs.color },
      };
    },
    15_000,
    [badge(paraArmar), MAQUETA],
  );
  ctx.expect(
    "…y la marca de armado (el ámbar de aviso) desaparece con él",
    desarmado.pintado.borde !== armado.pintado.borde &&
      desarmado.pintado.color !== armado.pintado.color,
    `armado ${JSON.stringify(armado.pintado)} → desarmado ${JSON.stringify(desarmado.pintado)}`,
  );

  // #549, y hasta el 2026-09-10 este bloque era un HALLAZGO MEDIDO SIN PONERLO
  // ROJO (QA de la PR 4 de #346): el desarme por TTL escribía
  // `btn.style.borderColor = ""` y `btn.style.color = ""`, y esas dos líneas no
  // restauran el color base sino que lo BORRAN — venía del atributo `style` del
  // propio botón (`BADGE_CSS`: `border:1px solid #3a3846;color:#a99`), así que
  // al quitar los longhands el badge se quedaba con el color heredado de su
  // fila y un borde de `currentColor`: ilegible entre sus vecinos grises hasta
  // el siguiente repintado. Arreglado guardando los dos valores base al armar,
  // el log pasa a ser el ASERTO que él mismo pedía.
  //
  // Lo que se compara es el badge desarmado contra un GEMELO intacto de otro
  // save, no contra literales: si mañana `BADGE_CSS` cambia de color, el aserto
  // sigue diciendo lo mismo —«un badge que se desarma solo se ve como los que
  // nadie tocó»— sin tener que actualizar ninguna cifra aquí.
  await ctx.shot("badge-tras-el-desarme-automatico");
  const gemelo = await ctx.page.evaluate(fotoDelBadge, badge(paraFallar));
  const igualQueSuVecino =
    desarmado.pintado.borde === gemelo.pintado.borde &&
    desarmado.pintado.color === gemelo.pintado.color;
  ctx.expect(
    "…y al desarmarse VUELVE a verse como sus vecinos: el TTL restaura el color base, no lo borra (#549)",
    igualQueSuVecino,
    `desarmado ${JSON.stringify(desarmado.pintado)} vs intacto ${JSON.stringify(gemelo.pintado)} ` +
      `(inline tras el TTL: borde="${desarmado.borde}" color="${desarmado.color}")`,
  );

  // LA AFIRMACIÓN QUE IMPORTA: el desarme OLVIDÓ. Si el `setTimeout` hubiera
  // repintado el rótulo sin borrar la llave, este click gastaría en vez de
  // preguntar, y ningún aserto de texto lo vería.
  const trasElTtl = await pulsarBadge(
    ctx, badge(paraArmar), "el badge reacciona al click de después del TTL",
  );
  ctx.expect(
    "pasado el TTL, el siguiente click vuelve a PREGUNTAR: el desarme olvidó la confirmación",
    trasElTtl.texto === ARMADO,
    `${trasElTtl.texto} — si dijera «${IMAGEN}», el gasto se habría encendido sin confirmar`,
  );
  ctx.expect(
    "…y sigue sin escribirse nada en el save",
    modoEnDisco(paraArmar) === "vector",
    `render_mode en disco: ${modoEnDisco(paraArmar)}`,
  );

  // ── C · EL ARMADO NO SOBREVIVE A UN REPINTADO DEL HOME ───────────────────
  // El badge está armado AHORA MISMO (viene del bloque de arriba). Se pasa por
  // el selector de mundos y se vuelve: eso repinta el home entero.
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await esperarListaDeSaves(ctx);
  const alVolver = await ctx.page.evaluate(fotoDelBadge, badge(paraArmar));
  ctx.expect(
    "al volver del selector, el badge se pinta otra vez desde el save y queda IGUAL que sus vecinos",
    alVolver?.texto === MAQUETA &&
      alVolver.pintado.borde === gemelo.pintado.borde &&
      alVolver.pintado.color === gemelo.pintado.color,
    `${JSON.stringify(alVolver?.pintado)} vs vecino ${JSON.stringify(gemelo.pintado)}`,
  );

  const trasRepintar = await pulsarBadge(
    ctx, badge(paraArmar), "el badge reacciona al primer click de después del repintado",
  );
  ctx.expect(
    "y el repintado OLVIDÓ el armado: el primer click vuelve a pedir confirmación",
    trasRepintar.texto === ARMADO,
    `${trasRepintar.texto} — si dijera «${IMAGEN}», el armado habría sobrevivido a la pantalla ` +
      `que lo creó, y un click suelto encendería el gasto`,
  );
  ctx.expect(
    "…y el save sigue intacto tras las tres confirmaciones que nadie confirmó",
    modoEnDisco(paraArmar) === "vector",
    `render_mode en disco: ${modoEnDisco(paraArmar)}`,
  );

  // ── C bis · confirmar SÍ escribe, y apagar no pide permiso ───────────────
  const encendido = await pulsarBadge(ctx, badge(paraArmar), "el segundo click aplica el cambio");
  await ctx.shot("badge-confirmado");
  ctx.expect(
    "confirmando, el modo cambia y el badge lo dice releyendo del bridge",
    encendido.texto === IMAGEN,
    encendido.texto,
  );
  ctx.expect(
    "…y queda PERSISTIDO en el save, que es de lo que sirve cambiarlo antes de cargar",
    modoEnDisco(paraArmar) === "image",
    `render_mode en disco: ${modoEnDisco(paraArmar)}`,
  );
  const apagado = await pulsarBadge(ctx, badge(paraArmar), "el badge reacciona al apagado");
  ctx.expect(
    "apagar NO pide confirmación —dejar de gastar es gratis— y se persiste de un click",
    apagado.texto === MAQUETA && modoEnDisco(paraArmar) === "vector",
    `${apagado.texto} · disco=${modoEnDisco(paraArmar)}`,
  );

  // ── D · EL BRIDGE NO PUEDE ESCRIBIR: EL TÍTULO LO DICE ───────────────────
  // Sin permiso de escritura en el directorio del save, el bridge lo lee pero
  // revienta al guardarlo. No se toca una línea de cliente.
  const dirFallo = dirDelSave(paraFallar);
  if (!dirFallo || !existsSync(dirFallo)) {
    ctx.sinMedirBloque(
      `el clon ${paraFallar} no está en disco: sin él no hay EACCES real que inyectar`,
    );
    return;
  }
  const modoAntes = modoEnDisco(paraFallar);
  let fallo;
  chmodSync(dirFallo, 0o500);
  try {
    // Primer click: arma. Segundo: intenta escribir, y es el que falla.
    await pulsarBadge(ctx, badge(paraFallar), "el badge del clon pide confirmación");
    fallo = await pulsarBadge(ctx, badge(paraFallar), "el título reacciona al cambio rechazado");
  } finally {
    chmodSync(dirFallo, 0o700);
  }
  await ctx.shot("modo-que-no-se-pudo-cambiar");
  ctx.log(`#ts-status: ${fallo.status}`);

  ctx.expect(
    "un cambio de modo que el bridge rechaza NO es mudo: el título lo dice en pantalla",
    /No se pudo cambiar el modo de/i.test(fallo.status) && fallo.status.includes(paraFallar),
    fallo.status || "(el título no dijo nada: el cambio se perdió en silencio)",
  );
  ctx.expect(
    "…con la causa dentro, que es lo que lo hace accionable",
    /no se pudo escribir|EACCES|permission/i.test(fallo.status),
    fallo.status,
  );
  ctx.expect(
    "…y el badge NO miente: sigue enseñando el modo que de verdad tiene el save",
    fallo.texto === MAQUETA && modoEnDisco(paraFallar) === modoAntes,
    `badge="${fallo.texto}" · disco=${modoEnDisco(paraFallar)} (antes ${modoAntes})`,
  );
  const trasElFallo = await ctx.page.evaluate(fotoDelHome);
  ctx.expect(
    "…y la lista sigue entera: un cambio fallido no se lleva por delante las tarjetas",
    trasElFallo.tarjetas === 3,
    `tarjetas=${trasElFallo.tarjetas}`,
  );

  // ── E · EL BRIDGE NO PUEDE LISTAR: `listSessions()` REVIENTA ────────────
  // El otro estado que nadie visita: el `catch` que envuelve
  // `deps.narrative.listSessions()`. Se produce EN EL BORDE, dejando la
  // carpeta de partidas ilegible (`0o000`): `fs.readdir` da EACCES, el
  // almacén lanza y el bridge contesta con su motivo, que es exactamente lo
  // que le pasa a quien tiene `saves/` en un volumen desmontado o sin
  // permisos. Va el ÚLTIMO porque toca el disco de toda la corrida.
  //
  // NO se apaga el bridge entero: medido en este mismo guion, con `?bridge=`
  // a un puerto muerto el TÍTULO NO LLEGA A PINTARSE (el cliente cae al visor
  // de fixtures, que es el diseño candado por `qa/fixtures-sin-bridge.mjs`),
  // así que ese camino no ejerce este `catch` — expira esperando un
  // `#ts-status` que nunca existe. Queda dicho para quien lo intente.
  const raizDeSaves = dirname(dirDelSave(paraFallar));
  let sinLista;
  let foto;
  chmodSync(raizDeSaves, 0o000);
  try {
    await ctx.page.reload({ waitUntil: "domcontentloaded" });
    await ctx.waitFor("el cliente arranca", () => Boolean(window.__nefan));
    // Se espera al SELLO del home (`#ts-status[data-lista]`), no a la frase, y
    // se le exige el valor `error`: este bloque es el único sitio del banco que
    // ejerce esa rama del `try`, así que es también el candado del sello — si
    // alguien se lleva el `dataset.lista = "error"` del `catch`, esto se pone
    // rojo aquí, y no 20 guiones más allá esperando algo que ya no llega.
    //
    // Hasta #550 este bloque tenía que mirar la frase a mano y decirlo: el
    // helper compartido `esperarListaDeSaves` casaba «No se puede contactar con
    // el bridge», un texto que el home no escribe desde #306, así que en este
    // estado solo podía expirar. Era hallazgo del BANCO, no del juego, y hoy
    // está cerrado: el helper mira este mismo sello.
    //
    // `expectEspera` y no `waitFor` (#261): así el hecho de que el título
    // ACABE de intentarlo es un aserto con su último valor sondeado, y no un
    // timeout opaco que hay que investigar para saber qué se rompió.
    const espera = await ctx.expectEspera(
      "el título termina de intentarlo (sello data-lista=error) y no se queda en «Cargando saves…»",
      true,
      () => {
        const el = document.getElementById("ts-status");
        if (el?.dataset.lista !== "error") return null;
        return el.textContent?.trim() || "(#ts-status sellado pero vacío)";
      },
      { ms: 60_000 },
    );
    sinLista = typeof espera.ultimo === "string" ? espera.ultimo : "";
    foto = await ctx.page.evaluate(fotoDelHome);
    await ctx.shot("home-sin-poder-listar-las-partidas");
  } finally {
    chmodSync(raizDeSaves, 0o700);
  }
  ctx.log(`sin lista → status: "${sinLista}" · sesiones: "${foto.sesiones}"`);

  ctx.expect(
    "…y lo que cuenta es que no se pudieron cargar las partidas, no un hueco en blanco",
    /No se pudieron cargar las partidas guardadas/i.test(sinLista),
    sinLista || "(#ts-status vacío: el fallo se perdió)",
  );
  ctx.expect(
    "…sin instrucciones de desarrollo ni jerga del transporte, que es lo que se leía antes",
    !/\.\/start\.sh|preset|arranca el bridge/i.test(sinLista),
    sinLista || "(vacío)",
  );
  ctx.expect(
    "…y el jugador conserva una salida: «Nueva partida» sigue ahí y pulsable",
    foto.nuevaPartida.hay && foto.nuevaPartida.apagado === false,
    JSON.stringify(foto.nuevaPartida),
  );

  // ⚠ HALLAZGO MEDIDO SIN PONERLO ROJO (preexistente, verbatim de antes del
  // corte): `sessions` nace en `[]` y el `catch` no lo distingue de «no hay
  // ninguna», así que el mismo hueco que en el bloque A dice «— Ninguna
  // partida todavía —» justo debajo de «no se pudieron cargar». Con tres
  // partidas EN DISCO, a quien pierde el acceso se le está diciendo que no
  // tiene ninguna. No lo causa esta PR: se mide y se declara.
  ctx.log(
    `⚠ con ${trasElFallo.tarjetas} partidas EN DISCO y la lista rota, el hueco dice ` +
      `"${foto.sesiones}" (tarjetas=${foto.tarjetas}): «no se pudieron cargar» y «no hay ninguna» ` +
      `comparten pantalla, y el segundo es falso`,
  );
}
