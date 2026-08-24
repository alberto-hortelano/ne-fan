/** Routing básico del bridge (ping, list_games, mensajes desconocidos).
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import type {
  ServerMessage,
  StateUpdateMessage,
} from "../src/protocol/messages.js";
import { join } from "node:path";

import {
  capturarLogDelBridge,
  makeCtx,
  makeSocket,
  REAL_GAMES_DIR,
  REAL_STYLES_DIR,
} from "./helpers.js";

describe("bridge routing básico", () => {
  it("ping → pong", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "ping" }, socket, ctx);
    assert.deepEqual(sent, [{ type: "pong" }]);
  });

  it("list_games devuelve los juegos del directorio real", async () => {
    const { ctx } = makeCtx({ gamesDir: REAL_GAMES_DIR, stylesDir: REAL_STYLES_DIR });
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "list_games", requestId: "r1" }, socket, ctx);
    assert.equal(sent.length, 1);
    const msg = sent[0] as Extract<ServerMessage, { type: "games_listed" }>;
    assert.equal(msg.requestId, "r1");
    assert.ok(msg.games.some((g) => g.game_id === "toledo_1200"));
    assert.ok(msg.games.every((g) => g.world_brief.length > 100));
    assert.ok(msg.styles.some((st) => st.style_id === "medievo_crudo"));
  });

  it("list_games con el directorio AUSENTE contesta el motivo, no revienta", async () => {
    // El agujero de fail-loud que midió QA: `listGames` lanza si el directorio
    // no existe y `routeMessage` no envuelve a sus handlers, así que el throw
    // salía como unhandled rejection del proceso, NADIE contestaba y el
    // cliente se comía los 30 s de su timeout de request para acabar diciendo
    // «el servidor no contesta» — plausible y falso.
    const { ctx } = makeCtx({
      gamesDir: join(REAL_GAMES_DIR, "no-existe-este-directorio"),
      stylesDir: REAL_STYLES_DIR,
    });
    const { socket, sent } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await routeMessage({ type: "list_games", requestId: "r1" }, socket, ctx);
    } finally {
      log.soltar();
    }
    assert.equal(sent.length, 1, "el cliente tiene que recibir ALGO");
    const msg = sent[0] as Extract<ServerMessage, { type: "games_listed" }>;
    assert.equal(msg.requestId, "r1");
    assert.match(msg.error ?? "", /games_dir_unreadable/);
    // Y lista vacía, que NO es lo mismo que «no hay mundos»: por eso viaja el
    // `error` — sin él, el cliente diría «no hay ningún mundo instalado».
    assert.deepEqual(msg.games, []);
    assert.deepEqual(msg.styles, []);
    // El diagnóstico con la ruta, en el log del bridge.
    assert.match(log.lineas.join(" | "), /games directory not found/);
  });

  it("load_room resetea al player y proyecta los enemigos", async () => {
    const { ctx, store } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "load_room",
        roomId: "crypt_001",
        enemies: [
          {
            id: "skel_1",
            position: { x: 2, y: 0, z: 2 },
            health: 60,
            weaponId: "short_sword",
            personality: { aggression: 0.5, preferred_attacks: ["quick"], reaction_time: 0.4 },
          },
        ],
      },
      socket,
      ctx,
    );
    const update = sent[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.equal(update.playerHp, 100);
    assert.equal(update.enemies.length, 1);
    assert.equal(update.enemies[0].id, "skel_1");
    assert.equal(store.state.enemies.length, 1);
  });

  it("respawn responde con state_update y HP restaurado", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage({ type: "respawn" }, socket, ctx);
    const update = sent[0] as StateUpdateMessage;
    assert.equal(update.type, "state_update");
    assert.equal(update.playerHp, 100);
  });

  it("input produce un state_update con eventos del tick", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await routeMessage(
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 0, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      socket,
      ctx,
    );
    assert.equal(sent.length, 1);
    assert.equal((sent[0] as StateUpdateMessage).type, "state_update");
  });
});

