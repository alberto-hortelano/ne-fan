/** UNA PARTIDA NUEVA NO GASTA SIN QUE NADIE LO PIDA — el defecto de «Nueva
 *  partida», visto por quien pulsa el botón.
 *
 *  Decisión del usuario (2026-09-14, opción (b) del triaje): *«Nace en Maqueta
 *  3D, y encender Imagen IA es explícito, como en el home.»* Hasta ese día las
 *  dos puertas de la MISMA decisión no se trataban igual: en el home, encender
 *  Imagen IA sobre un save pedía dos clicks y decía «Gastará créditos»; en el
 *  selector, una partida nueva nacía en Imagen IA **por omisión** — nadie la
 *  había elegido y ya estaba gastando.
 *
 *  El defecto vivía en TRES sitios y este guion existe porque arreglar uno solo
 *  sale verde en pantalla y sigue gastando:
 *   1 · el literal de escenarios del selector (`selector-de-mundo.ts`),
 *   2 · el literal de PERSONAJES del mismo selector — `charModeTouched` solo
 *       propaga en un *click* de escenarios, así que dejarlo en `"image"`
 *       paría partidas en Maqueta 3D pagando skins IA, que es la mitad que no
 *       se ve mirando la pantalla de escenarios, y
 *   3 · el fallback del WIRE (`bridge/handlers/session.ts`, `msg.renderMode ||
 *       …`), que es el que decide de verdad: un `new_game` sin modo nacía
 *       gastando aunque el cliente dijera otra cosa.
 *  Por eso aquí no se mira solo el botón encendido: se mira el SAVE (los dos
 *  campos, que es lo que escribió el bridge) y se miran las puertas de gasto
 *  que el motor falso vio abrirse.
 *
 *  QUÉ SE MIDE, en dos bloques y con el segundo de control:
 *
 *   A · **Sin tocar nada.** Se abre el selector, se elige mundo y se pulsa
 *       Continuar → Comenzar sin acercarse a los botones de modo. Los dos
 *       vienen en Maqueta 3D / base y_bot, el save guarda `vector` en las dos
 *       facetas, y en toda la partida no se abre ni la puerta del atlas de
 *       superficies (`pintar-superficies`: una petición SIN `resolve_only`, la
 *       que manda pintar) ni la de los skins.
 *   B · **Un click, y gasta.** El control que impide que A sea un verde vacío:
 *       la misma partida con UN solo click en «Imagen IA» —uno, no el patrón
 *       armado de dos del home: en el selector el gasto lo confirma «Comenzar»,
 *       dos pantallas después— nace en `image`, arrastra a los personajes
 *       (nadie los tocó) y SÍ abre la puerta del atlas. Sin este bloque, A
 *       seguiría verde el día que el atlas dejara de pedirse por cualquier otro
 *       motivo.
 *
 *  Se mide la puerta EJERCIDA (`ejercicio.pintar-superficies`) y no el dinero
 *  (`gasto./generate_surface_atlas`): con la librería del falso caliente, pedir
 *  que pinte sale a $0 y el contador de dinero no se mueve. Aquí la librería
 *  nace vacía (`aisla: ["fake-ai"]`) así que las dos coinciden, y se afirman
 *  las dos — pero la que responde a la pregunta es la puerta.
 *
 *  NO se mide aquí, y vive en `nefan-core/test/`: la tabla de los gates por
 *  faceta (`gates-de-imagen.test.ts`, con `MODO_AL_EMPEZAR`) y que el wire caiga
 *  al defecto sin modo (`bridge-session.test.ts`).
 *
 *  Cero créditos: preset `e2e-sin-creditos` del runner; el bloque B «paga» al
 *  motor falso.
 */
import { readFileSync } from "node:fs";

import { abrirSelectorDeMundos, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** El borde con el que el selector pinta el botón ACTIVO (`#da6` de `atomos`). */
const BORDE_ACTIVO = "rgb(221, 170, 102)";

/** Los dos contadores del motor falso: `gasto` (lo que habría COSTADO) y
 *  `ejercicio` (las puertas abiertas, cobrasen o no). */
async function contadores() {
  const res = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!res.ok) throw new Error(`fake /dev/counters HTTP ${res.status}`);
  const { gasto, ejercicio } = await res.json();
  return { gasto, ejercicio };
}

const cuanto = (m, clave) => m?.rutas?.[clave] ?? 0;
const delta = (antes, despues) => ({
  atlasPedido: cuanto(despues.ejercicio, "pintar-superficies") - cuanto(antes.ejercicio, "pintar-superficies"),
  atlasPagado:
    cuanto(despues.gasto, "/generate_surface_atlas") - cuanto(antes.gasto, "/generate_surface_atlas"),
  skins: cuanto(despues.gasto, "/skin_sprite_sheet") - cuanto(antes.gasto, "/skin_sprite_sheet"),
});

/** Qué botón está marcado como activo en una de las dos filas de modo, leído
 *  del color que ve el jugador y no de una variable del módulo. */
function modoActivo(ctx, fila, atributo) {
  return ctx.page.evaluate(
    ([sel, attr, borde]) => {
      const botones = [...document.querySelectorAll(`${sel} [data-${attr}]`)];
      const activos = botones.filter((b) => b.style.borderColor === borde);
      return {
        hay: botones.map((b) => b.dataset[attr]),
        activos: activos.map((b) => b.dataset[attr]),
      };
    },
    [fila, atributo, BORDE_ACTIVO],
  );
}

/** Los dos modos que el BRIDGE escribió en el save — lo que de verdad decide. */
function modosDelSave(ctx, sessionId) {
  const ruta = rutaDelSave(sessionId);
  if (!ruta) return null;
  const world = JSON.parse(readFileSync(ruta, "utf8")).world ?? {};
  ctx.log(`save ${sessionId}: render_mode=${JSON.stringify(world.render_mode)} character_mode=${JSON.stringify(world.character_mode)}`);
  return { render: world.render_mode, personajes: world.character_mode };
}

export default async function (ctx) {
  // ── A · Sin tocar nada: nace en Maqueta y no abre ninguna puerta ─────────
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);

  const escenarios = await modoActivo(ctx, "#ts-rendermode", "rendermode");
  const personajes = await modoActivo(ctx, "#ts-charmode", "charmode");
  ctx.log(`modos al abrir el selector: ${JSON.stringify({ escenarios, personajes })}`);
  ctx.expect(
    "sin tocar nada, ESCENARIOS viene en Maqueta 3D (y solo uno marcado)",
    escenarios.activos.length === 1 && escenarios.activos[0] === "vector",
    JSON.stringify(escenarios),
  );
  ctx.expect(
    "…y PERSONAJES también: una partida en maqueta no puede nacer pagando skins",
    personajes.activos.length === 1 && personajes.activos[0] === "vector",
    JSON.stringify(personajes),
  );

  const antesA = await contadores();
  const partidaA = await comenzar(ctx);
  await esperarPartidaEnDisco(ctx, partidaA.sessionId);
  const despuesA = await contadores();
  const dA = delta(antesA, despuesA);
  ctx.log(`partida A (sin tocar nada): ${JSON.stringify(dA)}`);
  ctx.expect(
    "jugar la partida NO manda pintar el atlas ni una sola vez (la puerta del gasto no se abre)",
    dA.atlasPedido === 0 && dA.atlasPagado === 0,
    JSON.stringify(dA),
  );
  ctx.expect("…ni pide un solo skin IA", dA.skins === 0, JSON.stringify(dA));

  const saveA = modosDelSave(ctx, partidaA.sessionId);
  if (!saveA) {
    ctx.sinMedirBloque(
      "sin disco efímero (stack adoptado con --url/--adoptar): no se puede leer el save, que es " +
        "donde está escrito lo que decidió el bridge",
    );
  } else {
    ctx.expect(
      "el SAVE lo confirma en las dos facetas: `vector` y `vector` (no solo la pantalla)",
      saveA.render === "vector" && saveA.personajes === "vector",
      JSON.stringify(saveA),
    );
  }
  await ctx.shot("A-partida-en-maqueta");

  // ── B · Control: un click enciende Imagen IA, y entonces SÍ gasta ────────
  // Sin este bloque, A sería verde también el día que el atlas dejara de
  // pedirse por cualquier otro motivo.
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME_ID}"]`);
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');

  const escenariosB = await modoActivo(ctx, "#ts-rendermode", "rendermode");
  const personajesB = await modoActivo(ctx, "#ts-charmode", "charmode");
  ctx.expect(
    "UN solo click deja Imagen IA elegida — sin confirmar, sin armar (el gasto lo confirma «Comenzar»)",
    escenariosB.activos.length === 1 && escenariosB.activos[0] === "image",
    JSON.stringify(escenariosB),
  );
  ctx.expect(
    "…y los personajes SIGUEN a escenarios mientras nadie los toque",
    personajesB.activos.length === 1 && personajesB.activos[0] === "image",
    JSON.stringify(personajesB),
  );

  const antesB = await contadores();
  const partidaB = await comenzar(ctx);
  await esperarPartidaEnDisco(ctx, partidaB.sessionId);
  const despuesB = await contadores();
  const dB = delta(antesB, despuesB);
  ctx.log(`partida B (un click en Imagen IA): ${JSON.stringify(dB)}`);
  ctx.expect(
    "con Imagen IA elegida SÍ se manda pintar el atlas: el defecto de A apaga una puerta viva, no una muerta",
    dB.atlasPedido > 0,
    JSON.stringify(dB),
  );

  const saveB = modosDelSave(ctx, partidaB.sessionId);
  if (!saveB) {
    ctx.sinMedirBloque(
      "sin disco efímero (stack adoptado con --url/--adoptar): no se puede leer el save de B, que es " +
        "donde está escrito lo que decidió el bridge",
    );
  } else {
    ctx.expect(
      "y el save de B guarda `image` en las dos facetas",
      saveB.render === "image" && saveB.personajes === "image",
      JSON.stringify(saveB),
    );
  }
  await ctx.shot("B-partida-en-imagen");
}
