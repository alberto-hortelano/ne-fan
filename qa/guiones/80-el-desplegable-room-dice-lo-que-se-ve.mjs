/** EL DESPLEGABLE «ROOM» DICE LO QUE SE VE (QA del corte 3 de #358).
 *
 *  El corte 3 sacó el selector de fixtures de `main.ts` a
 *  `world/fixtures-del-selector.ts`. Lo que el jugador del preset
 *  `html-fixtures` tiene delante es UN desplegable y UN mundo, y la promesa del
 *  módulo es que los dos digan lo mismo en todos los caminos que ese
 *  desplegable puede recorrer. Los guiones 01, 24, 25 y 44 cubren la carga
 *  simple, el JSON que no llega, la partida que no se lleva y el instante de la
 *  segunda carga; este cubre los caminos que quedaban sin candado:
 *
 *   1 · dos cargas ENCADENADAS sin esperar la primera: gana la última, queda UN
 *       tile y el desplegable la nombra (`ultimaCargaDeFixture` es la última);
 *   2 · la MISMA fixture dos veces: la carga resuelve, el mundo se RETOMA (el
 *       jugador vuelve al spawn), sigue habiendo un tile y el censo no cambia;
 *   3 · la opción vacía («-- Room --»): no cambia nada y no deja error;
 *   4 · una fixture cuyo módulo LLEGA pero no es Format D válido (sin `tile`):
 *       el jugador se entera (entrada en el registro de errores y línea del
 *       juego que nombran la fixture) y el desplegable vuelve a la que se veía
 *       — y el mundo que se veía SIGUE PUESTO. Esta última afirmación es la que
 *       distingue este caso del guion 24 (allí el JSON no llega y
 *       `loadSceneFile` rechaza ANTES de tocar el mundo): aquí `loadSceneData`
 *       vacía el mundo y normaliza después, así que el rechazo deja el cielo
 *       vacío con el desplegable apuntando a una fixture que ya no está.
 *
 *  ESTADO: la última afirmación del bloque 4 («el mundo que se veía SIGUE
 *  PUESTO») es FALSA hoy (2026-09-06, medido sobre `6f23a613` y con el mismo
 *  código en la base `5510963a`: es anterior al corte) y es la deuda de **#487**:
 *  `loadSceneData` vacía el mundo y normaliza después, así que el rechazo deja
 *  el cielo vacío con el desplegable apuntando a la fixture anterior. Regla de
 *  la casa (T10): un guion rojo a propósito se aprende a ignorar, así que ese
 *  punto se DECLARA con `ctx.log` nombrando #487 en vez de afirmarse, y el resto
 *  del bloque (aviso al jugador, línea del juego, desplegable de vuelta) sí
 *  afirma. La PR de #487 devuelve esa línea a `ctx.expect` y el guion es su
 *  candado.
 *
 *  EN NEGATIVO (probado al escribirlo): devolver `cargarFixture` a
 *  fire-and-forget pone rojo el bloque 1; quitar el `if (!value) return` del
 *  manejador pone rojo el 3; quitar `sceneSelector.value = anterior` pone rojo
 *  el 4 por la vuelta del desplegable.
 *
 *  Cero créditos: no le pide nada al motor, solo el selector «Room».
 */

import { cargarFixture } from "../lib/fixtures.mjs";

/** La EXCEPCIÓN del guardarraíl de gasto (#295): este guion solo conduce el
 *  selector de fixtures del panel de dev; nunca arranca partida. */
export const sinMotor = "conduce el selector «Room» por sus cuatro caminos raros; nunca arranca partida";

const PRIMERA = "robledo_tile";
const SEGUNDA = "zorder_test";
/** La que se sirve ROTA en el bloque 4: tiene que ser la primera vez que esta
 *  página la pide, o el registro de módulos ESM la sirve sin tocar la red. */
const ROTA = "puerto_tile";
/** Cuánto tiene que andar el jugador para que «volvió al spawn» sea distinguible. */
const PASO_M = 0.4;

const foto = (ctx) =>
  ctx.page.evaluate(() => {
    const g = window.__nefan.fps();
    const s = window.__nefan.scene;
    const sel = document.getElementById("room-selector");
    return {
      scene: s?.scene_id ?? null,
      tiles: g.tiles ?? [],
      npcs: s?.npcs?.length ?? null,
      objetos: s?.objects?.length ?? null,
      spawn: s?.__player_start ?? null,
      pos: { ...window.__nefan.playerPos },
      select: sel.value,
      etiqueta: sel.selectedOptions[0]?.label ?? "",
      errores: document.getElementById("error-log").children.length,
      linea: document.getElementById("combat-log").firstElementChild?.textContent ?? "",
    };
  });

const pintada = (ctx, fixture) =>
  ctx.waitFor(
    `el mundo 3D instala el tile de ${fixture}`,
    (f) => {
      const g = window.__nefan.fps();
      return g && g.ready && g.activeTile && g.suelo && window.__nefan.scene?.scene_id === f ? true : null;
    },
    20_000,
    fixture,
  );

export default async function (ctx) {
  await ctx.waitFor("el título aparece al arrancar", () => (document.getElementById("ts-close") ? true : null));
  await ctx.nefan("closeTitle");
  await ctx.waitFor("el título se cierra", () => window.__nefan.status().title === false);

  // ── 1 · Dos cargas encadenadas sin esperar la primera ────────────────────
  await cargarFixture(ctx, PRIMERA);
  const encadenadas = await ctx.page.evaluate(
    async ({ a, b }) => {
      const pa = window.__nefan.loadFixture(a);
      const pb = window.__nefan.loadFixture(b);
      return {
        a: await pa.then(() => "ok", (e) => `rechazo: ${e.message}`),
        b: await pb.then(() => "ok", (e) => `rechazo: ${e.message}`),
      };
    },
    { a: PRIMERA, b: SEGUNDA },
  );
  await pintada(ctx, SEGUNDA);
  const f1 = await foto(ctx);
  ctx.log(`encadenadas ${PRIMERA}→${SEGUNDA}: ${JSON.stringify(encadenadas)} · mundo «${f1.scene}» · tiles ${JSON.stringify(f1.tiles)} · desplegable «${f1.etiqueta}»`);
  ctx.expect("las dos cargas encadenadas resuelven sin error", encadenadas.a === "ok" && encadenadas.b === "ok", JSON.stringify(encadenadas));
  ctx.expect(`gana la ÚLTIMA: el mundo es «${SEGUNDA}»`, f1.scene === SEGUNDA, `«${f1.scene}»`);
  ctx.expect("y queda UN solo tile, no los dos", f1.tiles.length === 1, JSON.stringify(f1.tiles));
  ctx.expect("el desplegable nombra la que se ve", f1.etiqueta === SEGUNDA, `«${f1.etiqueta}»`);

  // ── 2 · La misma fixture dos veces: el mundo se RETOMA ───────────────────
  const antes2 = await foto(ctx);
  await ctx.expectEspera(
    `el jugador anda ${PASO_M} m (si no, «volvió al spawn» no distingue nada)`,
    true,
    (a) => {
      const p = window.__nefan.playerPos;
      return Math.hypot(p.x - a.x, p.z - a.z) >= a.minima ? p : null;
    },
    { ms: 15_000, arg: { x: antes2.pos.x, z: antes2.pos.z, minima: PASO_M }, tecla: "up" },
  );
  const otraVez = await ctx.page.evaluate(
    (f) => window.__nefan.loadFixture(f).then(() => "ok", (e) => `rechazo: ${e.message}`),
    SEGUNDA,
  );
  await pintada(ctx, SEGUNDA);
  const f2 = await foto(ctx);
  ctx.log(`«${SEGUNDA}» otra vez: ${otraVez} · pos ${JSON.stringify(f2.pos)} · spawn ${JSON.stringify(f2.spawn)} · censo ${f2.npcs}/${f2.objetos}`);
  ctx.expect("recargar la fixture que ya se ve resuelve sin error", otraVez === "ok", otraVez);
  ctx.expect("sigue habiendo UN tile", f2.tiles.length === 1, JSON.stringify(f2.tiles));
  ctx.expect(
    "el mundo se retoma: el jugador vuelve al spawn de la fixture",
    f2.spawn && Math.abs(f2.pos.x - f2.spawn.x) < 0.01 && Math.abs(f2.pos.z - f2.spawn.z) < 0.01,
    `pos ${JSON.stringify(f2.pos)} · spawn ${JSON.stringify(f2.spawn)}`,
  );
  ctx.expect("el censo no cambia al recargar", f2.npcs === f1.npcs && f2.objetos === f1.objetos, `${f1.npcs}/${f1.objetos} → ${f2.npcs}/${f2.objetos}`);

  // ── 3 · La opción vacía ──────────────────────────────────────────────────
  const antes3 = await foto(ctx);
  await ctx.page.selectOption("#room-selector", "");
  await ctx.waitFor("un frame más tras elegir «-- Room --»", (f0) => (window.__nefan.fps().frames > f0 ? true : null), 5_000, await ctx.page.evaluate(() => window.__nefan.fps().frames));
  const f3 = await foto(ctx);
  ctx.log(`«-- Room --»: mundo «${antes3.scene}» → «${f3.scene}» · errores ${antes3.errores} → ${f3.errores} · desplegable «${f3.etiqueta}»`);
  ctx.expect("elegir la opción vacía no cambia el mundo", f3.scene === antes3.scene && f3.tiles.length === 1, `«${f3.scene}» ${JSON.stringify(f3.tiles)}`);
  ctx.expect("…ni deja una entrada de error", f3.errores === antes3.errores, `${antes3.errores} → ${f3.errores}`);
  // Se vuelve a poner la que se ve, para que el bloque 4 tenga a dónde volver.
  await cargarFixture(ctx, SEGUNDA);

  // ── 4 · Una fixture que llega pero no es Format D ────────────────────────
  const antes4 = await foto(ctx);
  let interceptadas = 0;
  const patron = `**/scenes/${ROTA}.json*`;
  const manejador = (route) => {
    interceptadas++;
    return route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `export default {"scene_id":"${ROTA}","entities":[]};\n`,
    });
  };
  await ctx.page.route(patron, manejador);
  const claveRota = await ctx.page.$eval("#room-selector", (s, n) => [...s.options].find((o) => o.value.includes(n))?.value ?? null, ROTA);
  if (!claveRota) return ctx.sinMedir(`el selector no ofrece «${ROTA}»`);
  await ctx.page.selectOption("#room-selector", claveRota);
  const { ocurrio: avisado } = await ctx.expectEspera(
    `el registro de errores gana una entrada por «${ROTA}»`,
    true,
    (n) => (document.getElementById("error-log").children.length > n ? true : null),
    { ms: 10_000, arg: antes4.errores },
  );
  await ctx.page.unroute(patron, manejador);
  const f4 = await foto(ctx);
  const entrada = await ctx.page.evaluate(
    (n) => [...document.getElementById("error-log").children].map((c) => c.textContent).find((t) => t.includes(n)) ?? null,
    ROTA,
  );
  ctx.log(`«${ROTA}» servida sin tile: interceptadas ${interceptadas} · mundo «${antes4.scene}» → «${f4.scene}» · tiles ${JSON.stringify(f4.tiles)} · desplegable «${f4.etiqueta}» · línea «${f4.linea}»`);
  ctx.expect("la compuerta sirvió el módulo roto una vez (si no, no hay negativo que valga)", interceptadas === 1, String(interceptadas));
  if (avisado) {
    ctx.expect("la entrada del registro nombra la fixture que no cargó", Boolean(entrada), entrada ? entrada.replace(/\s+/g, " ").slice(0, 160) : "(ninguna la nombra)");
  }
  ctx.expect("la línea del juego nombra la fixture que no cargó", new RegExp(ROTA).test(f4.linea), `«${f4.linea}»`);
  ctx.expect(`el desplegable vuelve a «${SEGUNDA}»`, f4.etiqueta === SEGUNDA, `«${f4.etiqueta}»`);
  // #487 · DEUDA DECLARADA, no afirmada: lo esperado es que el mundo que se veía
  // («zorder_test», UN tile) siga puesto cuando la fixture nueva no vale. Hoy
  // `loadSceneData` vacía antes de normalizar y el cielo se queda vacío con el
  // desplegable diciendo la anterior. Vuelve a `ctx.expect` con la PR de #487.
  const sigue = f4.scene === SEGUNDA && f4.tiles.length === 1;
  ctx.log(
    sigue
      ? `#487 · el mundo que se veía SIGUE PUESTO («${f4.scene}», tiles ${JSON.stringify(f4.tiles)}): la deuda está pagada, este log puede volver a ser un expect`
      : `#487 · DEUDA: el mundo que se veía NO sigue puesto — mundo «${f4.scene}» · tiles ${JSON.stringify(f4.tiles)} · el desplegable dice «${f4.etiqueta}»`,
  );
  await ctx.shot("fixture-rota-y-lo-que-queda");
}
