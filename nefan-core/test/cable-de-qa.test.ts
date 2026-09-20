/** `qa/lib/cable.mjs` (#678): mandar un frame por el cable del juego sin
 *  cerrar la boca por la que vuelve el rechazo.
 *
 *  Es la mitad del banco que se puede ejercer sin navegador, y por eso este
 *  test existe y el módulo no entra en `banco-medido.json`: la página falsa de
 *  abajo tiene un `WebSocket` que apunta lo que se le manda y al que el test le
 *  hace decir cosas, y con eso se afirma lo que el módulo promete —que el
 *  socket sigue ABIERTO después de mandar, que solo cuenta como rechazo el
 *  `narrative_status/error`, que lo ilegible se apunta en vez de tirarse, que
 *  cerrar devuelve la lista y olvida el slot, y que la frase nombra el `kind`—.
 *  Lo que NO puede afirmar es que el unicast REAL del intake del bridge llegue
 *  por ese socket: eso lo ejercen el 60 y el 63 con `reason:"nope"`, medido en
 *  su cabecera. La dirección del import es test → banco
 *  (`el-banco-no-entra-en-produccion`). */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Rechazo = { kind: string | null; message: string };
type Ctx = { page: { evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) => Promise<unknown> } };

const mod = (await import(join(repoRoot, "qa", "lib", "cable.mjs"))) as {
  mandarPorElCable: (ctx: Ctx, mensaje: unknown) => Promise<string>;
  cerrarElCable: (ctx: Ctx, id: string) => Promise<Rechazo[]>;
  fraseDeRechazos: (rechazos: unknown) => string;
};
const { mandarPorElCable, cerrarElCable, fraseDeRechazos } = mod;

describe("fraseDeRechazos: el texto que va dentro del ⊘ o del ✘", () => {
  it("con la lista vacía dice que NO rechazó, sin afirmar que aceptara", () => {
    const f = fraseDeRechazos([]);
    assert.match(f, /no rechazó el frame/);
    assert.doesNotMatch(f, /acept/i);
  });

  it("con un rechazo lo nombra con su kind y su mensaje", () => {
    const f = fraseDeRechazos([{ kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." }]);
    assert.match(f, /RECHAZÓ el frame \(protocolo\): El juego mandó un mensaje que el servidor no reconoce\./);
  });

  it("con varios los cuenta y los nombra todos", () => {
    const f = fraseDeRechazos([
      { kind: "protocolo", message: "uno" },
      { kind: "ilegible", message: "dos" },
    ]);
    assert.match(f, /2 veces/);
    assert.match(f, /\(protocolo\): uno/);
    assert.match(f, /\(ilegible\): dos/);
  });

  it("un rechazo sin kind se dice como tal, no se inventa uno", () => {
    assert.match(fraseDeRechazos([{ kind: null, message: "x" }]), /\(sin kind\): x/);
  });

  it("lanza con algo que no es la lista: `undefined` no es «sin rechazos»", () => {
    assert.throws(() => fraseDeRechazos(undefined), /se esperaba la lista de rechazos/);
    assert.throws(() => fraseDeRechazos("protocolo"), /se esperaba la lista de rechazos/);
  });
});

/** Un `WebSocket` de mentira que apunta lo que se le manda y al que el test le
 *  hace decir cosas. Sigue el contrato del de verdad en lo que el módulo toca:
 *  `onopen`/`onmessage`/`onerror` asignables, `send`, `close`, `readyState`. */
class SocketFalso {
  static abiertos: SocketFalso[] = [];
  static abrir = true;
  readonly url: string;
  enviados: string[] = [];
  cerrado = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    SocketFalso.abiertos.push(this);
    // Como el de verdad: abre (o falla) DESPUÉS de que el llamante haya podido
    // colgar sus manejadores.
    queueMicrotask(() => (SocketFalso.abrir ? this.onopen?.() : this.onerror?.()));
  }
  send(data: string): void {
    this.enviados.push(data);
  }
  close(): void {
    this.cerrado = true;
  }
  /** El bridge le dice algo A ESTE socket. */
  dice(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
}

/** El global visto como bolsa de dos ranuras. No se interseca con
 *  `typeof globalThis` a propósito: ahí `WebSocket` ya tiene el tipo del DOM y
 *  el doble no lo cumple (le faltan `CONNECTING`/`OPEN`/…), que es justo lo que
 *  no importa aquí — el módulo solo llama al constructor. */
const g = globalThis as unknown as { window?: unknown; WebSocket?: unknown };
const guardado: { window?: unknown; WebSocket?: unknown } = {};

/** Una página falsa: `evaluate` corre la función AQUÍ, con `window` y
 *  `WebSocket` sustituidos. Lo que el módulo hace dentro del navegador es
 *  exactamente lo que corre. */
const ctx: Ctx = { page: { evaluate: async (fn, arg) => fn(arg) } };

describe("mandarPorElCable / cerrarElCable sobre una página que contesta", () => {
  beforeEach(() => {
    guardado.window = g.window;
    guardado.WebSocket = g.WebSocket;
    SocketFalso.abiertos = [];
    SocketFalso.abrir = true;
    g.WebSocket = SocketFalso;
    g.window = { __nefan: { servicios: () => ({ "game-gateway": "ws://banco-falso/" }) } };
  });
  afterEach(() => {
    g.window = guardado.window;
    g.WebSocket = guardado.WebSocket;
  });

  it("manda el frame por la URL que da el juego y DEJA EL SOCKET ABIERTO", async () => {
    const id = await mandarPorElCable(ctx, { type: "request_tile", tx: 1, ty: 0, reason: "prefetch" });
    assert.equal(SocketFalso.abiertos.length, 1);
    const ws = SocketFalso.abiertos[0];
    assert.equal(ws.url, "ws://banco-falso/");
    assert.deepEqual(ws.enviados.map((s) => JSON.parse(s)), [{ type: "request_tile", tx: 1, ty: 0, reason: "prefetch" }]);
    // Éste es el arreglo: el helper viejo cerraba aquí, en el mismo tick del send.
    assert.equal(ws.cerrado, false, "el cable se cerró al mandar: el unicast del intake no tiene a quién llegar");
    assert.match(id, /^cable-\d+$/);
  });

  it("apunta el unicast de rechazo y solo ése: un frame que no es error no cuenta", async () => {
    const id = await mandarPorElCable(ctx, { type: "request_tile", tx: 1, ty: 0, reason: "nope" });
    const ws = SocketFalso.abiertos[0];
    ws.dice({ type: "narrative_status", phase: "ready", kind: "tile", message: "listo" });
    ws.dice({ type: "sessions_listed", sessions: [] });
    ws.dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." });
    const rechazos = await cerrarElCable(ctx, id);
    assert.deepEqual(rechazos, [{ kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." }]);
    assert.equal(ws.cerrado, true, "cerrar el cable tiene que cerrar el socket");
    assert.match(fraseDeRechazos(rechazos), /RECHAZÓ el frame \(protocolo\): .*no reconoce/);
  });

  it("lo ilegible se APUNTA como rechazo, con los primeros bytes, en vez de tirarse", async () => {
    const id = await mandarPorElCable(ctx, { type: "x" });
    SocketFalso.abiertos[0].dice("esto no es JSON {");
    const rechazos = await cerrarElCable(ctx, id);
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].kind, "ilegible");
    assert.match(rechazos[0].message, /esto no es JSON/);
  });

  it("un error sin kind ni message no se pierde: se dice «sin mensaje»", async () => {
    const id = await mandarPorElCable(ctx, { type: "x" });
    SocketFalso.abiertos[0].dice({ type: "narrative_status", phase: "error" });
    assert.deepEqual(await cerrarElCable(ctx, id), [{ kind: null, message: "sin mensaje" }]);
  });

  it("cerrar devuelve la lista vacía si nadie contestó, y olvida el slot: cerrar dos veces LANZA", async () => {
    const id = await mandarPorElCable(ctx, { type: "x" });
    assert.deepEqual(await cerrarElCable(ctx, id), []);
    await assert.rejects(() => cerrarElCable(ctx, id), /no hay ningún cable «cable-1» abierto/);
  });

  it("cerrar un cable que nunca existió LANZA: no se colapsa con «sin rechazos»", async () => {
    await assert.rejects(() => cerrarElCable(ctx, "cable-99"), /no hay ningún cable «cable-99» abierto/);
  });

  it("dos cables a la vez tienen slots distintos y cada uno recoge lo suyo", async () => {
    const a = await mandarPorElCable(ctx, { type: "a" });
    const b = await mandarPorElCable(ctx, { type: "b" });
    assert.notEqual(a, b);
    SocketFalso.abiertos[1].dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "solo b" });
    assert.deepEqual(await cerrarElCable(ctx, a), []);
    assert.deepEqual(await cerrarElCable(ctx, b), [{ kind: "protocolo", message: "solo b" }]);
  });

  it("si el socket no abre, la promesa se RECHAZA nombrando la URL", async () => {
    SocketFalso.abrir = false;
    await assert.rejects(() => mandarPorElCable(ctx, { type: "x" }), /no se pudo abrir ws:\/\/banco-falso\//);
  });
});
