/** Un viaje por el panel «Salidas» para por ESTADO (#693): `qa/lib/viaje.mjs`.
 *
 *  El sujeto es la parte que se puede ejercer sin navegador: la SONDA que corre
 *  en la página (serializada, como la corre Playwright), el diagnóstico
 *  `pasoMuerto` y el CABLEADO de `viajarPorSalidas` sobre un `ctx` de mentira
 *  —qué lanza en cada desenlace y si `ctx.absorbe` lo reconoce—. Está aquí y
 *  no en `qa/` porque el CI no corre la batería de navegador; y es lo que
 *  `data/contract/banco-medido.json` exige a todo `qa/lib/*.mjs`: que lo
 *  importe un test o esté eximido con motivo. Dirección test → banco
 *  (`el-banco-no-entra-en-produccion`, arch-rules.json).
 *
 *  Lo que NO se prueba aquí: que el cliente escriba el ledger cuando el bridge
 *  aborta un viaje, y que la espera pare DE VERDAD en segundos. Eso es conducir
 *  un navegador, un bridge y el motor falso en `mode:"error"`, y lo mide el
 *  guion 168 con su tiempo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Ledger = {
  placeId: string;
  pedido: number;
  encolado: "queued" | "duplicate" | "promoted" | null;
  escenaRecibida: string | null;
  spawnAplicado: { x: number; z: number } | null;
  llegado: number | null;
  error: string | null;
};
type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };
type Foto = { estado: string; tile?: string; scene_id?: string; pos?: { x: number; z: number }; ledger: Ledger };

const viaje = (await import(join(repoRoot, "qa", "lib", "viaje.mjs"))) as {
  sondaDeViaje: (a: { desde: string | null; pedidoPrevio: number | null }) => Foto | null;
  pasoMuerto: (l: Ledger | null, desde: string, pedidoPrevio?: number | null) => string;
  viajarPorSalidas: (ctx: unknown, nombre: string, desc: string) => Promise<Foto>;
  viajarSiSePuede: (ctx: unknown, nombre: string, desc: string, motivo: string) => Promise<{ llegada?: Foto; causa?: string }>;
  pulsarSalida: (ctx: unknown, nombre: string) => Promise<boolean>;
  quienTapaLaSalida: (bs: unknown[], i: number) => { quien: string; texto: string } | null;
  SalidaAusente: new (...a: unknown[]) => Error;
  SalidaTapada: new (...a: unknown[]) => Error & { tapa: { quien: string; texto: string } };
  ViajeRoto: new (...a: unknown[]) => Error & { ledger: Ledger };
};
const esperas = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as {
  EsperaExpirada: new (mensaje: string, id: number, ultimo: unknown) => Error;
  esperaExpiradaEn: (err: unknown) => Error | null;
};
const { sondaDeViaje, pasoMuerto, viajarPorSalidas, viajarSiSePuede, pulsarSalida, quienTapaLaSalida, SalidaAusente, SalidaTapada, ViajeRoto } =
  viaje;

const RECT: Rect = { minX: 32, minZ: -32, maxX: 96, maxZ: 32 };
/** Un ledger con `spawnAplicado` LLEGÓ: el cliente escribe los dos en el
 *  mismo paso (`TravelLedger.llegada`), así que el helper los deriva juntos
 *  salvo que el caso diga otra cosa —la llegada `sin ancla` (llegado sin
 *  spawn) o el spawn sin llegada, que el cliente no puede escribir—. */
const ledger = (extra: Partial<Ledger> = {}): Ledger => ({
  placeId: "molino",
  pedido: 5000,
  encolado: "queued",
  escenaRecibida: "tile_1_0",
  spawnAplicado: null,
  llegado: extra.spawnAplicado ? 7000 : null,
  error: null,
  ...extra,
});
type Pagina = {
  viaje: Ledger | null;
  currentTile: string | null;
  rect: Rect | null;
  pos: { x: number; z: number };
};
const hook = (p: Pagina): Record<string, unknown> => ({
  viaje: p.viaje,
  currentTile: p.currentTile,
  scene: p.rect ? { scene_id: p.currentTile, world_rect: p.rect } : null,
  state: () => ({ pos: p.pos }),
  exits: [{ place_id: "taberna", name: "Taberna del Robledo", sobra: 1 }],
});

/** COMO LA EJECUTA PLAYWRIGHT: serializada con `String(fn)` y evaluada donde
 *  `window` es lo único que existe. Si la sonda arrastrara una referencia a su
 *  módulo, aquí sería `ReferenceError`, que es lo que sería en la página: todos
 *  los sondeos rotos y una expiración de 90 s disfrazada de «no llega». */
const sondaSerializada = new Function("window", "a", `return (${String(sondaDeViaje)})(a);`) as (
  w: unknown,
  a: { desde: string | null; pedidoPrevio: number | null },
) => Foto | null;
const sondar = (p: Pagina, pedidoPrevio: number | null = 1000): Foto | null =>
  sondaSerializada({ __nefan: hook(p) }, { desde: "tile_0_0", pedidoPrevio });

const enDestino = { currentTile: "tile_1_0", rect: RECT, pos: { x: 40, z: 0 } };

describe("sondaDeViaje · para en los dos desenlaces de ESTE viaje, y en ninguno ajeno", () => {
  it("sin ledger, o con el ledger del viaje ANTERIOR, no para: este viaje aún no se ha pedido", () => {
    assert.equal(sondar({ viaje: null, ...enDestino }), null);
    // El caso que las once copias no veían: el ledger anterior sobrevive al
    // episodio, con su `spawnAplicado` y en un tile que no es el de partida.
    const anterior = ledger({ pedido: 1000, spawnAplicado: { x: 40, z: 0 } });
    assert.equal(sondar({ viaje: anterior, ...enDestino }), null, "un viaje anterior LLEGADO no da por llegado este");
    const anteriorRoto = ledger({ pedido: 1000, error: "el viaje de antes" });
    assert.equal(sondar({ viaje: anteriorRoto, ...enDestino }), null, "el error de un viaje anterior no para este");
  });

  it("FALLO: el ledger de este viaje trae `error`, y para aunque el jugador no se haya movido", () => {
    const l = ledger({ error: "fake-ai: TILE_MODE=error — el motor rechazó el tile" });
    const r = sondar({ viaje: l, currentTile: "tile_0_0", rect: null, pos: { x: 0, z: 0 } });
    assert.deepEqual(r, { estado: "fallo", ledger: l });
  });

  it("el error gana al spawn (un ledger se cierra con el primero; si trajera los dos, se dice el fallo)", () => {
    const r = sondar({ viaje: ledger({ error: "roto", spawnAplicado: { x: 40, z: 0 } }), ...enDestino });
    assert.equal(r?.estado, "fallo");
  });

  it("LLEGADO: spawn aplicado + otro tile + el jugador dentro del rect, con la foto de lo que tiene delante", () => {
    const l = ledger({ spawnAplicado: { x: 40, z: 0 } });
    const r = sondar({ viaje: l, ...enDestino });
    assert.deepEqual(r, {
      estado: "llegado",
      tile: "tile_1_0",
      scene_id: "tile_1_0",
      pos: { x: 40, z: 0 },
      rect: RECT,
      exits: [{ place_id: "taberna", name: "Taberna del Robledo" }],
      ledger: l,
    });
  });

  it("no para a MEDIO camino: sin llegada, en el mismo tile, sin escena o fuera del rect", () => {
    const conSpawn = ledger({ spawnAplicado: { x: 40, z: 0 } });
    assert.equal(sondar({ viaje: ledger(), ...enDestino }), null, "la escena llegó pero el ready del viaje no (scene_init antes que ready)");
    // #742: lo que para es la LLEGADA que decide core, no el spawn. Un spawn
    // sin `llegado` —el de un `ready` que no era de este viaje— no para.
    assert.equal(sondar({ viaje: ledger({ spawnAplicado: { x: 40, z: 0 }, llegado: null }), ...enDestino }), null, "spawn sin llegada");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, currentTile: "tile_0_0" }), null, "sigue en el tile de partida");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, currentTile: null }), null, "sin tile activo");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, rect: null }), null, "sin escena activa");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, pos: { x: 10, z: 0 } }), null, "fuera del rect (x < minX)");
    // El rect es semiabierto, como en `formatDToWorld`: el borde máximo es del vecino.
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, pos: { x: 96, z: 0 } }), null, "en maxX ya es el tile vecino");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, pos: { x: 40, z: 32 } }), null, "en maxZ ya es el tile vecino");
    assert.equal(sondar({ viaje: conSpawn, ...enDestino, pos: { x: 40, z: -33 } }), null, "z < minZ");
    assert.notEqual(sondar({ viaje: conSpawn, ...enDestino, pos: { x: 32, z: -32 } }), null, "en minX/minZ está dentro");
  });

  it("sin viaje previo (`pedidoPrevio` null) el primer ledger ya es de ESTE viaje", () => {
    const r = sondar({ viaje: ledger({ error: "x" }), ...enDestino }, null);
    assert.equal(r?.estado, "fallo");
  });

  it("no arrastra ninguna referencia al módulo (si no, Playwright la rompería igual)", () => {
    const fuente = String(sondaDeViaje);
    for (const nombre of ["pasoMuerto", "MS_DEL_TILE", "SELECTOR_DE_SALIDA", "ViajeRoto", "botonesDeSalida"]) {
      assert.doesNotMatch(fuente, new RegExp(`\\b${nombre}\\b`), `sondaDeViaje menciona ${nombre}`);
    }
  });
});

describe("pasoMuerto · nombra el paso del viaje que no ocurrió", () => {
  const casos: { nombre: string; l: Ledger | null; previo?: number | null; espera: RegExp }[] = [
    { nombre: "sin ledger", l: null, espera: /no registró este viaje/ },
    { nombre: "el ledger es del viaje anterior", l: ledger({ pedido: 1000 }), previo: 1000, espera: /no registró este viaje/ },
    { nombre: "abortado", l: ledger({ error: "el motor rechazó el tile" }), espera: /el bridge abortó el viaje: el motor rechazó el tile/ },
    { nombre: "sin acuse ni escena", l: ledger({ encolado: null, escenaRecibida: null }), espera: /no acusó recibo.*intake/ },
    { nombre: "encolado sin escena", l: ledger({ escenaRecibida: null, encolado: "duplicate" }), espera: /encoló el viaje \(duplicate\).*murió en la cola/ },
    { nombre: "acuse ausente pero escena", l: ledger({ encolado: null, spawnAplicado: null }), espera: /no el ready de ESTE viaje/ },
    { nombre: "escena sin la llegada del viaje", l: ledger(), espera: /tile_1_0 llegó, pero no el ready de ESTE viaje/ },
    { nombre: "llegado sin ancla", l: ledger({ llegado: 7000 }), espera: /llegó sin punto de aparición \(sin ancla\).*tile_0_0/ },
    { nombre: "spawn y aun así fuera", l: ledger({ spawnAplicado: { x: 1, z: 2 } }), espera: /\{"x":1,"z":2\}.*tile_0_0/ },
  ];
  for (const c of casos) {
    it(c.nombre, () => assert.match(pasoMuerto(c.l, "tile_0_0", c.previo ?? null), c.espera));
  }
});

/** Un nodo de DOM de mentira: lo justo para `quienTapaLaSalida` (padre,
 *  `contains`, rect, texto). */
type Nodo = {
  id: string;
  className: string;
  tagName: string;
  textContent: string;
  parentElement: Nodo | null;
  contains: (o: Nodo | null) => boolean;
  scrollIntoView: () => void;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  click?: () => void;
};
const nodo = (tagName: string, parentElement: Nodo | null, extra: Partial<Nodo> = {}): Nodo => ({
  id: "",
  className: "",
  tagName,
  textContent: "",
  parentElement,
  contains(o) {
    for (let n = o; n; n = n.parentElement) if (n === this) return true;
    return false;
  },
  scrollIntoView: () => {},
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }),
  ...extra,
});

/** Como la ejecuta Playwright en `$$eval`: serializada, con `document` como
 *  única cosa del mundo. Si arrastrara una referencia al módulo, aquí sería
 *  `ReferenceError`. */
const tapaSerializada = new Function("document", "bs", "i", `return (${String(quienTapaLaSalida)})(bs, i);`) as (
  d: unknown,
  bs: unknown[],
  i: number,
) => { quien: string; texto: string } | null;

/** Un `ctx` de mentira con lo que usa `viajarPorSalidas`: `page.evaluate`,
 *  `page.$$eval` y `page.locator(...).nth(i).click()` contra una página de
 *  objetos, un `waitFor` que devuelve lo que se le diga o lanza la expiración
 *  que se le diga, y un `absorbe` con el contrato del de `sonda.mjs` (solo
 *  traga expiraciones). `tapa`: qué devuelve `elementFromPoint` en vez del
 *  botón — el muro de fallo, su botón «Cerrar» o `null` (fuera de la ventana). */
function ctxDeMentira(
  antes: Pagina,
  waitFor: (desc: string, fn: unknown, ms: number, arg: unknown) => Promise<unknown>,
  trasElClic: Pagina = antes,
  tapa?: (raiz: Nodo, botones: Nodo[]) => Nodo | null,
) {
  const clics: string[] = [];
  let p = antes;
  const raiz = nodo("DIV", null, { id: "ui" });
  const panel = nodo("DIV", raiz, { id: "travel-panel", className: "nf-panel" });
  const botones = ["Molino del Robledo", "Taberna del Robledo"].map((t) =>
    nodo("BUTTON", panel, {
      className: "travel-exit",
      textContent: `  ${t} `,
      click: () => {
        clics.push(t);
        p = trasElClic;
      },
    }),
  );
  const encima = tapa ? tapa(raiz, botones) : undefined;
  const conWindow = <T>(fn: () => T): T => {
    const g = globalThis as { window?: unknown };
    const antes = g.window;
    g.window = { __nefan: hook(p) };
    try {
      return fn();
    } finally {
      g.window = antes;
    }
  };
  const documento = (i: number) => ({ elementFromPoint: () => (encima === undefined ? botones[i] : encima) });
  const ctx = {
    page: {
      evaluate: async (fn: (a?: unknown) => unknown, a?: unknown) => conWindow(() => fn(a)),
      $$eval: async (_sel: string, fn: (bs: unknown[], a?: unknown) => unknown, a?: unknown) =>
        fn === quienTapaLaSalida ? tapaSerializada(documento(a as number), botones, a as number) : fn(botones, a),
      locator: (_sel: string) => ({ nth: (i: number) => ({ click: async () => botones[i].click!() }) }),
    },
    waitFor,
    absorbe: async (_motivo: string, fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch (err) {
        if (!esperas.esperaExpiradaEn(err)) throw err;
        return null;
      }
    },
  };
  return { ctx, clics };
}

/** El muro «No se pudo llegar» como lo pinta el cliente: hermano del panel,
 *  con su título y su «Cerrar» dentro. */
const muroDeFallo = (raiz: Nodo, tocado: "muro" | "cerrar"): Nodo => {
  const muro = nodo("DIV", raiz, {
    id: "narrative-loader",
    className: "visible error",
    textContent: "\n  No se pudo llegar a Molino del Robledo  \n  Cerrar ",
  });
  return tocado === "muro" ? muro : nodo("BUTTON", muro, { id: "narrative-loader-dismiss", textContent: "Cerrar" });
};

describe("viajarPorSalidas · qué lanza en cada desenlace, y a quién le deja tragárselo", () => {
  const partida: Pagina = { viaje: ledger({ pedido: 1000, spawnAplicado: { x: 0, z: 0 } }), currentTile: "tile_0_0", rect: RECT, pos: { x: 0, z: 0 } };

  it("LLEGADO: pulsa el botón que nombra el destino y pasa a la sonda el tile y el `pedido` de ANTES del clic", async () => {
    let vista: unknown = null;
    const foto = { estado: "llegado", tile: "tile_1_0", ledger: ledger({ spawnAplicado: { x: 40, z: 0 } }) };
    const { ctx, clics } = ctxDeMentira(partida, async (desc, fn, ms, arg) => {
      vista = { desc, fn, ms, arg };
      return foto;
    });
    assert.equal(await viajarPorSalidas(ctx, "Molino", "el jugador llega al molino"), foto);
    assert.deepEqual(clics, ["Molino del Robledo"]);
    assert.deepEqual(vista, { desc: "el jugador llega al molino", fn: sondaDeViaje, ms: 90_000, arg: { desde: "tile_0_0", pedidoPrevio: 1000 } });
  });

  it("FALLO: `ViajeRoto` nombrando la causa, y `absorbe` NO lo reconoce (un viaje roto es ✘, no ⊘)", async () => {
    const l = ledger({ error: "fake-ai: TILE_MODE=error — el motor rechazó el tile" });
    const { ctx } = ctxDeMentira(partida, async () => ({ estado: "fallo", ledger: l }));
    const err = await viajarPorSalidas(ctx, "Molino", "ida").then(
      () => assert.fail("tenía que lanzar"),
      (e: unknown) => e,
    );
    assert.ok(err instanceof ViajeRoto);
    assert.match(String((err as Error).message), /^ida: el bridge abortó el viaje: fake-ai: TILE_MODE=error/);
    assert.equal((err as InstanceType<typeof ViajeRoto>).ledger, l);
    assert.equal(esperas.esperaExpiradaEn(err), null, "ctx.absorbe solo traga expiraciones: esto tiene que subir");
  });

  it("EXPIRA: relanza nombrando el paso muerto, con la expiración en la CADENA para que `absorbe` la siga viendo (R4)", async () => {
    const exp = new esperas.EsperaExpirada("timeout esperando: ida", 7, null);
    const colgado: Pagina = { ...partida, viaje: ledger({ pedido: 6000, escenaRecibida: null }) };
    const { ctx } = ctxDeMentira(
      partida,
      async () => {
        throw exp;
      },
      colgado,
    );
    const err = await viajarPorSalidas(ctx, "Molino", "ida").then(
      () => assert.fail("tenía que lanzar"),
      (e: unknown) => e,
    );
    assert.match(String((err as Error).message), /^ida: el bridge encoló el viaje \(queued\) pero nunca difundió la escena/);
    assert.equal(esperas.esperaExpiradaEn(err), exp, "el ⊘ de quien absorbe no se vuelve ✘ por añadir el diagnóstico");
  });

  it("EXPIRA sin que el cliente abriera ledger nuevo: lo dice, en vez de culpar al bridge con el ledger del viaje anterior", async () => {
    const { ctx } = ctxDeMentira(partida, async () => {
      throw new esperas.EsperaExpirada("timeout esperando: ida", 8, null);
    });
    const err = await viajarPorSalidas(ctx, "Molino", "ida").then(
      () => assert.fail("tenía que lanzar"),
      (e: unknown) => e,
    );
    assert.match(String((err as Error).message), /^ida: el cliente no registró este viaje/);
  });

  it("un error que no es expiración sube TAL CUAL (no se disfraza de paso muerto)", async () => {
    const raro = new TypeError("window.__nefan no existe");
    const { ctx } = ctxDeMentira(partida, async () => {
      throw raro;
    });
    await assert.rejects(viajarPorSalidas(ctx, "Molino", "ida"), (e: unknown) => e === raro);
  });

  it("sin la salida en el panel: `SalidaAusente` con lo que SÍ ofrece, y sin pulsar ni esperar nada", async () => {
    let esperó = false;
    const { ctx, clics } = ctxDeMentira(partida, async () => {
      esperó = true;
      return null;
    });
    const err = await viajarPorSalidas(ctx, "Ermita", "ida").then(
      () => assert.fail("tenía que lanzar"),
      (e: unknown) => e,
    );
    assert.ok(err instanceof SalidaAusente);
    assert.match(String((err as Error).message), /no ofrece «Ermita».*Molino del Robledo.*Taberna del Robledo/);
    assert.deepEqual(clics, []);
    assert.equal(esperó, false);
  });
});

describe("pulsarSalida · pulsa como el jugador, o dice qué se lo impide (H1 de la QA de la tanda AP)", () => {
  const partida: Pagina = { viaje: ledger({ pedido: 1000 }), currentTile: "tile_0_0", rect: RECT, pos: { x: 0, z: 0 } };
  const nunca = async () => assert.fail("no debía esperar");

  it("con el botón libre, pulsa con el puntero (`locator.nth(i).click`) el que nombra el destino", async () => {
    const { ctx, clics } = ctxDeMentira(partida, nunca);
    assert.equal(await pulsarSalida(ctx, "Taberna"), true);
    assert.deepEqual(clics, ["Taberna del Robledo"]);
  });

  it("con el muro de fallo encima: `SalidaTapada` nombrando el muro y su texto, SIN pulsar", async () => {
    const { ctx, clics } = ctxDeMentira(partida, nunca, partida, (r) => muroDeFallo(r, "muro"));
    const err = await pulsarSalida(ctx, "Molino").then(
      () => assert.fail("tenía que lanzar"),
      (e: unknown) => e,
    );
    assert.ok(err instanceof SalidaTapada);
    assert.equal((err as InstanceType<typeof SalidaTapada>).tapa.quien, "#narrative-loader.visible.error");
    assert.match(String((err as Error).message), /«Molino».*TAPADO.*#narrative-loader\.visible\.error.*No se pudo llegar a Molino del Robledo Cerrar/);
    assert.deepEqual(clics, []);
    assert.equal(esperas.esperaExpiradaEn(err), null, "ctx.absorbe no lo traga: una salida tapada es ✘, no ⊘");
  });

  it("si lo tocado es el «Cerrar» del muro, nombra la CAPA (el muro), no el botón de dentro", async () => {
    const { ctx } = ctxDeMentira(partida, nunca, partida, (r) => muroDeFallo(r, "cerrar"));
    const err = (await pulsarSalida(ctx, "Molino").catch((e: unknown) => e)) as InstanceType<typeof SalidaTapada>;
    assert.equal(err.tapa.quien, "#narrative-loader.visible.error");
  });

  it("si el centro cae fuera de la ventana (nada bajo el punto), también lo dice", async () => {
    const { ctx, clics } = ctxDeMentira(partida, nunca, partida, () => null);
    await assert.rejects(pulsarSalida(ctx, "Molino"), /TAPADO: bajo su centro hay nada \(el centro del botón cae fuera de la ventana\)/);
    assert.deepEqual(clics, []);
  });

  it("un hijo del propio botón bajo el punto NO es tapa", async () => {
    // El `elementFromPoint` de verdad devuelve el nodo más profundo: un <span>
    // dentro del botón es el botón.
    const { ctx, clics } = ctxDeMentira(partida, nunca, partida, (_r, bs) => nodo("SPAN", bs[0]));
    assert.equal(await pulsarSalida(ctx, "Molino"), true);
    assert.deepEqual(clics, ["Molino del Robledo"]);
  });

  it("dentro de `viajarPorSalidas`, la tapa sube antes de esperar nada", async () => {
    let esperó = false;
    const { ctx } = ctxDeMentira(
      partida,
      async () => {
        esperó = true;
        return null;
      },
      partida,
      (r) => muroDeFallo(r, "muro"),
    );
    await assert.rejects(viajarPorSalidas(ctx, "Molino", "ida"), (e: unknown) => e instanceof SalidaTapada);
    assert.equal(esperó, false);
  });
});

describe("viajarSiSePuede · el ⊘ de 49 y 60 lleva la CAUSA (H7 de la QA de la tanda AP)", () => {
  const partida: Pagina = { viaje: ledger({ pedido: 1000, spawnAplicado: { x: 0, z: 0 } }), currentTile: "tile_0_0", rect: RECT, pos: { x: 0, z: 0 } };
  const motivo = "si el viaje no llega, el llamante declara sinMedir con la causa";

  it("llegado: `{llegada}` con la foto", async () => {
    const foto = { estado: "llegado", tile: "tile_1_0", ledger: ledger() };
    const { ctx } = ctxDeMentira(partida, async () => foto);
    assert.deepEqual(await viajarSiSePuede(ctx, "Molino", "ida", motivo), { llegada: foto });
  });

  it("EXPIRA: `{causa}` con el paso muerto, no un null mudo", async () => {
    const colgado: Pagina = { ...partida, viaje: ledger({ pedido: 6000, escenaRecibida: null }) };
    const { ctx } = ctxDeMentira(
      partida,
      async () => {
        throw new esperas.EsperaExpirada("timeout esperando: ida", 9, null);
      },
      colgado,
    );
    const r = await viajarSiSePuede(ctx, "Molino", "ida", motivo);
    assert.equal(r.llegada, undefined);
    assert.match(r.causa ?? "", /^ida: el bridge encoló el viaje \(queued\) pero nunca difundió la escena/);
  });

  it("sin la salida: `{causa}` con lo que el panel SÍ ofrece", async () => {
    const { ctx } = ctxDeMentira(partida, nunca);
    const r = await viajarSiSePuede(ctx, "Ermita", "ida", motivo);
    assert.match(r.causa ?? "", /no ofrece «Ermita».*Molino del Robledo/);
  });

  it("un viaje ROTO y una salida TAPADA suben: son ✘ con causa, no ⊘", async () => {
    const { ctx } = ctxDeMentira(partida, async () => ({ estado: "fallo", ledger: ledger({ error: "x" }) }));
    await assert.rejects(viajarSiSePuede(ctx, "Molino", "ida", motivo), (e: unknown) => e instanceof ViajeRoto);
    const { ctx: tapado } = ctxDeMentira(partida, nunca, partida, (r) => muroDeFallo(r, "muro"));
    await assert.rejects(viajarSiSePuede(tapado, "Molino", "ida", motivo), (e: unknown) => e instanceof SalidaTapada);
  });

  async function nunca(): Promise<never> {
    assert.fail("no debía esperar");
  }
});
