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

type Reloj = { sim: number; frames: number } | null;
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
  avanceDelReloj: (previa: Reloj, actual: NonNullable<Reloj>) => { sim: number; frames: number };
  CADENCIA_MS: number;
  CORTAFUEGOS_POR_SIM: number;
  CORTAFUEGOS_MAXIMO_MS: number;
};
const esperas = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as {
  EsperaExpirada: new (...a: never[]) => Error;
  RelojDeSimNoAvanzo: new (...a: never[]) => Error;
  relojDeSimNoAvanzoEn: (err: unknown) => { pedido: number; avanzado: number } | null;
  fallosDeEsperasPendientes: (libro: unknown) => string[];
};
const { ctxDeSonda, presupuestoDeEspera, avanceDelReloj, CORTAFUEGOS_POR_SIM, CORTAFUEGOS_MAXIMO_MS } = sonda;
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
function relojQueCorre(porLectura: number): () => Reloj {
  let sim = 0;
  let frames = 0;
  return () => {
    sim += porLectura;
    frames += porLectura > 0 ? 1 : 0;
    return { sim, frames };
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

  it("el cortafuegos derivado tiene techo: una página muerta no se mira quince minutos", () => {
    assert.equal(presupuestoDeEspera({ sim: 600 }, "x").techoMs, CORTAFUEGOS_MAXIMO_MS);
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
    assert.deepEqual(avanceDelReloj(null, { sim: 7, frames: 40 }), { sim: 0, frames: 0 });
  });

  it("dos lecturas seguidas dan la diferencia", () => {
    assert.deepEqual(avanceDelReloj({ sim: 2, frames: 10 }, { sim: 3.5, frames: 25 }), { sim: 1.5, frames: 15 });
  });

  it("un reloj que va hacia atrás es un `reload`: cuenta lo que lleva el nuevo, no un negativo", () => {
    // Media batería recarga la página para reanudar la partida. Restando, el
    // consumido se volvería negativo y el presupuesto no se agotaría jamás.
    assert.deepEqual(avanceDelReloj({ sim: 30, frames: 900 }, { sim: 0.5, frames: 12 }), { sim: 0.5, frames: 12 });
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
  it("dice «sim pedido vs. sim avanzado», con los frames del loop", async () => {
    const { page } = paginaFalsa({ reloj: relojQueCorre(0) });
    const ctx = ctxDeSonda(page);
    const err = (await ctx.waitFor("el jugador llega", NUNCA, { sim: 4, ms: 600 }).catch((e: unknown) => e)) as Error;
    assert.ok(err instanceof RelojDeSimNoAvanzo);
    assert.match(err.message, /sim pedido 4\.00 s vs\. sim avanzado 0\.00 s/);
    assert.match(err.message, /frames del loop/);
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

describe("el reloj de sim del cliente está anclado, y es UNO (#545)", () => {
  const ficherosDelCliente = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? ficherosDelCliente(p) : p.endsWith(".ts") ? [p] : [];
    });

  it("el delta TOPADO del game loop pasa por el reloj: no hay forma de mover el mundo sin contarlo", () => {
    const main = readFileSync(join(repoRoot, "nefan-html", "src", "main.ts"), "utf8");
    assert.match(
      main,
      /const delta = relojDeSim\.avanza\(Math\.min\(\(now - lastTime\) \/ 1000, [\d.]+\)\)/,
      "el game loop ya no alimenta el reloj de sim con su delta topado: el banco presupuestaría en sim " +
        "contra un contador que nadie mueve, y toda espera de sim pasaría a declarar ⊘",
    );
  });

  it("esa llamada es la ÚNICA en todo el cliente", () => {
    // «Una sola definición de avanzó el juego» es el criterio de la PR, y sin
    // esto es una frase: dos sitios que acumulen dan dos relojes que nadie
    // obliga a coincidir.
    const usos = ficherosDelCliente(join(repoRoot, "nefan-html", "src"))
      .filter((f) => readFileSync(f, "utf8").includes("relojDeSim.avanza("))
      .map((f) => f.slice(repoRoot.length + 1));
    assert.deepEqual(usos, ["nefan-html/src/main.ts"]);
  });

  it("y el hook lo publica para el banco", () => {
    const hook = readFileSync(join(repoRoot, "nefan-html", "src", "dev", "nefan-hook.ts"), "utf8");
    assert.match(hook, /reloj: \(\) => relojDeSim\.lee\(\)/);
  });
});
