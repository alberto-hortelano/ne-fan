/** El selector de mundos CABE en un portátil corriente, y si no cabe lo dice.
 *
 *  #553. A 1440×900 la fila de acciones del selector quedaba cortada contra el
 *  borde inferior de la columna que scrollea: «Continuar →» perdía 17 px de sus
 *  39 (44 %) — el botón que abre la partida, partido por la mitad. Y no había
 *  ninguna señal de que hubiera más abajo, porque el mecanismo que existe
 *  justamente para eso (`actualizarAvisoDeCorte`, la banda `#ts-mas` de #251)
 *  solo miraba `#ts-sessions` y `.ts-save`, que son del HOME: en el selector la
 *  banda se retiraba siempre.
 *
 *  POR QUÉ NINGÚN GUION LO VEÍA. El 33 mide el título a 500×480, que es donde
 *  los mecanismos de layout se ven; a esa altura la lista de mundos se queda muy
 *  por debajo de su tope y la fila de acciones entra sin problema. El corte sale
 *  justo en las alturas de portátil, que es donde nadie miraba.
 *
 *  LAS TRES MITADES:
 *
 *   **A · a 1440×900 el botón se lee ENTERO y se puede pulsar.** No basta con
 *   que su caja quepa: se comprueba que el cursor lo golpea en su centro
 *   (`elementFromPoint`), que es la diferencia entre «está» y «se puede usar».
 *   Y con nada fuera, la banda NO aparece: un aviso que sale siempre no avisa.
 *
 *   **B · cuando algo SÍ queda fuera, la banda lo dice.** Se estrecha la ventana
 *   hasta que la columna no cabe y se afirma que la banda aparece con su texto.
 *   Es la mitad que #553 llama «la que importa»: el corte puede volver por
 *   cualquier pantalla —un botón más, un encabezado que envuelve— y lo que tiene
 *   que sobrevivir es el aviso, no el número.
 *
 *   **C · el home no cambia de idioma.** La banda sigue contando PARTIDAS donde
 *   hay partidas: generalizar el mecanismo no puede costarle al home el dato que
 *   #251 le dio («¿me falta una o me faltan diez?»).
 *
 *  EN NEGATIVO (probado al escribirlo, cada sonda revertida — ver el informe):
 *  devolviendo `max-height: calc(100vh - 220px)` a `#ts-worlds` sale rojo «se lee
 *  ENTERO» con los 17 px de 39 EXACTOS del issue, y de paso «sin nada fuera la
 *  banda NO sale», porque con el botón cortado la banda tiene razón; devolviendo
 *  la guarda `if (!content.querySelector("#ts-sessions")) return` a
 *  `actualizarAvisoDeCorte` sale rojo el bloque B entero.
 *
 *  LO QUE ESA MEDIDA ENSEÑÓ, y va escrito porque contradice una intuición: con
 *  el recorte de 17 px puesto, «se puede PULSAR» sigue en VERDE. El centro
 *  geométrico del botón cae todavía dentro de la parte visible, así que ese
 *  aserto NO es el que caza el corte — es el de la geometría, y el otro cubre
 *  otra cosa (que no lo tape nadie). Se quedan los dos, sabiendo cuál mide qué.
 *
 *  CERO CRÉDITOS: preset `e2e-sin-creditos` (motor falso) y la partida del
 *  bloque C se abre en MAQUETA. NO declara `sinMotor`: el bloque C tiene que
 *  jugar una partida para tener tarjetas en el home que puedan quedarse fuera,
 *  y eso dispara la generación del tile inicial. Lo cazó el guardarraíl la
 *  primera vez que se corrió, con la declaración puesta.
 */
import {
  asentarElLayout,
  comenzar,
  esperarListaDeSaves,
  nuevaPartida,
  recargarAlTitulo,
} from "../lib/sesion.mjs";
import { clonarSaves } from "../lib/saves.mjs";

export const aisla = ["saves"];

const PORTATIL = { width: 1440, height: 900 };
/** Bastante más baja: aquí la columna del selector NO cabe ni con la lista de
 *  mundos en su mínimo, que es lo que hace falta para medir el aviso. */
const BAJA = { width: 1440, height: 560 };

/** La geometría de la fila de acciones contra la columna que la recorta, y la
 *  banda de «hay más abajo». Todo lo que este guion afirma sale de aquí. */
const fotoDelSelector = () => {
  const content = document.getElementById("title-screen").firstElementChild;
  const btn = document.getElementById("ts-continue");
  const mas = document.getElementById("ts-mas");
  const caja = content.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  // ¿Lo golpea el cursor en su centro? El punto se toma DENTRO de la parte
  // visible del botón, no en su centro geométrico: si estuviera medio fuera,
  // el centro podría caer ya bajo la banda o fuera del scroller.
  const golpeado = document.elementFromPoint(
    Math.round(b.left + b.width / 2),
    Math.round(b.top + b.height / 2),
  );
  return {
    ventana: { w: innerWidth, h: innerHeight },
    columna: { top: Math.round(caja.top), bottom: Math.round(caja.bottom), scrollH: content.scrollHeight, clientH: content.clientHeight },
    boton: { top: Math.round(b.top), bottom: Math.round(b.bottom), alto: Math.round(b.height) },
    recorte: Math.max(0, Math.round(b.bottom - caja.bottom)),
    loGolpea: btn.contains(golpeado) || golpeado === btn,
    banda: { visible: mas.hidden === false, texto: (mas.textContent ?? "").trim() },
  };
};

/** Abre el selector desde el título ya pintado. */
async function abrirElSelector(ctx) {
  await ctx.page.click("#ts-new");
  await ctx.page.waitForSelector("[data-game-id]", { timeout: 30_000 });
  await asentarElLayout(ctx);
}

export default async function (ctx) {
  // ─── A · 1440×900: EL BOTÓN ENTERO Y SIN BANDA ─────────────────────────
  await ctx.page.setViewportSize(PORTATIL);
  await recargarAlTitulo(ctx);
  await abrirElSelector(ctx);
  const enPortatil = await ctx.page.evaluate(fotoDelSelector);
  ctx.log(`1440×900 · ${JSON.stringify(enPortatil)}`);
  await ctx.shot("selector-en-portatil-1440x900");

  ctx.expect(
    "PRECONDICIÓN — hay botón y columna que medir (si no, el recorte de abajo sale 0 sin probar nada)",
    enPortatil.boton.alto > 0 && enPortatil.columna.clientH > 0,
    JSON.stringify(enPortatil),
  );
  ctx.expect(
    "a 1440×900 «Continuar →» se lee ENTERO: no lo recorta la columna que scrollea (#553)",
    enPortatil.recorte === 0,
    `recorte ${enPortatil.recorte} px de ${enPortatil.boton.alto} · botón ${enPortatil.boton.top}..${enPortatil.boton.bottom} ` +
      `· columna ${enPortatil.columna.top}..${enPortatil.columna.bottom}`,
  );
  ctx.expect(
    "…y se puede PULSAR: el cursor lo golpea en su centro, no lo tapa nadie",
    enPortatil.loGolpea === true,
    JSON.stringify(enPortatil.boton),
  );
  ctx.expect(
    "…y sin nada fuera la banda NO sale: un aviso que sale siempre no avisa de nada",
    enPortatil.banda.visible === false,
    `banda: "${enPortatil.banda.texto}"`,
  );

  // ─── B · CUANDO ALGO QUEDA FUERA, LA BANDA LO DICE ─────────────────────
  //
  // La ventana baja hasta que la columna del selector no cabe de ninguna
  // manera. Lo que se afirma NO es el recorte —que aquí es legítimo: no hay
  // ventana que valga— sino que el jugador SE ENTERA, que es el mecanismo que
  // esta pantalla no tenía.
  await ctx.page.setViewportSize(BAJA);
  await asentarElLayout(ctx);
  const enBaja = await ctx.expectEspera(
    "con la columna sin caber, la banda avisa de que hay más abajo (#553)",
    true,
    () => {
      const mas = document.getElementById("ts-mas");
      return mas && !mas.hidden && (mas.textContent ?? "").trim() ? mas.textContent.trim() : null;
    },
    { ms: 8_000 },
  );
  const bajaFoto = await ctx.page.evaluate(fotoDelSelector);
  ctx.log(`1440×560 · ${JSON.stringify(bajaFoto)}`);
  await ctx.shot("selector-en-ventana-baja");
  ctx.expect(
    "PRECONDICIÓN — a esta altura la columna DE VERDAD no cabe (si cabe, la banda no mide nada)",
    bajaFoto.columna.scrollH > bajaFoto.columna.clientH,
    `scrollH=${bajaFoto.columna.scrollH} clientH=${bajaFoto.columna.clientH}`,
  );
  ctx.expect(
    "…y la banda cuenta lo que se está escondiendo, en el idioma de esta pantalla",
    /más abajo/.test(String(enBaja.ultimo)) && /desplaza/.test(String(enBaja.ultimo)),
    `"${enBaja.ultimo}"`,
  );

  // ─── C · EL HOME SIGUE CONTANDO PARTIDAS ───────────────────────────────
  //
  // Generalizar el aviso no puede costarle al home el dato que #251 le dio.
  // Hace falta que haya partidas de sobra para que alguna quede fuera: se
  // siembra una y se clona.
  await ctx.page.setViewportSize(PORTATIL);
  await recargarAlTitulo(ctx);
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await ctx.page.click('#ts-rendermode [data-rendermode="vector"]');
  const { sessionId } = await comenzar(ctx);
  clonarSaves(sessionId, 8);
  await ctx.page.setViewportSize(BAJA);
  await recargarAlTitulo(ctx);
  await esperarListaDeSaves(ctx);
  await asentarElLayout(ctx);
  const enElHome = await ctx.expectEspera(
    "en el HOME la banda sigue contando PARTIDAS, no botones (#251 no se pierde)",
    true,
    () => {
      const mas = document.getElementById("ts-mas");
      const t = mas && !mas.hidden ? (mas.textContent ?? "").trim() : "";
      return /partidas? más/.test(t) ? t : null;
    },
    { ms: 8_000 },
  );
  ctx.log(`home en ventana baja · banda: "${enElHome.ultimo}"`);
  await ctx.shot("home-con-la-banda-de-partidas");
}
