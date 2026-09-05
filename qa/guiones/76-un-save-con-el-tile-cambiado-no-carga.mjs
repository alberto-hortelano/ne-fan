/** UN SAVE CON EL `tile` CAMBIADO NO CARGA (QA de T13 PR-F: #405).
 *
 *  Desde #405 toda escena registrada es un tile: `SceneRecord.tile` es
 *  obligatorio y `loadSession` RECHAZA un save cuyo registro no trae `tile`,
 *  lo trae distinto del de su escena, o cuya escena no lo trae (pre-producción:
 *  se rechaza, no se re-deriva en silencio — sería la migración que #336
 *  prohíbe). Los tests de core lo afirman sobre un `NarrativeState` de prueba;
 *  este guion lo mide por el camino del jugador: partida jugada → save de
 *  DISCO tocado → «Reanudar» desde el título, con el motor falso.
 *
 *  Lo que se afirma:
 *   1 · PROTOCOLO: registro SIN `tile` → `session_started ok:false
 *       error:"save_invalido: …"` nombrando el save, la escena y `tile` con
 *       «falta» (no `session_not_found`, no carga).
 *   2 · PROTOCOLO: registro con `tile` DISTINTO del de su escena → idem,
 *       nombrando los dos valores (la regla y no su contraria: el que casa
 *       carga en el paso 5).
 *   3 · PROTOCOLO: `scene_data` SIN `tile` → idem, nombrando `tile` (es el
 *       gate de `ExpandedSceneSchema`, la población «cargada»).
 *   4 · JUGADOR: «Reanudar» sobre la tarjeta del save con el `tile` cambiado
 *       vuelve al título con un error visible y sin escena montada.
 *   5 · Restaurado el fichero, el mismo resume carga: el rechazo era por el
 *       contenido.
 *
 *  Grupo: batería de NAVEGADOR (`node qa/run.mjs 76`), corrida local.
 *  Probado en negativo (2026-09-05): con la comprobación de `loadSession`
 *  neutralizada (`declarado` tratado como `t`), los pasos 1 y 2 se ponen rojos
 *  («contesta save_invalido»); el 3 sigue verde porque lo sujeta el zod.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** Un resume_session crudo por el cable del bridge, DESDE la página (mismo
 *  molde que el guion 46). Devuelve el `session_started`. */
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
          ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-76" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-76") return;
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

  await recargarAlTitulo(ctx);

  const original = readFileSync(ruta, "utf8");
  const base = JSON.parse(original);
  const escenas = Object.keys(base.scenes_loaded ?? {});
  ctx.expect("el save tiene al menos una escena registrada", escenas.length > 0, JSON.stringify(escenas));
  if (escenas.length === 0) return;
  const escena = escenas[0];
  const rec = base.scenes_loaded[escena];
  ctx.expect(
    "el registro fresco lleva `tile` igual al de su escena (#405: es lo que el bridge escribe hoy)",
    rec.tile && rec.scene_data?.tile && rec.tile.tx === rec.scene_data.tile.tx && rec.tile.ty === rec.scene_data.tile.ty,
    JSON.stringify({ rec: rec.tile, escena: rec.scene_data?.tile }),
  );

  // Si el runner muere a mitad (SIGINT/SIGTERM) o un paso lanza, el fichero
  // vuelve a su contenido: el disco de la corrida es efímero, pero un save
  // tocado que sobreviva al guion confundiría al siguiente que lo lea.
  const restaurar = () => writeFileSync(ruta, original);
  for (const s of ["SIGINT", "SIGTERM"]) process.once(s, restaurar);
  try {
    await cuerpo(ctx, { ruta, original, sessionId, escena, rec });
  } finally {
    restaurar();
    for (const s of ["SIGINT", "SIGTERM"]) process.removeListener(s, restaurar);
  }
}

/** Los cinco pasos sobre el save ya localizado; `original` se restaura fuera. */
async function cuerpo(ctx, { ruta, original, sessionId, escena, rec }) {
  const variante = (mutar) => {
    const data = JSON.parse(original);
    mutar(data.scenes_loaded[escena]);
    return JSON.stringify(data);
  };

  // ── 1. Registro sin `tile` ───────────────────────────────────────────────
  const sinTileEnRegistro = variante((r) => {
    delete r.tile;
  });
  writeFileSync(ruta, sinTileEnRegistro);
  const res1 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "registro sin `tile` → contesta save_invalido (no carga, no session_not_found)",
    res1.ok === false && /^save_invalido:/.test(res1.error),
    JSON.stringify(res1),
  );
  ctx.expect(
    "…y el motivo nombra save, escena y `tile` con «falta»",
    res1.error.includes(sessionId) && res1.error.includes(`"${escena}"`) && /\.tile falta/.test(res1.error),
    res1.error,
  );

  // ── 2. Registro con `tile` distinto del de su escena ─────────────────────
  const t = rec.scene_data.tile;
  const otro = { tx: t.tx + 3, ty: t.ty - 2 };
  const tileCambiado = variante((r) => {
    r.tile = otro;
  });
  writeFileSync(ruta, tileCambiado);
  const res2 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "registro con `tile` distinto del de su escena → contesta save_invalido",
    res2.ok === false && /^save_invalido:/.test(res2.error),
    JSON.stringify(res2),
  );
  ctx.expect(
    "…y el motivo nombra los dos valores (el declarado y el de la escena)",
    res2.error.includes(JSON.stringify(otro)) && res2.error.includes(JSON.stringify(t)),
    res2.error,
  );
  ctx.expect(
    "el fichero tocado sigue intacto tras el intento (nadie lo reescribió ni lo «reparó»)",
    readFileSync(ruta, "utf8") === tileCambiado,
    ruta,
  );

  // ── 3. La ESCENA sin `tile` (población cargada, gate del zod) ────────────
  const escenaSinTile = variante((r) => {
    delete r.scene_data.tile;
  });
  writeFileSync(ruta, escenaSinTile);
  const res3 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "escena del save sin `tile` → contesta save_invalido nombrando `tile`",
    res3.ok === false && /^save_invalido:/.test(res3.error) && /`tile`|\btile\b/.test(res3.error),
    JSON.stringify(res3),
  );

  // ── 4. JUGADOR: «Reanudar» sobre el save con el tile cambiado ────────────
  writeFileSync(ruta, tileCambiado);
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece la tarjeta del save (el jugador no sabe que está tocado)", Boolean(tarjeta), sessionId);
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "el título vuelve con un error visible (no un cuelgue, no un mundo con el tile cambiado)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "tras el intento no hay escena montada: el save tocado no llegó al cliente",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("titulo-tras-reanudar-save-con-tile-cambiado");
  }

  // ── 5. Restaurado el fichero, la partida REVIVE ──────────────────────────
  writeFileSync(ruta, original);
  const res5 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "restaurado el fichero, el mismo resume carga (el rechazo era por el contenido, no por la ruta)",
    res5.ok === true,
    JSON.stringify(res5),
  );
}
