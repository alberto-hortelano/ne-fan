/** «VOLVER» DESDE EL EDITOR DE PERSONAJE devuelve lo que el jugador eligió, y
 *  no una pantalla en blanco (#552).
 *
 *  El síntoma, visto por quien juega: eliges un mundo que no es el primero de
 *  la lista, le pones un estilo que no es el suyo, enciendes Imagen IA, pasas
 *  al editor de personaje, te lo piensas mejor y pulsas «← Volver» — y te
 *  encuentras el selector como recién abierto: el PRIMER mundo, el estilo por
 *  defecto de ese mundo y los dos modos al valor de empezar. Las tres
 *  decisiones se perdían por NAVEGAR.
 *
 *  POR QUÉ EN LAS DOS DIRECCIONES, y por qué es lo que decide si este arreglo
 *  cumple la tanda. Con la decisión del usuario del 2026-09-14 dentro
 *  («Nace en Maqueta 3D»), el reinicio ya no manda al jugador a gastar: lo
 *  manda al modo barato. Pero una partida que nace en Maqueta y vuelve a
 *  Imagen IA por navegar rompería esa decisión por el otro lado, y una que
 *  nace en Imagen IA porque el jugador lo pidió y se APAGA por navegar le
 *  quita lo que había elegido igual. Así que el guion afirma los dos sentidos:
 *  lo encendido sigue encendido y lo apagado sigue apagado.
 *
 *  TRES IDAS Y VUELTAS, y cada una mide una cosa que las otras no:
 *   A · El par DISTINTO (escenarios Imagen IA, personajes base y_bot). Es el
 *       caso que separa «conservar» de «reconstruir por el defecto»: con los
 *       dos modos iguales, un arreglo que solo devolviera el de escenarios
 *       saldría verde porque personajes lo SIGUE mientras nadie lo toque.
 *       Aquí no puede: el par que vuelve tiene que ser el par que se fue.
 *   B · Los DOS en Imagen IA, y hasta el save. Se vuelve del editor, se pulsa
 *       «Continuar → Comenzar» y se mira lo que el BRIDGE escribió en disco
 *       (`game_id`, `world.style_id`, `world.render_mode`,
 *       `world.character_mode`): es la única prueba de que lo que se recuperó
 *       en pantalla es lo que se juega, y no un color de borde que nadie lee.
 *   C · Sin tocar NADA. El control de que volver no ENCIENDE lo que estaba
 *       apagado: se entra al editor con los dos modos de fábrica y se vuelve
 *       con los dos de fábrica. Sin este bloque, un arreglo que devolviera
 *       siempre `image` pasaría A y B.
 *
 *  LO QUE NO SE MIDE AQUÍ, dicho para que nadie lo cuente de más: el otro
 *  camino por el que el selector se repinta —una pre-generación que termina
 *  con el jugador delante— lo mide el 108, y que esta memoria NO se filtre
 *  entre visitas al título (lo que el usuario descartó al elegir la opción b)
 *  lo mide el 116. Y nada de esto se puede afirmar en Node: por #543 ninguna
 *  hoja del título se importa fuera del navegador.
 *
 *  Cero créditos: preset `e2e-sin-creditos` del runner. El bloque B arranca
 *  una partida en Imagen IA y «paga» al motor falso, que es el punto.
 */
import { readFileSync } from "node:fs";

import { abrirSelectorDeMundos, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, rutaDelSave } from "../lib/saves.mjs";

export const aisla = ["saves"];

/** El borde con el que el selector pinta lo ACTIVO (`#da6` de `atomos.ts`). */
const BORDE_ACTIVO = "rgb(221, 170, 102)";

/** TODO lo que el jugador tiene elegido en el selector, leído como lo lee él:
 *  del color del borde y del valor del desplegable, nunca de una variable del
 *  módulo. Devuelve también los catálogos (mundos, opciones de estilo) porque
 *  este guion tiene que ELEGIR lo que no viene puesto, y esa elección no puede
 *  estar escrita a mano: los mundos y los packs instalados cambian. */
function estadoDelSelector(borde) {
  const tarjetas = [...document.querySelectorAll("[data-game-id]")];
  const fila = (sel, attr) => {
    const botones = [...document.querySelectorAll(`${sel} [data-${attr}]`)];
    return {
      activos: botones.filter((b) => b.style.borderColor === borde).map((b) => b.dataset[attr]),
      hay: botones.length,
    };
  };
  const desplegable = document.getElementById("ts-style");
  const activa = tarjetas.find((c) => c.style.borderColor === borde);
  const id = activa?.dataset.gameId;
  return {
    // LA TARJETA también habla del estilo, y por dos vías: el rótulo de al lado
    // del título y la PORTADA, que lleva el `style_id` en `data-cover-img`. Si
    // el desplegable dice una cosa y la tarjeta otra, la pantalla se
    // contradice a sí misma delante del jugador.
    rotulo: id ? (document.querySelector(`[data-style-label-for="${CSS.escape(id)}"]`)?.textContent ?? null) : null,
    portada: id
      ? (document.querySelector(`[data-cover-for="${CSS.escape(id)}"] [data-cover-img]`)?.dataset.coverImg ?? null)
      : null,
    mundo: activa?.dataset.gameId ?? null,
    mundos: tarjetas.map((c) => c.dataset.gameId),
    estilo: desplegable?.value ?? null,
    estilos: [...(desplegable?.options ?? [])].map((o) => o.value),
    escenarios: fila("#ts-rendermode", "rendermode"),
    personajes: fila("#ts-charmode", "charmode"),
  };
}

const leer = (ctx) => ctx.page.evaluate(estadoDelSelector, BORDE_ACTIVO);

/** Lo elegido, en la forma corta con la que se compara antes/después. */
const foto = (e) => ({
  mundo: e.mundo,
  estilo: e.estilo,
  escenarios: e.escenarios.activos.join(","),
  personajes: e.personajes.activos.join(","),
  rotulo: e.rotulo,
  portada: e.portada,
});

/** Ida y vuelta por el editor de personaje, por los botones del jugador. */
async function idaYVueltaPorElEditor(ctx) {
  await ctx.page.click("#ts-continue");
  await ctx.page.waitForSelector("#ts-start", { timeout: 30_000 });
  await ctx.page.click("#ts-back");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
}

export default async function (ctx) {
  // ── A · El par DISTINTO: Imagen IA en escenarios, base y_bot en personajes ──
  await abrirSelectorDeMundos(ctx);
  const alAbrir = await leer(ctx);
  ctx.log(`mundos ofrecidos: ${JSON.stringify(alAbrir.mundos)}`);
  ctx.expect(
    "el título ofrece más de un mundo (sin eso, «se pierde el mundo» no se puede ejercer)",
    alAbrir.mundos.length >= 2,
    JSON.stringify(alAbrir.mundos),
  );
  // El ÚLTIMO, que es justo el que el fallback `games[0]` no puede acertar.
  const mundo = alAbrir.mundos[alAbrir.mundos.length - 1];
  await ctx.page.click(`[data-game-id="${mundo}"]`);

  const conMundo = await leer(ctx);
  ctx.log(`estilos ofrecidos para ${mundo}: ${JSON.stringify(conMundo.estilos)} (puesto: ${conMundo.estilo})`);
  // Un estilo que no es el de ESTE mundo Y TAMPOCO el del primero de la lista.
  // La segunda condición no es celo: con el catálogo del bench, el defecto de
  // `toledo_1200` es `medievo_crudo` y el de `alta_fantasia` —el mundo al que
  // caía el fallback roto— es `acuarela_luminosa`, que también se le ofrece a
  // toledo. Eligiendo ése, la afirmación del estilo salía VERDE con el arreglo
  // desmontado: medida en el negativo, no supuesta.
  const estilo =
    conMundo.estilos.find((s) => s !== conMundo.estilo && s !== alAbrir.estilo) ??
    conMundo.estilos.find((s) => s !== conMundo.estilo);
  ctx.expect(
    `«${mundo}» ofrece un estilo que no es ni el suyo ni el del primer mundo (o «se pierde el estilo» no se ejerce)`,
    estilo !== undefined && estilo !== alAbrir.estilo,
    `${JSON.stringify(conMundo.estilos)} · el del primer mundo: ${alAbrir.estilo}`,
  );
  await ctx.page.selectOption("#ts-style", estilo);
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');
  await ctx.page.click('#ts-charmode [data-charmode="vector"]');

  const antesA = await leer(ctx);
  ctx.log(`A · lo elegido antes de entrar al editor: ${JSON.stringify(foto(antesA))}`);
  ctx.expect(
    "A · el punto de partida es el que se quiso: mundo ≠ el primero, estilo ≠ el puesto y los dos modos DISTINTOS entre sí",
    antesA.mundo === mundo &&
      antesA.estilo === estilo &&
      antesA.escenarios.activos.join(",") === "image" &&
      antesA.personajes.activos.join(",") === "vector",
    JSON.stringify(foto(antesA)),
  );
  await ctx.shot("A-antes-del-editor");

  await idaYVueltaPorElEditor(ctx);
  const despuesA = await leer(ctx);
  ctx.log(`A · lo que hay tras «Volver»: ${JSON.stringify(foto(despuesA))}`);
  await ctx.shot("A-tras-volver");
  ctx.expect(
    "A · «Volver» devuelve el MUNDO elegido, no el primero de la lista",
    despuesA.mundo === mundo,
    `${mundo} → ${despuesA.mundo}`,
  );
  ctx.expect(
    "A · …y el ESTILO elegido, no el del mundo",
    despuesA.estilo === estilo,
    `${estilo} → ${despuesA.estilo}`,
  );
  ctx.expect(
    "A · …y los DOS modos, que eran distintos entre sí: Imagen IA en escenarios y base y_bot en personajes",
    despuesA.escenarios.activos.join(",") === "image" &&
      despuesA.personajes.activos.join(",") === "vector",
    JSON.stringify(foto(despuesA)),
  );
  ctx.expect(
    "A · y sigue habiendo UN solo botón marcado en cada fila (no se recupera pintando los dos)",
    despuesA.escenarios.activos.length === 1 && despuesA.personajes.activos.length === 1,
    JSON.stringify(foto(despuesA)),
  );
  ctx.expect(
    "A · …y la TARJETA no se contradice con el desplegable: su rótulo y su portada son los del estilo recuperado",
    despuesA.rotulo === antesA.rotulo && despuesA.portada === antesA.portada && despuesA.portada === estilo,
    `rótulo «${antesA.rotulo}» → «${despuesA.rotulo}» · portada ${antesA.portada} → ${despuesA.portada} (estilo elegido: ${estilo})`,
  );

  // ── B · Los dos en Imagen IA, y comprobado en el SAVE ────────────────────
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${mundo}"]`);
  await ctx.page.selectOption("#ts-style", estilo);
  await ctx.page.click('#ts-rendermode [data-rendermode="image"]');

  const antesB = await leer(ctx);
  ctx.expect(
    "B · un click en Imagen IA deja los DOS modos encendidos (personajes sigue a escenarios mientras nadie los toque)",
    antesB.escenarios.activos.join(",") === "image" && antesB.personajes.activos.join(",") === "image",
    JSON.stringify(foto(antesB)),
  );

  await idaYVueltaPorElEditor(ctx);
  const despuesB = await leer(ctx);
  ctx.log(`B · antes ${JSON.stringify(foto(antesB))} · después ${JSON.stringify(foto(despuesB))}`);
  ctx.expect(
    "B · volver NO apaga la Imagen IA que el jugador encendió, ni en escenarios ni en personajes",
    despuesB.escenarios.activos.join(",") === "image" &&
      despuesB.personajes.activos.join(",") === "image",
    JSON.stringify(foto(despuesB)),
  );

  const partida = await comenzar(ctx);
  await esperarPartidaEnDisco(ctx, partida.sessionId);
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) {
    ctx.sinMedirBloque(
      "sin disco efímero (stack adoptado con --url/--adoptar): no se puede leer el save, que es " +
        "donde está escrito lo que el bridge congeló de la elección recuperada",
    );
  } else {
    const save = JSON.parse(readFileSync(ruta, "utf8"));
    const enDisco = {
      mundo: save.game_id,
      estilo: save.world?.style_id,
      escenarios: save.world?.render_mode,
      personajes: save.world?.character_mode,
    };
    ctx.log(`B · lo que el bridge congeló en el save: ${JSON.stringify(enDisco)}`);
    ctx.expect(
      "B · la partida que ARRANCA tras volver es la que se eligió antes de entrar al editor: mundo, estilo y los dos modos en el save",
      enDisco.mundo === mundo &&
        enDisco.estilo === estilo &&
        enDisco.escenarios === "image" &&
        enDisco.personajes === "image",
      `${JSON.stringify(enDisco)} vs ${JSON.stringify(foto(antesB))}`,
    );
  }
  await ctx.shot("B-partida-con-lo-recuperado");

  // ── C · Control: volver no ENCIENDE lo que estaba apagado ────────────────
  await recargarAlTitulo(ctx);
  await abrirSelectorDeMundos(ctx);
  const antesC = await leer(ctx);
  ctx.expect(
    "C · sin tocar nada, el selector viene en Maqueta 3D en las dos filas (la decisión del 2026-09-14)",
    antesC.escenarios.activos.join(",") === "vector" && antesC.personajes.activos.join(",") === "vector",
    JSON.stringify(foto(antesC)),
  );

  await idaYVueltaPorElEditor(ctx);
  const despuesC = await leer(ctx);
  ctx.log(`C · antes ${JSON.stringify(foto(antesC))} · después ${JSON.stringify(foto(despuesC))}`);
  ctx.expect(
    "C · volver del editor tampoco ENCIENDE Imagen IA: lo que estaba en Maqueta sigue en Maqueta",
    despuesC.escenarios.activos.join(",") === "vector" &&
      despuesC.personajes.activos.join(",") === "vector",
    JSON.stringify(foto(despuesC)),
  );
  ctx.expect(
    "C · y el mundo y el estilo tampoco se mueven de donde estaban",
    despuesC.mundo === antesC.mundo && despuesC.estilo === antesC.estilo,
    `${JSON.stringify(foto(antesC))} → ${JSON.stringify(foto(despuesC))}`,
  );
  await ctx.shot("C-de-fabrica-tras-volver");
}
