import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SceneGenQueue } from "../bridge/scene-gen-queue.js";

/** Job controlable: se resuelve a mano para observar la cola en cada estado. */
function makeJob(key: string, blocking: boolean, ran: string[]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return {
    job: {
      key,
      blocking,
      run: async () => {
        ran.push(key);
        await gate;
      },
    },
    release: () => release(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("SceneGenQueue", () => {
  it("despacha en FIFO con un solo job en vuelo", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const a = makeJob("a", false, ran);
    const b = makeJob("b", false, ran);
    assert.equal(q.enqueue(a.job), "queued");
    assert.equal(q.enqueue(b.job), "queued");
    await tick();
    assert.deepEqual(ran, ["a"], "solo el primero corre");
    assert.equal(q.current, "a");
    assert.deepEqual(q.pending, ["b"]);
    a.release();
    await tick();
    assert.deepEqual(ran, ["a", "b"]);
    b.release();
    await tick();
    assert.equal(q.current, null);
  });

  it("dedupe por key (en vuelo y en cola)", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const a = makeJob("a", false, ran);
    q.enqueue(a.job);
    await tick();
    assert.equal(q.enqueue(makeJob("a", false, ran).job), "duplicate", "en vuelo");
    q.enqueue(makeJob("b", false, ran).job);
    assert.equal(q.enqueue(makeJob("b", false, ran).job), "duplicate", "en cola");
    a.release();
    await tick();
    assert.deepEqual(ran.filter((k) => k === "a").length, 1);
  });

  it("los blocking van antes que los prefetch y la promoción reordena", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const first = makeJob("first", false, ran);
    q.enqueue(first.job); // en vuelo
    await tick();
    q.enqueue(makeJob("p1", false, ran).job);
    q.enqueue(makeJob("p2", false, ran).job);
    q.enqueue(makeJob("b1", true, ran).job);
    assert.deepEqual(q.pending, ["b1", "p1", "p2"], "blocking al frente");
    // p2 se promueve al llegar de nuevo como blocking.
    assert.equal(q.enqueue(makeJob("p2", true, ran).job), "promoted");
    // p2 conserva su seq original: entre blockings manda el orden de llegada.
    assert.deepEqual(q.pending, ["p2", "b1", "p1"]);
    first.release();
    await tick();
    assert.equal(ran[1], "p2");
  });

  it("un job que lanza no rompe el drenado", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    q.enqueue({ key: "boom", blocking: true, run: async () => { throw new Error("kaboom"); } });
    const b = makeJob("after", false, ran);
    q.enqueue(b.job);
    await tick();
    assert.deepEqual(ran, ["after"], "la cola siguió tras el error");
    b.release();
  });
});
