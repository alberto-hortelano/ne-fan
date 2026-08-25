/** La cola de deuda (`npm run deuda`) tiene un modo de fallo silencioso propio:
 *  quedarse vacía. Un backlog que imprime cero items se lee como "no hay deuda"
 *  y es indistinguible de un glob mal escrito o un report que no se generó —
 *  que es exactamente cómo envejeció `next.md`. Estos tests atan la cola a la
 *  misma fuente que el guardia de fronteras, para que no puedan divergir. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkArchitecture, reportByRule } from "../src/contract/arch/check.js";
import { archConfig, loadArchFiles } from "../scripts/arch-collect.js";
import {
  avisoDeExentos,
  avisoSinDatos,
  bloqueFronteras,
  cabeceraDe,
  enColaDeCrap,
  itemsDeMutacion,
  unaLinea,
  type InformeModulo,
} from "../scripts/deuda.js";

describe("cola de deuda · fronteras", () => {
  const reports = reportByRule(archConfig, checkArchitecture(archConfig, loadArchFiles()));
  const congeladas = reports.filter((r) => r.rule.severity === "warn");

  it("lista exactamente las violaciones que el guardia tiene congeladas", () => {
    const esperadas = congeladas.reduce((n, r) => n + r.violations.length, 0);
    assert.equal(bloqueFronteras().items.length, esperadas);
  });

  it("no puede quedarse vacía mientras haya deuda congelada", () => {
    // Si algún día se salda toda, este test cae con el cambio que la salda —
    // y esa es la señal de que toca retirar las reglas warn del JSON.
    assert.ok(congeladas.length > 0, "no hay reglas warn: retira este test con ellas");
    assert.ok(bloqueFronteras().items.length > 0);
  });

  it("cada item lleva ubicación fichero:línea, no solo el nombre de la regla", () => {
    for (const item of bloqueFronteras().items) {
      assert.match(item.donde, /^[\w./-]+:\d+$/, `ubicación inservible: ${item.donde}`);
    }
  });
});

describe("cola de deuda · complejidad × cobertura", () => {
  // Datos sintéticos, NO el lcov real: `npm test` corre antes que
  // `npm run coverage` y `coverage/` no se versiona, así que contra datos
  // reales estos tests pasarían en verde sobre una lista vacía. Pasó: la
  // primera versión de este fichero rompió el CI por eso, y el test de las
  // anónimas pasaba en vacío, que es peor que fallar.
  const fila = (name: string, crap: number, coverage: number) => ({
    name,
    startLine: 1,
    endLine: 9,
    complexity: 5,
    file: "src/x.ts",
    coverage,
    crap,
  });

  it("una función con nombre y 0% de cobertura entra aunque su CRAP sea bajo", () => {
    // El caso exacto de `handleTileAnalysis`: CRAP 30,0 con el umbral en > 30.
    const cola = enColaDeCrap([fila("handleTileAnalysis", 30, 0)], 30);
    assert.deepEqual(
      cola.map((f) => f.name),
      ["handleTileAnalysis"],
    );
  });

  it("no lista arrows anónimas sin cubrir: no son un sitio donde alguien pueda actuar", () => {
    const cola = enColaDeCrap([fila("(anónima)", 12, 0)], 30);
    assert.deepEqual(cola, []);
  });

  it("una anónima SÍ entra si es su complejidad la que se dispara", () => {
    // El filtro es solo para la regla de cobertura cero: por CRAP entra igual.
    const cola = enColaDeCrap([fila("(anónima)", 66, 0.11)], 30);
    assert.equal(cola.length, 1);
  });

  it("lo bien cubierto y poco complejo no entra", () => {
    assert.deepEqual(enColaDeCrap([fila("trivial", 5, 1)], 30), []);
  });

  it("el umbral es estricto: justo en el objetivo no entra", () => {
    assert.deepEqual(enColaDeCrap([fila("justa", 30, 0.5)], 30), []);
  });
});

describe("cola de deuda · mutación repartida en varios informes", () => {
  // Datos sintéticos por el mismo motivo que arriba: `reports/` no se versiona,
  // así que contra los informes reales estos tests pasarían en verde sobre una
  // lista vacía en cualquier clon limpio y en CI.
  let serie = 0;
  // Cada mutante sintético necesita una ubicación COMPLETA: la huella son siete
  // componentes y con la línea sola dos mutantes de la misma línea serían el
  // mismo. `serie` los separa igual que las columnas los separan de verdad.
  const mutante = (status: string, mutatorName = "ConditionalExpression") => ({
    status,
    mutatorName,
    replacement: `r${(serie += 1)}`,
    location: { start: { line: 1, column: serie }, end: { line: 1, column: serie + 2 } },
  });
  const informe = (id: string, file: string, vivos: number, muertos: number): InformeModulo => ({
    id,
    ficheros: [file],
    report: {
      files: {
        [file]: {
          mutants: [
            ...Array.from({ length: vivos }, () => mutante("Survived")),
            ...Array.from({ length: muertos }, () => mutante("Killed")),
          ],
        },
      },
    },
  });

  it("junta los ficheros de todos los módulos en una sola cola", () => {
    const items = itemsDeMutacion([informe("a", "src/a.ts", 2, 8), informe("b", "src/b.ts", 7, 3)]);
    assert.deepEqual(
      items.map((i) => i.donde),
      ["src/b.ts", "src/a.ts"],
      "los peores primero, vengan del módulo que vengan",
    );
    assert.match(items[0].que, /7 mutantes vivos de 10 \(score 30%\)/);
  });

  it("la fusión es determinista: a igual número de vivos, ordena por ruta", () => {
    const orden = (a: string, b: string) =>
      itemsDeMutacion([informe("m1", a, 3, 1), informe("m2", b, 3, 1)]).map((i) => i.donde);
    assert.deepEqual(orden("src/z.ts", "src/a.ts"), ["src/a.ts", "src/z.ts"]);
    assert.deepEqual(orden("src/a.ts", "src/z.ts"), ["src/a.ts", "src/z.ts"]);
  });

  it("un módulo sin informe no aporta items, pero tampoco los inventa", () => {
    const items = itemsDeMutacion([informe("a", "src/a.ts", 1, 9), { id: "b", ficheros: ["src/b.ts"] }]);
    assert.deepEqual(
      items.map((i) => i.donde),
      ["src/a.ts"],
    );
  });

  it("NoCoverage cuenta como vivo: nadie ejecutó esa línea", () => {
    const items = itemsDeMutacion([
      {
        id: "a",
        ficheros: ["src/a.ts"],
        report: { files: { "src/a.ts": { mutants: [mutante("NoCoverage"), mutante("Killed")] } } },
      },
    ]);
    assert.equal(items[0].peso, 1);
    assert.match(items[0].que, /score 50%/);
  });

  it("avisa de CADA módulo sin medir y dice el comando que lo arregla", () => {
    // Es la función que nació de medir el vacío en verde durante meses. Partir
    // la corrida multiplica las formas de que un objetivo se quede sin medir:
    // basta con que un módulo no llegue a correrse.
    const aviso = avisoSinDatos([
      informe("medido", "src/a.ts", 1, 1),
      { id: "world-map", ficheros: ["src/world-map/world-map.ts", "src/world-map/edges.ts"] },
      { id: "store", ficheros: ["src/store/reducers.ts"] },
    ]);
    assert.match(aviso ?? "", /^sin medir 2 de 3 módulos/);
    assert.match(aviso ?? "", /3 ficheros sin dato/);
    assert.match(aviso ?? "", /world-map/);
    assert.match(aviso ?? "", /store/);
  });

  it("el aviso NO manda `npm run mutate`: es lo que no se puede correr aquí", () => {
    // La herramienta contradecía a la doctrina en cinco sitios. Éste era el más
    // caro: la cola de trabajo pidiendo la corrida entera en la máquina de
    // quien está programando.
    const sinMedir = [{ id: "plugins-dsl", ficheros: ["src/plugins/dsl/paths.ts"] }];
    assert.doesNotMatch(avisoSinDatos(sinMedir) ?? "", /npm run mutate\b/);
    assert.doesNotMatch(cabeceraDe([{ titulo: "Mutación", fuente: "x", aviso: "sin medir", items: [] }]), /npm run mutate\b/);
  });

  it("cada módulo sin medir lleva SU comando, no uno genérico", () => {
    // Un módulo barato se mide aquí; uno caro se pide. El aviso lo dice por
    // módulo porque la respuesta no es la misma para todos.
    const aviso = avisoSinDatos(
      [{ id: "caro", ficheros: ["src/a.ts"] }],
      (id) => `npm run mutacion -- pendiente (${id} no cabe)`,
    );
    assert.match(aviso ?? "", /caro no cabe/);
  });

  it("un módulo que solo tiene HUELLA está medido: no marca la cola parcial", () => {
    // La huella commiteada sobrevive a un clon; `reports/` no. Contar como "sin
    // medir" a un módulo con huella dejaría la cola en PARCIAL permanente en
    // cualquier máquina recién clonada, y el marcador dejaría de significar
    // nada justo el día que un módulo se quede de verdad sin correr.
    const soloHuella: InformeModulo = {
      id: "b",
      ficheros: ["src/b.ts"],
      base: {
        "src/b.ts": {
          sha: "abc1234",
          run: "1",
          fecha: "2026-08-25T00:00:00.000Z",
          total: 10,
          vivos: ["0123456789abcdef"],
          nuevos: [],
          resueltos: 0,
          sin_base: false,
          duenos: ["#273"],
        },
      },
    };
    assert.equal(avisoSinDatos([informe("a", "src/a.ts", 1, 1), soloHuella]), undefined);
    const items = itemsDeMutacion([soloHuella]);
    assert.deepEqual(
      items.map((i) => i.donde),
      ["src/b.ts"],
      "y su deuda sí sale en la cola",
    );
    assert.match(items[0].que, /de la huella/);
  });

  it("con todos los módulos medidos no hay aviso", () => {
    assert.equal(avisoSinDatos([informe("a", "src/a.ts", 1, 1)]), undefined);
  });

  it("sin ningún informe, el aviso pide la corrida entera", () => {
    const aviso = avisoSinDatos([
      { id: "a", ficheros: ["src/a.ts"] },
      { id: "b", ficheros: ["src/b.ts"] },
    ]);
    assert.match(aviso ?? "", /^sin medir — 2 módulos, 2 ficheros configurados/);
  });

  it("una corrida PARCIAL de ayer no se lee como la foto completa", () => {
    // El caso que estrena `npm run mutate -- --cambiado`: lo normal pasa a ser
    // que unos módulos se midieran hoy y otros no se hayan tocado. La cola
    // tiene que seguir diciendo de CUÁLES no hay dato — si se limitara a sumar
    // los informes que encuentra, una selección estrecha daría un total
    // pequeño que se leería como "queda poca deuda".
    const informes = [
      informe("medido-hoy", "src/a.ts", 4, 6),
      { id: "no-tocado", ficheros: ["src/b.ts", "src/c.ts"] },
      { id: "tampoco", ficheros: ["src/d.ts"] },
    ];
    assert.equal(itemsDeMutacion(informes).length, 1, "solo aporta items el módulo que sí se midió");
    const aviso = avisoSinDatos(informes);
    assert.match(aviso ?? "", /sin medir 2 de 3 módulos/);
    assert.match(aviso ?? "", /no-tocado/);
    assert.match(aviso ?? "", /tampoco/);
  });

  it("cuenta los ficheros que NO muta nadie, aunque todo lo medible esté medido", () => {
    // La segunda forma de no tener medida, y la que no deja rastro en los
    // informes: el fichero que no es objetivo de ningún módulo. Está declarado
    // en `sin_mutar` con motivo —el candado de totalidad no admite otra cosa—,
    // pero declarado no es medido, y la cola tiene que decirlo.
    const aviso = avisoDeExentos([
      "src/contracts/http.ts",
      "src/contracts/common.ts",
      "src/combat/enemy-ai.ts",
      "src/scene/aim.ts",
    ]);
    assert.match(aviso ?? "", /^4 ficheros del perímetro puro NO los muta nadie/);
    assert.match(aviso ?? "", /src\/contracts \(2\)/, "agrupa por directorio, peor primero");
    assert.match(aviso ?? "", /sin_mutar/);
  });

  it("sin exentos no hay aviso: la lista vacía es la meta, no un dato que enseñar", () => {
    assert.equal(avisoDeExentos([]), undefined);
  });

  it("los exentos NO marcan la cola parcial: es una decisión escrita, no una medida que falta", () => {
    // La diferencia importa. "Sin medir" es que la corrida no se hizo y hay que
    // hacerla; un exento es que alguien decidió y lo firmó. Mezclarlos dejaría
    // la cola en PARCIAL permanente y el marcador dejaría de significar nada
    // justo el día que un módulo se quede de verdad sin correr.
    const out = cabeceraDe([
      { titulo: "Fronteras", fuente: "x", items: [] },
      { titulo: "Mutación — supervivientes", fuente: "y", aviso: avisoDeExentos(["src/a.ts"]), items: [] },
    ]);
    assert.match(out, /Deuda medida/);
    assert.doesNotMatch(out, /PARCIAL/);
  });

  it("un módulo sin medir marca la cola PARCIAL en el titular", () => {
    // El aviso empieza por "sin medir" a propósito: es lo que `cabeceraDe`
    // busca. Una medida a medias engaña igual que la ausente — un total
    // pequeño que se lee como la deuda entera.
    const aviso = avisoSinDatos([informe("a", "src/a.ts", 1, 1), { id: "b", ficheros: ["src/b.ts"] }]);
    const out = cabeceraDe([
      { titulo: "Fronteras", fuente: "x", items: [] },
      { titulo: "Mutación — supervivientes", fuente: "y", aviso, items: [] },
    ]);
    assert.match(out, /PARCIAL/);
    assert.match(out, /mutación/);
  });
});

describe("cola de deuda · el titular no puede aparentar completitud", () => {
  const bloque = (titulo: string, n: number, aviso?: string) => ({
    titulo,
    fuente: "x",
    aviso,
    items: Array.from({ length: n }, () => ({ donde: "a.ts:1", que: "q", peso: 1 })),
  });

  it("con las tres fuentes medidas, da el total a secas", () => {
    const out = cabeceraDe([bloque("Fronteras", 3), bloque("Complejidad", 2), bloque("Mutación", 1)]);
    assert.match(out, /Deuda medida — 6 items/);
  });

  it("si falta una medida lo dice EN EL TITULAR, no solo dentro del bloque", () => {
    // El caso del clon limpio: `coverage/` y `reports/` no se versionan, así
    // que quien corra esto recién clonado vería un total pequeño y lo tomaría
    // por la deuda entera.
    const out = cabeceraDe([
      bloque("Fronteras", 27),
      bloque("Complejidad", 0, "sin medir — corre `npm run coverage`"),
      bloque("Mutación", 0, "sin medir — corre `npm run mutate`"),
    ]);
    assert.match(out, /PARCIAL/);
    assert.match(out, /1 de 3 fuentes/);
    assert.match(out, /complejidad, mutación/);
  });

  it("un aviso que NO es de falta de medida no marca la cola como parcial", () => {
    // "posiblemente obsoleta" es otra cosa: hay datos, solo que envejecidos.
    const out = cabeceraDe([bloque("Fronteras", 3, "posiblemente obsoleta — cambiados después: x.ts")]);
    assert.match(out, /Deuda medida — 3 items/);
  });
});

describe("cola de deuda · legibilidad", () => {
  it("colapsa los saltos serializados del detalle", () => {
    assert.equal(unaLinea("catch {\\n  // nada\\n}"), "catch { // nada }");
  });

  it("colapsa también los saltos reales", () => {
    assert.equal(unaLinea("catch {\n  // nada\n}"), "catch { // nada }");
  });

  it("recorta lo largo con puntos suspensivos", () => {
    const out = unaLinea("x".repeat(200), 20);
    assert.equal(out.length, 20);
    assert.ok(out.endsWith("…"));
  });
});
