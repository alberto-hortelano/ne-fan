/** #451 con MÁS DE UN ELEMENTO: la criba en todos los estados del mundo.
 *
 *  El guion 120 mide dos estados —UNA del anillo mala, y la entrada mala— y
 *  los dos son de cardinalidad uno. Con un solo tile malo, «se criba el
 *  primero que falla» y «se criban todos los que fallan» dan exactamente el
 *  mismo verde, y lo mismo pasa con «se conserva lo que había» frente a «se
 *  conserva lo que había la primera vez». Esto recorre los estados que sí
 *  distinguen una regla de su contraria, con el mundo pre-generado de verdad
 *  y el motor falso (0 créditos):
 *
 *   E0 · NINGUNA mala — control negativo en el juego, no en un test: la
 *        partida arranca sin motor y el bridge no criba NADA. Sin él, un
 *        `cribadas.push(id)` incondicional saldría verde en todos los demás.
 *   E1 · DOS del anillo malas — se criban LAS DOS (no la primera), la partida
 *        sigue costando cero, y cada una cuesta exactamente una llamada
 *        cuando el jugador llega.
 *   E2 · LAS OCHO del anillo malas — el caso límite de (b): se sirve solo la
 *        entrada. Se mide además QUÉ LEE EL JUGADOR en el título, porque es
 *        lo único que tiene para decidir si regenera.
 *   E3 · la ENTRADA mala Y una del anillo mala — el estado mixto, que no es
 *        ninguno de los dos del 120: el bootstrap vivo cura la entrada y
 *        CONSERVA la mala del anillo tal cual, así que la partida siguiente
 *        la vuelve a cribar.
 *   E4 · la MISMA partida dos y tres veces — lo que el ingeniero declara sin
 *        medir: «el tile cribado no se cura en disco». Se cuenta lo que paga
 *        el jugador en la 1.ª, la 2.ª y la 3.ª partida nueva, y lo que paga
 *        al REANUDAR (que no es lo mismo).
 *   E5 · el world_map del merge — la otra declaración sin medir: el mapa que
 *        se escribe con las ocho escenas conservadas es el de la sesión VIVA.
 *        Se mide si una escena conservada puede quedar apuntando a un lugar
 *        que ese mapa no nombra, y si alguien lo DICE.
 *
 *  Escrito por QA sobre `c4/el-anillo-bueno-no-se-pierde` (2026-09-14).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import {
  abrirSelectorDeMundos,
  comenzar,
  nuevaPartida,
  reanudar,
  recargarAlTitulo,
  regenerarMundo,
} from "../lib/sesion.mjs";

export const aisla = ["mundo", "fake-ai", "saves"];

const GAME = "alta_fantasia";

/** Llamadas cobradas por el fake en `/generate_scene`: la medida de «lo
 *  replayeó» frente a «lo volvió a pedir al motor». */
async function generaciones() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return c?.gasto?.rutas?.["/generate_scene"] ?? 0;
}

/** Lo que el jugador lee del mundo en el selector del título. */
async function panelDeGeneracion(ctx) {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME}"]`);
  const leido = await ctx.page.evaluate(
    (gameId) => ({
      tarjeta: document.querySelector(`[data-game-id="${gameId}"]`)?.textContent ?? "",
      estado: document.getElementById("ts-gen-state")?.textContent ?? "",
    }),
    GAME,
  );
  await ctx.page.click("#ts-back");
  return leido;
}

/** Rompe un tile del ANILLO como lo haría un validador que se endureció: un
 *  NPC nacido en celda no transitable (`nace-en-solido`, #289). Misma técnica
 *  que el guion 120 — el agua `w` es el sólido del alfabeto del expander. */
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

/** El centro de la huella de un volumen SÓLIDO: con lo que se rompe la
 *  ENTRADA (su NPC pasa a nacer dentro). */
function celdaSolidaDe(escena) {
  const solido = (escena.volumes ?? []).find(
    (v) =>
      Array.isArray(v.rect) &&
      v.rect.length === 4 &&
      (v.type === "prop" || (v.type === "building" && v.cutaway !== true)),
  );
  if (!solido) return null;
  const [c0, r0, w, d] = solido.rect;
  return { id: solido.id, celda: [Math.floor(c0 + w / 2), Math.floor(r0 + d / 2)] };
}

function romperLaEntrada(snap) {
  const entrada = snap.scenes[snap.entry_scene_id];
  const npc = (entrada.entities ?? []).find((e) => e.kind === "npc");
  const solido = celdaSolidaDe(entrada);
  if (!npc || !solido) return null;
  npc.cell = solido.celda;
  return { npc: npc.id, celda: solido.celda };
}

/** Pide el tile (tx,ty) por el cable, como el 120 y el 63. */
const pedirTile = (ctx, tx, ty) =>
  ctx.page.evaluate(
    ([x, y]) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "request_tile", tx: x, ty: y, reason: "blocking" }));
          setTimeout(() => {
            ws.close();
            res(true);
          }, 0);
        };
      }),
    [tx, ty],
  );

async function pedirYEsperar(ctx, key, tx, ty) {
  await pedirTile(ctx, tx, ty);
  await ctx.waitFor(
    `el tile ${key} llega al mundo del cliente`,
    (k) => window.__nefan.tiles.includes(k),
    90_000,
    key,
  );
}

const coordDe = (id) => id.replace("tile_", "").split("_").map(Number);

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) {
    ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay disco efímero cuyo tile.json editar");
  }
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const logBridge = join(tmp, "logs", "nefan-bridge.log");
  const leer = () => JSON.parse(readFileSync(tileJson, "utf8"));
  const escribir = (s) => writeFileSync(tileJson, JSON.stringify(s, null, 2) + "\n", "utf8");
  /** Cuántas líneas «se CRIBA» lleva el log del bridge: la criba se mide por
   *  lo que el bridge DICE, que es lo que tendría quien depura. */
  const cribas = () =>
    readFileSync(logBridge, "utf8").split("\n").filter((l) => l.includes("se CRIBA"));

  // ── El mundo de partida: 9 escenas pre-generadas de verdad ─────────────
  await regenerarMundo(ctx, GAME);
  if (!existsSync(tileJson)) ctx.sinMedir(`«Generar mundo» no dejó ${tileJson}`);
  const intacto = leer();
  const ids = Object.keys(intacto.scenes);
  const ENTRADA = intacto.entry_scene_id;
  const anillo = ids.filter((id) => id !== ENTRADA);
  ctx.expect("el mundo pre-generado tiene 9 escenas (entrada + anillo de 8)", ids.length === 9 && anillo.length === 8, JSON.stringify(ids));
  if (anillo.length !== 8) return;

  // ── E0 · NINGUNA mala: el control negativo, en el juego ─────────────────
  {
    const antesCribas = cribas().length;
    const antes = await generaciones();
    await recargarAlTitulo(ctx);
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras = await generaciones();
    ctx.expect("E0 · con el mundo SANO la partida arranca sin motor", tras === antes, `/generate_scene ${antes} → ${tras}`);
    ctx.expect(
      "E0 · …y el bridge no criba NADA (si cribara aquí, los verdes de abajo no dirían nada)",
      cribas().length === antesCribas,
      `${cribas().length - antesCribas} línea(s) «se CRIBA» con el mundo sano`,
    );
    const tiles = await ctx.nefan("tiles");
    ctx.expect("E0 · el cliente recibe la entrada", Array.isArray(tiles) && tiles.includes(ENTRADA), JSON.stringify(tiles));
  }

  // ── E1 · DOS del anillo malas ───────────────────────────────────────────
  const MALOS_2 = anillo.slice(0, 2);
  {
    const roto = JSON.parse(JSON.stringify(intacto));
    const npcs = MALOS_2.map((id) => romperElAnillo(roto.scenes[id], [10, 10]));
    escribir(roto);
    ctx.log(`E1 · rotos ${JSON.stringify(MALOS_2)} (${npcs.join(", ")})`);

    await recargarAlTitulo(ctx);
    const panel = await panelDeGeneracion(ctx);
    ctx.expect("E1 · con DOS del anillo malas el título sigue diciendo «✓ generado»", /✓ generado/.test(panel.estado), panel.estado);

    const antesCribas = cribas().length;
    const antes = await generaciones();
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras = await generaciones();
    ctx.expect("E1 · la partida arranca igual y sin motor", tras === antes, `/generate_scene ${antes} → ${tras}`);

    const nuevas = cribas().slice(antesCribas);
    // El SET de escenas cribadas es el discriminador: con una sola mala,
    // «criba la primera que falla» y «criba todas las que fallan» dan el
    // mismo verde. El recuento de LÍNEAS no sirve de aserto porque la puerta
    // de carga se atraviesa dos veces por partida (el chip del título la
    // llama por `gameGenerationStatus` y `start_session` otra vez), así que
    // sale el doble: 2 escenas × 2 cargas = 4. Eso se mide aparte, abajo.
    const cribadas = new Set(nuevas.flatMap((l) => anillo.filter((id) => l.includes(`"${id}"`))));
    ctx.expect(
      "E1 · se criban LAS DOS, no la primera que falla",
      MALOS_2.every((id) => cribadas.has(id)) && cribadas.size === 2,
      `cribadas: ${JSON.stringify([...cribadas])} (${nuevas.length} líneas)`,
    );
    ctx.expect(
      "E1 · …y el aviso sale UNA vez por escena y por carga del snapshot (2 escenas × 2 cargas = 4)",
      nuevas.length === 4,
      `${nuevas.length} línea(s) «se CRIBA» para 2 escenas malas — ver hallazgo H-4 si crece`,
    );
    const tilesCliente = await ctx.nefan("tiles");
    ctx.expect(
      "E1 · ninguno de los dos malos se le sirve al jugador",
      !MALOS_2.some((id) => (tilesCliente ?? []).includes(id)),
      JSON.stringify(tilesCliente),
    );

    // …y cada uno cuesta EXACTAMENTE una llamada cuando el jugador llega.
    let acumulado = tras;
    for (const id of MALOS_2) {
      const [tx, ty] = coordDe(id);
      await pedirYEsperar(ctx, id, tx, ty);
      const ahora = await generaciones();
      ctx.expect(`E1 · pedir ${id} cuesta exactamente una llamada`, ahora === acumulado + 1, `/generate_scene ${acumulado} → ${ahora}`);
      acumulado = ahora;
    }
    // Un vecino BUENO sigue sin costar nada.
    const bueno = anillo.find((id) => !MALOS_2.includes(id));
    const [btx, bty] = coordDe(bueno);
    await pedirYEsperar(ctx, bueno, btx, bty);
    const trasBueno = await generaciones();
    ctx.expect(`E1 · pedir el vecino sano ${bueno} sigue sin llamar al motor`, trasBueno === acumulado, `/generate_scene ${acumulado} → ${trasBueno}`);
  }

  // ── E2 · LAS OCHO del anillo malas ──────────────────────────────────────
  {
    const roto = JSON.parse(JSON.stringify(intacto));
    for (const id of anillo) romperElAnillo(roto.scenes[id], [10, 10]);
    escribir(roto);
    ctx.log(`E2 · rotas las OCHO del anillo; solo la entrada ${ENTRADA} queda servible`);

    await recargarAlTitulo(ctx);
    const panel = await panelDeGeneracion(ctx);
    ctx.log(`E2 · lo que lee el jugador en el título: «${panel.estado.trim()}»`);

    const antesCribas = cribas().length;
    const antes = await generaciones();
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras = await generaciones();
    ctx.expect("E2 · con las ocho malas la partida arranca igual y sin motor", tras === antes, `/generate_scene ${antes} → ${tras}`);
    const nuevas = cribas().slice(antesCribas);
    const cribadas = new Set(nuevas.flatMap((l) => anillo.filter((id) => l.includes(`"${id}"`))));
    ctx.expect(
      "E2 · se criban las OCHO, una por una y con su motivo",
      cribadas.size === 8,
      `cribadas: ${cribadas.size}/8 en ${nuevas.length} líneas`,
    );
    const tilesCliente = await ctx.nefan("tiles");
    ctx.expect("E2 · al jugador se le sirve solo la entrada", JSON.stringify(tilesCliente) === JSON.stringify([ENTRADA]), JSON.stringify(tilesCliente));
    await ctx.shot("e2-solo-la-entrada-sobrevive");
    // Lo que el jugador NO puede saber: que su mundo «✓ generado» va a costar
    // ocho llamadas al motor. El usuario eligió (b) y no (c) —el título NO
    // dice el motivo— así que esto se AFIRMA como está, no se juzga aquí.
    ctx.expect(
      "E2 · el título sigue diciendo «✓ generado» aunque solo quede 1 de 9 escenas (ver hallazgo H-2)",
      /✓ generado/.test(panel.estado),
      panel.estado,
    );
  }

  // ── E3 · la ENTRADA mala Y una del anillo mala (estado mixto) ───────────
  const MIXTO_MALO = anillo[0];
  {
    const roto = JSON.parse(JSON.stringify(intacto));
    romperElAnillo(roto.scenes[MIXTO_MALO], [10, 10]);
    const entradaRota = romperLaEntrada(roto);
    if (!entradaRota) ctx.sinMedir("la escena de entrada no se puede romper: sin NPC o sin volumen sólido");
    escribir(roto);
    ctx.log(`E3 · entrada rota (${entradaRota.npc} en [${entradaRota.celda}]) + ${MIXTO_MALO} roto`);

    await recargarAlTitulo(ctx);
    const panel = await panelDeGeneracion(ctx);
    ctx.expect("E3 · con la entrada mala el título lo marca obsoleto", /obsoleto/.test(panel.estado), panel.estado);

    const antes = await generaciones();
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras = await generaciones();
    ctx.expect("E3 · se degrada al bootstrap vivo: una sola llamada", tras === antes + 1, `/generate_scene ${antes} → ${tras}`);

    const curado = leer();
    ctx.expect("E3 · el anillo NO se pierde: siguen las 9 escenas", Object.keys(curado.scenes).length === 9, JSON.stringify(Object.keys(curado.scenes)));
    // La mala del anillo se CONSERVA tal cual: `escenasQueSobreviven` no
    // filtra por jugabilidad. O sea, el fichero queda con una escena que la
    // carga siguiente volverá a cribar.
    const sigueRota = JSON.stringify(curado.scenes[MIXTO_MALO]) === JSON.stringify(roto.scenes[MIXTO_MALO]);
    ctx.expect(
      `E3 · el tile malo del anillo se conserva ROTO en disco (${MIXTO_MALO}): el fichero no se cura del todo`,
      sigueRota,
      sigueRota ? "idéntico al que se escribió roto" : "cambió",
    );

    // Y la partida SIGUIENTE lo vuelve a cribar: el coste no era de una vez.
    const antesCribas = cribas().length;
    const antes2 = await generaciones();
    await recargarAlTitulo(ctx);
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const tras2 = await generaciones();
    ctx.expect("E3 · la partida siguiente ya arranca sin motor (la entrada se curó)", tras2 === antes2, `/generate_scene ${antes2} → ${tras2}`);
    ctx.expect(
      `E3 · …pero ${MIXTO_MALO} se vuelve a cribar en CADA carga`,
      cribas().slice(antesCribas).some((l) => l.includes(`"${MIXTO_MALO}"`)),
      JSON.stringify(cribas().slice(antesCribas)),
    );
  }

  // ── E4 · lo que paga el jugador la 1.ª, 2.ª y 3.ª vez ───────────────────
  {
    const roto = JSON.parse(JSON.stringify(intacto));
    romperElAnillo(roto.scenes[MIXTO_MALO], [10, 10]);
    escribir(roto);
    const [tx, ty] = coordDe(MIXTO_MALO);
    const coste = [];
    let sesion = null;
    for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
      await recargarAlTitulo(ctx);
      await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
      const arrancada = await comenzar(ctx);
      if (vuelta === 1) sesion = arrancada.sessionId;
      const antes = await generaciones();
      await pedirYEsperar(ctx, MIXTO_MALO, tx, ty);
      coste.push((await generaciones()) - antes);
    }
    ctx.log(`E4 · llegar a ${MIXTO_MALO} cuesta, partida tras partida: ${JSON.stringify(coste)} llamadas`);
    ctx.expect(
      "E4 · el tile cribado NO se cura en disco: cuesta una llamada al motor en CADA partida nueva (declarado sin medir por el ingeniero)",
      coste.every((c) => c === 1),
      JSON.stringify(coste),
    );
    ctx.expect(
      "E4 · el fichero sigue teniendo el tile roto tras las tres partidas",
      JSON.stringify(leer().scenes[MIXTO_MALO]) === JSON.stringify(roto.scenes[MIXTO_MALO]),
      "el snapshot nunca se reescribe fuera del bootstrap y de «Generar mundo»",
    );

    // REANUDAR sí lo tiene: el tile regenerado vive en el save de la partida.
    if (sesion) {
      const antes = await generaciones();
      const vuelto = await reanudar(ctx, sesion);
      if (vuelto) {
        await pedirYEsperar(ctx, MIXTO_MALO, tx, ty);
        const tras = await generaciones();
        ctx.expect(
          "E4 · REANUDAR una partida que ya lo generó no vuelve a pagarlo (el save sí lo guarda)",
          tras === antes,
          `/generate_scene ${antes} → ${tras}`,
        );
      }
    }
  }

  // ── E5 · el world_map del merge ─────────────────────────────────────────
  {
    // (a) Sin tocar nada: ¿el mapa que escribe el bootstrap vivo conserva los
    //     lugares del mundo pre-generado? Con el motor FALSO es determinista;
    //     con un motor real, el bootstrap siembra lugares nuevos.
    const roto = JSON.parse(JSON.stringify(intacto));
    const entradaRota = romperLaEntrada(roto);
    if (!entradaRota) ctx.sinMedirBloque("no se puede romper la entrada para el bloque E5");
    else {
      escribir(roto);
      await recargarAlTitulo(ctx);
      await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
      await comenzar(ctx);
      const curado = leer();
      const antesPlaces = Object.keys(intacto.world_map?.places ?? {}).sort();
      const despuesPlaces = Object.keys(curado.world_map?.places ?? {}).sort();
      ctx.log(`E5 · lugares antes ${JSON.stringify(antesPlaces)} · después ${JSON.stringify(despuesPlaces)}`);
      ctx.expect(
        "E5 · el mapa escrito con las 8 conservadas es el de la sesión VIVA (con el motor falso coincide; con uno real no tiene por qué)",
        JSON.stringify(antesPlaces) === JSON.stringify(despuesPlaces),
        `${antesPlaces.length} → ${despuesPlaces.length}`,
      );
    }

    // (b) La consecuencia, fabricada: un anillo cuyos tiles apuntan a un lugar
    //     que el mapa nuevo no nombra — que es lo que produce cualquier
    //     bootstrap que siembre ids distintos. Se mide si el snapshot
    //     resultante queda con referencias colgando y si alguien LO DICE.
    const fantasma = JSON.parse(JSON.stringify(intacto));
    for (const id of anillo) fantasma.scenes[id].place_id = "lugar_que_ya_no_existe";
    romperLaEntrada(fantasma);
    escribir(fantasma);
    const antesLog = readFileSync(logBridge, "utf8").length;
    await recargarAlTitulo(ctx);
    await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
    await comenzar(ctx);
    const curado = leer();
    const lugares = new Set(Object.keys(curado.world_map?.places ?? {}));
    const colgando = Object.entries(curado.scenes)
      .filter(([, s]) => typeof s.place_id === "string" && s.place_id && !lugares.has(s.place_id))
      .map(([id]) => id);
    ctx.log(`E5 · escenas conservadas cuyo place_id no está en el mapa escrito: ${JSON.stringify(colgando)}`);
    // El tile de ENTRADA sí viaja: el defecto está acotado a lo CONSERVADO,
    // que es lo que lo hace difícil de ver desde el tile de arranque.
    const salidasDeLaEntrada = await ctx.nefan("exits");
    ctx.log(`E5 · salidas desde la entrada recién generada: ${JSON.stringify((salidasDeLaEntrada ?? []).map((e) => e.place_id))}`);
    const dicho = readFileSync(logBridge, "utf8")
      .slice(antesLog)
      .split("\n")
      .filter((l) => l.includes("lugar_que_ya_no_existe"));
    ctx.expect(
      "E5 · una escena conservada que apunta a un lugar que el mapa no nombra se DICE (fail-loud), no se guarda en silencio",
      colgando.length === 0 || dicho.length > 0,
      colgando.length === 0
        ? "no quedó ninguna colgando"
        : `${colgando.length} escena(s) colgando y 0 líneas en el log del bridge: ${JSON.stringify(colgando)}`,
    );
  }
}
