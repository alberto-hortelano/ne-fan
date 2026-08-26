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
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_TMP = join(dirname(fileURLToPath(import.meta.url)), "..", ".tmp");

/** Directorios `saves/` del disco efímero (el runner deja uno por corrida y
 *  borra los muertos al empezar). Vacío = no hay disco observable. */
function directoriosDeSaves() {
  if (!existsSync(RAIZ_TMP)) return [];
  return readdirSync(RAIZ_TMP)
    .map((corrida) => join(RAIZ_TMP, corrida, "saves"))
    .filter((d) => existsSync(d));
}

/** Ruta del `state.json` de una sesión en el disco efímero, o null. */
export function rutaDelSave(sessionId) {
  for (const dir of directoriosDeSaves()) {
    const f = join(dir, sessionId, "state.json");
    if (existsSync(f)) return f;
  }
  return null;
}

/** Las partidas que el bridge dice tener, por su propio cable. Se abre el
 *  socket DESDE LA PÁGINA para heredar su `?bridge=` (el guion 20 levanta el
 *  suyo en otro puerto). */
async function listarPorElBridge(ctx) {
  return ctx.page.evaluate(
    () =>
      new Promise((res, rej) => {
        const url = new URLSearchParams(location.search).get("bridge") ?? "ws://127.0.0.1:9877";
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
  const [dir] = directoriosDeSaves();
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
