/** «Borrar una partida puede fallar sin decirlo» (#365), medido en la pantalla.
 *
 *  `deleteSession` devolvía `res.ok` como booleano y el título lo TIRABA: un
 *  borrado rechazado por el bridge era un no-op mudo. El jugador pulsaba
 *  Borrar, la lista se repintaba igual —`renderHome` la reelee, así que la
 *  tarjeta volvía al instante— y no había ni una línea que dijera por qué.
 *  Y el `ok:false` colapsaba además DOS causas que el almacén sí distingue:
 *  «no estaba» (ENOENT) y «no se pudo» (EACCES/EBUSY).
 *
 *  El TIPO canda la mitad de arriba: desde #365 el frame es una unión
 *  discriminada y un `failed` sin motivo no compila. Lo que ningún tipo puede
 *  ver es la PANTALLA — que la tarjeta siga donde estaba y que el motivo se
 *  lea—, y `nefan-html` no tiene suite ni entra en mutación. De ahí este
 *  guion, que recorre los TRES desenlaces por el camino del jugador: el botón
 *  Borrar y su `confirm()`.
 *
 *  LOS FALLOS SE INYECTAN EN EL BORDE, no dentro del cliente:
 *   · `failed` — se le quita el permiso de escritura al directorio del save,
 *     así que `fs.rm` da EACCES de verdad. No se toca una sola línea de
 *     código: es el estado del sistema (un save en un volumen de solo
 *     lectura, un fichero abierto por otro proceso).
 *   · `not_found` — el save se borra por el cable del bridge mientras el
 *     título sigue enseñando su tarjeta. Es el mismo repro que usa el 18.
 *
 *  PROBADO EN NEGATIVO (2026-09-01): devolviendo `deleteSession` a
 *  `return res.ok` y el título a descartarlo, el bloque 1 se pone rojo — la
 *  pantalla no dice nada y la tarjeta se comporta igual que en un borrado
 *  bueno.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { chmodSync, existsSync } from "node:fs";

import {
  borrarSaveComoOtroCliente,
  comenzar,
  nuevaPartida,
  recargarAlTitulo,
} from "../lib/sesion.mjs";
import { clonarSaves, dirDelSave } from "../lib/saves.mjs";

export const aisla = ["saves"];

/** Ids de las tarjetas que el título está enseñando AHORA. */
const idsEnPantalla = () =>
  [...document.querySelectorAll("button[data-action=delete]")].map((b) => b.dataset.sessionId);

/** El texto del aviso del título (`#ts-error`), vacío si no hay ninguno. */
const avisoDelTitulo = () => document.getElementById("ts-error")?.textContent?.trim() ?? "";

/** El color con el que se pinta ese aviso. No es leer píxeles: es el estilo
 *  inline que el título ESCRIBE, y es lo que distingue de un vistazo un fallo
 *  («no se pudo») de un éxito raro («ya no estaba»), que es la mitad del
 *  criterio 1b que el texto por sí solo no cubre. */
const colorDelAviso = () =>
  document.getElementById("ts-error")?.querySelector("span")?.style.color ?? "";

/** Pulsa Borrar de una tarjeta y espera a que el título ACABE de reaccionar:
 *  o el aviso cambió, o la tarjeta desapareció. Nunca por reloj. */
async function pulsarBorrar(ctx, id, desc) {
  const avisoPrevio = await ctx.page.evaluate(avisoDelTitulo);
  await ctx.page.click(`button[data-action="delete"][data-session-id="${id}"]`);
  return ctx.waitFor(
    desc,
    ([sid, previo]) => {
      const el = document.getElementById("ts-error");
      const aviso = el?.textContent?.trim() ?? "";
      const tarjetas = [...document.querySelectorAll("button[data-action=delete]")].map(
        (b) => b.dataset.sessionId,
      );
      // Sigue esperando mientras no haya pasado nada… Y TAMBIÉN si la lista
      // está VACÍA, que es un estado INTERMEDIO y no un desenlace: el título
      // repinta las tarjetas enteras, así que hay un frame en el que no hay
      // ninguna. Sin esta guarda, `waitFor` devolvía esa foto —la tarjeta
      // borrada ya no está, luego «listo»— y el último aserto del guion leía
      // `tarjetas: []` y se ponía rojo por el motivo equivocado: la partida
      // jugada no se había borrado, es que aún no se había vuelto a pintar.
      // Aquí la lista nunca puede quedarse legítimamente a cero (la partida
      // real sobrevive a los tres borrados), así que vacía = todavía no.
      if ((aviso === previo && tarjetas.includes(sid)) || tarjetas.length === 0) return null;
      // El borde de ESTA tarjeta y el de otra cualquiera. Se comparan porque
      // `sessionRowHtml` ya pinta un borde inline a todas: mirar solo «tiene
      // borderColor» era un verde que no podía ponerse rojo (probado: con la
      // marca quitada seguía pasando). Lo que hay que afirmar es la
      // DIFERENCIA con sus vecinas.
      const borde = (e) => (e instanceof HTMLElement ? e.style.borderColor : "");
      const filas = [...document.querySelectorAll(".ts-save")];
      const mia = document
        .querySelector(`button[data-action="delete"][data-session-id="${sid}"]`)
        ?.closest(".ts-save");
      return {
        aviso,
        tarjetas,
        sigue: tarjetas.includes(sid),
        color: el?.querySelector("span")?.style.color ?? "",
        marcada: borde(mia),
        vecinas: filas.filter((f) => f !== mia).map(borde),
      };
    },
    30_000,
    [id, avisoPrevio],
  );
}

export default async function (ctx) {
  // El botón Borrar abre un `confirm()`, que Playwright DESCARTA por defecto:
  // sin este handler el guion mediría un borrado que nunca se pidió.
  ctx.page.on("dialog", (d) => void d.accept());

  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  const { sessionId } = await comenzar(ctx);

  // Dos copias baratas del save real: hacen falta tres tarjetas para recorrer
  // los tres desenlaces, y jugar tres arranques del motor falso para medir un
  // borrado sería pagar minutos por nada (mismo criterio que el guion 33).
  const [paraFallar, paraNoEstar] = clonarSaves(sessionId, 2);
  ctx.log(`saves: real=${sessionId} · fallo=${paraFallar} · fantasma=${paraNoEstar}`);

  const dirFallo = dirDelSave(paraFallar);
  if (!dirFallo || !existsSync(dirFallo)) {
    ctx.sinMedir(
      "esta corrida no tiene disco efímero propio (stack adoptado): sin él no se puede " +
        "producir un EACCES real y los tres desenlaces no se pueden distinguir",
    );
    return;
  }

  await recargarAlTitulo(ctx);
  const alPrincipio = await ctx.page.evaluate(idsEnPantalla);
  ctx.log(`tarjetas en el título: ${JSON.stringify(alPrincipio)}`);

  // ── 1 · FAILED: el borrado se rechaza, y se NOTA ────────────────────────
  // Sin permiso de escritura en el directorio, `fs.rm` no puede desenlazar
  // `state.json`: EACCES, y el save queda intacto.
  chmodSync(dirFallo, 0o500);
  let tras;
  try {
    tras = await pulsarBorrar(ctx, paraFallar, "el título reacciona al borrado rechazado");
  } finally {
    chmodSync(dirFallo, 0o700);
  }
  await ctx.shot("borrado-rechazado");
  ctx.log(`#ts-error: ${tras.aviso}`);

  ctx.expect(
    "una partida que NO se pudo borrar sigue en la lista del título",
    tras.sigue,
    `tarjetas: ${JSON.stringify(tras.tarjetas)}`,
  );
  ctx.expect(
    "…y el jugador lee POR QUÉ, sin abrir la consola",
    tras.aviso.includes(paraFallar) && /no pudo borrarla|no se pudo borrar/i.test(tras.aviso),
    tras.aviso || "(el título no dijo nada: el no-op mudo de #365)",
  );
  ctx.expect(
    "…con la causa técnica dentro, que es lo que hace accionable el aviso",
    /EACCES|permission|delete_session_failed/i.test(tras.aviso),
    tras.aviso,
  );
  // Lo primero que se lee tiene que ser qué pasa y qué hacer, no una ruta
  // absoluta de tres líneas: la causa técnica va DETRÁS, no delante.
  ctx.expect(
    "…y antes de la ruta hay una frase que dice qué hacer y que no se perdió nada",
    /no se ha perdido nada/i.test(tras.aviso) && /permisos/i.test(tras.aviso) &&
      tras.aviso.indexOf("EACCES") > tras.aviso.indexOf("no se ha perdido nada"),
    tras.aviso,
  );
  // El aviso vive a media pantalla de la tarjeta y el único vínculo era un id
  // de veinte caracteres: en una lista de doce saves, cuál falló era un
  // ejercicio de comparar cadenas.
  ctx.expect(
    "…y la tarjeta que falló se DISTINGUE de sus vecinas, no solo por un id opaco",
    tras.marcada !== "" && tras.vecinas.length > 0 &&
      tras.vecinas.every((b) => b !== tras.marcada),
    `la que falló: "${tras.marcada}" · las demás: ${JSON.stringify(tras.vecinas)}`,
  );

  // ── 2 · NOT_FOUND: «no estaba» no se disfraza de fallo ───────────────────
  // El save desaparece del disco mientras el título sigue enseñando su
  // tarjeta. Antes esto era el MISMO `ok:false` que el caso de arriba.
  await borrarSaveComoOtroCliente(ctx, paraNoEstar);
  const fantasma = await pulsarBorrar(ctx, paraNoEstar, "el título reacciona a la tarjeta rancia");
  ctx.log(`#ts-error: ${fantasma.aviso}`);
  ctx.expect(
    "borrar una partida que ya no estaba QUITA su tarjeta (el save no está: es lo que se quería)",
    !fantasma.sigue,
    `tarjetas: ${JSON.stringify(fantasma.tarjetas)}`,
  );
  ctx.expect(
    "…y se dice que no había nada que borrar, en vez de callarlo o darlo por fallo",
    /ya no estaba|no había nada que borrar/i.test(fantasma.aviso) &&
      !/no pudo borrarla/i.test(fantasma.aviso),
    fantasma.aviso || "(sin aviso: «no estaba» y «borrada» vuelven a verse igual)",
  );
  // Y se VE distinto, no solo se lee distinto: para quien pulsó Borrar esto es
  // un éxito, y se pintaba con el mismo rojo de error que «no se pudo». Quien
  // ojea la pantalla ve el bloque de color, no la frase.
  ctx.expect(
    "…y NO se pinta con el rojo de un fallo: para el jugador esto salió bien",
    fantasma.color !== "" && fantasma.color !== tras.color,
    `«no estaba» → ${fantasma.color} · «no se pudo» → ${tras.color}`,
  );

  // ── 3 · DELETED: el caso bueno sigue siendo silencioso y limpio ──────────
  const bueno = await pulsarBorrar(ctx, paraFallar, "el título reacciona al borrado bueno");
  await ctx.shot("borrado-bueno");
  ctx.expect(
    "un borrado que SÍ ocurre quita la tarjeta",
    !bueno.sigue,
    `tarjetas: ${JSON.stringify(bueno.tarjetas)}`,
  );
  ctx.expect(
    "…y no deja ningún aviso: el éxito no se anuncia",
    bueno.aviso === "",
    bueno.aviso,
  );
  ctx.expect(
    "el save de la partida jugada sigue intacto: se borró lo que se pidió y nada más",
    bueno.tarjetas.includes(sessionId),
    `tarjetas: ${JSON.stringify(bueno.tarjetas)}`,
  );
}
