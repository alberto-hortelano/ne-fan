/** LO QUE EL BRIDGE MANDA LLEGA AL GAME LOOP, AUNQUE LLEGUEN DOS A LA VEZ, Y
 *  REAPARECER NO MANDA LA POSICIÓN DEL CADÁVER (#613, tanda BN).
 *
 *  Costura entre `BridgeGameClient` y el game loop: el transporte guarda UN
 *  frame pendiente y el loop lo consume una vez por frame de pantalla. Hasta
 *  esta tanda el segundo `state_update` que llegaba entre dos frames PISABA al
 *  primero con sus eventos dentro, y el que se perdía en la práctica era el
 *  `player_respawned`: la respuesta al `respawn` y la del input del mismo
 *  frame llegaban juntas, el panel de combate no se enteraba de que el
 *  jugador había vuelto y el botón «R · reaparecer» no se iba nunca (QA de
 *  BK). Un `died` perdido es peor: el cliente cree vivo a un muerto.
 *
 *  La otra mitad: DÓNDE se reaparece lo decide el sim del bridge y llega en
 *  el frame de respuesta. Entre la R y ese frame, el game loop tiene aún la
 *  posición del cadáver, y un input la mandaría al sim — que la tomaría como
 *  buena. El transporte se calla hasta ENTREGAR el punto. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StateUpdateMessage } from "@nefan-core/src/protocol/messages.js";
import { GameStore } from "@nefan-core/src/store/game-store.js";
import { BridgeGameClient, acumularFrame, type FrameResult } from "../src/net/game-client.js";
import type { BridgeClient } from "../src/net/bridge-client.js";

/** Un BridgeClient de mentira: apunta lo que se manda y deja emitir
 *  `state_update` a mano. No hay red: es la costura, no el socket. */
function bridgeDePrueba() {
  const manejadores = new Map<string, (msg: unknown) => void>();
  const enviados: string[] = [];
  const bridge = {
    isConnected: true,
    on(evento: string, h: (msg: unknown) => void) {
      manejadores.set(evento, h);
    },
    sendInput() {
      enviados.push("input");
    },
    sendRespawn() {
      enviados.push("respawn");
    },
  };
  const cliente = new BridgeGameClient(bridge as unknown as BridgeClient, new GameStore(), {
    idDeLaPartida: () => "s1",
    log: () => {},
  });
  const llega = (m: Partial<StateUpdateMessage>) =>
    manejadores.get("state_update")!({
      type: "state_update",
      delSim: { de: "partida", sessionId: "s1" },
      events: [],
      playerHp: 100,
      playerMaxHp: 100,
      playerWeaponId: "short_sword",
      enemies: [],
      ...m,
    });
  return { cliente, enviados, llega };
}

const inputs = {
  playerPosition: { x: 30, y: 0, z: 30 },
  playerForward: { x: 0, y: 0, z: -1 },
  playerMoving: false,
};

describe("el frame del bridge no se pierde", () => {
  it("dos state_update entre dos frames: se entregan los eventos de LOS DOS, en orden, y el estado del último", () => {
    const { cliente, llega } = bridgeDePrueba();
    llega({ events: [{ type: "died", combatantId: "player" }], playerHp: 0 });
    llega({ events: [{ type: "player_respawned", hp: 100 }], playerHp: 100 });
    const frame = cliente.idle();
    assert.deepEqual(
      frame.events.map((e) => e.type),
      ["died", "player_respawned"],
    );
    assert.equal(frame.playerHp, 100, "el estado es el del último frame");
    assert.deepEqual(cliente.idle().events, [], "consumido: el siguiente frame repite el estado sin eventos");
  });

  it("el punto de reaparición sobrevive a un frame posterior que no lo trae", () => {
    const punto = { x: 1, y: 0, z: 6.5 };
    const conPunto: FrameResult = {
      events: [{ type: "player_respawned", hp: 100 }],
      playerHp: 100,
      playerMaxHp: 100,
      playerWeaponId: "short_sword",
      enemies: [],
    };
    const primero = acumularFrame(null, conPunto, punto);
    const junto = acumularFrame(primero, { ...conPunto, events: [] }, undefined);
    assert.deepEqual(junto.reaparicion, punto);
    assert.equal(acumularFrame(null, conPunto, undefined).reaparicion, undefined, "sin punto no se inventa");
  });
});

describe("caído, el cliente no manda la posición del cadáver", () => {
  it("desde el frame que dice «caído» no sale input; el que trae el punto se entrega sin input, y después sí", () => {
    const { cliente, enviados, llega } = bridgeDePrueba();
    cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, ["input"], "premisa: vivo, cada tick manda input");

    llega({ events: [{ type: "died", combatantId: "player" }], playerHp: 0 });
    cliente.tick(0.016, inputs); // entrega el frame del caído (todavía manda: aún no lo había visto)
    cliente.tick(0.016, inputs);
    cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, ["input", "input"], "caído y visto: el tick se calla");

    cliente.respawn();
    assert.deepEqual(enviados, ["input", "input", "respawn"], "R se manda: en partida es «reintentar»");

    const punto = { x: 0, y: 0, z: 6.5 };
    llega({ events: [{ type: "player_respawned", hp: 100 }], playerHp: 100, reaparicion: punto });
    // Recibido pero NO entregado: el loop aún tiene la posición del cadáver.
    const entregado = cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, ["input", "input", "respawn"], "el tick que ENTREGA el punto tampoco manda input");
    assert.deepEqual(entregado.reaparicion, punto);

    cliente.tick(0.016, { ...inputs, playerPosition: punto });
    assert.deepEqual(enviados, ["input", "input", "respawn", "input"], "entregado el punto, vuelve a mandar");
  });

  it("volver al título deja de estar caído: una partida nueva no nace muda", () => {
    const { cliente, enviados, llega } = bridgeDePrueba();
    llega({ playerHp: 0 });
    cliente.tick(0.016, inputs);
    cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, ["input"], "premisa: caído, se calla");
    cliente.olvidarElUltimoFrame();
    cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, ["input", "input"]);
  });

  it("reanudar caído (empezarPartida(0)) no manda input: el despertar lo pide el bridge al entrar", () => {
    const { cliente, enviados } = bridgeDePrueba();
    cliente.empezarPartida(0);
    cliente.tick(0.016, inputs);
    assert.deepEqual(enviados, []);
  });
});

/** QA H6 de BN: reanudar muerto pintaba 100 PV durante los primeros frames,
 *  los que van del `session_started` al primer `state_update`: el cliente
 *  repetía el neutro de `olvidarElUltimoFrame`. La partida empieza con la vida
 *  del save. */
describe("la partida empieza con la vida del save", () => {
  it("empezarPartida(0): hasta el primer frame del bridge, el jugador está a 0, no a 100", () => {
    const { cliente, llega } = bridgeDePrueba();
    cliente.olvidarElUltimoFrame();
    assert.equal(cliente.idle().playerHp, 100, "premisa: el neutro es el máximo");
    cliente.empezarPartida(0);
    assert.equal(cliente.idle().playerHp, 0);
    assert.equal(cliente.jugadorEnCombate().health, 0, "y es lo que contesta a quién está vivo");
    llega({ playerHp: 37 });
    assert.equal(cliente.idle().playerHp, 37, "el primer frame del bridge manda");
  });
});
