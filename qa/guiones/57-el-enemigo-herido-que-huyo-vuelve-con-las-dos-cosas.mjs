/** El enemigo HERIDO **y** desplazado vuelve con LAS DOS COSAS (criterio 2 de
 *  la tanda «Lo que el jugador pierde», dicho tal cual lo escribió el usuario:
 *  «un enemigo herido reanuda donde lo dejé, con su vida»).
 *
 *  POR QUÉ HACE FALTA ESTE Y NO BASTAN LOS DOS QUE YA HABÍA. La conjunción no
 *  la medía nadie:
 *
 *   · el 42 HIERE al enemigo y cruza de tile, pero lo que reanuda es la
 *     MUERTE (que el muerto no vuelve), no la herida;
 *   · el 54 lo MUEVE y reanuda, pero no le pega: su aserto de vida es
 *     `maxHp === 60 && Number.isFinite(hp)`, que sigue en verde con la vida
 *     restaurada a tope — o sea, no puede ponerse rojo por el defecto que
 *     nombra.
 *
 *  Y la conjunción es justo donde #351 podía romperla: la vida viaja por
 *  `combat` y la posición por `position`, las dos escritas en la MISMA función
 *  (`escenaConCombateVivo`, `src/session/mundo-persistido.ts`) y sobre el mismo
 *  objeto npc. Un arreglo que pusiera la posición perdiendo el bloque `combat`
 *  —o al revés— dejaría al jugador con medio enemigo, y las dos baterías de
 *  arriba seguirían verdes.
 *
 *  Se afirma contra el SAVE y con IGUALDAD EXACTA en la vida (no «< 60»): lo
 *  que se compara es lo que el bridge sirve contra lo que el disco guardó, así
 *  que no hay carrera que tolerar y una vida «parecida» sería otro defecto.
 *
 *  PROBADO EN NEGATIVO (2026-09-01, QA de la tanda), las dos mitades por
 *  separado, sobre el árbol de la tanda:
 *   · quitando `position: [...estado.posicion]` de `escenaConCombateVivo` → el
 *     bandido reanuda en su celda del Format D y el aserto de POSICIÓN se pone
 *     rojo, con el de la vida en verde;
 *   · quitando `health: estado.combate.health` del bloque `combat` de esa
 *     misma función → el bandido reanuda A TOPE DE VIDA donde lo dejaste y el
 *     aserto de VIDA se pone rojo, con el de la posición en verde.
 *  Es el reparto exacto: cada mitad tiene quien la mire.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el bandido lo declara el tile de
 *  bootstrap de `labs/narrative/fake-scenes.ts`.
 */
import { readFileSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { acercarse, herirHasta } from "../lib/combate.mjs";

export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const HOSTIL = "bandido_1";
const MERCADER = "barkeep";
/** Celda del Format D del bandido convertida a metros: donde NO tiene que
 *  reaparecer (`[88,65]` → (12,25 · 0,75)). */
const CELDA_DE_SPAWN = [12.25, 0, 0.75];
/** Cuánto tiene que haberse despegado para que «donde lo dejé» y «su celda»
 *  sean sitios distintos — la misma medida que usa el guion 54. */
const SE_HA_MOVIDO_M = 1.5;
/** Tolerancia de vuelta: se compara el save contra lo que el bridge sirve a
 *  partir de ese mismo save, así que la vuelta es exacta. */
const VUELVE_AHI_M = 0.5;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);
  await ctx.waitFor(
    "el bandido de la escena está en el mundo",
    (id) => window.__nefan.enemies().find((e) => e.id === id) ?? null,
    60_000,
    HOSTIL,
  );

  // ── 1 · SE LE PEGA (y con eso engancha y empieza a perseguir) ───────────
  await acercarse(ctx, HOSTIL, { objetivo: 1.6, lista: "enemies" });
  await herirHasta(ctx, HOSTIL, 45);
  const herido = await ctx.page.evaluate(
    (id) => window.__nefan.enemies().find((x) => x.id === id)?.hp ?? null,
    HOSTIL,
  );
  ctx.log(`vida del bandido tras la pelea: ${herido}`);
  ctx.expect(
    "precondición: el bandido queda HERIDO y vivo (si no, no hay herida que reanudar)",
    typeof herido === "number" && herido > 0 && herido < 60,
    String(herido),
  );

  // ── 2 · Y SE LE ALEJA DE SU CELDA (persiguiendo al jugador) ─────────────
  // El jugador se va a hablar con el tabernero; el bandido, enganchado, le
  // sigue. Es el camino del jugador, no un `setPos`. La conversación es además
  // lo que dispara el `save()` del bridge.
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor(
    "el tabernero contesta (y con la respuesta, el bridge GUARDA)",
    () => window.__nefan.dialogueVisible || null,
    60_000,
  );
  await ctx.nefan("chooseDialogue", 0);
  // El `narrative_event` del turno 2 se difunde DESPUÉS de `save()`, así que
  // ver aparecer al secuaz es la prueba de que el save ya está en disco.
  await ctx.expectEspera(
    "el motor contesta al turno 2 (y con ello el save con vida y posición ya está escrito)",
    true,
    () => (window.__nefan.enemies().length > 1 ? true : null),
    { ms: 90_000 },
  );

  // ── 3 · REANUDAR POR LA TARJETA, COMO QUIEN JUEGA ───────────────────────
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "esta corrida no tiene disco propio (stack adoptado): sin el save no hay referencia exacta " +
        "ni de la vida ni de la posición",
    );
  }
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const rec = save.entities.find((e) => e.id === HOSTIL);
  const enElSave = rec?.position ?? null;
  const vidaEnElSave = rec?.data?.combat?.health ?? null;
  ctx.log(
    `en el save: posición ${JSON.stringify(enElSave)} · combate ${JSON.stringify(rec?.data?.combat)}`,
  );
  ctx.expect(
    "precondición: el save guardó al bandido HERIDO",
    typeof vidaEnElSave === "number" && vidaEnElSave < 60,
    JSON.stringify(rec?.data?.combat),
  );
  ctx.expect(
    "precondición: …y LEJOS de su celda de spawn (si no, no hay nada que medir)",
    Array.isArray(enElSave) && dist(enElSave, CELDA_DE_SPAWN) >= SE_HA_MOVIDO_M,
    JSON.stringify({ save: enElSave, celda: CELDA_DE_SPAWN }),
  );

  const tarjeta = await ctx.page.$(
    `button[data-action="resume"][data-session-id="${partida.sessionId}"]`,
  );
  ctx.expect("el título ofrece REANUDAR la partida", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  const vuelto = await ctx.waitFor(
    "el bandido vuelve al mundo",
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? { pos: [e.pos.x, e.pos.y, e.pos.z], hp: e.hp, maxHp: e.maxHp } : null;
    },
    60_000,
    HOSTIL,
  );
  await ctx.shot("herido-y-movido-tras-reanudar");
  ctx.log(`tras reanudar: ${JSON.stringify(vuelto)}`);

  // ── 4 · LAS DOS COSAS, CADA UNA CON SU ASERTO ───────────────────────────
  ctx.expect(
    "criterio 2 · el enemigo herido vuelve DONDE lo dejé, no en su celda de spawn",
    dist(vuelto.pos, enElSave) < VUELVE_AHI_M &&
      dist(vuelto.pos, CELDA_DE_SPAWN) >= SE_HA_MOVIDO_M,
    JSON.stringify({ vuelto: vuelto.pos, save: enElSave, celda: CELDA_DE_SPAWN }),
  );
  // IGUALDAD EXACTA con el save, no «menos de 60»: con `< 60` este aserto
  // seguiría en verde con la vida restaurada a cualquier valor herido, y lo
  // que se afirma es que vuelve LA HERIDA QUE LE HICISTE.
  ctx.expect(
    "criterio 2 · …y CON SU VIDA: exactamente la que dejó el save, no el máximo",
    vuelto.hp === vidaEnElSave && vuelto.maxHp === 60,
    JSON.stringify({ vuelto: { hp: vuelto.hp, maxHp: vuelto.maxHp }, save: vidaEnElSave }),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
