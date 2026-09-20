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
};
const { porElCable, rechazosDelCable, porRondasHastaRechazo, fraseDeRechazos } = mod;

describe("la puerta es UNA: lo que el módulo no deja escribir", () => {
  it("no exporta nada con lo que cerrar el cable a mano", () => {
    // Éste es el arreglo de la QA, y va en un aserto porque un `export` se
    // vuelve a añadir sin querer: con `cerrarElCable` fuera, «mandar y cerrar
    // seguidos» —tres rechazos perdidos de cinco— deja de poder escribirse.
    const nombres = Object.keys(mod).sort();
    assert.deepEqual(nombres, ["fraseDeRechazos", "porElCable", "porRondasHastaRechazo", "rechazosDelCable"]);
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
const ctx: Ctx = { page: { evaluate: async (fn, arg) => fn(arg as never) } };
const soloElSocket = (): SocketFalso => SocketFalso.abiertos[0];

describe("porElCable sobre una página que contesta", () => {
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
