/** HABLAR CON EL BRIDGE DESDE NODE, sin página (#739).
 *
 *  Tres clientes del banco no tienen navegador y hablan con el bridge por su
 *  propio socket: los dos candados headless de la raíz de `qa/`
 *  (`el-npc-cruza-ai-server-con-role-y-description.mjs`,
 *  `el-state-api-no-muta-sin-partida.mjs`) y el `--diag` de `run.mjs`. Cada uno
 *  llevaba su `new WebSocket` con su lectura del rechazo, y eran tres lecturas
 *  distintas: dos cortaban con cualquier error, la del `--diag` solo con
 *  `protocolo` y reventaba con un frame ilegible dentro del manejador. Y uno de
 *  ellos se llamaba `porElCable`, como la puerta de la página, con otra
 *  semántica. Esto es su puerta: el nombre dice para qué es, y no lleva
 *  «cable» porque no hay página.
 *
 *  QUÉ ES UN RECHAZO lo dice `leerFrame` (`rechazo-del-bridge.mjs`), la misma
 *  función que leen `cable.mjs` y `pedirYEsperarTile` en la página. La
 *  POLÍTICA es de aquí y es la que tenían los tres: CUALQUIER rechazo —de
 *  cualquier `kind`, e `ilegible`— corta la conversación y rechaza la promesa
 *  con un `RechazoDelBridge` de `motivo:"rechazo"`. Un cliente Node suscrito
 *  (el que manda `start_session`) recibe también las difusiones de error de
 *  su partida, y para un candado headless todas son rojo.
 *
 *  La espera NO es opcional, y es exactamente una de dos:
 *   · `listo(recibidos)` → se resuelve cuando devuelve truthy. Si LANZA, la
 *     promesa se rechaza con ese error: así un candado dice «`session_started
 *     ok:false` — …» sin que esta puerta sepa qué es un `session_started`.
 *   · `ventanaMs` → se resuelve con lo recibido cuando pasa ese tiempo desde el
 *     `send`, salvo que antes llegue un rechazo. Es la forma de «mando un frame
 *     que no contesta nada y miro si el bridge lo rechaza».
 *  Y `techoMs` es obligatorio: un `listo` que no llega nunca acaba en un
 *  `motivo:"techo"` que lista los `type/phase` recibidos, que es la pista.
 *
 *  Las otras dos bocas: `motivo:"no-abre"` (el socket no llegó a abrir: dice la
 *  URL) y `motivo:"cerrado"` (el bridge cerró, o el socket falló, sin que la
 *  conversación hubiera acabado). Las cuatro llevan `recibidos` y `ms` para que
 *  quien llame decida —el `--diag` convierte `techo`/`no-abre`/`cerrado` en su
 *  `null` de siempre y `rechazo` en `{rechazo}`—.
 *
 *  Probado sin red en `nefan-core/test/bridge-desde-node.test.ts`, con un
 *  `WebSocket` falso. Que el bridge REAL conteste por aquí lo ejercen los dos
 *  candados headless en CI (`candados-headless`). En el padrón
 *  `data/contract/clientes-ws-del-banco.json`, como `todo`. */
import { leerFrame } from "./rechazo-del-bridge.mjs";
import { fraseDeRechazos } from "./cable.mjs";

/** Lo que rechaza la promesa cuando la conversación no acaba bien por el lado
 *  del bridge o del socket. `motivo` es uno de `rechazo` · `techo` · `no-abre` ·
 *  `cerrado`; `rechazos` solo lo trae `rechazo`. */
export class RechazoDelBridge extends Error {
  constructor(motivo, mensaje, { rechazos = [], recibidos = [], ms = null } = {}) {
    super(mensaje);
    this.name = "RechazoDelBridge";
    this.motivo = motivo;
    this.rechazos = rechazos;
    this.recibidos = recibidos;
    this.ms = ms;
  }
}

/** `type/phase` de lo recibido, para el texto del techo y del cierre. */
const tipos = (recibidos) => recibidos.map((m) => m.type + (m.phase ? `/${m.phase}` : "")).join(", ") || "ninguno";

/** Abre un socket de Node contra `url`, manda `mensaje` y espera lo que se le
 *  pida (ver la cabecera). Devuelve `{ recibidos, ms }`: todos los frames
 *  leídos en orden y los milisegundos desde el `send`.
 *
 *  Una llamada mal hecha —sin espera, con las dos, o sin `techoMs`— LANZA antes
 *  de abrir nada. */
export async function conversarConElBridge(url, mensaje, { listo, ventanaMs, techoMs } = {}) {
  const conListo = listo !== undefined;
  const conVentana = ventanaMs !== undefined;
  if (conListo === conVentana) {
    throw new Error(
      "conversarConElBridge: la espera es OBLIGATORIA y es UNA — `listo(recibidos)` (hasta que diga) o `ventanaMs` " +
        `(ese tiempo tras el send); llegaron ${conListo ? "las dos" : "ninguna"}`,
    );
  }
  if (conListo && typeof listo !== "function") {
    throw new Error(`conversarConElBridge: \`listo\` es una función \`(recibidos) => …\` y llegó ${JSON.stringify(listo)}`);
  }
  if (conVentana && !(Number.isFinite(ventanaMs) && ventanaMs >= 0)) {
    throw new Error(`conversarConElBridge: \`ventanaMs\` es un número de milisegundos y llegó ${JSON.stringify(ventanaMs)}`);
  }
  if (!(Number.isFinite(techoMs) && techoMs > 0)) {
    throw new Error(
      `conversarConElBridge: \`techoMs\` es obligatorio (sin él, una espera que no llega cuelga el guion) y llegó ${JSON.stringify(techoMs)}`,
    );
  }
  const quien = `\`${mensaje?.type}\`${mensaje?.requestId ? ` (${mensaje.requestId})` : ""}`;

  return new Promise((resolver, rechazar) => {
    const ws = new WebSocket(url);
    const recibidos = [];
    let t0 = null;
    let acabado = false;
    let ventana = null;
    const ms = () => (t0 === null ? null : Date.now() - t0);
    const fin = (fn, v) => {
      if (acabado) return;
      acabado = true;
      clearTimeout(techo);
      clearTimeout(ventana);
      // WHATWG: `close()` no lanza en CLOSING ni CLOSED, así que no hace falta
      // un `try` que calle nada.
      ws.close();
      fn(v);
    };
    const falla = (motivo, texto, extra = {}) =>
      fin(rechazar, new RechazoDelBridge(motivo, `${quien}: ${texto}`, { recibidos, ms: ms(), ...extra }));
    const techo = setTimeout(
      () => falla("techo", `el bridge no llegó a la condición en ${techoMs / 1000} s; recibidos: ${tipos(recibidos)}`),
      techoMs,
    );
    ws.onerror = (e) =>
      t0 === null
        ? falla("no-abre", `no se pudo abrir ${url}${e?.message ? ` (${e.message})` : ""}`)
        : falla("cerrado", `el socket falló a mitad de la conversación${e?.message ? ` (${e.message})` : ""}; recibidos: ${tipos(recibidos)}`);
    ws.onclose = () => falla("cerrado", `el bridge cerró el socket antes de acabar; recibidos: ${tipos(recibidos)}`);
    ws.onmessage = (ev) => {
      if (acabado) return;
      const { frame, rechazo } = leerFrame(ev.data);
      if (rechazo) {
        if (frame !== null) recibidos.push(frame);
        falla("rechazo", fraseDeRechazos([rechazo]), { rechazos: [rechazo] });
        return;
      }
      // Un JSON `null` no se apila, y `listo` solo se consulta cuando hay un
      // frame nuevo: así `recibidos.at(-1)` es siempre un frame (M-2 de la QA).
      if (frame === null) return;
      recibidos.push(frame);
      if (!conListo) return;
      let hecho;
      try {
        hecho = listo(recibidos);
      } catch (e) {
        // El error de `listo` es el veredicto de quien llama: se propaga TAL
        // CUAL, no se envuelve (su texto es el que tiene que salir en el ✘).
        fin(rechazar, e);
        return;
      }
      if (hecho) fin(resolver, { recibidos, ms: ms() });
    };
    ws.onopen = () => {
      t0 = Date.now();
      ws.send(JSON.stringify(mensaje));
      if (conVentana) ventana = setTimeout(() => fin(resolver, { recibidos, ms: ms() }), ventanaMs);
    };
  });
}
