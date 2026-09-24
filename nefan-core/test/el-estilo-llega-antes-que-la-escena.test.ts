/** #730 — EL ESTILO LLEGA ANTES QUE LA ESCENA, y el bridge es quien lo garantiza.
 *
 *  El atlas del cliente no resuelve nada sin el estilo de la sesión: una
 *  escena instalada ANTES de su estilo se quedaría en clay para siempre,
 *  porque nadie re-dispara el atlas cuando el estilo llega (el issue lo
 *  describía, y es cierto en el código). No se construyó ese re-disparo: el
 *  estado no lo produce el protocolo. El bridge suscribe al socket y le manda
 *  `session_started` —con `world.style_id` dentro— ANTES de difundir ninguna
 *  escena de la sesión, y el cliente fija el estilo en la continuación de esa
 *  respuesta, antes del siguiente mensaje.
 *
 *  Ese orden era un invariante sin candado. Este fichero es el candado de la
 *  mitad del BRIDGE: el índice del `session_started` en lo que recibe el
 *  socket es menor que el de la primera escena, en los tres caminos por los
 *  que una sesión recibe su mundo (bootstrap vivo, snapshot pre-generado y
 *  resume). Y la escena LLEGA a ese socket: si `subscribe` se moviera detrás
 *  de la difusión, el orden «saldría bien» porque la escena no llegaría nunca.
 *
 *  LO QUE NO MIDE: la otra mitad, que el cliente aplique el estilo antes de
 *  procesar el siguiente mensaje WS (`net/narrative-client.ts` → `main.ts`).
 *  Eso es del navegador y lo mide el guion 183. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { WorldMapManager } from "../src/world-map/world-map.js";
import { expandScenePrimitives } from "../src/scene/scene-expand.js";
import { WORLD_SNAPSHOT_SCHEMA_VERSION, writeWorldSnapshot } from "../src/games/world-snapshot.js";
import type { ServerMessage, SessionStartedMessage } from "../src/protocol/messages.js";
import { FIXTURE_GAMES, entrarEnLaPartida, makeCtx, makeSocket, porElBorde, waitFor } from "./helpers.js";

const GAME = "plugtest";

const esEscena = (m: ServerMessage): boolean =>
  m.type === "narrative_event" && m.effects?.some((e) => e.kind === "scene_loaded") === true;

/** El aserto de los tres casos: el socket recibió su `session_started` con
 *  estilo, recibió una escena, y el estilo fue ANTES. */
function afirmarEstiloAntesQueEscena(sent: ServerMessage[]): void {
  const iInicio = sent.findIndex((m) => m.type === "session_started");
  const iEscena = sent.findIndex(esEscena);
  assert.ok(iInicio >= 0, `el socket no recibió session_started: ${sent.map((m) => m.type).join(", ")}`);
  const inicio = sent[iInicio] as SessionStartedMessage;
  assert.equal(inicio.ok, true);
  assert.ok(inicio.state?.world.style_id, "session_started sin world.style_id: el cliente no tiene estilo que fijar");
  assert.ok(iEscena >= 0, "la escena de la sesión no llegó a este socket (¿subscribe detrás de la difusión?)");
  assert.ok(
    iInicio < iEscena,
    `la escena (#${iEscena}) llegó antes que session_started (#${iInicio}): el atlas del cliente ` +
      "se dispararía sin estilo y el tile se quedaría en clay (#730)",
  );
}

describe("#730 · el bridge manda session_started (con el estilo) antes de cualquier escena", () => {
  it("start_session con bootstrap vivo", async () => {
    const { ctx } = makeCtx();
    const { socket, sent } = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
    await waitFor(() => sent.some(esEscena));
    afirmarEstiloAntesQueEscena(sent);
  });

  it("start_session con snapshot de mundo pre-generado", async () => {
    const gamesDir = mkdtempSync(join(tmpdir(), "nefan-estilo-antes-"));
    try {
      cpSync(join(FIXTURE_GAMES, GAME), join(gamesDir, GAME), { recursive: true });
      const worldDocHash = createHash("sha256")
        .update(readFileSync(join(gamesDir, GAME, "world.md"), "utf-8"), "utf-8")
        .digest("hex");
      writeWorldSnapshot(gamesDir, {
        schema_version: WORLD_SNAPSHOT_SCHEMA_VERSION,
        game_id: GAME,
        world_doc_hash: worldDocHash,
        generated_at: "2026-09-24T00:00:00.000Z",
        world_map: new WorldMapManager(WorldMapManager.createEmpty()).serialize(),
        scenes: {
          tile_0_0: expandScenePrimitives({
            scene_id: "tile_0_0",
            scene_description: "Tile de arranque del snapshot",
            tile: { tx: 0, ty: 0 },
            biome: "grass",
            entities: [{ id: "player", kind: "player", name: "Tú", cell: [4, 4], footprint: [1, 1] }],
          }),
        },
        entry_scene_id: "tile_0_0",
      });
      const { ctx, aiCalls } = makeCtx({ gamesDir });
      const { socket, sent } = makeSocket();
      await porElBorde({ type: "start_session", requestId: "r1", gameId: GAME }, socket, ctx);
      assert.equal(aiCalls.scene.length, 0, "el caso tiene que medir el REPLAY del snapshot, no el bootstrap vivo");
      afirmarEstiloAntesQueEscena(sent);
    } finally {
      rmSync(gamesDir, { recursive: true, force: true });
    }
  });

  it("resume_session: ninguna escena antes de session_started, y la activa viaja en su state", async () => {
    const { ctx } = makeCtx();
    const primero = makeSocket();
    await porElBorde({ type: "start_session", requestId: "r1", gameId: GAME }, primero.socket, ctx);
    const sessionId = (primero.sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() => primero.sent.some(esEscena));
    await entrarEnLaPartida(ctx, primero.socket, sessionId);

    const { socket, sent } = makeSocket();
    await porElBorde({ type: "resume_session", requestId: "r2", sessionId }, socket, ctx);
    const iInicio = sent.findIndex((m) => m.type === "session_started");
    assert.equal(iInicio, 0, `lo primero que recibe el socket es session_started: ${sent.map((m) => m.type).join(", ")}`);
    const inicio = sent[0] as SessionStartedMessage;
    assert.ok(inicio.state?.world.style_id, "el resume trae el estilo congelado del save");
    const activa = inicio.state?.world.active_scene_id ?? "";
    assert.ok(activa && inicio.state?.scenes_loaded[activa], "la escena activa viaja DENTRO del session_started");
  });
});
