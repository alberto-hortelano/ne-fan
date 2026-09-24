/** UN SAVE CON DOS RECORDS DEL MISMO ID NO CARGA, y el jugador se entera (#490).
 *
 *  EL AGUJERO, tal como lo dejó medido la QA del corte 4 de #358: el gate de
 *  `loadSession` comprobaba la posición de cada record y su nombre, pero no que
 *  los ids fueran únicos. Un save con el mismo `id` dos veces entraba entero y
 *  el cliente pintaba **dos entidades iguales sin decirlo** — dos rótulos, dos
 *  cajas, y un solo combatiente en el sim, que está keyed por id. La familia es
 *  la de #382 y #405 (posición nula → `save_invalido` con su motivo): el gate
 *  rechaza lo que el resto del juego da por hecho.
 *
 *  POR QUÉ SOLO SE ALCANZA EDITANDO EL SAVE, y por qué eso no lo hace teórico:
 *  por el camino del motor no pasa —`recordEntitySpawned` sufija el id repetido
 *  (`narr_npc_…_0_2`) en vez de crear el choque—, así que el duplicado solo
 *  entra por un fichero tocado a mano, un merge de saves o una versión anterior
 *  del generador. Es exactamente el mismo alcance que el del 113 (un char ajeno
 *  en el grid) y se mide igual: se juega una partida de verdad, se sabotea SU
 *  `state.json` y se reanuda por la tarjeta del título.
 *
 *  Cuatro bloques, y el 1 es el que hace que los otros signifiquen algo:
 *   1. **control** — el save intacto reanuda. Sin esto, el rechazo del 2 podría
 *      ser de la ruta y no del contenido.
 *   2. **protocolo** — el resume del save saboteado contesta `save_invalido`
 *      nombrando el ID repetido y a QUIÉN pertenece, en palabras del jugador.
 *   3. **jugador** — «Reanudar» devuelve al título con la salida escrita, sin
 *      mundo montado: el mundo con las dos entidades gemelas no llega a existir.
 *   4. **reversible** — el fichero sigue byte a byte como se dejó (nadie lo
 *      «reparó» por su cuenta) y, quitado el duplicado, la MISMA partida carga.
 *
 *  PROBADO EN NEGATIVO (2026-09-14): quitando el bucle de ids únicos del gate
 *  (`narrative-state.ts`), el bloque 2 se pone rojo —el resume contesta
 *  `ok:true`— y el 3 también, con el título entrando en la partida; y el mundo
 *  vuelve con DOS entidades del mismo id, que es el síntoma del issue.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, motor falso. `aisla: ["saves"]`.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";
import { URLS } from "../lib/stack.mjs";
import { preguntarPorElCable } from "../lib/cable.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
/** Lo que el motor falso pone en su turno 3 y que aquí se duplica. */
const COFRE = "Cofre de la posada";
/** El hostil del turno 2. Se espera POR SU NOMBRE y no por «hay enemigos»: el
 *  tile de bootstrap ya trae uno, así que `enemies().length > 0` es cierto
 *  desde el arranque y la espera se cumplía sin que el turno hubiera avanzado
 *  — el cofre del turno 3 no llegaba nunca (medido al escribir este guion). */
const HOSTIL = "Secuaz";
/** Lo que el jugador tiene que leer: la salida real, no «inténtalo de nuevo».
 *  El mismo texto que miden el 62 y el 113, porque es el mismo desenlace. */
const SALIDA_PARA_EL_JUGADOR = /ya no vale para esta versión del juego.*bórrala o empieza una nueva/;

/** Un `resume_session` crudo por el cable del bridge, DESDE la página (la misma
 *  receta que el 46, el 62 y el 113: la URL la da el propio juego). */
function resumePorElCable(ctx, sessionId) {
  return preguntarPorElCable(
    ctx,
    { type: "resume_session", sessionId, requestId: "qa-126" },
    { respuesta: "session_started" },
  ).then((m) => ({ ok: m.ok, error: m.error ?? "" }));
}

/** Habla con el tabernero hasta que el motor falso pone el cofre (su turno 3).
 *  Es la forma de tener en el save un record de RUNTIME que duplicar: el del
 *  tile no valdría, porque lo que el issue describe son dos records de runtime
 *  —o uno de runtime pisando el id de un NPC del tile— y los dos entran por la
 *  misma puerta del gate. */
async function ponerUnSpawnDeRuntime(ctx) {
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  await ctx.waitFor(
    `el motor manda a «${HOSTIL}» (turno 2)`,
    (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
    90_000,
    HOSTIL,
  );
  await ctx.nefan("chooseDialogue", 0);
  const cofre = await ctx.waitFor(
    "el motor pone el cofre (turno 3)",
    (n) => window.__nefan.objects().find((x) => x.label === n) ?? null,
    90_000,
    COFRE,
  );
  await ctx.nefan("advanceDialogue");
  return cofre;
}

export default async function (ctx) {
  // ── 0 · Una partida real, con algo que el motor haya puesto ──────────────
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector", charMode: "vector" });
  await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero está en escena",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  const cofre = await ponerUnSpawnDeRuntime(ctx);
  ctx.log(`el motor puso «${cofre.label}» (${cofre.id})`);

  const salud = await (await fetch(`${URLS.state_api}/health`)).json();
  const sessionId = salud?.session_id;
  ctx.expect("la partida tiene sesión viva en el State API", Boolean(sessionId), JSON.stringify(salud));
  if (!sessionId) return;
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "sin disco efímero (QA_RUN_TMP) no hay `state.json` de esta corrida que sabotear, y tocar el " +
        "save de otro stack sería fabricar el estado de una partida ajena",
    );
    return;
  }

  // Al título: el bridge queda quieto y el fichero deja de reescribirse.
  await recargarAlTitulo(ctx);
  const original = readFileSync(ruta, "utf8");
  const guardado = JSON.parse(original);
  const runtime = (guardado.entities ?? []).filter((e) => e.spawn_reason === "narrative_request");
  ctx.expect(
    "el save trae records de RUNTIME que duplicar (si no, no hay nada que medir aquí)",
    runtime.length > 0,
    JSON.stringify((guardado.entities ?? []).map((e) => `${e.id}:${e.spawn_reason}`)),
  );
  if (runtime.length === 0) return;
  const victima = runtime.find((e) => e.data?.name === COFRE) ?? runtime[0];

  // ── 1 · CONTROL: el save intacto REANUDA ─────────────────────────────────
  const control = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "1 · el save intacto reanuda (sin esto, el rechazo de abajo podría ser de la ruta y no del contenido)",
    control.ok === true,
    JSON.stringify(control),
  );

  // ── 2 · PROTOCOLO: dos records con el MISMO id ───────────────────────────
  // El duplicado va en otra posición a propósito: así no es un empate que
  // alguien pudiera colapsar en silencio «porque son iguales». Son dos cosas
  // distintas del mundo llamándose lo mismo.
  const saboteado = JSON.parse(original);
  const gemelo = JSON.parse(JSON.stringify(victima));
  gemelo.position = [victima.position[0] + 6, victima.position[1], victima.position[2] + 6];
  saboteado.entities.push(gemelo);
  const textoSaboteado = JSON.stringify(saboteado);
  writeFileSync(ruta, textoSaboteado);

  const res = await resumePorElCable(ctx, sessionId);
  ctx.log(`2 · resume del save con el id «${victima.id}» repetido: ${JSON.stringify(res).slice(0, 300)}`);
  ctx.expect(
    "2 · el resume RECHAZA el save: dos entidades con el mismo id no entran al mundo",
    res.ok === false && /^save_invalido:/.test(res.error),
    JSON.stringify(res),
  );
  // QUIÉN es, con las palabras del jugador y no con el id: la PROCEDENCIA si el
  // motor la declaró («cofre de roble con herrajes de hierro») y el rótulo si
  // no. Es el mismo orden que usa el mensaje (`quienEs`), y el orden importa:
  // la procedencia es el texto del que salió su arte, o sea lo que el jugador
  // tiene delante.
  const comoLoConoce = victima.data?.description || victima.data?.name;
  ctx.expect(
    "2 · …y el motivo nombra el ID repetido y a QUIÉN pertenece, en palabras del jugador",
    res.error.includes(`"${victima.id}"`) && res.error.includes(String(comoLoConoce)),
    `${res.error} · esperaba que nombrara «${comoLoConoce}»`,
  );

  // ── 3 · JUGADOR: «Reanudar» no monta el mundo con las dos gemelas ────────
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("3 · el título ofrece la tarjeta del save (el jugador no sabe que su ledger está roto)", Boolean(tarjeta), sessionId);
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "3 · el título vuelve con un error visible (no un cuelgue, no dos cofres)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`3 · lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "3 · lo que lee dice la única salida real: borrar la partida o empezar otra",
      SALIDA_PARA_EL_JUGADOR.test(aviso ?? ""),
      String(aviso),
    );
    ctx.expect(
      "3 · tras el intento no hay escena montada: el mundo con las dos entidades gemelas no llegó a existir",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("el-titulo-tras-reanudar-un-ledger-con-ids-repetidos");
  }

  // ── 4 · El fichero sigue intacto y la partida REVIVE al arreglarlo ───────
  ctx.expect(
    "4 · el save saboteado sigue byte a byte como se dejó (nadie lo saneó ni lo «reparó»)",
    readFileSync(ruta, "utf8") === textoSaboteado,
    ruta,
  );
  writeFileSync(ruta, original);
  const res4 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "4 · quitado el duplicado, la MISMA partida carga: el rechazo era del id repetido, no de la partida",
    res4.ok === true,
    JSON.stringify(res4),
  );
}
