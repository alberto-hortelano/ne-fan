/** LA ESPERA POR FOTOGRAMAS DEL BANCO, EJERCIDA (#606).
 *
 *  El sujeto es `qa/lib/fotogramas.mjs`: el molde con el que un guion dice
 *  «deja pasar N fotogramas y vuelve a mirar». Estaba escrito a mano dieciséis
 *  veces, con dos nombres y cuatro redacciones, y las quince que no eran la
 *  primera se escribieron copiando a la anterior.
 *
 *  Aquí se ejerce con una página falsa cuyos DOS contadores se mueven por
 *  separado — el del mundo (`frames`, que solo sube cuando el sim avanza) y el
 *  de la página (`loop`, que sube en toda vuelta del game loop, también con el
 *  título delante). Que se puedan mover por separado ES el experimento: en un
 *  navegador con partida van atados, y por eso la diferencia entre los dos
 *  relojes no se nota hasta el día que alguien espera por el mundo con el
 *  título puesto y se le cuelga la espera veinte segundos.
 *
 *  Lo que esto NO prueba, y lo prueban los quince guiones sobre la página real:
 *  que Playwright serialice el predicado hacia el navegador y que el cliente
 *  publique `reloj()` con los dos contadores donde se dice.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Arg = { campo: string; desde: number; n: number };
type Espera = (ctx: unknown, n?: number) => Promise<{ f: number }>;

const fotogramas = (await import(join(repoRoot, "qa", "lib", "fotogramas.mjs"))) as {
  RELOJES: Record<string, string>;
  CORTAFUEGOS_MS: number;
  campoDelReloj: (reloj: unknown) => string;
  pasaronLosFotogramas: (a: Arg) => { f: number } | null;
  esperaDeFotogramas: (reloj: unknown) => Espera;
};
const { RELOJES, CORTAFUEGOS_MS, campoDelReloj, pasaronLosFotogramas, esperaDeFotogramas } = fotogramas;

/** Una página falsa con los dos contadores INDEPENDIENTES, más el interruptor
 *  del hook: durante una recarga `window.__nefan` no existe todavía. */
function paginaFalsa({ frames = 0, loop = 0 }: { frames?: number; loop?: number } = {}) {
  const estado = { frames, loop, conHook: true };
  (globalThis as unknown as { window?: unknown }).window = {
    get __nefan() {
      return estado.conHook
        ? { reloj: () => ({ sim: estado.frames * 0.016, frames: estado.frames, loop: estado.loop }) }
        : undefined;
    },
  };
  return estado;
}

/** El `ctx` mínimo que la espera usa: `page.evaluate` (para la base) y
 *  `waitFor` (que aquí sondea el predicado a mano, sin reloj ni navegador). */
function ctxFalso(estado: ReturnType<typeof paginaFalsa>, { sondeos = 50 } = {}) {
  const visto: { desc: string; presupuesto: number; sondeos: number }[] = [];
  return {
    visto,
    page: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evaluate: async (fn: any, arg?: unknown) => fn(arg),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitFor: async (desc: string, probe: any, presupuesto: number, arg: unknown) => {
      let n = 0;
      for (; n < sondeos; n++) {
        const r = probe(arg);
        if (r !== null && r !== undefined) {
          visto.push({ desc, presupuesto, sondeos: n + 1 });
          return r;
        }
        // Un sondeo que no se cumple: el mundo avanza UNA vuelta del loop, y
        // el del mundo solo si la página falsa lo está moviendo.
        estado.loop += 1;
      }
      visto.push({ desc, presupuesto, sondeos: n });
      throw new Error(`waitFor(«${desc}») expiró tras ${n} sondeos`);
    },
  };
}

describe("la espera por fotogramas del banco tiene dueño y reloj declarado (#606)", () => {
  it("el reloj es OBLIGATORIO: sin él, o con un nombre inventado, LANZA con la lista", () => {
    // No hay defecto a propósito. Heredar el reloj es el defecto que este
    // módulo retira, así que omitirlo no puede salir a un valor cualquiera.
    for (const malo of [undefined, null, "", "frames", "sim", "Mundo", 3, {}]) {
      assert.throws(
        () => campoDelReloj(malo),
        /`reloj` es OBLIGATORIO y vale "mundo" o "loop"/,
        `campoDelReloj(${JSON.stringify(malo)}) tenía que lanzar`,
      );
    }
    assert.deepEqual(RELOJES, { mundo: "frames", loop: "loop" });
    assert.equal(campoDelReloj("mundo"), "frames");
    assert.equal(campoDelReloj("loop"), "loop");
  });

  it("«mundo» y «loop» NO son el mismo contador: con el mundo parado, uno se cumple y el otro no", async () => {
    // El caso del guion 79 y del 34, que esperan CON EL TÍTULO DELANTE: ahí
    // `relojDeSim.avanza()` no se llama (`main.ts`) y `frames` se queda quieto
    // mientras `loop` sigue subiendo. Un aserto con N = 1 no distingue una
    // regla de su contraria, así que se ejercen LOS DOS relojes sobre el MISMO
    // material y se comprueba que dan veredictos distintos.
    const estado = paginaFalsa({ frames: 100, loop: 100 });
    const porLaPagina = await esperaDeFotogramas("loop")(ctxFalso(estado), 3);
    assert.equal(porLaPagina.f, 103, "el reloj «loop» tiene que cumplirse: la página sigue dando vueltas");

    const parado = paginaFalsa({ frames: 100, loop: 100 });
    await assert.rejects(
      () => esperaDeFotogramas("mundo")(ctxFalso(parado, { sondeos: 20 }), 3),
      /expiró tras 20 sondeos/,
      "con el mundo parado, el reloj «mundo» NO puede cumplirse",
    );
  });

  it("con el mundo corriendo, «mundo» se cumple y cuenta desde donde estaba (no desde cero)", async () => {
    const estado = paginaFalsa({ frames: 500, loop: 7 });
    const ctx = ctxFalso(estado);
    // El mundo avanza a la par que el loop en esta corrida.
    const original = ctx.waitFor;
    ctx.waitFor = async (desc, probe, presupuesto, arg) => {
      const avanza = setInterval(() => {}, 1 << 30);
      clearInterval(avanza);
      return original.call(ctx, desc, (a: Arg) => {
        const r = probe(a);
        if (r === null) estado.frames += 1;
        return r;
      }, presupuesto, arg);
    };
    const r = await esperaDeFotogramas("mundo")(ctx, 4);
    assert.equal(r.f, 504, "la base es 500, no 0: cuatro fotogramas MÁS, no cuatro en total");
  });

  it("la BASE se lee fail-loud: sin hook LANZA, y nunca degrada a cero", async () => {
    // Éste es el defecto que traían las nueve copias del gemelo: la base se
    // leía con `fps()?.frames ?? 0`, así que si el hook no estaba en ese
    // instante —una recarga— `desde` valía 0 y la espera se cumplía con la
    // PRIMERA muestra. Nueve esperas que podían salir verdes sin esperar nada.
    const estado = paginaFalsa({ frames: 900, loop: 900 });
    estado.conHook = false;
    await assert.rejects(
      () => esperaDeFotogramas("mundo")(ctxFalso(estado), 3),
      /no hay punto de partida desde el que contar/,
      "sin hook, la base tiene que LANZAR",
    );
    // Y la prueba de que el fail-loud no es decorativo: con la base a 0 (lo que
    // hacía el `?? 0`) la espera se habría cumplido de inmediato sobre 900.
    estado.conHook = true;
    assert.equal(
      pasaronLosFotogramas({ campo: "frames", desde: 0, n: 3 })?.f,
      900,
      "con base 0 la espera se cumple con la primera muestra: por eso la base no puede degradar",
    );
  });

  it("DENTRO del sondeo, en cambio, «no hay hook todavía» significa VOLVER A MIRAR", () => {
    // El `?? 0` de la base era el defecto; el «todavía no» del sondeo es
    // correcto y tiene que seguir estando: durante una recarga la página
    // contesta sin hook, y eso no es cero fotogramas, es «aún no se sabe».
    const estado = paginaFalsa({ frames: 10, loop: 10 });
    estado.conHook = false;
    assert.equal(pasaronLosFotogramas({ campo: "frames", desde: 5, n: 1 }), null);
    estado.conHook = true;
    assert.deepEqual(pasaronLosFotogramas({ campo: "frames", desde: 5, n: 1 }), { f: 10 });
  });

  it("los fotogramas son un entero ≥ 1, y el cortafuegos es el ALTO de los dos que había", async () => {
    const estado = paginaFalsa({ frames: 1, loop: 1 });
    for (const malo of [0, -1, 1.5, "3" as unknown as number, NaN]) {
      await assert.rejects(
        () => esperaDeFotogramas("loop")(ctxFalso(estado), malo),
        /los fotogramas son un entero ≥ 1/,
      );
    }
    // 20 s, que es el mayor de los dos cortafuegos que convivían (10 y 20).
    // Unificar hacia abajo puede convertir una espera legítima en expiración;
    // hacia arriba no afloja nada, porque la CONDICIÓN son los fotogramas.
    assert.equal(CORTAFUEGOS_MS, 20_000);
    const ctx = ctxFalso(paginaFalsa({ frames: 0, loop: 0 }));
    await esperaDeFotogramas("loop")(ctx, 1);
    assert.equal(ctx.visto[0]?.presupuesto, CORTAFUEGOS_MS);
  });

  it("la descripción de la espera DICE con qué reloj mide (se lee en el log del guion)", async () => {
    const ctx = ctxFalso(paginaFalsa({ frames: 0, loop: 0 }));
    await esperaDeFotogramas("loop")(ctx, 2);
    assert.match(ctx.visto[0]!.desc, /la PÁGINA da 2 fotograma\(s\) \(reloj "loop"\)/);
  });
});
