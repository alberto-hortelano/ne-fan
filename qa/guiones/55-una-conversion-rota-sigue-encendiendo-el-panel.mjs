/** El fail-loud de conversión celda→metro SIGUE PUDIENDO PONERSE ROJO después
 *  de #351, y se mide en el juego real (criterio 2b de la tanda «Lo que el
 *  jugador pierde»).
 *
 *  POR QUÉ EXISTE ESTE GUION. #351 mete la posición VIVA en `npcs[].position`
 *  de la escena que sale al cable, y esa es justo la lista que el candado de
 *  `addTile` recorre buscando conversiones celda→metro rotas. La trampa que el
 *  requisito nombra: si el arreglo hubiera sido «marca al rehidratado y no lo
 *  mires», el candado se habría apagado ENTERO —`registerSceneNpcs` mete a
 *  TODO NPC de escena en el ledger nada más registrarla, así que a la primera
 *  difusión estarían todos marcados—. El arreglo que se hizo es otro: la
 *  posición DECLARADA se aparta en `position_declared` y el checker de core
 *  (`npcsFueraDelRect`, `src/session/mundo-persistido.ts`) mide
 *  `position_declared ?? position`.
 *
 *  Que eso está bien escrito lo dice `test/mundo-persistido.test.ts`. Lo que
 *  NINGÚN test podía decir hasta hoy es que la cadena entera —bridge que
 *  escribe la declarada, cable, cliente que la mide, panel que la pinta— sigue
 *  encendiendo el aviso que ve QUIEN JUEGA. `nefan-html` no tiene tests
 *  unitarios ni mutación (#241/#357), así que el único sitio donde ese tramo
 *  puede ponerse rojo es aquí.
 *
 *  CÓMO SE LLEGA AL ESTADO SIN TRUCAR EL CLIENTE. Se rompe LA DECLARACIÓN en
 *  el save —la `cell` del tabernero en el Format D persistido pasa a una celda
 *  fuera del grid— y se reanuda por la tarjeta del título, como el guion 50 y
 *  el 46. Entonces:
 *
 *   · `formatDToWorld` convierte esa celda a una coordenada fuera del rect del
 *     tile: es EXACTAMENTE la firma de una conversión rota, que es lo que el
 *     candado existe para cazar;
 *   · el ledger sigue teniendo la posición VIVA del tabernero, dentro del
 *     rect, así que `escenaConCombateVivo` la pone en `position` y aparta la
 *     rota en `position_declared`.
 *
 *  Y ahí está el filo del guion: `position` está DENTRO y `position_declared`
 *  FUERA. Un candado que mirase la viva (o que exentara al que trae la
 *  declarada) saldría en verde sin decir nada, y este guion se pondría rojo.
 *  No mide «el checker funciona»: mide «el checker mide LA COORDENADA QUE
 *  TOCA», que es la mitad que el arreglo de #351 podía haberse llevado por
 *  delante.
 *
 *  PROBADO EN NEGATIVO (2026-09-01, QA de la tanda), con las DOS formas de
 *  debilitar el candado:
 *   1 · el checker mide `npc.position` en vez de `position_declared ?? …`
 *       (o sea, la viva) → el panel se queda en «— sin errores —» y el aserto
 *       principal se pone rojo;
 *   2 · la exención que proponía el plan (`if (npc.position_declared !==
 *       undefined) continue;`) → mismo rojo, mismo volcado.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el tabernero lo declara el tile
 *  de bootstrap de `labs/narrative/fake-scenes.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  nuevaPartida,
  comenzar,
  esperarListaDeSaves,
  esperarTituloListo,
} from "../lib/sesion.mjs";
import { rutaDelSave } from "../lib/saves.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** El tabernero: NPC de ESCENA (lo declara el Format D del bootstrap), no de
 *  runtime — el sujeto exacto del candado, que solo mira `data.npcs`. */
const NPC = "barkeep";
/** La celda rota. Fuera del grid 128×128, así que su conversión cae MUY lejos
 *  del rect del tile (x = minX + (400 + 0,5)·0,5 = 168,25 m con minX = −32).
 *  Lejos a propósito: un error de conversión de verdad no se queda a 20 cm. */
const CELDA_ROTA = [400, 400];

/** Las entradas del panel de errores, tal cual las lee quien juega. */
const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );

/** Lo que trae la ESCENA del cable para un npc: dónde lo pone y qué declaraba
 *  el Format D. */
const enElCable = (ctx, id) =>
  ctx.page.evaluate((q) => {
    const s = window.__nefan.scene;
    const n = (s?.npcs ?? []).find((x) => x.id === q);
    return n
      ? { position: n.position, declarada: n.position_declared ?? null, rect: s.world_rect ?? null }
      : null;
  }, id);

const dentroDelRect = (p, r) =>
  Array.isArray(p) && r && p[0] >= r.minX && p[0] < r.maxX && p[2] >= r.minZ && p[2] < r.maxZ;

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID });
  const partida = await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero de la escena está en el mundo",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    NPC,
  );

  // Control ANTES de romper nada: con la partida sana el panel no dice nada de
  // rects. Sin esto, un panel que gritara por cualquier cosa haría verde el
  // aserto de abajo sin que el candado hubiera medido nada.
  const limpio = await panelDeErrores(ctx);
  ctx.log(`panel con la partida sana: ${JSON.stringify(limpio)}`);
  ctx.expect(
    "precondición: con la declaración sana NADIE está fuera de su rect",
    limpio.every((t) => !t.includes("fuera de su rect")),
    JSON.stringify(limpio.filter((t) => t.includes("fuera de su rect"))),
  );

  await ctx.page.reload({ waitUntil: "domcontentloaded" });
  await ctx.waitFor("window.__nefan disponible tras el reload", () => Boolean(window.__nefan));
  await esperarTituloListo(ctx);
  await esperarListaDeSaves(ctx);

  // ── SE ROMPE LA DECLARACIÓN, NO LA POSICIÓN VIVA ────────────────────────
  // La `cell` vive en el Format D persistido (`scenes_loaded[].scene_data`),
  // que es lo que `formatDToWorld` convierte cada vez que la escena sale al
  // cable. El ledger (`entities[].position`) NO se toca: ahí sigue la posición
  // viva, dentro del rect. Ese contraste es el filo del guion.
  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "esta corrida no tiene disco propio (stack adoptado): sin el save no se puede romper la " +
        "declaración de nadie",
    );
  }
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  let roto = null;
  for (const [sceneId, rec] of Object.entries(save.scenes_loaded ?? {})) {
    const ent = (rec?.scene_data?.entities ?? []).find((e) => e.id === NPC);
    if (!ent) continue;
    roto = { sceneId, antes: [...ent.cell] };
    ent.cell = [...CELDA_ROTA];
    break;
  }
  ctx.expect(
    "precondición: el Format D persistido declara al tabernero con su celda",
    Boolean(roto),
    JSON.stringify(Object.keys(save.scenes_loaded ?? {})),
  );
  if (!roto) return;
  const enElLedger = save.entities.find((e) => e.id === NPC)?.position ?? null;
  writeFileSync(ruta, JSON.stringify(save, null, 2));
  ctx.log(
    `saboteado ${NPC} en ${roto.sceneId}: cell ${JSON.stringify(roto.antes)} → ` +
      `${JSON.stringify(CELDA_ROTA)} · su posición VIVA en el ledger sigue en ${JSON.stringify(enElLedger)}`,
  );

  // ── REANUDAR POR LA TARJETA, COMO QUIEN JUEGA ───────────────────────────
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

  // ── LO QUE HACE DISCRIMINANTE AL ASERTO ─────────────────────────────────
  const cable = await enElCable(ctx, NPC);
  ctx.log(`tabernero en el cable: ${JSON.stringify(cable)}`);
  if (!cable) {
    ctx.sinMedirBloque(
      "el tabernero no viene en la escena del cable: sin sus dos coordenadas no se puede afirmar " +
        "CUÁL de las dos mide el candado",
    );
  } else {
    ctx.expect(
      "la posición VIVA del tabernero está DENTRO del rect (un candado que mirase esta callaría)",
      dentroDelRect(cable.position, cable.rect),
      JSON.stringify({ position: cable.position, rect: cable.rect }),
    );
    ctx.expect(
      "…y la DECLARADA, la que trae la conversión rota, está FUERA",
      Array.isArray(cable.declarada) && !dentroDelRect(cable.declarada, cable.rect),
      JSON.stringify({ declarada: cable.declarada, rect: cable.rect }),
    );
  }

  // ── EL CANDADO SIGUE PUDIENDO PONERSE ROJO, Y EL JUGADOR LO LEE ─────────
  // `expectEspera` y no un `waitFor` suelto: aquí la expiración ES el defecto
  // que se busca (el candado apagado), así que tiene que quedar AFIRMADA y con
  // el recuento de sondeos delante — una expiración que nadie observó no
  // distingue «no se encendió» de «no llegué a mirar».
  await ctx.expectEspera(
    "el panel del jugador DICE que hay una entidad declarada fuera de su rect",
    true,
    (id) => {
      const txt = Array.from(document.querySelectorAll("#error-log > div")).map(
        (n) => n.textContent ?? "",
      );
      return txt.some((t) => t.includes(id) && t.includes("fuera de su rect")) ? txt : null;
    },
    {
      ms: 60_000,
      arg: NPC,
      aserto:
        "criterio 2b · el fail-loud de conversión celda→metro SIGUE encendiéndose con un NPC " +
        "declarado fuera de sitio",
    },
  );
  const errores = await panelDeErrores(ctx);
  ctx.log(`panel de errores tras reanudar: ${JSON.stringify(errores)}`);
  await ctx.shot("conversion-rota-en-el-panel");
  // La coordenada que NOMBRA es la declarada (168,3), no la viva: un mensaje
  // que dijera la viva estaría midiendo la otra cosa y saldría verde arriba.
  const linea = errores.find((t) => t.includes(NPC) && t.includes("fuera de su rect")) ?? "";
  ctx.expect(
    "…y nombra la coordenada DECLARADA, que es la rota (no la viva, que está bien)",
    /168\.[0-9]/.test(linea),
    linea,
  );
  // Control: solo salta el saboteado. Un candado que reportara a todo el mundo
  // sería tan inútil como uno apagado, y el jugador lo leería como ruido.
  const fuera = errores.filter((t) => t.includes("fuera de su rect"));
  ctx.expect(
    "…y SOLO por el saboteado: el resto de la escena no genera ruido en el panel",
    fuera.length === 1,
    JSON.stringify(fuera),
  );

  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
