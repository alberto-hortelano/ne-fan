/** Un save anterior a la retirada del terreno por chars NO carga — y el
 *  jugador lee una salida, no un cuelgue (#335).
 *
 *  Desde #335 el terreno tiene UN origen: el motor declara `biome` +
 *  `ground`/`volumes`, el engine sintetiza el grid para colisión y costuras, y
 *  la solidez la fija `DEFAULT_SOLID_CHARS` (agua y muro). Los dos campos con
 *  los que antes se declaraba terreno por chars —una leyenda char→nombre y
 *  solidez, y parches ASCII sobre el bioma— están retirados y el zod los
 *  REBOTA por nombre en las dos poblaciones de escena
 *  (`nefan-core/src/contract/model-io/retired-terrain-fields.ts`, la única
 *  fuente de sus nombres: este guion los LEE de ahí y no los escribe, porque
 *  `campos-retirados-no-vuelven` caza los identificadores en qa/**).
 *
 *  La vía real por la que vuelven no es el motor (el prompt ya no los enseña):
 *  es un save de antes de la retirada. Los once saves locales del 2026-09-02
 *  llevan la leyenda dentro, y si `loadSession` los aceptara con el
 *  `.passthrough()` de la escena, viviría para siempre en `scene_data`,
 *  volvería al motor por `serializeForLlm` y —con la forma vieja
 *  `{w:{solid:false}}`— abriría el río sin que nadie lo hubiera pedido.
 *
 *  Lo que se mide, por el camino real (partida jugada → save de DISCO con el
 *  campo viejo → resume):
 *   1. PROTOCOLO: el resume de un save con cada campo retirado contesta
 *      `save_invalido` nombrando save, escena, el CAMPO y qué hacer con él
 *      («bórralo o regenéralo»).
 *   2. JUGADOR: pulsar «Reanudar» sobre esa tarjeta vuelve al título con un
 *      error que dice la única salida real (borrar la partida o empezar otra),
 *      sin el nombre interno del campo y sin montar el mundo viejo.
 *   3. Restaurado el fichero, el mismo resume carga: el rechazo era del
 *      contenido, no de la ruta.
 *
 *  Probado en negativo (2026-09-02, QA #335): con `refineRetiredTerrainFields`
 *  vaciado a mano (el `for` con `continue` incondicional), el bloque 1 se pone
 *  rojo en «…contesta save_invalido nombrando el campo» —el save con la
 *  leyenda carga entero— y el bloque 2 en «el título vuelve con un error
 *  visible». El guion distingue el mundo con rebote del mundo sin él.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** La fuente única de los nombres retirados. Se lee como texto porque el
 *  runner es node a secas (sin tsx) y el fichero es TypeScript. */
const FUENTE = fileURLToPath(
  new URL("../../nefan-core/src/contract/model-io/retired-terrain-fields.ts", import.meta.url),
);

function camposRetirados() {
  const src = readFileSync(FUENTE, "utf8");
  const m = src.match(/RETIRED_TERRAIN_FIELDS\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error(`no encuentro RETIRED_TERRAIN_FIELDS en ${FUENTE}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** El valor viejo que llevaría un save de aquella era: la forma más peligrosa
 *  de la leyenda (un vado sobre el agua) y un parche ASCII sobre el bioma. El
 *  rebote es por PRESENCIA, así que el valor no decide; se pone el real para
 *  que la captura y el log enseñen lo que habría vuelto al motor. */
function valorViejo(campo) {
  return /legend/.test(campo) ? { w: { name: "vado del río", solid: false } } : [{ at: [0, 0], rows: ["ww", "ww"] }];
}

/** Lo que el jugador tiene que leer: la salida real, no «inténtalo de nuevo»
 *  (reintentar un save roto falla siempre). */
const SALIDA_PARA_EL_JUGADOR = /ya no vale para esta versión del juego.*bórrala o empieza una nueva/;

/** Un resume_session crudo por el cable del bridge, DESDE la página (misma
 *  receta que el guion 46: la URL la da el propio juego con sus overrides). */
async function resumePorElCable(ctx, sessionId) {
  return ctx.page.evaluate(
    (sid) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar a resume_session`));
        };
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-62" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-62") return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    sessionId,
  );
}

export default async function (ctx) {
  const campos = camposRetirados();
  ctx.log(`campos retirados según la fuente: ${campos.join(", ")}`);
  ctx.expect("la fuente declara al menos un campo retirado (si no, nada de abajo mide)", campos.length > 0);
  if (campos.length === 0) return;

  // ── 0. Una partida real, jugada por el camino del jugador ────────────────
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  const salud = await (await fetch(`${URLS.state_api}/health`)).json();
  const sessionId = salud?.session_id;
  ctx.expect("la partida tiene sesión viva en el State API", Boolean(sessionId), JSON.stringify(salud));
  if (!sessionId) return;
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  ctx.expect("el save está en el disco efímero de la corrida", Boolean(ruta), String(sessionId));
  if (!ruta) return; // contra un stack adoptado este guion no puede medir

  // Al título: el bridge queda quieto y el fichero deja de reescribirse.
  await recargarAlTitulo(ctx);

  const original = readFileSync(ruta, "utf8");
  const escenas = Object.keys(JSON.parse(original).scenes_loaded ?? {});
  ctx.expect("el save tiene al menos una escena que envejecer", escenas.length > 0, JSON.stringify(escenas));
  if (escenas.length === 0) return;
  const escena = escenas[0];
  const conCampoViejo = (campo) => {
    const data = JSON.parse(original);
    data.scenes_loaded[escena].scene_data[campo] = valorViejo(campo);
    return JSON.stringify(data);
  };

  // ── 1. PROTOCOLO: cada campo retirado → save_invalido por NOMBRE ─────────
  for (const campo of campos) {
    const viejo = conCampoViejo(campo);
    writeFileSync(ruta, viejo);
    const res = await resumePorElCable(ctx, sessionId);
    ctx.expect(
      `el resume de un save con ${campo} contesta save_invalido nombrando el campo (no carga mudo)`,
      res.ok === false && /^save_invalido:/.test(res.error) && res.error.includes(`campo \`${campo}\``),
      JSON.stringify(res),
    );
    ctx.expect(
      `…y el motivo de ${campo} nombra el save, la escena y qué hacer (bórralo o regenéralo)`,
      res.error.includes(sessionId) && res.error.includes(`"${escena}"`) && /bórralo o regenéralo/.test(res.error),
      res.error,
    );
    ctx.expect(
      `el fichero con ${campo} sigue intacto tras el intento (nadie lo saneó ni lo «reparó»)`,
      readFileSync(ruta, "utf8") === viejo,
      ruta,
    );
  }

  // ── 2. JUGADOR: «Reanudar» sobre el save viejo no cuelga ni carga ────────
  const primero = campos[0];
  writeFileSync(ruta, conCampoViejo(primero));
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece la tarjeta del save (el jugador no sabe que es de otra era)", Boolean(tarjeta), sessionId);
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "el título vuelve con un error visible (no un cuelgue, no el mundo viejo)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "lo que lee dice la única salida real: borrar la partida o empezar otra (no «inténtalo de nuevo»)",
      SALIDA_PARA_EL_JUGADOR.test(aviso ?? ""),
      String(aviso),
    );
    ctx.expect(
      "…y no le enseña el nombre interno del campo: eso va al panel de errores, no al título",
      !(aviso ?? "").includes(primero),
      String(aviso),
    );
    ctx.expect(
      "tras el intento no hay escena montada: el mundo viejo no llegó al cliente",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("titulo-tras-reanudar-save-de-otra-era");
  }

  // ── 3. El save vuelve a ser el bueno y la partida REVIVE de verdad ───────
  writeFileSync(ruta, original);
  const res3 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "restaurado el fichero, el mismo resume carga (el rechazo era por el contenido, no por la ruta)",
    res3.ok === true,
    JSON.stringify(res3),
  );
}
