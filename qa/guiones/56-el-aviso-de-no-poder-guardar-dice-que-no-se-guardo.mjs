/** Cuando la partida no se puede ESCRIBIR, el muro lo dice — y no culpa al
 *  motor narrativo (#352, criterio 3 de la tanda «Lo que el jugador pierde»).
 *
 *  De los siete emisores que compartían el titular «El motor narrativo rechazó
 *  la respuesta», el guion 50 mide uno (`restore`, el del issue). Este mide
 *  otro, y a propósito el que MÁS lejos está del motor: un `save()` que falla
 *  por permisos (o por disco lleno) no ha pasado por el narrador ni una vez.
 *  Hasta el 2026-09-01 el jugador leía a pantalla completa que el motor había
 *  rechazado una respuesta, encima de un cuerpo que hablaba de su partida
 *  guardada.
 *
 *  Cómo se llega al estado sin trucar nada: se le quita el permiso de
 *  ESCRITURA al directorio del save (`chmod 0500`), que es la única forma
 *  honesta de que `fs.writeFile` dé EACCES — la misma técnica que el guion 52
 *  usa para un borrado rechazado de verdad. Después se contesta al tabernero,
 *  que es el turno que dispara `ctx.narrative.save()` en
 *  `bridge/handlers/dialogue.ts`. El permiso se devuelve SIEMPRE (`finally`):
 *  el disco es el efímero de la corrida, pero dejarlo tocado le rompería el
 *  guion a quien venga después.
 *
 *  PROBADO EN NEGATIVO (2026-09-01, QA de la tanda): devolviendo
 *  `kind: "consequences"` al `catch` del save de `bridge/handlers/dialogue.ts`,
 *  el titular vuelve a ser «El motor narrativo rechazó la respuesta» y los dos
 *  asertos del titular se ponen rojos, con el cuerpo en verde debajo — el
 *  reparto exacto del defecto.
 *
 *  Cero créditos: preset `e2e-sin-creditos`.
 */
import { chmodSync, existsSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
} from "../lib/sesion.mjs";
import { dirDelSave } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  const dir = dirDelSave(partida.sessionId);
  if (!dir || !existsSync(dir)) {
    ctx.sinMedir(
      "esta corrida no tiene disco efímero propio (stack adoptado): sin él no se puede producir " +
        "un EACCES real y el aviso de «no se pudo guardar» no se puede provocar",
    );
    return;
  }

  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta", () => window.__nefan.dialogueVisible || null, 60_000);

  // ── EL DISCO DEJA DE ADMITIR ESCRITURAS ─────────────────────────────────
  let muro = null;
  chmodSync(dir, 0o500);
  try {
    ctx.log(`save de ${partida.sessionId} en solo lectura (chmod 0500)`);
    await ctx.nefan("chooseDialogue", 0);
    muro = await ctx.expectEspera(
      "el aviso de que la partida no se pudo guardar tapa la pantalla",
      true,
      () => {
        const el = document.getElementById("narrative-loader");
        if (!el?.classList.contains("visible") || !el.classList.contains("error")) return null;
        return {
          titulo: document.getElementById("narrative-loader-title")?.textContent ?? "",
          detalle: document.getElementById("narrative-loader-detail")?.textContent ?? "",
          cronometro: document.getElementById("narrative-loader-elapsed")?.textContent ?? "",
        };
      },
      { ms: 90_000 },
    );
  } finally {
    chmodSync(dir, 0o700);
  }

  if (!muro?.ocurrio) {
    ctx.sinMedirBloque(
      "el aviso de guardado no llegó a pintarse: sin muro en pantalla no hay titular que leer",
    );
  }
  const leido = muro.ultimo;
  ctx.log(`muro del guardado: ${JSON.stringify(leido)}`);
  await ctx.shot("titular-del-guardado");
  ctx.expect(
    "#352 · el titular dice QUÉ HA PASADO: no se pudo guardar la partida",
    leido.titulo === "No se pudo guardar la partida",
    JSON.stringify(leido),
  );
  ctx.expect(
    "…y NO culpa al motor narrativo, que aquí no ha intervenido (el fallo es del disco)",
    !/motor narrativo/i.test(leido.titulo) && !/motor narrativo/i.test(leido.detalle),
    JSON.stringify(leido),
  );
  ctx.expect(
    "…y el cuerpo sigue en idioma de jugador: dice qué se arriesga, no el errno",
    leido.detalle.includes("si reanudas") && !/EACCES|errno|ENOSPC/i.test(leido.detalle),
    leido.detalle,
  );
  // QA H-5, y ESTE es el sitio donde puede ponerse rojo: aquí el muro sale en
  // la MISMA carga de página en la que ya corrió el loader del bootstrap
  // («Generando mundo inicial…»), y ni `hideLoader` ni `setLoaderState`
  // borraban su cronómetro — solo paraban el intervalo. Así que bajo el aviso
  // quedaba un «4s» huérfano entre el motivo y «Cerrar»: el reloj de una
  // espera que ya no existe, justo donde el jugador busca qué hacer.
  //
  // El guion 50 NO sirve para esto, y se probó: allí se recarga la página
  // antes de reanudar, así que el elemento nace vacío y el aserto salía verde
  // con y sin el defecto — un verde que no comprueba nada.
  ctx.expect(
    "…y sin el cronómetro de una espera que ya no existe colgando debajo",
    leido.cronometro.trim() === "",
    JSON.stringify(leido.cronometro),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
