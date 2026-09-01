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
type Abierta = { id: number; desc: string; ms: number; sitio: string; posada: Promise<void> | null };
type Libro = {
  abre: (desc: string, ms: number, sitio: string) => number;
  enlaza: (id: number, posada: Promise<unknown>) => void;
  cumple: (id: number) => void;
  expira: (id: number) => number | null;
  anota: (desc: string, ms: number, sitio: string) => number;
  resuelve: (id: number, comoYPorQue: string) => boolean;
  pendientes: () => Anotacion[];
  enVuelo: () => Abierta[];
  todas: () => Anotacion[];
};

const mod = (await import(join(repoRoot, "qa", "lib", "esperas.mjs"))) as {
  EsperaExpirada: new (
    mensaje: string,
    id: number,
    ultimo?: unknown,
    sondeo?: { muestras: number; rotos: number },
  ) => Error & { esperaId: number; ultimo: unknown; sondeo: { muestras: number; rotos: number } };
  esperaExpiradaEn: (err: unknown) => (Error & { esperaId: number }) | null;
  huboSondeo: (sondeo: unknown) => boolean;
  quejaDelMotivo: (motivo: unknown) => string | null;
  sitioDeLlamada: (stack: string) => string;
  libroDeEsperas: () => Libro;
  fallosDeEsperasPendientes: (libro: Libro) => string[];
  fallosDeEsperasEnVuelo: (libro: Libro) => string[];
};
const {
  EsperaExpirada,
  esperaExpiradaEn,
  huboSondeo,
  quejaDelMotivo,
  sitioDeLlamada,
  libroDeEsperas,
  fallosDeEsperasPendientes,
  fallosDeEsperasEnVuelo,
} = mod;

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

describe("la CUARTA boca: una espera que nadie esperó (hallazgo 1 de QA, 2026-09-01)", () => {
  it("una espera abierta está EN VUELO, no pendiente: todavía no ha decidido nada", () => {
    const libro = libroDeEsperas();
    libro.abre("el jugador anda", 15_000, "11-…mjs:64");
    assert.equal(libro.enVuelo().length, 1);
    assert.deepEqual(libro.pendientes(), [], "en vuelo no es lo mismo que expirada");
  });

  it("cumplirse la cierra sin dejar rastro: esperar y llegar no es un fallo", () => {
    const libro = libroDeEsperas();
    const id = libro.abre("el jugador anda", 15_000, "11-…mjs:64");
    libro.cumple(id);
    assert.deepEqual(libro.enVuelo(), []);
    assert.deepEqual(libro.pendientes(), []);
    assert.deepEqual(fallosDeEsperasEnVuelo(libro), []);
  });

  it("expirar la pasa de EN VUELO a pendiente, con su desc, su reloj y su sitio", () => {
    const libro = libroDeEsperas();
    const id = libro.abre("el jugador anda", 15_000, "11-…mjs:64");
    assert.equal(libro.expira(id), id);
    assert.deepEqual(libro.enVuelo(), []);
    assert.deepEqual(
      libro.pendientes().map((p) => [p.desc, p.ms, p.sitio]),
      [["el jugador anda", 15_000, "11-…mjs:64"]],
    );
  });

  it("la que sigue en vuelo al cerrar produce SU fallo, que dice que falta un `await`", () => {
    const libro = libroDeEsperas();
    libro.abre("expiración que aterriza después del veredicto", 600, "99-…mjs:12");
    const [fallo] = fallosDeEsperasEnVuelo(libro);
    assert.match(fallo, /SEGUÍA EN VUELO/);
    assert.match(fallo, /nadie la esperó/);
    assert.match(fallo, /await/);
    assert.match(fallo, /99-…mjs:12/);
  });

  it("expirar dos veces el mismo id no duplica la anotación", () => {
    const libro = libroDeEsperas();
    const id = libro.abre("una", 100, "x.mjs:1");
    libro.expira(id);
    assert.equal(libro.expira(id), null, "ya no está abierta: no hay nada que expirar");
    assert.equal(libro.pendientes().length, 1);
  });

  it("`enlaza` guarda una promesa que NO puede rechazar: el drenaje no puede tumbar la corrida", async () => {
    const libro = libroDeEsperas();
    const id = libro.abre("una que revienta", 100, "x.mjs:1");
    libro.enlaza(id, Promise.reject(new Error("la espera expiró")));
    const [abierta] = libro.enVuelo();
    await assert.doesNotReject(() => abierta.posada as Promise<void>);
  });
});

describe("huboSondeo: «no ocurrió» y «no llegué a mirar» no son lo mismo (hallazgo 3 de QA)", () => {
  it("con sondeos buenos, sí midió", () => {
    assert.equal(huboSondeo({ muestras: 4, rotos: 0 }), true);
    assert.equal(huboSondeo({ muestras: 4, rotos: 3 }), true);
  });

  it("con TODOS los sondeos rotos, no midió: un negativo no se puede afirmar", () => {
    assert.equal(huboSondeo({ muestras: 4, rotos: 4 }), false);
  });

  it("sin un solo sondeo tampoco (un `ms:0` no mira nada)", () => {
    assert.equal(huboSondeo({ muestras: 0, rotos: 0 }), false);
  });

  it("un sondeo ausente o malformado no cuenta como medida", () => {
    assert.equal(huboSondeo(undefined), false);
    assert.equal(huboSondeo({}), false);
    assert.equal(huboSondeo(null), false);
  });

  it("la EsperaExpirada lo lleva encima, y por defecto es «no midió»", () => {
    const conSondeo = new EsperaExpirada("timeout", 1, null, { muestras: 3, rotos: 1 });
    assert.equal(huboSondeo(conSondeo.sondeo), true);
    assert.equal(huboSondeo(new EsperaExpirada("timeout", 2, null).sondeo), false);
  });
});

describe("quejaDelMotivo: la criba del gesto reflejo (hallazgo 5 de QA)", () => {
  it("una frase que dice dónde vive la medida pasa", () => {
    assert.equal(
      quejaDelMotivo(
        "cortafuegos de UN tramo del paseo: el bucle vuelve a medir y el último tramo afirma el predicado",
      ),
      null,
    );
  });

  it("rechaza el gesto reflejo, uno a uno (los que QA midió pasando)", () => {
    for (const m of ["x", "TODO", "n/a", ".", "porque sí", "41-el-jugador-puede-pelear.mjs"]) {
      assert.ok(quejaDelMotivo(m), `«${m}» tendría que quedar fuera`);
    }
  });

  it("y sigue rechazando lo de antes: vacío, blancos y lo que no es una frase", () => {
    for (const m of ["", "   ", undefined, null, true, 0, {}, ["x"]]) {
      assert.ok(quejaDelMotivo(m), `${JSON.stringify(m)} tendría que quedar fuera`);
    }
  });

  it("la queja DICE qué pasa: un fichero no es lo mismo que una frase corta", () => {
    assert.match(String(quejaDelMotivo("41-el-jugador-puede-pelear.mjs")), /nombra un fichero/);
    assert.match(String(quejaDelMotivo("porque sí")), /demasiado corto/);
    assert.match(String(quejaDelMotivo("")), /vacío/);
  });

  it("TODOS los motivos escritos hoy en el banco pasan la criba", async () => {
    // Si un día no pasan, o el umbral se ha vuelto teatro o el motivo se
    // degradó: las dos cosas hay que verlas, y aquí se ven en el CI.
    const { readFileSync, readdirSync } = await import("node:fs");
    const dirs = [join(repoRoot, "qa", "guiones"), join(repoRoot, "qa", "lib")];
    const motivos: string[] = [];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
        const txt = readFileSync(join(dir, f), "utf8");
        // Solo los motivos escritos como literal de una línea; los que se
        // componen con `+` o con plantillas no se pueden leer sin ejecutar.
        for (const m of txt.matchAll(/ctx\.(?:absorbe|sinMedirBloque)\(\s*"([^"]{3,})"/g)) {
          motivos.push(m[1]);
        }
      }
    }
    assert.ok(motivos.length > 0, "el escaneo no encontró un solo motivo: la regex se quedó atrás");
    for (const m of motivos) assert.equal(quejaDelMotivo(m), null, `motivo que no pasa: «${m}»`);
  });
});

describe("sitioDeLlamada: los marcos sin fichero no roban el sitio (hallazgo 7 de QA)", () => {
  it("`at async Promise.all (index 1)` se salta y gana el marco del guion", () => {
    const stack = [
      "Error",
      "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:98:13)",
      "    at async Promise.all (index 1)",
      "    at default (/home/al/code/ne-fan/qa/guiones/41-el-jugador-puede-pelear.mjs:299:23)",
    ].join("\n");
    assert.equal(sitioDeLlamada(stack), "41-el-jugador-puede-pelear.mjs:299");
  });

  it("y SIN marco de guion, se salta igual: el sitio es el primero que tiene fichero", () => {
    // Este es el caso que distingue de verdad, y el que QA midió: sin filtrar
    // los marcos sin `fichero:línea`, el elegido sería `at async Promise.all
    // (index 1)` — ni fichero ni línea, justo donde más falta hace el
    // diagnóstico. Sin él, el aserto de arriba pasaría igual (lo elige el
    // `find` del guion), o sea que sería un verde que no comprueba nada.
    const stack = [
      "Error",
      "    at Object.waitFor (/home/al/code/ne-fan/qa/lib/sonda.mjs:98:13)",
      "    at async Promise.all (index 1)",
      "    at main (/home/al/code/ne-fan/qa/run.mjs:1234:9)",
    ].join("\n");
    assert.equal(sitioDeLlamada(stack), "run.mjs:1234");
  });

  it("un stack entero sin fichero:línea no inventa un sitio (ni devuelve el marco crudo)", () => {
    const solo = sitioDeLlamada("Error\n    at async Promise.all (index 1)");
    assert.equal(solo, "sitio desconocido");
    assert.doesNotMatch(solo, /Promise\.all/, "devolver el marco crudo es fingir que hay un sitio");
  });
});
