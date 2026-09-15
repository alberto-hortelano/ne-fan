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
const { ctxDeSonda, presupuestoDeEspera, avanceDelReloj, lecturaDelRelojValida, CORTAFUEGOS_POR_SIM } = sonda;

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
  return {
    estado,
    page: {
      evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown): Promise<unknown> => {
        estado.evaluaciones++;
        if (opciones.conteste === false) throw new Error("Execution context was destroyed");
        return fn(arg);
      },
    },
  };
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

  it("lo que no se entiende LANZA, en vez de esperar `undefined` ms", () => {
    // Sin esto, `Date.now() - t0 < undefined` es siempre falso: la espera haría
    // UN sondeo y se daría por expirada — o sea, un guion que mira una vez y
    // afirma un negativo.
    for (const malo of [undefined, null, "4s", { ms: 400 }, { sim: 0 }, { sim: -1 }, { sim: "4" }, -1, NaN]) {
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

describe("el LATIDO del loop es el cortafuegos contra el rAF colgado (#545, H-4)", () => {
  // El `timeout` es parte del candado, no un adorno: SIN el guardia del latido
  // este caso no se pone rojo, se CUELGA —el cortafuegos de pared de `{sim:120}`
  // son 1.200.000 ms—, y un candado cuyo negativo es colgar la suite no sirve
  // para enterarse de nada. Con él, quitar el guardia sale rojo en 25 s.
  it("una página que no da NI UN frame se declara ⊘ por el latido, sin esperar al cortafuegos entero", { timeout: 25_000 }, async () => {
    // Es lo que permite que el cortafuegos de pared sea proporcional al sim
    // pedido en vez de estar topado: un `{sim:120}` sobre un cadáver se
    // resolvía antes en 300 s (el techo) y ahora en diez, y el techo ya no
    // aplasta el múltiplo de los presupuestos grandes.
    //
    // Cuesta sus diez segundos de reloj y no hay forma barata de tenerlos: el
    // guardia es de PARED por definición. Corre en paralelo con el resto de la
    // suite (`--test-concurrency`), así que no alarga la corrida.
    const { page } = paginaFalsa({ reloj: relojQueCorre(0, { late: false }) });
    const t0 = Date.now();
    const err = (await ctxDeSonda(page)
      .waitFor("el jugador llega", NUNCA, { sim: 120 })
      .catch((e: unknown) => e)) as Error;
    const tardó = Date.now() - t0;
    assert.ok(err instanceof RelojDeSimNoAvanzo, `esperaba ⊘ y llegó ${String(err)}`);
    assert.match(err.message, /el GAME LOOP lleva \d+ ms sin dar un solo frame/);
    assert.ok(tardó < 20_000, `tardó ${tardó} ms: el cortafuegos de pared de {sim:120} son 1.200.000 ms`);
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

  it("EL MUNDO avanza el reloj desde el argumento del `tick`, que es la llamada que lo simula", () => {
    // El ancla de POSICIÓN, y ahora apunta a la posición correcta: alimentar el
    // reloj arriba del loop contaba los frames del TÍTULO, donde `tick` no se
    // llama y `idle()` sí — y ahí una espera de sim se agotaba y AFIRMABA «el
    // mundo avanzó sus N segundos» sobre un mundo parado (H-1, medido: 7,65 s
    // de sim en 8 s de pared con el título delante). Que la llamada esté DENTRO
    // del `tick` es lo que hace que `sim` no pueda subir sin que el mundo corra.
    const main = readFileSync(join(repoRoot, "nefan-html", "src", "main.ts"), "utf8");
    assert.match(
      main,
      /gameClient\.tick\(relojDeSim\.avanza\(delta\)/,
      "el mundo ya no avanza el reloj desde el argumento de `tick`: si se alimenta en otro sitio, `sim` " +
        "vuelve a contar frames en los que el mundo no se simula y la espera de sim afirma lo que no midió",
    );
    assert.doesNotMatch(
      main,
      /const delta = relojDeSim\.avanza\(/,
      "el reloj vuelve a alimentarse con el delta del LOOP, antes de saber si el mundo se va a simular: " +
        "es exactamente el defecto H-1",
    );
  });

  it("y esa llamada es la ÚNICA en todo el cliente", () => {
    // «Una sola definición de avanzó el juego» es el criterio de la PR, y sin
    // esto es una frase: dos sitios que acumulen dan dos relojes que nadie
    // obliga a coincidir.
    const ficherosDelCliente = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? ficherosDelCliente(p) : p.endsWith(".ts") ? [p] : [];
      });
    const usos = ficherosDelCliente(join(repoRoot, "nefan-html", "src"))
      .filter((f) => readFileSync(f, "utf8").includes("relojDeSim.avanza("))
      .map((f) => f.slice(repoRoot.length + 1));
    assert.deepEqual(usos, ["nefan-html/src/main.ts"]);
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
