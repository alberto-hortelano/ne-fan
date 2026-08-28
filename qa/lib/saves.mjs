/** Lo que hay en `saves/`, mirado desde fuera del juego.
 *
 *  Desde #279 una partida existe en disco cuando el jugador ha llegado a
 *  jugarla: se escribe con el ack `session_entered`, no con el `ok:true` de
 *  `start_session`. Eso cambia dos cosas para los guiones:
 *
 *   1. hay algo que AFIRMAR sobre el disco («un arranque que falla no deja
 *      ningún directorio nuevo»), y
 *   2. hay algo que ESPERAR antes de mirar un save («la partida ya existe»),
 *      que es el instante que `comenzar()` daba por bueno demasiado pronto
 *      (#270: volvía con la escena, que llega ANTES).
 *
 *  El sondeo vive aquí y no en un guion a propósito: `qa/lib` está exento de
 *  `qa-guiones-sin-espera-por-reloj` (arch-rules.json) justo para esto —igual
 *  que `puertos.mjs`—, porque el estado que hay que esperar no vive en la
 *  página. Y no es una espera por reloj disfrazada: `maxMs` es un cortafuegos
 *  de deadlock, la condición de parada es el fichero.
 *
 *  DOS FUENTES, la misma respuesta. La de verdad es el disco efímero del
 *  runner (`qa/.tmp/<corrida>/saves`), que es lo que ve el jugador. Contra un
 *  stack ajeno (`node qa/run.mjs --url …`) ese directorio no existe, y
 *  entonces se pregunta al bridge por su propio cable (`list_sessions`): tras
 *  retirar la poda de saves vacíos, su listado es espejo fiel de `saves/`. La
 *  fuente se devuelve siempre para que el guion la registre — un aserto que no
 *  dice de dónde salió el dato vale menos.
 */
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** El `saves/` del disco efímero de ESTA corrida, o null si no hay ninguno
 *  observable (stack adoptado: su disco no lo conocemos).
 *
 *  `QA_RUN_TMP` la pone `qa/run.mjs`, y SOLO cuando el stack lo arrancó él.
 *  Antes esto recorría todos los `qa/.tmp/*` sin filtrar y `listarSaves` se
 *  quedaba con `const [dir] = …`: el primero alfabético, que es el RUN_ID más
 *  ANTIGUO — o sea, con dos baterías a la vez, el disco de la OTRA corrida.
 *  Es el «sale verde midiendo otra cosa» en la capa que nadie miraba: no falla,
 *  afirma sobre los saves del vecino. */
function dirDeSaves() {
  const tmp = process.env.QA_RUN_TMP;
  if (!tmp) return null; // sin corrida propia: se pregunta al bridge
  const dir = join(tmp, "saves");
  if (!existsSync(dir)) {
    throw new Error(
      `QA_RUN_TMP apunta a ${tmp} pero ahí no hay saves/. El runner declara un disco ` +
        `efímero que no existe: no se puede afirmar nada sobre las partidas en disco.`,
    );
  }
  return dir;
}

/** Ruta del `state.json` de una sesión en el disco efímero, o null. */
export function rutaDelSave(sessionId) {
  const dir = dirDeSaves();
  if (!dir) return null;
  const f = join(dir, sessionId, "state.json");
  return existsSync(f) ? f : null;
}

/** Las partidas que el bridge dice tener, por su propio cable. Se abre el
 *  socket DESDE LA PÁGINA, y la URL la da el propio juego
 *  (`__nefan.servicios()`): así hereda su `?bridge=` (el guion 20 levanta el
 *  suyo en otro puerto) sin que este fichero tenga que saberse ningún puerto,
 *  que era lo que hacía el `?? "ws://127.0.0.1:<bridge>"` de antes. */
async function listarPorElBridge(ctx) {
  return ctx.page.evaluate(
    () =>
      new Promise((res, rej) => {
        const url = window.__nefan.servicios()["game-gateway"];
        const ws = new WebSocket(url);
        let contestado = false;
        ws.onerror = () => rej(new Error(`no se pudo abrir ${url}`));
        ws.onclose = () => {
          if (!contestado) rej(new Error(`${url} se cerró sin contestar a list_sessions`));
        };
        ws.onopen = () => ws.send(JSON.stringify({ type: "list_sessions", requestId: "qa-saves" }));
        ws.onmessage = (ev) => {
          const m = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
          if (m.type !== "sessions_listed") return;
          contestado = true;
          ws.close();
          res((m.sessions ?? []).map((s) => s.session_id));
        };
      }),
  );
}

/** Las partidas que existen AHORA MISMO: `{ fuente, ids }`. */
export async function listarSaves(ctx) {
  const dir = dirDeSaves();
  if (dir) return { fuente: `disco (${dir})`, ids: readdirSync(dir).sort() };
  return { fuente: "bridge (list_sessions)", ids: (await listarPorElBridge(ctx)).sort() };
}

/** Espera a que la partida `sessionId` EXISTA en disco.
 *
 *  Es la tercera condición de `comenzar()` (#270): sin ella, un guion que mide
 *  el `state.json` justo después de arrancar corre contra un fichero que aún
 *  no está, y el rojo que sale no es del juego. */
export async function esperarPartidaEnDisco(ctx, sessionId, maxMs = 60_000) {
  const t0 = Date.now();
  let ultima = null;
  while (Date.now() - t0 < maxMs) {
    if (rutaDelSave(sessionId)) return { fuente: "disco" };
    ultima = await listarSaves(ctx).catch((e) => ({ fuente: `error: ${e.message}`, ids: [] }));
    if (ultima.ids.includes(sessionId)) return { fuente: ultima.fuente };
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `la partida ${sessionId} no llegó a existir en ${maxMs / 1000}s ` +
      `(hay: ${JSON.stringify(ultima?.ids ?? [])} · ${ultima?.fuente ?? "sin fuente"}). ` +
      `El cliente no mandó el ack «session_entered», o el bridge no lo aceptó.`,
  );
}

/** Clona un save `n` veces con ids nuevos. Devuelve los ids creados.
 *
 *  Existe para el guion que mide QUÉ SE PINTA con muchas partidas (#251): la
 *  alternativa es jugar doce arranques, y doce bootstraps del motor falso son
 *  minutos de batería para medir un layout. Lo que se necesita es que el
 *  bridge tenga doce saves que listar, y `FsSessionStorage.list()` los lee del
 *  disco tal cual — así que copiar uno REAL doce veces ejerce exactamente el
 *  mismo camino de lectura que jugarlos.
 *
 *  El `session_id` de DENTRO se reescribe además del nombre del directorio:
 *  `list()` devuelve `data.session_id || name`, así que sin eso las doce
 *  tarjetas dirían el mismo id y sus botones colisionarían.
 *
 *  Vive en `qa/lib` porque toca el disco efímero de la corrida, que es lo que
 *  este fichero sabe encontrar; un guion no conoce esa ruta. */
export function clonarSaves(origen, n) {
  const dir = dirDeSaves();
  if (!dir) {
    throw new Error(
      "clonarSaves necesita el disco efímero de la corrida (QA_RUN_TMP); contra un stack " +
        "adoptado no se sabe dónde guarda sus partidas.",
    );
  }
  const base = join(dir, origen);
  if (!existsSync(base)) throw new Error(`no hay save que clonar en ${base}`);
  const creados = [];
  for (let i = 0; i < n; i++) {
    const id = `${origen}_clon${i}`;
    cpSync(base, join(dir, id), { recursive: true });
    const f = join(dir, id, "state.json");
    const data = JSON.parse(readFileSync(f, "utf-8"));
    data.session_id = id;
    writeFileSync(f, JSON.stringify(data));
    creados.push(id);
  }
  return creados;
}
