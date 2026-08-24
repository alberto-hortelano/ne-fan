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
import { capturarLogDelBridge, fakeBootstrapTile, makeCtx, makeSocket, waitFor } from "./helpers.js";

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
    // (los dos bootstraps son el tile (0,0), así que lo que distingue a una
    // respuesta de la otra es su descripción, no el id.)
    //
    // El motivo del descarte ya NO viaja por el wire: lo que el jugador lee es
    // una frase traducida (#180) y el diagnóstico se queda en el log del
    // bridge. La afirmación no se relaja, cambia de canal: se espera el error
    // por el wire y se comprueba el POR QUÉ en el log.
    const log = capturarLogDelBridge();
    try {
      resolvers[0]!({ ok: true, scene: fakeBootstrapTile({ scene_description: "vieja" }) });
      await waitFor(() =>
        broadcasts.some(
          (m): m is NarrativeStatusMessage =>
            m.type === "narrative_status" && m.phase === "error" && m.kind === "tile",
        ),
      );
      assert.ok(
        log.lineas.some((l) => /descartado sin escribir/.test(l)),
        `el bridge no registró el descarte: ${JSON.stringify(log.lineas)}`,
      );
    } finally {
      log.soltar();
    }
    assert.equal(Object.keys(narrative.scenes_loaded).length, 0, "nada de A escrito en B");

    // …y el bootstrap de B (encolado detrás, serialización intacta) corre y
    // SÍ escribe en B.
    await waitFor(() => aiCalls.scene.length === 2);
    resolvers[1]!({ ok: true, scene: fakeBootstrapTile({ scene_description: "nueva" }) });
    await waitFor(() =>
      broadcasts.some((m) => m.type === "narrative_status" && m.phase === "ready"),
    );
    assert.equal(narrative.session_id, sessionB);
    assert.equal(
      (narrative.scenes_loaded["tile_0_0"]?.scene_data as { scene_description?: string })?.scene_description,
      "nueva",
      "la escena registrada es la del bootstrap de B",
    );
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
    resolvers[0]!({ ok: true, scene: fakeBootstrapTile() });
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
    const log = capturarLogDelBridge();
    try {
      resolveScene({ ok: true, scene: fakeBootstrapTile() });
      await waitFor(() =>
        broadcasts.some(
          (m): m is NarrativeStatusMessage =>
            m.type === "narrative_status" && m.phase === "error" && m.kind === "tile",
        ),
      );
      // El POR QUÉ, en el log del bridge (ver el test de arriba).
      assert.ok(
        log.lineas.some((l) => /descartado sin escribir/.test(l)),
        `el bridge no registró el descarte: ${JSON.stringify(log.lineas)}`,
      );
    } finally {
      log.soltar();
    }
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
