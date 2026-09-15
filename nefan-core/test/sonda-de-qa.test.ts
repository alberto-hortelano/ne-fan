/** LA SONDA DEL BANCO, Y EL RELOJ CON EL QUE ESPERA (#545).
 *
 *  El sujeto es `qa/lib/sonda.mjs` — `waitFor`, la espera por la que pasan
 *  `holdUntil`, `expectEspera`, `qa/lib/combate.mjs` y `qa/lib/sesion.mjs`, o
 *  sea casi toda la batería. Hasta esta tanda estaba EXENTO en
 *  `data/contract/banco-medido.json` con el motivo «sin página no hay nada que
 *  ejecutar», y eso era cierto de `nefan()` y falso de lo que aquí se mide: la
 *  DECISIÓN de cuándo una espera se ha agotado no necesita un navegador,
 *  necesita una página que conteste. Es donde vive la medida de #545 y no lo
 *  miraba nadie.
 *
 *  LA PÁGINA FALSA NO ES UN DOBLE DE LA SONDA, es un doble del NAVEGADOR:
 *  ejecuta la MISMA función que Playwright enviaría al navegador —incluida la
 *  que lee `window.__nefan.reloj()`, con su `window` de verdad puesto en
 *  `globalThis`—, y lo que se mide es la sonda entera, sin sustituirle una
 *  línea. Lo que no se puede medir aquí es que el navegador serialice esas
 *  funciones, y eso lo ejerce la batería en cada corrida.
 *
 *  Lo que se mide, y las dos direcciones de cada cosa:
 *
 *  1. **Quién decide la expiración.** Con `{sim:N}` manda el reloj de
 *     SIMULACIÓN: la espera aguanta mientras el mundo no avance aunque la pared
 *     corra, y se agota en cuanto el mundo ha corrido sus N segundos aunque la
 *     pared no haya llegado ni cerca del cortafuegos.
 *  2. **El ⊘ y el rojo no se colapsan.** Mismo material —misma página, mismo
 *     reloj parado, mismo cortafuegos— y DOS veredictos distintos según el
 *     presupuesto: con pared, `EsperaExpirada` («no ocurrió»); con sim,
 *     `RelojDeSimNoAvanzo` («sim pedido vs. sim avanzado»). Es lo que prueba
 *     que la sonda mira el dato y no el viento.
 *  3. **El ancla del reloj**: que el cliente siga metiendo su delta topado por
 *     el reloj, y que esa llamada sea ÚNICA en todo el cliente. Sin ella,
 *     «una sola definición de avanzó el juego» es prosa.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Reloj = { sim: number; frames: number; loop: number } | null;
type Presupuesto = number | { sim?: unknown; ms?: unknown };
type Ctx = {
  waitFor: (desc: string, probe: (arg?: unknown) => unknown, presupuesto?: Presupuesto, arg?: unknown) => Promise<unknown>;
  esperas: {
    pendientes: () => { desc: string }[];
    enVuelo: () => { desc: string }[];
    todas: () => { desc: string; rotulo: string | null; resolucion: string | null }[];
  };
};

const sonda = (await import(join(repoRoot, "qa", "lib", "sonda.mjs"))) as {
  ctxDeSonda: (page: unknown) => Ctx;
  presupuestoDeEspera: (p: unknown, desc: string) => { sim: number | null; techoMs: number; rotulo: string | null };
  presupuestoConducido: (o?: { ms?: number; sim?: number | null }) => { ms?: number; sim?: number };
  avanceDelReloj: (previa: Reloj, actual: NonNullable<Reloj>) => { sim: number; frames: number; loop: number };
  lecturaDelRelojValida: (r: unknown) => boolean;
  CADENCIA_MS: number;
  CORTAFUEGOS_POR_SIM: number;
  LOOP_COLGADO_MS: number;
};
const esperas = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as {
  EsperaExpirada: new (...a: never[]) => Error;
  RelojDeSimNoAvanzo: new (...a: never[]) => Error;
  relojDeSimNoAvanzoEn: (err: unknown) => { pedido: number; avanzado: number } | null;
  fallosDeEsperasPendientes: (libro: unknown) => string[];
};
const { ctxDeSonda, presupuestoDeEspera, presupuestoConducido, avanceDelReloj, lecturaDelRelojValida, CORTAFUEGOS_POR_SIM, LOOP_COLGADO_MS } =
  sonda;

/** EL RELOJ DEL CLIENTE, importado para ejercerlo. Vive en un módulo sin un
 *  solo import justo para que esto sea posible (ver el bloque del final). */
const { crearRelojDeSim } = (await import(
  join(repoRoot, "nefan-html", "src", "world", "reloj-de-sim.ts")
)) as { crearRelojDeSim: () => { frameDelLoop: (d: number) => number; avanza: (d: number) => number; lee: () => { sim: number; frames: number; loop: number } } };
const { EsperaExpirada, RelojDeSimNoAvanzo, relojDeSimNoAvanzoEn, fallosDeEsperasPendientes } = esperas;

/** El navegador falso: ejecuta en Node la función que la sonda le entrega, que
 *  es lo que hace el de verdad dentro de la página. `reloj` es lo que publica
 *  el cliente en `window.__nefan.reloj()`, y se conduce desde el test. */
function paginaFalsa(opciones: { reloj?: () => Reloj; conteste?: boolean } = {}) {
  const estado = { evaluaciones: 0 };
  const win = { __nefan: opciones.reloj ? { reloj: opciones.reloj } : {} };
  (globalThis as unknown as { window?: unknown }).window = win;
  // `muerta` se enciende DESPUÉS, desde el test: es como se apaga una espera que
  // se quedó atrás en una carrera, para que el proceso no arrastre detrás un
  // sondeo de veinte minutos (ver el bloque del guardia del rAF).
  const falsa = {
    estado,
    muerta: false,
    page: {
      evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown): Promise<unknown> => {
        estado.evaluaciones++;
        if (falsa.muerta || opciones.conteste === false) throw new Error("Execution context was destroyed");
        return fn(arg);
      },
    },
  };
  return falsa;
}

/** Un reloj de sim conducido a mano: avanza `porLectura` segundos cada vez que
 *  alguien lo lee, que es lo que hace el del juego cuando pasan frames. */
function relojQueCorre(porLectura: number, { late = true } = {}): () => Reloj {
  let sim = 0;
  let frames = 0;
  let loop = 0;
  return () => {
    sim += porLectura;
    frames += porLectura > 0 ? 1 : 0;
    // El LATIDO va aparte del mundo: un reloj que late sin simular es el estado
    // del título delante, y es el que tiene que acabar en ⊘ y no en afirmación.
    if (late) loop += 1;
    return { sim, frames, loop };
  };
}

/** La condición que no se cumple jamás: el material con el que se mide qué
 *  hace la espera al agotarse. */
const NUNCA = (): unknown => null;

/** Las llamadas del `gameLoop` del cliente, leídas del ÁRBOL DE SINTAXIS.
 *
 *  Un `grep` sabe que un texto está; no sabe DÓNDE. Ésa es toda la diferencia
 *  entre este candado y el que QA puso verde con el defecto dentro: lo que
 *  importa no es que `relojDeSim.avanza(delta)` aparezca en `main.ts`, es que
 *  sea **argumento de `gameClient.tick`** y de nada más. */
function llamadasDelLoop() {
  const fuente = readFileSync(join(repoRoot, "nefan-html", "src", "main.ts"), "utf8");
  const src = ts.createSourceFile("main.ts", fuente, ts.ScriptTarget.Latest, true);
  const esLlamadaA = (n: ts.Node, objeto: string, metodo: string): n is ts.CallExpression =>
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    ts.isIdentifier(n.expression.expression) &&
    n.expression.expression.text === objeto &&
    n.expression.name.text === metodo;
  const dentroDeGameLoop = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name?.text === "gameLoop") return true;
    }
    return false;
  };
  const tick: ts.CallExpression[] = [];
  const avanzaN: ts.CallExpression[] = [];
  const latidoN: ts.CallExpression[] = [];
  const visita = (n: ts.Node): void => {
    if (esLlamadaA(n, "gameClient", "tick")) tick.push(n);
    if (esLlamadaA(n, "relojDeSim", "avanza")) avanzaN.push(n);
    if (esLlamadaA(n, "relojDeSim", "frameDelLoop")) latidoN.push(n);
    ts.forEachChild(n, visita);
  };
  visita(src);
  const argumentosDeTick = new Set<ts.Node>(tick.flatMap((c) => [...c.arguments]));
  return {
    tick,
    avanza: avanzaN.map((c) => ({ esArgumentoDeTick: argumentosDeTick.has(c), enGameLoop: dentroDeGameLoop(c) })),
    latido: latidoN.map((c) => ({ enGameLoop: dentroDeGameLoop(c) })),
  };
}

describe("el presupuesto de una espera dice CON QUÉ RELOJ se mide (#545)", () => {
  it("un número son milisegundos de pared, como siempre", () => {
    assert.deepEqual(presupuestoDeEspera(4_000, "x"), { sim: null, techoMs: 4_000, rotulo: null });
  });

  it("`{sim:N}` deriva su cortafuegos de pared del propio presupuesto", () => {
    const p = presupuestoDeEspera({ sim: 4 }, "x");
    assert.equal(p.sim, 4);
    assert.equal(p.techoMs, 4 * 1000 * CORTAFUEGOS_POR_SIM);
    assert.match(p.rotulo!, /4\.00 s de sim/);
  });

  it("y el múltiplo es el MISMO para todos los presupuestos, sin techo que lo aplaste", () => {
    // H-4 de QA: con un techo absoluto de 300 s el «×10» solo era ×10 para el
    // presupuesto más pequeño — `{sim:45}` era ×6,67, `{sim:60}` ×5,00 y
    // `{sim:90}` ×3,33, o sea que un `{sim:90}` con la razón 0,3 que yo mismo
    // medí a factor 40 se rendía por PARED en vez de medir. El cortafuegos
    // volvía a decidir justo en el régimen que motivó la tanda.
    for (const sim of [4, 45, 60, 90, 600]) {
      const p = presupuestoDeEspera({ sim }, "x");
      assert.equal(p.techoMs, sim * 1000 * CORTAFUEGOS_POR_SIM, `{sim:${sim}} no es ×${CORTAFUEGOS_POR_SIM}`);
      // Dicho como lo que importa: qué razón sim/pared tolera antes de rendirse.
      assert.ok(1 / CORTAFUEGOS_POR_SIM <= 0.152, "el múltiplo ya no cubre la razón medida a factor 40");
    }
  });

  it("`ms` junto a `sim` fija el cortafuegos a mano, y el que decide sigue siendo el sim", () => {
    assert.deepEqual(presupuestoDeEspera({ sim: 2, ms: 500 }, "x").techoMs, 500);
  });

  it("**`{ms: N}` a secas es PARED DECLARADA**: idéntica al número suelto, con la unidad escrita", () => {
    // Nace en PR-4b de #545 y hasta entonces LANZABA (su caso estaba en la lista
    // de «lo que no se entiende», justo abajo). Cambia porque `holdUntil` dejó
    // de aceptar números: la espera que conduce al jugador pero de verdad
    // depende de OTRO proceso —que el bridge genere un tile— tiene que poder
    // escribirse, y tiene que VERSE en el diff que se escribe pared. Lo que no
    // cambia es el camino: mismo techo, `sim: null`, sin rótulo, y por tanto sin
    // leer el reloj del juego ni una vez.
    assert.deepEqual(presupuestoDeEspera({ ms: 400 }, "x"), presupuestoDeEspera(400, "x"));
    assert.deepEqual(presupuestoDeEspera({ ms: 180_000 }, "x"), { sim: null, techoMs: 180_000, rotulo: null });
  });

  it("**pero con SUELO**: `{ms: 4}` es lo que sale de teclear `{sim: 4}`, y 4 ms son UNA mirada", () => {
    // H-4 de QA: sin suelo, `expectEspera(desc, false, fn, {ms: 4})` sale ✔
    // afirmando un negativo con un solo sondeo — el defecto que este validador
    // existe para cerrar, entrando por la puerta que PR-4b acababa de abrir. Y
    // no lo veía ninguno de los dos candados: no hay `tecla`, no es `holdUntil`.
    for (const chico of [0, 1, 4, 149]) {
      assert.throws(() => presupuestoDeEspera({ ms: chico }, "x"), /no llega ni a la cadencia de sondeo/);
    }
    // El número suelto NO lleva suelo, y es deliberado: `0` no se puede teclear
    // por error en lugar de `{sim: 0}`, y hay un caso que lo usa para mirar una
    // vez a propósito (su test está más abajo, «un presupuesto de 0 sigue
    // mirando UNA vez»).
    assert.deepEqual(presupuestoDeEspera(0, "x"), { sim: null, techoMs: 0, rotulo: null });
  });

  it("**el presupuesto de una espera CONDUCIDA siempre es un objeto que el runner acepta**", () => {
    // H-1 de QA, y es el defecto que costó el guion 80: `expectEspera` armaba su
    // presupuesto pasando `ms` A PELO, `holdUntil` dejó de aceptar números en
    // esta misma tanda, y el 80 —con su fichero intacto y su sitio BENDECIDO por
    // el contrato de exenciones— murió en el fail-loud antes de llegar a su
    // aserto. Dos candados describiendo estados incompatibles y nadie en medio,
    // porque la regla vivía en una línea de `run.mjs` que ningún test podía
    // ejercer sin abrir un navegador. Ahora se ejerce aquí, en las dos mitades:
    // **es un objeto** (lo que `holdUntil` exige) y **lo entiende la sonda**.
    const casos = [
      {},
      { ms: 15_000 },
      { ms: 6_000, sim: null },
      { sim: 4 },
      { sim: 4, ms: 60_000 },
    ];
    for (const o of casos) {
      const p = presupuestoConducido(o);
      assert.equal(typeof p, "object", `${JSON.stringify(o)} → ${JSON.stringify(p)} no es un objeto`);
      assert.ok(!Array.isArray(p) && p !== null);
      // Y la sonda lo entiende: si lanzara, el guion moriría igual que el 80.
      assert.doesNotThrow(() => presupuestoDeEspera(p, "la espera conducida"), JSON.stringify(o));
    }
    // El defecto exacto: el de pared sigue valiendo lo que valía.
    assert.deepEqual(presupuestoDeEspera(presupuestoConducido({ ms: 15_000 }), "x"), presupuestoDeEspera(15_000, "x"));
  });

  it("lo que no se entiende LANZA, en vez de esperar `undefined` ms", () => {
    // Sin esto, `Date.now() - t0 < undefined` es siempre falso: la espera haría
    // UN sondeo y se daría por expirada — o sea, un guion que mira una vez y
    // afirma un negativo.
    for (const malo of [undefined, null, "4s", { ms: "400" }, { ms: -1 }, { ms: NaN }, { sim: 0 }, { sim: -1 }, { sim: "4" }, -1, NaN]) {
      assert.throws(() => presupuestoDeEspera(malo, "la espera de prueba"), /waitFor/);
    }
  });
});

describe("el avance del reloj tolera que la página NAVEGUE", () => {
  it("la primera lectura es la base, no un avance", () => {
    assert.deepEqual(avanceDelReloj(null, { sim: 7, frames: 40, loop: 99 }), { sim: 0, frames: 0, loop: 0 });
  });

  it("dos lecturas seguidas dan la diferencia", () => {
    assert.deepEqual(
      avanceDelReloj({ sim: 2, frames: 10, loop: 30 }, { sim: 3.5, frames: 25, loop: 60 }),
      { sim: 1.5, frames: 15, loop: 30 },
    );
  });

  it("un reloj que va hacia atrás es un `reload`: cuenta lo que lleva el nuevo, no un negativo", () => {
    // Media batería recarga la página para reanudar la partida. Restando, el
    // consumido se volvería negativo y el presupuesto no se agotaría jamás.
    assert.deepEqual(
      avanceDelReloj({ sim: 30, frames: 900, loop: 900 }, { sim: 0.5, frames: 12, loop: 12 }),
      { sim: 0.5, frames: 12, loop: 12 },
    );
  });
});

describe("con presupuesto de SIMULACIÓN, quien decide la expiración es el sim", () => {
  it("se agota cuando el MUNDO ha corrido sus segundos, no cuando lo dice la pared", async () => {
    // Cortafuegos de pared de un minuto y un reloj que corre rápido: si mandara
    // la pared, esto tardaría un minuto. Manda el sim y tarda dos sondeos.
    const { page } = paginaFalsa({ reloj: relojQueCorre(0.4) });
    const ctx = ctxDeSonda(page);
    const t0 = Date.now();
    const err = await ctx.waitFor("nada que se cumpla", NUNCA, { sim: 1, ms: 60_000 }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof EsperaExpirada, `esperaba una expiración y llegó ${String(err)}`);
    assert.ok(Date.now() - t0 < 10_000, `tardó ${Date.now() - t0} ms: la pared no puede ser quien decide`);
    assert.match((err as Error).message, /timeout esperando: nada que se cumpla/);
    assert.match((err as Error).message, /1 s de simulación pedidos/);
  });

  it("NO se agota mientras el mundo no avanza, aunque la pared corra", async () => {
    // El defecto de #545, escrito como test: con el reloj parado la espera
    // sigue mirando. Si contara pared, se habría rendido afirmando «no ocurrió».
    const { page, estado } = paginaFalsa({ reloj: relojQueCorre(0) });
    const ctx = ctxDeSonda(page);
    const err = await ctx.waitFor("nada que se cumpla", NUNCA, { sim: 5, ms: 900 }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof RelojDeSimNoAvanzo, `esperaba un ⊘ y llegó ${String(err)}`);
    assert.ok(estado.evaluaciones > 2, `solo miró ${estado.evaluaciones} veces: no estuvo esperando`);
  });

  it("y si la condición se cumple, se cumple: el sim no cambia el desenlace bueno", async () => {
    const { page } = paginaFalsa({ reloj: relojQueCorre(0.1) });
    const ctx = ctxDeSonda(page);
    assert.deepEqual(await ctx.waitFor("se cumple ya", () => ({ ok: true }), { sim: 5 }), { ok: true });
    assert.equal(ctx.esperas.pendientes().length, 0);
    assert.equal(ctx.esperas.enVuelo().length, 0);
  });
});

describe("el cortafuegos de pared solo puede declarar ⊘, nunca «no ocurrió» (#545)", () => {
  it("dice «sim pedido vs. sim avanzado», y separa los frames del MUNDO de los del LOOP", async () => {
    const { page } = paginaFalsa({ reloj: relojQueCorre(0) });
    const ctx = ctxDeSonda(page);
    const err = (await ctx.waitFor("el jugador llega", NUNCA, { sim: 4, ms: 600 }).catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof RelojDeSimNoAvanzo);
    assert.match(err.message, /sim pedido 4\.00 s vs\. sim avanzado 0\.00 s/);
    assert.match(err.message, /frames de MUNDO y \d+ del LOOP/);
    // Y con la página LATIENDO y el mundo parado, el mensaje dice cuál de los
    // dos estados es — que es el diagnóstico que le faltó a H-1.
    assert.match(err.message, /la página late .* pero el mundo no se simula/);
    // Y no puede confundirse con la afirmación de una expiración: «no ocurrió
    // en N ms» es la firma con la que `expectEspera` AFIRMA un hecho del juego
    // (`qa/lib/carga.mjs`, `firmaDePresupuesto`). Este mensaje empieza diciendo
    // que no se pudo medir, y la única vez que nombra esa frase es para negarla.
    assert.match(err.message, /^no se pudo medir/);
    assert.doesNotMatch(err.message, /no ocurrió en \d/);
    const visto = relojDeSimNoAvanzoEn(err);
    assert.equal(visto?.pedido, 4);
    assert.equal(visto?.avanzado, 0);
  });

  it("MISMO material, DOS veredictos: con pared es rojo y con sim es ⊘", async () => {
    // El test que prueba que la sonda mira el dato y no el viento. Si alguien
    // hace que el presupuesto de sim se rinda por pared, las dos ramas dan lo
    // mismo y esto se pone rojo.
    const material = () => paginaFalsa({ reloj: relojQueCorre(0) }).page;
    const porPared = await ctxDeSonda(material())
      .waitFor("el jugador llega", NUNCA, 600)
      .catch((e: unknown) => e);
    const porSim = await ctxDeSonda(material())
      .waitFor("el jugador llega", NUNCA, { sim: 4, ms: 600 })
      .catch((e: unknown) => e);
    assert.ok(porPared instanceof EsperaExpirada);
    assert.ok(porSim instanceof RelojDeSimNoAvanzo);
    assert.ok(!(porSim instanceof EsperaExpirada), "un ⊘ que sea además una expiración se lo tragaría `absorbe`");
  });

  it("el ⊘ deja el libro de esperas LIMPIO: nadie la cuenta además como pendiente", async () => {
    // Si la expiración quedara sin observar, el runner empujaría un fallo y el
    // guion saldría ROJO además de ⊘ — o sea, el rojo que este canal existe
    // para no fabricar.
    const { page } = paginaFalsa({ reloj: relojQueCorre(0) });
    const ctx = ctxDeSonda(page);
    await ctx.waitFor("el jugador llega", NUNCA, { sim: 4, ms: 400 }).catch(() => null);
    assert.deepEqual(fallosDeEsperasPendientes(ctx.esperas), []);
    assert.equal(ctx.esperas.enVuelo().length, 0);
  });

  it("y el libro escribe el reloj con el que se midió, no milisegundos de pared", async () => {
    const { page } = paginaFalsa({ reloj: relojQueCorre(0) });
    const ctx = ctxDeSonda(page);
    await ctx.waitFor("el jugador llega", NUNCA, { sim: 4, ms: 400 }).catch(() => null);
    assert.match(ctx.esperas.todas()[0].rotulo!, /4\.00 s de sim/);
  });

  it("una lectura que no se ENTIENDE es ilegible, no un avance: `NaN` no puede afirmar nada", async () => {
    // H-6 de QA, y es la misma puerta que `presupuestoDeEspera` cierra en la
    // entrada, en el otro extremo del mismo dato: `typeof NaN === "number"`, así
    // que con `sim: NaN` el acumulado era `NaN`, `NaN < presupuesto` falso, y la
    // espera salía del bucle **por el camino de la AFIRMACIÓN** tras un sondeo.
    assert.equal(lecturaDelRelojValida({ sim: 1, frames: 1, loop: 1 }), true);
    for (const malo of [null, { sim: NaN, frames: 1, loop: 1 }, { sim: 1, frames: NaN, loop: 1 }, { sim: 1 }]) {
      assert.equal(lecturaDelRelojValida(malo), false, JSON.stringify(malo));
    }
    const { page } = paginaFalsa({ reloj: () => ({ sim: NaN, frames: NaN, loop: NaN }) as unknown as Reloj });
    const err = (await ctxDeSonda(page)
      .waitFor("el jugador llega", NUNCA, { sim: 4, ms: 600 })
      .catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof RelojDeSimNoAvanzo, `un reloj ilegible tiene que ser ⊘ y llegó ${String(err)}`);
    assert.match(err.message, /no se entiende/);
  });

  it("y si la página LATE pero no simula, el ⊘ es por presupuesto y NO por loop colgado", async () => {
    // El control del guardia de abajo: sin esto, un guardia que disparase
    // siempre daría el mismo ⊘ por el motivo equivocado, y el diagnóstico —que
    // es para lo que existen las dos cifras— diría lo contrario de lo que pasa.
    const { page } = paginaFalsa({ reloj: relojQueCorre(0) });
    const err = (await ctxDeSonda(page)
      .waitFor("el jugador llega", NUNCA, { sim: 4, ms: 600 })
      .catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof RelojDeSimNoAvanzo);
    assert.doesNotMatch(err.message, /sin dar un solo frame/);
  });

  it("un cliente sin `reloj()` se dice ENSEGUIDA y no tras el cortafuegos entero", async () => {
    // Un bundle de producción no publica el reloj, y esperar ahí los 40 s del
    // cortafuegos por cada espera sería tardar una tarde en decir algo que se
    // sabe en la primera lectura.
    const { page } = paginaFalsa({});
    const ctx = ctxDeSonda(page);
    const t0 = Date.now();
    const err = (await ctx.waitFor("el jugador llega", NUNCA, { sim: 4 }).catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof RelojDeSimNoAvanzo);
    assert.match(err.message, /no publica `window\.__nefan\.reloj\(\)`/);
    assert.ok(Date.now() - t0 < 2_000, `tardó ${Date.now() - t0} ms en decir que no hay reloj`);
    // Y este ⊘ tampoco puede traerse un fallo de regalo: la espera se abrió
    // antes de la primera lectura, así que hay que cerrarla o el runner la
    // cobra además como «seguía en vuelo» y el guion sale ROJO encima del ⊘.
    assert.deepEqual(fallosDeEsperasPendientes(ctx.esperas), []);
    assert.equal(ctx.esperas.enVuelo().length, 0);
  });
});

describe("el guardia del rAF DESACOPLADO (#545, H-4 y H-11)", () => {
  // EL NEGATIVO DE ESTE CANDADO NO PUEDE SER UNA CANCELACIÓN (H-13 de QA). La
  // primera versión confiaba en el `timeout` del runner: quitar el guardia daba
  // `fail 0 · cancelled 1 · 'test timed out after 25000ms'`, que es el primo del
  // «cuelga la suite» que yo mismo había escrito que no sirve — dice que algo
  // tardó, no QUÉ falló. Aquí la espera corre contra un reloj propio y lo que
  // sale es un ✘ con su frase.
  const SE_LE_DA = 20_000;

  /** Corre la espera contra un plazo y devuelve o su desenlace o la marca de que
   *  seguía esperando. La espera que se quede atrás se apaga sola: se le corta la
   *  página, que es lo que hace que el proceso de test no arrastre un sondeo de
   *  veinte minutos detrás. */
  async function loQuePasePrimero(pagina: { muerta: boolean }, espera: Promise<unknown>) {
    let plazo: NodeJS.Timeout;
    const marca = Symbol("sigue esperando");
    const desenlace = await Promise.race([
      espera.then(
        () => "se cumplió (imposible)",
        (e: unknown) => e,
      ),
      new Promise((r) => {
        plazo = setTimeout(() => r(marca), SE_LE_DA);
      }),
    ]);
    clearTimeout(plazo!);
    if (desenlace === marca) {
      pagina.muerta = true;
      void espera.catch(() => {});
    }
    return desenlace === marca ? null : desenlace;
  }

  it("una página que CONTESTA y no mueve nada se declara ⊘ enseguida, no tras el cortafuegos entero", async () => {
    // Es lo que permite que el cortafuegos de pared sea proporcional al sim
    // pedido en vez de estar topado: un `{sim:120}` sobre una página desacoplada
    // se resolvía antes en 300 s (el techo) y ahora en diez.
    const falsa = paginaFalsa({ reloj: relojQueCorre(0, { late: false }) });
    const espera = ctxDeSonda(falsa.page).waitFor("el jugador llega", NUNCA, { sim: 120 });
    const t0 = Date.now();
    const err = await loQuePasePrimero(falsa, espera);
    assert.ok(
      err !== null,
      `la espera seguía viva a los ${SE_LE_DA} ms: sin el guardia, un {sim:120} sobre una página ` +
        `desacoplada se queda 1.200.000 ms mirando un cadáver, y la corrida entera cuelga detrás`,
    );
    assert.ok(err instanceof RelojDeSimNoAvanzo, `esperaba ⊘ y llegó ${String(err)}`);
    assert.match((err as Error).message, /no se ha movido NADA/);
    assert.match((err as Error).message, /está desacoplada/);
    assert.ok(Date.now() - t0 < SE_LE_DA, `tardó ${Date.now() - t0} ms`);
  });

  it("pero un MUNDO QUE AVANZA no se declara muerto jamás, aunque el latido del loop no llegue", async () => {
    // H-11, y era un defecto de conducta con medida sobre el juego real: mirando
    // solo `loop`, un `waitFor({sim:12})` sobre una página que simulaba
    // (`{sim:1.7166, frames:96, loop:0}`) salía ⊘ a los 10 s diciendo «la página
    // contesta, pero no late», con 10,02 s de mundo corridos. El guardia
    // descansaba en un invariante de `main.ts` que nada sujetaba.
    //
    // EL PRESUPUESTO TIENE QUE DURAR MÁS QUE EL GUARDIA o este test no mide
    // nada: con uno pequeño la espera se agota antes de que el guardia pueda
    // dispararse y pasa igual con el defecto puesto. Me pasó, y lo cacé al
    // probarlo en negativo — que es justo para lo que se prueban en negativo.
    // A ~2,7 s de sim por segundo de pared, 34 s de mundo son ~13 s de reloj:
    // por encima de `LOOP_COLGADO_MS` con margen.
    const falsa = paginaFalsa({ reloj: relojQueCorre(0.4, { late: false }) });
    const t0 = Date.now();
    const espera = ctxDeSonda(falsa.page).waitFor("el jugador llega", NUNCA, { sim: 34, ms: 60_000 });
    const err = await loQuePasePrimero(falsa, espera);
    const tardó = Date.now() - t0;
    assert.ok(
      tardó > LOOP_COLGADO_MS,
      `solo esperó ${tardó} ms, menos que el guardia (${LOOP_COLGADO_MS}): así el guardia ni se asoma y ` +
        `este caso pasaría también con el defecto puesto`,
    );
    assert.ok(err instanceof EsperaExpirada, `un mundo que avanza tiene que poder AFIRMAR, y llegó ${String(err)}`);
    assert.doesNotMatch((err as Error).message, /no se ha movido NADA/);
  });
});

describe("con presupuesto de PARED no cambia ni un byte del camino de siempre", () => {
  it("expira con su mensaje y su último valor, sin mirar el reloj del juego", async () => {
    // El reloj es ILEGIBLE a propósito: con presupuesto de pared no se lee, así
    // que esto tiene que expirar igual. Si alguien lo leyera siempre, la mitad
    // de la batería empezaría a declarar ⊘.
    const { page } = paginaFalsa({});
    const ctx = ctxDeSonda(page);
    const err = (await ctx.waitFor("nada", () => null, 400).catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof EsperaExpirada);
    assert.equal(err.message, "timeout esperando: nada (último valor: null)");
    assert.equal(ctx.esperas.todas()[0].rotulo, null);
    assert.match(fallosDeEsperasPendientes(ctx.esperas)[0], /expiró a los 400 ms/);
  });

  it("y un presupuesto de 0 sigue mirando UNA vez", async () => {
    const { page, estado } = paginaFalsa({});
    const ctx = ctxDeSonda(page);
    await ctx.waitFor("nada", () => null, 0).catch(() => null);
    assert.equal(estado.evaluaciones, 1);
  });
});

describe("el reloj de sim del cliente CUENTA, y cuenta lo que el mundo simula (#545)", () => {
  // ESTE BLOQUE ERA UN `grep` Y NO VALÍA NADA, y conviene que quede escrito
  // dónde falló: sus tres asertos miraban el TEXTO de `main.ts`, así que
  // `crearRelojDeSim` no lo ejecutaba ni un test del repo. QA lo demostró con
  // el caso que yo no usé — cambiar `sim += delta` por `sim += 0` dejaba los 21
  // tests en verde, con toda espera de sim de la batería declarando ⊘ y ningún
  // candado enterándose. Un candado que se satisface sin haber mirado. Por eso
  // el reloj vive ahora en un módulo SIN IMPORTS: para poder pedirle cuentas.

  it("`avanza` mueve el reloj por el delta que recibe, y lo devuelve", () => {
    // El caso que pone rojo `sim += 0`, que es el que faltaba.
    const r = crearRelojDeSim();
    assert.equal(r.avanza(0.1), 0.1, "`avanza` tiene que devolver su delta: es lo que lo hace inevitable");
    r.avanza(0.05);
    assert.equal(Number(r.lee().sim.toFixed(3)), 0.15);
    assert.equal(r.lee().frames, 2);
  });

  it("y el LATIDO del loop se cuenta aparte, sin tocar el sim", () => {
    const r = crearRelojDeSim();
    r.frameDelLoop(0.1);
    r.frameDelLoop(0.1);
    assert.deepEqual(r.lee(), { sim: 0, frames: 0, loop: 2 });
    // Las dos cifras juntas son las que dicen «la página late pero el mundo no
    // corre», que es el estado que se le escapó a la primera versión.
    r.avanza(r.frameDelLoop(0.1));
    assert.deepEqual(r.lee(), { sim: 0.1, frames: 1, loop: 3 });
  });

  it("un reloj recién hecho está a cero y no comparte estado con otro", () => {
    const a = crearRelojDeSim();
    a.avanza(1);
    assert.deepEqual(crearRelojDeSim().lee(), { sim: 0, frames: 0, loop: 0 });
  });

  it("EL MUNDO avanza el reloj desde el argumento del `tick`, y se lee del ÁRBOL, no del texto", () => {
    // ESTE ANCLA ERA UNA REGEX Y QA LA PUSO VERDE CON EL DEFECTO DENTRO. Escribió
    //     : (relojDeSim.avanza(delta), gameClient.idle())
    // en la rama del TÍTULO —o sea, el mundo volviendo a contar donde no se
    // simula, que es H-1 otra vez— y obtuvo `wc` 1395, tsc 0, eslint 0 y esta
    // batería en 27/27. `npm run verify` entero pasaba con el defecto puesto, y
    // el único que se enteraba era el guion 131, que abre navegador y no corre en
    // CI. Una regex no sabe DÓNDE está una llamada; el AST sí, y es el mismo
    // camino que ya recorrió `qa-lib-tiene-quien-lo-mire` por el mismo motivo.
    const { avanza, tick } = llamadasDelLoop();
    assert.equal(avanza.length, 1, `hay ${avanza.length} llamadas a relojDeSim.avanza y tiene que haber UNA`);
    assert.equal(tick.length, 1, `hay ${tick.length} llamadas a gameClient.tick y tiene que haber UNA`);
    assert.ok(
      avanza.every((a) => a.esArgumentoDeTick),
      "hay una llamada a `relojDeSim.avanza` que NO es argumento de `gameClient.tick`: el mundo vuelve a " +
        "contar donde no se simula (H-1), y eso es exactamente lo que la forma anterior de este candado " +
        "—una regex sobre el texto— dejaba pasar en verde",
    );
    assert.ok(avanza.every((a) => a.enGameLoop), "la llamada a `relojDeSim.avanza` se ha ido fuera de `gameLoop`");
  });

  it("y el LATIDO tiene su propia ancla: `frameDelLoop` no se puede borrar en silencio", () => {
    // H-11 de QA: `frameDelLoop` no lo sujetaba nada. Quitarlo de `main.ts` daba
    // 35/35 verdes, tsc 0 y eslint 0 — y sobre la página real dejaba al guardia
    // del latido declarando MUERTA una página que simulaba. El guardia ya no
    // depende de él (mira si se movió ALGO), pero el DIAGNÓSTICO sí: sin `loop`,
    // un ⊘ no puede distinguir «late y no simula» de «no se mueve nada».
    const { latido } = llamadasDelLoop();
    assert.equal(latido.length, 1, `hay ${latido.length} llamadas a relojDeSim.frameDelLoop y tiene que haber UNA`);
    assert.ok(latido[0].enGameLoop, "`frameDelLoop` se ha ido fuera de `gameLoop`: ya no cuenta el latido de nadie");
  });

  it("y ningún OTRO módulo del cliente toca el reloj: `main.ts` es el único que lo alimenta", () => {
    // Aquí un escaneo de texto SÍ vale y conviene decir por qué: lo que se
    // afirma es una AUSENCIA («no aparece en ningún otro fichero»), y para eso
    // la presencia del texto es condición necesaria. Lo que un `grep` no sabe
    // es DÓNDE está lo que sí aparece, y de eso se ocupa el AST de arriba.
    const ficherosDelCliente = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = join(dir, n);
        return statSync(f).isDirectory() ? ficherosDelCliente(f) : f.endsWith(".ts") ? [f] : [];
      });
    const alimentan = ficherosDelCliente(join(repoRoot, "nefan-html", "src"))
      .filter((f) => /relojDeSim\.(avanza|frameDelLoop)\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(repoRoot.length + 1));
    assert.deepEqual(alimentan, ["nefan-html/src/main.ts"]);
  });

  it("el hook lo publica para el banco, y no lo define", () => {
    // El reloj salió de `dev/nefan-hook.ts` por dos razones: allí no se podía
    // ejercer (el módulo arrastra medio cliente) y su cabecera declara «nada de
    // `nefan-html/src` lo consume», que con el reloj dentro era falsa en cada
    // frame — también en producción.
    const hook = readFileSync(join(repoRoot, "nefan-html", "src", "dev", "nefan-hook.ts"), "utf8");
    assert.match(hook, /reloj: \(\) => relojDeSim\.lee\(\)/);
    assert.doesNotMatch(hook, /function crearRelojDeSim/);
  });
});
