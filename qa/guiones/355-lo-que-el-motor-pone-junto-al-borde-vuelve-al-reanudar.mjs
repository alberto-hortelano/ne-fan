/** LO QUE EL MOTOR PONE JUNTO AL BORDE cae DENTRO del tile, y reanudar la
 *  partida no saca el muro «Tu partida vuelve incompleta» (tanda CB).
 *
 *  El hallazgo, de la tanda BX: en el guion 351 los spawns «cerca del jugador»
 *  de los turnos 3 y 4 caían a veces FUERA del tile, y al reanudar salía a
 *  pantalla completa el aviso de #382 (`entidadesFueraDelMundo`). No era cosa
 *  del motor falso ni del azar: core colocaba lo que el motor manda en
 *  «jugador + forward × 5» (× 10 con texto libre) con el forward al norte fijo
 *  y sin mirar dónde acaba el tile, así que bastaba hablar a menos de ~10 m del
 *  borde norte. El «1 de cada 3» era hasta dónde había paseado el tabernero.
 *
 *  Aquí se provoca a propósito, sin depender de por dónde ande nadie: se abre
 *  la conversación con el tabernero, se planta al jugador a 2,5 m del borde
 *  norte del tile y se le pide al motor, por la marca TURNO del motor falso,
 *  cuatro cosas `near_player` (forja, carro, Nogala y bolsa). Luego se
 *  reanuda por la tarjeta del save, como quien juega.
 *
 *  Lo que se afirma, y por qué cada cosa:
 *   · que Nogala cayó JUNTO al borde norte (a menos de 5 m): sin esto el guion
 *     podría salir verde con un spawn en el centro del tile, que no prueba
 *     nada — es la precondición del resto, afirmada y no supuesta;
 *   · que todo lo del save está dentro de la unión de los tiles del save,
 *     preguntado con la MISMA función que dispara el muro
 *     (`entidadesFueraDelMundo` de `nefan-core/dist`, `⊘` si no está
 *     construido);
 *   · y que tras reanudar el muro NO sale. «Que no salga» es una espera cuyo
 *     timeout es el éxito, así que tiene su gemela: la escena y Nogala vuelven
 *     (si el resume no hubiera llegado, no haber muro no significaría nada).
 *
 *  PROBADO EN NEGATIVO al nacer: con `anclaDentroDelTile` devolviendo el ancla
 *  sin acotar (el comportamiento de `main` antes de la tanda) los asertos del
 *  save y del muro se ponen rojos; ver `implementacion.md` de la tanda CB.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; los spawns los pone
 *  `labs/narrative/fake-ai-server.ts` por la marca de texto libre.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { acercarse } from "../lib/combate.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { esperaDeFotogramas } from "../lib/fotogramas.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes y el
 *  contador a 0. */
export const aisla = ["saves", "fake-ai"];

/** «mundo»: la espera existe para que el sim mande la posición nueva al
 *  bridge en sus frames de input, o sea frames SIMULADOS. */
const esperarMundo = esperaDeFotogramas("mundo");
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GAME_ID = "alta_fantasia";
const MERCADER = "barkeep";
/** La marca del motor falso que pone cuatro cosas en un turno (guion 128). */
const MARCA_TURNO = "LO QUE DECLARA EL MOTOR: TURNO";
const PACIFICO = "Nogala";
/** A cuánto del borde norte se planta al jugador: menos que los 5 m de
 *  `near_player`, así que sin acotar el spawn cae fuera. */
const DEL_BORDE_M = 2.5;
/** Lo que se exige para decir que el spawn cayó «junto al borde». */
const JUNTO_AL_BORDE_M = 5;

async function fueraDelMundoDeCore() {
  try {
    const m = await import(path.join(RAIZ, "nefan-core", "dist", "src", "session", "mundo-persistido.js"));
    return (save) => m.entidadesFueraDelMundo(save.entities ?? [], m.rectsDelMundo(save.scenes_loaded ?? {}));
  } catch (err) {
    return { error: String(err) };
  }
}

/** El typewriter termina y las opciones están en pantalla (mismo criterio
 *  que el guion 83): antes, la T no abre la caja. */
function panelPintado(ctx) {
  return ctx.waitFor(
    "el typewriter termina y las opciones están en pantalla",
    () => {
      const d = window.__nefan.dialogue();
      const botones = document.querySelectorAll("#dialogue-choices button").length;
      const texto = document.getElementById("dialogue-text")?.textContent ?? "";
      return d.visible && botones > 0 && texto === d.text ? true : null;
    },
    60_000,
  );
}

function leerSave(sessionId) {
  const f = rutaDelSave(sessionId);
  return f ? JSON.parse(readFileSync(f, "utf-8")) : null;
}

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, renderMode: "vector" });
  const partida = await comenzar(ctx);

  // ── 1 · Turno 1: se abre la conversación con el tabernero ───────────────
  await ctx.waitFor(
    "el tabernero está en escena para hablar con él",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    MERCADER,
  );
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor("el tabernero contesta (turno 1)", () => window.__nefan.dialogueVisible || null, 60_000);

  // ── 2 · El jugador, a 2,5 m del borde norte del tile ────────────────────
  const rect = (await ctx.nefan("scene")).world_rect;
  const pos0 = await ctx.nefan("playerPos");
  const destino = { x: pos0.x, z: rect.minZ + DEL_BORDE_M };
  await ctx.nefan("setPlayerPos", destino.x, destino.z);
  // El bridge resuelve el hint contra la posición que le llega en cada frame
  // de input (`store.player.pos`), no contra la del cliente: se esperan unos
  // frames del loop para que la nueva sea la suya antes de elegir.
  await esperarMundo(ctx, 10);
  const junto = await ctx.nefan("playerPos");
  ctx.expect(
    "el jugador sigue junto al borde tras esos frames (el sim no lo ha devuelto)",
    Math.abs(junto.z - destino.z) <= 0.3,
    `${JSON.stringify(junto)} · se le puso en ${JSON.stringify(destino)}`,
  );
  ctx.log(`jugador en ${JSON.stringify(await ctx.nefan("playerPos"))} · tile ${JSON.stringify(rect)}`);

  // ── 3 · El motor pone cuatro cosas «cerca del jugador» en UN turno ─────
  // Por la marca TURNO del motor falso y no por los turnos 2-4: el 2 trae un
  // hostil que, plantado a un metro, tumbaba al jugador antes del turno 3
  // (medido en la primera corrida de este guion: «Has caído» y el diálogo
  // cerrado). La marca pone forja, carro, Nogala y bolsa, todas `near_player`,
  // y deja el motor en manos del guion (sin spawns por turno).
  await panelPintado(ctx);
  await ctx.page.keyboard.press("t");
  await ctx.waitFor(
    "T abre la caja de texto libre",
    () => (document.getElementById("dialogue-input")?.style.display === "block" ? true : null),
    5_000,
  );
  await ctx.page.keyboard.type(MARCA_TURNO);
  await ctx.page.keyboard.press("Enter");
  const nogala = await ctx.waitFor(
    `el motor materializa a "${PACIFICO}" junto con el resto del turno`,
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    90_000,
    PACIFICO,
  );
  await ctx.shot("spawns-junto-al-borde");
  ctx.expect(
    `${PACIFICO} cayó junto al borde norte (a menos de ${JUNTO_AL_BORDE_M} m): si no, el resto no prueba nada`,
    nogala.pos.z - rect.minZ < JUNTO_AL_BORDE_M,
    `${PACIFICO} en ${JSON.stringify(nogala.pos)} · borde norte z=${rect.minZ}`,
  );
  ctx.expect(
    `…y DENTRO del tile, no al otro lado del borde`,
    nogala.pos.z >= rect.minZ && nogala.pos.z < rect.maxZ && nogala.pos.x >= rect.minX && nogala.pos.x < rect.maxX,
    `${JSON.stringify(nogala.pos)} · ${JSON.stringify(rect)}`,
  );

  // ── 4 · El save no lleva nada fuera del mundo ───────────────────────────
  const fuera = await fueraDelMundoDeCore();
  const save = leerSave(partida.sessionId);
  if (typeof fuera !== "function") {
    ctx.sinMedirBloque(`nefan-core/dist no está construido (${fuera.error}): sin él no hay quien pregunte`);
  } else if (!save) {
    ctx.sinMedirBloque(`no hay state.json de ${partida.sessionId} en el disco del bench`);
  } else {
    const lista = fuera(save);
    ctx.expect(
      "el save no lleva ninguna entity fuera de sus tiles (lo que dispara el muro al reanudar)",
      lista.length === 0,
      JSON.stringify(lista),
    );
    ctx.expect(
      `…y el save sí lleva a ${PACIFICO} (si no, «nada fuera» sería un verde vacío)`,
      (save.entities ?? []).some((e) => e.data?.name === PACIFICO),
      JSON.stringify((save.entities ?? []).map((e) => e.data?.name ?? e.id)),
    );
  }

  // ── 5 · Reanudar no saca el muro «Tu partida vuelve incompleta» ─────────
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  await ctx.expectEspera(
    "tras reanudar NO sale el muro «Tu partida vuelve incompleta»",
    false,
    () => {
      const el = document.getElementById("narrative-loader");
      if (!el?.classList.contains("visible") || !el.classList.contains("error")) return null;
      return document.getElementById("narrative-loader-title")?.textContent ?? "(sin titular)";
    },
    // Pared: el sujeto es un frame del bridge (el aviso sale del resume),
    // no el reloj del mundo.
    { ms: 15_000 },
  );
  const devuelta = await ctx.waitFor(
    `…y ${PACIFICO} vuelve con la partida (el resume llegó entero; sin esto, no haber muro no dice nada)`,
    (n) => window.__nefan.npcs().find((x) => x.label === n) ?? null,
    60_000,
    PACIFICO,
  );
  ctx.log(`${PACIFICO} tras reanudar: ${JSON.stringify(devuelta.pos)}`);
  await ctx.shot("reanudada-sin-muro");
}
