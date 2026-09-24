/** `qa/lib/bridge-desde-node.mjs` (#739): la puerta de NODE al bridge, para
 *  los clientes del banco que no tienen página (los dos candados headless de la
 *  raíz de `qa/` y el `--diag` de `run.mjs`).
 *
 *  Con un `WebSocket` falso en el global, como `cable-de-qa.test.ts` hace con su
 *  página falsa: se afirma lo que la puerta promete —que cualquier rechazo
 *  corta al momento y con su texto, que lo ilegible también, que un `listo` que
 *  lanza es el veredicto, que el techo lista lo recibido, que una llamada mal
 *  hecha no abre nada—. Que el bridge REAL conteste por aquí lo ejercen los dos
 *  candados headless en CI. Dirección test → banco. */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Frame = Record<string, unknown>;
type Espera = { listo?: unknown; ventanaMs?: unknown; techoMs?: unknown };
type Rechazo = Error & { motivo: string; rechazos: { kind: string | null; message: string }[]; recibidos: Frame[]; ms: number | null };

const mod = (await import(join(repoRoot, "qa", "lib", "bridge-desde-node.mjs"))) as {
  conversarConElBridge: (url: string, mensaje: unknown, espera?: Espera) => Promise<{ recibidos: Frame[]; ms: number }>;
  RechazoDelBridge: new (...a: unknown[]) => Rechazo;
};
const { conversarConElBridge, RechazoDelBridge } = mod;

/** El `WebSocket` de mentira: el de `cable-de-qa.test.ts`, con `onclose` que
 *  dispara al cerrar como el de verdad. */
class SocketFalso {
  static abiertos: SocketFalso[] = [];
  static abrir = true;
  static contesta: ((msg: Frame) => unknown[]) | null = null;
  readonly url: string;
  enviados: string[] = [];
  cerrado = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    SocketFalso.abiertos.push(this);
    queueMicrotask(() => (SocketFalso.abrir ? this.onopen?.() : this.onerror?.({ message: "ECONNREFUSED" })));
  }
  send(data: string): void {
    this.enviados.push(data);
    const frames = SocketFalso.contesta?.(JSON.parse(data) as Frame) ?? [];
    // Como la red: la respuesta llega en otra vuelta, no dentro del `send`.
    setTimeout(() => {
      for (const f of frames) this.dice(f);
    }, 0);
  }
  close(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    queueMicrotask(() => this.onclose?.());
  }
  cierraElBridge(): void {
    this.cerrado = true;
    this.onclose?.();
  }
  dice(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
}

const g = globalThis as unknown as { WebSocket?: unknown };
let guardado: unknown;
const URL = "ws://bridge-falso:1/";
const LISTAR = { type: "list_sessions", requestId: "diag" };
const listado = (m: Frame[]) => m.some((x) => x.type === "sessions_listed" && x.requestId === "diag");
const soloElSocket = () => SocketFalso.abiertos[0];

/** Espera a que el socket haya mandado y deja que el test le haga decir cosas. */
async function trasElSend(hacer: (ws: SocketFalso) => void): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (soloElSocket()?.enviados.length) {
      hacer(soloElSocket());
      return;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("el socket nunca mandó");
}

describe("conversarConElBridge: la puerta de Node al bridge (#739)", () => {
  beforeEach(() => {
    guardado = g.WebSocket;
    SocketFalso.abiertos = [];
    SocketFalso.abrir = true;
    SocketFalso.contesta = null;
    g.WebSocket = SocketFalso;
  });
  afterEach(() => {
    g.WebSocket = guardado;
  });

  it("manda el mensaje a la URL, espera a `listo` y devuelve TODO lo recibido, con los ms desde el send; y cierra", async () => {
    SocketFalso.contesta = () => [{ type: "state_update" }, { type: "sessions_listed", requestId: "diag", sessions: [1, 2] }];
    const { recibidos, ms } = await conversarConElBridge(URL, LISTAR, { listo: listado, techoMs: 5000 });
    assert.deepEqual(recibidos, [{ type: "state_update" }, { type: "sessions_listed", requestId: "diag", sessions: [1, 2] }]);
    assert.equal(typeof ms, "number");
    assert.equal(soloElSocket().url, URL);
    assert.deepEqual(soloElSocket().enviados.map((x) => JSON.parse(x)), [LISTAR]);
    assert.equal(soloElSocket().cerrado, true);
  });

  it("un rechazo del intake CORTA al momento con `RechazoDelBridge` motivo `rechazo`, su kind y su texto", async () => {
    const t0 = Date.now();
    const p = conversarConElBridge(URL, LISTAR, { listo: listado, techoMs: 60_000 });
    await trasElSend((ws) => ws.dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "no reconoce" }));
    await assert.rejects(p, (e: Rechazo) => {
      assert.ok(e instanceof RechazoDelBridge);
      assert.equal(e.motivo, "rechazo");
      assert.deepEqual(e.rechazos, [{ kind: "protocolo", message: "no reconoce" }]);
      assert.match(e.message, /`list_sessions` \(diag\): el bridge RECHAZÓ el frame \(protocolo\): no reconoce/);
      return true;
    });
    assert.ok(Date.now() - t0 < 1000, "esperó al techo en vez de cortar");
    assert.equal(soloElSocket().cerrado, true);
  });

  it("un error de OTRO kind también corta: en Node, cualquier rechazo es rojo (era la política de los dos candados)", async () => {
    const p = conversarConElBridge(URL, { type: "start_session", requestId: "s" }, { listo: () => false, techoMs: 60_000 });
    await trasElSend((ws) => ws.dice({ type: "narrative_status", phase: "error", kind: "scene", message: "sin escena" }));
    await assert.rejects(p, (e: Rechazo) => e.motivo === "rechazo" && /\(scene\): sin escena/.test(e.message));
  });

  it("un frame ILEGIBLE corta como rechazo `ilegible`, no lanza dentro del manejador", async () => {
    const p = conversarConElBridge(URL, LISTAR, { listo: listado, techoMs: 60_000 });
    await trasElSend((ws) => ws.dice("{ roto"));
    await assert.rejects(p, (e: Rechazo) => e.motivo === "rechazo" && e.rechazos[0].kind === "ilegible" && /\{ roto/.test(e.message));
  });

  it("si `listo` LANZA, la promesa se rechaza con ESE error tal cual (el `session_started ok:false` del npc)", async () => {
    SocketFalso.contesta = () => [{ type: "session_started", ok: false, error: "no_game" }];
    const p = conversarConElBridge(URL, { type: "start_session", requestId: "s" }, {
      techoMs: 60_000,
      listo: (m: Frame[]) => {
        const u = m.at(-1) as Frame;
        if (u.type === "session_started" && u.ok === false) throw new Error(`session_started ok:false — ${String(u.error)}`);
        return false;
      },
    });
    await assert.rejects(p, (e: Error) => {
      assert.equal(e.message, "session_started ok:false — no_game");
      assert.ok(!(e instanceof RechazoDelBridge), "envolvió el veredicto del llamante");
      return true;
    });
    assert.equal(soloElSocket().cerrado, true);
  });

  it("un JSON `null` no se apila ni despierta a `listo`: `recibidos.at(-1)` es siempre un frame (M-2 de la QA)", async () => {
    const vistos: unknown[] = [];
    const p = conversarConElBridge(URL, LISTAR, {
      techoMs: 60_000,
      listo: (m: Frame[]) => {
        vistos.push(m.at(-1));
        return listado(m);
      },
    });
    await trasElSend((ws) => {
      ws.dice("null");
      ws.dice({ type: "sessions_listed", requestId: "diag", sessions: [] });
    });
    const { recibidos } = await p;
    assert.deepEqual(recibidos, [{ type: "sessions_listed", requestId: "diag", sessions: [] }]);
    assert.deepEqual(vistos, [{ type: "sessions_listed", requestId: "diag", sessions: [] }], "llamó a `listo` por el `null`");
  });

  it("con el techo agotado rechaza con motivo `techo` y lista los tipos recibidos", async () => {
    SocketFalso.contesta = () => [{ type: "session_started", ok: true }, { type: "narrative_status", phase: "generating" }];
    await assert.rejects(conversarConElBridge(URL, LISTAR, { listo: () => false, techoMs: 40 }), (e: Rechazo) => {
      assert.equal(e.motivo, "techo");
      assert.match(e.message, /no llegó a la condición en 0\.04 s; recibidos: session_started, narrative_status\/generating$/);
      assert.equal(e.recibidos.length, 2);
      return true;
    });
  });

  it("`ventanaMs` resuelve con lo recibido pasado ese tiempo, aunque no llegue nada", async () => {
    const { recibidos } = await conversarConElBridge(URL, { type: "session_entered", sessionId: "s" }, { ventanaMs: 20, techoMs: 5000 });
    assert.deepEqual(recibidos, []);
    assert.equal(soloElSocket().cerrado, true);
  });

  it("…pero un rechazo DENTRO de la ventana corta: el frame que no contesta nada sigue pudiendo ser rechazado", async () => {
    const p = conversarConElBridge(URL, { type: "session_entered" }, { ventanaMs: 5000, techoMs: 60_000 });
    await trasElSend((ws) => ws.dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "falta sessionId" }));
    await assert.rejects(p, (e: Rechazo) => e.motivo === "rechazo" && /falta sessionId/.test(e.message));
  });

  it("si el socket no abre, motivo `no-abre` con la URL", async () => {
    SocketFalso.abrir = false;
    await assert.rejects(conversarConElBridge(URL, LISTAR, { listo: listado, techoMs: 5000 }), (e: Rechazo) => {
      assert.equal(e.motivo, "no-abre");
      assert.match(e.message, /no se pudo abrir ws:\/\/bridge-falso:1\/ \(ECONNREFUSED\)/);
      return true;
    });
  });

  it("si el bridge cierra sin acabar la conversación, motivo `cerrado`", async () => {
    const p = conversarConElBridge(URL, LISTAR, { listo: listado, techoMs: 60_000 });
    await trasElSend((ws) => ws.cierraElBridge());
    await assert.rejects(p, (e: Rechazo) => e.motivo === "cerrado" && /cerró el socket antes de acabar/.test(e.message));
  });

  it("una llamada mal hecha lanza ANTES de abrir: sin espera, con las dos, `listo` que no es función o sin techo", async () => {
    await assert.rejects(conversarConElBridge(URL, LISTAR, { techoMs: 1000 }), /la espera es OBLIGATORIA.*ninguna/);
    await assert.rejects(conversarConElBridge(URL, LISTAR, { listo: listado, ventanaMs: 10, techoMs: 1000 }), /las dos/);
    await assert.rejects(conversarConElBridge(URL, LISTAR, { listo: true, techoMs: 1000 }), /`listo` es una función/);
    await assert.rejects(conversarConElBridge(URL, LISTAR, { ventanaMs: -1, techoMs: 1000 }), /`ventanaMs` es un número/);
    await assert.rejects(conversarConElBridge(URL, LISTAR, { listo: listado }), /`techoMs` es obligatorio/);
    await assert.rejects(conversarConElBridge(URL, LISTAR), /la espera es OBLIGATORIA/);
    assert.deepEqual(SocketFalso.abiertos, [], "abrió un socket con una llamada mal hecha");
  });
});
