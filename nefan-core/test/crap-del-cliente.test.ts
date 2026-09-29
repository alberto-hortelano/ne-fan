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
  CON_FOTO_CLIENTE,
  CON_FOTO_SCRIPTS,
  ContratoClienteSchema,
  ContratoScriptsSchema,
  MEDIDA_CLIENTE,
  MEDIDA_CORE,
  MEDIDA_SCRIPTS,
  ThresholdsSchema,
  apretarCongeladas,
  claveDe,
  crap,
  fallosDelCore,
  crapRows,
  fotoDeCongeladas,
  functionsOf,
  informeConFoto,
  leerContratoCliente,
  leerContratoScripts,
  lineHitsFromLcov,
  medirFuentes,
  modoDelCli,
  planDeApretar,
  reescribirCongeladas,
  textoDeApretar,
  veredictoCliente,
  type ContratoCliente,
  type CrapRow,
} from "../scripts/crap-score.js";
import { cabeceraDe, enColaDelCliente, reglaDeScripts } from "../scripts/deuda.js";

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

describe("--apretar · el trinquete que baja (#769)", () => {
  // Una función de cx 10 que hoy mide `hoy` de CRAP: la fila se fabrica a mano
  // porque lo que se prueba es la regla, no la medida.
  const filaDe = (funcion: string, crap: number): CrapRow => ({
    name: funcion,
    file: "src/a.ts",
    startLine: 1,
    endLine: 10,
    complexity: 10,
    coverage: 0,
    crap,
  });
  const congelada = (funcion: string, crap: number) => ({ fichero: "src/a.ts", funcion, crap });

  it("una congelada que hoy mide MÁS no sube: se queda en su foto", () => {
    const c = contrato([congelada("f", 500)]);
    const r = apretarCongeladas([filaDe("f", 600)], c);
    assert.deepEqual(r.congeladas, c.congeladas);
    assert.deepEqual(r.cambios, []);
  });

  it("una roja NUEVA sin foto no entra: apretar no añade claves (eso es --foto)", () => {
    const c = contrato([congelada("f", 500)]);
    const r = apretarCongeladas([filaDe("f", 500), filaDe("nueva", 900)], c);
    assert.deepEqual(
      r.congeladas.map((x) => x.funcion),
      ["f"],
    );
  });

  it("una que BAJÓ se aprieta a su cifra de hoy, redondeada hacia arriba a 0,1", () => {
    const r = apretarCongeladas([filaDe("f", 480.02)], contrato([congelada("f", 500)]));
    assert.deepEqual(r.congeladas, [congelada("f", 480.1)]);
    assert.deepEqual(r.cambios, [
      { fichero: "src/a.ts", funcion: "f", congelada: 500, nueva: 480.1, motivo: "bajo" },
    ]);
  });

  it("una que ya cabe en el tope se QUITA, y una cuya función no está también", () => {
    const r = apretarCongeladas(
      [filaDe("cabe", 50), filaDe("sigue", 200)],
      contrato([congelada("cabe", 120), congelada("borrada", 300), congelada("sigue", 200)]),
    );
    assert.deepEqual(r.congeladas, [congelada("sigue", 200)]);
    assert.deepEqual(
      r.cambios.map((c) => [c.funcion, c.motivo, c.nueva]),
      [
        ["cabe", "cabe-en-el-tope", undefined],
        ["borrada", "no-esta", undefined],
      ],
    );
  });

  it("lo que devuelve sigue siendo un contrato válido: ninguna congelada bajo el tope", () => {
    const c = contrato([congelada("f", 500), congelada("g", 120)]);
    const r = apretarCongeladas([filaDe("f", 73.05), filaDe("g", 73)], c);
    assert.equal(ContratoClienteSchema.safeParse({ ...c, congeladas: r.congeladas }).success, true);
    assert.deepEqual(r.congeladas, [congelada("f", 73.1)]);
  });

  it("con rojas delante SE NIEGA: una «que no está» puede ser un renombrado", () => {
    // `vieja` desaparece y aparece `nueva` con su misma cifra: la pista del
    // renombrado es la entrada vieja, y quitarla ahora la borraría.
    const c = contrato([congelada("vieja", 110)]);
    const plan = planDeApretar([filaDe("nueva", 110)], c);
    assert.equal(plan.ok, false);
    assert.ok(!plan.ok && plan.rojas[0].renombradoDe?.funcion === "vieja");
    const sano = planDeApretar([filaDe("vieja", 100)], c);
    assert.ok(sano.ok);
    assert.deepEqual(sano.congeladas, [congelada("vieja", 100)]);
  });
});

describe("CRAP de scripts/ · su contrato (#769)", () => {
  const base = {
    $comment: "x",
    _lo_que_esto_NO_sujeta: ["x"],
    tope: 73,
    objetivo: 30,
    suelo_cobertura: { min: 79, nota: "x" },
    congeladas: [{ fichero: "scripts/a.ts", funcion: "main", crap: 200 }],
  };

  it("el contrato real parsea, con suelo, y su foto solo nombra scripts/", () => {
    const c = leerContratoScripts();
    assert.ok(c.suelo_cobertura && c.suelo_cobertura.min > 0);
    assert.ok(c.congeladas.every((g) => g.fichero.startsWith("scripts/")));
  });

  it("cada medida congela SOLO su árbol: src/ no cabe en la de scripts, ni scripts/ en la del cliente", () => {
    assert.equal(ContratoScriptsSchema.safeParse(base).success, true);
    const conSrc = { ...base, congeladas: [{ fichero: "src/a.ts", funcion: "f", crap: 200 }] };
    assert.equal(ContratoScriptsSchema.safeParse(conSrc).success, false);
    const { suelo_cobertura: _s, ...cliente } = base;
    assert.equal(ContratoClienteSchema.safeParse(cliente).success, false, "scripts/ en el del cliente");
    assert.equal(
      ContratoClienteSchema.safeParse({ ...cliente, congeladas: [] }).success,
      true,
      "el mismo contrato sin la clave ajena sí vale: lo que rechaza es el prefijo",
    );
  });

  it("el suelo es obligatorio donde se declara y prohibido donde no", () => {
    const { suelo_cobertura: _s, ...sinSuelo } = base;
    assert.equal(ContratoScriptsSchema.safeParse(sinSuelo).success, false);
    assert.equal(
      ContratoClienteSchema.safeParse({ ...contrato(), suelo_cobertura: { min: 1, nota: "x" } }).success,
      false,
    );
  });

  it("cada congelada de scripts nombra un fichero que existe y una función que está en él", () => {
    const perdidas: string[] = [];
    for (const c of leerContratoScripts().congeladas) {
      const abs = join(coreRoot, c.fichero);
      if (!existsSync(abs)) {
        perdidas.push(`${c.fichero} (no existe)`);
        continue;
      }
      const claves = new Set(functionsOf(readFileSync(abs, "utf-8"), c.fichero).map(claveDe));
      if (!claves.has(c.funcion)) perdidas.push(`${c.fichero} · ${c.funcion}`);
    }
    assert.deepEqual(perdidas, [], "regenera con `npm run crap -- --scripts --foto` o aprieta con `--apretar`");
  });

  it("la cola de deuda de scripts dice lo que NO cuenta, y ofrece --apretar cuando sobra una", () => {
    const regla = reglaDeScripts();
    const m = {
      filas: [],
      cobGlobal: 80,
      lineasMedidas: 100,
      sinCargar: { ficheros: 17, lineas: 1947, deFicheros: 29 },
      descartados: [],
    };
    const avisos = regla.avisos(m);
    assert.match(avisos[0], /^17 de 29 ficheros \(1947 líneas de código\) no los carga ningún test y NO cuentan/);
    // Con filas vacías, TODA congelada real «no está»: sobran todas.
    assert.ok(leerContratoScripts().congeladas.length > 0, "sin congeladas este aserto no probaría nada");
    assert.match(avisos[1], /scripts-crap\.json sobran en su cifra: `npm run crap -- --scripts --apretar`/);
  });

  it("MEDIDA_SCRIPTS mide scripts/ con el lcov del core y SOLO lo cargado", () => {
    assert.deepEqual(MEDIDA_SCRIPTS.arboles, ["scripts/"]);
    assert.equal(MEDIDA_SCRIPTS.universo, "lo-cargado");
    assert.equal(MEDIDA_SCRIPTS.lcov, MEDIDA_CORE.lcov);
    assert.equal(MEDIDA_CORE.universo, "el-arbol", "el core mide el árbol entero desde #769");
  });
});

describe("el CLI de las medidas con foto decide en funciones puras (#769)", () => {
  const filaDe = (funcion: string, crap: number): CrapRow => ({
    name: funcion,
    file: "scripts/a.ts",
    startLine: 3,
    endLine: 10,
    complexity: 10,
    coverage: 0,
    crap,
  });
  const medicion = (filas: CrapRow[], cobGlobal: number) => ({
    filas,
    cobGlobal,
    lineasMedidas: 1000,
    sinCargar: { ficheros: 2, lineas: 40, deFicheros: 5 },
    descartados: [],
  });
  const conSuelo = (min: number, congeladas: ContratoCliente["congeladas"] = []): ContratoCliente => ({
    ...contrato(congeladas),
    suelo_cobertura: { min, nota: "x" },
  });

  it("el suelo muerde: por debajo es un fallo con la cifra, y el margen se imprime en puntos y líneas", () => {
    const rojo = informeConFoto(CON_FOTO_SCRIPTS, medicion([], 80), conSuelo(99));
    assert.deepEqual(rojo.fallos, ["la cobertura de líneas de scripts bajó a 80.00% (mínimo 99%)"]);
    assert.ok(rojo.resumen.includes("Cobertura mínima: 99% — ahora 80.00% (margen -19.00 puntos ≈ -190 líneas)."));
    const verde = informeConFoto(CON_FOTO_SCRIPTS, medicion([], 80), conSuelo(79.2));
    assert.deepEqual(verde.fallos, []);
    assert.ok(verde.resumen.some((l) => l.includes("margen 0.80 puntos ≈ 8 líneas")));
  });

  it("una función sobre el tope es un fallo que avisa de que lo-cargado puede ponerse rojo por un test", () => {
    const inf = informeConFoto(CON_FOTO_SCRIPTS, medicion([filaDe("main", 90)], 90), conSuelo(50));
    assert.equal(inf.fallos.length, 1);
    assert.match(inf.fallos[0], /90\.0 > 73 {2}main · scripts\/a\.ts:3/);
    assert.match(inf.fallos[0], /¿Fichero recién cargado\?/);
    // El cliente mide el árbol entero: ahí esa coletilla sería mentira.
    const cliente = informeConFoto(CON_FOTO_CLIENTE, medicion([filaDe("main", 90)], 90), contrato());
    assert.doesNotMatch(cliente.fallos[0], /recién cargado/);
    assert.ok(cliente.resumen.some((l) => l.startsWith("Sin suelo de cobertura: client-crap.json")));
  });

  it("una congelada que sobra avisa con el verbo que la baja, sin fallo", () => {
    const c = conSuelo(50, [{ fichero: "scripts/a.ts", funcion: "main", crap: 200 }]);
    const inf = informeConFoto(CON_FOTO_SCRIPTS, medicion([filaDe("main", 90)], 90), c);
    assert.deepEqual(inf.fallos, []);
    assert.match(inf.aviso ?? "", /`npm run crap -- --scripts --apretar` la baja/);
    assert.match(inf.aviso ?? "", /200 → 90\.0 {2}main · scripts\/a\.ts/);
  });

  it("cada medida recomienda SU orden: el cliente sin --scripts, scripts con él (QA #769, H2)", () => {
    // Un renombrado: la congelada `vieja` ya no está y `nueva` tiene su cifra.
    const renombrado = (cf: typeof CON_FOTO_CLIENTE) =>
      informeConFoto(
        cf,
        medicion([filaDe("nueva", 110)], 90),
        cf === CON_FOTO_SCRIPTS
          ? conSuelo(50, [{ fichero: "scripts/a.ts", funcion: "vieja", crap: 110 }])
          : contrato([{ fichero: "scripts/a.ts", funcion: "vieja", crap: 110 }]),
      );
    const s = renombrado(CON_FOTO_SCRIPTS);
    assert.match(s.fallos[0], /`npm run crap -- --scripts --foto`/);
    assert.match(s.aviso ?? "", /`npm run crap -- --scripts --apretar`/);
    const c = renombrado(CON_FOTO_CLIENTE);
    assert.match(c.fallos[0], /`npm run crap -- --foto`/);
    assert.match(c.aviso ?? "", /`npm run crap -- --apretar`/);
    const niegaCliente = textoDeApretar(planDeApretar([filaDe("nueva", 110)], contrato([])), 0, CON_FOTO_CLIENTE);
    assert.match(niegaCliente.texto, /`npm run crap -- --check` dice cuáles/);
  });

  it("--apretar: la negativa sale con error, «nada» no escribe y un cambio sí", () => {
    const c = conSuelo(50, [{ fichero: "scripts/a.ts", funcion: "main", crap: 200 }]);
    const niega = textoDeApretar(planDeApretar([filaDe("otra", 300)], c), 1, CON_FOTO_SCRIPTS);
    assert.deepEqual([niega.ok, niega.escribir], [false, false]);
    assert.match(niega.texto, /se niega: hay 1 función/);
    // …y manda a la orden de SU medida: en nefan-core, `npm run crap -- --check`
    // mide el core y sale verde (QA de #769, H2).
    assert.match(niega.texto, /`npm run crap -- --scripts --check` dice cuáles/);
    const nada = textoDeApretar(planDeApretar([filaDe("main", 200)], c), 1, CON_FOTO_SCRIPTS);
    assert.deepEqual([nada.ok, nada.escribir, nada.texto], [true, false, "✔ nada que apretar: las 1 congeladas siguen en su cifra"]);
    const baja = textoDeApretar(planDeApretar([filaDe("main", 150)], c), 1, CON_FOTO_SCRIPTS);
    assert.deepEqual([baja.ok, baja.escribir], [true, true]);
    assert.match(baja.texto, /200 → 150 \(bajo\) {2}main · scripts\/a\.ts/);
  });
});

/** Lo que el guion 230 medía de punta a punta con el lcov real y que el job de
 *  candados no puede pagar (QA de #769, ronda de CI): aquí, con datos
 *  sintéticos, en `npm test`. El camino verde con el lcov real lo sigue
 *  corriendo el job `nefan-core` (`crap --check` y `crap -- --scripts --check`). */
describe("el CLI de crap · lo que antes solo medía el guion 230 (#769)", () => {
  const umbral = {
    $comment: "x",
    crap: { max: 73, objetivo: 30, nota: "x" },
    cobertura_lineas: { min: 95, nota: "x" },
  };
  const fila = (file: string, name: string, cx: number, coverage: number): CrapRow => ({
    name,
    file,
    startLine: 1,
    endLine: cx + 2,
    complexity: cx,
    coverage,
    crap: crap(cx, coverage),
  });

  it("§1 · un fichero del core que nadie carga, con una función de cx 9, pone rojo el gate y lo nombra", () => {
    // El universo del core es el árbol: el fichero entra a 0 sin que el lcov lo traiga.
    const fuentes = new Map([
      ["bridge/cargado.ts", funcionDe("va", 2)],
      ["bridge/zz-sonda.ts", funcionDe("sonda", 9)],
    ]);
    const hits = lineHitsFromLcov(lcovDe(["bridge/cargado.ts", { 1: 1, 2: 1, 3: 1, 4: 1 }]));
    const m = medirFuentes(hits, fuentes, { arboles: MEDIDA_CORE.arboles, universo: MEDIDA_CORE.universo });
    const fallos = fallosDelCore({ filas: m.filas, cobGlobal: 99 }, umbral);
    assert.equal(fallos.length, 1);
    assert.match(fallos[0], /90\.0 {2}sonda · bridge\/zz-sonda\.ts:1/);
    // …y con el universo de antes, el mismo fichero no existía para el gate.
    const antes = medirFuentes(hits, fuentes, { arboles: MEDIDA_CORE.arboles, universo: "lo-cargado" });
    assert.deepEqual(fallosDelCore({ filas: antes.filas, cobGlobal: 99 }, umbral), []);
  });

  it("§2 · el suelo del core muerde por debajo y no en el borde", () => {
    assert.deepEqual(fallosDelCore({ filas: [fila("src/a.ts", "a", 3, 1)], cobGlobal: 95 }, umbral), []);
    assert.deepEqual(fallosDelCore({ filas: [], cobGlobal: 94.99 }, umbral), [
      "la cobertura de líneas bajó a 94.99% (mínimo 95%)",
    ]);
  });

  it("§3 · --apretar sobre el contrato REAL, inflado a mano, lo deja byte a byte como estaba", () => {
    const ruta = join(coreRoot, "data", "contract", "scripts-crap.json");
    const original = readFileSync(ruta, "utf-8");
    const contrato = leerContratoScripts(ruta);
    // Hoy cada congelada mide exactamente su foto: son las filas de la medida.
    const hoy = contrato.congeladas.map((c) => ({ ...fila(c.fichero, c.funcion, 10, 0), crap: c.crap }));
    const inflado = structuredClone(contrato);
    inflado.congeladas[0].crap += 50;
    inflado.congeladas.push({ fichero: "scripts/zz-inventado.ts", funcion: "nada", crap: 100 });
    const plan = planDeApretar(hoy, inflado);
    assert.ok(plan.ok);
    assert.equal(reescribirCongeladas(reescribirCongeladas(original, inflado.congeladas), plan.congeladas), original);
    // Con la foto como está, apretar no cambia nada: el fichero no se reescribe.
    const quieto = planDeApretar(hoy, contrato);
    assert.ok(quieto.ok && quieto.cambios.length === 0);
    assert.equal(reescribirCongeladas(original, contrato.congeladas), original, "reescribir sin cambios es la identidad");
  });

  it("§4 · con una roja delante, --apretar se niega (y el CLI sale con 1)", () => {
    const contrato = leerContratoScripts();
    const conRoja = structuredClone(contrato);
    conRoja.congeladas[0].crap = conRoja.tope + 1;
    const hoy = contrato.congeladas.map((c) => ({ ...fila(c.fichero, c.funcion, 10, 0), crap: c.crap }));
    const plan = planDeApretar(hoy, conRoja);
    assert.equal(plan.ok, false);
    const t = textoDeApretar(plan, conRoja.congeladas.length, CON_FOTO_SCRIPTS);
    assert.deepEqual([t.ok, t.escribir], [false, false]);
  });

  it("§5 · cada orden que recomiendan los mensajes la entiende ESTE CLI, y es de la misma medida", () => {
    // El cliente se corre en nefan-html, donde `npm run crap` ya lleva `--cliente`.
    const argvDe = (cf: typeof CON_FOTO_CLIENTE, flag: string): string[] => {
      const tras = cf.orden.replace(/^npm run crap --\s*/, "").split(/\s+/).filter(Boolean);
      return [...(cf === CON_FOTO_CLIENTE ? ["--cliente"] : []), ...tras, flag];
    };
    for (const cf of [CON_FOTO_CLIENTE, CON_FOTO_SCRIPTS]) {
      for (const flag of ["--apretar", "--foto", "--check"]) {
        const modo = modoDelCli(argvDe(cf, flag));
        assert.ok(modo.ok, `${cf.orden} ${flag}: ${!modo.ok && modo.error}`);
        assert.equal(modo.medida, cf.medida.nombre, `${cf.orden} ${flag} mide OTRA cosa`);
      }
    }
    // Lo que el H2 recomendaba en nefan-core para scripts: sale con error, o mide el core.
    assert.equal(modoDelCli(["--apretar"]).ok, false);
    assert.deepEqual(modoDelCli(["--check"]), { ok: true, medida: "core", check: true, top: 25, foto: false, apretar: false });
  });
});
