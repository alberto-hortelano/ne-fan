/** EL MENÚ DEV SIGUE LISTANDO LO MISMO, AHORA QUE LO CUENTAN SUS DUEÑOS (#492).
 *
 *  Hasta esta tanda el inventario de arte pendiente lo hacía `listFakeItems` en
 *  `main.ts`, cruzando SIETE colaboradores porque ningún dueño sabía contar lo
 *  suyo. Ahora lo cuentan `FpsAtlasController.pendientes()` y
 *  `CharacterSpriteManager.pendientes()`, y la raíz solo concatena. El criterio
 *  de la tanda no es «funciona»: es **la MISMA lista**, en los tres estados en
 *  los que se puede ver distinta.
 *
 *  POR QUÉ HACÍA FALTA UN GUION NUEVO: antes de éste, `grep -rn "dev-menu" qa/`
 *  daba CERO. El menú dev no lo conducía nadie —`capturar-portadas.mjs` solo lo
 *  oculta para que no salga en las capturas—, así que mover su inventario de
 *  sitio era un cambio sin un solo observador. Toda la batería habría seguido
 *  verde con la lista vacía.
 *
 *  LA EXPECTATIVA SE DERIVA, NO SE COPIA DE LA IMPLEMENTACIÓN NUEVA. El modelo
 *  de referencia (`instalarElModelo`) reconstruye la lista con el algoritmo que
 *  tenía `main.ts` antes de la tanda (`git show a25d8c2f:nefan-html/src/main.ts`
 *  `:798-840`) y con observables que NO pasan por el camino que se mide: el
 *  orden de los tiles sale de `__nefan.tiles` (el `TileStore`), lo texturado de
 *  `__nefan.fps()` (el GL), los personajes de `__nefan.npcs()` y
 *  `__nefan.enemies()`, y el estado de cada skin de `__nefan.skins` (el libro
 *  del gestor). El menú, en cambio, pinta lo que le dan
 *  `FpsRenderer.tilesSinAtlas` y los dos `pendientes()`. Si las dos cuentas
 *  dejan de coincidir, hay rojo — que es exactamente la pregunta de la tanda.
 *
 *  EL MODELO Y LO PINTADO SE LEEN EN EL MISMO TICK, y no es un detalle: el menú
 *  se re-pinta por `setInterval` cada segundo (`POLL_MS`), así que dos lecturas
 *  separadas comparan la lista de ahora con el DOM de hace un segundo. La
 *  primera corrida de este guion salió roja por eso, con el vecino sano en
 *  «generándose» en pantalla y ya listo en el libro. Por eso la comparación es
 *  una ESPERA (`cuadran`) y no un `expect` suelto: el estado es correcto en
 *  cuanto el menú refresca, y lo que hay que afirmar es que llega a cuadrar.
 *
 *  TRES ESTADOS Y DOS PARTIDAS:
 *
 *  1. **Maqueta** (escenarios y personajes en vector): nadie ha pedido arte, el
 *     libro de skins está vacío y la lista tiene que traer a todos los
 *     personajes como «base y_bot» y el tile del jugador como atlas en clay. Es
 *     el estado por defecto de una partida nueva desde #579, y el que más fácil
 *     se rompe: un `pendientes()` que solo mirara lo que el gestor de skins ha
 *     PEDIDO saldría vacío justo aquí.
 *  2. **Imagen**: el arte llega y las filas DESAPARECEN — el tile cuando el GL
 *     lo da por texturado, cada skin cuando su `idle` sustituye a la base.
 *  3. **Un skin fallido**: 500 desde el borde (`page.route`) para UN prompt —uno
 *     solo, por debajo del umbral del fusible, para que el apagón de sesión no
 *     se lleve por delante lo que se mide—. Su fila dice «(falló)» con el botón
 *     VIVO, y el doble click del jugador lo revive: eso es lo que prueba que el
 *     `generar()` que ahora vive dentro del item sigue pidiendo con `force`.
 *
 *  Los estados 2 y 3 comparten partida a propósito: son el mismo arranque en
 *  modo imagen con una víctima saboteada, y montar dos partidas para eso solo
 *  añadiría dos minutos de reloj.
 *
 *  CERO CRÉDITOS: motor falso (`e2e-sin-creditos`), que sirve
 *  `/skin_sprite_sheet` y `/generate_surface_atlas` sin llamar a nadie.
 *
 *  LO QUE ESTE GUION NO CUBRE, dicho antes de que lo cace nadie:
 *
 *  - **El orden RELATIVO entre varios tiles de atlas.** El motor falso sirve un
 *    tile al arrancar, así que la lista de atlas tiene un elemento y «en el
 *    orden del `TileStore`» no se puede distinguir de «en cualquier orden». Eso
 *    lo mide el unitario del banco del cliente, con tres claves.
 *  - **`CONFIG.graphics.ai_skin = false`** (el `disabledReason` de la fila): es
 *    un flag de compilación del cliente, no un gesto del jugador. Del unitario.
 *  - **La MINIATURA.** El menú dibuja el primer frame del y_bot en un `<canvas>`
 *    y leer píxeles está prohibido (regla 2). Que salga de `getCached` lo mide
 *    el unitario.
 *  - **Que un skin con `idle` listo pero SIN entrada en el libro salga de la
 *    lista.** Es alcanzable (el rearme borra la entrada y conserva el arte) y
 *    `__nefan.skins` no lo publica, así que el modelo tampoco lo sabe.
 */

import { comenzar, nuevaPartida } from "../lib/sesion.mjs";

export const aisla = ["saves", "fake-ai"];

/** Debajo del umbral del `FusibleDeSkins` (3 personajes distintos): así el
 *  apagón de sesión no se lleva por delante a los demás, que es lo que este
 *  guion necesita ver vivos. */
const VICTIMAS = 1;

/** EL MODELO DE REFERENCIA, instalado en la página como `window.__qa152`.
 *
 *  Va ahí dentro y no en Node por una razón y no por comodidad: el modelo y lo
 *  PINTADO tienen que leerse en el mismo tick (ver la cabecera). Se instala una
 *  vez con `addInitScript` —así sobrevive a los `reload`— y no toca nada del
 *  juego: solo lee el hook y el DOM. */
function instalarElModelo() {
  window.__qa152 = () => {
    const n = window.__nefan;
    const estadoFps = n.fps();
    const texturados = new Set(estadoFps.ready ? estadoFps.textured : []);
    const conSuperficies = new Set(estadoFps.surfaces);
    // Orden del TileStore, saltando lo texturado y lo que no tiene superficies:
    // literalmente el `for (const t of tileStore.entries.values())` de antes.
    const atlas = n.tiles
      .filter((k) => conSuperficies.has(k) && !texturados.has(k))
      .map((k) => `Atlas fps ${k} (clay — celdas ya en la librería salen gratis)`);

    // `mundo.personajes` es npcs Y ENEMIGOS, en ese orden: el bandido del motor
    // falso está en escena desde el primer turno y también pide su skin.
    const libro = n.skins;
    const vivos = [
      n.aspecto.skinPrompt,
      ...n.npcs().map((x) => x.skinPrompt ?? ""),
      ...n.enemies().map((x) => x.skinPrompt ?? ""),
    ];
    const skins = [];
    for (const prompt of new Set(vivos)) {
      if (!prompt) continue;
      const s = libro.find((e) => e.prompt === prompt);
      if (s && s.ready.includes("idle")) continue;
      const estado = !s ? "base y_bot" : s.failed ? "falló" : "generándose";
      const corto = prompt.length > 70 ? `${prompt.slice(0, 70)}…` : prompt;
      skins.push(`Skin: ${corto} (${estado})`);
    }

    const esperado = [...atlas, ...skins];
    const filas = [...document.querySelectorAll("#dev-menu-items .dm-item")].map((r) => ({
      label: r.querySelector(".dm-label")?.textContent ?? "",
      boton: r.querySelector("button")?.textContent ?? "",
      deshabilitado: r.querySelector("button")?.disabled ?? false,
    }));
    const pintado = filas.map((f) => f.label);
    return {
      atlas,
      skins,
      enemigos: n.enemies().length,
      libro: libro.length,
      esperado,
      pintado,
      filas,
      cuadran: JSON.stringify(pintado) === JSON.stringify(esperado),
    };
  };
}

/** Abre el menú dev por el camino del jugador (el botón «Imágenes…» del panel
 *  de dev). El click es un TOGGLE, así que pulsarlo a ciegas lo cierra si ya
 *  estaba abierto. */
async function abrirElMenu(ctx) {
  const abierto = await ctx.page.evaluate(
    () => !(document.getElementById("dev-menu")?.hidden ?? true),
  );
  if (!abierto) await ctx.page.click("#ds-menu-btn");
  await ctx.page.waitForSelector("#dev-menu-items", { state: "visible", timeout: 10_000 });
}

const foto = (ctx) => ctx.page.evaluate(() => window.__qa152());

/** Espera a que lo pintado sea EXACTAMENTE el modelo, y lo afirma. El rojo no
 *  puede ser un «no ocurrió» a secas: se vuelve a fotografiar y se dejan las dos
 *  listas en el registro, o hay que repetir la corrida para saber qué sobraba. */
async function cuadraLaLista(ctx, desc, ms = 30_000) {
  const { ocurrio } = await ctx.expectEspera(
    desc,
    true,
    () => (window.__qa152().cuadran ? true : null),
    { ms },
  );
  if (!ocurrio) {
    const f = await foto(ctx);
    ctx.log(`   pintado: ${JSON.stringify(f.pintado)}`);
    ctx.log(`   modelo:  ${JSON.stringify(f.esperado)}`);
  }
  return ocurrio;
}

/** El gesto del jugador sobre una fila: armar y confirmar. El menú re-pinta
 *  cada segundo (`replaceChildren`), así que la fila se vuelve a localizar en
 *  cada click en vez de guardarse el nodo. */
async function generarLaFila(ctx, etiqueta) {
  const boton = ctx.page
    .locator("#dev-menu-items .dm-item", { hasText: etiqueta })
    .locator("button");
  await boton.waitFor({ state: "visible", timeout: 10_000 });
  await boton.click(); // arma: «¿Confirmar? Gastará créditos»
  await boton.click(); // confirma
}

export default async function (ctx) {
  // El modelo, para esta página y para las que vengan tras un `reload`.
  await ctx.page.addInitScript(instalarElModelo);
  await ctx.page.evaluate(instalarElModelo);

  // ── Sabotaje del borde: 500 para UNA víctima, que se elige más abajo ─────
  const plan = { victimas: [], caidas: 0, servidas: 0 };
  await ctx.page.route("**/skin_sprite_sheet", async (route) => {
    let cuerpo = {};
    try {
      cuerpo = JSON.parse(route.request().postData() ?? "{}");
    } catch {
      // La petición cambió de forma: este guion ya no sabe a quién sabotea. Se
      // deja pasar y que fallen sus asertos, que es más honesto que adivinar.
      await route.continue();
      return;
    }
    if (plan.victimas.includes(String(cuerpo.prompt ?? ""))) {
      plan.caidas++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "fallo del proveedor para ESTE personaje (simulado por QA)" }),
      });
      return;
    }
    plan.servidas++;
    await route.continue();
  });

  // ══ BLOQUE 1 · MAQUETA: nadie ha pedido arte y la lista los trae a todos ══
  await nuevaPartida(ctx, { renderMode: "vector", charMode: "vector" });
  await comenzar(ctx);
  await abrirElMenu(ctx);

  const { ocurrio: hayLista } = await ctx.expectEspera(
    "en maqueta el menú dev pinta algo: el tile en clay y los personajes sin vestir",
    true,
    () => (document.querySelectorAll("#dev-menu-items .dm-item").length > 0 ? true : null),
    { ms: 20_000 },
  );
  if (!hayLista) {
    return ctx.sinMedir(
      "el menú dev no pinta ni una fila en maqueta: sin lista no hay nada que comparar",
    );
  }

  const maqueta = await foto(ctx);
  ctx.log(`maqueta · modelo: ${JSON.stringify(maqueta.esperado)}`);
  ctx.log(`maqueta · pintado: ${JSON.stringify(maqueta.pintado)}`);
  await ctx.shot("152-maqueta-el-menu-dev");

  // ANTI-TAUTOLOGÍA: dos listas vacías casan sin comprobar nada, y con UN solo
  // skin no se distingue «los cuenta a todos» de «cuenta el primero».
  if (maqueta.atlas.length === 0 || maqueta.skins.length < 2) {
    ctx.sinMedirBloque(
      `en maqueta hacen falta un atlas y DOS skins, y salieron atlas=${maqueta.atlas.length} ` +
        `skins=${maqueta.skins.length} (${maqueta.enemigos} hostiles en escena). Si el atlas está ` +
        "a cero, la librería del motor falso ya tenía el tile texturado (`aisla: fake-ai` no la vacía).",
    );
  } else {
    await cuadraLaLista(ctx, "en MAQUETA la lista del menú es la de siempre, item a item");
    ctx.expect(
      "…y en maqueta el libro de skins está VACÍO: la lista NO sale de lo que el gestor pidió",
      maqueta.libro === 0,
      `entradas en __nefan.skins: ${maqueta.libro}`,
    );
    ctx.expect(
      "…y TODOS los personajes salen como «base y_bot» —npcs y enemigos—, que es lo que el " +
        "jugador tiene delante",
      maqueta.skins.length >= 2 && maqueta.skins.every((s) => s.endsWith("(base y_bot)")),
      JSON.stringify(maqueta.skins),
    );
  }

  // ══ BLOQUE 2 y 3 · IMAGEN, con UNA víctima saboteada ═════════════════════
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente vuelve a estar en pie", () => Boolean(window.__nefan));

  // La víctima se elige del pueblo que ya se ha visto, ANTES de arrancar la
  // partida de imagen: el sabotaje tiene que estar puesto antes del primer
  // `requestSkin`, o el skin llega y no hay nada que medir.
  const candidatos = maqueta.skins.map((s) =>
    s.replace(/^Skin: /, "").replace(/ \(base y_bot\)$/, ""),
  );
  plan.victimas = candidatos.filter((p) => !p.endsWith("…")).slice(0, VICTIMAS);
  const victima = plan.victimas[0];
  if (plan.victimas.length < VICTIMAS) {
    return ctx.sinMedir(
      `no hay prompt corto que sabotear entre ${JSON.stringify(candidatos)}: los rótulos largos ` +
        "vienen truncados y no sirven como clave de la ruta",
    );
  }
  ctx.log(`víctima del 500: ${JSON.stringify(plan.victimas)}`);

  await nuevaPartida(ctx, { renderMode: "image", charMode: "image" });
  await comenzar(ctx);
  await abrirElMenu(ctx);

  // ── 2a · El tile texturado SALE de la lista ──────────────────────────────
  const { ocurrio: seTexturo } = await ctx.expectEspera(
    "con Imagen IA el tile se textura y su fila de atlas DESAPARECE del menú",
    true,
    () => {
      const fps = window.__nefan.fps();
      if (!fps.ready || fps.textured.length === 0) return null;
      const pintadas = window.__qa152().pintado;
      return fps.textured.every((k) => !pintadas.some((l) => l.startsWith(`Atlas fps ${k} `)))
        ? { textured: fps.textured }
        : null;
    },
    { ms: 120_000 },
  );
  if (!seTexturo) {
    ctx.sinMedirBloque(
      "el motor falso no llegó a texturar ningún tile en 120 s: sin atlas puesto no se puede " +
        "afirmar que su fila desaparece",
    );
  }

  // ── 2b/3 · El que llega se va; el que cae se queda y lo dice ─────────────
  //
  // SE ESPERA A LAS DOS COSAS, y hace falta: el 500 de la víctima llega antes
  // que la hoja del vecino, así que mirar solo el «(falló)» fotografía la lista
  // a mitad de camino y el aserto de «el arte que llega desaparece» se mediría
  // sobre un skin que todavía venía en camino.
  const { ocurrio: cayo } = await ctx.expectEspera(
    "el skin saboteado acaba marcado como fallido y el del vecino sano LLEGA",
    true,
    (prompt) => {
      const libro = window.__nefan.skins;
      const caido = libro.find((e) => e.prompt === prompt);
      const sano = libro.find((e) => e.prompt !== prompt && e.ready.includes("idle"));
      return caido?.failed && sano ? { sano: sano.prompt } : null;
    },
    { ms: 120_000, arg: victima },
  );

  const imagen = await foto(ctx);
  ctx.log(`imagen · modelo: ${JSON.stringify(imagen.esperado)}`);
  ctx.log(`imagen · pintado: ${JSON.stringify(imagen.pintado)}`);
  ctx.log(`500 servidos: ${plan.caidas} · hojas servidas de verdad: ${plan.servidas}`);
  await ctx.shot("152-imagen-con-un-skin-fallido");

  if (!cayo) {
    return ctx.sinMedirBloque(
      `el skin de «${victima}» no llegó a marcarse como fallido, o ningún vecino recibió el suyo ` +
        `(500 servidos: ${plan.caidas}, hojas servidas: ${plan.servidas}): sin los dos no hay ` +
        "estado mixto que medir",
    );
  }

  const etiquetaVictima = `Skin: ${victima}`;
  await cuadraLaLista(
    ctx,
    "en IMAGEN y con un skin caído la lista sigue siendo la de siempre, item a item",
  );
  const trasCuadrar = await foto(ctx);
  ctx.expect(
    "…y el arte que SÍ llegó desaparece de la lista: no se queda ofreciéndose otra vez",
    plan.servidas > 0 && trasCuadrar.skins.length < maqueta.skins.length,
    `servidas: ${plan.servidas} · skins en maqueta: ${maqueta.skins.length} · ahora: ${trasCuadrar.skins.length}`,
  );
  ctx.expect(
    "…y el tile texturado tampoco: la familia de atlas se vacía cuando el GL la da por pintada",
    trasCuadrar.atlas.length === 0 && !trasCuadrar.pintado.some((l) => l.startsWith("Atlas fps ")),
    `modelo: ${JSON.stringify(trasCuadrar.atlas)} · pintado: ${JSON.stringify(trasCuadrar.pintado)}`,
  );

  const filaCaida = trasCuadrar.filas.find((f) => f.label.startsWith(etiquetaVictima));
  ctx.expect(
    "el que falló lo DICE y ofrece su botón vivo: un skin caído no se está generando",
    filaCaida !== undefined &&
      filaCaida.label === `${etiquetaVictima} (falló)` &&
      !filaCaida.deshabilitado &&
      filaCaida.boton === "Generar y aplicar",
    JSON.stringify(filaCaida),
  );

  // ── 3 · El doble click lo revive: `generar()` pide con `force` ────────────
  // Se levanta el sabotaje ANTES de pulsar: lo que se mide es que la petición
  // SALE, no que vuelva a caerse.
  plan.victimas = [];
  const antesDePulsar = plan.servidas;
  await generarLaFila(ctx, etiquetaVictima);

  // Se espera al ARTE y no al flag: `requestSkin` limpia el `failed` en la misma
  // llamada, así que «ya no está marcado» es cierto antes de que salga una sola
  // petición — un verde de contabilidad interna. Que la `idle` esté lista exige
  // que la petición saliera Y volviera.
  const { ocurrio: revivio } = await ctx.expectEspera(
    "el botón del menú revive al skin caído y su arte LLEGA: sin `force`, `requestSkin` se iría " +
      "de vuelta ante un skin marcado failed y la fila seguiría diciendo «falló»",
    true,
    (prompt) => {
      const s = window.__nefan.skins.find((e) => e.prompt === prompt);
      return s && !s.failed && s.ready.includes("idle") ? { ready: s.ready } : null;
    },
    { ms: 120_000, arg: victima },
  );
  if (revivio) {
    ctx.expect(
      "…y la petición SALIÓ de verdad al motor falso: no es un verde de contabilidad interna",
      plan.servidas > antesDePulsar,
      `hojas servidas antes: ${antesDePulsar} · ahora: ${plan.servidas}`,
    );
    await ctx.expectEspera(
      "…y con su arte puesto la fila se va del menú, que es lo que cierra el ciclo",
      true,
      (etiqueta) => (window.__qa152().pintado.every((l) => !l.startsWith(etiqueta)) ? true : null),
      { ms: 20_000, arg: etiquetaVictima },
    );
  }
  await ctx.shot("152-tras-revivir-el-skin-caido");
}
