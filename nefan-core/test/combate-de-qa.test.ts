/** LOS DOS GESTOS DE PELEA DEL BANCO, Y CON QUÉ PRESUPUESTO ESPERAN (#545).
 *
 *  El sujeto es `qa/lib/combate.mjs` — `acercarse` y `herirHasta`, por donde
 *  pasan los 20 guiones que andan y pegan. Estaba EXENTO en
 *  `data/contract/banco-medido.json` con el motivo «conducidos por teclado sobre
 *  la página real», y eso es cierto de los gestos y **falso de su contrato**:
 *  qué presupuesto le llega a `waitFor` no necesita un navegador, necesita un
 *  `ctx` que apunte lo que recibe.
 *
 *  Y el precio de no medirlo está cobrado: cuando `herirHasta` cambió `maxMs`
 *  (milisegundos de pared) por `sim` (segundos de mundo), **tres sitios de
 *  llamada se quedaron escribiendo `maxMs`** y nadie se enteró — una clave
 *  desconocida se desestructura en silencio. El del guion 49 pedía 120 s y se
 *  quedó con el defecto de 60: medio presupuesto, sobre un resultado que
 *  gobierna un `ctx.sinMedir`. Lo cazó QA (H-3), no el banco.
 *
 *  Así que aquí se mide el CONTRATO, que es lo que se puede medir sin página:
 *  qué presupuesto sale de cada gesto, que una opción inventada LANZA, y que la
 *  tecla se suelta pase lo que pase. Los metros, el umbral y el HUD siguen
 *  siendo cosa de los guiones, sobre el juego real.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Presupuesto = number | { sim?: number; ms?: number };
type Llamada = { verbo: string; desc: string; presupuesto: Presupuesto };

const combate = (await import(join(repoRoot, "qa", "lib", "combate.mjs"))) as {
  acercarse: (ctx: unknown, id: string, opciones?: Record<string, unknown>) => Promise<unknown>;
  herirHasta: (
    ctx: unknown,
    id: string,
    objetivo: number,
    opciones?: Record<string, unknown>,
  ) => Promise<unknown>;
};
const { acercarse, herirHasta } = combate;

/** Un `ctx` que no conduce nada: apunta con qué presupuesto se espera y qué se
 *  le pide al driver de input. La página se simula con lo mínimo que los dos
 *  gestos miran — el enemigo y la posición del jugador—, y `cumple` decide si
 *  la condición se da a la primera o no se da jamás. */
function ctxDeMentira({ cumple = true }: { cumple?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  const input: string[] = [];
  const ctx = {
    llamadas,
    input,
    page: {
      evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown): Promise<unknown> => fn(arg),
    },
    nefan: async (path: string, ...args: unknown[]): Promise<unknown> => {
      input.push(`${path}(${args.join(",")})`);
      return null;
    },
    log: () => {},
    absorbe: async (_motivo: string, fn: () => Promise<unknown>): Promise<unknown> => fn(),
    waitFor: async (desc: string, _probe: unknown, presupuesto: Presupuesto): Promise<unknown> => {
      llamadas.push({ verbo: "waitFor", desc, presupuesto });
      if (!cumple) throw Object.assign(new Error("EsperaExpirada de mentira"), { name: "EsperaExpirada", esperaId: 1 });
      return { d: 0 };
    },
    holdUntil: async (_key: string, desc: string, _p: unknown, presupuesto: Presupuesto): Promise<unknown> => {
      llamadas.push({ verbo: "holdUntil", desc, presupuesto });
      return { d: 0 };
    },
    expectEspera: async (desc: string, _debe: boolean, _p: unknown, o: { sim?: number; ms?: number }) => {
      llamadas.push({ verbo: "expectEspera", desc, presupuesto: { sim: o.sim, ms: o.ms } });
      return { ocurrio: true, ultimo: { d: 0 }, midio: true };
    },
  };
  // El mundo que ven las sondas, tal y como lo publica el cliente.
  (globalThis as unknown as { window?: unknown }).window = {
    __nefan: {
      enemies: () => [{ id: "bandido_1", pos: { x: 0, z: 0 } }],
      npcs: () => [{ id: "barkeep", pos: { x: 0, z: 0 } }],
      state: () => ({ pos: { x: 0, z: 0 } }),
      setYaw: () => {},
      inputDriver: { press: () => {}, release: () => {}, queueAttack: () => {} },
    },
    document: undefined,
  };
  return ctx;
}

describe("el presupuesto con el que espera `herirHasta` es el que se le pide (#545)", () => {
  it("por defecto son 60 s de SIMULACIÓN, no milisegundos de pared", async () => {
    const ctx = ctxDeMentira();
    await herirHasta(ctx, "bandido_1", 0);
    assert.deepEqual(ctx.llamadas[0].presupuesto, { sim: 60 });
  });

  it("y `sim` llega tal cual: 90 se espera con 90, no con el defecto", async () => {
    // El caso exacto de H-3: tres sitios pedían 90/120/45 y esperaban con 60.
    for (const sim of [45, 90, 120]) {
      const ctx = ctxDeMentira();
      await herirHasta(ctx, "bandido_1", 0, { sim });
      assert.deepEqual(ctx.llamadas[0].presupuesto, { sim }, `pidió ${sim} y esperó con otra cosa`);
    }
  });

  it("**`maxMs` LANZA**: una opción que murió no se puede escribir en silencio", async () => {
    // Sin esto, `{maxMs: 120_000}` se desestructura a nada y el helper usa su
    // defecto: medio presupuesto, sin una línea que lo diga.
    await assert.rejects(
      () => herirHasta(ctxDeMentira(), "bandido_1", 0, { maxMs: 120_000 }) as Promise<unknown>,
      /opción\(es\) que no existen: `maxMs`/,
    );
  });

  it("y cualquier otra inventada también, diciendo cuáles hay", async () => {
    await assert.rejects(
      () => herirHasta(ctxDeMentira(), "bandido_1", 0, { alcanze: 2 }) as Promise<unknown>,
      /`alcanze`.*`sim`, `alcance`/s,
    );
  });

  it("la tecla «up» se suelta SIEMPRE, también cuando la espera revienta", async () => {
    // H-5: con el ⊘ pasando de largo, sin `finally` el guion se iba a ⊘ con el
    // jugador andando, y la captura del diagnóstico se tomaba en marcha.
    const ctx = ctxDeMentira();
    const estalla = Object.assign(new Error("⊘ de mentira"), { name: "RelojDeSimNoAvanzo", pedido: 4 });
    ctx.waitFor = async () => {
      throw estalla;
    };
    await assert.rejects(() => herirHasta(ctx, "bandido_1", 0) as Promise<unknown>, /⊘ de mentira/);
    assert.ok(
      ctx.input.includes("inputDriver.release(up)"),
      `no soltó la tecla: ${JSON.stringify(ctx.input)}`,
    );
  });
});

describe("el presupuesto con el que espera `acercarse`", () => {
  it("cada tramo y el aserto final esperan los MISMOS segundos de sim", async () => {
    // El aserto del final tiene que pedir lo mismo que los tramos: si pidiera
    // más, volvería la banda de «expiró y verde igual» que abrió #261.
    const ctx = ctxDeMentira();
    await acercarse(ctx, "bandido_1", { objetivo: 99 });
    const final = ctx.llamadas.filter((l) => l.verbo === "expectEspera");
    assert.equal(final.length, 1);
    assert.deepEqual(final[0].presupuesto, { sim: 4, ms: undefined });
  });

  it("`tramoSim` se respeta, y `tramoMs` LANZA", async () => {
    const ctx = ctxDeMentira();
    await acercarse(ctx, "bandido_1", { objetivo: 99, tramoSim: 7 });
    assert.deepEqual(ctx.llamadas.at(-1)!.presupuesto, { sim: 7, ms: undefined });
    await assert.rejects(
      () => acercarse(ctxDeMentira(), "bandido_1", { tramoMs: 4_000 }) as Promise<unknown>,
      /`tramoMs`/,
    );
  });

  it("y las opciones que SÍ existen no lanzan (control: si lanzara todo, lo de arriba no mide nada)", async () => {
    await acercarse(ctxDeMentira(), "barkeep", { objetivo: 2.2, lista: "npcs", tramos: 24, tramoSim: 4 });
  });
});
