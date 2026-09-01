/** Lo que se MOVIÓ vuelve donde lo dejaste, no a su celda de spawn (#351).
 *
 *  El guion 42 mide que la HERIDA del enemigo de escena sobrevive; el 48, que
 *  el mundo de runtime vuelve entero. Entre los dos faltaba la otra mitad de
 *  «el mundo vuelve como lo dejaste»: DÓNDE. La vida viajaba desde #326 y la
 *  posición se guardaba (`narrative-state.ts` la vuelca en cada `save()`) pero
 *  no se servía — `escenaConCombateVivo` solo reescribía `combat`—, así que el
 *  bandido al que perseguiste media plaza reaparecía en la casilla del
 *  Format D. Medido en su día: `bandido_1` a (8,01 · 0,70) reanudaba en
 *  (12,25 · 0,75), con y sin daño.
 *
 *  Lo que se afirma, y por qué cada cosa:
 *   1 · EL ENEMIGO SE MUEVE Y EL SAVE SE ENTERA. Sin esto el resto es un verde
 *       vacío: si el bandido no se hubiera movido, «vuelve donde estaba» y
 *       «vuelve a su celda» serían el mismo sitio.
 *   2 · AL REANUDAR ESTÁ DONDE EL SAVE DICE, no en su celda de spawn. Es el
 *       criterio 2 de la tanda, dicho con las dos mitades: se compara contra
 *       el save (la referencia exacta, sin carreras) Y contra la celda de
 *       spawn (lo que el jugador vería mal).
 *   2b· LO QUE ESTE GUION **NO** MIDE: la vida. Al bandido no se le pega
 *       aquí, así que la esperada es el máximo y cualquier aserto sobre ella
 *       pasa con la herida borrada (medido por QA el 2026-09-01). Esa mitad
 *       del criterio la mide el guion 57, que hiere y desplaza a la vez.
 *   3 · EL PACÍFICO TAMBIÉN, y se mide EN EL CABLE. El tabernero es el sujeto
 *       que el issue no nombraba: `npc-behavior.ts` mueve el record de
 *       cualquier NPC ambiental y un NPC sin bloque `combat` no tenía estado,
 *       así que salía intacto. En PANTALLA su bug dura un fotograma —el
 *       `state_update` del bridge le corrige la posición en el primer tick—,
 *       así que buscarlo ahí sería medir 16 ms; donde es permanente y
 *       observable es en la escena que llega por el cable
 *       (`__nefan.scene.npcs`), que es lo que el cliente pinta antes de que
 *       nadie le corrija.
 *   4 · Y EL FAIL-LOUD DE RECT NO SE ENCIENDE. La trampa de esta tanda: meter
 *       la posición viva en `npcs[].position` mete al que se movió en la lista
 *       que el candado de conversión celda→metro recorre. Si el arreglo
 *       hubiera sido «márcalo y no lo mires», este aserto saldría verde
 *       igual… y por eso el candado NO se toca aquí: se afirma que no hay
 *       falsos rojos, y que sigue pudiendo ponerse rojo lo afirma
 *       `nefan-core/test/mundo-persistido.test.ts`, donde hay mutación.
 *
 *  PROBADO EN NEGATIVO (2026-09-01, sobre el árbol de la tanda): quitando de
 *  `escenaConCombateVivo` (`nefan-core/src/session/mundo-persistido.ts`) la
 *  línea que pone `position: [...estado.posicion]`, los asertos 2 y 3 se ponen
 *  rojos con el volcado del defecto entero: el bandido reanuda en
 *  (12,25 · 0,75) —su celda del Format D— habiendo quedado a metros de ahí.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el bandido y el tabernero los
 *  declara el tile de bootstrap de `labs/narrative/fake-scenes.ts`.
 */
import { readFileSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";
import { acercarse } from "../lib/combate.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes y el
 *  contador a 0. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
const HOSTIL = "bandido_1";
const MERCADER = "barkeep";
/** Celdas del Format D del tile de bootstrap, convertidas a metros mundo: es
 *  DONDE NO tiene que reaparecer. `bandido_1` [88,65] → (12,25 · 0,75);
 *  `barkeep` [79,63] → (7,75 · −0,25). Escritas aquí porque son la medida del
 *  issue, y si el doble las cambia este guion tiene que enterarse. */
const CELDA_DE_SPAWN = { [HOSTIL]: [12.25, 0.75], [MERCADER]: [7.75, -0.25] };
/** Tolerancia de «vuelve donde estaba»: la deriva entre el último `save()` y
 *  la lectura, no un margen de estilo. Medido en la corrida del 2026-09-01:
 *  la vuelta es EXACTA (0,00 m), porque lo que se compara es el save contra lo
 *  que el bridge sirve a partir de ese mismo save. */
const VUELVE_AHI_M = 0.5;
/** Cuánto tiene que haberse despegado de su celda para que los dos desenlaces
 *  —«vuelve donde lo dejé» y «vuelve a su celda»— sean SITIOS DISTINTOS.
 *
 *  Tres veces la tolerancia de vuelta, no un número redondo: por debajo de eso
 *  el aserto no distinguiría un arreglo de una coincidencia. Y no más, porque
 *  la geometría del doble lo acota — el tabernero está a 4,6 m de la celda del
 *  bandido, y el bandido persigue al JUGADOR, que está hablando con el
 *  tabernero: medido, se despega entre 2,4 y 4 m según dónde haya paseado el
 *  tabernero. Pedir 6 m sería pedir que el bench tuviera otro mapa. */
const SE_HA_MOVIDO_M = 1.5;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** `[x, z]` de la tabla de celdas → `[x, y, z]` de mundo, que es como viajan
 *  las posiciones en todas partes. */
const enMetros = ([x, z]) => [x, 0, z];

/** Dónde tiene el CLIENTE a cada uno, ahora mismo. */
const donde = (ctx, id, lista) =>
  ctx.page.evaluate(
    ([q, l]) => {
      const e = window.__nefan[l]().find((x) => x.id === q);
      return e ? [e.pos.x, e.pos.y, e.pos.z] : null;
    },
    [id, lista],
  );

/** Lo que trae la ESCENA del cable para un npc: dónde lo pone y qué declaraba
 *  el Format D (`position_declared`, lo que sigue midiendo el fail-loud). */
const enElCable = (ctx, id) =>
  ctx.page.evaluate((q) => {
    const n = (window.__nefan.scene?.npcs ?? []).find((x) => x.id === q);
    return n ? { position: n.position, declarada: n.position_declared ?? null } : null;
  }, id);

/** Las entradas del panel de errores, tal cual las lee quien juega. */
const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);

  await ctx.waitFor(
    "el bandido de la escena está en el mundo",
    (id) => window.__nefan.enemies().find((e) => e.id === id) ?? null,
    60_000,
    HOSTIL,
  );
  const spawnVisto = await donde(ctx, HOSTIL, "enemies");
  ctx.log(`bandido en su celda de spawn: ${JSON.stringify(spawnVisto)}`);
  ctx.expect(
    "precondición: el bandido arranca en la celda que declara el Format D",
    dist(spawnVisto, enMetros(CELDA_DE_SPAWN[HOSTIL])) < 0.1,
    JSON.stringify({ visto: spawnVisto, celda: CELDA_DE_SPAWN[HOSTIL] }),
  );

  // ── 1 · SE MUEVE, Y EL SAVE SE ENTERA ───────────────────────────────────
  // Acercarse lo ENGANCHA (aggro 10 m) y a partir de ahí persigue al jugador:
  // el camino del jugador, no un `setPos`. El save lo escribe la conversación
  // con el tabernero, que es lo que hace `handleDialogueChoice`.
  await acercarse(ctx, HOSTIL, { objetivo: 1.6, lista: "enemies" });

  // Y de ahí al tabernero, que hace su vida ambiental por su cuenta: el
  // bandido sigue al JUGADOR, así que este paseo es lo que acaba de
  // despegarlo de su celda. Se afirma DESPUÉS, sobre el save, que es la
  // referencia que importa.
  await acercarse(ctx, MERCADER, { objetivo: 2.2, lista: "npcs" });
  await ctx.nefan("inputDriver.queueInteract");
  await ctx.waitFor(
    "el tabernero contesta (y con la respuesta, el bridge GUARDA)",
    () => window.__nefan.dialogueVisible || null,
    60_000,
  );
  await ctx.nefan("chooseDialogue", 0);
  // Se espera al SPAWN del turno 2, y no por comodidad: el bridge difunde el
  // `narrative_event` DESPUÉS de `save()` (`reportAndDispatch`), así que ver
  // aparecer al secuaz es la prueba de que el save con las posiciones ya está
  // escrito. Sin este anclaje, el guion podría recargar antes de guardar y el
  // rojo no sería del juego.
  await ctx.expectEspera(
    "el motor contesta al turno 2 (y con ello el save con las posiciones ya está escrito)",
    true,
    () => (window.__nefan.enemies().length > 1 ? true : null),
    { ms: 90_000 },
  );

  const antesHostil = await donde(ctx, HOSTIL, "enemies");
  const antesMercader = await donde(ctx, MERCADER, "npcs");
  ctx.log(`antes de reanudar: bandido ${JSON.stringify(antesHostil)} · tabernero ${JSON.stringify(antesMercader)}`);

  // ── 2 · REANUDAR POR LA TARJETA, COMO QUIEN JUEGA ───────────────────────
  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // El save es la referencia EXACTA de «donde lo dejé»: se lee con el cliente
  // ya recargado, así que nadie lo está moviendo mientras se mira. Comparar
  // contra la última lectura del cliente sería comparar contra una foto que el
  // último `save()` puede no haber alcanzado.
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "esta corrida no tiene disco propio (stack adoptado): sin el save no hay referencia exacta " +
        "de «donde lo dejé»",
    );
  }
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const enElSave = Object.fromEntries(
    [HOSTIL, MERCADER].map((id) => [id, save.entities.find((e) => e.id === id)?.position ?? null]),
  );
  ctx.log(`posiciones en el save: ${JSON.stringify(enElSave)}`);
  ctx.expect(
    "el save guardó al bandido LEJOS de su celda de spawn (si no, no hay nada que medir)",
    Boolean(enElSave[HOSTIL]) &&
      dist(enElSave[HOSTIL], enMetros(CELDA_DE_SPAWN[HOSTIL])) >= SE_HA_MOVIDO_M,
    JSON.stringify({ save: enElSave[HOSTIL], celda: CELDA_DE_SPAWN[HOSTIL] }),
  );

  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${partida.sessionId}"]`);
  ctx.expect("el título ofrece REANUDAR la partida", Boolean(tarjeta), partida.sessionId);
  if (!tarjeta) return;
  await tarjeta.click();
  await ctx.waitFor(
    "la escena vuelve tras reanudar",
    () => (window.__nefan.status().scene ? window.__nefan.scene.scene_id : null),
    180_000,
  );
  const vueltoHostil = await ctx.waitFor(
    "el bandido vuelve al mundo",
    (id) => {
      const e = window.__nefan.enemies().find((x) => x.id === id);
      return e ? [e.pos.x, e.pos.y, e.pos.z] : null;
    },
    60_000,
    HOSTIL,
  );
  await ctx.shot("tras-reanudar");
  ctx.log(`tras reanudar: bandido ${JSON.stringify(vueltoHostil)}`);

  // ── 3 · DONDE LO DEJÉ, NO EN SU CELDA ───────────────────────────────────
  const aDondeLoDeje = dist(vueltoHostil, enElSave[HOSTIL]);
  const aSuCelda = dist(vueltoHostil, enMetros(CELDA_DE_SPAWN[HOSTIL]));
  ctx.expect(
    "#351 · el bandido reanuda DONDE LO DEJÉ (lo que dice el save)",
    aDondeLoDeje < VUELVE_AHI_M,
    JSON.stringify({ vuelto: vueltoHostil, save: enElSave[HOSTIL], d: aDondeLoDeje }),
  );
  ctx.expect(
    "…y NO en la celda de spawn del Format D, que es donde reaparecía",
    aSuCelda >= SE_HA_MOVIDO_M,
    JSON.stringify({ vuelto: vueltoHostil, celda: CELDA_DE_SPAWN[HOSTIL], d: aSuCelda }),
  );
  // Y la forma RELATIVA del mismo hecho, que es la que no puede salir verde
  // por casualidad: da igual cuánto se haya movido, lo que se afirma es que de
  // los dos sitios posibles ha vuelto al que dice el save y no al del Format D.
  ctx.expect(
    "…y de los dos sitios posibles, el bandido está MUCHO más cerca del save que de su celda",
    aDondeLoDeje * 3 < aSuCelda,
    JSON.stringify({ aDondeLoDeje, aSuCelda }),
  );
  // AQUÍ NO SE AFIRMA LA VIDA, y el hueco es a propósito: en este guion al
  // bandido no se le pega, así que la vida esperada ES el máximo y cualquier
  // aserto sobre ella se cumple igual con la herida borrada. Lo tuvo escrito
  // («…con su vida y su denominador») y QA lo midió: quitando
  // `health: estado.combate.health` de `escenaConCombateVivo`, el bandido
  // reanuda a 60/60 con el save en 41,7 y esta línea seguía VERDE. Un aserto
  // que no puede ponerse rojo es peor que no tenerlo, porque ocupa el sitio
  // del que sí mediría.
  //
  // La mitad «con su vida» del criterio 2 la mide el guion 57
  // (`57-el-enemigo-herido-que-huyo-vuelve-con-las-dos-cosas.mjs`): hiere Y
  // desplaza, y compara la vida con IGUALDAD EXACTA contra el save. Aquí se
  // deja el registro para el diagnóstico, sin afirmar sobre él.
  const hp = await ctx.page.evaluate((id) => {
    const e = window.__nefan.enemies().find((x) => x.id === id);
    return e ? { hp: e.hp, maxHp: e.maxHp } : null;
  }, HOSTIL);
  ctx.log(`vida del bandido tras reanudar (sin afirmar: aquí no se le ha pegado): ${JSON.stringify(hp)}`);

  // ── 4 · EL PACÍFICO, EN EL CABLE ────────────────────────────────────────
  // En pantalla su bug dura un fotograma (el `state_update` le corrige la
  // posición en el primer tick), así que aquí se mira lo que el bridge SIRVE:
  // la escena que el cliente pinta antes de que nadie le corrija.
  const cable = await enElCable(ctx, MERCADER);
  ctx.log(`tabernero en el cable: ${JSON.stringify(cable)}`);
  if (!cable || !enElSave[MERCADER]) {
    ctx.sinMedirBloque(
      "el tabernero no viene en la escena del cable o no está en el save: sin las dos mitades no " +
        "se puede comparar lo servido con lo guardado",
    );
  } else {
    ctx.expect(
      "#351 · la escena del cable trae al tabernero DONDE lo dejó el save, no en su celda",
      dist(cable.position, enElSave[MERCADER]) < VUELVE_AHI_M,
      JSON.stringify({ cable: cable.position, save: enElSave[MERCADER] }),
    );
    ctx.expect(
      "…y la posición DECLARADA viaja aparte: es lo que el fail-loud sigue midiendo",
      Array.isArray(cable.declarada) &&
        dist(cable.declarada, enMetros(CELDA_DE_SPAWN[MERCADER])) < 0.1,
      JSON.stringify({ declarada: cable.declarada, celda: CELDA_DE_SPAWN[MERCADER] }),
    );
  }

  // ── 5 · Y SIN FALSOS ROJOS EN EL PANEL DEL JUGADOR ──────────────────────
  const errores = await panelDeErrores(ctx);
  ctx.log(`panel de errores: ${JSON.stringify(errores)}`);
  ctx.expect(
    "el fail-loud de rect NO se enciende por un personaje que se movió (cero falsos rojos)",
    errores.every((t) => !t.includes("fuera de su rect")),
    JSON.stringify(errores.filter((t) => t.includes("fuera de su rect"))),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
