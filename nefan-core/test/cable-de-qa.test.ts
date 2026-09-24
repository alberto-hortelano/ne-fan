/** `qa/lib/cable.mjs` (#678): mandar un frame por el cable del juego sin
 *  cerrar la boca por la que vuelve el rechazo.
 *
 *  Es la mitad del banco que se puede ejercer sin navegador, y por eso este
 *  test existe y el módulo no entra en `banco-medido.json`: la página falsa de
 *  abajo tiene un `WebSocket` que apunta lo que se le manda y al que el test le
 *  hace decir cosas, y con eso se afirma lo que el módulo promete —que el
 *  socket sigue ABIERTO mientras corre la espera, que solo cuenta como rechazo
 *  el `narrative_status/error`, que lo ilegible se apunta en vez de tirarse,
 *  que al acabar se cierra SIEMPRE y que un fallo de la espera no se pierde ni
 *  se queda sin la frase del bridge—.
 *
 *  Lo que más pesa aquí es lo que NO se puede escribir: `abrirYMandar` y
 *  `cerrar` son privadas, así que no hay forma de cerrar el cable antes de
 *  recoger. Ésa era la forma que la QA de la tanda midió con el bridge real
 *  —`mandarPorElCable` + `cerrarElCable` seguidos, `reason:"nope"` ×5, tres
 *  rechazos perdidos de cinco, intermitente— y la que reproducía #678 a través
 *  del propio helper que lo arreglaba.
 *
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
type Ctx = { page: { evaluate: (fn: (arg: never) => unknown, arg?: unknown) => Promise<unknown> } };

const mod = (await import(join(repoRoot, "qa", "lib", "cable.mjs"))) as {
  porElCable: (ctx: Ctx, mensaje: unknown, espera: (id: string) => unknown) => Promise<{ resultado: unknown; rechazos: Rechazo[] }>;
  rechazosDelCable: (ctx: Ctx, id: string) => Promise<Rechazo[]>;
  porRondasHastaRechazo: (
    ctx: Ctx,
    id: string,
    ronda: () => unknown,
    techoMs: number,
  ) => Promise<{ valor?: unknown; rechazos?: Rechazo[] }>;
  fraseDeRechazos: (rechazos: unknown) => string;
  preguntarPorElCable: (
    ctx: Ctx,
    mensaje: unknown,
    opciones?: { respuesta?: unknown; techoMs?: number; url?: string | null },
  ) => Promise<Record<string, unknown>>;
  reanudarPorElCable: (ctx: Ctx, sessionId: string, requestId?: unknown) => Promise<{ ok: unknown; error: unknown }>;
};
const { porElCable, rechazosDelCable, porRondasHastaRechazo, fraseDeRechazos, preguntarPorElCable, reanudarPorElCable } = mod;

describe("la puerta es UNA: lo que el módulo no deja escribir", () => {
  it("no exporta nada con lo que cerrar el cable a mano", () => {
    // Éste es el arreglo de la QA, y va en un aserto porque un `export` se
    // vuelve a añadir sin querer: con `cerrarElCable` fuera, «mandar y cerrar
    // seguidos» —tres rechazos perdidos de cinco— deja de poder escribirse.
    const nombres = Object.keys(mod).sort();
    assert.deepEqual(nombres, [
      "fraseDeRechazos",
      "porElCable",
      "porRondasHastaRechazo",
      "preguntarPorElCable",
      "reanudarPorElCable",
      "rechazosDelCable",
    ]);
  });
});

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

  it("`null` es «no se pudo leer», que no es «ninguno»", () => {
    const f = fraseDeRechazos(null);
    assert.match(f, /no se pudo leer/);
    assert.doesNotMatch(f, /no rechazó/);
  });

  it("lanza con algo que no es la lista: `undefined` no es «sin rechazos»", () => {
    assert.throws(() => fraseDeRechazos(undefined), /se esperaba la lista de rechazos/);
    assert.throws(() => fraseDeRechazos("protocolo"), /se esperaba la lista de rechazos/);
  });
});

/** Un `WebSocket` de mentira que apunta lo que se le manda y al que el test le
 *  hace decir cosas. Sigue el contrato del de verdad en lo que el módulo toca:
 *  `onopen`/`onmessage`/`onerror` asignables, `send`, `close`. */
class SocketFalso {
  static abiertos: SocketFalso[] = [];
  static abrir = true;
  /** Lo que el bridge contesta EN EL MISMO TICK del `send`, antes de que nadie
   *  haya empezado a esperar: es el camino «la respuesta ya estaba». */
  static contesta: ((msg: Record<string, unknown>) => unknown[]) | null = null;
  readonly url: string;
  enviados: string[] = [];
  cerrado = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    SocketFalso.abiertos.push(this);
    // Como el de verdad: abre (o falla) DESPUÉS de que el llamante haya podido
    // colgar sus manejadores.
    queueMicrotask(() => (SocketFalso.abrir ? this.onopen?.() : this.onerror?.()));
  }
  send(data: string): void {
    this.enviados.push(data);
    for (const f of SocketFalso.contesta?.(JSON.parse(data) as Record<string, unknown>) ?? []) this.dice(f);
  }
  close(): void {
    this.cerrado = true;
  }
  /** El bridge cierra ESTE socket sin que el cliente lo pida. */
  cierraElBridge(): void {
    this.onclose?.();
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
const ctx: Ctx = { page: { evaluate: async (fn, arg) => fn(arg as never) } };
const soloElSocket = (): SocketFalso => SocketFalso.abiertos[0];

describe("porElCable sobre una página que contesta", () => {
  beforeEach(() => {
    guardado.window = g.window;
    guardado.WebSocket = g.WebSocket;
    SocketFalso.abiertos = [];
    SocketFalso.abrir = true;
    SocketFalso.contesta = null;
    g.WebSocket = SocketFalso;
    g.window = { __nefan: { servicios: () => ({ "game-gateway": "ws://banco-falso/" }) } };
  });
  afterEach(() => {
    g.window = guardado.window;
    g.WebSocket = guardado.WebSocket;
  });

  it("manda el frame por la URL que da el juego y el socket SIGUE ABIERTO durante la espera", async () => {
    let abiertoMientrasEsperaba: boolean | null = null;
    const { rechazos } = await porElCable(ctx, { type: "request_tile", tx: 1, ty: 0, reason: "prefetch" }, async (id) => {
      assert.match(id, /^cable-\d+$/);
      abiertoMientrasEsperaba = !soloElSocket().cerrado;
      return "listo";
    });
    const ws = soloElSocket();
    assert.equal(ws.url, "ws://banco-falso/");
    assert.deepEqual(ws.enviados.map((s) => JSON.parse(s)), [{ type: "request_tile", tx: 1, ty: 0, reason: "prefetch" }]);
    // Éste es el arreglo: el helper viejo permitía cerrar en el mismo tick del
    // send, y entonces el unicast del intake no tenía a quién llegar.
    assert.equal(abiertoMientrasEsperaba, true, "el cable estaba cerrado durante la espera");
    assert.equal(ws.cerrado, true, "al acabar la espera el cable tiene que cerrarse");
    assert.deepEqual(rechazos, []);
  });

  it("devuelve lo que devolvió la espera", async () => {
    const { resultado } = await porElCable(ctx, { type: "x" }, async () => ({ tiles: ["tile_0_0", "tile_1_0"] }));
    assert.deepEqual(resultado, { tiles: ["tile_0_0", "tile_1_0"] });
  });

  it("apunta el unicast de rechazo y solo ése: un frame que no es error no cuenta", async () => {
    const { rechazos } = await porElCable(ctx, { type: "request_tile", reason: "nope" }, async () => {
      const ws = soloElSocket();
      ws.dice({ type: "narrative_status", phase: "ready", kind: "tile", message: "listo" });
      ws.dice({ type: "sessions_listed", sessions: [] });
      ws.dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." });
    });
    assert.deepEqual(rechazos, [{ kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." }]);
    assert.match(fraseDeRechazos(rechazos), /RECHAZÓ el frame \(protocolo\): .*no reconoce/);
  });

  it("lo ilegible se APUNTA como rechazo, con los primeros bytes, en vez de tirarse", async () => {
    const { rechazos } = await porElCable(ctx, { type: "x" }, async () => soloElSocket().dice("esto no es JSON {"));
    assert.equal(rechazos.length, 1);
    assert.equal(rechazos[0].kind, "ilegible");
    assert.match(rechazos[0].message, /esto no es JSON/);
  });

  it("un error sin kind ni message no se pierde: se dice «sin mensaje»", async () => {
    const { rechazos } = await porElCable(ctx, { type: "x" }, async () =>
      soloElSocket().dice({ type: "narrative_status", phase: "error" }),
    );
    assert.deepEqual(rechazos, [{ kind: null, message: "sin mensaje" }]);
  });

  it("si la espera LANZA, el fallo se propaga con la frase del bridge PEGADA, y el cable se cierra igual", async () => {
    // El caso del 60: `waitFor` expira mientras el bridge ya había rechazado el
    // frame. Las dos cosas tienen que salir en el mismo mensaje, o el ✘ vuelve
    // a ser «no llegó el tile» sin causa.
    await assert.rejects(
      () =>
        porElCable(ctx, { type: "x" }, async () => {
          soloElSocket().dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "no reconoce" });
          throw new Error("timeout esperando tile listo");
        }),
      (e: Error) => {
        assert.match(e.message, /timeout esperando tile listo/);
        assert.match(e.message, /RECHAZÓ el frame \(protocolo\): no reconoce/);
        return true;
      },
    );
    assert.equal(soloElSocket().cerrado, true, "un fallo de la espera no puede dejar el cable abierto");
  });

  it("un fallo de la espera NO lo enmascara un fallo al cerrar: manda el original y el otro se añade", async () => {
    // Un `finally` que lanza encima de otra excepción se lleva por delante la
    // que importaba. Aquí el cierre falla porque la página perdió el slot.
    await assert.rejects(
      () =>
        porElCable(ctx, { type: "x" }, async () => {
          (g.window as { __qaCables?: unknown }).__qaCables = { n: 0, abiertos: {} };
          throw new Error("lo que de verdad pasó");
        }),
      (e: Error) => {
        assert.match(e.message, /lo que de verdad pasó/);
        assert.match(e.message, /al cerrar el cable: no hay ningún cable/);
        return true;
      },
    );
  });

  it("la espera es OBLIGATORIA: sin ella lanza diciendo por qué existe", async () => {
    await assert.rejects(() => porElCable(ctx, { type: "x" }, undefined as never), /la espera es OBLIGATORIA/);
    assert.deepEqual(SocketFalso.abiertos, [], "ni siquiera llegó a abrir el socket");
  });

  it("si el socket no abre, la promesa se RECHAZA nombrando la URL", async () => {
    SocketFalso.abrir = false;
    await assert.rejects(() => porElCable(ctx, { type: "x" }, async () => null), /no se pudo abrir ws:\/\/banco-falso\//);
  });

  it("dos cables a la vez tienen slots distintos y cada uno recoge lo suyo", async () => {
    let deA: Rechazo[] = [];
    const { rechazos: deB } = await porElCable(ctx, { type: "b" }, async (idB) => {
      const r = await porElCable(ctx, { type: "a" }, async (idA) => {
        assert.notEqual(idA, idB);
        SocketFalso.abiertos[1].dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "solo a" });
      });
      deA = r.rechazos;
    });
    assert.deepEqual(deA, [{ kind: "protocolo", message: "solo a" }]);
    assert.deepEqual(deB, []);
  });

  it("`rechazosDelCable` mira sin cerrar, que es la segunda salida de quien espera fuera de la página", async () => {
    await porElCable(ctx, { type: "x" }, async (id) => {
      assert.deepEqual(await rechazosDelCable(ctx, id), []);
      soloElSocket().dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "ya" });
      assert.deepEqual(await rechazosDelCable(ctx, id), [{ kind: "protocolo", message: "ya" }]);
      assert.equal(soloElSocket().cerrado, false, "mirar los rechazos no puede cerrar el cable");
    });
  });
});

describe("porRondasHastaRechazo: la segunda salida de quien espera FUERA de la página", () => {
  beforeEach(() => {
    guardado.window = g.window;
    guardado.WebSocket = g.WebSocket;
    SocketFalso.abiertos = [];
    SocketFalso.abrir = true;
    SocketFalso.contesta = null;
    g.WebSocket = SocketFalso;
    g.window = { __nefan: { servicios: () => ({ "game-gateway": "ws://banco-falso/" }) } };
  });
  afterEach(() => {
    g.window = guardado.window;
    g.WebSocket = guardado.WebSocket;
  });

  it("devuelve el valor en cuanto una ronda lo da, sin mirar más", async () => {
    let rondas = 0;
    const { resultado } = await porElCable(ctx, { type: "x" }, (id) =>
      porRondasHastaRechazo(ctx, id, () => (++rondas === 3 ? ["tile_0_0", "tile_1_0"] : null), 60_000),
    );
    assert.deepEqual(resultado, { valor: ["tile_0_0", "tile_1_0"] });
    assert.equal(rondas, 3);
  });

  it("CORTA en cuanto el bridge rechaza, sin quemar el techo: es el caso del 63", async () => {
    // Lo que costaba no tenerlo: 71 s para decir al final algo que ya se sabía
    // a los pocos milisegundos.
    let rondas = 0;
    const { resultado } = await porElCable(ctx, { type: "x" }, (id) =>
      porRondasHastaRechazo(
        ctx,
        id,
        () => {
          rondas++;
          soloElSocket().dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "no reconoce" });
          return null;
        },
        60_000,
      ),
    );
    assert.deepEqual(resultado, { rechazos: [{ kind: "protocolo", message: "no reconoce" }] });
    assert.equal(rondas, 1, "siguió dando rondas después del rechazo");
  });

  it("con el techo agotado y sin rechazo devuelve `{}`: ni valor ni causa, que es la verdad", async () => {
    const { resultado } = await porElCable(ctx, { type: "x" }, (id) => porRondasHastaRechazo(ctx, id, () => null, 0));
    assert.deepEqual(resultado, {});
  });

  it("da SIEMPRE al menos una ronda, aunque el techo sea 0", async () => {
    let rondas = 0;
    await porElCable(ctx, { type: "x" }, (id) =>
      porRondasHastaRechazo(
        ctx,
        id,
        () => {
          rondas++;
          return null;
        },
        0,
      ),
    );
    assert.equal(rondas, 1);
  });
});

/** Cuando el helper YA está esperando (el cable tiene quien le avise), el
 *  socket falso dice lo que se le pida. Así se ejerce el camino del aviso, no
 *  solo el de «la respuesta ya estaba». */
async function cuandoEspere(hacer: (ws: SocketFalso) => void): Promise<void> {
  const cables = () => (g.window as { __qaCables?: { abiertos: Record<string, { avisa: unknown }> } }).__qaCables;
  for (let i = 0; i < 200; i++) {
    const abiertos = Object.values(cables()?.abiertos ?? {});
    if (abiertos.length && abiertos.every((c) => c.avisa)) {
      hacer(soloElSocket());
      return;
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("el helper nunca se puso a esperar");
}

describe("preguntarPorElCable: mando un frame y espero SU respuesta, o el rechazo (#694)", () => {
  beforeEach(() => {
    guardado.window = g.window;
    guardado.WebSocket = g.WebSocket;
    SocketFalso.abiertos = [];
    SocketFalso.abrir = true;
    SocketFalso.contesta = null;
    g.WebSocket = SocketFalso;
    g.window = { __nefan: { servicios: () => ({ "game-gateway": "ws://banco-falso/" }) } };
  });
  afterEach(() => {
    g.window = guardado.window;
    g.WebSocket = guardado.WebSocket;
  });

  const LISTAR = { type: "list_sessions", requestId: "qa-t" };

  it("devuelve el frame de respuesta ENTERO, manda el mensaje tal cual y cierra el cable", async () => {
    const p = preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed" });
    await cuandoEspere((ws) => ws.dice({ type: "sessions_listed", requestId: "qa-t", sessions: [{ session_id: "a" }] }));
    assert.deepEqual(await p, { type: "sessions_listed", requestId: "qa-t", sessions: [{ session_id: "a" }] });
    const ws = soloElSocket();
    assert.deepEqual(ws.enviados.map((x) => JSON.parse(x)), [LISTAR]);
    assert.equal(ws.url, "ws://banco-falso/");
    assert.equal(ws.cerrado, true, "al tener la respuesta el cable tiene que cerrarse");
  });

  it("la respuesta que llega en el mismo tick del `send` también vale (no se pierde por llegar antes de esperar)", async () => {
    SocketFalso.contesta = (m) => [{ type: "sessions_listed", requestId: m.requestId, sessions: [] }];
    assert.deepEqual(await preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed" }), {
      type: "sessions_listed",
      requestId: "qa-t",
      sessions: [],
    });
  });

  it("casa por tipo Y por `requestId`: el mismo tipo con otro `requestId` y los demás frames no son la respuesta", async () => {
    // El caso de un cable suscrito: un `session_started` difundido a otro.
    const p = preguntarPorElCable(ctx, { type: "resume_session", sessionId: "s", requestId: "qa-mio" }, { respuesta: "session_started" });
    await cuandoEspere((ws) => {
      ws.dice({ type: "session_started", requestId: "qa-otro", ok: true });
      ws.dice({ type: "narrative_status", phase: "ready", kind: "tile" });
      ws.dice({ type: "state_update", tick: 3 });
      ws.dice({ type: "session_started", requestId: "qa-mio", ok: false, error: "no vale" });
    });
    assert.deepEqual(await p, { type: "session_started", requestId: "qa-mio", ok: false, error: "no vale" });
  });

  it("el rechazo del intake (`protocolo`) LANZA en cuanto llega, nombrándolo, y no a los 60 s del techo", async () => {
    const t0 = Date.now();
    const p = preguntarPorElCable(ctx, { type: "request_tile", reason: "nope", requestId: "qa-n" }, { respuesta: "tile_ready", techoMs: 60_000 });
    await cuandoEspere((ws) =>
      ws.dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "El juego mandó un mensaje que el servidor no reconoce." }),
    );
    await assert.rejects(p, (e: Error) => {
      assert.match(e.message, /`request_tile` \(qa-n\) esperando `tile_ready`/);
      assert.match(e.message, /RECHAZÓ el frame \(protocolo\): El juego mandó un mensaje que el servidor no reconoce\./);
      return true;
    });
    assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms: esperó al techo en vez de parar`);
    assert.equal(soloElSocket().cerrado, true, "un rechazo no puede dejar el cable abierto");
  });

  it("un frame ILEGIBLE también para: podría ser la propia respuesta", async () => {
    const p = preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed", techoMs: 60_000 });
    await cuandoEspere((ws) => ws.dice("{ roto"));
    await assert.rejects(p, /RECHAZÓ el frame \(ilegible\): .*\{ roto/);
  });

  it("un error de OTRO kind (difundido a un cable suscrito) NO para la espera, y la respuesta sigue valiendo", async () => {
    const p = preguntarPorElCable(ctx, { type: "start_session", gameId: "g", requestId: "qa-s" }, { respuesta: "session_started", techoMs: 60_000 });
    await cuandoEspere((ws) => {
      ws.dice({ type: "narrative_status", phase: "error", kind: "tile", message: "no se pudo preparar el tile" });
      ws.dice({ type: "session_started", requestId: "qa-s", ok: true });
    });
    assert.deepEqual(await p, { type: "session_started", requestId: "qa-s", ok: true });
  });

  it("con el techo agotado LANZA diciéndolo, y lista los errores de otros kind que sí llegaron", async () => {
    const p = preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed", techoMs: 30 });
    await cuandoEspere((ws) => ws.dice({ type: "narrative_status", phase: "error", kind: "scene", message: "otro lío" }));
    await assert.rejects(p, (e: Error) => {
      assert.match(e.message, /sin respuesta ni rechazo en 0\.03 s/);
      assert.match(e.message, /otros errores: el bridge RECHAZÓ el frame \(scene\): otro lío/);
      return true;
    });
  });

  it("con el techo agotado y sin nada más, no inventa errores", async () => {
    await assert.rejects(preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed", techoMs: 20 }), (e: Error) => {
      assert.match(e.message, /sin respuesta ni rechazo en 0\.02 s$/);
      return true;
    });
  });

  it("si el bridge CIERRA el socket sin contestar, lanza diciéndolo (lo que antes hacía el `onclose → rej` de cada copia)", async () => {
    const t0 = Date.now();
    const p = preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed", techoMs: 60_000 });
    await cuandoEspere((ws) => ws.cierraElBridge());
    await assert.rejects(p, /`list_sessions` \(qa-t\) esperando `sessions_listed`: el bridge cerró el cable sin contestar$/);
    assert.ok(Date.now() - t0 < 1000);
  });

  it("`url` sustituye a la del juego", async () => {
    SocketFalso.contesta = (m) => [{ type: "sessions_listed", requestId: m.requestId, sessions: [] }];
    await preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed", url: "ws://otro-bridge/" });
    assert.equal(soloElSocket().url, "ws://otro-bridge/");
  });

  it("marca el socket como del banco (`__qaCable`), que es por donde un espía del juego lo reconoce", async () => {
    SocketFalso.contesta = (m) => [{ type: "sessions_listed", requestId: m.requestId, sessions: [] }];
    await preguntarPorElCable(ctx, LISTAR, { respuesta: "sessions_listed" });
    assert.match(String((soloElSocket() as unknown as { __qaCable?: string }).__qaCable), /^cable-\d+$/);
  });

  it("una llamada mal hecha lanza ANTES de abrir nada: sin `respuesta`, o un mensaje sin `requestId`", async () => {
    await assert.rejects(preguntarPorElCable(ctx, LISTAR), /`respuesta` es el TIPO del frame/);
    await assert.rejects(preguntarPorElCable(ctx, LISTAR, { respuesta: "" }), /`respuesta` es el TIPO del frame/);
    await assert.rejects(
      preguntarPorElCable(ctx, { type: "list_sessions" }, { respuesta: "sessions_listed" }),
      /necesita `requestId` para casar su `sessions_listed`/,
    );
    assert.deepEqual(SocketFalso.abiertos, [], "abrió un socket con una llamada que no podía casar nada");
  });

  it("`porElCable` NO cambia: sigue apuntando TODO error con su kind, y no guarda respuesta", async () => {
    // El 60 y el 63 leen esto; el oyente es el mismo que el de arriba.
    const { rechazos } = await porElCable(ctx, { type: "x" }, async () => {
      soloElSocket().dice({ type: "narrative_status", phase: "error", kind: "tile", message: "t" });
      soloElSocket().dice({ type: "narrative_status", phase: "error", kind: "protocolo", message: "p" });
    });
    assert.deepEqual(rechazos, [
      { kind: "tile", message: "t" },
      { kind: "protocolo", message: "p" },
    ]);
  });

  it("`reanudarPorElCable` manda el `resume_session` con el `requestId` del guion y devuelve `{ok, error}` (#739)", async () => {
    // Las ocho copias de `resumePorElCable` (46, 62, 67, 73, 76, 111, 113, 126)
    // eran esto con su `requestId` literal.
    SocketFalso.contesta = (m) => [{ type: "session_started", requestId: m.requestId, ok: false, error: "save_invalido: x" }];
    assert.deepEqual(await reanudarPorElCable(ctx, "s1", "qa-46"), { ok: false, error: "save_invalido: x" });
    assert.deepEqual(JSON.parse(soloElSocket().enviados[0]), { type: "resume_session", sessionId: "s1", requestId: "qa-46" });
    SocketFalso.abiertos = [];
    SocketFalso.contesta = (m) => [{ type: "session_started", requestId: m.requestId, ok: true }];
    assert.deepEqual(await reanudarPorElCable(ctx, "s1", "qa-46"), { ok: true, error: "" }, "sin `error`, cadena vacía");
  });

  it("`reanudarPorElCable` lanza sin `requestId`, antes de abrir, y un rechazo del intake lanza como en `preguntarPorElCable`", async () => {
    await assert.rejects(reanudarPorElCable(ctx, "s1"), /el `requestId` lo pone el guion/);
    await assert.rejects(reanudarPorElCable(ctx, "s1", ""), /el `requestId` lo pone el guion/);
    assert.deepEqual(SocketFalso.abiertos, []);
    SocketFalso.contesta = () => [{ type: "narrative_status", phase: "error", kind: "protocolo", message: "no reconoce" }];
    await assert.rejects(reanudarPorElCable(ctx, "s1", "qa-x"), /RECHAZÓ el frame \(protocolo\): no reconoce/);
  });
});
