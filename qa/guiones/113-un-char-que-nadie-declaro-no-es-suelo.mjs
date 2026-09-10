/** UN CHAR DEL GRID QUE NADIE DECLARÓ NO ES SUELO: el save no carga, y el
 *  jugador lee una salida (#464).
 *
 *  EL AGUJERO, medido en la QA de #458 (T13, 2026-09-05) sobre `39d0880`: el
 *  `terrain` de un tile expandido pasaba por `ExpandedSceneSchema` como
 *  `z.array(z.string())` y por `openTile` con tres comprobaciones —número de
 *  filas, longitud de cada fila y bioma— y ninguna miraba el ALFABETO. Un char
 *  que el engine no escribe nunca no se pinta (el suelo sale de `ground`) y no
 *  bloquea (la solidez del terreno es solo el agua), así que una fila entera de
 *  chars ajenos partiendo el tile daba `validateScene → ok:true` con
 *  `reachable == walkable` y el jugador la CRUZABA. Es lo peor que puede pasar
 *  con el terreno: atravesar lo que debería frenarte.
 *
 *  POR QUÉ ESTE GUION Y NO SOLO LOS TESTS DE CORE. Los tests miden las dos
 *  puertas por separado; lo que aquí se mide es que la vía REAL por la que un
 *  char así entra al juego —un save en disco, que es la única (el motor no
 *  escribe `terrain`)— acaba en un rechazo que el jugador puede leer y del que
 *  puede salir, y no en un mundo que se cruza. Hermano del 62, que hace lo
 *  mismo con los campos retirados.
 *
 *  Lo que se afirma, por el camino del jugador (partida jugada → save de DISCO
 *  con un char ajeno → resume):
 *   1. CONTROL: sin tocar nada, el mismo resume carga. Sin esto, «rechaza»
 *      podría estar rechazando por la ruta y no por el contenido.
 *   2. PROTOCOLO: el resume del save saboteado contesta `save_invalido`
 *      nombrando la escena, el campo `terrain`, el CHAR y la CELDA.
 *   3. JUGADOR: pulsar «Reanudar» sobre esa tarjeta vuelve al título con la
 *      salida real, sin montar el mundo, y sin enseñarle jerga de contrato.
 *   4. …y el fichero sigue intacto: nadie lo «reparó» por su cuenta.
 *
 *  EL CHAR SE ELIGE MIRANDO EL ALFABETO, no a mano: se lee `TERRAIN_ALPHABET`
 *  de su fuente (`nefan-core/src/scene/scene-expand.ts`) y se coge el primer
 *  char imprimible que NO esté en él. Así el día que el alfabeto crezca, este
 *  guion sigue saboteando con algo que de verdad está fuera — un literal se
 *  volvería verde por dentro sin que nadie lo notara.
 *
 *  Probado en negativo (2026-09-10): con el `superRefine` del alfabeto quitado
 *  de `ExpandedSceneSchema`, el bloque 2 se pone rojo (el save con la pared de
 *  chars ajenos CARGA) y el 3 también (el título entra en la partida en vez de
 *  volver con el motivo). Restaurado byte a byte.
 *
 *  Cero créditos: preset `e2e-sin-creditos`, el motor es el fake-ai-server y
 *  este guion no le pide nada más que el bootstrap.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { nuevaPartida, comenzar, recargarAlTitulo } from "../lib/sesion.mjs";
import { rutaDelSave, esperarPartidaEnDisco } from "../lib/saves.mjs";
import { URLS } from "../lib/stack.mjs";

export const aisla = ["saves"];

/** La fuente única del alfabeto. Se lee como TEXTO porque el runner es node a
 *  secas (sin tsx) y el fichero es TypeScript — misma receta que el 62. */
const FUENTE = fileURLToPath(new URL("../../nefan-core/src/scene/scene-expand.ts", import.meta.url));

/** El alfabeto tal y como lo declara core: los chars base del catálogo de
 *  biomas más los tres que rasteriza `ground`. Se resuelven las constantes que
 *  la expresión nombra, para no depender de que estén escritas en línea. */
function alfabetoDelGrid() {
  const src = readFileSync(FUENTE, "utf8");
  const chars = new Set();
  const catalogo = readFileSync(
    fileURLToPath(new URL("../../nefan-core/src/scene/tile.ts", import.meta.url)),
    "utf8",
  ).match(/BIOME_CATALOG[^{]*\{([^}]*)\}/);
  if (!catalogo) throw new Error("no encuentro BIOME_CATALOG en tile.ts");
  for (const m of catalogo[1].matchAll(/:\s*"([^"]+)"/g)) chars.add(m[1]);
  for (const nombre of ["GROUND_PATH_CHAR", "GROUND_DECK_CHAR"]) {
    const m = src.match(new RegExp(`${nombre}\\s*=\\s*"([^"]+)"`));
    if (!m) throw new Error(`no encuentro ${nombre} en scene-expand.ts`);
    chars.add(m[1]);
  }
  const agua = readFileSync(
    fileURLToPath(new URL("../../nefan-core/src/scene/blueprint/ground-collision.ts", import.meta.url)),
    "utf8",
  ).match(/GROUND_WATER_CHAR\s*=\s*"([^"]+)"/);
  if (!agua) throw new Error("no encuentro GROUND_WATER_CHAR en ground-collision.ts");
  chars.add(agua[1]);
  return [...chars];
}

/** El primer char imprimible que el alfabeto NO admite. Elegirlo así, y no
 *  escribirlo, es lo que impide que este guion siga saboteando con un char que
 *  mañana sea legítimo. */
function charFueraDelAlfabeto(alfabeto) {
  const dentro = new Set(alfabeto);
  for (const c of "WXYZQKMPRT#@") if (!dentro.has(c)) return c;
  throw new Error(`no queda ningún char fuera del alfabeto (${alfabeto.join(" ")})`);
}

/** Lo que el jugador tiene que leer: la salida real, no «inténtalo de nuevo».
 *  Es el mismo texto que mide el 62, porque es el mismo desenlace. */
const SALIDA_PARA_EL_JUGADOR = /ya no vale para esta versión del juego.*bórrala o empieza una nueva/;

/** Un `resume_session` crudo por el cable del bridge, DESDE la página (misma
 *  receta que el 46 y el 62: la URL la da el propio juego con sus overrides). */
async function resumePorElCable(ctx, sessionId) {
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
        ws.onopen = () =>
          ws.send(JSON.stringify({ type: "resume_session", sessionId: sid, requestId: "qa-113" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "session_started" || m.requestId !== "qa-113") return;
          contestado = true;
          ws.close();
          res({ ok: m.ok, error: m.error ?? "" });
        };
      }),
    sessionId,
  );
}

export default async function (ctx) {
  const alfabeto = alfabetoDelGrid();
  const ajeno = charFueraDelAlfabeto(alfabeto);
  ctx.log(`alfabeto del grid según core: ${alfabeto.join(" ")} · char ajeno elegido: ${JSON.stringify(ajeno)}`);

  // ── 0. Una partida real, jugada por el camino del jugador ────────────────
  await nuevaPartida(ctx, { gameId: "alta_fantasia", charMode: "vector" });
  await comenzar(ctx);
  const salud = await (await fetch(`${URLS.state_api}/health`)).json();
  const sessionId = salud?.session_id;
  ctx.expect("la partida tiene sesión viva en el State API", Boolean(sessionId), JSON.stringify(salud));
  if (!sessionId) return;
  await esperarPartidaEnDisco(ctx, sessionId);
  const ruta = rutaDelSave(sessionId);
  if (!ruta) {
    ctx.sinMedir(
      "sin disco efímero (QA_RUN_TMP) no hay `state.json` de esta corrida que sabotear, y tocar el " +
        "save de otro stack sería fabricar el estado de una partida ajena",
    );
    return;
  }

  // Al título: el bridge queda quieto y el fichero deja de reescribirse.
  await recargarAlTitulo(ctx);

  const original = readFileSync(ruta, "utf8");
  const guardado = JSON.parse(original);
  const escenas = Object.entries(guardado.scenes_loaded ?? {});
  const conGrid = escenas.find(([, rec]) => Array.isArray(rec?.scene_data?.terrain));
  ctx.expect(
    "el save trae una escena con su grid de terreno (si no, no hay nada que sabotear)",
    Boolean(conGrid),
    JSON.stringify(escenas.map(([id]) => id)),
  );
  if (!conGrid) return;
  const [escena] = conGrid;

  // ── 1. CONTROL: el save intacto CARGA ────────────────────────────────────
  const control = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "1 · el save intacto reanuda (sin esto, el rechazo de abajo podría ser de la ruta y no del contenido)",
    control.ok === true,
    JSON.stringify(control),
  );

  // ── 2. PROTOCOLO: una pared de chars ajenos partiendo el tile ────────────
  // La fila 64 de un tile de 128: exactamente el sabotaje que el issue midió
  // saliendo `ok:true` con `reachable == walkable`.
  const FILA = 64;
  const saboteado = JSON.parse(original);
  const grid = saboteado.scenes_loaded[escena].scene_data.terrain;
  grid[FILA] = ajeno.repeat(grid[FILA].length);
  const textoSaboteado = JSON.stringify(saboteado);
  writeFileSync(ruta, textoSaboteado);

  const res = await resumePorElCable(ctx, sessionId);
  ctx.log(`2 · resume del save saboteado: ${JSON.stringify(res).slice(0, 300)}`);
  ctx.expect(
    "2 · el resume RECHAZA el save: un char que nadie declaró no entra al mundo como suelo",
    res.ok === false && /^save_invalido:/.test(res.error),
    JSON.stringify(res),
  );
  ctx.expect(
    "2 · …y el motivo nombra la escena, el campo `terrain`, el CHAR y la CELDA (accionable sobre 16.384)",
    res.error.includes(`"${escena}"`) &&
      res.error.includes("campo `terrain`") &&
      res.error.includes(`terrain[${FILA}][0] trae el char ${JSON.stringify(ajeno)}`),
    res.error,
  );
  ctx.expect(
    "2 · …y le dice cuál es el alfabeto, que es lo único con lo que se puede arreglar",
    alfabeto.every((c) => res.error.includes(c)),
    res.error,
  );

  // ── 3. JUGADOR: «Reanudar» no cuelga ni monta el mundo atravesable ───────
  const tarjeta = await ctx.page.$(`button[data-action="resume"][data-session-id="${sessionId}"]`);
  ctx.expect("3 · el título ofrece la tarjeta del save (el jugador no sabe que su grid está roto)", Boolean(tarjeta), sessionId);
  if (tarjeta) {
    await tarjeta.click();
    const aviso = await ctx.waitFor(
      "3 · el título vuelve con un error visible (no un cuelgue, no el mundo que se cruza)",
      () => {
        const el = document.getElementById("ts-error");
        const visible = el && el.style.display !== "none" && (el.textContent ?? "").trim();
        return visible ? el.textContent.trim() : null;
      },
      30_000,
    );
    ctx.log(`3 · lo que lee el jugador: «${aviso}»`);
    ctx.expect(
      "3 · lo que lee dice la única salida real: borrar la partida o empezar otra",
      SALIDA_PARA_EL_JUGADOR.test(aviso ?? ""),
      String(aviso),
    );
    ctx.expect(
      "3 · …y no le enseña jerga de contrato: el `terrain[64][0]` va al panel de errores, no al título",
      !(aviso ?? "").includes("terrain["),
      String(aviso),
    );
    ctx.expect(
      "3 · tras el intento no hay escena montada: el mundo con la pared falsa no llegó al cliente",
      !(await ctx.nefan("status")).scene,
      JSON.stringify(await ctx.nefan("status")),
    );
    await ctx.shot("113-titulo-tras-reanudar-un-grid-con-char-ajeno");
  }

  // ── 4. El fichero sigue intacto y la partida REVIVE al restaurarlo ───────
  ctx.expect(
    "4 · el save saboteado sigue byte a byte como se dejó (nadie lo saneó ni lo «reparó»)",
    readFileSync(ruta, "utf8") === textoSaboteado,
    ruta,
  );
  writeFileSync(ruta, original);
  const res4 = await resumePorElCable(ctx, sessionId);
  ctx.expect(
    "4 · restaurado el grid, el mismo resume carga: el rechazo era del char, no de la partida",
    res4.ok === true,
    JSON.stringify(res4),
  );
}
