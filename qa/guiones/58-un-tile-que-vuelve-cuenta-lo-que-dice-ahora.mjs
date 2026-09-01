/** LO QUE LA T3 CAMBIÓ Y NINGÚN CANDADO MIRABA: la re-emisión de un tile con
 *  la política CONSERVAR (#379) y la tecla `Y` de la propuesta de explorar
 *  (#329).
 *
 *  Las dos mitades de esta tanda que se pueden ver desde fuera y que, medidas
 *  el 2026-09-01, no tenían ocupante:
 *
 *  1 · **`Y` y `N` con el teclado de VERDAD.** #329 quitó el espejo
 *      `tileProposalActive` (campo público que el bucle escribía en tres
 *      sitios) y puso al proveedor a PREGUNTAR
 *      (`InputDeps.propuestaDeTileAbierta()`). Ese gate lo lee **solo**
 *      `KeyboardInputProvider`: el driver de bench (`?input=scripted`, con el
 *      que corre toda la batería) tiene un `queueTileConfirm()` SIN gate, y los
 *      guiones 05 y 42 aceptan la propuesta por ahí. O sea que hasta hoy se
 *      podía romper la derivación entera —dejarla en `false` constante— y la
 *      batería seguía en verde con el jugador incapaz de decir que sí. Aquí se
 *      pulsa la tecla, sin driver, como quien juega. Se miden las DOS
 *      direcciones del predicado, que es lo que exige que no sea una constante:
 *      con propuesta en pantalla la `Y` la acepta, y sin propuesta la `Y` no
 *      deja nada armado que acepte la siguiente sola.
 *
 *  2 · **Un tile que vuelve cuenta lo que dice AHORA.** La política elegida
 *      para #379 es conservar la entity de lo que ya está, y el plan avisó de
 *      su precio: hay que RE-APLICARLE lo que el tile declara ahora, «o un tile
 *      que cambia su descripción dejaría de verse». Esa re-aplicación vive en
 *      el cliente (`world/carga-de-tile.ts`, `declaradoDeObjeto` /
 *      `declaradoDePersonaje`) y `nefan-html` no tiene ni tests ni mutación
 *      (#241): el módulo de core (`session/entidades-del-tile.ts`) prueba que
 *      el reparto DEVUELVE lo declarado, no que nadie lo aplique. Con la línea
 *      `Object.assign(entity, declaradoDeObjeto(...))` borrada, `npm run
 *      verify` sigue verde y la batería entera también.
 *
 *      Y se mide la asimetría COMPLETA, que es la parte delicada de la
 *      decisión: ante el MISMO cambio —el tile mueve una cosa de sitio— un
 *      OBJETO se mueve (no tiene ninguna fuente viva) y un PERSONAJE no (su
 *      posición la manda el bridge, y re-aplicarle su celda de spawn es
 *      justamente el teletransporte que la política de conservar existe para no
 *      tener). Las dos mitades a la vez: con solo una, media decisión se puede
 *      invertir sin que nada se ponga rojo.
 *
 *  PROBADO EN NEGATIVO (QA, 2026-09-01, sobre el árbol de la tanda — cuatro
 *  sabotajes, uno a uno, con la salida real pegada):
 *   · Quitando `Object.assign(entity, declaradoDeObjeto(declarado,
 *     tipoDeVolumen));` de `poblar` (`nefan-html/src/world/carga-de-tile.ts`):
 *     **3 asertos rojos** — `"pozo de la plaza" → "pozo de la plaza"`,
 *     `prop → prop`, `x -0.75 → -0.75`. Los otros cinco del bloque 2 siguen
 *     verdes, que es lo correcto: miden otra cosa. Y con la línea borrada
 *     `npm run lint`, `npx tsc --noEmit` y los 56 guiones anteriores siguen
 *     TODOS en verde: por eso hacía falta este guion.
 *   · Añadiendo `Object.assign(entity, { pos: { ...declarado.pos } })` a la
 *     rama de conservar de los personajes (o sea, re-aplicándoles la celda de
 *     spawn): **1 aserto rojo** — `x -17.75 → -7.75`, el teletransporte
 *     exacto que la política de conservar existe para no tener.
 *   · Con `propuestaDeTileAbierta` cableada a `() => false` (`main.ts:603`):
 *     **el bloque 1b se pone rojo** — la `Y` deja de aceptar y expira esperando
 *     el tile vecino (794 sondeos). El resto de la batería sigue verde, porque
 *     acepta con el driver de bench.
 *   · Con `() => true`: **1a y 1b rojos** — la `Y` pulsada ANTES queda armada,
 *     acepta la propuesta en el mismo fotograma en que nace y ni siquiera llega
 *     a verse (`proposal:null, confirmar:[]`). En el juego de verdad eso es
 *     generar mundo —y gastar— sin que el jugador haya dicho que sí.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el bloque 1 juega contra el motor
 *  falso y el bloque 2 no le pide nada a nadie (fixture del selector «Room»).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { comenzar, esperarListaDeSaves, esperarTituloListo, nuevaPartida } from "../lib/sesion.mjs";

/** El motor falso es determinista por turno de diálogo, y el bloque 1 arranca
 *  partida: saves vírgenes y contador a cero. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** Fixture Format D del selector «Room»: es la que el bloque 2 re-emite con
 *  una declaración distinta, que es lo que hace el motor cuando la historia
 *  cambia algo de un tile ya visitado. */
const FIXTURE = fileURLToPath(new URL("../../nefan-core/data/scenes/robledo_tile.json", import.meta.url));
/** Un objeto sin ninguna fuente viva: al re-emitirse, TODO lo que el tile
 *  declara de él se le re-aplica, posición incluida. */
const OBJETO = "pozo";
/** Un objeto que el tile dejará de declarar: se retira. */
const OBJETO_QUE_SE_VA = "farol_plaza";
/** Un personaje: se conserva y se le re-aplica el NOMBRE, nunca la celda de
 *  spawn (la posición la manda el bridge). */
const PERSONAJE = "boris_herrero";
/** Cuántas celdas se mueve lo que el tile re-declara. 20 celdas × 0,5 m = 10 m:
 *  muy por encima de cualquier deriva, para que «se movió» y «no se movió» no
 *  puedan confundirse. */
const SALTO_EN_CELDAS = 20;

/** Los fotogramas del bucle: la única condición de parada honesta para «esto
 *  no ha pasado todavía» (el movimiento va por delta de rAF). */
async function frames(ctx, n) {
  const desde = await ctx.page.evaluate(() => window.__nefan.fps()?.frames ?? 0);
  return ctx.waitFor(
    `el bucle avanza ${n} fotograma(s)`,
    (m) => {
      const f = window.__nefan.fps()?.frames ?? 0;
      return f >= m.desde + m.n ? { f } : null;
    },
    20_000,
    { desde, n },
  );
}

/** Mantiene una tecla del TECLADO REAL unos fotogramas. Un `press()` hace
 *  keydown+keyup antes del siguiente rAF y la intención se pierde entera. */
async function mantener(ctx, tecla, nFrames = 4) {
  await ctx.page.keyboard.down(tecla);
  try {
    await frames(ctx, nFrames);
  } finally {
    await ctx.page.keyboard.up(tecla);
  }
}

/** Lo que el cliente tiene pintado de un objeto y de un personaje. */
const mundo = (ctx, objeto, personaje) =>
  ctx.page.evaluate(
    (ids) => ({
      objeto: window.__nefan.objects().find((o) => o.id === ids.objeto) ?? null,
      objetos: window.__nefan.objects().map((o) => o.id),
      npc: window.__nefan.npcs().find((n) => n.id === ids.personaje) ?? null,
      npcs: window.__nefan.npcs().map((n) => n.id),
    }),
    { objeto, personaje },
  );

export default async function (ctx) {
  // ── 0 · El proveedor de TECLADO, que es el único que lee el gate de #329 ──
  // Sin esto el guion mediría el driver de bench, cuyo `queueTileConfirm()` no
  // pregunta nada: exactamente el agujero que este guion viene a tapar.
  const url = new URL(ctx.page.url());
  url.searchParams.delete("input");
  await ctx.page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await ctx.waitFor("el cliente arranca sin el driver de bench", () => Boolean(window.__nefan));
  ctx.expect(
    "el guion corre con el proveedor de TECLADO (el de bench no lee el gate de la propuesta)",
    await ctx.page.evaluate(
      () => !new URLSearchParams(location.search).has("input") && !window.__nefan.inputDriver,
    ),
    url.toString(),
  );

  // ── 1 · La propuesta de explorar, con la tecla que pulsa el jugador ──────
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
  await nuevaPartida(ctx, { gameId: GAME_ID });
  await comenzar(ctx);
  await ctx.waitFor("la partida arranca y el mundo está pintado", () => window.__nefan.ready());

  // 1a · SIN propuesta en pantalla, `Y` y `N` no dejan nada armado. Si el gate
  // fuera una constante `true`, la pulsación quedaría latente en el proveedor
  // y aceptaría SOLA la primera propuesta que apareciera: el jugador vería el
  // mundo generarse sin haber dicho que sí (y gastando créditos en el juego de
  // verdad, que es por lo que hay una pregunta y no un automatismo).
  const sinPropuesta = await ctx.page.evaluate(() => window.__nefan.frontier.proposal);
  ctx.expect(
    "de partida no hay ninguna propuesta sobre la mesa (si la hubiera, 1a no mediría nada)",
    sinPropuesta === null,
    JSON.stringify(sinPropuesta),
  );
  await mantener(ctx, "y");
  await mantener(ctx, "n");

  // Camino del jugador hasta el borde este del tile, andando.
  const plano = await ctx.page.evaluate(() => ({
    origin: window.__nefan.scene.terrain_grid?.origin ?? null,
    mpc: window.__nefan.scene.terrain_grid?.meters_per_cell ?? null,
    cols: window.__nefan.scene.terrain_grid?.grid?.[0]?.length ?? 0,
  }));
  // Fail-loud del propio guion: un `undefined` aquí planta al jugador en NaN y
  // el resto del bloque mediría un muñeco que no se mueve. Costó una corrida
  // (`m_per_cell` no existe; el campo es `meters_per_cell`).
  if (!Number.isFinite(plano.mpc) || !Array.isArray(plano.origin) || plano.cols === 0) {
    return ctx.sinMedir(`el grid del tile no da origen/paso: ${JSON.stringify(plano)}`);
  }
  await ctx.nefan("setPlayerPos", plano.origin[0] + (plano.cols - 8) * plano.mpc, 0);
  await ctx.nefan("setYaw", Math.PI / 2); // mirando al este

  await ctx.page.keyboard.down("w");
  let propuesta = null;
  try {
    propuesta = await ctx.expectEspera(
      "caminar al este PROPONE explorar la zona vecina",
      true,
      () => window.__nefan.frontier.proposal ?? null,
      { ms: 120_000 },
    );
  } finally {
    await ctx.page.keyboard.up("w");
  }
  if (!propuesta) return ctx.sinMedirBloque("sin propuesta no hay tecla `Y` que medir");

  // El latido de 1a: la propuesta SIGUE en pantalla unos fotogramas después de
  // nacer. Con el gate en `true` constante, la `Y` de arriba la habría
  // consumido en el mismo fotograma y aquí ya no habría nada.
  await frames(ctx, 6);
  const sigueEnPantalla = await ctx.page.evaluate(() => ({
    proposal: window.__nefan.frontier.proposal,
    confirmar: window.__nefan.ui.actions().confirm.map((a) => a.label),
  }));
  ctx.expect(
    "la propuesta sigue esperando respuesta: la `Y` de antes no la aceptó por su cuenta (#329)",
    sigueEnPantalla.proposal !== null && sigueEnPantalla.confirmar.length > 0,
    JSON.stringify(sigueEnPantalla),
  );
  await ctx.shot("propuesta-en-pantalla");

  // 1b · Y AHORA la `Y` de verdad: con la propuesta delante, acepta.
  const antesTiles = await ctx.nefan("tiles");
  await mantener(ctx, "y", 2);
  const aceptada = await ctx.expectEspera(
    "pulsar `Y` con la propuesta delante la ACEPTA y se pide la zona vecina",
    true,
    (previos) => {
      const f = window.__nefan.frontier;
      const pedido = f.requested.find((k) => !previos.includes(k));
      if (pedido) return { pedido, requested: f.requested };
      return window.__nefan.tiles.length > previos.length ? { tiles: window.__nefan.tiles } : null;
    },
    { ms: 120_000, arg: antesTiles },
  );
  ctx.log("tras la Y: " + JSON.stringify(aceptada));

  // ── 2 · Un tile que vuelve cuenta lo que dice AHORA ──────────────────────
  // Se re-emite el MISMO tile con una declaración distinta, que es lo que hace
  // el motor cuando la historia cambia algo de un sitio ya visitado (el bridge
  // lo difunde y el cliente llama al mismo `addTile`).
  const formatD = JSON.parse(readFileSync(FIXTURE, "utf8"));
  await ctx.page.evaluate((d) => window.__nefan.loadSceneRaw(d), formatD);
  await ctx.waitFor(
    "la fixture está montada",
    () => window.__nefan.scene?.scene_id === "robledo_tile" || null,
  );

  const antes = await mundo(ctx, OBJETO, PERSONAJE);
  ctx.expect(
    "precondición: el tile trae el objeto, el personaje y el objeto que va a desaparecer",
    antes.objeto !== null && antes.npc !== null && antes.objetos.includes(OBJETO_QUE_SE_VA),
    JSON.stringify({ objeto: antes.objeto, npc: antes.npc, se_va: antes.objetos.includes(OBJETO_QUE_SE_VA) }),
  );
  if (!antes.objeto || !antes.npc) {
    return ctx.sinMedirBloque("la fixture no trae el objeto o el personaje que este bloque mide");
  }

  // La MISMA escena, con cuatro cambios declarados: al objeto se le cambia la
  // prosa, la categoría y la celda; al personaje, el nombre y la celda; y un
  // objeto deja de declararse.
  const otra = JSON.parse(JSON.stringify(formatD));
  const DESCRIPCION_NUEVA = "pozo de la plaza, ahora cegado con escombros";
  const NOMBRE_NUEVO = "Boris el Herrero, tuerto";
  for (const e of otra.entities) {
    if (e.id === OBJETO) {
      e.name = DESCRIPCION_NUEVA;
      e.kind = "item";
      e.cell = [e.cell[0] + SALTO_EN_CELDAS, e.cell[1]];
    }
    if (e.id === PERSONAJE) {
      e.name = NOMBRE_NUEVO;
      e.cell = [e.cell[0] + SALTO_EN_CELDAS, e.cell[1]];
    }
  }
  otra.entities = otra.entities.filter((e) => e.id !== OBJETO_QUE_SE_VA);
  await ctx.page.evaluate((d) => window.__nefan.addTileRaw(d), otra);
  await frames(ctx, 3);

  const despues = await mundo(ctx, OBJETO, PERSONAJE);
  ctx.log("objeto: " + JSON.stringify(despues.objeto) + " · npc: " + JSON.stringify(despues.npc));

  ctx.expect(
    "el objeto trae la DESCRIPCIÓN que el tile declara ahora (conservar sin re-aplicar sería enseñar la vieja)",
    despues.objeto?.label === DESCRIPCION_NUEVA,
    `${JSON.stringify(antes.objeto?.label)} → ${JSON.stringify(despues.objeto?.label)}`,
  );
  ctx.expect(
    "…y su CATEGORÍA nueva, que es de qué color se pinta",
    despues.objeto?.category === "item" && antes.objeto?.category !== "item",
    `${antes.objeto?.category} → ${despues.objeto?.category}`,
  );
  ctx.expect(
    "…y se MUEVE a donde el tile lo pone: un barril no tiene ninguna fuente viva que pisar",
    Math.abs((despues.objeto?.pos.x ?? 0) - (antes.objeto?.pos.x ?? 0)) > 5,
    `x ${antes.objeto?.pos.x} → ${despues.objeto?.pos.x}`,
  );
  ctx.expect(
    "el objeto se CONSERVA, no se duplica: sigue habiendo uno solo con ese id",
    despues.objetos.filter((id) => id === OBJETO).length === 1,
    JSON.stringify(despues.objetos),
  );
  ctx.expect(
    "lo que el tile deja de declarar se RETIRA",
    !despues.objetos.includes(OBJETO_QUE_SE_VA) && antes.objetos.includes(OBJETO_QUE_SE_VA),
    JSON.stringify({ antes: antes.objetos.length, despues: despues.objetos.length }),
  );

  ctx.expect(
    "el personaje trae el NOMBRE que el tile declara ahora (es lo que se lee sobre su cabeza)",
    despues.npc?.label === NOMBRE_NUEVO,
    `${JSON.stringify(antes.npc?.label)} → ${JSON.stringify(despues.npc?.label)}`,
  );
  ctx.expect(
    "…pero NO se teletransporta a la celda de spawn que el tile re-declara: su posición es del bridge",
    Math.abs((despues.npc?.pos.x ?? 0) - (antes.npc?.pos.x ?? 0)) < 0.01,
    `x ${antes.npc?.pos.x} → ${despues.npc?.pos.x} (el tile declaraba ${SALTO_EN_CELDAS} celdas más al este)`,
  );
  ctx.expect(
    "el personaje también se conserva sin duplicarse",
    despues.npcs.filter((id) => id === PERSONAJE).length === 1,
    JSON.stringify(despues.npcs),
  );
  await ctx.shot("tile-re-emitido");
}
