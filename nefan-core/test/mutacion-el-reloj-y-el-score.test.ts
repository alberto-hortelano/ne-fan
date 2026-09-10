/** La cadena del reloj y el score de la mutación, con sujeto (#436, #437, #432).
 *
 *  QUÉ SE PRUEBA AQUÍ Y NO EN `mutacion-huella.test.ts`: las funciones que
 *  deciden **cuánto cuesta** un módulo y **si está bien medido** viven repartidas
 *  entre `scripts/mutacion.ts` (que llama a git y a `gh`) y
 *  `scripts/mutation-plan.ts` (que lee del disco), así que no cabían en la
 *  batería del fichero puro. El resultado, medido el 2026-09-04, era que
 *  `resumenDeMutantes`, `esVivo`, `costeDe` y `segundosDe` no las nombraba NI UN
 *  test — el número con el que se decide si un módulo está bien medido lo
 *  producía código que nada comprobaba y nada mide, porque `scripts/` está
 *  además fuera del perímetro de mutación (#432).
 *
 *  Importarlas desde aquí sí se puede: `scripts/mutacion.ts` termina con
 *  `if (process.argv[1]?.endsWith("mutacion.ts")) main()`, o sea que importado
 *  no ejecuta nada, y `mutation-plan.ts` solo lee cuando se le pide. El
 *  precedente es `test/afectado.test.ts`, `test/deuda.test.ts` y
 *  `test/crap-score.test.ts`, que ya hacen esto con otros `scripts/`.
 *
 *  LA CADENA DEL RELOJ son cuatro eslabones —`mutate.ts` cronometra,
 *  `manifiesto` lo sella, `repartir` lo lleva a la huella y `segundosDe` lo
 *  agrega— y hasta el 2026-09-10 solo el primero tenía candado (#436). Los dos
 *  de en medio se extrajeron a `mutacion-huella.ts` (`conCronometro`,
 *  `filaDeHuella`) para poder ejercerlos; el cuarto se prueba aquí.
 *
 *  NO mide mutación, no lanza Stryker y no toca `reports/`: todo son datos
 *  sintéticos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { costeDe, segundosDe } from "../scripts/mutacion.js";
import {
  conCronometro,
  filaDeHuella,
  idsDeLotes,
  matrizDeLotes,
  HUELLA_VACIA,
  type Lote,
  type Corrida,
  type DeltaDeFichero,
  type DuenosDeLaMedida,
  type Huella,
  type InformeSellado,
  type MedidaDeFichero,
} from "../scripts/mutacion-huella.js";
import { esVivo, resumenDeMutantes, type PlanMutacion } from "../scripts/mutation-plan.js";

// ── el plan y la huella de mentira, para no depender de los del repo ─────────

/** Un plan de mentira con UN módulo de cuatro ficheros: la forma de
 *  `blueprint-derive`, que es el que destapa la diferencia entre máximo y suma.
 *
 *  LAS RUTAS SON REALES aunque el plan no lo sea, y no por gusto:
 *  `ficherosMutados` expande cada patrón CONTRA EL DISCO y descarta lo que no
 *  existe, así que un `src/a.ts` inventado dejaría el módulo con cero ficheros
 *  y estos tests saldrían verdes sin mirar nada. */
const CUATRO = [
  "src/scene/blueprint/derive.ts",
  "src/scene/blueprint/vegetation.ts",
  "src/scene/blueprint/palette.ts",
  "src/scene/blueprint/time-of-day.ts",
] as const;
const UNO = "src/scene/aim.ts";

const PLAN: PlanMutacion = {
  comando: "node --test",
  tope_local: 120,
  tope_lote: 1800,
  modulos: [
    { id: "cuatro-ficheros", mutate: [...CUATRO], tests: ["test/a.test.ts"], break: 70 },
    { id: "uno-solo", mutate: [UNO], tests: ["test/z.test.ts"], break: 70 },
  ],
} as unknown as PlanMutacion;

const fila = (over: Partial<MedidaDeFichero>): MedidaDeFichero => ({
  sha: "abc1234",
  run: "1",
  fecha: "2026-09-04T00:00:00Z",
  blob: "b0",
  total: 10,
  vivos: [],
  nuevos: [],
  resueltos: 0,
  base: "con base",
  duenos: { veredicto: "atribuido", quienes: ["#1"] } as unknown as DuenosDeLaMedida,
  ...over,
});

const huellaCon = (ficheros: Record<string, MedidaDeFichero>): Huella => ({
  ...HUELLA_VACIA,
  ficheros,
});

/** El workflow que consume todo esto. Se lee de verdad: los dos números y las
 *  dos claves que sujetan el reparto viven en ficheros distintos y solo se
 *  sostienen JUNTOS, así que el candado tiene que mirar los dos. */
const YML = readFileSync(fileURLToPath(new URL("../../.github/workflows/mutation.yml", import.meta.url)), "utf8");

// ── el score, que es lo que decide si un módulo está medido (#432) ───────────

describe("el score de la mutación, con sujeto (#432)", () => {
  it("VIVO es `Survived` y `NoCoverage`, y nada más", () => {
    // Los dos son «el test no se enteró», por caminos distintos: uno pasó por la
    // línea sin comprobar nada y el otro ni pasó. Colapsar `NoCoverage` a
    // detectado subiría el score de los módulos peor cubiertos, que son justo
    // los que este número existe para señalar.
    assert.equal(esVivo("Survived"), true);
    assert.equal(esVivo("NoCoverage"), true);
    for (const s of ["Killed", "Timeout", "Ignored", "CompileError", "RuntimeError"]) {
      assert.equal(esVivo(s), false, `${s} no puede contar como vivo`);
    }
  });

  it("el denominador son los VEREDICTOS, no los mutantes: `Ignored` y los errores no cuentan", () => {
    // Es la diferencia entre «el 50 % de mis mutantes murió» y «el 50 % de los
    // que se llegaron a juzgar murió». Un fichero con muchos `CompileError`
    // saldría con un score inventado si entraran en el total.
    const r = resumenDeMutantes([
      { status: "Killed" },
      { status: "Timeout" },
      { status: "Survived" },
      { status: "NoCoverage" },
      { status: "Ignored" },
      { status: "CompileError" },
      { status: "RuntimeError" },
    ]);
    assert.equal(r.total, 4, "cuatro veredictos de siete mutantes");
    assert.equal(r.vivos, 2);
    assert.equal(r.score, 50);
  });

  it("`Timeout` cuenta como DETECTADO: colgar el proceso también es enterarse", () => {
    // Y no es un detalle: `stryker.config.json` documenta que bajar el
    // `timeoutMS` de 120 s a 10 s no cambia lo que se mide precisamente porque
    // algunos mutantes solo cambian de casilla, de `Killed` a `Timeout`.
    assert.equal(resumenDeMutantes([{ status: "Timeout" }, { status: "Survived" }]).score, 50);
    assert.equal(resumenDeMutantes([{ status: "Timeout" }]).score, 100);
  });

  it("sin un solo veredicto el score es 0 y NO una división por cero", () => {
    const r = resumenDeMutantes([{ status: "Ignored" }]);
    assert.equal(r.total, 0);
    assert.equal(r.score, 0, "0, no NaN: un NaN escrito en el contrato se lee como un suelo");
  });

  it("todo detectado es 100, todo vivo es 0", () => {
    assert.equal(resumenDeMutantes([{ status: "Killed" }, { status: "Killed" }]).score, 100);
    assert.equal(resumenDeMutantes([{ status: "Survived" }, { status: "NoCoverage" }]).score, 0);
  });
});

// ── el coste en mutantes, que es lo que aplica el tope local ─────────────────

describe("el coste de un módulo en mutantes (#432)", () => {
  it("SUMA las filas: el coste de un módulo es el de todos sus ficheros", () => {
    // Aquí sumar SÍ es lo correcto, y es la mitad del par que hay que no
    // confundir: los mutantes de cuatro ficheros se instrumentan los cuatro,
    // mientras que los segundos de esos mismos cuatro son UNA corrida.
    const huella = huellaCon({
      "src/scene/blueprint/derive.ts": fila({ total: 10 }),
      "src/scene/blueprint/vegetation.ts": fila({ total: 20 }),
      "src/scene/blueprint/palette.ts": fila({ total: 30 }),
      "src/scene/blueprint/time-of-day.ts": fila({ total: 40 }),
    });
    assert.equal(costeDe(PLAN, huella, "cuatro-ficheros"), 100);
  });

  it("sin NINGUNA fila medida no contesta un cero: contesta que no lo sabe", () => {
    // Un cero se leería como «es gratis» y `permisoLocal` autorizaría la
    // corrida más cara del plan. `undefined` es lo que le hace negarse.
    assert.equal(costeDe(PLAN, HUELLA_VACIA, "cuatro-ficheros"), undefined);
  });

  it("con parte de las filas medidas suma lo que hay, que es una COTA POR ABAJO", () => {
    const huella = huellaCon({ "src/scene/blueprint/derive.ts": fila({ total: 10 }), "src/scene/blueprint/palette.ts": fila({ total: 5 }) });
    assert.equal(costeDe(PLAN, huella, "cuatro-ficheros"), 15);
  });

  it("un id que el plan no tiene se lanza en vez de salir `undefined`", () => {
    // `undefined` acabaría en «no hay medida previa», que es un mensaje sobre
    // otra cosa: el id está mal escrito.
    assert.throws(() => costeDe(PLAN, HUELLA_VACIA, "no-existe"));
  });
});

// ── el cuarto eslabón del reloj: MÁXIMO y no suma (#436) ─────────────────────

describe("la cadena del reloj · `segundosDe` agrega con MÁXIMO (#436)", () => {
  it("cuatro ficheros del mismo módulo NO se suman: la corrida los midió juntos", () => {
    // EL PEOR DE LOS CINCO INVARIANTES SIN CANDADO que enumeraba
    // `qa/mutacion-reparto-en-lotes.mjs`. Sumar cuadruplica un módulo de cuatro
    // ficheros —`blueprint-derive` pasaría de 1.647 s a 6.588— y con eso deja de
    // caber en ningún lote, se va solo y arrastra a los demás a una partición
    // que nadie pidió. Todo en verde, porque el MÁXIMO estaba declarado en el
    // tipo y en la prosa y en ningún test.
    const huella = huellaCon({
      "src/scene/blueprint/derive.ts": fila({ segundos: 1647 }),
      "src/scene/blueprint/vegetation.ts": fila({ segundos: 1647 }),
      "src/scene/blueprint/palette.ts": fila({ segundos: 1647 }),
      "src/scene/blueprint/time-of-day.ts": fila({ segundos: 1647 }),
    });
    assert.equal(segundosDe(PLAN, huella, "cuatro-ficheros"), 1647);
    assert.notEqual(segundosDe(PLAN, huella, "cuatro-ficheros"), 1647 * 4);
  });

  it("con filas de corridas DISTINTAS coge la mayor, que es la cota segura", () => {
    // Aquí es donde «máximo» y «el primero que encuentres» dejan de ser lo
    // mismo: una corrida de rango refresca solo algunos ficheros, así que el
    // módulo acaba con relojes de dos días. Presupuestar por el pequeño mete el
    // lote en un job que no lo aguanta.
    const huella = huellaCon({
      "src/scene/blueprint/derive.ts": fila({ segundos: 300 }),
      "src/scene/blueprint/vegetation.ts": fila({ segundos: 1700 }),
      "src/scene/blueprint/palette.ts": fila({ segundos: 900 }),
      "src/scene/blueprint/time-of-day.ts": fila({ segundos: 120 }),
    });
    assert.equal(segundosDe(PLAN, huella, "cuatro-ficheros"), 1700);
  });

  it("sin reloj en NINGUNA fila es `undefined`, y eso viaja hasta el lote propio", () => {
    const huella = huellaCon({ "src/scene/blueprint/derive.ts": fila({}), "src/scene/blueprint/vegetation.ts": fila({}) });
    assert.equal(segundosDe(PLAN, huella, "cuatro-ficheros"), undefined);
  });

  it("un reloj de 0 s NO se confunde con no tenerlo", () => {
    // `0` es una medida («tardó menos de un segundo») y `undefined` es su
    // ausencia. Colapsarlas con un `||` mandaría a lote propio a los módulos
    // más baratos del plan.
    assert.equal(segundosDe(PLAN, huellaCon({ "src/scene/aim.ts": fila({ segundos: 0 }) }), "uno-solo"), 0);
    assert.equal(segundosDe(PLAN, huellaCon({ "src/scene/aim.ts": fila({}) }), "uno-solo"), undefined);
  });
});

// ── el segundo y el tercer eslabón: que el reloj no se pierda por el camino ──

describe("la cadena del reloj · `manifiesto` sella el cronómetro (#436)", () => {
  const informes: InformeSellado[] = [
    { modulo: "hostiles", sha256: "aa" },
    { modulo: "apuntado", sha256: "bb" },
  ];

  it("cada informe se lleva SU segundo, no el del vecino", () => {
    const r = conCronometro(informes, { hostiles: 42, apuntado: 7 });
    assert.deepEqual(r, [
      { modulo: "hostiles", sha256: "aa", segundos: 42 },
      { modulo: "apuntado", sha256: "bb", segundos: 7 },
    ]);
  });

  it("el módulo que no se cronometró viaja SIN el campo, no con un cero", () => {
    // La ausencia tiene que llegar entera hasta `segundosDe` para convertirse
    // en lote propio. Un cero diría «gratis» y lo metería en el hueco de
    // cualquier lote.
    const r = conCronometro(informes, { hostiles: 42 });
    assert.equal(r[1].segundos, undefined);
    assert.ok(!("segundos" in r[1]), "el campo no se escribe, ni siquiera como undefined");
  });

  it("un cronómetro de 0 s SÍ se escribe", () => {
    assert.equal(conCronometro(informes, { hostiles: 0 })[0].segundos, 0);
  });

  it("el sello no se toca al añadir el reloj", () => {
    // Si el spread perdiera `sha256`, la fusión rechazaría la descarga entera
    // por «no casa con su propio manifiesto», que es un mensaje sobre otra cosa.
    assert.equal(conCronometro(informes, { hostiles: 42 })[0].sha256, "aa");
  });
});

describe("la cadena del reloj · `repartir` lo lleva a la huella (#436)", () => {
  const corrida: Pick<Corrida, "sha" | "run_id" | "fecha"> = {
    sha: "deadbee",
    run_id: "424242",
    fecha: "2026-09-10T00:00:00Z",
  };
  const delta: DeltaDeFichero = {
    fichero: "src/scene/blueprint/derive.ts",
    base: "con base",
    vivos: ["h2", "h1"],
    nuevos: ["h2"],
    yaEstaban: ["h1"],
    resueltos: ["h9", "h8"],
    total: 33,
  };
  const duenos = { veredicto: "atribuido", quienes: ["#541"] } as unknown as DuenosDeLaMedida;

  it("el reloj del módulo entra en la fila del fichero", () => {
    // Es el último eslabón: sin él la huella no gana `segundos` NUNCA y todo
    // vuelve a lote propio, o sea a la corrida sin partir que se comió el
    // `timeout-minutes: 180`.
    const f = filaDeHuella({ corrida, delta, blob: "b1", duenos, segundos: 1647 });
    assert.equal(f.segundos, 1647);
    assert.equal(f.total, 33);
    assert.equal(f.sha, "deadbee");
    assert.equal(f.run, "424242");
    assert.equal(f.blob, "b1");
  });

  it("sin reloj el campo NO se escribe", () => {
    const f = filaDeHuella({ corrida, delta, blob: "b1", duenos, segundos: undefined });
    assert.ok(!("segundos" in f), "un `segundos: undefined` en el JSON se lee distinto que su ausencia");
  });

  it("las huellas se escriben ORDENADAS, para que el delta se vea en el diff", () => {
    // La huella va commiteada a propósito: si el orden bailara, cada corrida
    // dejaría un diff de ruido y el delta de verdad se perdería dentro.
    const f = filaDeHuella({ corrida, delta, blob: "b1", duenos, segundos: 1 });
    assert.deepEqual(f.vivos, ["h1", "h2"]);
    assert.deepEqual(f.nuevos, ["h2"]);
    assert.equal(f.resueltos, 2, "los resueltos se cuentan, no se listan");
  });
});

// ── lo que `lotes` acepta que le pidan (#437) ────────────────────────────────

describe("qué se le puede pedir a `lotes` (#437)", () => {
  it("`--todos` con `--ids` se RECHAZA en vez de tirar los ids en silencio", () => {
    // Es la forma exacta del bug que ya costó una corrida entera (`--pedidos ""`
    // mataba el manifiesto DESPUÉS de medir 131 minutos): la orden hace algo
    // distinto de lo que dice y la factura llega media hora más tarde.
    const r = idsDeLotes(true, "hostiles apuntado");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.porque, /--todos y --ids/);
    assert.match(r.porque, /hostiles apuntado/, "tiene que enseñar lo que iba a tirar");
  });

  it("un id REPETIDO se rechaza nombrándolo", () => {
    // `moduloPorId` valida que exista, no que venga una sola vez. En el mejor
    // caso se mide dos veces; en el peor, dos lotes reclaman el mismo módulo y
    // la fusión encuentra dos informes para él.
    const r = idsDeLotes(false, "hostiles apuntado hostiles");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.porque, /repetido/);
    assert.match(r.porque, /hostiles/);
  });

  it("y el repetido se nombra UNA vez aunque venga tres", () => {
    const r = idsDeLotes(false, "a a a b");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.porque.match(/\ba\b/g)?.length, 1);
  });

  it("`--ids` vacío no se interpreta: se rechaza", () => {
    const r = idsDeLotes(false, "   ");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.porque, /vacío/);
    assert.match(r.porque, /--todos/, "tiene que decir cómo se pide la corrida completa");
  });

  it("la matriz sale con LAS CLAVES QUE EL YAML LEE, y eso se comprueba contra el YAML", () => {
    // Renombrar una clave no da error: `matrix.ids` quedaría vacío, cada lote
    // llamaría a `npm run mutate` SIN argumentos, y sin argumentos `mutate`
    // mide los 55 módulos. N jobs midiendo la corrida entera, con el YAML
    // válido y los jobs arrancando — «una corrida cara pero correcta» hasta el
    // timeout. El oráculo no es una lista escrita aquí: son los `matrix.<clave>`
    // que el propio workflow nombra.
    const lotes: Lote[] = [
      { lote: 1, modulos: ["hostiles", "apuntado"], segundos: 40, medido: true, margen: 1760 },
      { lote: 2, modulos: ["solo"], segundos: 0, medido: false },
    ];
    const matriz = matrizDeLotes(lotes);
    assert.deepEqual(matriz, [
      { lote: 1, ids: "hostiles apuntado" },
      { lote: 2, ids: "solo" },
    ]);
    const leidas = new Set([...YML.matchAll(/matrix\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    assert.ok(leidas.size > 0, "si el YAML no nombrara ninguna clave, este candado no probaría nada");
    for (const clave of leidas) {
      assert.ok(clave in matriz[0], `el YAML lee \`matrix.${clave}\` y la matriz no lo trae`);
    }
  });

  it("los ids de un lote viajan como UNA cadena separada por espacios, que es lo que `mutate` parsea", () => {
    // Un array aquí serializaría a `hostiles,apuntado` dentro de `matrix.ids` y
    // `mutate` lo leería como un id inventado.
    const [uno] = matrizDeLotes([{ lote: 1, modulos: ["a", "b", "c"], segundos: 1, medido: true }]);
    assert.equal(typeof uno.ids, "string");
    assert.equal(uno.ids, "a b c");
  });

  it("`tope_lote` cabe en el `timeout-minutes` del job que lo ejecuta", () => {
    // Los dos números viven en ficheros distintos y nada obligaba a que el
    // segundo fuera mayor que el primero: subir el tope sin tocar el workflow
    // produce lotes que no caben en su propio reloj, o sea EXACTAMENTE el fallo
    // que partir la corrida vino a arreglar. El guion de QA ya lo miraba, pero
    // CI lo corre con `--solo-vigentes` y el negativo no se ejercía en ningún
    // sitio: aquí sí, y esta batería sí la corre cada PR.
    const tope = (JSON.parse(readFileSync(fileURLToPath(new URL("../data/contract/mutation-targets.json", import.meta.url)), "utf8")) as { tope_lote: number }).tope_lote;
    const medir = YML.slice(YML.indexOf("\n  medir:"), YML.indexOf("\n  reunir:"));
    const m = /timeout-minutes:\s*(\d+)/.exec(medir);
    assert.ok(m, "el job `medir` tiene que declarar su timeout, o no hay contra qué comparar");
    assert.ok(
      tope <= Number(m[1]) * 60,
      `tope_lote son ${tope}s y el job \`medir\` muere a los ${Number(m[1]) * 60}s: los lotes más llenos ` +
        `morirían a mitad de camino`,
    );
  });

  it("las tres formas legítimas siguen pasando", () => {
    assert.deepEqual(idsDeLotes(true, undefined), { ok: true, ids: "todos" });
    assert.deepEqual(idsDeLotes(false, undefined), { ok: true, ids: "del-tag" });
    assert.deepEqual(idsDeLotes(false, "hostiles  apuntado"), { ok: true, ids: ["hostiles", "apuntado"] });
  });

  it("y por eso el workflow nunca pide las dos: pasa --todos O --ids, en ramas distintas", () => {
    // El candado del rechazo no sirve de nada si el YAML lo dispara en cada
    // corrida. Se comprueba sobre el fichero real, no sobre la memoria de quien
    // lo escribió.
    assert.ok(/lotes --todos --origen/.test(YML), "la rama TODOS pide --todos");
    assert.ok(/lotes --ids "\$IDS" --origen/.test(YML), "la rama de rango pide --ids");
    assert.equal(/lotes --todos[^\n]*--ids/.test(YML), false, "y ninguna invocación pide las dos");
  });

  it("el ORDEN que se escribió no decide nada: se conserva tal cual y lo reparte `empaqueta`", () => {
    // El reparto es determinista por id (lo canda el guion de QA con dos
    // llamadas en orden distinto); esto solo comprueba que aquí no se toca.
    const r = idsDeLotes(false, "b a c");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.ids, ["b", "a", "c"]);
  });
});
