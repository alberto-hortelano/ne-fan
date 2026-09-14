/** Un snapshot de 9 escenas con UNA injugable ya no se tira entero (#451).
 *
 *  `test/world-snapshot.test.ts` canda las dos puertas con artefactos
 *  sintéticos; esto recorre el flujo del jugador con el disco efímero del
 *  runner y el motor falso (0 créditos): el mundo de 9 escenas lo pre-genera
 *  «Generar mundo» de verdad, se rompe UNA escena A MANO —que es la única
 *  forma de fabricar «generado bajo un validador anterior» sin un checkout
 *  viejo— y se mira lo que le pasa al mundo del jugador.
 *
 *  Los dos casos, que NO son el mismo y por eso están los dos:
 *
 *   A · la injugable es del ANILLO. La partida arranca igual y sin motor
 *     (replay de las 8 buenas), el bridge dice por qué CRIBA la mala, y solo
 *     ella se vuelve a pedir: pedir una buena no cuesta una llamada al motor
 *     y pedir la mala cuesta exactamente una. El fichero no se reescribe al
 *     cargar: sigue teniendo sus 9 escenas.
 *
 *   B · la injugable es la de ENTRADA. Se degrada al bootstrap vivo COMO
 *     HOY (decisión (i) del coordinador: aquí no se abre ningún camino nuevo
 *     de regeneración parcial), y lo ÚNICO que cambia es lo que dice el
 *     título del issue: el snapshot ya no se queda en UNA escena. La entrada
 *     se cura y las ocho buenas siguen ahí, idénticas.
 *
 *  El B es el que medía el bug: antes de #451, `writeSessionSnapshot`
 *  reescribía el fichero con lo que hubiera en `scenes_loaded` —una escena— y
 *  el mundo pre-generado entero moría por un tile malo.
 *
 *  PROBADO EN NEGATIVO (2026-09-14, un sabotaje por vez y restaurado con
 *  `tsc` limpio detrás), y cada uno pone rojo SOLO su caso:
 *   · `bootstrap-tile.ts` pasando `"reemplaza-el-mundo"` → rojos los dos
 *     asertos 6 con el síntoma histórico del issue a la vista
 *     (`["tile_0_0"]`: el mundo reducido a una escena, y las ocho «cambiaron»)
 *     y el caso A entero en verde.
 *   · la criba anulada (que un tile del anillo vuelva a lanzar, como antes de
 *     #451) → rojos los tres asertos 2 y el primero del 3 («/generate_scene
 *     9 → 10»: el snapshot bueno degradó al motor, y el título volvió a decir
 *     «⟳ obsoleto») con el caso B en verde, porque ahí quien salva el anillo
 *     es la política de escritura y no la criba.
 *
 *  El disco lo localiza `QA_RUN_TMP` (lo pone el runner cuando arranca él el
 *  stack); contra un stack ajeno (`--url`) no hay tile que editar y se declara
 *  `sinMedir`. Ninguna espera es de reloj: el snapshot pasivo se escribe ANTES
 *  de difundir la escena (`bootstrap-tile.ts`), así que cuando `comenzar`
 *  vuelve el fichero ya está.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import {
  abrirSelectorDeMundos,
  comenzar,
  nuevaPartida,
  recargarAlTitulo,
  regenerarMundo,
} from "../lib/sesion.mjs";

/** Empieza sin mundo pre-generado y con el fake a cero: el control del paso 1
 *  («9 escenas recién generadas») tiene que partir del estado que dice. */
export const aisla = ["mundo", "fake-ai"];

const GAME = "alta_fantasia";
/** El vecino que se rompe y el que queda sano: los dos del anillo 3×3. */
const MALO = "tile_1_0";
const BUENO = "tile_0_1";

/** Cuántas veces ha cobrado el fake por `/generate_scene` (la ruta que en el
 *  motor real llama al LLM). Es la medida de «replayeó» frente a «lo pidió». */
async function generacionesServidas() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return c?.gasto?.rutas?.["/generate_scene"] ?? 0;
}

/** Abre el selector, elige el mundo, devuelve lo que el jugador lee y VUELVE
 *  al inicio del título (`nuevaPartida` espera el botón «Nueva partida», que
 *  con el selector abierto no está). Mismo helper que el guion 72. */
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

/** El centro de la huella de un volumen SÓLIDO de la escena: un prop, o un
 *  building sin cutaway. Se lee del `rect`, no se elige una celda a ojo. */
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

/** Rompe un tile del ANILLO como lo haría un validador que se endureció: un
 *  NPC nacido en celda no transitable (`nace-en-solido`, #289).
 *
 *  El tile del anillo del motor falso no trae volúmenes, así que la celda
 *  sólida se FABRICA en su propio grid —el agua `w` es el sólido del alfabeto
 *  cerrado del expander— y el NPC se clona de una entity que ya está en la
 *  escena, para no inventarse una forma que el zod de la puerta no acepte. */
function romperElAnillo(escena, celda) {
  const [col, row] = celda;
  const fila = escena.terrain[row];
  escena.terrain[row] = fila.slice(0, col) + "w" + fila.slice(col + 1);
  const molde = escena.entities.find((e) => e.kind === "prop") ?? escena.entities[0];
  const npc = JSON.parse(JSON.stringify(molde));
  npc.id = "vecino_ahogado";
  npc.kind = "npc";
  npc.name = "Vecino del vado";
  npc.cell = [col, row];
  escena.entities.push(npc);
  return npc.id;
}

/** Pide el tile (tx,ty) por el cable del juego desde un segundo socket de la
 *  página, como el guion 63: es la petición que hace el jugador al llegar al
 *  borde, sin tener que caminar hasta él. */
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

/** Pide el tile y espera a que el cliente lo TENGA: el contador del fake solo
 *  significa algo cuando la petición terminó. */
async function pedirYEsperar(ctx, key, tx, ty) {
  await pedirTile(ctx, tx, ty);
  await ctx.waitFor(`el tile ${key} llega al mundo del cliente`, (k) => window.__nefan.tiles.includes(k), 90_000, key);
}

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) {
    ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay disco efímero cuyo tile.json editar");
  }
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const logBridge = join(tmp, "logs", "nefan-bridge.log");
  const leerSnapshot = () => JSON.parse(readFileSync(tileJson, "utf8"));
  const escribirSnapshot = (s) => writeFileSync(tileJson, JSON.stringify(s, null, 2) + "\n", "utf8");

  // ── 1 · un mundo pre-generado de verdad, con sus 9 escenas ─────────────
  await regenerarMundo(ctx, GAME);
  ctx.expect("1. «Generar mundo» deja el snapshot en el disco efímero", existsSync(tileJson), tileJson);
  if (!existsSync(tileJson)) return;
  const intacto = leerSnapshot();
  const ids = Object.keys(intacto.scenes);
  ctx.expect("1. el mundo pre-generado tiene 9 escenas (entrada + anillo)", ids.length === 9, JSON.stringify(ids));
  if (!intacto.scenes[MALO] || !intacto.scenes[BUENO]) {
    ctx.sinMedir(`el anillo pre-generado no trae ${MALO} y ${BUENO}: ${JSON.stringify(ids)}`);
  }

  // ── 2 · CASO A · la injugable es del anillo ────────────────────────────
  const conAnilloRoto = leerSnapshot();
  const npcRoto = romperElAnillo(conAnilloRoto.scenes[MALO], [10, 10]);
  escribirSnapshot(conAnilloRoto);
  ctx.log(`${MALO} roto: «${npcRoto}» nace en [10, 10], celda de agua fabricada en su grid`);

  await recargarAlTitulo(ctx);
  const conAnillo = await panelDeGeneracion(ctx);
  ctx.expect(
    "2. un tile del anillo malo NO deja el mundo obsoleto: el título sigue diciendo «✓ generado»",
    /✓ generado/.test(conAnillo.estado),
    conAnillo.estado,
  );

  const antesDeA = await generacionesServidas();
  await nuevaPartida(ctx, { gameId: GAME });
  await comenzar(ctx);
  const trasA = await generacionesServidas();
  ctx.expect(
    "2. la partida arranca IGUAL y sin motor: se sirven la entrada y las buenas",
    trasA === antesDeA,
    `/generate_scene ${antesDeA} → ${trasA}`,
  );
  await ctx.shot("partida-con-el-anillo-cribado");

  const criba = readFileSync(logBridge, "utf8")
    .split("\n")
    .find((l) => l.includes("se CRIBA"));
  ctx.expect(
    "2. el bridge dice POR QUÉ criba: la escena y el NPC, no un silencio",
    Boolean(criba) && criba.includes(`"${MALO}"`) && criba.includes(`"${npcRoto}"`),
    criba || "(sin línea «se CRIBA» en nefan-bridge.log)",
  );

  // …y solo se vuelve a pedir el malo: el bueno viene de la sesión (0
  // llamadas), el cribado cuesta exactamente una.
  await pedirYEsperar(ctx, BUENO, 0, 1);
  const trasBueno = await generacionesServidas();
  ctx.expect(
    "3. pedir un vecino BUENO no llama al motor: estaba servido",
    trasBueno === trasA,
    `/generate_scene ${trasA} → ${trasBueno}`,
  );
  await pedirYEsperar(ctx, MALO, 1, 0);
  const trasMalo = await generacionesServidas();
  ctx.expect(
    "3. …y el cribado se vuelve a pedir: exactamente una llamada, la suya",
    trasMalo === trasBueno + 1,
    `/generate_scene ${trasBueno} → ${trasMalo}`,
  );

  const trasCargar = leerSnapshot();
  ctx.expect(
    "4. cargar no reescribe el fichero: sigue con sus 9 escenas (la criba es de lo que se SIRVE)",
    Object.keys(trasCargar.scenes).length === 9,
    JSON.stringify(Object.keys(trasCargar.scenes)),
  );

  // ── 5 · CASO B · la injugable es la de ENTRADA ─────────────────────────
  const conEntradaRota = JSON.parse(JSON.stringify(intacto));
  const entrada = conEntradaRota.scenes[conEntradaRota.entry_scene_id];
  const npcEntrada = (entrada.entities ?? []).find((e) => e.kind === "npc");
  const solido = celdaSolidaDe(entrada);
  if (!npcEntrada || !solido) {
    ctx.sinMedir(
      `la escena de entrada no trae ${!npcEntrada ? "ningún NPC" : "ningún volumen sólido con rect"}: no hay con qué romperla`,
    );
  }
  npcEntrada.cell = solido.celda;
  escribirSnapshot(conEntradaRota);
  ctx.log(`entrada rota: ${npcEntrada.id} movido a [${solido.celda}] (huella de «${solido.id}»)`);

  await recargarAlTitulo(ctx);
  const conEntrada = await panelDeGeneracion(ctx);
  ctx.expect(
    "5. con la ENTRADA injugable el título sí lo marca obsoleto",
    conEntrada.estado.includes("obsoleto (regenera el mundo)"),
    conEntrada.estado,
  );

  const antesDeB = await generacionesServidas();
  await nuevaPartida(ctx, { gameId: GAME });
  await comenzar(ctx);
  const trasB = await generacionesServidas();
  ctx.expect(
    "5. …y se degrada al bootstrap vivo COMO HOY: una llamada al motor, la de la entrada",
    trasB === antesDeB + 1,
    `/generate_scene ${antesDeB} → ${trasB}`,
  );

  const curado = leerSnapshot();
  const idsCurados = Object.keys(curado.scenes);
  ctx.expect(
    "6. EL ANILLO BUENO NO SE PIERDE: el snapshot sigue con 9 escenas, no con 1",
    idsCurados.length === 9,
    JSON.stringify(idsCurados),
  );
  const npcCurado = curado.scenes[curado.entry_scene_id]?.entities?.find((e) => e.id === npcEntrada.id);
  ctx.expect(
    "6. la entrada es la RECIÉN generada: su NPC ya no nace en la celda sólida",
    Boolean(npcCurado) && (npcCurado.cell[0] !== solido.celda[0] || npcCurado.cell[1] !== solido.celda[1]),
    JSON.stringify(npcCurado?.cell ?? null),
  );
  const anillo = ids.filter((id) => id !== intacto.entry_scene_id);
  const cambiados = anillo.filter(
    (id) => JSON.stringify(curado.scenes[id]) !== JSON.stringify(intacto.scenes[id]),
  );
  ctx.expect(
    "6. …y las ocho buenas son EXACTAMENTE las de antes, no versiones nuevas",
    cambiados.length === 0,
    cambiados.length ? `cambiaron: ${JSON.stringify(cambiados)}` : "las ocho intactas",
  );
}
