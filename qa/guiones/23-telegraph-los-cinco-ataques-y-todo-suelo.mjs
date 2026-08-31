/** El parche dice la verdad de CADA ataque, y ninguna fixture lo entierra.
 *
 *  El guion 22 cierra los dos issues de la tanda (#184 #185) con el caso que
 *  los provocó: `heavy` y `quick` sobre el puerto y sobre el golden. Esto
 *  cubre los DOS estados que aquel deja fuera, y que son justo donde un
 *  arreglo así se deshace sin que nadie lo note:
 *
 *  1. **Los cinco ataques del catálogo, no dos.** Cada tipo tiene su alcance
 *     y su radio, y el parche es la única forma de saberlos antes de golpear:
 *     si dejara de seguir a la selección, el jugador vería el área de otro
 *     golpe con toda la confianza del mundo. El guion selecciona con el
 *     telegraph APAGADO a propósito — mientras un ataque está en vuelo el
 *     parche pinta el área del ataque en curso, que es lo correcto (el
 *     wind-up ya empezó con esos metros) pero no lo que aquí se afirma.
 *
 *  2. **Todas las fixtures que ofrece el selector, no dos.** El techo del
 *     suelo (#185) es constante POR CONSTRUCCIÓN, así que la afirmación
 *     fuerte no es "en el puerto hay holgura" sino "la cara alta del suelo es
 *     la MISMA en todas, traiga el tile 0 rasgos o 57 calcos". Una fixture
 *     nueva que rompa eso entra por esta puerta.
 *
 *  3. **Reinstalar un tile no cambia su suelo.** La cara alta se mide al
 *     instalar; si un reinstalado acumulara calcos o los midiera dos veces,
 *     la holgura se movería sola y el candado del 22 se volvería ruido.
 *
 *  Sin píxeles y sin esperas por reloj: todo sale de `window.__nefan`. Las
 *  capturas (una por tipo de ataque) son para la crítica visual — si el
 *  contorno se come el parche pequeño de `precise` o el relleno tapa al NPC
 *  que tienes delante, eso lo juzga una persona, no un assert.
 *
 *  EN NEGATIVO (comprobado por QA, 2026-08-25):
 *   · devolviendo el escalonado de 2 mm por prim a `fps-spec.ts` ⇒ rojo en
 *     «ninguna fixture … llega a la cota» y en «el techo del suelo es el
 *     mismo» (puerto 0,333 m vs robledo 0,161 m).
 *   · haciendo que `attackAreaReach` devuelva una constante ⇒ rojo en «el
 *     límite que ve el jugador se MUEVE al cambiar de ataque» (1 altura de
 *     pantalla en vez de 4).
 *   · quitando la espera al apagado antes de seleccionar ⇒ rojo en «ningún
 *     ataque pinta el área del ANTERIOR» («medium» salía con los metros de
 *     «heavy»), que es la firma de un parche que dejó de seguir la selección.
 *  OJO al probarlo: el dev server de vite puede seguir sirviendo la versión
 *  ANTERIOR de un fichero de `nefan-core` después de un `git checkout` (pierde
 *  el watch del inodo). Reinicia el cliente antes de creerte un antes/después.
 */

import { cargarFixture } from "../lib/fixtures.mjs";

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion no le pide NADA
 *  al motor, así que el runner no lo gatea. El motivo va en el valor y no en
 *  un booleano porque hay que escribirlo, se ve en el diff y dice qué CLASE
 *  de guion es. */
export const sinMotor =
  "cierra el título y carga las tres fixtures del selector; nunca arranca " +
  "partida";

/** ¿Este punto de pantalla está dentro del cuadro? El 15 % inferior lo tapa
 *  la barra de acciones, así que no cuenta como "visible" (mismo criterio
 *  que el guion 22). */
function enCuadro(p, viewport) {
  return Boolean(p) && p.x >= 0 && p.x <= viewport.w && p.y >= 0 && p.y <= viewport.h * 0.85;
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

/** Espera a que NO haya telegraph en pantalla: seleccionar tipo de ataque con
 *  un episodio en vuelo no cambia el área, y esa es justo la trampa que este
 *  guion vigila. */
function esperarSinTelegraph(ctx) {
  return ctx.waitFor(
    "el telegraph anterior se apaga",
    // Con la vista sin cargar el campo NO existe (#308), que no es lo mismo
    // que estar apagado: se exige presencia antes de leerlo.
    () => {
      const f = window.__nefan.fps();
      return f?.ready && f.telegraph === null ? true : null;
    },
    20_000,
  );
}

/** Selecciona el ataque con el telegraph apagado, ataca y devuelve el estado
 *  del telegraph DURANTE el wind-up. */
async function windupDe(ctx, tipo) {
  await esperarSinTelegraph(ctx);
  await ctx.nefan("inputDriver.selectAttack", tipo);
  await ctx.nefan("inputDriver.queueAttack");
  return ctx.waitFor(
    `"${tipo}" entra en wind-up con su telegraph en pantalla`,
    () => {
      const f = window.__nefan.fps();
      if (f?.telegraph?.mode !== "windup") return null;
      return { ...f.telegraph, viewport: f.viewport, seleccionado: window.__nefan.state().input.selectedAttack };
    },
    15_000,
  );
}

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? true : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  // ── 1. TODAS las fixtures del selector, no dos ──────────────────────────
  const fixtures = await ctx.page.$eval("#room-selector", (s) =>
    [...s.options].map((o) => o.value).filter(Boolean).map((v) => v.split("/").pop().replace(/\.json$/, "")),
  );
  ctx.log(`el selector «Room» ofrece ${fixtures.length} fixtures: ${fixtures.join(", ")}`);
  ctx.expect("el selector ofrece las fixtures del repo (si no, esto no comprueba nada)", fixtures.length >= 3, `${fixtures.length}`);

  const suelos = [];
  for (const f of fixtures) {
    const suelo = (await cargarFixture(ctx, f)).suelo;
    suelos.push({ fixture: f, ...suelo });
    ctx.log(`${f}: ${suelo.calcos} calcos · cara alta ${suelo.topY} m · parche a ${suelo.overlayY} m ⇒ holgura ${suelo.holguraM} m`);
    ctx.expect(
      `ninguna fixture entierra el parche: ${f} deja holgura positiva`,
      suelo.holguraM > 0,
      `${suelo.holguraM} m sobre ${suelo.calcos} calcos`,
    );
  }

  const conCalcos = suelos.filter((s) => s.calcos > 0);
  const techos = [...new Set(conCalcos.map((s) => s.topY))];
  ctx.log(`caras altas de las fixtures con rasgos de suelo: ${conCalcos.map((s) => `${s.fixture} ${s.topY} m (${s.calcos})`).join(" · ")}`);
  ctx.expect(
    "al menos dos fixtures traen rasgos de suelo (si no, el techo no se compara con nada)",
    conCalcos.length >= 2,
    `${conCalcos.length}`,
  );
  ctx.expect(
    "el techo del suelo es el MISMO en todas: no depende de cuántos rasgos traiga el tile",
    techos.length === 1,
    `techos distintos: ${techos.join(", ")}`,
  );

  // ── 2. Reinstalar un tile no mueve su suelo ─────────────────────────────
  const primera = suelos.find((s) => s.calcos > 0);
  const otra = fixtures.find((f) => f !== primera.fixture);
  await cargarFixture(ctx, otra);
  const revisita = (await cargarFixture(ctx, primera.fixture)).suelo;
  ctx.log(`${primera.fixture} revisitada: ${revisita.calcos} calcos · cara alta ${revisita.topY} m`);
  ctx.expect(
    "volver a un tile no acumula calcos ni mueve su cara alta",
    revisita.calcos === primera.calcos && Math.abs(revisita.topY - primera.topY) < 1e-9,
    `antes ${primera.calcos}/${primera.topY} · ahora ${revisita.calcos}/${revisita.topY}`,
  );

  // ── 3. Los CINCO ataques del catálogo ───────────────────────────────────
  await cargarFixture(ctx, "robledo_tile");
  await mirarA(ctx, -30);
  const catalogo = (await ctx.nefan("state")).attackCatalog;
  ctx.log(`catálogo de la sesión: ${catalogo.join(", ")}`);
  ctx.expect("el catálogo trae los cinco ataques del sistema estándar", catalogo.length === 5, catalogo.join(","));

  const areas = [];
  for (const tipo of catalogo) {
    const t = await windupDe(ctx, tipo);
    areas.push({
      tipo,
      geometria: `óptimo ${t.optimalDistance} · radio ${t.areaRadius} · alcance ${t.alcance.cerca.toFixed(2)}–${t.alcance.lejos.toFixed(2)}`,
      borde: t.borde.lejos?.y ?? null,
    });
    ctx.log(
      `"${tipo}": óptimo ${t.optimalDistance} m · radio ${t.areaRadius} m · alcance ` +
        `${t.alcance.cerca.toFixed(2)}–${t.alcance.lejos.toFixed(2)} m · borde lejos ${JSON.stringify(t.borde.lejos)}`,
    );
    ctx.expect(
      `el área que se pinta es la del ataque seleccionado ("${tipo}")`,
      t.seleccionado === tipo,
      `seleccionado "${t.seleccionado}"`,
    );
    ctx.expect(
      `"${tipo}" publica SU alcance: envuelve su distancia óptima`,
      t.alcance.cerca < t.optimalDistance && t.optimalDistance < t.alcance.lejos,
      `${JSON.stringify(t.alcance)} vs óptimo ${t.optimalDistance}`,
    );
    ctx.expect(
      `el borde LEJANO de "${tipo}" está en cuadro: se ve dónde deja de llegar`,
      enCuadro(t.borde.lejos, t.viewport),
      JSON.stringify(t.borde.lejos),
    );
    ctx.expect(
      `el borde CERCANO de "${tipo}" existe y está proyectado (el otro extremo del alcance)`,
      t.borde.cerca !== null,
      JSON.stringify(t.borde.cerca),
    );
    await ctx.shot(`telegraph-ataque-${tipo}`);
  }

  // El área que se PINTA, no la que se selecciona. Si el episodio en vuelo se
  // comiera el cambio de tipo, un ataque publicaría la geometría del ANTERIOR:
  // esa es la firma exacta de la fuga, y no depende de que el config tenga
  // cinco geometrías distintas (dos tipos con los mismos metros son legales).
  const repetidos = areas.filter((a, i) => i > 0 && a.geometria === areas[i - 1].geometria);
  ctx.expect(
    "ningún ataque pinta el área del ANTERIOR (el cambio de tipo llega al parche)",
    repetidos.length === 0,
    repetidos.map((a) => `${a.tipo} repite ${a.geometria}`).join(" · "),
  );

  const bordes = [...new Set(areas.map((a) => a.borde))];
  ctx.log(`el borde lejano cae en ${bordes.length} alturas de pantalla distintas: ${bordes.join(", ")} px`);
  ctx.expect(
    "el límite que ve el jugador se MUEVE al cambiar de ataque (no es un adorno fijo)",
    bordes.length >= 3,
    `${bordes.length} alturas distintas de ${areas.length} ataques`,
  );
}
