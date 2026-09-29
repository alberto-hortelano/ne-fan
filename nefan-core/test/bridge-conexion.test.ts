/** Lo que el bridge hace con cada socket (`bridge/conexion.ts`, #769): el
 *  saludo con el entorno, el rechazo en el borde de lo que no es un mensaje y
 *  soltar el mundo al cerrarse. Vivía en `ws-server.ts`, que ningún test
 *  podía importar; aquí se conduce con un `EventEmitter` que hace de socket. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { atenderConexion, type SocketDelJuego } from "../bridge/conexion.js";
import { makeCtx } from "./helpers.js";
import type { ServerMessage } from "../src/protocol/messages.js";

/** Un socket del juego que se puede conducir: `emit("message", …)` es el
 *  frame que llega y `sent` lo que el bridge le contesta. */
function socketDePrueba(): { ws: SocketDelJuego & EventEmitter; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const ws = Object.assign(new EventEmitter(), {
    send(data: string) {
      sent.push(JSON.parse(data) as ServerMessage);
    },
    readyState: 1,
    OPEN: 1,
  });
  return { ws, sent };
}

/** Lo que el handler async del mensaje deja en el socket, ya asentado. */
const asentar = () => new Promise((r) => setImmediate(r));

describe("atender una conexión del juego (#769)", () => {
  it("lo PRIMERO que oye el socket es el entorno de la corrida, sin sello", () => {
    for (const entorno of ["desarrollo", "produccion"] as const) {
      const { ctx, subscribers } = makeCtx();
      const { ws, sent } = socketDePrueba();
      atenderConexion(ws, ctx, { entorno, suscriptores: subscribers });
      assert.deepEqual(sent, [{ type: "bridge_hello", entorno }]);
    }
  });

  it("JSON roto → `protocolo` al socket que lo mandó, sellado, y nada a los demás", async () => {
    const { ctx, subscribers, broadcasts, narrative } = makeCtx();
    narrative.startNewSession("plugtest");
    const { ws, sent } = socketDePrueba();
    atenderConexion(ws, ctx, { entorno: "desarrollo", suscriptores: subscribers });
    ws.emit("message", Buffer.from("{no es json"));
    await asentar();
    assert.deepEqual(sent.slice(1), [
      {
        type: "narrative_status",
        phase: "error",
        kind: "protocolo",
        message: "El juego mandó al servidor algo que no es un mensaje válido.",
        sessionId: narrative.session_id,
      },
    ]);
    assert.deepEqual(broadcasts, [], "unicast: el resto de sockets no se entera");
  });

  it("un JSON que el contrato no reconoce → `protocolo` con OTRO texto: nombra el mensaje, no el formato", async () => {
    const { ctx, subscribers } = makeCtx();
    const { ws, sent } = socketDePrueba();
    atenderConexion(ws, ctx, { entorno: "desarrollo", suscriptores: subscribers });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "no_existe" })));
    await asentar();
    const [, s] = sent;
    assert.ok(s?.type === "narrative_status");
    assert.equal(s.kind, "protocolo");
    assert.equal(s.message, "El juego mandó un mensaje que el servidor no reconoce.");
  });

  it("un frame válido llega al router, y la respuesta vuelve a ESTE socket", async () => {
    const { ctx, subscribers } = makeCtx();
    const { ws, sent } = socketDePrueba();
    atenderConexion(ws, ctx, { entorno: "desarrollo", suscriptores: subscribers });
    ws.emit("message", Buffer.from(JSON.stringify({ type: "ping" })));
    await asentar();
    assert.deepEqual(sent.slice(1), [{ type: "pong" }]);
  });

  it("al cerrarse: deja de recibir difusiones y suelta el mundo si era suyo", () => {
    const { ctx, subscribers } = makeCtx();
    const { ws } = socketDePrueba();
    atenderConexion(ws, ctx, { entorno: "desarrollo", suscriptores: subscribers });
    ctx.subscribe(ws);
    assert.equal(ctx.world.claimForFixture(ws), true);
    ws.emit("close");
    assert.equal(subscribers.has(ws), false);
    const otro = socketDePrueba().ws;
    assert.equal(ctx.world.claimForFixture(otro), true, "el mundo quedó libre para el siguiente");
  });
});
