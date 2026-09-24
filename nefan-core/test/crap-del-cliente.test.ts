/** El CRAP del cliente: la misma medida que el core, sobre OTRO universo (#664).
 *
 *  El cliente entra en complejidad × cobertura con su propio comando, su propio
 *  contrato (`data/contract/client-crap.json`) y su propia cola en `deuda`. Lo
 *  que estos casos fijan es lo que lo hace distinto del core, y por qué:
 *
 *   · el universo es EL ÁRBOL ENTERO, no lo que un test carga: lo que ningún
 *     test importa entra con sus líneas de código a 0 hits. Sin eso la medida
 *     no es monótona —un test nuevo que IMPORTA un fichero hasta hoy invisible
 *     mete sus funciones sin cubrir y pone el gate rojo por añadir un test—;
 *   · lo que el lcov trae de otro paquete (`../nefan-core/…`, que el banco del
 *     cliente carga por ruta relativa) se descarta, o el core se mediría dos
 *     veces y la segunda con una muestra peor;
 *   · el gate es por FUNCIÓN: cada una ≤ tope, o ≤ su foto si ya lo superaba.
 *
 *  Todo con datos sintéticos, porque en CI `npm test` corre ANTES que
 *  `coverage` (el mismo motivo que `enColaDeCrap` en `deuda.test.ts`). Lo único
 *  que lee el disco es el contrato y el FUENTE del cliente, y ninguno de los dos
 *  depende de qué tests existan: son monótonos respecto al banco. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ContratoClienteSchema,
  MEDIDA_CLIENTE,
  ThresholdsSchema,
  claveDe,
  crapRows,
  fotoDeCongeladas,
  functionsOf,
  leerContratoCliente,
  lineHitsFromLcov,
  medirFuentes,
  veredictoCliente,
  type ContratoCliente,
  type CrapRow,
} from "../scripts/crap-score.js";
import { cabeceraDe, enColaDelCliente } from "../scripts/deuda.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const EL_ARBOL = { arboles: ["src/"], universo: "el-arbol" } as const;
const LO_CARGADO = { arboles: ["src/"], universo: "lo-cargado" } as const;

/** Un fichero con una función de complejidad `cx` (cx−1 `if`), que ocupa las
 *  líneas 1..cx+2. */
const funcionDe = (nombre: string, cx: number): string =>
  [
    `export function ${nombre}(a: number): number {`,
    ...Array.from({ length: cx - 1 }, (_, i) => `  if (a === ${i}) return ${i};`),
    "  return -1;",
    "}",
  ].join("\n");

const lcovDe = (...ficheros: [string, Record<number, number>][]): string =>
  ficheros
    .map(([sf, das]) =>
      [`SF:${sf}`, ...Object.entries(das).map(([l, h]) => `DA:${l},${h}`), "end_of_record"].join("\n"),
    )
    .join("\n");

const contrato = (congeladas: ContratoCliente["congeladas"] = []): ContratoCliente => ({
  $comment: "x",
  _lo_que_esto_NO_sujeta: ["x"],
  tope: 73,
  objetivo: 30,
  congeladas,
});

describe("CRAP del cliente · qué se mide", () => {
  it("lo del lcov que es de OTRO paquete se descarta y se cuenta, sin dar filas", () => {
    const fuentes = new Map([["src/a.ts", funcionDe("a", 2)]]);
    const hits = lineHitsFromLcov(
      lcovDe(["src/a.ts", { 1: 1, 2: 1, 3: 1, 4: 1 }], ["../nefan-core/src/x.ts", { 1: 0, 2: 0 }]),
    );
    const m = medirFuentes(hits, fuentes, EL_ARBOL);
    assert.deepEqual(m.descartados, ["../nefan-core/src/x.ts"]);
    assert.ok(m.filas.every((f) => f.file === "src/a.ts"));
    assert.equal(m.filas.length, 1);
  });

  it("un fichero que ningún test carga ENTRA a cobertura 0 con el universo del árbol", () => {
    const fuentes = new Map([
      ["src/a.ts", funcionDe("a", 2)],
      ["src/b.ts", funcionDe("b", 9)],
    ]);
    const hits = lineHitsFromLcov(lcovDe(["src/a.ts", { 1: 1, 2: 1, 3: 1, 4: 1 }]));
    const m = medirFuentes(hits, fuentes, EL_ARBOL);
    const b = m.filas.find((f) => f.file === "src/b.ts");
    assert.ok(b, "src/b.ts desapareció de la medida: es justo lo que no puede pasar");
    assert.equal(b.coverage, 0);
    assert.equal(b.crap, 9 * 9 + 9);
    assert.deepEqual(m.sinCargar, { ficheros: 1, lineas: 11, deFicheros: 2 });
    // …y con el universo del core, lo mismo NO entra pero se cuenta igual.
    const core = medirFuentes(hits, fuentes, LO_CARGADO);
    assert.equal(
      core.filas.find((f) => f.file === "src/b.ts"),
      undefined,
    );
    assert.deepEqual(core.sinCargar, m.sinCargar);
  });

  it("una línea del lcov de un fichero que ya no está en el árbol para la medida", () => {
    const hits = lineHitsFromLcov(lcovDe(["src/muerto.ts", { 1: 1 }]));
    assert.throws(() => medirFuentes(hits, new Map(), EL_ARBOL), /ya no están en el árbol/);
  });

  it("sin lcov del cliente el comando FALLA en vez de dar una cola vacía", () => {
    assert.throws(
      () => crapRows({ ...MEDIDA_CLIENTE, lcov: join(coreRoot, "no-existe", "lcov.info") }),
      /Genera la cobertura primero/,
    );
  });
});

describe("CRAP del cliente · la medida es monótona respecto a los tests", () => {
  // El fichero `c.ts`: una constante de módulo y una función de cx 10. Hoy
  // ningún test lo carga; mañana uno lo IMPORTA sin llamar a nada.
  const texto = ["export const K = 1;", "", funcionDe("pinta", 10)].join("\n");
  const fuentes = new Map([["src/c.ts", texto]]);
  const congelado = contrato([{ fichero: "src/c.ts", funcion: "pinta", crap: 110 }]);

  it("IMPORTAR un fichero invisible no sube ninguna clave ni cambia el veredicto", () => {
    const antes = medirFuentes(new Map(), fuentes, EL_ARBOL);
    // Lo que el reporter escribe al solo cargar el módulo: la línea de nivel de
    // módulo y la cabecera de la función ejecutadas, el cuerpo a 0.
    const das: Record<number, number> = { 1: 1, 3: 1 };
    for (let l = 4; l <= 14; l++) das[l] = 0;
    const despues = medirFuentes(lineHitsFromLcov(lcovDe(["src/c.ts", das])), fuentes, EL_ARBOL);
    for (const f of despues.filas) {
      const a = antes.filas.find((x) => claveDe(x) === claveDe(f) && x.file === f.file);
      assert.ok(a);
      assert.ok(f.crap <= a.crap, `${claveDe(f)} subió de ${a.crap} a ${f.crap} por IMPORTAR su fichero`);
    }
    assert.deepEqual(veredictoCliente(despues.filas, congelado).rojas, []);
    assert.deepEqual(veredictoCliente(antes.filas, congelado).rojas, []);
  });

  it("con universo «lo cargado» el mismo import SÍ pondría rojo: por eso el cliente no lo usa", () => {
    // El negativo del caso de arriba: la opción B del plan, medida.
    const sinFoto = contrato();
    assert.deepEqual(veredictoCliente(medirFuentes(new Map(), fuentes, LO_CARGADO).filas, sinFoto).rojas, []);
    const das: Record<number, number> = { 1: 1, 3: 1 };
    for (let l = 4; l <= 14; l++) das[l] = 0;
    const cargado = medirFuentes(lineHitsFromLcov(lcovDe(["src/c.ts", das])), fuentes, LO_CARGADO);
    assert.equal(veredictoCliente(cargado.filas, sinFoto).rojas.length, 1);
  });

  it("una congelada que BAJA no da rojo: da un aviso de que la foto sobra", () => {
    const das: Record<number, number> = {};
    for (let l = 1; l <= 14; l++) das[l] = 1;
    const cubierto = medirFuentes(lineHitsFromLcov(lcovDe(["src/c.ts", das])), fuentes, EL_ARBOL);
    const v = veredictoCliente(cubierto.filas, congelado);
    assert.deepEqual(v.rojas, []);
    assert.equal(v.sobran.length, 1);
    assert.equal(v.sobran[0].funcion, "pinta");
  });
});

describe("CRAP del cliente · el gate muerde", () => {
  const medir = (texto: string): CrapRow[] =>
    medirFuentes(new Map(), new Map([["src/nuevo.ts", texto]]), EL_ARBOL).filas;

  it("una función NUEVA de complejidad 9 sin test pasa del tope 73 y da rojo con su nombre", () => {
    const v = veredictoCliente(medir(funcionDe("nueva", 9)), contrato());
    assert.equal(v.rojas.length, 1);
    assert.equal(v.rojas[0].funcion, "nueva");
    assert.equal(v.rojas[0].crap, 90);
  });

  it("…y una de complejidad 8 sin test (CRAP 72) cabe: el borde es el del core", () => {
    assert.deepEqual(veredictoCliente(medir(funcionDe("nueva", 8)), contrato()).rojas, []);
  });

  it("una congelada que GANA complejidad sube de su foto y da rojo", () => {
    const congelado = contrato([{ fichero: "src/nuevo.ts", funcion: "nueva", crap: 90 }]);
    assert.deepEqual(veredictoCliente(medir(funcionDe("nueva", 9)), congelado).rojas, []);
    const v = veredictoCliente(medir(funcionDe("nueva", 10)), congelado);
    assert.equal(v.rojas.length, 1);
    assert.equal(v.rojas[0].limite, 90);
  });

  it("un RENOMBRADO se reconoce: la roja lleva la congelada que ya no está con su misma cifra", () => {
    const congelado = contrato([{ fichero: "src/nuevo.ts", funcion: "vieja", crap: 90 }]);
    const v = veredictoCliente(medir(funcionDe("renombrada", 9)), congelado);
    assert.equal(v.rojas.length, 1);
    assert.deepEqual(v.rojas[0].renombradoDe, { fichero: "src/nuevo.ts", funcion: "vieja" });
    // …y una función nueva de verdad (otra cifra) no se confunde con él.
    const otra = veredictoCliente(medir(funcionDe("otra", 10)), congelado);
    assert.equal(otra.rojas[0].renombradoDe, undefined);
  });

  it("la foto sale de la misma función, redondeada HACIA ARRIBA a 0,1, y el mismo árbol la pasa", () => {
    const filas = medir([funcionDe("a", 9), funcionDe("b", 3)].join("\n"));
    // Una cobertura parcial para que el CRAP no sea entero.
    const parcial = filas.map((f) => (f.name === "a" ? { ...f, coverage: 0.1, crap: 81 * 0.729 + 9 } : f));
    const foto = fotoDeCongeladas(parcial, 30);
    assert.deepEqual(foto, [{ fichero: "src/nuevo.ts", funcion: "a", crap: 68.1 }]);
    assert.deepEqual(veredictoCliente(parcial, { ...contrato(foto), tope: 30 }).rojas, []);
  });
});

describe("CRAP del cliente · la clave de una función", () => {
  it("una anónima se nombra por su padre con nombre más cercano, no se funde con las del fichero", () => {
    const texto = [
      "export function uno(xs: number[]) {",
      "  return xs.map((x) => (x ? 1 : 2));",
      "}",
      "export function dos(xs: number[]) {",
      "  return xs.map((x) => (x ? 1 : 2));",
      "}",
      "const suelta = [1].map((y) => y);",
    ].join("\n");
    const claves = functionsOf(texto).map(claveDe);
    assert.deepEqual(claves, [
      "uno",
      "uno>(anónima)@xs.map()",
      "dos",
      "dos>(anónima)@xs.map()",
      "<módulo>>(anónima)@[1].map()",
    ]);
  });

  it("dos anónimas bajo el MISMO padre no comparten clave: la forma las separa, y el `#n` a las gemelas", () => {
    const texto = [
      'window.addEventListener("keydown", (e) => e);',
      'window.addEventListener("keyup", (e) => e);',
      "bus.on((a) => a);",
      "bus.on((b) => b);",
      "export const tabla = { f: () => 1 };",
    ].join("\n");
    assert.deepEqual(functionsOf(texto).map(claveDe), [
      '<módulo>>(anónima)@window.addEventListener("keydown")',
      '<módulo>>(anónima)@window.addEventListener("keyup")',
      "<módulo>>(anónima)@bus.on()",
      "<módulo>>(anónima)@bus.on()#2",
      "f",
    ]);
  });

  it("ES H1 DE QA: un listener NUEVO de complejidad 28 junto a una anónima congelada da rojo", () => {
    // Antes de la forma, las dos eran `<módulo>>(anónima)` y la nueva (812) se
    // escondía tras la foto de la vieja (1122): entraba en verde.
    const ifs = (n: number): string =>
      Array.from({ length: n - 1 }, (_, i) => `  if (e === ${i}) return;`).join("\n");
    const vieja = `narrativeClient.onStatusDeLaPartida((e) => {\n${ifs(33)}\n});`;
    const nueva = `window.addEventListener("keyup", (e) => {\n${ifs(28)}\n});`;
    const medir = (t: string): CrapRow[] =>
      medirFuentes(new Map(), new Map([["src/main.ts", t]]), EL_ARBOL).filas;
    const foto = fotoDeCongeladas(medir(vieja), 73);
    assert.equal(foto.length, 1);
    const antes = veredictoCliente(medir(vieja), contrato(foto));
    assert.deepEqual(antes.rojas, []);
    const v = veredictoCliente(medir(`${vieja}\n${nueva}`), contrato(foto));
    assert.equal(v.rojas.length, 1);
    assert.equal(v.rojas[0].funcion, '<módulo>>(anónima)@window.addEventListener("keyup")');
    assert.equal(v.rojas[0].crap, 28 * 28 + 28);
    assert.equal(v.rojas[0].limite, 73);
  });

  it("la clave no lleva la línea: insertar código delante no la mueve", () => {
    const t = 'bus.on("x", (a) => a);';
    assert.deepEqual(functionsOf(`\n\nconst k = 1;\n${t}`).map(claveDe), functionsOf(t).map(claveDe));
  });

  it("el `name` no cambia (la salida del core es la misma) y `padre` solo aparece si existe", () => {
    const [f, anon] = functionsOf("function f() { return () => 1; }");
    assert.equal(anon.name, "(anónima)");
    assert.equal(anon.padre, "f");
    assert.equal("padre" in f, false);
  });
});

describe("CRAP del cliente · el contrato", () => {
  it("el contrato real parsea con el esquema estricto", () => {
    const c = leerContratoCliente();
    assert.equal(c.tope, 73);
    assert.ok(c.congeladas.length > 0);
  });

  it("el esquema rechaza un campo de más, un CRAP negativo y un tope ausente", () => {
    const base = contrato([{ fichero: "src/a.ts", funcion: "f", crap: 100 }]);
    assert.equal(ContratoClienteSchema.safeParse(base).success, true);
    assert.equal(ContratoClienteSchema.safeParse({ ...base, suelo: 50 }).success, false);
    assert.equal(
      ContratoClienteSchema.safeParse({
        ...base,
        congeladas: [{ fichero: "src/a.ts", funcion: "f", crap: -1 }],
      }).success,
      false,
    );
    const { tope: _tope, ...sinTope } = base;
    assert.equal(ContratoClienteSchema.safeParse(sinTope).success, false);
  });

  it("una congelada POR DEBAJO del tope, o repetida, no es una foto: se rechaza", () => {
    const bajo = contrato([{ fichero: "src/a.ts", funcion: "f", crap: 50 }]);
    assert.equal(ContratoClienteSchema.safeParse(bajo).success, false);
    const doble = contrato([
      { fichero: "src/a.ts", funcion: "f", crap: 100 },
      { fichero: "src/a.ts", funcion: "f", crap: 120 },
    ]);
    assert.equal(ContratoClienteSchema.safeParse(doble).success, false);
  });

  it("cada congelada nombra un fichero del cliente que existe y una función que está en él", () => {
    // Se decide sobre el FUENTE, sin lcov: no depende de qué tests existan.
    const htmlRoot = join(coreRoot, "..", "nefan-html");
    const perdidas: string[] = [];
    for (const c of leerContratoCliente().congeladas) {
      const abs = join(htmlRoot, c.fichero);
      if (!existsSync(abs)) {
        perdidas.push(`${c.fichero} (no existe)`);
        continue;
      }
      const claves = new Set(functionsOf(readFileSync(abs, "utf-8"), c.fichero).map(claveDe));
      if (!claves.has(c.funcion)) perdidas.push(`${c.fichero} · ${c.funcion}`);
    }
    assert.deepEqual(
      perdidas,
      [],
      "congeladas que ya no nombran nada: la función se renombró o se borró. Regenera sus entradas " +
        "(`npm run crap -- --foto` en nefan-html) y quita las que sobran de data/contract/client-crap.json",
    );
  });

  it("quality-thresholds.json también se valida: un campo de más ya no pasa en silencio", () => {
    const real = JSON.parse(
      readFileSync(join(coreRoot, "data", "contract", "quality-thresholds.json"), "utf-8"),
    );
    assert.equal(ThresholdsSchema.safeParse(real).success, true);
    assert.equal(ThresholdsSchema.safeParse({ ...real, cliente: { max: 1 } }).success, false);
    assert.equal(ThresholdsSchema.safeParse({ ...real, crap: { objetivo: 30 } }).success, false);
  });
});

describe("CRAP del cliente · la cola de deuda", () => {
  const fila = (file: string, name: string, complexity: number, coverage: number): CrapRow => ({
    file,
    name,
    startLine: 1,
    endLine: 10,
    complexity,
    coverage,
    crap: complexity ** 2 * (1 - coverage) ** 3 + complexity,
  });

  it("la función a medias sale como item propio; las de 0 % se agrupan por fichero", () => {
    const items = enColaDelCliente(
      [
        fila("src/a.ts", "parcial", 12, 0.3),
        fila("src/b.ts", "x", 10, 0),
        fila("src/b.ts", "y", 8, 0),
        fila("src/b.ts", "bien", 3, 0),
      ],
      30,
    );
    assert.equal(items.length, 2);
    assert.match(items[0].donde, /^src\/b\.ts$/);
    assert.match(items[0].que, /2 funciones a 0 %/);
    assert.equal(items[0].peso, 110);
    assert.match(items[1].donde, /^src\/a\.ts:1$/);
    assert.match(items[1].que, /^parcial/);
  });

  it("40 ficheros enteros a 0 % dan como mucho 40 items, no uno por función", () => {
    const filas: CrapRow[] = [];
    for (let i = 0; i < 40; i++) for (let j = 0; j < 15; j++) filas.push(fila(`src/f${i}.ts`, `g${j}`, 9, 0));
    assert.ok(enColaDelCliente(filas, 30).length <= 40);
  });

  it("sin lcov del cliente, el titular dice «cliente» entre lo sin medir", () => {
    const out = cabeceraDe([
      { titulo: "Complejidad × cobertura", fuente: "x", items: [] },
      {
        titulo: "Cliente — complejidad × cobertura",
        fuente: "x",
        aviso: "sin medir — corre algo",
        items: [],
      },
    ]);
    assert.match(out, /Sin medir: cliente/);
  });
});
