/** Routing básico del bridge (ping, list_games, mensajes desconocidos).
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { respuestaAlFalloDeHandler, routeMessage } from "../bridge/router.js";
import type {
  ClientMessage,
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

  it("un handler que revienta con requestId contesta el frame de error, no el silencio", async () => {
    // El agujero A de la revisión 2026-09-01: `routeMessage` no envolvía a sus
    // handlers, así que un throw no capturado (aquí, el storage de saves
    // ilegible) moría como unhandled rejection, NADIE contestaba y el cliente
    // se comía sus 30 s de timeout. Sin la red de routeMessage este test se
    // queda con `sent` vacío (verificado en rojo antes del fix).
    const { ctx } = makeCtx();
    ctx.sessionStorage.list = async () => {
      throw new Error("disco roto");
    };
    const { socket, sent } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await routeMessage({ type: "list_sessions", requestId: "r9" }, socket, ctx);
    } finally {
      log.soltar();
    }
    assert.equal(sent.length, 1, "el cliente tiene que recibir ALGO");
    const msg = sent[0] as Extract<ServerMessage, { type: "sessions_listed" }>;
    assert.equal(msg.type, "sessions_listed");
    assert.equal(msg.requestId, "r9");
    assert.match(msg.error ?? "", /list_sessions_failed: disco roto/);
    assert.deepEqual(msg.sessions, []);
    // El volcado técnico se queda en el log del bridge, que es donde se depura.
    assert.match(log.lineas.join(" | "), /el handler de 'list_sessions' reventó/);
  });

  it("un fire-and-forget que revienta difunde narrative_status error, no espera infinita", async () => {
    // La otra rama del agujero A: `interact_entity` no lleva requestId, así
    // que sin la red el jugador que pulsa E se quedaba esperando el diálogo
    // PARA SIEMPRE (ni frame, ni error, ni timeout). El throw se fuerza en el
    // aiClient (que en el camino normal devuelve Result, no lanza).
    const { ctx, broadcasts } = makeCtx({
      ai: {
        reportPlayerChoice: async () => {
          throw new Error("fetch failed");
        },
      },
    });
    const { socket } = makeSocket();
    const log = capturarLogDelBridge();
    try {
      await routeMessage(
        { type: "interact_entity", entityId: "npc_1", entityName: "Guardia" },
        socket,
        ctx,
      );
    } finally {
      log.soltar();
    }
    const status = broadcasts.find(
      (m): m is Extract<ServerMessage, { type: "narrative_status" }> =>
        m.type === "narrative_status" && m.phase === "error",
    );
    assert.ok(status, "el error tiene que difundirse al jugador");
    assert.equal(status.kind, "consequences");
    // Traducido para quien juega (motivoParaElJugador), no el volcado técnico.
    assert.match(status.message ?? "", /El motor narrativo no responde/);
    assert.match(log.lineas.join(" | "), /el handler de 'interact_entity' reventó/);
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

describe("respuestaAlFalloDeHandler (la red por mensaje, caso a caso)", () => {
  const boom = new Error("boom");

  it("cada mensaje con requestId recibe SU frame, con el requestId y el motivo", () => {
    // El frame lo elige el TIPO del mensaje: el cliente correlaciona por
    // requestId y castea a la respuesta de ese tipo, así que contestar otro
    // frame resolvería la promesa con un objeto que no es el suyo.
    const casos: Array<{ msg: ClientMessage; frame: ServerMessage["type"] }> = [
      { msg: { type: "list_games", requestId: "r" }, frame: "games_listed" },
      { msg: { type: "list_sessions", requestId: "r" }, frame: "sessions_listed" },
      { msg: { type: "create_game", requestId: "r", draftText: "x" }, frame: "game_created" },
      { msg: { type: "generate_game", requestId: "r", gameId: "g" }, frame: "game_generated" },
      { msg: { type: "get_world_snapshot", requestId: "r", gameId: "g" }, frame: "world_snapshot" },
      {
        msg: { type: "record_style_application", requestId: "r", record: {} },
        frame: "style_application_recorded",
      },
      { msg: { type: "start_session", requestId: "r", gameId: "g" }, frame: "session_started" },
      { msg: { type: "resume_session", requestId: "r", sessionId: "s" }, frame: "session_started" },
      { msg: { type: "delete_session", requestId: "r", sessionId: "s" }, frame: "session_deleted" },
      {
        msg: { type: "set_render_mode", requestId: "r", sessionId: "s", renderMode: "image" },
        frame: "render_mode_set",
      },
    ];
    for (const { msg, frame } of casos) {
      const res = respuestaAlFalloDeHandler(msg, boom);
      assert.equal(res.a, "peticion", msg.type);
      if (res.a !== "peticion") continue;
      const f = res.frame as {
        type: string;
        requestId: string;
        ok?: boolean;
        outcome?: string;
        error?: string;
      };
      assert.equal(f.type, frame, msg.type);
      assert.equal(f.requestId, "r", msg.type);
      if ("ok" in f) assert.equal(f.ok, false, msg.type);
      // `session_deleted` no lleva `ok`: desde #365 es una unión discriminada
      // y el fallo es `outcome:"failed"`. Lo que NO cambia es que TODOS los
      // frames de fallo llevan el motivo técnico con el tipo delante: hasta
      // hoy este era la excepción, y su motivo se quedaba en el log del
      // servidor mientras el jugador miraba la pantalla.
      if (frame === "session_deleted") assert.equal(f.outcome, "failed", msg.type);
      assert.match(f.error ?? "", new RegExp(`${msg.type}_failed: boom`), msg.type);
    }
  });

  it("request_tile difunde kind tile CON coordenadas y edge — el cliente libera el velo", () => {
    const res = respuestaAlFalloDeHandler(
      { type: "request_tile", tx: 2, ty: -1, reason: "blocking", edge: "north" },
      boom,
    );
    assert.equal(res.a, "difusion");
    if (res.a !== "difusion") throw new Error("inalcanzable");
    const f = res.frame;
    assert.equal(f.phase, "error");
    assert.equal(f.kind, "tile");
    assert.deepEqual(f.tile, { tx: 2, ty: -1 });
    assert.equal(f.edge, "north");
  });

  it("player_entered_place difunde kind scene CON placeId — el viaje cierra su «Viajando…»", () => {
    const res = respuestaAlFalloDeHandler({ type: "player_entered_place", placeId: "plaza" }, boom);
    assert.equal(res.a, "difusion");
    if (res.a !== "difusion") throw new Error("inalcanzable");
    const f = res.frame;
    assert.equal(f.phase, "error");
    assert.equal(f.kind, "scene");
    assert.equal(f.placeId, "plaza");
  });

  it("el resto de fire-and-forget difunde kind consequences con el motivo traducido", () => {
    const casos: ClientMessage[] = [
      { type: "dialogue_choice", eventId: "e", choiceIndex: 0, speaker: "G", chosenText: "Hola" },
      { type: "interact_entity", entityId: "n", entityName: "Guardia" },
      {
        type: "input",
        delta: 0.016,
        inputs: {
          playerPosition: { x: 0, y: 0, z: 0 },
          playerForward: { x: 0, y: 0, z: -1 },
          playerMoving: false,
        },
      },
      { type: "load_room", roomId: "r", enemies: [] },
      { type: "respawn" },
      { type: "add_combatants", enemies: [] },
      { type: "ping" },
      { type: "session_entered", sessionId: "s" },
    ];
    for (const msg of casos) {
      const res = respuestaAlFalloDeHandler(msg, new Error("fetch failed"));
      assert.equal(res.a, "difusion", msg.type);
      if (res.a !== "difusion") continue;
      const f = res.frame;
      assert.equal(f.phase, "error", msg.type);
      assert.equal(f.kind, "consequences", msg.type);
      // `motivoParaElJugador` traduce, no vuelca: la prueba usa un error de
      // red porque es la única rama afirmable sin acoplarse a la frase genérica.
      assert.match(f.message ?? "", /El motor narrativo no responde/, msg.type);
    }
  });
});

