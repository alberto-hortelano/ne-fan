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
        return { delivered: true as const };
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
    assert.equal(q.enqueue(a.job).status, "queued");
    assert.equal(q.enqueue(b.job).status, "queued");
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
    assert.equal(q.enqueue(makeJob("a", false, ran).job).status, "duplicate", "en vuelo");
    q.enqueue(makeJob("b", false, ran).job);
    assert.equal(q.enqueue(makeJob("b", false, ran).job).status, "duplicate", "en cola");
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
    assert.equal(q.enqueue(makeJob("p2", true, ran).job).status, "promoted");
    // p2 conserva su seq original: entre blockings manda el orden de llegada.
    assert.deepEqual(q.pending, ["p2", "b1", "p1"]);
    first.release();
    await tick();
    assert.equal(ran[1], "p2");
  });

  it("un job que lanza no rompe el drenado", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    q.enqueue({ key: "boom", blocking: true, run: async (): Promise<never> => { throw new Error("kaboom"); } });
    const b = makeJob("after", false, ran);
    q.enqueue(b.job);
    await tick();
    assert.deepEqual(ran, ["after"], "la cola siguió tras el error");
    b.release();
  });
});

describe("SceneGenQueue: promesa de ENTREGA", () => {
  it("la entrega resuelve ok cuando el job termina", async () => {
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const a = makeJob("a", true, ran);
    const { delivery } = q.enqueue(a.job);
    await tick();
    a.release();
    assert.deepEqual(await delivery, { ok: true });
  });

  it("la entrega dice ok:false cuando el job lanza", async () => {
    const q = new SceneGenQueue();
    const { delivery } = q.enqueue({
      key: "boom",
      blocking: true,
      run: async (): Promise<never> => { throw new Error("kaboom"); },
    });
    assert.deepEqual(await delivery, { ok: false, error: "kaboom" });
  });

  it("abandonAll ROMPE la entrega de los jobs que borra, y el duplicado se entera", async () => {
    // La costura exacta del cuelgue del viaje (#210): A encola, B recibe
    // "duplicate" y se queda esperando a que el gemelo entregue, y un
    // takeover (start_session / generate_game) vacía la cola. Antes, el job
    // de A se borraba en SILENCIO: nadie corría, nadie difundía error y los
    // dos callers esperaban para siempre.
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const bloqueo = makeJob("bloqueo", true, ran); // ocupa el "en vuelo"
    q.enqueue(bloqueo.job);
    await tick();

    const a = q.enqueue({ key: "place_forja", blocking: true, run: async () => { ran.push("A"); return { delivered: true as const }; } });
    const b = q.enqueue({ key: "place_forja", blocking: true, run: async () => { ran.push("B"); return { delivered: true as const }; } });
    assert.equal(a.status, "queued");
    assert.equal(b.status, "duplicate");
    assert.deepEqual(q.pending, ["place_forja"]);

    q.abandonAll();
    await tick();

    assert.deepEqual(ran, ["bloqueo"], "el job borrado no llegó a correr");
    assert.deepEqual(q.pending, [], "y tampoco se re-encoló");
    const entregaA = await a.delivery;
    const entregaB = await b.delivery;
    assert.equal(entregaA.ok, false, "el que encoló se entera de que su job murió");
    assert.equal(entregaB.ok, false, "y el DUPLICADO también: esperaba esa misma entrega");
    assert.match(
      entregaA.ok === false ? entregaA.error : "",
      /place_forja/,
      "el motivo nombra la key abandonada",
    );
    bloqueo.release();
  });

  it("un job que lanza algo que NO es un Error entrega igual, sin reventar la cola", async () => {
    // El fail-loud no puede ser el que explote: un `throw null` (o un reject
    // sin valor) tiene que llegar al caller como motivo, no como TypeError
    // dentro del propio manejador de errores.
    const q = new SceneGenQueue();
    const { delivery } = q.enqueue({
      key: "boom",
      blocking: true,
      run: async (): Promise<never> => { throw null; },
    });
    assert.deepEqual(await delivery, { ok: false, error: "null" });
  });

  it("un job que TERMINA sin difundir nada no cuenta como entregado", async () => {
    // La segunda cara del cuelgue del #210: el job corre, vuelve sin excepción
    // y sin haber dicho NADA al cliente (los `return` mudos de "el lugar se
    // realizó mientras esperaba en la cola"). Antes eso resolvía la entrega en
    // verde y el jugador se quedaba con el velo puesto para siempre, con la
    // firma exacta del bug original: sin escena, sin error, sin pista.
    const q = new SceneGenQueue();
    const { delivery } = q.enqueue({
      key: "place_forja",
      blocking: true,
      run: async () => ({ delivered: false as const, motivo: "salí por la puerta de atrás" }),
    });
    assert.deepEqual(await delivery, { ok: false, error: "salí por la puerta de atrás" });
  });

  it("abandonAll sobre una cola inactiva no revienta", async () => {
    // La llaman los takeovers (start_session, resume_session, generate_game)
    // sin mirar si hay algo dentro.
    const q = new SceneGenQueue();
    q.abandonAll();
    assert.equal(q.current, null);
    assert.deepEqual(q.pending, []);
  });

  it("el job en vuelo abandonado sigue entregando a quien lo esperaba", async () => {
    // abandonAll desancla la key del job en vuelo (su await no se puede
    // cancelar) pero NO lo borra: quien se colgó de su entrega sigue
    // enterándose cuando termina, en vez de esperar para siempre.
    const q = new SceneGenQueue();
    const ran: string[] = [];
    const a = makeJob("place_forja", true, ran);
    const { delivery } = q.enqueue(a.job);
    await tick();
    q.abandonAll();
    assert.notEqual(q.current, "place_forja", "la key deja de contar para el dedupe");
    a.release();
    assert.deepEqual(await delivery, { ok: true });
  });
});
