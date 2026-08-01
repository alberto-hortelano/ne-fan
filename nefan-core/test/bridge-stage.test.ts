/** Mundos proscenio en el bridge: bootstrap del plató inicial
 *  (bootstrap-stage), congelado de world.view, gate vector-only y lazy
 *  realize con stage_request. Harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
} from "../src/protocol/messages.js";
import type { NarrativeState } from "../src/narrative/narrative-state.js";
import { makeCtx, makeSocket, waitFor } from "./helpers.js";

/** Plató 16×12 jugable: muros perimetrales, player dentro y una salida por
 *  destino (zona interior junto al muro correspondiente). */
function stageScene(
  placeId: string,
  exits: Array<{ id: string; edge: "north" | "south" | "east" | "west"; to: string }>,
): Record<string, unknown> {
  const cols = 16;
  const rows = 12;
  const terrain = Array.from({ length: rows }, (_, r) =>
    r === 0 || r === rows - 1 ? "W".repeat(cols) : "W" + "g".repeat(cols - 2) + "W",
  );
  const zoneFor = (edge: string): [number, number, number, number] => {
    switch (edge) {
      case "north": return [6, 1, 3, 1];
      case "south": return [6, 10, 3, 1];
      case "east": return [14, 5, 1, 3];
      default: return [1, 5, 1, 3];
    }
  };
  return {
    scene_id: placeId,
    place_id: placeId,
    scene_description: "Un plató de pruebas.",
    size: { cols, rows, meters_per_cell: 0.5 },
    terrain,
    terrain_legend: {},
    entities: [
      { id: "player", kind: "player", name: "Tú", cell: [7, 6], footprint: [1, 1], glyph: "@" },
    ],
    stage: {
      exits: exits.map((e) => ({
        id: e.id,
        edge: e.edge,
        to_place_id: e.to,
        zone: zoneFor(e.edge),
        kind: "door",
        label: `Salida ${e.id}`,
      })),
    },
    ambient_event: "",
  };
}

/** Siembra el world map de la posada como lo haría el motor con las map
 *  tools: dos places enlazados norte⇄sur. */
function seedPosadaMap(narrative: NarrativeState): void {
  narrative.worldMap.upsertPlace({ id: "posada", kind: "interior", parent_id: null, name: "Posada", description: "El salón." });
  narrative.worldMap.upsertPlace({ id: "cocina", kind: "interior", parent_id: null, name: "Cocina", description: "La cocina." });
  narrative.worldMap.addLink({ from: "posada", to: "cocina", kind: "door", bidirectional: true, edge: "north" });
}

describe("bridge — mundos proscenio", () => {
  it("start_session congela view=proscenium y el bootstrap pide un stage plan", async () => {
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          seedPosadaMap(h.narrative);
          return { ok: true, scene: stageScene("posada", [{ id: "n", edge: "north", to: "cocina" }]) };
        },
      },
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "stagetest", renderMode: "vector" },
      socket,
      h.ctx,
    );
    const started = sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true, started.error);
    assert.equal(started.state?.world.view, "proscenium");

    await waitFor(() =>
      h.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    // El bootstrap llevó stage_request (no generate_tile).
    const llmCtx = h.aiCalls.scene[0] as Record<string, unknown>;
    assert.deepEqual(llmCtx.stage_request, { bootstrap: true });
    assert.equal(llmCtx.generate_tile, undefined);
    assert.equal(llmCtx.bootstrap_world_map, true);
    // La escena difundida conserva el bloque stage.
    const ev = h.broadcasts.find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    const scene = ev?.effects[0]?.data?.scene as Record<string, unknown>;
    assert.ok(scene?.stage, "el wire lleva el bloque stage");
    assert.ok(h.narrative.scenes_loaded["posada"], "escena registrada");
  });

  it("proscenium + renderMode image aborta (v1 vector-only, default incluido)", async () => {
    const { ctx } = makeCtx();
    for (const [rid, renderMode] of [["r1", "image"], ["r2", undefined]] as const) {
      const { socket, sent } = makeSocket();
      await routeMessage(
        { type: "start_session", requestId: rid, gameId: "stagetest", renderMode },
        socket,
        ctx,
      );
      const started = sent[0] as SessionStartedMessage;
      assert.equal(started.ok, false);
      assert.match(started.error ?? "", /vector/);
    }
  });

  it("escena sin bloque stage en mundo proscenio ⇒ narrative_status error", async () => {
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          seedPosadaMap(h.narrative);
          const scene = stageScene("posada", [{ id: "n", edge: "north", to: "cocina" }]);
          delete scene.stage;
          return { ok: true, scene };
        },
      },
    });
    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "stagetest", renderMode: "vector" },
      socket,
      h.ctx,
    );
    await waitFor(() =>
      h.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = h.broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /stage/);
  });

  it("stage con exit sin link en el world map ⇒ error de validación", async () => {
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          seedPosadaMap(h.narrative);
          return {
            ok: true,
            scene: stageScene("posada", [{ id: "n", edge: "north", to: "bodega_fantasma" }]),
          };
        },
      },
    });
    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "stagetest", renderMode: "vector" },
      socket,
      h.ctx,
    );
    await waitFor(() =>
      h.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "error"),
    );
    const err = h.broadcasts.find(
      (m): m is NarrativeStatusMessage => m.type === "narrative_status" && m.phase === "error",
    );
    assert.match(err?.message ?? "", /no tiene link|no tiene salida física/);
  });

  it("player_entered_place en mundo proscenio: lazy realize con entry_edge + validación", async () => {
    let call = 0;
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          call++;
          if (call === 1) {
            seedPosadaMap(h.narrative);
            return { ok: true, scene: stageScene("posada", [{ id: "n", edge: "north", to: "cocina" }]) };
          }
          // Realize de la cocina: su salida sur devuelve a la posada.
          return { ok: true, scene: stageScene("cocina", [{ id: "s", edge: "south", to: "posada" }]) };
        },
      },
    });
    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "stagetest", renderMode: "vector" },
      socket,
      h.ctx,
    );
    await waitFor(() =>
      h.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );

    await routeMessage({ type: "player_entered_place", placeId: "cocina" }, socket, h.ctx);
    await waitFor(() => Boolean(h.narrative.scenes_loaded["cocina"]));
    const realizeCtx = h.aiCalls.scene[1] as Record<string, unknown>;
    // La cocina se entra por su borde SUR (el link posada→cocina es north;
    // recorrido al revés desde la cocina, opuesto = south).
    assert.deepEqual(realizeCtx.stage_request, { entry_edge: "south" });
    // Y el resume del save conserva la vista.
    assert.equal(h.narrative.world.view, "proscenium");
  });

  it("resume con view desconocida en el save aborta (fail-loud)", async () => {
    const h = makeCtx({
      ai: {
        generateScene: async () => {
          seedPosadaMap(h.narrative);
          return { ok: true, scene: stageScene("posada", [{ id: "n", edge: "north", to: "cocina" }]) };
        },
      },
    });
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "stagetest", renderMode: "vector" },
      socket,
      h.ctx,
    );
    const sessionId = (sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() =>
      h.broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    h.narrative.world.view = "cinemascope";
    await routeMessage({ type: "save_session", requestId: "r2" }, socket, h.ctx);
    const { socket: s2, sent: sent2 } = makeSocket();
    await routeMessage({ type: "resume_session", requestId: "r3", sessionId }, s2, h.ctx);
    const bad = sent2[0] as SessionStartedMessage;
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? "", /view_unknown: "cinemascope"/);
  });
});
