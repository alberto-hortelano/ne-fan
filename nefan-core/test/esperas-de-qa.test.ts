/** El libro de esperas de QA (#261): una espera que expiró y nadie observó no
 *  puede acabar en verde.
 *
 *  El sujeto es `qa/lib/esperas.mjs`, y este fichero existe porque **el CI no
 *  corre la batería de `qa/`**: el candado vive en el runner, que solo se
 *  ejecuta a mano, así que sin esto la parte pura del mecanismo —qué cuenta
 *  como observada y qué no— no la comprobaría nadie hasta la siguiente corrida
 *  local. Aquí sí entra en `npm test`.
 *
 *  Precedente del import cruzado: `test/veredictos.test.ts` y
 *  `test/presets-clasifica.test.ts` ya cargan módulos de `qa/lib` desde aquí.
 *  El banco es parte del aparato de este repositorio, no un tercero.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Anotacion = { id: number; desc: string; ms: number; sitio: string; resolucion: string | null };
type Libro = {
  anota: (desc: string, ms: number, sitio: string) => number;
  resuelve: (id: number, comoYPorQue: string) => boolean;
  pendientes: () => Anotacion[];
  todas: () => Anotacion[];
};

const mod = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as {
  EsperaExpirada: new (mensaje: string, id: number, ultimo?: unknown) => Error & {
    esperaId: number;
    ultimo: unknown;
  };
  esperaExpiradaEn: (err: unknown) => (Error & { esperaId: number }) | null;
  sitioDeLlamada: (stack: string) => string;
  libroDeEsperas: () => Libro;
  fallosDeEsperasPendientes: (libro: Libro) => string[];
};
const { EsperaExpirada, esperaExpiradaEn, sitioDeLlamada, libroDeEsperas, fallosDeEsperasPendientes } =
  mod;

describe("libro de esperas: anotar y quedar pendiente", () => {
  it("una expiración anotada queda PENDIENTE hasta que alguien la observa", () => {
    const libro = libroDeEsperas();
    libro.anota("el jugador se mueve", 15_000, "11-un-solo-contexto-webgl.mjs:73");
    assert.equal(libro.pendientes().length, 1);
    assert.equal(libro.pendientes()[0].desc, "el jugador se mueve");
    assert.equal(libro.pendientes()[0].ms, 15_000);
    assert.equal(libro.pendientes()[0].sitio, "11-un-solo-contexto-webgl.mjs:73");
  });

  it("un libro sin expiraciones no tiene nada pendiente: esperar y cumplir no anota nada", () => {
    const libro = libroDeEsperas();
    assert.deepEqual(libro.pendientes(), []);
    assert.deepEqual(fallosDeEsperasPendientes(libro), []);
  });

  it("cada anotación tiene su propio id: dos expiraciones no se pisan", () => {
    const libro = libroDeEsperas();
    const a = libro.anota("una", 1000, "x.mjs:1");
    const b = libro.anota("otra", 1000, "x.mjs:2");
    assert.notEqual(a, b);
    libro.resuelve(a, "afirmada por expectEspera: una");
    assert.deepEqual(
      libro.pendientes().map((p) => p.desc),
      ["otra"],
    );
  });
});

describe("libro de esperas: las TRES bocas que resuelven una expiración", () => {
  it("propagó al runner", () => {
    const libro = libroDeEsperas();
    const id = libro.anota("la escena vuelve", 30_000, "42-…mjs:481");
    assert.equal(libro.resuelve(id, "propagó al runner y paró el guion"), true);
    assert.deepEqual(libro.pendientes(), []);
  });

  it("la afirmó `expectEspera` (el timeout ES el dato)", () => {
    const libro = libroDeEsperas();
    const id = libro.anota("el jugador atraviesa el muro", 6000, "02-…mjs:60");
    assert.equal(libro.resuelve(id, "afirmada por expectEspera: el jugador atraviesa el muro"), true);
    assert.deepEqual(libro.pendientes(), []);
  });

  it("la absorbió `ctx.absorbe` diciendo dónde vive la medida", () => {
    const libro = libroDeEsperas();
    const id = libro.anota("tramo 3", 4000, "41-…mjs:129");
    assert.equal(libro.resuelve(id, "absorbida: cortafuegos por tramo; el bucle vuelve a medir"), true);
    assert.deepEqual(libro.pendientes(), []);
  });

  it("resolver dos veces no es un error, pero solo la primera resuelve", () => {
    const libro = libroDeEsperas();
    const id = libro.anota("una", 1000, "x.mjs:1");
    assert.equal(libro.resuelve(id, "propagó al runner y paró el guion"), true);
    assert.equal(libro.resuelve(id, "absorbida: llegué tarde"), false);
    assert.equal(libro.todas()[0].resolucion, "propagó al runner y paró el guion");
  });

  it("resolver un id que no existe no estalla: el candado no puede tumbar la corrida que juzga", () => {
    const libro = libroDeEsperas();
    assert.equal(libro.resuelve(9999, "propagó al runner y paró el guion"), false);
  });
});

describe("libro de esperas: una pendiente produce fallo, y el fallo enseña la salida", () => {
  it("cada pendiente da UN fallo que nombra la espera, el reloj y el sitio", () => {
    const libro = libroDeEsperas();
    libro.anota("el jugador se mueve", 15_000, "11-un-solo-contexto-webgl.mjs:73");
    const fallos = fallosDeEsperasPendientes(libro);
    assert.equal(fallos.length, 1);
    assert.match(fallos[0], /expiró.*nadie la observó/);
    assert.match(fallos[0], /el jugador se mueve/);
    assert.match(fallos[0], /15000 ms/);
    assert.match(fallos[0], /11-un-solo-contexto-webgl\.mjs:73/);
  });

  it("el fallo nombra las TRES bocas y el canal ⊘: quien lo lee tiene que poder arreglarlo", () => {
    const libro = libroDeEsperas();
    libro.anota("una", 1000, "x.mjs:1");
    const [fallo] = fallosDeEsperasPendientes(libro);
    assert.match(fallo, /expectEspera/);
    assert.match(fallo, /absorbe/);
    assert.match(fallo, /propagar/);
    assert.match(fallo, /sinMedirBloque/);
  });

  it("lo resuelto NO produce fallo: es lo que hace legales al negativo deliberado y al cortafuegos", () => {
    const libro = libroDeEsperas();
    const a = libro.anota("el jugador atraviesa el muro", 6000, "02-…mjs:60");
    const b = libro.anota("tramo 3", 4000, "41-…mjs:129");
    const c = libro.anota("sin observar", 4000, "99-…mjs:1");
    libro.resuelve(a, "afirmada por expectEspera: el jugador atraviesa el muro");
    libro.resuelve(b, "absorbida: cortafuegos por tramo; el bucle vuelve a medir");
    void c;
    assert.deepEqual(
      fallosDeEsperasPendientes(libro).length,
      1,
      "solo la que nadie observó tiene que producir fallo",
    );
  });
});

describe("la EsperaExpirada y su cadena de causas", () => {
  it("lleva el id de su anotación y el último valor sondeado", () => {
    const err = new EsperaExpirada("timeout esperando: x (último valor: null)", 7, { d: 3.2 });
    assert.equal(err.esperaId, 7);
    assert.deepEqual(err.ultimo, { d: 3.2 });
    assert.equal(esperaExpiradaEn(err), err);
  });

  it("se encuentra a través del `cause` — `esperarRegistro` relanza un error propio", () => {
    const raiz = new EsperaExpirada("timeout esperando: el viaje", 3, null);
    const envuelto = new Error("el juego nunca lo registró · viaje={}", { cause: raiz });
    assert.equal(esperaExpiradaEn(envuelto), raiz);
  });

  it("un error cualquiera NO es una expiración: `absorbe` no puede tragarse otra cosa", () => {
    assert.equal(esperaExpiradaEn(new Error("el bridge no contesta")), null);
    assert.equal(esperaExpiradaEn(null), null);
    assert.equal(esperaExpiradaEn(undefined), null);
  });

  it("una cadena de causas circular no cuelga el runner", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    assert.equal(esperaExpiradaEn(b), null);
  });
});

describe("sitioDeLlamada: de qué línea de qué guion salió la espera", () => {
  it("prefiere el marco del GUION aunque la espera nazca en un helper de qa/lib", () => {
    const stack = [
      "Error",
      "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:64:13)",
      "    at acercarse (/home/al/code/ne-fan/qa/lib/combate.mjs:40:5)",
      "    at default (/home/al/code/ne-fan/qa/guiones/41-el-jugador-puede-pelear.mjs:299:23)",
    ].join("\n");
    assert.equal(sitioDeLlamada(stack), "41-el-jugador-puede-pelear.mjs:299");
  });

  it("sin guion en la pila, vale el primer marco que no sea de qa/lib", () => {
    const stack = [
      "Error",
      "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:64:13)",
      "    at main (/home/al/code/ne-fan/qa/captura-de-fixture.mjs:50:9)",
    ].join("\n");
    assert.equal(sitioDeLlamada(stack), "captura-de-fixture.mjs:50");
  });

  it("un stack que no dice nada no estalla: devuelve algo legible", () => {
    assert.equal(sitioDeLlamada(""), "sitio desconocido");
    assert.equal(sitioDeLlamada(undefined as unknown as string), "sitio desconocido");
  });
});
