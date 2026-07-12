/** dialogue_choice: consequences, fail-loud (narrative_status: error) y plugin tick.
 *  Partido de bridge-handlers.test.ts (PR-3.3); harness compartido en helpers.ts. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { routeMessage } from "../bridge/router.js";
import type { NarrativeAiClient } from "../bridge/context.js";
import type {
  NarrativeEventMessage,
  NarrativeStatusMessage,
  SessionStartedMessage,
  } from "../src/protocol/messages.js";
import type { Consequence } from "../src/narrative/types.js";
import {
  makeCtx,
  makeSocket,
  } from "./helpers.js";

describe("bridge dialogue_choice", () => {
  async function startSession(ctxBundle: ReturnType<typeof makeCtx>) {
    const { socket, sent } = makeSocket();
    await routeMessage(
      { type: "start_session", requestId: "r1", gameId: "plugtest" },
      socket,
      ctxBundle.ctx,
    );
    assert.equal((sent[0] as SessionStartedMessage).ok, true);
    return { socket, sent };
  }

  it("aplica las consequences y difunde narrative_event (incluido plugin tick)", async () => {
    const bundle = makeCtx();
    await startSession(bundle);
    const { ctx, broadcasts, narrative } = bundle;
    const counterId = [...ctx.activePlugins.entries()].find(
      ([, m]) => m.name === "test_counter",
    )![0];
    const consequences: Consequence[] = [
      { type: "story_update", delta: "El tabernero asiente." },
      { type: "plugin_event", plugin_id: counterId, event_type: "counter_inc", payload: {} },
    ];
    (bundle.ctx as { aiClient: NarrativeAiClient }).aiClient = {
      ...ctx.aiClient,
      reportPlayerChoice: async () => ({ ok: true, consequences }),
    };

    const before = broadcasts.length;
    const { socket } = makeSocket();
    await routeMessage(
      {
        type: "dialogue_choice",
        eventId: "ignored",
        choiceIndex: 0,
        speaker: "Boris",
        chosenText: "¿Qué vendes?",
      },
      socket,
      ctx,
    );
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event, "narrative_event difundido");
    assert.deepEqual(event.consequences, consequences);
    // story_update aplicado al estado + plugin tick aplicado al slice.
    assert.ok(narrative.story_so_far.includes("El tabernero asiente."));
    assert.deepEqual(narrative.getPluginRecord(counterId)?.slice, { count: 1 });
    assert.ok(event.effects.some((e) => e.kind === "plugin_applied"));
  });

  it("difunde narrative_status: error si el motor narrativo falla (fail-loud)", async () => {
    const bundle = makeCtx({
      ai: { reportPlayerChoice: async () => ({ ok: false, error: "timeout esperando a Claude" }) },
    });
    await startSession(bundle);
    const { ctx, broadcasts } = bundle;
    const before = broadcasts.length;
    const { socket } = makeSocket();
    await routeMessage(
      {
        type: "dialogue_choice",
        eventId: "ignored",
        choiceIndex: 1,
        speaker: "Boris",
        chosenText: "Adiós",
      },
      socket,
      ctx,
    );
    const err = broadcasts
      .slice(before)
      .find(
        (m): m is NarrativeStatusMessage =>
          m.type === "narrative_status" && m.phase === "error" && m.kind === "consequences",
      );
    assert.ok(err, "narrative_status error difundido");
    assert.ok(err.message?.includes("timeout esperando a Claude"));
  });

  it("interact_entity pasa por el mismo ciclo y difunde narrative_event", async () => {
    const bundle = makeCtx({
      ai: {
        reportPlayerChoice: async () => ({
          ok: true,
          consequences: [
            { type: "dialogue", speaker: "Boris", text: "¡Bienvenido!", choices: ["Hola"] },
          ] as Consequence[],
        }),
      },
    });
    await startSession(bundle);
    const { ctx, broadcasts, aiCalls } = bundle;
    const before = broadcasts.length;
    const { socket } = makeSocket();
    await routeMessage(
      { type: "interact_entity", entityId: "boris", entityName: "Boris" },
      socket,
      ctx,
    );
    // El saludo va en primera persona como free_text (framing del prompt).
    const call = aiCalls.choice.at(-1) as { freeText: string; speaker: string };
    assert.equal(call.speaker, "Boris");
    assert.ok(call.freeText.length > 0);
    const event = broadcasts
      .slice(before)
      .find((m): m is NarrativeEventMessage => m.type === "narrative_event");
    assert.ok(event);
    assert.equal(event.consequences[0].type, "dialogue");
  });
});

