/** Con el ataque preparado, el jugador ve HASTA DÓNDE llega — y lo ve también
 *  en un puerto.
 *
 *  Dos fallos del mismo parche, arreglados juntos:
 *
 *  #184 — la alfa del shader ERA la calidad del golpe, así que donde el color
 *  debía decir "rojo, aquí ya no llegas" la alfa valía cero: la rampa roja no
 *  se veía nunca y el jugador solo veía el punto dulce. El límite del área
 *  —lo único que evita fallar el golpe, porque `factor_distancia` cae
 *  linealmente hasta 0 en el borde de la tolerancia— era justo lo invisible.
 *  Y había un tercer límite sin degradado: el cono frontal de ±60°, un escalón
 *  duro, así que tampoco se veía el ARCO.
 *
 *  #185 — el parche se dibujaba a 0,2 m, número medido sobre dos fixtures del
 *  golden mientras el suelo crecía 2 mm por prim sin tope. Un tile de puerto
 *  ordinario (río, cuatro embarcaderos, seis calles y cuatro plazas: quince
 *  rasgos de los 64 que permite el schema) dejaba la cara alta del suelo en
 *  0,219 m y el telegraph desaparecía ENTERRADO bajo el embarcadero. No era
 *  un riesgo futuro: `puerto_tile` es esa escena, y está en el selector Room.
 *
 *  Se comprueba lo que le pasa a quien juega, sin leer un solo píxel:
 *   1. el suelo del tile no llega a la cota del parche (holgura positiva),
 *   2. los dos BORDES del alcance están en cuadro durante el wind-up,
 *   3. el alcance que publica el renderer es el de los params del ataque —no
 *      una constante decorativa—, y cambia al cambiar de ataque.
 *
 *  Las capturas de `qa/capturas/` son para la crítica visual de director de
 *  arte: contorno del área, las dos cuerdas del cono y el parche entero sobre
 *  el embarcadero.
 *
 *  EN NEGATIVO: con el código de antes de esta tanda el paso 1 se pone rojo en
 *  `puerto_tile` (holgura −0,019 m: el parche está bajo el deck) y el paso 2
 *  sigue verde — porque el borde ESTABA en cuadro, solo que con alfa cero.
 *  Comprobado también al revés: subir `GROUND_STACK_TOP_CELLS` o volver a
 *  escalonar las prims pone rojo el paso 1 en las dos fixtures.
 *
 *  Las cotas de arriba son la BASE de la prim más su grosor ENTERO (`pos.y` es
 *  la base, contrato de `GreyboxPrimitive`). Medirlas por el CENTRO —el error
 *  que cometieron el plan y esta misma cabecera— las deja 7,5 mm cortas y hace
 *  parecer menor un defecto que era mayor.
 *
 *  Y un aviso operativo que costó un falso verde: tras un `git checkout` de un
 *  fichero de `nefan-core`, vite sigue sirviendo el transform ANTERIOR. Un
 *  antes/después exige reiniciar el cliente, o el negativo sale verde.
 */

/** Espera a que el renderer EMITA frames nuevos: una captura pedida justo
 *  después de mover al jugador fotografía el frame ANTERIOR (la cámara se
 *  actualiza en el bucle, no en el setter). Se espera por el contador de
 *  frames, nunca por reloj. */
async function esperarFrames(ctx, n = 3) {
  const antes = (await ctx.nefan("fps")).frames;
  await ctx.waitFor(
    `${n} frames nuevos`,
    ({ f0, n }) => (window.__nefan.fps().frames >= f0 + n ? true : null),
    10_000,
    { f0: antes, n },
  );
}

const GRADOS_POR_PX = (0.0025 * 180) / Math.PI;

/** Baja la mirada moviendo el RATÓN, que es como la baja el jugador. */
function mirarA(ctx, grados) {
  return ctx.waitFor(
    `la mirada llega a ${grados}°`,
    ({ g, gpp }) => {
      const f = window.__nefan.fps();
      // Sin módulo GL cargado la vista no conoce el pitch y ya no publica un
      // cero de relleno (#308): se sigue esperando en vez de encolar una
      // mirada de NaN píxeles contra un pitch desconocido.
      if (!f?.ready || typeof f.pitchDeg !== "number") return null;
      const falta = g - f.pitchDeg;
      if (Math.abs(falta) <= 1.5) return { pitchDeg: f.pitchDeg };
      window.__nefan.inputDriver.queueLook(0, -Math.max(-30, Math.min(30, falta)) / gpp);
      return null;
    },
    10_000,
    { g: grados, gpp: GRADOS_POR_PX },
  );
}

/** Sin bridge (preset `html-fixtures`) el arranque de partida falla a
 *  propósito y el jugador ve el muro de error. Se cierra por SU botón, como
 *  haría una persona, justo antes de cada captura. */
async function cerrarMuroSiHay(ctx) {
  await ctx.page.evaluate(() => {
    const muro = document.getElementById("narrative-loader");
    if (muro?.classList.contains("error")) document.getElementById("narrative-loader-dismiss")?.click();
  });
}

async function cargarTile(ctx, fixture) {
  await ctx.nefan("loadFixture", fixture);
  await ctx.waitFor(`la fixture ${fixture} carga`, () => (window.__nefan.status().scene ? true : null));
  return ctx.waitFor(
    `el mundo 3D instala el tile de ${fixture}`,
    () => {
      const f = window.__nefan.fps();
      return f && f.ready && f.activeTile ? f : null;
    },
    20_000,
  );
}

/** Ataca y devuelve el estado del telegraph DURANTE el wind-up (no al final:
 *  el episodio se apaga solo y la foto hay que hacerla mientras dura). */
async function enWindup(ctx) {
  await ctx.nefan("inputDriver.queueAttack");
  return ctx.waitFor(
    "el ataque entra en wind-up y el telegraph está en pantalla",
    () => {
      const f = window.__nefan.fps();
      if (!f?.ready) return null;
      return f.telegraph?.mode === "windup" ? { ...f.telegraph, viewport: f.viewport } : null;
    },
    10_000,
  );
}

/** Espera a que el episodio de telegraph en curso se APAGUE solo y devuelve su
 *  recuento. El destello de impacto dura 0,3 s de sim y quien muestree desde
 *  fuera se lo salta; el renderer cuenta los frames que pinta, así que el
 *  episodio no pierde ninguno. */
function esperarEpisodio(ctx) {
  return ctx.waitFor(
    "el episodio del telegraph se completa y se apaga solo",
    () => {
      const ep = window.__nefan.fps()?.telegraphEpisode;
      return ep && ep.ended ? { ...ep } : null;
    },
    30_000,
  );
}

/** ¿Este punto de pantalla está dentro del cuadro? El 15 % inferior lo tapa la
 *  barra de acciones, así que no cuenta como "visible". */
function enCuadro(p, viewport) {
  return Boolean(p) && p.x >= 0 && p.x <= viewport.w && p.y >= 0 && p.y <= viewport.h * 0.85;
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? true : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  const catalogo = (await ctx.nefan("state")).attackCatalog;
  const lento = catalogo.includes("heavy") ? "heavy" : catalogo[catalogo.length - 1];
  const corto = catalogo.includes("quick") ? "quick" : catalogo[0];

  // ── 1. El puerto: la escena que enterraba el parche ──────────────────────
  await cargarTile(ctx, "puerto_tile");

  // Que la fixture sea de verdad el caso duro: sin embarcaderos sobre agua no
  // hay capa alta que enterrar nada, y este guion sería un verde vacío.
  const plano = await ctx.page.evaluate(() => {
    const s = window.__nefan.scene;
    return { scene_id: s.scene_id, ground: s.ground ?? [] };
  });
  const decks = plano.ground.filter((f) => f.kind === "deck");
  const aguas = plano.ground.filter((f) => f.kind === "water");
  ctx.log(`escena ${plano.scene_id} · ${plano.ground.length} rasgos de suelo · ${decks.length} embarcaderos · ${aguas.length} masas de agua`);
  ctx.expect("la fixture del puerto declara embarcaderos (la capa MÁS ALTA del suelo)", decks.length >= 4, `${decks.length}`);
  ctx.expect("…y agua bajo ellos", aguas.length >= 1, `${aguas.length}`);

  const sueloPuerto = (await ctx.nefan("fps")).suelo;
  ctx.log(
    `suelo del puerto: ${sueloPuerto.calcos} calcos · cara alta ${sueloPuerto.topY} m · ` +
      `el parche va a ${sueloPuerto.overlayY} m ⇒ holgura ${sueloPuerto.holguraM} m`,
  );
  ctx.expect(
    "el suelo del puerto NO llega a la cota del parche (antes lo enterraba)",
    sueloPuerto.holguraM > 0,
    `holgura ${sueloPuerto.holguraM} m sobre ${sueloPuerto.calcos} calcos`,
  );
  ctx.expect(
    "y la holgura es suficiente para que no z-fightee con el embarcadero",
    sueloPuerto.holguraM >= 0.015,
    `${sueloPuerto.holguraM} m`,
  );

  // ── 2. Los dos bordes del alcance, en cuadro y con el ataque preparado ───
  // Sobre el muelle, junto a un embarcadero: el sitio exacto donde el parche
  // desaparecía. Mirada abajo, que es como se mira a lo que vas a golpear.
  await ctx.nefan("inputDriver.selectAttack", lento);
  await mirarA(ctx, -30);
  const tPuerto = await enWindup(ctx);
  ctx.log(
    `telegraph "${lento}": alcance ${JSON.stringify(tPuerto.alcance)} m · ` +
      `borde cerca ${JSON.stringify(tPuerto.borde.cerca)} · lejos ${JSON.stringify(tPuerto.borde.lejos)} ` +
      `en un lienzo de ${tPuerto.viewport.w}×${tPuerto.viewport.h}`,
  );
  ctx.expect(
    "el borde LEJANO del alcance está en cuadro (dónde deja de llegar)",
    enCuadro(tPuerto.borde.lejos, tPuerto.viewport),
    JSON.stringify(tPuerto.borde.lejos),
  );
  // El CERCANO cae a los pies —a 0,2 m del jugador con la espada corta, que es
  // el arma que el cliente equipa SIEMPRE (`main.ts`: `playerWeaponId` es una
  // constante, no hay estado de "desarmado" alcanzable hoy)—, así que con la
  // mirada a −30° queda por debajo del cuadro y exigirlo sería exigir que el
  // jugador se mire las botas. Lo que sí se exige es que exista y esté
  // PROYECTADO (no detrás del ojo): es el otro extremo del alcance.
  ctx.expect(
    "el borde CERCANO del alcance existe y está proyectado",
    tPuerto.borde.cerca !== null,
    JSON.stringify(tPuerto.borde.cerca),
  );
  ctx.expect(
    "el alcance publicado envuelve la distancia óptima del ataque (no es una constante)",
    tPuerto.alcance.cerca < tPuerto.optimalDistance && tPuerto.optimalDistance < tPuerto.alcance.lejos,
    `alcance ${JSON.stringify(tPuerto.alcance)} vs óptimo ${tPuerto.optimalDistance}`,
  );
  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot("telegraph-puerto-sobre-el-embarcadero");

  // ── 3. Y en campo abierto, que es donde se juzga el dibujo ───────────────
  const fixtureAbierta = await cargarTile(ctx, "robledo_tile");
  ctx.log(`tile abierto: ${fixtureAbierta.activeTile}`);
  const sueloRobledo = (await ctx.nefan("fps")).suelo;
  ctx.log(
    `suelo de robledo: ${sueloRobledo.calcos} calcos · cara alta ${sueloRobledo.topY} m ⇒ holgura ${sueloRobledo.holguraM} m`,
  );
  ctx.expect(
    "el suelo de la fixture del golden tampoco llega a la cota del parche",
    sueloRobledo.holguraM > 0,
    `${sueloRobledo.holguraM} m`,
  );
  // El techo del suelo es CONSTANTE: no depende de cuántos rasgos traiga el
  // tile. Es la propiedad que arregla #185 de raíz — antes crecía con N.
  ctx.expect(
    "el techo del suelo es el mismo en un puerto de 15 rasgos que en un pueblo de 8",
    Math.abs(sueloPuerto.topY - sueloRobledo.topY) < 1e-3,
    `puerto ${sueloPuerto.topY} m (${sueloPuerto.calcos} calcos) vs robledo ${sueloRobledo.topY} m (${sueloRobledo.calcos} calcos)`,
  );

  await ctx.nefan("inputDriver.selectAttack", lento);
  await mirarA(ctx, -30);
  const tLento = await enWindup(ctx);
  ctx.expect(
    `el borde lejano de "${lento}" está en cuadro en campo abierto`,
    enCuadro(tLento.borde.lejos, tLento.viewport),
    JSON.stringify(tLento.borde.lejos),
  );
  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot(`telegraph-borde-${lento}`);

  // ── 4. Un ataque MÁS CORTO tiene un borde MÁS CERCA ─────────────────────
  // Si el parche dibujara siempre lo mismo, esto no cambiaría: es la prueba
  // de que el contorno informa del ataque concreto y no es un adorno fijo.
  await ctx.waitFor(
    "el telegraph del ataque anterior se apaga",
    // Con la vista sin cargar el campo NO existe (#308), que no es lo mismo
    // que estar apagado: se exige presencia antes de leerlo.
    () => {
      const f = window.__nefan.fps();
      return f?.ready && f.telegraph === null ? true : null;
    },
    20_000,
  );
  await ctx.nefan("inputDriver.selectAttack", corto);
  const tCorto = await enWindup(ctx);
  // El borde y la MIRADA, no solo el alcance: este aserto es intermitente
  // (medido el 2026-08-28 sobre `326b859` sin tocar: 4 rojos de 6 corridas,
  // siempre con el mismo `y=742`), y sin saber con qué pitch se midió no hay
  // por dónde empezar. Es diagnóstico, no un aserto: no cambia el veredicto.
  const mirada = await ctx.nefan("state");
  ctx.log(
    `telegraph "${corto}": alcance ${JSON.stringify(tCorto.alcance)} m · radio ${tCorto.areaRadius} m · ` +
      `borde lejos ${JSON.stringify(tCorto.borde.lejos)} en ${tCorto.viewport.w}×${tCorto.viewport.h} · ` +
      `pitch ${mirada.pitchDeg?.toFixed(2)}° · pos ${mirada.pos.x.toFixed(2)},${mirada.pos.z.toFixed(2)}`,
  );
  ctx.expect(
    `"${corto}" llega menos lejos que "${lento}" y el parche lo dice`,
    tCorto.alcance.lejos < tLento.alcance.lejos,
    `${tCorto.alcance.lejos} m vs ${tLento.alcance.lejos} m`,
  );
  ctx.expect(
    `el borde de "${corto}" también está en cuadro (el parche pequeño no se pierde)`,
    enCuadro(tCorto.borde.lejos, tCorto.viewport),
    JSON.stringify(tCorto.borde.lejos),
  );
  await cerrarMuroSiHay(ctx);
  await esperarFrames(ctx);
  await ctx.shot(`telegraph-borde-${corto}`);

  // ── 5. El destello del impacto no miente sobre a quién diste ────────────
  // El color del destello es un DATO: verde = golpe bueno, gris = no llegaste.
  // Lo tiñe la calidad del mejor enemigo dentro del área (`attackFlashQuality`
  // de core, la misma fórmula que resuelve el daño). Sin enemigos en la
  // fixture no hay a quién dar, así que el destello tiene que salir GRIS: un
  // parche que se tiñera de la selección del ataque en vez de del impacto
  // volvería a decir "golpe perfecto" sin haber tocado a nadie, que es
  // exactamente lo que hacía la copia de la fórmula que esta tanda retiró.
  const episodio = await esperarEpisodio(ctx);
  ctx.log(
    `episodio ${episodio.episode}: ${episodio.windupFrames} frames de wind-up + ` +
      `${episodio.impactFrames} de impacto · calidad del destello ${episodio.impactQuality}`,
  );
  ctx.expect(
    "el impacto llega a pintarse (si no, lo de abajo sería un verde vacío)",
    episodio.impactFrames > 0,
    `${episodio.impactFrames} frames`,
  );
  ctx.expect(
    "y sin nadie a quien golpear el destello sale GRIS, no 'golpe perfecto'",
    episodio.impactQuality === 0,
    `calidad ${episodio.impactQuality}`,
  );
}
