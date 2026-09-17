/** La batería del candado «la batería EJERCE lo que muta» (#598a).
 *
 *  Lo que se prueba aquí es la DECISIÓN, con cobertura de V8 sintética: qué es
 *  ejercer, qué es solo cargar y qué no se puede juzgar. Correr las 61 baterías
 *  de verdad es el trabajo del guion (`npm run ejercicio`, 8,6 s con ocho a la
 *  vez), y lo que lo ata al disco es que corre en CI sobre el reparto real.
 *
 *  El caso que dio origen a todo, con sus números medidos el 2026-09-17:
 *  `resolvePlaceTarget` sale con 0 invocaciones con la batería de `world-map`
 *  —la que lo mutaba— y con 7 con la de `npc-director`. La forma de esas dos
 *  cargas es exactamente la de los dos primeros tests. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  baterisAlaVez,
  ejercicioDeFichero,
  ejercicioLegible,
  ejercido,
  esAyudanteDelTranspilador,
  fallosDelModulo,
  fuenteConNombresReservados,
  rutaDelScript,
  type CoberturaDeFichero,
  type Ejercicio,
} from "../scripts/ejercicio-de-bateria.js";

const fn = (functionName: string, startOffset: number, count: number) => ({
  functionName,
  ranges: [{ startOffset, count }],
});

/** La forma real que deja `NODE_V8_COVERAGE` sobre un fichero transpilado por
 *  `tsx`: el envoltorio del módulo en el offset 0, el ayudante `__name` que
 *  esbuild inyecta con `keepNames`, y después el código de la casa. */
const cobertura = (...funciones: ReturnType<typeof fn>[]): CoberturaDeFichero => ({
  url: "file:///repo/nefan-core/src/world-map/place-target.ts",
  functions: funciones,
});

describe("ejercicio de batería · cargar no es ejercer", () => {
  it("una función declarada y NUNCA llamada es `solo cargado`, no ejercida", () => {
    // `place-target.ts` con la batería de `world-map`, tal cual: el módulo se
    // importa (envoltorio 1), `__name` corre al cargar, y la única función del
    // fichero sale con cero llamadas.
    const e = ejercicioDeFichero(cobertura(fn("", 0, 1), fn("__name", 47, 1), fn("resolvePlaceTarget", 180, 0)));
    assert.deepEqual(e, { tipo: "solo cargado", funciones: 1 });
    assert.equal(ejercido(e), false);
    assert.match(ejercicioLegible(e), /SOLO CARGADO/);
  });

  it("la misma función llamada siete veces SÍ es ejercida", () => {
    // Y es el MISMO fichero con la otra batería: si el veredicto no cambiara
    // entre estas dos entradas, el candado no distinguiría nada.
    const e = ejercicioDeFichero(cobertura(fn("", 0, 1), fn("__name", 47, 1), fn("resolvePlaceTarget", 180, 7)));
    assert.deepEqual(e, { tipo: "ejercido", llamadas: 7 });
    assert.equal(ejercido(e), true);
  });

  it("el ayudante del transpilador no cuenta como código de la casa", () => {
    // `__name` se llama SIEMPRE al cargar un fichero con funciones con nombre.
    // Si contara, todo fichero importado saldría «ejercido» y el candado sería
    // exactamente el de CARGAR con otro nombre.
    assert.deepEqual(ejercicioDeFichero(cobertura(fn("", 0, 1), fn("__name", 47, 3))), {
      tipo: "sin funciones propias",
    });
    assert.equal(esAyudanteDelTranspilador("__name"), true);
    assert.equal(esAyudanteDelTranspilador("__toESM"), true);
    assert.equal(esAyudanteDelTranspilador("resolvePlaceTarget"), false);
  });

  it("una flecha ANÓNIMA sí es código de la casa: el envoltorio se reconoce por el offset", () => {
    // El envoltorio del módulo también se llama `""`, así que filtrar por nombre
    // vacío se cargaría todos los callbacks del fichero. Las dos direcciones:
    // una flecha anónima llamada ejerce, y la misma sin llamar no.
    assert.deepEqual(ejercicioDeFichero(cobertura(fn("", 0, 1), fn("", 230, 8))), {
      tipo: "ejercido",
      llamadas: 8,
    });
    assert.deepEqual(ejercicioDeFichero(cobertura(fn("", 0, 1), fn("", 230, 0))), {
      tipo: "solo cargado",
      funciones: 1,
    });
  });

  it("un fichero sin más JavaScript que su nivel superior se ejerce al cargarlo", () => {
    // Una tabla de constantes: sus mutantes se EJECUTAN al importar, así que si
    // sobreviven es deuda de test de verdad y no medida ausente. Decir aquí «no
    // ejercido» mandaría a escribir un test que ya existe.
    assert.deepEqual(ejercicioDeFichero(cobertura(fn("", 0, 1))), { tipo: "sin funciones propias" });
    assert.equal(ejercido({ tipo: "sin funciones propias" }), true);
  });

  it("no aparecer en la cobertura y aparecer sin ejecutarse NO son lo mismo", () => {
    // Uno manda a mirar los imports de la batería y el otro a mirar las
    // llamadas. Colapsarlos daría un mensaje que no se puede cumplir.
    assert.deepEqual(ejercicioDeFichero(undefined), { tipo: "sin cargar" });
    // Declarado en la cobertura pero con el envoltorio a cero: lo cargó otro
    // hilo y aquí no corrió.
    assert.deepEqual(ejercicioDeFichero(cobertura(fn("", 0, 0), fn("algo", 100, 0))), { tipo: "sin cargar" });
    assert.match(ejercicioLegible({ tipo: "sin cargar" }), /SIN CARGAR/);
  });
});

describe("ejercicio de batería · de qué ficheros habla", () => {
  it("solo se juzgan los ficheros del paquete", () => {
    const raiz = "/repo/nefan-core";
    assert.equal(rutaDelScript("file:///repo/nefan-core/src/world-map/types.ts", raiz), "src/world-map/types.ts");
    assert.equal(rutaDelScript("file:///repo/nefan-core/node_modules/tsx/x.mjs", raiz), undefined);
    assert.equal(rutaDelScript("file:///repo/nefan-html/src/main.ts", raiz), undefined);
    assert.equal(rutaDelScript("node:internal/modules/esm/loader", raiz), undefined);
  });

  it("un fuente que declara un `__algo` PARA EL CANDADO, en vez de suponer", () => {
    // Si la casa declarara un identificador con el prefijo del transpilador, el
    // filtro de ayudantes descartaría código propio y el fichero saldría «solo
    // cargado» sin serlo. Medido el 2026-09-17: cero ficheros de `src/`.
    assert.equal(fuenteConNombresReservados("export function __name(x) { return x; }"), true);
    assert.equal(fuenteConNombresReservados("const __tabla = 1;"), true);
    assert.equal(fuenteConNombresReservados("export function resolvePlaceTarget() {}"), false);
    // Lo que NO es una declaración tampoco lo es aquí: mencionar el prefijo en
    // un comentario o en una cadena no impide juzgar el fichero.
    assert.equal(fuenteConNombresReservados("// esbuild inyecta __name al cargar"), false);
  });

  it("los fallos de un módulo salen ordenados y solo son los que no se ejercen", () => {
    const ficheros: Record<string, Ejercicio> = {
      "src/z.ts": { tipo: "solo cargado", funciones: 2 },
      "src/a.ts": { tipo: "ejercido", llamadas: 3 },
      "src/m.ts": { tipo: "sin cargar" },
      "src/b.ts": { tipo: "sin funciones propias" },
    };
    assert.deepEqual(
      fallosDelModulo("world-map", ficheros).map((f) => f.fichero),
      ["src/m.ts", "src/z.ts"],
    );
    assert.deepEqual(fallosDelModulo("world-map", ficheros)[0], {
      modulo: "world-map",
      fichero: "src/m.ts",
      ejercicio: { tipo: "sin cargar" },
    });
    // Y con todo ejercido no hay fallo: sin esta dirección, una función que
    // devolviera siempre la lista entera pasaría el aserto de arriba.
    assert.deepEqual(fallosDelModulo("world-map", { "src/a.ts": { tipo: "ejercido", llamadas: 1 } }), []);
  });

  it("las baterías simultáneas nunca pasan de los núcleos", () => {
    // El mismo invariante que la corrida de mutación: cada batería es UN proceso
    // (los node_args llevan `--test-isolation=none`), y se deja un núcleo para
    // quien esté usando la máquina.
    for (const nucleos of [1, 2, 4, 8, 12, 16, 64]) {
      const n = baterisAlaVez(nucleos);
      assert.ok(n >= 1, `con ${nucleos} núcleos no correría ninguna batería`);
      assert.ok(n <= nucleos, `con ${nucleos} núcleos saldrían ${n} procesos`);
      assert.ok(n <= 8, "el tope duro existe para que una máquina grande no se coma el disco de temporales");
    }
    assert.equal(baterisAlaVez(16), 8);
    assert.equal(baterisAlaVez(2), 1);
  });
});
