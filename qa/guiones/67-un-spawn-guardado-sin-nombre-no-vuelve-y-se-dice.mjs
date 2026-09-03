/** Un save cuyo spawn no trae `data.name` NO VALE, y el jugador lo lee en el
 *  título nombrando a quien le falta el nombre — ni se resiembra, ni anda
 *  invisible, ni nadie le inventa un rótulo (#397).
 *
 *  Desde #397 `name` es obligatorio en `spawn_entity` y es el rótulo. Un save
 *  puede traer igualmente un spawn sin nombre: uno de antes de la tanda o un
 *  ledger corrupto. La primera versión de la PR lo resolvía en el CLIENTE
 *  (`spawnsDeRuntime` lo dejaba fuera y lo decía) y QA encontró la grieta: el
 *  bridge tiene OTRO lector del mismo ledger que resiembra el sim al reanudar,
 *  así que el NPC sin nombre se movía por el mundo sin que el cliente lo
 *  tuviera —«anda invisible»—, y con `role:"hostile"` el atacante sería
 *  invisible. Dos lectores, dos criterios. La garantía va en el tipo, como en
 *  T6 con `position`: `loadSession` valida que todo record tenga `data.name`
 *  no vacío y, si no, el save es INVÁLIDO por la vía que ya existe
 *  (#334/#336, «bórrala o empieza una nueva»), nombrando al record: su id y,
 *  si la tiene, su `description`. Así ningún lector —ni el cliente ni el
 *  sim— llega a ver un record sin nombre.
 *
 *  Lo que se mide, por el camino del jugador:
 *
 *   0 · CONTROL: con la partida sana Nogala está en escena con su rótulo y el
 *       save de disco la tiene con `name` y `description`.
 *   1 · SABOTAJE: se borra `data.name` del record de Nogala en el save de
 *       DISCO (es la única forma honesta de tener «un save de antes»: el
 *       contrato ya no deja al motor emitirlo). Tras «Reanudar»:
 *       · por el cable, `session_started` contesta `ok:false` con
 *         `save_invalido:` nombrando el save, el record y su descripción;
 *       · el título vuelve con el aviso: dice QUIÉN («posadera de manos
 *         grandes y delantal remendado» no tiene nombre) y la única salida
 *         real (bórrala o empieza una nueva) — no un id de máquina;
 *       · la partida NO carga: sin escena, sin NPCs en el cliente;
 *       · y nadie anda invisible: el registro de errores no trae el aviso
 *         «el bridge mueve al NPC … y el cliente no lo tiene en escena».
 *   2 · RESTAURADO el nombre en el save, el mismo resume trae a Nogala de
 *       vuelta con el mismo id y su procedencia, y el título no avisa de nada:
 *       el rechazo era del contenido.
 *
 *  Editar el save es forzar estado, y la regla del workaround lo convierte en
 *  hallazgo salvo que sea el SUJETO de la medida — y aquí lo es. Se declara.
 *
 *  Nació ROJO sobre `3b014f0` (la primera versión de la PR, medido el
 *  2026-09-03): el resume del save saboteado CARGABA (`ok:true`), el título no
 *  volvía con aviso y el panel del jugador decía «el bridge mueve al NPC
 *  "narr_npc_…" y el cliente no lo tiene en escena: anda invisible».
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el spawn de Nogala lo pone el
 *  turno 3 de `labs/narrative/fake-ai-server.ts`. Sin espera por reloj: todo
 *  es `waitFor`/`expectEspera` sobre el estado del cliente.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { nuevaPartida, comenzar, esperarTituloListo, esperarListaDeSaves, reanudar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { esperarEnElSave, rutaDelSave } from "../lib/saves.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes y el
 *  contador a cero. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const TABERNERO = "barkeep";
const HOSTIL = "Secuaz";
/** Lo que el turno 3 del motor falso declara, tal cual. */
const NOGALA = { name: "Nogala", description: "posadera de manos grandes y delantal remendado" };
const COFRE = "Cofre de la posada";
const FORJA = "Forja de Robledo";
/** La frase del título para un save que no vale (`motivoDeSesionParaElJugador`). */
const SALIDA_PARA_EL_JUGADOR = /ya no vale para esta versión del juego[\s\S]*bórrala o empieza una nueva/;
/** Lo que el cliente dice cuando el sim mueve a alguien que él no tiene. */
const ANDA_INVISIBLE = "anda invisible";

/** Las entradas del panel de errores, tal cual las lee quien juega. */
const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );

/** Quita (o repone) `data.name` del record en el save de disco. Devuelve el
 *  record tocado o `null` si el ledger no lo tiene. */
function nombreEnElLedger(ruta, id, name) {
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const ent = (save.entities ?? []).find((e) => e.id === id);
  if (!ent) return null;
  if (name === undefined) delete ent.data.name;
  else ent.data.name = name;
  writeFileSync(ruta, JSON.stringify(save, null, 2));
  return { id: ent.id, data: { ...ent.data } };
}

/** `resume_session` por el cable, tal cual lo manda el cliente; devuelve la
 *  respuesta `session_started` (calcado del guion 62). */
function resumePorElCable(ctx, sessionId) {
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
        ws.onopen = () => ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-67" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-67") return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    sessionId,
  );
}

/** Al título limpio (reload) y con la lista de saves puesta. */
async function alTitulo(ctx) {
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  // ── 0 · El motor pone a Nogala a mitad de conversación (turno 3) ────────
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    TABERNERO,
  );
  await acercarse(ctx, TABERNERO, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);
  await ctx.nefan("chooseDialogue", 0);
  await ctx.waitFor(
    `el motor materializa a "${HOSTIL}" (turno 2)`,
    (n) => window.__nefan.enemies().find((e) => e.label === n) ?? null,
    90_000,
    HOSTIL,
  );
  await ctx.nefan("chooseDialogue", 0);
  const nogalaViva = await ctx.waitFor(
    "el motor materializa a Nogala, el cofre y la forja (turno 3)",
    (n) => {
      const nogala = window.__nefan.npcs().find((x) => x.label === n.npc);
      const objetos = window.__nefan.objects();
      return nogala && objetos.some((o) => o.label === n.cofre) && objetos.some((o) => o.label === n.forja)
        ? { id: nogala.id }
        : null;
    },
    90_000,
    { npc: NOGALA.name, cofre: COFRE, forja: FORJA },
  );
  await ctx.nefan("advanceDialogue");
  await ctx.expectEspera("la conversación se cierra", true, () => (window.__nefan.dialogueVisible ? null : true), {
    ms: 15_000,
  });

  // El ledger tiene a Nogala con las dos cosas ANTES del sabotaje.
  const enDisco = await esperarEnElSave(
    partida.sessionId,
    (s) => (s.entities ?? []).find((e) => e.id === nogalaViva.id && e.data?.name === NOGALA.name) ?? null,
    60_000,
  );
  if (!enDisco) ctx.sinMedir("el spawn de Nogala no llegó al save de disco: no hay record que sabotear");
  ctx.log(`Nogala en el save: ${JSON.stringify(enDisco.data)}`);
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) ctx.sinMedir("esta corrida no tiene disco propio (stack adoptado): sin el save no hay nada que sabotear");

  // Al título ANTES de tocar el disco: el bridge queda quieto y el fichero deja
  // de reescribirse encima del sabotaje.
  await alTitulo(ctx);

  // ── 1 · SABOTAJE: el record de Nogala pierde `data.name` ─────────────────
  const roto = nombreEnElLedger(ruta, nogalaViva.id, undefined);
  ctx.expect("precondición: el ledger del save tiene a Nogala", Boolean(roto), ruta);
  if (!roto) return;
  ctx.log(`saboteado «${roto.id}»: data sin name → ${JSON.stringify(roto.data)}`);

  // 1a · El cable: el save no vale, y el motivo nombra al record.
  const res = await resumePorElCable(ctx, partida.sessionId);
  ctx.log(`resume por el cable: ${JSON.stringify(res)}`);
  ctx.expect(
    "#397 · el resume de un save con un spawn sin `name` contesta save_invalido (no carga mudo)",
    res.ok === false && /^save_invalido:/.test(res.error),
    JSON.stringify(res),
  );
  ctx.expect(
    "…y el motivo nombra el save, el record (id) y su descripción, y dice qué hacer",
    res.error.includes(partida.sessionId) &&
      res.error.includes(roto.id) &&
      res.error.includes(NOGALA.description) &&
      /bórralo o empieza partida nueva/.test(res.error),
    res.error,
  );
  ctx.expect(
    "el fichero saboteado sigue intacto tras el intento (nadie lo saneó ni lo «reparó»)",
    !("name" in (JSON.parse(readFileSync(ruta, "utf-8")).entities.find((e) => e.id === roto.id)?.data ?? {})),
    ruta,
  );

  // 1b · El jugador: «Reanudar» sobre la tarjeta.
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${partida.sessionId}"]`);
  ctx.expect("el título ofrece la tarjeta del save (el jugador no sabe que está roto)", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  const aviso = await ctx.waitFor(
    "el título vuelve con un aviso visible (no un cuelgue, no el mundo a medias)",
    () => {
      const el = document.getElementById("ts-error");
      const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
      return visible ? el.textContent.trim() : null;
    },
    30_000,
  );
  ctx.log(`lo que lee el jugador: «${aviso}»`);
  ctx.expect(
    "#397 · el aviso dice la única salida real: borrar la partida o empezar otra",
    SALIDA_PARA_EL_JUGADOR.test(aviso ?? ""),
    String(aviso),
  );
  ctx.expect(
    "#397 · …y nombra a quien le falta el nombre por su DESCRIPCIÓN, no por un id de máquina",
    (aviso ?? "").includes(NOGALA.description) && /no tiene nombre/.test(aviso ?? "") && !(aviso ?? "").includes(roto.id),
    String(aviso),
  );
  const estado = await ctx.page.evaluate(() => ({
    scene: Boolean(window.__nefan.status().scene),
    title: window.__nefan.status().title,
    npcs: window.__nefan.npcs().map((n) => n.id),
  }));
  ctx.expect(
    "#397 · la partida NO carga: el jugador sigue en el título, sin escena y sin NPCs",
    estado.scene === false && estado.title !== false && estado.npcs.length === 0,
    JSON.stringify(estado),
  );
  // Nadie anda invisible: si el bridge hubiera resembrado el sim con el record
  // sin nombre, el cliente lo diría en su registro al primer `state_update`.
  // El timeout ES el éxito; queda AFIRMADO con sus sondeos.
  await ctx.expectEspera(
    "ninguna línea del registro dice que alguien ande invisible",
    false,
    (frase) => {
      const txt = Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "");
      return txt.some((t) => t.includes(frase)) ? txt.filter((t) => t.includes(frase)) : null;
    },
    {
      ms: 4_000,
      arg: ANDA_INVISIBLE,
      aserto: "#397 · el bridge NO resiembra el record sin nombre: nadie «anda invisible»",
    },
  );
  const panel = await panelDeErrores(ctx);
  ctx.log(`panel tras el resume rechazado: ${JSON.stringify(panel)}`);
  await ctx.shot("save-sin-nombre-no-vale-y-el-titulo-dice-quien");

  // ── 2 · RESTAURADO: el mismo resume la trae de vuelta ────────────────────
  const repuesto = nombreEnElLedger(ruta, nogalaViva.id, NOGALA.name);
  ctx.expect("precondición: el ledger sigue teniendo a Nogala", Boolean(repuesto), ruta);
  if (!repuesto) return;
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  const deVuelta = await ctx.waitFor(
    "con el nombre repuesto Nogala vuelve al mundo",
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    90_000,
    NOGALA.name,
  );
  ctx.expect(
    "#397 · repuesto el nombre vuelve la MISMA Nogala (id a id) con su procedencia",
    deVuelta.id === nogalaViva.id && deVuelta.skinPrompt === NOGALA.description,
    JSON.stringify(deVuelta),
  );
  const tituloTrasReanudar = await ctx.page.evaluate(() => {
    const el = document.getElementById("ts-error");
    return el && el.style.display !== "none" ? (el.textContent ?? "").trim() : "";
  });
  ctx.expect(
    "#397 · con el save sano el título no avisa de nada (negativo del falso rojo)",
    tituloTrasReanudar === "",
    tituloTrasReanudar,
  );
  await ctx.shot("nogala-repuesta-vuelve");
  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
