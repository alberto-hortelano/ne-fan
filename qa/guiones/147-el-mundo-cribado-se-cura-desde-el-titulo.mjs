/** #577 · EL MUNDO PRE-GENERADO SE CURA, Y SOLO POR DONDE ESTÁ ROTO.
 *
 *  El guion 127, bloque E4, mide la conducta de ANTES y la sigue midiendo:
 *  sin pulsar nada, un tile cribado cuesta una llamada al motor en CADA
 *  partida nueva (`[1,1,1]`). Ese bloque no se toca — este guion mide lo que
 *  pasa cuando el jugador SÍ pulsa, que es un camino nuevo y no el mismo con
 *  otro resultado.
 *
 *  Lo que se afirma, con el mundo pre-generado de verdad y el motor falso
 *  (0 créditos):
 *
 *   C0 · el botón NO está cuando no hay nada que curar — el control negativo.
 *        Sin él, «el botón se pinta siempre» saldría verde en todo lo demás.
 *   C1 · con DOS escenas cribadas el título lo dice («7 de 9 escenas») y
 *        ofrece completar el mundo.
 *   C2 · curar cuesta EXACTAMENTE 2 llamadas al motor, no 9: es la diferencia
 *        entre este botón y «↻ Regenerar mundo», y el discriminador que
 *        separa «cura lo cribado» de «regenera el mundo».
 *   C3 · el chip pasa a «✓ generado» SIN recorte, y las otras 7 escenas salen
 *        byte a byte como estaban.
 *   C4 · la partida siguiente arranca con CERO llamadas y sin una sola línea
 *        «se CRIBA» en el log del bridge — el final del recorrido de #577.
 *   C5 · y curado ya no hay nada que curar: el botón vuelve a desaparecer.
 *
 *  POR QUÉ NO SE PIDE AQUÍ NINGÚN TILE POR EL CABLE: lo que el 120 y el 127
 *  hacen con `pedirYEsperarTile` (`lib/sesion.mjs`) es provocar la generación
 *  de un vecino y juzgar qué le pasó; aquí no hace falta, porque todo lo que se
 *  espera es la FASE que publica el título (`data-gen-phase`, cortafuegos de
 *  240 s) y el arranque de la partida, que ya tienen su espera por estado en
 *  `lib/sesion`. (Este párrafo decía antes que aquella espera «mide 90 s de
 *  reloj de PARED y por eso es intermitente»: ese diagnóstico de #656 quedó
 *  desmentido —la pared es legítima para el bridge, lo que fallaba es que al
 *  expirar no decía nada— y el helper de hoy tiene tres desenlaces.)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import {
  abrirSelectorDeMundos,
  comenzar,
  curarMundo,
  nuevaPartida,
  recargarAlTitulo,
  regenerarMundo,
} from "../lib/sesion.mjs";

export const aisla = ["mundo", "fake-ai", "saves"];

const GAME = "alta_fantasia";

/** Llamadas cobradas por el fake en `/generate_scene`. */
async function generaciones() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return c?.gasto?.rutas?.["/generate_scene"] ?? 0;
}

/** Lo que el jugador lee y ve del mundo en el selector del título. */
async function panelDeGeneracion(ctx) {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME}"]`);
  const leido = await ctx.page.evaluate(() => {
    const boton = document.getElementById("ts-gen-repair");
    return {
      estado: document.getElementById("ts-gen-state")?.textContent ?? "",
      curar: boton && boton.style.display !== "none" ? (boton.textContent ?? "") : null,
    };
  });
  await ctx.page.click("#ts-back");
  return leido;
}

/** Rompe un tile del ANILLO como lo haría un validador que se endureció: un
 *  NPC nacido en celda no transitable (`nace-en-solido`, #289). Misma técnica
 *  que los guiones 120 y 127 — el agua `w` es el sólido del alfabeto. */
function romperElAnillo(escena, [col, row]) {
  const fila = escena.terrain[row];
  escena.terrain[row] = fila.slice(0, col) + "w" + fila.slice(col + 1);
  const molde = escena.entities.find((e) => e.kind === "prop") ?? escena.entities[0];
  const npc = JSON.parse(JSON.stringify(molde));
  npc.id = `ahogado_${escena.scene_id}`;
  npc.kind = "npc";
  npc.name = "Vecino del vado";
  npc.cell = [col, row];
  escena.entities.push(npc);
  return npc.id;
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) {
    ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay disco efímero cuyo tile.json editar");
  }
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const logBridge = join(tmp, "logs", "nefan-bridge.log");
  const leer = () => JSON.parse(readFileSync(tileJson, "utf8"));
  const escribir = (s) => writeFileSync(tileJson, JSON.stringify(s, null, 2) + "\n", "utf8");
  const cribas = () =>
    readFileSync(logBridge, "utf8").split("\n").filter((l) => l.includes("se CRIBA"));

  // ── El mundo de partida: 9 escenas pre-generadas de verdad ─────────────
  await regenerarMundo(ctx, GAME);
  if (!existsSync(tileJson)) ctx.sinMedir(`«Generar mundo» no dejó ${tileJson}`);
  const intacto = leer();
  const ids = Object.keys(intacto.scenes);
  const ENTRADA = intacto.entry_scene_id;
  const anillo = ids.filter((id) => id !== ENTRADA);
  ctx.expect(
    "el mundo pre-generado tiene 9 escenas (entrada + anillo de 8)",
    ids.length === 9 && anillo.length === 8,
    JSON.stringify(ids),
  );
  if (anillo.length !== 8) return;

  // ── C0 · el control negativo: con el mundo SANO no hay botón ────────────
  {
    await recargarAlTitulo(ctx);
    const panel = await panelDeGeneracion(ctx);
    ctx.expect(
      "C0 · con el mundo sano el título dice «✓ generado» sin recorte",
      /✓ generado/.test(panel.estado) && !/escenas;/.test(panel.estado),
      panel.estado.trim(),
    );
    ctx.expect(
      "C0 · …y NO ofrece completar el mundo: no hay nada que curar",
      panel.curar === null,
      `botón visible con el texto «${panel.curar}»`,
    );
  }

  // ── C1 · DOS del anillo cribadas: el título lo dice y ofrece curarlo ────
  const MALOS = anillo.slice(0, 2);
  {
    const roto = JSON.parse(JSON.stringify(intacto));
    const npcs = MALOS.map((id) => romperElAnillo(roto.scenes[id], [10, 10]));
    escribir(roto);
    ctx.log(`C1 · cribadas ${JSON.stringify(MALOS)} (${npcs.join(", ")})`);

    await recargarAlTitulo(ctx);
    const panel = await panelDeGeneracion(ctx);
    ctx.expect(
      "C1 · el título cuenta lo que falta: «7 de 9 escenas»",
      /7 de 9 escenas/.test(panel.estado),
      panel.estado.trim(),
    );
    ctx.expect(
      "C1 · …y ofrece completar el mundo, diciendo cuántas escenas",
      typeof panel.curar === "string" && /2 escenas/.test(panel.curar),
      `«${panel.curar}»`,
    );
  }

  // ── C2/C3 · curar cuesta 2 llamadas, no 9, y no toca lo que estaba ──────
  const rotoEnDisco = leer();
  {
    const antes = await generaciones();
    const fin = await curarMundo(ctx, GAME);
    if (!fin) ctx.sinMedirBloque("el título no ofreció el botón de cura: no hay nada que medir");
    else {
      const tras = await generaciones();
      ctx.expect("C2 · la cura termina bien", fin.fase === "ready", fin.texto);
      ctx.expect(
        "C2 · …y sin fallos parciales",
        !/Fallos parciales/i.test(fin.texto),
        fin.texto,
      );
      // EL discriminador de #577: dos llamadas, una por escena cribada. Con 9
      // sería «Regenerar mundo» con otro nombre — y encima repagando el arte.
      ctx.expect(
        "C2 · curar cuesta EXACTAMENTE 2 llamadas al motor (una por escena cribada), no 9",
        tras === antes + 2,
        `/generate_scene ${antes} → ${tras}`,
      );

      const curado = leer();
      ctx.expect(
        "C3 · el fichero sigue teniendo las 9 escenas",
        Object.keys(curado.scenes).length === 9,
        JSON.stringify(Object.keys(curado.scenes)),
      );
      const cambiadas = ids.filter(
        (id) => JSON.stringify(curado.scenes[id]) !== JSON.stringify(rotoEnDisco.scenes[id]),
      );
      ctx.expect(
        "C3 · cambian EXACTAMENTE las dos cribadas: las otras siete salen byte a byte como estaban",
        cambiadas.length === 2 && MALOS.every((id) => cambiadas.includes(id)),
        `cambiaron ${JSON.stringify(cambiadas)}`,
      );
      // El world_map tampoco se mueve: la cura no siembra lugares nuevos.
      ctx.expect(
        "C3 · …y el world_map del mundo es el mismo",
        JSON.stringify(curado.world_map) === JSON.stringify(rotoEnDisco.world_map),
        `${Object.keys(curado.world_map?.places ?? {}).length} lugares`,
      );

      await recargarAlTitulo(ctx);
      const panel = await panelDeGeneracion(ctx);
      ctx.expect(
        "C3 · el chip pierde el recorte: «✓ generado» y nada más",
        /✓ generado/.test(panel.estado) && !/de 9 escenas/.test(panel.estado),
        panel.estado.trim(),
      );
      ctx.expect(
        "C5 · …y el botón de completar desaparece: ya no hay nada que curar",
        panel.curar === null,
        `botón visible con el texto «${panel.curar}»`,
      );
      await ctx.shot("147-mundo-curado-sin-recorte");
    }
  }

  // ── C4 · la partida siguiente no paga nada y nadie criba ────────────────
  {
    const antesCribas = cribas().length;
    const antes = await generaciones();
    await recargarAlTitulo(ctx);
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras = await generaciones();
    ctx.expect(
      "C4 · la partida siguiente arranca con CERO llamadas al motor",
      tras === antes,
      `/generate_scene ${antes} → ${tras}`,
    );
    ctx.expect(
      "C4 · …y el bridge no criba NADA: el fichero quedó sano de verdad, no solo a la vista",
      cribas().length === antesCribas,
      `${cribas().length - antesCribas} línea(s) «se CRIBA» tras la cura`,
    );
    const tiles = await ctx.nefan("tiles");
    ctx.expect(
      "C4 · el cliente recibe la entrada",
      Array.isArray(tiles) && tiles.includes(ENTRADA),
      JSON.stringify(tiles),
    );
  }
}
