/** LA PUERTA DEL GASTO DE IMAGEN NO ADIVINA: ni en el save (#522) ni sin
 *  partida (#519).
 *
 *  El modo de render es lo que decide si la partida PAGA imagen de IA —el
 *  atlas de superficies del tile, los skins de los personajes—, y esta tanda
 *  cierra sus dos agujeros, que son el mismo defecto por los dos lados:
 *  alguien contestando a una pregunta que no sabe.
 *
 *  A · **Un modo que nadie sabe leer no entra en la partida** (#522). El save
 *      guarda `world.render_mode` y `world.character_mode` como texto libre, y
 *      un valor desconocido —un save editado a mano, una era anterior del
 *      campo— pasaba entero por `loadSession`. Y luego cada lector decidía por
 *      su cuenta: el cliente lo colapsaba a «sin elegir» (`normalizarModo`), el
 *      bridge lo trataba como modo PROPIO de la faceta (así que los personajes
 *      dejaban de seguir a los escenarios) y la State API lo publicaba tal
 *      cual. Tres lecturas de un mismo byte, ninguna de ellas «rechazar». El
 *      propio código lo tenía escrito («su sitio es la puerta del save»).
 *  B · **Sin partida no se enciende el gasto de escenarios** (#519). Había un
 *      interruptor local de escenarios que se guardaba en el navegador y
 *      alimentaba el gate de core… y su único consumidor lo tapaba con
 *      `session.active && …`: sin partida no hay tile que pedirle a ningún
 *      motor, así que el gate contestaba «sí, genera» a una pregunta que nadie
 *      llegaba a hacer. Un interruptor de gasto que nada lee no se conserva.
 *      Aquí se mide lo que queda: el chip no miente (Escenarios en maqueta sin
 *      partida), pedir lo contrario se DICE en vez de apuntarse en una clave
 *      muerta, y el navegador no guarda nada de escenarios.
 *
 *  Lo que NO se mide aquí y vive en `nefan-core/test/`: la tabla entera de los
 *  gates por faceta (`gates-de-imagen.test.ts`) y los tres modos que sí cargan
 *  con el campo ausente cayendo al default (`narrative-state.test.ts`).
 *
 *  Cero créditos: la partida se juega en `vector` y el save se corrompe en el
 *  disco EFÍMERO de la corrida.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";
import { esperarPartidaEnDisco, rutaDelSave } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** Un `resume_session` crudo por el cable del bridge, DESDE la página (molde
 *  del guion 46). Devuelve el `session_started`. */
async function resumePorElCable(ctx, sessionId, marca) {
  return ctx.page.evaluate(
    ([sid, req]) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar a resume_session`));
        };
        ws.onopen = () => ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: req }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== req) return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    [sessionId, marca],
  );
}

/** Lo que el navegador guarda de los modos de gráficos. */
const clavesDeGraficos = (ctx) =>
  ctx.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("nefan.")).sort());

export default async function (ctx) {
  // ── 0 · Una partida real, jugada por el camino del jugador ───────────────
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  const salud = await (await fetch(`${URLS.state_api}/health`)).json();
  const sessionId = salud?.session_id;
  ctx.expect("la partida tiene sesión viva en el State API", Boolean(sessionId), JSON.stringify(salud));
  if (!sessionId) return ctx.sinMedir("sin partida no hay save que corromper");
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  if (!ruta) return ctx.sinMedir("el save no está en el disco de la corrida (¿stack adoptado?)");

  // Al título: el bridge queda quieto y el fichero deja de reescribirse, así
  // que la corrupción de abajo no compite con un `save()` en vuelo.
  await recargarAlTitulo(ctx);
  const original = readFileSync(ruta, "utf8");

  // ── A · El modo que nadie sabe leer no entra ─────────────────────────────
  for (const campo of ["render_mode", "character_mode"]) {
    const data = JSON.parse(original);
    data.world[campo] = "imagen"; // lo que deja un save editado a mano
    writeFileSync(ruta, JSON.stringify(data));
    const res = await resumePorElCable(ctx, sessionId, `qa-111-${campo}`);
    ctx.log(`resume con world.${campo}="imagen": ${JSON.stringify(res)}`);
    ctx.expect(
      `un save con world.${campo} desconocido contesta save_invalido (no carga a ciegas)`,
      res.ok === false && /^save_invalido:/.test(res.error),
      JSON.stringify(res),
    );
    ctx.expect(
      "…y el motivo nombra el save, el campo y el valor que traía (accionable, no «error interno»)",
      res.error.includes(sessionId) && res.error.includes(campo) && res.error.includes('"imagen"'),
      res.error,
    );
  }

  // El jugador: la tarjeta está en la lista (nadie sabe que el save está roto)
  // y pulsar «Reanudar» devuelve al título con el motivo, sin mundo montado.
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("el título ofrece la tarjeta del save corrupto", Boolean(tarjeta), String(sessionId));
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "el título vuelve con un error visible (no un cuelgue, no una partida con un modo inventado)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "tras el intento no hay escena montada: la partida del modo inventado no llegó al cliente",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("titulo-tras-reanudar-con-modo-inventado");
  }

  // Y el rechazo era del CONTENIDO: restaurado el fichero, el mismo resume carga.
  writeFileSync(ruta, original);
  const bueno = await resumePorElCable(ctx, sessionId, "qa-111-bueno");
  ctx.expect(
    "restaurado el modo, el mismo resume carga (se rechazaba el valor, no la ruta)",
    bueno.ok === true,
    JSON.stringify(bueno),
  );

  // ── B · Sin partida, el gasto de escenarios no se enciende ───────────────
  await recargarAlTitulo(ctx);
  await ctx.nefan("closeTitle"); // modo fixtures: no hay partida y el chip se ve
  await ctx.waitFor("el chip de gráficos está en pantalla", () => {
    const el = document.getElementById("gfx-chip");
    return el && !el.hidden ? { visible: true } : null;
  });
  await ctx.page.click("#gfx-chip");
  const filaEscenarios = ctx.page
    .locator("#gfx-panel .gfx-row", { hasText: /escenario/i })
    .locator(".gfx-seg button");
  await filaEscenarios.first().waitFor({ state: "visible", timeout: 10_000 });

  const activo = async () =>
    filaEscenarios.evaluateAll((bs) => bs.map((b) => b.className.includes("active")));
  ctx.expect(
    "sin partida el chip dice la verdad: los escenarios NO generan imagen (no hay tile que pedir)",
    (await activo())[1] === true && (await activo())[0] === false,
    JSON.stringify(await activo()),
  );
  ctx.expect(
    "y el navegador no guarda ninguna preferencia de escenarios: solo la de personajes",
    (await clavesDeGraficos(ctx)).every((k) => k === "nefan.aichar"),
    JSON.stringify(await clavesDeGraficos(ctx)),
  );

  // Pedir «Imagen IA» de escenarios sin partida: se DICE, no se apunta en una
  // clave que nadie lee y no se queda el chip mintiendo.
  await filaEscenarios.first().click(); // arma
  await filaEscenarios.first().click(); // confirma
  const dicho = await ctx.waitFor(
    "pedir imagen de escenarios sin partida deja un motivo en el registro (fail-loud, no un no-op mudo)",
    () => {
      const t = document.getElementById("error-log")?.textContent ?? "";
      return /sin partida no se generan escenarios/.test(t) ? t.slice(0, 200) : null;
    },
    20_000,
  );
  ctx.log(`lo que queda escrito: «${String(dicho).replace(/\s+/g, " ").slice(0, 120)}»`);
  ctx.expect(
    "…y el chip NO se queda diciendo que genera: el estado que enseña es el real",
    (await activo())[1] === true && (await activo())[0] === false,
    JSON.stringify(await activo()),
  );
  ctx.expect(
    "…y sigue sin guardarse ninguna clave de escenarios en el navegador",
    (await clavesDeGraficos(ctx)).every((k) => k === "nefan.aichar"),
    JSON.stringify(await clavesDeGraficos(ctx)),
  );
  await ctx.shot("chip-sin-partida-escenarios-en-maqueta");
}
