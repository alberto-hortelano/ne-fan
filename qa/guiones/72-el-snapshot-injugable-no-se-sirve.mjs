/** Un snapshot de mundo INJUGABLE no se sirve (#302), medido desde el título.
 *
 *  `test/world-snapshot.test.ts` canda la puerta con un artefacto sintético;
 *  esto recorre el flujo del jugador con el disco efímero del runner y el motor
 *  falso (0 créditos): el snapshot lo escribe el bootstrap de verdad, se rompe
 *  A MANO —un NPC a la huella de un volumen, que es la única forma de fabricar
 *  «generado bajo un validador anterior» sin un checkout viejo— y se mira lo
 *  que ve quien juega: el chip, el panel, el botón y lo que hace «Comenzar».
 *
 *  Lo que afirma, en el orden en que se rompería:
 *   1. El primer arranque llama al motor y deja `world/tile.json` (control).
 *   2. Con el snapshot SANO el título dice «✓ generado» y el segundo arranque
 *      lo REPLAYEA: el contador de `/generate_scene` del fake no se mueve.
 *      Sin este control, el paso 5 no distinguiría «degradó» de «nunca replayea».
 *   3. Con el NPC en celda sólida: `list_games` lo marca `stale` — chip
 *      «Mundo ⟳», panel «la entrada se regenerará al empezar» (#578), «Aplicar estilo»
 *      deshabilitado.
 *   4. «Comenzar» NO lo sirve: regenera SOLO la entrada dentro del mapa del
 *      fichero (#578; una llamada más al motor), el bridge lo dice nombrando «injugable», la escena y el NPC —sin
 *      traza de pila detrás, que es una condición esperable (QA 2026-09-05)— y
 *      el snapshot reescrito ya no tiene al NPC en la celda sólida.
 *
 *  Negativo (una vez, a mano, 2026-09-05): con el bucle de `validateScene` de
 *  `src/games/world-snapshot.ts` comentado caen los 3 asertos del paso 3 (el
 *  título sigue en «✓ generado», «Aplicar estilo» habilitado) y los 4 del paso
 *  4 (`/generate_scene 1 → 1`: el snapshot roto SE SIRVIÓ); los dos controles
 *  del 1 y el 2 siguen verdes, como deben.
 *
 *  El disco lo localiza `QA_RUN_TMP` (lo pone el runner cuando arranca él el
 *  stack); contra un stack ajeno (`--url`) no hay tile que editar y se declara
 *  `sinMedir`. Ninguna espera es de reloj: el snapshot pasivo se escribe ANTES
 *  de difundir la escena (`bootstrap-tile.ts`), así que cuando `comenzar` vuelve
 *  el fichero ya está.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { URLS } from "../lib/stack.mjs";
import { abrirSelectorDeMundos, comenzar, nuevaPartida, recargarAlTitulo } from "../lib/sesion.mjs";

/** Empieza sin snapshot y con el fake a cero: el paso 1 es un control y tiene
 *  que partir del estado que dice. */
export const aisla = ["mundo", "fake-ai"];

const GAME = "alta_fantasia";

/** Cuántas veces ha cobrado el fake por `/generate_scene` (la ruta que en el
 *  motor real llama al LLM). Es la medida de «replayeó» frente a «degradó». */
async function generacionesServidas() {
  const r = await fetch(`${URLS.fake_ai}/dev/counters`);
  if (!r.ok) throw new Error(`/dev/counters HTTP ${r.status}`);
  const c = await r.json();
  return c?.gasto?.rutas?.["/generate_scene"] ?? 0;
}

/** Abre el selector, elige el mundo, devuelve lo que el jugador lee y VUELVE
 *  al inicio del título: `nuevaPartida` espera el botón «Nueva partida», que
 *  con el selector abierto no está. */
async function panelDeGeneracion(ctx) {
  await abrirSelectorDeMundos(ctx);
  await ctx.page.click(`[data-game-id="${GAME}"]`);
  const leido = await ctx.page.evaluate(
    (gameId) => ({
      tarjeta: document.querySelector(`[data-game-id="${gameId}"]`)?.textContent ?? "",
      estado: document.getElementById("ts-gen-state")?.textContent ?? "",
      aplicarDeshabilitado: document.getElementById("ts-apply-style")?.disabled ?? null,
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
    (v) => Array.isArray(v.rect) && v.rect.length === 4 && (v.type === "prop" || (v.type === "building" && v.cutaway !== true)),
  );
  if (!solido) return null;
  const [c0, r0, w, d] = solido.rect;
  return { id: solido.id, celda: [Math.floor(c0 + w / 2), Math.floor(r0 + d / 2)] };
}

/** En qué LÍNEAS del log del bridge está el rechazo en la carga. Devuelve
 *  índices y no texto porque el aserto de la traza mira la línea siguiente.
 *
 *  El log es de la CORRIDA, no de este guion (#653): lo escriben todos los que
 *  compartan stack, y este mensaje lo provocan además el 120 y el 127 —los tres
 *  dejan la ENTRADA injugable—, así que se mide por MARCA DE AGUA, como el 127
 *  y el 90/129/130. */
const RECHAZO = "world snapshot rechazado en la carga";
const rechazos = (lineas) => lineas.flatMap((l, n) => (l.includes(RECHAZO) ? [n] : []));

export default async function (ctx) {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) {
    ctx.sinMedir("sin QA_RUN_TMP: el stack no lo arrancó este runner y no hay disco efímero cuyo tile.json editar");
  }
  const tileJson = join(tmp, "games", GAME, "world", "tile.json");
  const logBridge = join(tmp, "logs", "nefan-bridge.log");

  // ── 1 · el bootstrap vivo deja el snapshot ─────────────────────────────
  const antes = await generacionesServidas();
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
  await comenzar(ctx);
  const tras1 = await generacionesServidas();
  ctx.expect("1. el primer arranque llama al motor (bootstrap vivo)", tras1 === antes + 1, `/generate_scene ${antes} → ${tras1}`);
  ctx.expect("1. …y deja el snapshot pasivo en el disco efímero", existsSync(tileJson), tileJson);
  if (!existsSync(tileJson)) return;

  // ── 2 · sano: «✓ generado» y replay sin motor ──────────────────────────
  await recargarAlTitulo(ctx);
  const sano = await panelDeGeneracion(ctx);
  ctx.expect("2. con el snapshot sano el título dice «✓ generado»", /✓ generado/.test(sano.estado), sano.estado);
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
  await comenzar(ctx);
  const tras2 = await generacionesServidas();
  ctx.expect("2. el segundo arranque REPLAYEA: el motor no recibe ninguna llamada", tras2 === tras1, `/generate_scene ${tras1} → ${tras2}`);

  // ── 3 · romper: un NPC a la huella de un volumen ───────────────────────
  const snap = JSON.parse(readFileSync(tileJson, "utf8"));
  const entrada = snap.scenes[snap.entry_scene_id];
  const npc = (entrada.entities ?? []).find((e) => e.kind === "npc");
  const solido = celdaSolidaDe(entrada);
  if (!npc || !solido) {
    ctx.sinMedir(`la escena de entrada del fake no trae ${!npc ? "ningún NPC" : "ningún volumen sólido con rect"}: no hay con qué fabricar el tile injugable`);
  }
  npc.cell = solido.celda;
  writeFileSync(tileJson, JSON.stringify(snap, null, 2) + "\n", "utf8");
  ctx.log(`${npc.id} movido a [${solido.celda}] (huella de «${solido.id}») en ${snap.entry_scene_id}`);
  // LA MARCA, antes de tocar nada: a partir de aquí, todo rechazo en la carga
  // lo ha causado este guion (#653). Se DICE cuántos había, porque ese número
  // es la medida del defecto: con uno solo, la versión de antes —que cogía el
  // PRIMERO del fichero— ya estaba afirmando sobre la partida de otro guion.
  const previos = rechazos(readFileSync(logBridge, "utf8").split("\n"));
  const rechazosAntes = previos.length;
  ctx.log(
    `marca: ${rechazosAntes} «${RECHAZO}» en el log de la corrida antes de que este guion lo provoque` +
      (rechazosAntes ? " — todos ajenos, y el `findIndex` de antes se habría quedado con el primero" : ""),
  );

  await recargarAlTitulo(ctx);
  const roto = await panelDeGeneracion(ctx);
  ctx.expect("3. list_games lo marca stale: chip «Mundo ⟳» en la tarjeta", /Mundo\s*⟳/.test(roto.tarjeta), roto.tarjeta.slice(0, 120));
  ctx.expect(
    "3. el panel dice que Comenzar regenera la entrada con una llamada (#578), no que haya que regenerar el mundo",
    roto.estado.includes("la entrada se regenerará al empezar (1 llamada al motor)") && !roto.estado.includes("regenera el mundo"),
    roto.estado,
  );
  ctx.expect("3. «Aplicar estilo» está deshabilitado", roto.aplicarDeshabilitado === true, String(roto.aplicarDeshabilitado));
  await ctx.shot("titulo-stale-injugable");

  // ── 4 · «Comenzar» no lo sirve ─────────────────────────────────────────
  await nuevaPartida(ctx, { gameId: GAME, renderMode: "image" });
  await comenzar(ctx);
  const tras3 = await generacionesServidas();
  ctx.expect("4. Comenzar NO sirve el snapshot: regenera la entrada (una llamada más al motor)", tras3 === tras2 + 1, `/generate_scene ${tras2} → ${tras3}`);

  // El primer rechazo DESDE LA MARCA, que es el que provocó este guion. La
  // selección no puede ser por la escena ni por el NPC: son justo lo que el
  // aserto afirma de la línea, y seleccionar por ellos lo dejaría tautológico.
  const lineas = readFileSync(logBridge, "utf8").split("\n");
  const nuevos = rechazos(lineas).slice(rechazosAntes);
  const i = nuevos.length ? nuevos[0] : -1;
  const linea = i >= 0 ? lineas[i] : "";
  ctx.expect(
    "4. el bridge lo dice: «injugable», la escena y el NPC",
    linea.includes("injugable") && linea.includes(`"${snap.entry_scene_id}"`) && linea.includes(`"${npc.id}"`),
    linea ||
      `(ningún «${RECHAZO}» nuevo desde la marca: ${rechazosAntes} antes, ${rechazos(lineas).length} ahora)`,
  );
  ctx.expect(
    "4. …y sin traza de pila detrás",
    i >= 0 && !/^\s+at /.test(lineas[i + 1] ?? ""),
    i >= 0 ? (lineas[i + 1] ?? "(fin del log)") : "(sin línea que mirar)",
  );

  const reescrito = JSON.parse(readFileSync(tileJson, "utf8"));
  const npcNuevo = reescrito.scenes[reescrito.entry_scene_id]?.entities?.find((e) => e.id === npc.id);
  ctx.expect(
    "4. la entrada regenerada reescribe el snapshot: el NPC ya no nace en la celda sólida",
    Boolean(npcNuevo) && (npcNuevo.cell[0] !== solido.celda[0] || npcNuevo.cell[1] !== solido.celda[1]),
    JSON.stringify(npcNuevo?.cell ?? null),
  );
}
