import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AiClient } from "../src/narrative/ai-client.js";
import type { LlmContext } from "../src/narrative/types.js";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return ((url: string, init: RequestInit = {}) => Promise.resolve(handler(url, init))) as typeof fetch;
}

const ctx: LlmContext = {
  session_id: "s",
  game_id: "g",
  world: { name: "", atmosphere: "", style_token: "", active_scene_id: "scene_1" },
  player: {
    level: 1,
    class: "rogue",
    health: 100,
    gold: 0,
    inventory: [],
    appearance: { model_id: "x", skin_path: "" },
    position: [0, 0, 0],
    current_scene_id: "scene_1",
  },
  story_so_far: "",
  current_scene_id: "scene_1",
  entities: [],
  recent_dialogues: [],
  rooms_visited: 1,
};

describe("AiClient", () => {
  it("notifySessionStart posts the right body", async () => {
    let captured: { url?: string; body?: unknown } = {};
    const client = new AiClient({
      baseUrl: "http://test",
      fetchImpl: mockFetch((url, init) => {
        captured.url = url;
        captured.body = init.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    });
    const ok = await client.notifySessionStart("s1", "g1", true);
    assert.equal(ok, true);
    assert.equal(captured.url, "http://test/notify_session");
    assert.deepEqual(captured.body, { session_id: "s1", game_id: "g1", is_resume: true });
  });

  it("reportPlayerChoice returns parsed consequences", async () => {
    const client = new AiClient({
      baseUrl: "http://test",
      fetchImpl: mockFetch(() =>
        new Response(
          JSON.stringify({
            consequences: [{ type: "story_update", delta: "wow" }],
          }),
          { status: 200 },
        ),
      ),
    });
    const cs = await client.reportPlayerChoice({
      eventId: "evt_1",
      speaker: "x",
      chosenText: "ok",
      freeText: "",
      context: ctx,
    });
    assert.equal(cs.length, 1);
    assert.equal(cs[0].type, "story_update");
  });

  it("reportPlayerChoice returns empty array on HTTP error", async () => {
    const client = new AiClient({
      baseUrl: "http://test",
      fetchImpl: mockFetch(() => new Response("boom", { status: 500 })),
    });
    const cs = await client.reportPlayerChoice({
      eventId: "x",
      speaker: "x",
      chosenText: "",
      freeText: "",
      context: ctx,
    });
    assert.deepEqual(cs, []);
  });

  it("generateSprite2D defaults to top_down angle", async () => {
    let body: unknown = null;
    const client = new AiClient({
      baseUrl: "http://test",
      fetchImpl: mockFetch((_url, init) => {
        body = init.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({ hash: "abc", cached: false, sprite_url: "/cache/sprite/abc" }),
          { status: 200 },
        );
      }),
    });
    const r = await client.generateSprite2D({ prompt: "a barrel" });
    assert.equal(r.ok, true);
    assert.equal(r.hash, "abc");
    assert.equal((body as { angle: string }).angle, "top_down");
  });

  it("generateScene returns scene on 200", async () => {
    const client = new AiClient({
      baseUrl: "http://test",
      fetchImpl: mockFetch(() =>
        new Response(JSON.stringify({ room_id: "r1", objects: [] }), { status: 200 }),
      ),
    });
    const r = await client.generateScene(ctx);
    assert.equal(r.ok, true);
    assert.equal((r.scene as { room_id: string }).room_id, "r1");
  });
});
