/** Un save que NO VALE no revive, y el fallo es ruidoso y distinguible (#334/#336).
 *
 *  Desde la tanda «Las puertas del contrato», `loadSession` valida cada escena
 *  del save contra `ExpandedSceneSchema` y exige `schema_version` exacta: un
 *  save corrupto (el caso #300: `footprint:[8,8]` en un kind móvil) o de una
 *  era anterior LANZA en vez de cargar, y el bridge contesta al resume con
 *  `session_started ok:false error:"save_invalido: …"` — un canal DISTINTO de
 *  `session_not_found`. Antes ese save cargaba entero y el NPC se pintaba a
 *  1,75 m de donde el sim lo tenía; o, con versión rara, `loadSession` devolvía
 *  `false` y el jugador leía «esa partida ya no está en el disco», que es
 *  mentira (está, y el mensaje le escondía el motivo).
 *
 *  Lo que se mide, por el camino real (partida jugada → save de DISCO
 *  corrompido → resume):
 *   1. PROTOCOLO: el resume de un save con una entity que viola el contrato
 *      responde `save_invalido` nombrando save, escena, entity y campo — y el
 *      de un id inexistente sigue siendo `session_not_found` (distinguibles).
 *   2. PROTOCOLO: el resume de un save `schema_version: 4` (contenido válido)
 *      responde `save_invalido` nombrando la versión.
 *   3. JUGADOR: pulsar «Reanudar» sobre la tarjeta del save corrupto no cuelga
 *      ni monta un mundo corrupto: vuelve al título con un error visible.
 *
 *  El texto que el jugador LEE en ese error se registra (ctx.log) pero no se
 *  asserta: hoy `motivoDeSesionParaElJugador` no tiene rama para
 *  `save_invalido` y cae al genérico «inténtalo de nuevo» — hallazgo abierto
 *  del QA de la tanda, no criterio de este guion.
 *
 *  Probado en negativo (2026-08-31): con el gate de `loadSession` neutralizado
 *  a mano (safeParse ignorado + versión tolerada), el bloque 1 se pone rojo en
 *  «…contesta save_invalido» (el resume carga el save corrupto) — el guion
 *  distingue el mundo con puerta del mundo sin ella.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** La entity del caso #300: kind móvil con footprint de edificio. El contrato
 *  (`EntitySchema`, huella ≤ cuerpo del sim) la rechaza en ambos schemas. */
const ENTITY_IMPOSIBLE = {
  id: "qa_gigante",
  kind: "npc",
  name: "Gigante del guion 46",
  cell: [1, 1],
  footprint: [8, 8],
  glyph: "n",
};

/** Un resume_session crudo por el cable del bridge, DESDE la página (la URL
 *  la da el propio juego, con sus overrides de query — mismo patrón que
 *  `listarPorElBridge` en qa/lib/saves.mjs). Devuelve el `session_started`. */
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
          ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-46" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-46") return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    sessionId,
  );
}

export default async function (ctx) {
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

  // Al título: el bridge queda quieto (sin generación en vuelo) y el fichero
  // deja de reescribirse — la corrupción de abajo no compite con un save().
  await recargarAlTitulo(ctx);

  const original = readFileSync(ruta, "utf8");
  const conEntityRota = () => {
    const data = JSON.parse(original);
    const escenas = Object.keys(data.scenes_loaded ?? {});
    if (escenas.length === 0) throw new Error("el save no tiene escenas: el guion no puede corromperlo");
    data.scenes_loaded[escenas[0]].scene_data.entities.push(ENTITY_IMPOSIBLE);
    return { json: JSON.stringify(data), escena: escenas[0] };
  };

  // ── 1. PROTOCOLO: entity que viola el contrato → save_invalido ───────────
  const rota = conEntityRota();
  writeFileSync(ruta, rota.json);
  const res1 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "el resume de un save con una entity ilegal contesta save_invalido (no carga, no session_not_found)",
    res1.ok === false && /^save_invalido:/.test(res1.error),
    JSON.stringify(res1),
  );
  ctx.expect(
    "…y el motivo nombra save, escena, entity y campo (accionable para quien mire el log)",
    res1.error.includes(sessionId) &&
      res1.error.includes(`"${rota.escena}"`) &&
      res1.error.includes('"qa_gigante"') &&
      res1.error.includes("footprint"),
    res1.error,
  );
  // La corrupción sigue en el disco: si algo la hubiera reescrito entre medias
  // (un save() del bridge), los asserts de arriba habrían medido otra cosa.
  ctx.expect(
    "el fichero corrupto sigue intacto tras el intento (nadie lo reescribió ni lo «reparó»)",
    readFileSync(ruta, "utf8") === rota.json,
    ruta,
  );

  // …y un id que NO existe sigue por el otro canal, que es la distinción
  // que #334 vino a crear (antes ambos colapsaban en `false`).
  const res2 = await resumePorElCable(ctx, "qa_fantasma_46");
  ctx.expect(
    "un save inexistente sigue siendo session_not_found (canal distinguible)",
    res2.ok === false && res2.error === "session_not_found",
    JSON.stringify(res2),
  );

  // ── 2. PROTOCOLO: versión de otra era → save_invalido con la versión ─────
  const dataV4 = JSON.parse(original);
  dataV4.schema_version = 4;
  writeFileSync(ruta, JSON.stringify(dataV4));
  const res3 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "el resume de un save schema_version:4 contesta save_invalido nombrando la versión",
    res3.ok === false && /^save_invalido:/.test(res3.error) && /schema_version 4/.test(res3.error),
    JSON.stringify(res3),
  );

  // ── 3. JUGADOR: «Reanudar» sobre el save corrupto no cuelga ni carga ─────
  writeFileSync(ruta, rota.json);
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece la tarjeta del save (el jugador no sabe que está corrupto)", Boolean(tarjeta), sessionId);
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "el título vuelve con un error visible (no un cuelgue, no un mundo corrupto)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "tras el intento no hay escena montada: el mundo corrupto no llegó al cliente",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("titulo-tras-reanudar-save-corrupto");
  }

  // ── 4. El save vuelve a ser el bueno y la partida REVIVE de verdad ───────
  // Deshacer la corrupción es parte del guion (disco efímero, pero el orden
  // importa si alguien añade pasos después) — y de paso canda que el fallo era
  // DEL CONTENIDO, no un resume roto para todo el mundo.
  writeFileSync(ruta, original);
  const res4 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "restaurado el fichero, el mismo resume carga (el rechazo era por el contenido, no por la ruta)",
    res4.ok === true,
    JSON.stringify(res4),
  );
}
