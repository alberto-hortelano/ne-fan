/** UNA POSICIÓN VIVA QUE NO CAE EN NINGÚN TILE DEL SAVE SE DICE (#382).
 *
 *  Desde #351 la posición que sale al cable para cada NPC es la VIVA del
 *  ledger (`entities[].position`), y el único candado del cliente mide la
 *  DECLARADA (la conversión celda→metro, guion 55). Así que un save cuya
 *  posición viva del tabernero apunte a `(168,25, 0, 168,25)` —un sitio donde
 *  no hay tile— lo ponía ahí sin una sola línea: el jugador no encontraba al
 *  tabernero y el panel decía «— sin errores —». La escena cargaba igual.
 *
 *  LA VARA, y por qué no es «su rect»: la posición viva se contrasta con la
 *  UNIÓN de los rects de TODOS los tiles de `scenes_loaded` (que nunca se poda),
 *  calculada por el BRIDGE al servir el resume (`sessionDataForClient`) y dicha
 *  por `narrative_status: error, kind: "restore"`, el mismo canal por el que se
 *  dice un combatiente ilegible. Un NPC que se fue andando al tile de al lado
 *  (el enemigo que persigue, el ambiental que da una vuelta) está en un sitio
 *  donde HAY mundo y no enciende nada: ese es el negativo de abajo, y es lo que
 *  hace que la vara no dependa de #377 ni toque `src/combat/`.
 *
 *  Dos bloques sobre la misma partida, con el save EDITADO A MANO porque
 *  nada del juego escribe esa coordenada (es integridad del save, no mecánica
 *  de NPC):
 *
 *   1 · POSITIVO: `entities[barkeep].position` → `[168.25, 0, 168.25]` (cae en
 *       `tile_3_3`, fuera de toda unión en una partida de dos tiles; la `cell`
 *       declarada se deja intacta para que el guion 55 no sea quien salte) →
 *       Reanudar → el panel del jugador NOMBRA al tabernero y la coordenada,
 *       y la escena carga (no bloquea).
 *   2 · NEGATIVO: antes de romper nada se pide el tile (1,0) por el cable
 *       (`request_tile`, patrón del 60) para que el save tenga DOS tiles; la
 *       posición viva del tabernero se mueve a `(66, 0, 7)`, DENTRO del rect
 *       de `tile_1_0` → Reanudar → ninguna línea de «donde no hay mundo».
 *
 *  El 55 no se toca: su filo es la declarada. Este mide la viva, y los dos
 *  juntos candan que nadie «unifique» los checkers aflojando el de conversión.
 *
 *  Cero créditos: preset `e2e-sin-creditos`; el tabernero lo declara el tile
 *  de bootstrap de `labs/narrative/fake-scenes.ts`.
 *
 *  Nació ROJO sobre `6d3d7ac` (medido el 2026-09-02): el bloque 1 expira con
 *  el panel en `["— sin errores —"]` —`✘ #382 · el panel del jugador DICE que
 *  la partida pone a Tabernero corpulento donde no hay mundo — no ocurrió en
 *  60000 ms · 395 sondeo(s)`— con la escena cargada (`✔ la escena carga
 *  igual`) y el tabernero en (168,25, 168,25) sin que nadie lo diga; los dos
 *  asertos de la coordenada y del ruido caen con él. El bloque 2 sale verde
 *  en la base porque no hay checker que pueda encenderse, que es justo lo que
 *  lo hace necesario una vez existe.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { nuevaPartida, comenzar, reanudar } from "../lib/sesion.mjs";
import { esperarEnElSave, rutaDelSave } from "../lib/saves.mjs";

/** El motor falso es determinista POR TURNO de diálogo: saves vírgenes. */
export const aisla = ["saves", "fake-ai"];

const GAME_ID = "alta_fantasia";
/** El tabernero: NPC de ESCENA del tile de bootstrap, con record en el ledger
 *  desde la primera difusión (`registerSceneNpcs`). */
const NPC = "barkeep";
/** Fuera de todo tile de una partida de dos: cae en `tile_3_3` (rect 160..224). */
const FUERA_DEL_MUNDO = [168.25, 0, 168.25];
/** Dentro del rect de `tile_1_0` (x 32..96, z −32..32): el NPC que se fue al
 *  tile vecino, que es donde HAY mundo. */
const EN_EL_TILE_VECINO = [66, 0, 7];
const FRASE = "donde no hay mundo";

/** Las entradas del panel de errores, tal cual las lee quien juega. */
const panelDeErrores = (ctx) =>
  ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("#error-log > div")).map((n) =>
      (n.textContent ?? "").replace(/\s+/g, " ").trim(),
    ),
  );

/** Mueve la posición VIVA del tabernero en el save de disco. Devuelve
 *  `{ nombre, antes }` o `null` si el ledger no lo tiene. */
function moverEnElLedger(ruta, posicion) {
  const save = JSON.parse(readFileSync(ruta, "utf-8"));
  const ent = (save.entities ?? []).find((e) => e.id === NPC);
  if (!ent) return null;
  const antes = [...ent.position];
  ent.position = [...posicion];
  writeFileSync(ruta, JSON.stringify(save, null, 2));
  const nombre = typeof ent.data?.name === "string" && ent.data.name ? ent.data.name : ent.id;
  return { nombre, antes, tiles: Object.keys(save.scenes_loaded ?? {}) };
}

/** Pide el tile (tx,ty) por el cable del juego desde un segundo socket de la
 *  página (la URL la da el propio juego, como en `saves.mjs`). */
const pedirTile = (ctx, tx, ty) =>
  ctx.page.evaluate(
    ([x, y]) =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "request_tile", tx: x, ty: y, reason: "prefetch" }));
          setTimeout(() => {
            ws.close();
            res(true);
          }, 0);
        };
      }),
    [tx, ty],
  );

export default async function (ctx) {
  await nuevaPartida(ctx, { gameId: GAME_ID, charMode: "vector" });
  const partida = await comenzar(ctx);
  await ctx.waitFor(
    "el tabernero de la escena está en el mundo",
    (id) => window.__nefan.npcs().find((n) => n.id === id) ?? null,
    60_000,
    NPC,
  );

  // Control ANTES de romper nada: con la partida sana el panel no habla de
  // mundo que falte. Sin esto, un panel que gritara por cualquier cosa haría
  // verde el aserto del bloque 1 sin que el checker hubiera medido nada.
  const limpio = await panelDeErrores(ctx);
  ctx.log(`panel con la partida sana: ${JSON.stringify(limpio)}`);
  ctx.expect(
    "precondición: con la partida sana nadie está «donde no hay mundo»",
    limpio.every((t) => !t.includes(FRASE)),
    JSON.stringify(limpio.filter((t) => t.includes(FRASE))),
  );

  // Dos tiles en el save ANTES de tocar nada: el negativo necesita un tile
  // vecino donde HAYA mundo, y la unión de rects sale del save.
  await pedirTile(ctx, 1, 0);
  const conDosTiles = await esperarEnElSave(
    partida.sessionId,
    (s) => (s.scenes_loaded?.tile_1_0 ? Object.keys(s.scenes_loaded) : null),
    60_000,
  );
  if (!conDosTiles) ctx.sinMedir("el tile (1,0) pedido por el cable no llegó al save: sin dos tiles no hay negativo que medir");
  ctx.log(`tiles en el save: ${JSON.stringify(conDosTiles)}`);

  const ruta = rutaDelSave(partida.sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "esta corrida no tiene disco propio (stack adoptado): sin el save no se puede mover a nadie",
    );
  }

  // ── 1 · POSITIVO: la viva fuera de toda unión ───────────────────────────
  const roto = moverEnElLedger(ruta, FUERA_DEL_MUNDO);
  ctx.expect("precondición: el ledger del save tiene al tabernero", Boolean(roto), ruta);
  if (!roto) return;
  ctx.log(
    `saboteado ${NPC} («${roto.nombre}»): posición viva ${JSON.stringify(roto.antes)} → ` +
      `${JSON.stringify(FUERA_DEL_MUNDO)} · tiles del save ${JSON.stringify(roto.tiles)}`,
  );
  const vuelta = await reanudar(ctx, partida.sessionId);
  if (!vuelta) return;
  ctx.expect("#382 · la escena carga igual: el aviso no bloquea la partida", Boolean(vuelta.scene), vuelta.scene);
  // `expectEspera` y no un `waitFor` suelto: la expiración ES el defecto que se
  // busca (el silencio), así que tiene que quedar AFIRMADA con sus sondeos.
  await ctx.expectEspera(
    `el panel del jugador nombra a «${roto.nombre}» y dice que está donde no hay mundo`,
    true,
    ([nombre, frase]) => {
      const txt = Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "");
      return txt.some((t) => t.includes(nombre) && t.includes(frase)) ? txt : null;
    },
    {
      ms: 60_000,
      arg: [roto.nombre, FRASE],
      aserto: `#382 · el panel del jugador DICE que la partida pone a ${roto.nombre} donde no hay mundo`,
    },
  );
  const errores = await panelDeErrores(ctx);
  ctx.log(`panel tras reanudar con la viva fuera del mundo: ${JSON.stringify(errores)}`);
  await ctx.shot("viva-fuera-del-mundo-en-el-panel");
  const linea = errores.find((t) => t.includes(roto.nombre) && t.includes(FRASE)) ?? "";
  ctx.expect(
    "…y nombra la coordenada viva (168), que es la que no cae en ningún tile",
    /168[.,]\d/.test(linea),
    linea,
  );
  ctx.expect(
    "…y SOLO por el saboteado: el resto del ledger no genera ruido en el panel",
    errores.filter((t) => t.includes(FRASE)).length === 1,
    JSON.stringify(errores.filter((t) => t.includes(FRASE))),
  );

  // ── 2 · NEGATIVO: la viva en el tile VECINO, donde sí hay mundo ─────────
  const movido = moverEnElLedger(ruta, EN_EL_TILE_VECINO);
  ctx.expect("precondición: el ledger sigue teniendo al tabernero", Boolean(movido), ruta);
  if (!movido) return;
  ctx.log(`movido ${NPC} a ${JSON.stringify(EN_EL_TILE_VECINO)} (dentro de tile_1_0) · tiles ${JSON.stringify(movido.tiles)}`);
  const vuelta2 = await reanudar(ctx, partida.sessionId);
  if (!vuelta2) return;
  // El timeout ES el éxito: durante la carga entera nadie dice que el
  // tabernero esté donde no hay mundo. Se espera lo que tarda en llegar el
  // aviso del bloque 1 (llega con el `session_started`, antes que la escena),
  // así que un `null` aquí no es «no llegué a mirar».
  await ctx.expectEspera(
    "ninguna línea del panel dice que el tabernero esté donde no hay mundo",
    false,
    (frase) =>
      Array.from(document.querySelectorAll("#error-log > div")).some((n) => (n.textContent ?? "").includes(frase))
        ? Array.from(document.querySelectorAll("#error-log > div")).map((n) => n.textContent ?? "")
        : null,
    {
      ms: 5_000,
      arg: FRASE,
      aserto: "#382 · el NPC que se fue al tile vecino NO enciende el aviso (negativo del falso rojo)",
    },
  );
  const tras = await panelDeErrores(ctx);
  ctx.log(`panel tras reanudar con la viva en el tile vecino: ${JSON.stringify(tras)}`);
  await ctx.shot("viva-en-el-tile-vecino-sin-aviso");
  ctx.log(`partida ${partida.sessionId} · fin del guion`);
}
