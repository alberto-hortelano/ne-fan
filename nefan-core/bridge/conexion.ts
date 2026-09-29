/** Lo que el bridge hace con CADA socket del juego (#769): saludar, pasar cada
 *  frame por el borde antes de enrutarlo y soltar el mundo al cerrarse. Vivía
 *  en `ws-server.ts`, donde ningún test llegaba; aquí el socket se tipa por lo
 *  que se usa de él, así que un `EventEmitter` lo conduce igual que `ws`. */

import type { Entorno } from "../src/session/gates-de-imagen.js";
import { intakeClientMessage } from "./message-intake.js";
import { routeMessage } from "./router.js";
import type { BridgeContext, ClientSocket } from "./context.js";

/** Lo que el transporte usa del socket: escribir en él (`ClientSocket`) y
 *  oír sus mensajes y su cierre. */
export interface SocketDelJuego extends ClientSocket {
  on(evento: "message", oyente: (raw: { toString(): string }) => void): unknown;
  on(evento: "close", oyente: () => void): unknown;
}

export function atenderConexion(
  ws: SocketDelJuego,
  ctx: BridgeContext,
  opts: { entorno: Entorno; suscriptores: Set<ClientSocket> },
): void {
  console.log("Bridge: client connected");
  // Lo primero que oye cada socket, con sesión o sin ella (fixtures): el
  // entorno de la corrida. Unicast y sin sello (`BridgeHelloMessage`).
  ctx.send(ws, { type: "bridge_hello", entorno: opts.entorno });

  ws.on("message", async (raw) => {
    // Borde fail-loud: el input del cliente (WS sin auth) NO llega crudo a los
    // handlers. JSON inválido o shape no conforme al contrato → se rechaza con
    // el error preciso, en vez de petar dentro de un handler con un TypeError.
    const texto = raw.toString();
    const intake = intakeClientMessage(texto);
    if (!intake.ok) {
      console.error(`Bridge: WS frame rejected (${intake.reason}): ${intake.error} — ${texto.slice(0, 200)}`);
      // UNICAST —al socket que mandó la basura, no a todos— pero por el
      // mismo transporte que sella: aquí el `sessionId` se escribía a mano.
      // `protocolo` y no `scene` (#352, QA H-7): esto no es la generación de
      // ningún sitio, es el juego mandando un frame que el bridge no puede
      // leer. Con `scene` el jugador leía «No se pudo preparar el lugar», que
      // nombra a otro culpable, y debajo jerga de bridge. El volcado técnico
      // —el motivo del intake y los 200 primeros bytes— ya está entero en el
      // `console.error` de arriba, que es donde sirve.
      ctx.enviarNarrativo(ws, {
        type: "narrative_status",
        phase: "error",
        kind: "protocolo",
        message:
          intake.reason === "json"
            ? "El juego mandó al servidor algo que no es un mensaje válido."
            : "El juego mandó un mensaje que el servidor no reconoce.",
      });
      return;
    }
    await routeMessage(intake.msg, ws, ctx);
  });

  ws.on("close", () => {
    opts.suscriptores.delete(ws);
    // Quien tenía el mundo se ha ido: queda sin dueño y el save deja de
    // escuchar al sim. Sin esto, un F5 dejaba la partida guardada oyendo a un
    // sim que el siguiente cliente conduce sin ser el suyo.
    ctx.world.release(ws);
    console.log("Bridge: client disconnected");
  });
}
