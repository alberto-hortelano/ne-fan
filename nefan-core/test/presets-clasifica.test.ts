/** Un ocupante AJENO en el catálogo de puertos no se le imputa a ningún preset
 *  (#296).
 *
 *  El sujeto es `qa/lib/presets-clasifica.mjs`, la parte pura de
 *  `qa/presets.mjs`. Se prueba desde aquí y no con un guion suelto de `qa/` por
 *  la misma razón por la que la función se extrajo: el caso que hay que cubrir
 *  es «otro agente de la máquina levanta un puerto del catálogo a mitad de
 *  corrida», y reproducirlo de verdad exige arrancar ocho presets con los nueve
 *  puertos libres — o sea, exige que NO haya otro agente, que es justo la
 *  situación contraria a la que se está midiendo. Con el sondeo inyectado el
 *  caso son tres líneas y corre en `npm test`, que es donde se mira.
 *
 *  Precedente del import cruzado: `test/port-offset-paridad.test.ts` ya carga
 *  `qa/lib/stack.mjs` desde aquí (y hasta ejecuta `./start.sh`). El banco es
 *  parte del aparato de este repositorio, no un tercero.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Ocupante {
  arriba: boolean;
  ajeno: boolean;
  duenyo: string | null;
}
interface Veredicto {
  slug: string;
  /** La escala única de `qa/lib/veredictos.mjs` (#331): AJENO murió como
   *  estado — el ocupante sigue en `ajenos[]`, que es detalle. */
  estado: "verde" | "rojo" | "sin-medir";
  faltan: number[];
  colados: number[];
  ajenos: { puerto: number; duenyo: string | null; rol: "esperado" | "prohibido" }[];
}
interface Corrida {
  ok: number;
  rojos: number;
  noMedidos: number;
  ajenos: { puerto: number; slug: string }[];
  concluyente: boolean;
  exit: number;
}

const mod = (await import(join(repoRoot, "qa", "lib", "presets-clasifica.mjs"))) as {
  clasificarPreset: (c: {
    slug: string;
    esperados: number[];
    prohibidos: number[];
    ocupacion: Map<number, Ocupante>;
  }) => Veredicto;
  veredictoDeLaCorrida: (rs: Veredicto[]) => Corrida;
};
const { clasificarPreset, veredictoDeLaCorrida } = mod;

/** El sondeo, escrito a mano. `9877` y `3000` son «esperados» y `8765`/`8767`
 *  «prohibidos» en todos los casos: son etiquetas, no el catálogo real (que
 *  sale del snapshot y no pinta nada aquí). */
const ESPERADOS = [9877, 3000];
const PROHIBIDOS = [8765, 8767];

function sonda(entradas: Record<number, Partial<Ocupante>>): Map<number, Ocupante> {
  const m = new Map<number, Ocupante>();
  for (const p of [...ESPERADOS, ...PROHIBIDOS]) {
    m.set(p, { arriba: false, ajeno: false, duenyo: null, ...(entradas[p] ?? {}) });
  }
  return m;
}

const clasifica = (ocupacion: Map<number, Ocupante>): Veredicto =>
  clasificarPreset({ slug: "un-preset", esperados: ESPERADOS, prohibidos: PROHIBIDOS, ocupacion });

describe("presets: el veredicto de un preset", () => {
  it("verde cuando arriba están exactamente los de su máscara", () => {
    const r = clasifica(sonda({ 9877: { arriba: true }, 3000: { arriba: true } }));
    assert.equal(r.estado, "verde");
    assert.deepEqual(r.faltan, []);
    assert.deepEqual(r.colados, []);
    assert.deepEqual(r.ajenos, []);
  });

  it("rojo cuando NO levanta uno de los suyos", () => {
    const r = clasifica(sonda({ 9877: { arriba: true } }));
    assert.equal(r.estado, "rojo");
    assert.deepEqual(r.faltan, [3000]);
  });

  it("rojo cuando levanta uno que su máscara NO dice", () => {
    const r = clasifica(
      sonda({ 9877: { arriba: true }, 3000: { arriba: true }, 8765: { arriba: true } }),
    );
    assert.equal(r.estado, "rojo");
    assert.deepEqual(r.colados, [8765]);
  });

  // El caso de #296: en la PR #294 esto salía `✘ playtest-motor` por un puerto
  // que era de otro agente de la máquina.
  it("un ocupante AJENO en un puerto que el preset NO usa se nombra y no lo pone rojo", () => {
    const r = clasifica(
      sonda({
        9877: { arriba: true },
        3000: { arriba: true },
        8765: { arriba: true, ajeno: true, duenyo: "pid 42 · vite · cwd /home/al/otro-worktree" },
      }),
    );
    assert.notEqual(r.estado, "rojo");
    assert.deepEqual(r.colados, [], "el puerto ajeno NO se cuenta como colado del preset");
    assert.deepEqual(r.ajenos, [
      { puerto: 8765, duenyo: "pid 42 · vite · cwd /home/al/otro-worktree", rol: "prohibido" },
    ]);
  });

  it("un ocupante AJENO en un puerto que el preset SÍ necesita deja el preset SIN MEDIR", () => {
    // `start.sh` se niega a arrancar sobre un puerto ocupado y su trap baja lo
    // que llevara: de este preset no se midió nada, ni bueno ni malo.
    const r = clasifica(
      sonda({ 9877: { arriba: true }, 3000: { arriba: true, ajeno: true, duenyo: "pid 7 · vite" } }),
    );
    assert.equal(r.estado, "sin-medir");
    assert.deepEqual(r.faltan, [], "no se le apunta como «no levantó»: no le dejaron");
    assert.deepEqual(r.ajenos.map((a) => a.rol), ["esperado"]);
  });

  it("con un ajeno delante, un fallo REAL del preset sigue saliendo rojo", () => {
    // El arreglo no puede convertirse en «con un ajeno cerca, todo se perdona»:
    // el ajeno está en un puerto que el preset no usa, así que su propio fallo
    // (no levantó :3000) se sigue midiendo y se sigue diciendo.
    const r = clasifica(
      sonda({ 9877: { arriba: true }, 8767: { arriba: true, ajeno: true, duenyo: "pid 9" } }),
    );
    assert.equal(r.estado, "rojo");
    assert.deepEqual(r.faltan, [3000]);
    assert.equal(r.ajenos.length, 1);
  });
});

describe("presets: el veredicto de la CORRIDA", () => {
  const verde = clasifica(sonda({ 9877: { arriba: true }, 3000: { arriba: true } }));
  const rojo = clasifica(sonda({ 9877: { arriba: true } }));
  const conAjeno = clasifica(
    sonda({ 9877: { arriba: true }, 3000: { arriba: true }, 8765: { arriba: true, ajeno: true, duenyo: "pid 42" } }),
  );

  it("todo verde → 0", () => {
    const v = veredictoDeLaCorrida([verde, verde]);
    assert.equal(v.exit, 0);
    assert.equal(v.concluyente, true);
  });

  it("un preset rojo y ningún ajeno → 1 (es el launcher)", () => {
    const v = veredictoDeLaCorrida([verde, rojo]);
    assert.equal(v.exit, 1);
    assert.equal(v.concluyente, true);
  });

  it("un ocupante ajeno marca la corrida NO CONCLUYENTE → 2, aunque el preset saliera verde", () => {
    const v = veredictoDeLaCorrida([verde, conAjeno]);
    assert.equal(v.exit, 2);
    assert.equal(v.concluyente, false);
    assert.deepEqual(v.ajenos.map((a) => a.puerto), [8765]);
  });

  it("el 2 gana al 1: con un ajeno dentro, ni los rojos son de fiar", () => {
    const v = veredictoDeLaCorrida([rojo, conAjeno]);
    assert.equal(v.rojos, 1);
    assert.equal(v.exit, 2);
  });
});
