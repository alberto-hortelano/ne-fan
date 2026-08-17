/** Guardas anti-takeover de sesión (bug reproducido 2026-08-17): con una
 *  generación en vuelo, NarrativeState es un singleton y un start/resume de
 *  OTRA sesión haría que el job (y las tools de mapa del motor) escribieran
 *  en el save equivocado. Capa 1: start/resume rechazados mientras la cola
 *  genera. Capa 2: el job descarta su resultado si la sesión cambió igual. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import type {
  NarrativeStatusMessage,
  SessionStartedMessage,
} from "../src/protocol/messages.js";
import { makeCtx, makeSocket, waitFor } from "./helpers.js";

type SceneResult = Awaited<ReturnType<import("../bridge/context.js").NarrativeAiClient["generateScene"]>>;

describe("guardas anti-takeover de sesión", () => {
  it("start_session con generación en vuelo la ABANDONA: el resultado tardío se descarta y el bootstrap nuevo corre detrás", async () => {
    const resolvers: Array<(v: SceneResult) => void> = [];
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: {
        generateScene: () =>
          new Promise<SceneResult>((res) => {
            resolvers.push(res);
          }),
      },
    });

    const first = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "s1", gameId: "plugtest" },
      first.socket,
      ctx,
    );
    const started = first.sent[0] as SessionStartedMessage;
    assert.equal(started.ok, true);
    const sessionA = started.sessionId!;
    await waitFor(() => aiCalls.scene.length === 1); // bootstrap A en vuelo

    // Takeover: otra sesión arranca con el bootstrap A en vuelo. Se permite
    // (el título nunca se bloquea) y la generación A queda abandonada.
    const second = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "s2", gameId: "plugtest" },
      second.socket,
      ctx,
    );
    const started2 = second.sent[0] as SessionStartedMessage;
    assert.equal(started2.ok, true);
    const sessionB = started2.sessionId!;
    assert.notEqual(sessionB, sessionA);

    // La escena tardía del bootstrap A llega: se DESCARTA sin escribir en B…
    resolvers[0]!({ ok: true, scene: { room_id: "scene_a", room_description: "vieja" } });
    await waitFor(() =>
      broadcasts.some(
        (m): m is NarrativeStatusMessage =>
          m.type === "narrative_status" &&
          m.phase === "error" &&
          /descartado sin escribir/.test(m.message ?? ""),
      ),
    );
    assert.equal(narrative.scenes_loaded["scene_a"], undefined);

    // …y el bootstrap de B (encolado detrás, serialización intacta) corre y
    // SÍ escribe en B.
    await waitFor(() => aiCalls.scene.length === 2);
    resolvers[1]!({ ok: true, scene: { room_id: "scene_b", room_description: "nueva" } });
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    assert.equal(narrative.session_id, sessionB);
    assert.ok(narrative.scenes_loaded["scene_b"]);
  });

  it("resume de la MISMA sesión durante su bootstrap NO re-encola la generación", async () => {
    const resolvers: Array<(v: SceneResult) => void> = [];
    const { ctx, aiCalls } = makeCtx({
      ai: {
        generateScene: () =>
          new Promise<SceneResult>((res) => {
            resolvers.push(res);
          }),
      },
    });

    const first = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "s1", gameId: "plugtest" },
      first.socket,
      ctx,
    );
    const sessionId = (first.sent[0] as SessionStartedMessage).sessionId!;
    await waitFor(() => aiCalls.scene.length === 1);

    const second = makeSocket();
    await routeMessage(
      { type: "resume_session", requestId: "s2", sessionId },
      second.socket,
      ctx,
    );
    const resumed = second.sent[0] as SessionStartedMessage;
    assert.equal(resumed.ok, true);
    assert.equal(resumed.sessionId, sessionId);
    // Sin segundo generateScene: el bootstrap en vuelo sigue siendo el suyo.
    assert.equal(aiCalls.scene.length, 1);
    resolvers[0]!({ ok: true, scene: { room_id: "scene_test", room_description: "una escena" } });
  });

  it("capa 2: el job de bootstrap DESCARTA la escena si la sesión cambió durante el await", async () => {
    let resolveScene!: (v: SceneResult) => void;
    const pending = new Promise<SceneResult>((res) => {
      resolveScene = res;
    });
    const { ctx, broadcasts, narrative, aiCalls } = makeCtx({
      ai: { generateScene: () => pending },
    });

    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "s1", gameId: "plugtest" },
      socket,
      ctx,
    );
    await waitFor(() => aiCalls.scene.length === 1);

    // Takeover forzado saltándose los handlers (lo que la capa 1 impide por
    // la vía normal): la defensa en profundidad del job debe descartar.
    narrative.startNewSession("plugtest");
    const newSession = narrative.session_id;
    resolveScene({ ok: true, scene: { room_id: "scene_test", room_description: "una escena" } });

    await waitFor(() =>
      broadcasts.some(
        (m): m is NarrativeStatusMessage =>
          m.type === "narrative_status" &&
          m.phase === "error" &&
          /descartado sin escribir/.test(m.message ?? ""),
      ),
    );
    // Nada escrito en la sesión nueva.
    assert.equal(Object.keys(narrative.scenes_loaded).length, 0);
    assert.equal(narrative.session_id, newSession);
  });

  it("capa 2: las consequences de un dialogue_choice se descartan si la sesión cambió durante el await", async () => {
    let resolveChoice!: (v: { ok: true; consequences: [] }) => void;
    const pendingChoice = new Promise<{ ok: true; consequences: [] }>((res) => {
      resolveChoice = res;
    });
    const { ctx, broadcasts, narrative } = makeCtx({
      ai: { reportPlayerChoice: () => pendingChoice },
    });

    const { socket } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "s1", gameId: "plugtest" },
      socket,
      ctx,
    );
    // Esperar a que el bootstrap (fake, inmediato) drene la cola.
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );

    const routed = routeMessage(
      {
        type: "dialogue_choice",
        eventId: "evt_test",
        speaker: "Tabernero",
        chosenText: "Hola",
        choiceIndex: 0,
        freeText: "",
      },
      socket,
      ctx,
    );
    narrative.startNewSession("plugtest"); // takeover forzado durante el await
    resolveChoice({ ok: true, consequences: [] });
    await routed;

    assert.ok(
      broadcasts.some(
        (m) =>
          m.type === "narrative_status" &&
          m.phase === "error" &&
          /descartado sin escribir/.test(m.message ?? ""),
      ),
      "esperaba narrative_status de descarte",
    );
    // El narrative_event del diálogo NO se difundió.
    assert.ok(!broadcasts.some((m) => m.type === "narrative_event" && m.eventId === "evt_test"));
  });
});
