/** El candado de la huella, el delta y la atribución.
 *
 *  TODO CON DATOS SINTÉTICOS, y no por comodidad. Un test que preguntara a git
 *  de verdad —«¿de qué PR salió este superviviente?»— correría en CI sobre un
 *  clon superficial, se quedaría sin rango y pasaría EN VERDE sin comprobar
 *  nada. Es literalmente lo que `deuda.ts:159` documenta de `enColaDeCrap`
 *  («si el test tuviera que llamarla a través del lcov real, en CI no
 *  comprobaría nada»), y es la razón de que `scripts/mutacion-huella.ts` no
 *  tenga dentro ni git ni una lectura de disco.
 *
 *  Lo que se ejerce aquí es lo que puede equivocarse EN VERDE: un delta que
 *  colapsa "no había medida" con "no ha cambiado nada" deja la cola muda, y una
 *  atribución que inventa un dueño manda el hallazgo a quien no lo trajo. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  anotacionDeFichero,
  atribuir,
  avisoDeAntiguedad,
  avisoDeFrescura,
  claveDeMutante,
  costeDeLaMatriz,
  deltaDeCorrida,
  duenosDeLaMedida,
  duenosLegibles,
  empaqueta,
  fusionaCorrida,
  lotesSinNoticias,
  estadoLegible,
  estadoDeReparto,
  marcaDeCorrida,
  muroDeMutacion,
  yaComentada,
  deltaDeFichero,
  fusiona,
  hash64,
  huellaDeMutante,
  modulosConInforme,
  permisoLocal,
  prDelAsunto,
  queHacerCon,
  rangoDe,
  veredictoDeCorrida,
  verificaDescarga,
  vivosDeFichero,
  type Corrida,
  type CommitDelRango,
  type Huella,
  type InformeSellado,
  type JobDeCI,
  type MedidaDeFichero,
  type ModuloAEmpaquetar,
  type PlanDeCorrida,
  type MutanteMedido,
} from "../scripts/mutacion-huella.js";
import { leerPlan } from "../scripts/mutation-plan.js";

const mutante = (over: Partial<MutanteMedido> = {}): MutanteMedido => ({
  mutatorName: "ConditionalExpression",
  replacement: "true",
  status: "Survived",
  location: { start: { line: 24, column: 7 }, end: { line: 24, column: 9 } },
  ...over,
});

const medida = (over: Partial<MedidaDeFichero> = {}): MedidaDeFichero => ({
  sha: "abc1234",
  run: "1",
  fecha: "2026-08-25T00:00:00.000Z",
  blob: "blob-del-mismo-codigo",
  total: 10,
  vivos: [],
  nuevos: [],
  resueltos: 0,
  base: "con base",
  duenos: { veredicto: "sin dueño" },
  ...over,
});

describe("huella · la identidad de un mutante son SIETE componentes", () => {
  // Medido sobre los 19 informes reales (9.040 mutantes, 3.524 supervivientes):
  // con (fichero, línea, mutador) hay 1.155 colisiones —657 grupos, 1.812
  // supervivientes indistinguibles, el 33 %—; con las siete, 0. Cada `it` de
  // aquí abajo es una de esas componentes: si alguien la quita de la clave para
  // "simplificar", el delta empezaría a descontar supervivientes distintos
  // entre sí y diría "no ha cambiado nada" justo cuando algo cambió.
  const base = mutante();

  it("el fichero entra en la identidad", () => {
    assert.notEqual(huellaDeMutante("src/a.ts", base), huellaDeMutante("src/b.ts", base));
  });

  it("la línea de inicio entra", () => {
    const otro = mutante({ location: { start: { line: 25, column: 7 }, end: { line: 24, column: 9 } } });
    assert.notEqual(huellaDeMutante("src/a.ts", base), huellaDeMutante("src/a.ts", otro));
  });

  it("la COLUMNA de inicio entra — es la que separa dos mutantes de la misma línea", () => {
    const otro = mutante({ location: { start: { line: 24, column: 30 }, end: { line: 24, column: 9 } } });
    assert.notEqual(huellaDeMutante("src/a.ts", base), huellaDeMutante("src/a.ts", otro));
  });

  it("la línea de fin entra", () => {
    const otro = mutante({ location: { start: { line: 24, column: 7 }, end: { line: 40, column: 9 } } });
    assert.notEqual(huellaDeMutante("src/a.ts", base), huellaDeMutante("src/a.ts", otro));
  });

  it("la columna de fin entra", () => {
    const otro = mutante({ location: { start: { line: 24, column: 7 }, end: { line: 24, column: 99 } } });
    assert.notEqual(huellaDeMutante("src/a.ts", base), huellaDeMutante("src/a.ts", otro));
  });

  it("el mutador entra", () => {
    assert.notEqual(
      huellaDeMutante("src/a.ts", base),
      huellaDeMutante("src/a.ts", mutante({ mutatorName: "BooleanLiteral" })),
    );
  });

  it("el `replacement` entra — el caso que produce el 33 % de las colisiones", () => {
    // Mismo fichero, misma línea, mismo mutador, distinto reemplazo: Stryker
    // genera los dos (`true` y `false` sobre la misma condición) y con la tupla
    // de tres son EL MISMO mutante.
    assert.notEqual(
      huellaDeMutante("src/a.ts", base),
      huellaDeMutante("src/a.ts", mutante({ replacement: "false" })),
    );
  });

  it("la misma tupla da la misma huella, siempre", () => {
    assert.equal(huellaDeMutante("src/a.ts", mutante()), huellaDeMutante("src/a.ts", mutante()));
  });

  it("un `replacement` ausente no se confunde con otra cosa que la cadena vacía", () => {
    const sinReplacement = { ...mutante(), replacement: undefined };
    assert.equal(huellaDeMutante("src/a.ts", sinReplacement), huellaDeMutante("src/a.ts", mutante({ replacement: "" })));
  });

  it("la clave son exactamente siete campos, en orden y separables", () => {
    assert.deepEqual(claveDeMutante("src/a.ts", base).split("\u0000"), [
      "src/a.ts",
      "24",
      "7",
      "24",
      "9",
      "ConditionalExpression",
      "true",
    ]);
  });

  it("un `replacement` con espacios y saltos no puede fabricar la clave de otro mutante", () => {
    // El `replacement` es código fuente: con un separador que pueda aparecer
    // dentro de un campo, dos tuplas distintas darían la misma clave.
    const conEspacios = mutante({ replacement: "a b\nc" });
    assert.equal(claveDeMutante("src/a.ts", conEspacios).split("\u0000").length, 7);
    assert.notEqual(huellaDeMutante("src/a.ts", conEspacios), huellaDeMutante("src/a.ts", mutante({ replacement: "a b c" })));
  });

  it("el hash es de 64 BITS, y eso se afirma, no se deduce de una probabilidad", () => {
    // El candado que faltaba. El test de colisiones de abajo NO se entera de un
    // truncado a 32 bits: con 20.000 tuplas las colisiones esperadas son 0,047,
    // o sea que solo saltaría el 4,6 % de las veces. Y la presión para truncar
    // es real —la huella salió en 109 KB, no en los ~30 KB que estimaba el
    // plan—, así que el día que alguien quiera adelgazar el fichero el verde le
    // diría que adelante. La longitud y un valor fijo sí lo cazan siempre.
    assert.equal(hash64("").length, 16, "16 hex = 64 bits; menos es otro hash");
    assert.match(hash64("nefan"), /^[0-9a-f]{16}$/);
    // Valores fijos: cambiar el algoritmo, el offset, el primo o la anchura
    // rompe esto de forma determinista, en cualquier máquina y sin azar.
    assert.equal(hash64(""), "cbf29ce484222325", "el offset FNV-1a de 64 bits");
    assert.equal(hash64("nefan"), "5830af1e8d002389");
    assert.equal(
      huellaDeMutante("src/a.ts", mutante()),
      "b2170e6ba81dca02",
      "la huella de una tupla concreta es estable: la base commiteada depende de ello",
    );
  });

  it("el hash no colisiona en el orden de magnitud del problema", () => {
    // 3.524 supervivientes reales; aquí se generan 20.000 tuplas distintas para
    // no fiarse del cálculo de probabilidad. Si alguien recortara el hash a 32
    // bits, esto se pondría rojo (la probabilidad de colisión pasaría de 10⁻¹¹
    // a casi 1).
    const vistos = new Set<string>();
    for (let linea = 1; linea <= 200; linea++) {
      for (let col = 1; col <= 100; col++) {
        vistos.add(
          hash64(claveDeMutante("src/x.ts", mutante({ location: { start: { line: linea, column: col }, end: { line: linea, column: col + 2 } } }))),
        );
      }
    }
    assert.equal(vistos.size, 20000);
  });
});

describe("huella · qué cuenta como vivo y qué entra en el total", () => {
  it("Survived y NoCoverage son vivos; Killed y Timeout, detectados", () => {
    const { vivos, total } = vivosDeFichero("src/a.ts", [
      mutante({ status: "Survived", replacement: "1" }),
      mutante({ status: "NoCoverage", replacement: "2" }),
      mutante({ status: "Killed", replacement: "3" }),
      mutante({ status: "Timeout", replacement: "4" }),
    ]);
    assert.equal(vivos.length, 2);
    assert.equal(total, 4);
  });

  it("un mutante que ni compila NO entra en el denominador: no es un veredicto sobre los tests", () => {
    const { vivos, total } = vivosDeFichero("src/a.ts", [
      mutante({ status: "CompileError", replacement: "1" }),
      mutante({ status: "Ignored", replacement: "2" }),
      mutante({ status: "Killed", replacement: "3" }),
    ]);
    assert.equal(vivos.length, 0);
    assert.equal(total, 1);
  });

  it("las huellas salen ordenadas: el diff de la huella commiteada tiene que ser legible", () => {
    const { vivos } = vivosDeFichero("src/a.ts", [
      mutante({ replacement: "zzz" }),
      mutante({ replacement: "aaa" }),
      mutante({ replacement: "mmm" }),
    ]);
    assert.deepEqual(vivos, [...vivos].sort());
  });
});

describe("delta · tres estados, no dos", () => {
  const h = (r: string) => huellaDeMutante("src/a.ts", mutante({ replacement: r }));
  /** Una medida de AHORA sobre el mismo código que la base del helper `medida`.
   *  Explícito a propósito: comparar es lo excepcional, no lo que pasa por
   *  defecto. */
  const MISMO = (over: { vivos: string[]; total?: number }) => ({
    vivos: over.vivos,
    total: over.total ?? 10,
    blob: "blob-del-mismo-codigo",
  });

  it("mismo hash → YA ESTABA", () => {
    const d = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("a")] }), medida({ vivos: [h("a")] }));
    assert.equal(d.base, "con base");
    assert.deepEqual(d.yaEstaban, [h("a")]);
    assert.deepEqual(d.nuevos, []);
  });

  it("un hash que no estaba → NUEVO", () => {
    const d = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("a"), h("b")] }), medida({ vivos: [h("a")] }));
    assert.deepEqual(d.nuevos, [h("b")]);
    assert.deepEqual(d.yaEstaban, [h("a")]);
  });

  it("SIN BASE no es ni nuevo ni ya estaba", () => {
    // El caso vivo del 2026-08-25: `session-facets` entró con la PR #273 y no
    // tenía informe. Meterlo en "nuevo" inundaría al agente con los cientos de
    // supervivientes de un módulo estrenado y garantizaría que deje de leerlos;
    // en "ya estaba", silencio.
    const d = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("a"), h("b")], total: 88 }), undefined);
    assert.equal(d.base, "sin base");
    assert.deepEqual(d.nuevos, [], "sin medida anterior no hay NUEVO que valga");
    assert.deepEqual(d.yaEstaban, [], "ni YA ESTABA");
    assert.equal(d.total, 88, "pero el total sí se mide");
  });

  it("un superviviente nuevo que cae donde estaba uno viejo NO se descuenta en silencio", () => {
    // El caso caro. Antes 1 vivo, ahora 1 vivo: si el delta fuera una resta,
    // esta corrida diría "sin cambios" teniendo un hallazgo dentro.
    const d = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("nuevo")] }), medida({ vivos: [h("viejo")] }));
    assert.deepEqual(d.nuevos, [h("nuevo")]);
    assert.deepEqual(d.resueltos, [h("viejo")]);
    assert.equal(d.nuevos.length + d.yaEstaban.length, 1, "el total de vivos no ha cambiado");
  });

  it("otro código → INCOMPARABLE, ni nuevo ni ya estaba (la regresión del 2026-08-26)", () => {
    // El caso real, y caro: la corrida 32970154557 marcó 239 supervivientes
    // NUEVOS en cuatro ficheros que NADIE tocó en el rango. La base se había
    // medido en local a las 10:00 del 25 y el tag se plantó a las 15:08 con
    // `bcc8b08` (#263) ya dentro, así que las huellas —que llevan línea y
    // columna— hablaban de otro fichero. Con `--comentar` habría publicado 239
    // hallazgos inventados en cuatro PR ajenas.
    const d = deltaDeFichero(
      "src/a.ts",
      { vivos: [h("a"), h("b")], total: 309, blob: "el-codigo-de-hoy" },
      medida({ vivos: [h("a")], total: 330, blob: "el-codigo-de-ayer" }),
    );
    assert.equal(d.base, "incomparable");
    assert.deepEqual(d.nuevos, [], "no se inventa deuda de nadie");
    assert.deepEqual(d.yaEstaban, [], "ni se afirma lo contrario");
    assert.deepEqual(d.resueltos, [], "y nadie ha resuelto nada");
    assert.match(d.porque ?? "", /el fichero cambió/);
  });

  it("no poder clasificar NO es no tener supervivientes", () => {
    // La otra mitad del mismo fallo: si `vivos` saliera de sumar las dos
    // clasificaciones, un fichero incomparable se guardaría en la huella con
    // CERO supervivientes y la deuda desaparecería de la cola en silencio.
    const d = deltaDeFichero(
      "src/a.ts",
      { vivos: [h("a"), h("b"), h("c")], total: 20, blob: "hoy" },
      medida({ vivos: [h("a")], blob: "ayer" }),
    );
    assert.equal(d.vivos.length, 3, "los tres supervivientes existen aunque no se sepa de quién son");
    assert.equal(d.total, 20);
  });

  it("una base sin blob es de antes de que se guardara: tampoco se compara", () => {
    const d = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("a")] }), medida({ vivos: [], blob: "" }));
    assert.equal(d.base, "incomparable");
    assert.match(d.porque ?? "", /no guardó de qué código era/);
  });

  it("mismo código y distinto número de mutantes → cambió el INSTRUMENTO, no el código", () => {
    // Sin este caso, subir la versión del mutador o tocar su config repartiría
    // sus mutantes desplazados como deuda de la PR que pasara por ahí.
    const d = deltaDeFichero(
      "src/a.ts",
      { vivos: [h("a")], total: 41, blob: "mismo" },
      medida({ vivos: [h("a")], total: 63, blob: "mismo" }),
    );
    assert.equal(d.base, "incomparable");
    assert.match(d.porque ?? "", /el instrumento de medida/);
  });

  it("la consola y el comentario de la PR dicen LO MISMO en los tres estados", () => {
    // Eran dos ternarios gemelos: un estado añadido a uno solo se lee como
    // «0 nuevos» en el otro, que es la mentira original con otra cara.
    const conBase = deltaDeFichero("src/a.ts", MISMO({ vivos: [h("a")] }), medida({ vivos: [] }));
    const sinBase = deltaDeFichero("src/a.ts", MISMO({ vivos: [] }), undefined);
    const incomp = deltaDeFichero("src/a.ts", MISMO({ vivos: [] }), medida({ blob: "otro" }));
    for (const d of [conBase, sinBase, incomp]) {
      const consola = estadoLegible(d);
      const markdown = estadoLegible(d, { markdown: true });
      assert.equal(
        consola.replace(/[A-ZÁÉÍÓÚ]+/g, (t) => t.toLowerCase()),
        markdown.replace(/\*\*/g, ""),
        "las dos salidas tienen que decir lo mismo",
      );
    }
    assert.match(estadoLegible(incomp), /BASE DE OTRO CÓDIGO/);
    assert.match(estadoLegible(incomp, { markdown: true }), /\*\*base de otro código\*\*/);
  });

  it("el delta solo habla de los ficheros MEDIDOS: de los demás no dice ni cero", () => {
    const base: Huella = { ficheros: { "src/a.ts": medida(), "src/otro.ts": medida() } };
    const d = deltaDeCorrida({ "src/a.ts": { vivos: [], total: 3, blob: "otro" } }, base);
    assert.deepEqual(
      d.map((x) => x.fichero),
      ["src/a.ts"],
    );
  });
});

describe("huella · lo que no se midió se conserva", () => {
  it("un módulo que desaparece de la corrida conserva su huella y su fecha", () => {
    // Si se cayera del fichero, el módulo pasaría a "sin base" y su deuda
    // desaparecería de la cola sin que nadie lo hubiera arreglado.
    const base: Huella = {
      ficheros: { "src/viejo.ts": medida({ fecha: "2026-01-01T00:00:00.000Z", total: 99 }) },
    };
    const out = fusiona(base, { "src/nuevo.ts": medida({ total: 5 }) });
    assert.equal(out.ficheros["src/viejo.ts"].total, 99);
    assert.equal(out.ficheros["src/viejo.ts"].fecha, "2026-01-01T00:00:00.000Z");
    assert.equal(out.ficheros["src/nuevo.ts"].total, 5);
  });

  it("lo medido SUSTITUYE, no se suma", () => {
    const base: Huella = { ficheros: { "src/a.ts": medida({ total: 99, vivos: ["deadbeefdeadbeef"] }) } };
    const out = fusiona(base, { "src/a.ts": medida({ total: 5, vivos: [] }) });
    assert.equal(out.ficheros["src/a.ts"].total, 5);
    assert.deepEqual(out.ficheros["src/a.ts"].vivos, []);
  });

  it("las claves salen ordenadas, para que el diff sea revisable", () => {
    const out = fusiona({ ficheros: { "src/z.ts": medida() } }, { "src/a.ts": medida() });
    assert.deepEqual(Object.keys(out.ficheros), ["src/a.ts", "src/z.ts"]);
  });
});

describe("atribución · por módulo × alcance, y honesta", () => {
  const commit = (sha: string, modulos: string[], pr?: number): CommitDelRango => ({
    sha,
    asunto: pr ? `algo (#${pr})` : "algo directo",
    pr,
    modulos,
  });

  it("una sola PR selecciona el módulo → es suya", () => {
    const a = atribuir("store", rangoDe([commit("aaa1111", ["store"], 274), commit("bbb2222", ["world-map"], 276)]));
    assert.equal(a.veredicto, "uno");
    assert.equal(a.etiqueta, "#274");
  });

  it("dos candidatas → se nombran LAS DOS", () => {
    // Un dueño equivocado es peor que dos candidatos: el equivocado se descarta
    // en diez segundos y el hallazgo se queda sin nadie.
    const a = atribuir("store", rangoDe([commit("aaa1111", ["store"], 274), commit("bbb2222", ["store"], 276)]));
    assert.equal(a.veredicto, "varios");
    assert.equal(a.etiqueta, "#274 o #276");
    assert.equal(a.candidatos.length, 2);
  });

  it("ninguna lo selecciona → SIN DUEÑO, y se dice", () => {
    // No se descarta ni se le adjudica al más cercano: se cuenta y se enseña.
    const a = atribuir("store", rangoDe([commit("aaa1111", ["world-map"], 274)]));
    assert.equal(a.veredicto, "sin dueño");
    assert.match(a.etiqueta, /sin dueño en el rango/);
  });

  it("un commit directo a main también puede ser dueño, con su sha", () => {
    // 11 de los últimos 40 commits de este repo no llevan `(#NNN)`. Si solo
    // pudieran ser dueñas las PR, esos supervivientes saldrían huérfanos.
    const a = atribuir("store", rangoDe([commit("aaa1111c", ["store"])]));
    assert.equal(a.etiqueta, "aaa1111");
  });

  // ── #381: un rango vacío no es un módulo sin dueño ──
  it("RANGO VACÍO no se colapsa con SIN DUEÑO: son dos hechos distintos", () => {
    // El bug de #381 en una línea: `repartir` anclaba el rango en el tag
    // `mutacion-ultima`, que la propia corrida adelanta al terminar, así que
    // después de CADA corrida completa el rango salía vacío y los 33 módulos
    // se imprimían «SIN DUEÑO en el rango» — una frase que dice «hubo cambios y
    // ninguno explica esto: míralo», cuando la verdad era «no había dónde
    // mirar». Un hallazgo inventado 33 veces cuesta más que ninguno.
    const vacio = atribuir("store", rangoDe([]));
    const sinDueno = atribuir("store", rangoDe([commit("aaa1111", ["world-map"], 274)]));
    assert.equal(vacio.veredicto, "rango vacío");
    assert.equal(sinDueno.veredicto, "sin dueño");
    assert.notEqual(vacio.veredicto, sinDueno.veredicto);
    assert.notEqual(vacio.etiqueta, sinDueno.etiqueta);
    assert.doesNotMatch(vacio.etiqueta, /sin dueño/, "no puede leerse como el otro veredicto");
    assert.match(vacio.etiqueta, /sin rango/);
    assert.deepEqual(vacio.candidatos, [], "y no se inventa un candidato de la nada");
  });

  it("con rango vacío ningún módulo tiene dueño, tenga el nombre que tenga", () => {
    // No hay una lista de la que salvarse: sin commits, la respuesta es la
    // misma para todos, y es «no lo sé», no «de nadie».
    for (const id of ["store", "world-map", "plugins-dsl"]) {
      assert.equal(atribuir(id, rangoDe([])).veredicto, "rango vacío");
    }
  });
});

describe("atribución · el rango, con la lista vacía hecha inexpresable", () => {
  const commit = (sha: string): CommitDelRango => ({ sha, asunto: "algo", modulos: ["store"] });

  it("cero commits → `vacío`, y no un `commits` con lista vacía", () => {
    // La rama `commits` es una tupla NO VACÍA: `{tipo:"commits", commits:[]}`
    // no compila. Aquí se comprueba lo que el tipo no puede — que el
    // constructor use la rama correcta.
    assert.deepEqual(rangoDe([]), { tipo: "vacío" });
  });

  it("uno o más commits → `commits`, con todos dentro y en orden", () => {
    const r = rangoDe([commit("aaa"), commit("bbb")]);
    assert.equal(r.tipo, "commits");
    if (r.tipo !== "commits") return;
    assert.deepEqual(
      r.commits.map((c) => c.sha),
      ["aaa", "bbb"],
    );
    // El primero es `CommitDelRango`, no `CommitDelRango | undefined`: eso lo
    // afirma el tipo tupla y por eso esta línea compila sin guardia.
    const primero: CommitDelRango = r.commits[0];
    assert.equal(primero.sha, "aaa");
  });
});

describe("atribución · de qué PR es un asunto de commit", () => {
  it("coge la ÚLTIMA referencia: las issues cerradas van antes que la PR", () => {
    // Asunto REAL de este repo, y elegido a propósito: son DOS grupos que casan
    // el regex, así que primera y última difieren de verdad. El fixture que
    // había antes —"… (#245 #249 #246) (#273)"— no podía poner rojo este test:
    // el grupo con espacios NO casa `/\(#(\d+)\)/`, así que producía una sola
    // coincidencia y `todos[0] === todos[último]`. Con `todos[0]` en el fuente,
    // la batería entera seguía en verde. Verificado en las dos direcciones.
    assert.equal(prDelAsunto("Se retira el gpu-worker y con él la cadena de reuse por hash (#199) (#258)"), 258);
    // No es un caso de laboratorio: 4 de los últimos 200 commits tienen esta
    // forma, y en todos ellos la PRIMERA referencia es la issue que se cierra.
    // Coger la primera mandaría el reparto a comentar sobre una issue cerrada
    // en vez de sobre la PR que trajo el superviviente.
    assert.equal(prDelAsunto("El selector mira `arch-rules.json` por REGLA (#230) (#254)"), 254);
  });

  it("un grupo con varias issues juntas no cuenta como referencia", () => {
    // "(#245 #249 #246)" no casa el regex (los dígitos no van pegados al
    // paréntesis de cierre), y eso es lo que hace que el asunto de #273 dé una
    // sola coincidencia. Se afirma aquí para que el fixture de arriba no vuelva
    // a apoyarse en ello sin decirlo.
    assert.equal(prDelAsunto("Reanudar te devuelve donde lo dejaste (#245 #249 #246) (#273)"), 273);
    assert.equal(prDelAsunto("Solo issues juntas (#245 #249 #246)"), undefined);
  });

  it("un asunto sin referencia no inventa una", () => {
    assert.equal(prDelAsunto("Bitácora: la mutación sale de la máquina"), undefined);
  });
});

/** Un informe declarado en el manifiesto, con su sello. El sello por defecto
 *  deriva del nombre para que dos informes distintos no compartan hash sin que
 *  el test lo diga a propósito. */
const sello = (modulo: string, sha256 = `sello-de-${modulo}`): InformeSellado => ({ modulo, sha256 });

describe("manifiesto · quién puede mover el tag", () => {
  const corrida = (over: Partial<Corrida> = {}): Corrida => ({
    sha: "abc",
    desde: "ancla000",
    run_id: "1",
    origen: "rango",
    modulos_pedidos: ["a", "b"],
    informes: [sello("a"), sello("b")],
    fecha: "2026-08-25T00:00:00.000Z",
    ...over,
  });

  it("una corrida del rango, completa, mueve el tag", () => {
    const v = veredictoDeCorrida(corrida());
    assert.equal(v.completa, true);
    assert.equal(v.mueveTag, true);
  });

  it("una corrida TRUNCADA no mueve el tag y dice qué falta", () => {
    // El artefacto sube con `if: always()`, así que una corrida que se coma el
    // timeout deja informes de verdad. Mover el tag ahí declararía medido lo
    // que nadie midió, y el agujero sería invisible desde ese momento.
    const v = veredictoDeCorrida(corrida({ informes: [sello("a")] }));
    assert.equal(v.completa, false);
    assert.equal(v.mueveTag, false);
    assert.match(v.porque, /\bb\b/);
  });

  it("los módulos con informe salen de `informes`, sin que nadie repita la lista", () => {
    // Había DOS listas de nombres en el manifiesto y ahora hay una: el sello
    // trae el módulo dentro. Una segunda lista podría discrepar de la primera.
    assert.deepEqual(modulosConInforme(corrida()), ["a", "b"]);
  });

  it("una lista EXPLÍCITA de módulos NO mueve el tag aunque esté completa", () => {
    const v = veredictoDeCorrida(corrida({ origen: "explicito" }));
    assert.equal(v.completa, true, "la medida vale");
    assert.equal(v.mueveTag, false, "pero no puede declarar medido el rango entero");
  });

  it("la corrida completa sí lo mueve", () => {
    assert.equal(veredictoDeCorrida(corrida({ origen: "todos" })).mueveTag, true);
  });
});

describe("descarga · ni falta, ni sobra, ni es otro informe con el mismo nombre", () => {
  const corrida: Corrida = {
    sha: "abc",
    desde: "ancla000",
    run_id: "9",
    origen: "rango",
    modulos_pedidos: ["store", "world-map"],
    informes: [sello("store"), sello("world-map")],
    fecha: "2026-08-25T00:00:00.000Z",
  };

  it("lo exacto pasa", () => {
    assert.deepEqual(verificaDescarga(corrida, [sello("store"), sello("world-map")]), []);
  });

  it("un módulo declarado que no viene es una corrida truncada", () => {
    const errores = verificaDescarga(corrida, [sello("store")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /world-map/);
  });

  it("una corrida a la que se le CAYÓ un módulo se puede bajar igual", () => {
    // El caso que ninguna de las tres pruebas de arriba alimentaba: las tres
    // usan una corrida con `pedidos === informes`, así que la confusión entre
    // las dos listas nunca se ejercía. La pagó la corrida 33790710680
    // (2026-09-03): `contrato-escena` murió en su dry-run, y los 32 informes
    // restantes —10.128 mutantes, 131 min de runner— no había forma de
    // repartirlos. Que la corrida sea INCOMPLETA lo dictamina
    // `veredictoDeCorrida`, no esto: aquí solo se comprueba que el artefacto
    // trae lo que promete.
    const caida: Corrida = {
      ...corrida,
      modulos_pedidos: ["store", "world-map", "contrato-escena"],
      informes: [sello("store"), sello("world-map")],
    };
    assert.deepEqual(verificaDescarga(caida, [sello("store"), sello("world-map")]), []);
    const v = veredictoDeCorrida(caida);
    assert.equal(v.completa, false, "y sigue siendo INCOMPLETA: no se ha perdido el hecho");
    assert.equal(v.mueveTag, false);
    assert.match(v.porque, /contrato-escena/);
  });

  it("de una corrida caída sigue faltando lo que SÍ prometía", () => {
    // La otra mitad: bajar mal el artefacto de una corrida incompleta tiene que
    // seguir doliendo. Lo que se relaja es la comparación con `pedidos`, no la
    // integridad de la descarga.
    const caida: Corrida = {
      ...corrida,
      modulos_pedidos: ["store", "world-map", "contrato-escena"],
      informes: [sello("store"), sello("world-map")],
    };
    const errores = verificaDescarga(caida, [sello("store")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /world-map/);
    assert.doesNotMatch(errores[0], /contrato-escena/, "el que no midió no es un fallo de descarga");
  });

  it("un informe VIEJO que se quedó en el directorio se rechaza", () => {
    // Es el fallo silencioso: dos medidas de fechas distintas presentadas como
    // una sola foto. `npm run deuda` sumaría los supervivientes de la semana
    // pasada a los de hoy sin decir que son de corridas diferentes.
    const errores = verificaDescarga(corrida, [sello("store"), sello("world-map"), sello("plugins-dsl")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /plugins-dsl/);
    assert.match(errores[0], /medida anterior/);
  });

  // ── #420: el sello, que es lo que el nombre no podía ver ──
  it("un `local` corrido ENCIMA de la descarga se caza: el nombre casa y el contenido no", () => {
    // El agujero exacto de #420. `npm run mutacion -- local world-map` escribe
    // en `reports/mutation/world-map.json`, que es el nombre EXACTO que el
    // manifiesto espera: no faltaba ni sobraba nada, así que el guardia lo
    // dejaba pasar, entraba en el reparto y de ahí a la huella commiteada con
    // el sha, la fecha y el run de CI encima de una medida que no era de CI —
    // dos núcleos, otro código y otro momento.
    const errores = verificaDescarga(corrida, [sello("store"), sello("world-map", "el-que-dejo-el-local")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /world-map/, "tiene que NOMBRAR el módulo suplantado");
    assert.doesNotMatch(errores[0], /\bstore\b/, "y no arrastrar al que sí es de la corrida");
    assert.match(errores[0], /9/, "y decir de qué corrida se esperaba");
    assert.match(errores[0], /local/, "y qué lo produce, que es lo accionable");
  });

  it("el sello caza también el informe truncado o editado a mano", () => {
    // No es solo el `local`: cualquier contenido distinto bajo el mismo nombre
    // —una descarga a medias, un JSON tocado a mano— deja de pasar por bueno.
    const errores = verificaDescarga(corrida, [sello("store", "medio-fichero"), sello("world-map")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /store/);
  });

  it("los tres fallos se cuentan por separado: no se tapan entre ellos", () => {
    // Falta uno, sobra otro y un tercero está suplantado. Si el guardia parara
    // en el primero, arreglar la descarga descubriría el siguiente fallo de uno
    // en uno, y el sello —el más silencioso— sería el último en verse.
    const tres: Corrida = {
      ...corrida,
      modulos_pedidos: ["store", "world-map", "plugins-dsl"],
      informes: [sello("store"), sello("world-map"), sello("plugins-dsl")],
    };
    const errores = verificaDescarga(tres, [
      sello("store", "otro-contenido"),
      sello("world-map"),
      sello("session-facets"),
    ]);
    assert.equal(errores.length, 3);
    assert.match(errores.join("\n"), /plugins-dsl/, "el que falta");
    assert.match(errores.join("\n"), /session-facets/, "el que sobra");
    assert.match(errores.join("\n"), /store/, "el suplantado");
  });

  it("un módulo PEDIDO y CAÍDO que aparece en disco se caza: el guardia mira `informes`", () => {
    // El invariante que estableció #418 y que no defendía nadie: `declarados`
    // sale de `informes`, NO de `modulos_pedidos`. La diferencia solo se ve en
    // el caso que esta tanda tiene vivo — `contrato-escena` se pidió en la
    // corrida 33790710680 y murió en su dry-run, así que no dejó informe. Si
    // alguien corre `local contrato-escena` encima de la descarga, el fichero
    // aparece en disco SIN sello con el que compararlo: no falta (no está
    // declarado) y no puede estar suplantado. Lo caza `sobran`, y solo porque
    // `declarados` sale de lo que la corrida TRAE. Comparado contra lo que
    // PIDIÓ, la medida local pasaría por buena y entraría en la huella.
    const caida: Corrida = {
      ...corrida,
      modulos_pedidos: ["store", "world-map", "contrato-escena"],
      informes: [sello("store"), sello("world-map")],
    };
    const errores = verificaDescarga(caida, [sello("store"), sello("world-map"), sello("contrato-escena")]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /contrato-escena/);
    assert.match(errores[0], /medida anterior/);
  });

  it("mismo nombre y mismo sello pasa: el guardia no rechaza de más", () => {
    // La otra dirección. Un guardia que rechazara siempre sería igual de
    // inútil, y además apagaría el ritual entero de `traer`.
    assert.deepEqual(
      verificaDescarga(corrida, [sello("world-map"), sello("store")]),
      [],
      "el orden en disco tampoco decide nada",
    );
  });
});

describe("lotes · se empaqueta por el RELOJ, y lo desconocido va solo", () => {
  const m = (id: string, segundos?: number): ModuloAEmpaquetar =>
    segundos === undefined ? { id } : { id, segundos };

  it("cabe lo que cabe, y no se pasa del tope", () => {
    const lotes = empaqueta([m("a", 900), m("b", 800), m("c", 700)], 1800);
    assert.equal(lotes.length, 2);
    for (const l of lotes) assert.ok(l.segundos <= 1800, `${l.modulos.join(",")} se pasa: ${l.segundos}s`);
  });

  it("todo módulo pedido acaba en EXACTAMENTE un lote", () => {
    // La totalidad, que es lo que impide que un módulo se caiga del reparto sin
    // que nada falle: un módulo que no está en ningún lote no lo mide nadie, y
    // la corrida saldría COMPLETA porque tampoco estaría en `modulos_pedidos`
    // si el plan se derivara de los lotes.
    const ids = ["a", "b", "c", "d", "e"];
    const lotes = empaqueta([m("a", 1700), m("b", 900), m("c", 800), m("d"), m("e", 100)], 1800);
    const colocados = lotes.flatMap((l) => l.modulos);
    assert.deepEqual([...colocados].sort(), [...ids].sort());
    assert.equal(colocados.length, new Set(colocados).size, "ningún módulo en dos lotes");
  });

  it("el más caro primero, y el id NO decide el orden", () => {
    // First-fit DECRECIENTE. Los ids están elegidos para que el orden
    // alfabético y el orden por coste sean OPUESTOS: si alguien sustituyera el
    // criterio por el id —o por el orden de entrada—, el módulo caro llegaría
    // el último, no encontraría hueco y abriría un lote casi vacío mientras los
    // baratos llenan el primero.
    const lotes = empaqueta([m("alfa", 100), m("bravo", 50), m("zorro", 1700)], 1800);
    assert.equal(lotes[0].modulos[0], "zorro", "el más caro abre el primer lote");
  });

  it("el reparto no depende del orden de entrada", () => {
    // Dos corridas del mismo plan tienen que dar EL MISMO reparto: es lo que
    // deja comparar dos corridas entre sí y revisar el plan en la PR. El
    // desempate va por id, que es el único criterio estable que hay.
    const uno = empaqueta([m("z", 100), m("a", 1000), m("b", 900)], 1800);
    const otro = empaqueta([m("b", 900), m("z", 100), m("a", 1000)], 1800);
    assert.deepEqual(uno, otro);
  });

  it("un módulo SIN MEDIDA va solo, y no se le supone un cero", () => {
    // La misma regla que `permisoLocal`: un coste desconocido no se supone
    // barato. Metido en un hueco con un 0 implícito, es lo que revienta el
    // reloj del job que lo acoja.
    const lotes = empaqueta([m("caro", 1700), m("nadie-lo-midio")], 1800);
    const suyo = lotes.find((l) => l.modulos.includes("nadie-lo-midio"));
    assert.ok(suyo, "el módulo sin medida tiene que estar en algún lote");
    assert.deepEqual(suyo.modulos, ["nadie-lo-midio"], "y él solo");
    assert.equal(suyo.medido, false, "y su lote dice que no se sabe lo que cuesta");
    assert.equal(suyo.margen, undefined, "un lote sin medida no tiene margen que enseñar");
  });

  it("VARIOS módulos sin medida van cada uno en SU lote, no todos juntos en uno", () => {
    // El caso que faltaba, y no es un detalle: con UN solo módulo sin medida,
    // «va solo» y «van todos juntos» son la MISMA cosa, así que las once
    // llamadas que había no podían distinguirlas. Es el mismo verde que cazó el
    // guion en `costeDeLaMatriz` (mediana con dos jobs), en la función hermana
    // y sobre la regla que hoy gobierna 17 de los 41 módulos: agrupados, los 17
    // sin cronometrar —`contrato-escena` incluido— caerían en un solo job
    // contra un timeout de 45 minutos, que es literalmente el fallo que motivó
    // partir la corrida.
    const sin = ["ai-client", "contrato-escena", "tile-edges"];
    const lotes = empaqueta([m("caro", 1700), ...sin.map((id) => m(id))], 1800);
    const deSinMedida = lotes.filter((l) => !l.medido);
    assert.equal(deSinMedida.length, sin.length, "un lote POR MÓDULO sin cronometrar, no uno para todos");
    for (const l of deSinMedida) {
      assert.equal(l.modulos.length, 1, `el lote ${l.lote} lleva ${l.modulos.length} módulos sin medida`);
    }
    assert.deepEqual(
      deSinMedida.flatMap((l) => l.modulos).sort(),
      [...sin].sort(),
      "y están todos: ninguno se pierde por el camino",
    );
  });

  it("la totalidad se afirma: tantos lotes sin medida como módulos sin medida", () => {
    // La relación, no una lectura a ojo del reparto. Si alguien juntara dos, o
    // colara uno en un hueco, este número dejaría de casar.
    for (const cuantos of [1, 2, 5]) {
      const sin = Array.from({ length: cuantos }, (_, i) => m(`sin-medir-${i}`));
      const lotes = empaqueta([m("a", 900), m("b", 800), ...sin], 1800);
      assert.equal(
        lotes.filter((l) => !l.medido).length,
        cuantos,
        `con ${cuantos} módulo(s) sin medida tienen que salir ${cuantos} lote(s) sin medida`,
      );
    }
  });

  it("un lote de módulos sin medir NO es un lote de 0 segundos", () => {
    // El colapso que haría inútil todo lo anterior. Los dos lotes dicen
    // `segundos: 0`, así que por el número son indistinguibles: lo que los
    // separa es `medido`, y sin ese campo «no cuesta nada» y «nadie sabe lo que
    // cuesta» serían la misma cosa para quien lea el reparto — y el segundo
    // acabaría en un hueco.
    const [medidoEnCero] = empaqueta([m("instantaneo", 0)], 1800);
    const [sinMedir] = empaqueta([m("nadie-lo-midio")], 1800);
    assert.equal(medidoEnCero.segundos, sinMedir.segundos, "por el número son iguales");
    assert.notEqual(medidoEnCero.medido, sinMedir.medido, "y aun así no son lo mismo");
    assert.equal(medidoEnCero.medido, true);
    assert.equal(sinMedir.medido, false);
  });

  it("un módulo que SOLO ya pasa del tope va solo y se le ve el margen negativo", () => {
    // No es un error: es el aviso de que ese módulo se volvió patológico y hay
    // que partir su batería. Subir el tope sería la salida barata, la misma que
    // `tope_local` prohíbe.
    const lotes = empaqueta([m("gigante", 2500), m("normal", 100)], 1800);
    const suyo = lotes.find((l) => l.modulos.includes("gigante"));
    assert.deepEqual(suyo?.modulos, ["gigante"]);
    assert.ok((suyo?.margen ?? 0) < 0, "su margen tiene que salir NEGATIVO, para que se vea");
    assert.ok(
      lotes.some((l) => l.modulos.includes("normal") && !l.modulos.includes("gigante")),
      "y no arrastra a nadie con él",
    );
  });

  it("el margen de cada lote es lo que le queda hasta el tope", () => {
    const [uno] = empaqueta([m("a", 1647)], 1800);
    assert.equal(uno.margen, 153, "blueprint-derive: 2,5 minutos hasta el tope");
  });

  it("sin módulos no hay lotes: no se inventa uno vacío", () => {
    assert.deepEqual(empaqueta([], 1800), []);
  });
});

describe("fusionar · `modulos_pedidos` sale del PLAN, nunca de los lotes que llegaron", () => {
  const sello2 = (modulo: string, segundos?: number): InformeSellado => ({
    modulo,
    sha256: `sello-de-${modulo}`,
    ...(segundos === undefined ? {} : { segundos }),
  });
  const PLAN: PlanDeCorrida = {
    sha: "abc123",
    desde: "ancla000",
    run_id: "77",
    origen: "rango",
    modulos_pedidos: ["a", "b", "c"],
    lotes: [
      { lote: 1, modulos: ["a", "b"], segundos: 900, medido: true, margen: 900 },
      { lote: 2, modulos: ["c"], segundos: 0, medido: false },
    ],
  };
  const parcial = (over: Partial<Corrida> = {}): Corrida => ({
    sha: PLAN.sha,
    desde: PLAN.desde,
    run_id: PLAN.run_id,
    origen: PLAN.origen,
    modulos_pedidos: ["a", "b"],
    informes: [sello2("a"), sello2("b")],
    fecha: "2026-09-04T10:00:00.000Z",
    ...over,
  });

  it("con todos los lotes vivos, la corrida es COMPLETA", () => {
    const c = fusionaCorrida(
      PLAN,
      [parcial(), parcial({ modulos_pedidos: ["c"], informes: [sello2("c")] })],
      "2026-09-04T11:00:00.000Z",
    );
    assert.deepEqual(c.modulos_pedidos, ["a", "b", "c"]);
    assert.deepEqual(modulosConInforme(c), ["a", "b", "c"]);
    assert.equal(veredictoDeCorrida(c).completa, true);
    assert.equal(veredictoDeCorrida(c).mueveTag, true);
  });

  it("UN LOTE MUERTO deja la corrida INCOMPLETA y el tag quieto", () => {
    // EL CANDADO DE LA PR. El lote 2 no sube nada —se lo comió el timeout, o el
    // runner se cayó—. `modulos_pedidos` sale del PLAN, así que "c" sigue
    // pedido y sin informe: INCOMPLETA, el tag no se mueve y la próxima corrida
    // vuelve a pedirlo.
    //
    // Si `modulos_pedidos` se reconstruyera desde los parciales que llegaron,
    // "c" desaparecería de las DOS listas, volverían a casar y el veredicto
    // diría COMPLETA: el tag se movería declarando medido lo que nadie midió, y
    // a partir de ahí el agujero es invisible. Es el mismo fallo que #418 y
    // #381 llevan dos tandas cerrando.
    const c = fusionaCorrida(PLAN, [parcial()], "2026-09-04T11:00:00.000Z");
    assert.deepEqual(c.modulos_pedidos, ["a", "b", "c"], "lo pedido NO encoge con el lote que murió");
    assert.deepEqual(modulosConInforme(c), ["a", "b"]);
    const v = veredictoDeCorrida(c);
    assert.equal(v.completa, false);
    assert.equal(v.mueveTag, false, "un tag que se mueve aquí declara medido lo que nadie midió");
    assert.match(v.porque, /\bc\b/, "y dice cuál falta");
  });

  it("el lote sin noticias se puede NOMBRAR, que es lo que su job ya no puede decir", () => {
    const caidos = lotesSinNoticias(PLAN, [parcial()]);
    assert.equal(caidos.length, 1);
    assert.equal(caidos[0].lote, 2);
    assert.deepEqual(caidos[0].modulos, ["c"]);
  });

  it("un parcial de OTRA corrida no se mezcla: se lanza", () => {
    for (const [campo, valor] of [
      ["sha", "otro-commit"],
      ["desde", "otra-ancla"],
      ["run_id", "78"],
      ["origen", "todos"],
    ] as const) {
      assert.throws(
        () => fusionaCorrida(PLAN, [parcial({ [campo]: valor } as Partial<Corrida>)], "f"),
        new RegExp(campo),
        `un parcial con ${campo} distinto tiene que lanzar`,
      );
    }
  });

  it("un módulo en DOS lotes se lanza: se mediría dos veces", () => {
    const roto: PlanDeCorrida = {
      ...PLAN,
      lotes: [
        { lote: 1, modulos: ["a", "b"], segundos: 900, medido: true, margen: 900 },
        { lote: 2, modulos: ["b", "c"], segundos: 900, medido: true, margen: 900 },
      ],
    };
    assert.throws(() => fusionaCorrida(roto, [], "f"), /"b"/);
  });

  it("un informe de un módulo que no está en ningún lote se lanza", () => {
    assert.throws(
      () => fusionaCorrida(PLAN, [parcial({ informes: [sello2("intruso")] })], "f"),
      /intruso/,
    );
  });

  it("dos parciales con el MISMO módulo se lanzan: dos medidas presentadas como una", () => {
    assert.throws(
      () => fusionaCorrida(PLAN, [parcial(), parcial({ informes: [sello2("a")] })], "f"),
      /"a"/,
    );
  });

  it("los segundos de cada informe sobreviven a la fusión", () => {
    // Es el dato que motiva la PR: sin él, la corrida siguiente no sabe cuánto
    // tarda nada y todo vuelve a lote propio.
    const c = fusionaCorrida(
      PLAN,
      [parcial({ informes: [sello2("a", 1647), sello2("b")] })],
      "2026-09-04T11:00:00.000Z",
    );
    assert.equal(c.informes.find((i) => i.modulo === "a")?.segundos, 1647);
    assert.equal(c.informes.find((i) => i.modulo === "b")?.segundos, undefined, "y la ausencia también");
  });

  // ── el plan es lo único que llega sin sello, así que se mira ──
  it("un plan cuyo `modulos_pedidos` no cubre sus lotes se lanza: un lote muerto saldría COMPLETA", () => {
    // El agujero que encontró QA. Con `apuntado` en el lote 2 y FUERA de
    // `modulos_pedidos`, si el lote 2 muere nadie lo echa de menos: las dos
    // listas casan, `veredictoDeCorrida` dice COMPLETA y el tag se adelanta
    // declarando medido lo que nadie midió. Cada informe se comprueba con su
    // sha256; el documento del que sale el veredicto entero, no se comprobaba.
    const recortado: PlanDeCorrida = { ...PLAN, modulos_pedidos: ["a", "b"] };
    assert.throws(() => fusionaCorrida(recortado, [parcial()], "f"), /\bc\b/);
  });

  it("un plan que pide un módulo que no mide ningún lote se lanza", () => {
    // La otra dirección: la corrida no podría salir COMPLETA nunca, y eso es un
    // plan roto, no una corrida incompleta.
    const sobrante: PlanDeCorrida = { ...PLAN, modulos_pedidos: ["a", "b", "c", "fantasma"] };
    assert.throws(() => fusionaCorrida(sobrante, [parcial()], "f"), /fantasma/);
  });

  it("un plan que no pide NADA se lanza: cero medido y el tag adelantado es el peor final", () => {
    const vacio: PlanDeCorrida = { ...PLAN, modulos_pedidos: [], lotes: [] };
    assert.throws(() => fusionaCorrida(vacio, [], "f"), /no pide medir NADA/);
  });

  it("un lote SIN NOTICIAS y COMPLETA no pueden convivir: es imposible, no improbable", () => {
    // La consecuencia de exigir que las dos listas del plan sean el mismo
    // conjunto. Con eso, los módulos de un lote que no sube nada están sí o sí
    // en `modulos_pedidos` y fuera de `informes` → INCOMPLETA. Antes las dos
    // frases salían juntas en la misma pantalla y quien leía el job tenía que
    // elegir cuál creerse.
    for (const parciales of [[], [parcial()]]) {
      const c = fusionaCorrida(PLAN, parciales, "f");
      const caidos = lotesSinNoticias(PLAN, parciales);
      if (caidos.length === 0) continue;
      assert.equal(
        veredictoDeCorrida(c).completa,
        false,
        `con ${caidos.length} lote(s) sin noticias, COMPLETA es una contradicción`,
      );
    }
  });

  it("un lote que no llegó NO es un error de fusión: es una medida que falta", () => {
    // Tres estados otra vez: lote medido, lote a medias (su propio parcial ya lo
    // declara) y lote sin noticias. Lanzar aquí impediría repartir los lotes que
    // SÍ midieron — 131 minutos de runner tirados, que es exactamente lo que
    // pasó el 2026-09-03 cuando `contrato-escena` se cayó.
    assert.doesNotThrow(() => fusionaCorrida(PLAN, [parcial()], "f"));
  });
});

describe("el coste del día después se MIDE, no se estima", () => {
  const job = (name: string, creado: string, empezado: string, acabado: string): JobDeCI => ({
    name,
    created_at: `2026-09-04T10:${creado}:00Z`,
    started_at: `2026-09-04T10:${empezado}:00Z`,
    completed_at: `2026-09-04T10:${acabado}:00Z`,
  });

  it("la espera de cola es el hueco entre encolado y empezado, y se coge el PEOR", () => {
    // TRES jobs a propósito, y no dos: con dos, la mediana y el peor son el
    // MISMO elemento, y este test no podía ponerse rojo si alguien cambiaba uno
    // por el otro. Lo cazó el guion de negativos sobre este mismo caso.
    // Importa qué se coge: basta UN job atascado para que quien tiene una PR no
    // pueda cerrar su tarea, y la mediana lo escondería.
    const c = costeDeLaMatriz(
      [job("lote 1", "00", "00", "10"), job("lote 2", "00", "01", "11"), job("lote 3", "00", "05", "15")],
      120,
    );
    assert.equal(c.esperaPeor, 300, "el peor, no la mediana");
    assert.equal(c.esperaPeorJob, "lote 3");
    assert.equal(c.esperaMediana, 60, "y la mediana se enseña aparte, que es otra cosa");
    assert.notEqual(c.esperaPeor, c.esperaMediana, "si salieran iguales, este test no probaría nada");
  });

  it("por encima del presupuesto NO cabe, y eso es lo que baja `max-parallel`", () => {
    assert.equal(costeDeLaMatriz([job("a", "00", "01", "10")], 120).cabe, true, "60 s caben en 120");
    assert.equal(costeDeLaMatriz([job("a", "00", "03", "10")], 120).cabe, false, "180 s no");
  });

  it("el SOBRECOSTE es lo que la matriz paga de más por venir partida", () => {
    // Dos jobs en paralelo de 10 min cada uno: 20 min de runner en 10 de reloj.
    // Esos 10 de más son N × (checkout + npm ci + dry-run), y son minutos de
    // runner, no de reloj. Se dicen, porque es el precio honesto de partir.
    const c = costeDeLaMatriz([job("a", "00", "00", "10"), job("b", "00", "00", "10")], 120);
    assert.equal(c.pared, 600);
    assert.equal(c.runner, 1200);
    assert.equal(c.sobrecoste, 600);
  });

  it("un solo job no paga sobrecoste, y no sale NEGATIVO", () => {
    assert.equal(costeDeLaMatriz([job("a", "00", "00", "10")], 120).sobrecoste, 0);
  });

  it("sin jobs se lanza en vez de contestar cero", () => {
    // Un cero se leería como «no estorba nada», que es la conclusión opuesta a
    // la verdadera («no se ha medido»).
    assert.throws(() => costeDeLaMatriz([], 120), /no hay jobs/);
  });
});

describe("tope local · no se puede equivocar hacia arriba", () => {
  it("un módulo barato se mide aquí", () => {
    const p = permisoLocal("blueprint-plan", 41, 150);
    assert.equal(p.ok, true);
  });

  it("uno caro se rechaza diciendo el coste y el tope", () => {
    const p = permisoLocal("plugins-dsl", 1362, 150);
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.match(p.porque, /1362 mutantes/);
    assert.match(p.porque, /tope local es 150/);
    assert.match(p.porque, /pendiente/, "tiene que decir qué hacer en su lugar");
  });

  it("justo en el tope entra; uno más, no", () => {
    assert.equal(permisoLocal("x", 150, 150).ok, true);
    assert.equal(permisoLocal("x", 151, 150).ok, false);
  });

  it("el tope guarda la CORRIDA ENTERA, no solo un módulo suelto", () => {
    // La lección del 2026-08-25: el tope vivía en el verbo `local` y el
    // accidente no pasó por encima, pasó por debajo — `npm run mutate` a secas,
    // los 20 módulos, la puerta que no tenía cerradura. Ahora lo guarda
    // `mutate.ts`, así que el sujeto del permiso puede ser una corrida.
    const p = permisoLocal("estos 20 módulos", 9082, 120);
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.match(p.porque, /9082 mutantes/);
  });

  it("en CI el tope NO aplica: allí no hay nadie delante", () => {
    // El tope es una propiedad de la MÁQUINA, no del repositorio. En el runner
    // la corrida completa es justo lo que se le pide.
    assert.equal(permisoLocal("estos 20 módulos", 9082, 120, true).ok, true);
    assert.equal(permisoLocal("session-facets", undefined, 120, true).ok, true);
  });

  it("sin medida previa NO se autoriza: podría ser de los caros", () => {
    // "No lo sé, adelante" es justo el error hacia arriba que este tope existe
    // para hacer imposible. Se mide una vez en CI y a partir de ahí el coste
    // está en la huella.
    const p = permisoLocal("session-facets", undefined, 150);
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.match(p.porque, /no hay medida previa/);
  });
});

describe("la cola de deuda deja de mandar lo que la política prohíbe", () => {
  it("un módulo barato manda medirlo aquí", () => {
    assert.match(queHacerCon("blueprint-plan", 41, 150), /npm run mutacion -- local blueprint-plan/);
  });

  it("uno caro manda pedirlo, no correrlo", () => {
    const que = queHacerCon("plugins-dsl", 1362, 150);
    assert.match(que, /npm run mutacion -- pendiente/);
    assert.doesNotMatch(que, /-- local/);
  });

  it("NINGÚN consejo dice `npm run mutate`", () => {
    // La herramienta contradecía a la doctrina en cinco sitios: `npm run deuda`
    // imprimía "Para la cola completa: npm run coverage && npm run mutate",
    // que es exactamente lo que no se puede correr en la máquina de quien
    // programa.
    for (const coste of [41, 1362, undefined]) {
      assert.doesNotMatch(queHacerCon("x", coste, 150), /npm run mutate\b/);
    }
  });
});

describe("cola de deuda · qué se lee de cada fichero", () => {
  const h = (r: string) => huellaDeMutante("src/a.ts", mutante({ replacement: r }));

  it("sin medida previa lo dice, no lo calla", () => {
    assert.match(anotacionDeFichero([h("a")], undefined), /sin base de comparación/);
  });

  it("los NUEVOS salen con su dueño", () => {
    const base = medida({ vivos: [h("a"), h("b")], nuevos: [h("b")], duenos: { veredicto: "con dueño", quienes: ["#274", "#276"] } });
    assert.match(anotacionDeFichero([h("a"), h("b")], base), /1 NUEVOS · #274 o #276/);
  });

  it("un NUEVO sin dueño lo dice en vez de inventarse uno", () => {
    const base = medida({ vivos: [h("b")], nuevos: [h("b")], duenos: { veredicto: "sin dueño" } });
    assert.match(anotacionDeFichero([h("b")], base), /sin dueño en el rango/);
  });

  it("si ya no queda ninguno de los nuevos, no se sigue anunciando", () => {
    const base = medida({ vivos: [h("a"), h("b")], nuevos: [h("b")], duenos: { veredicto: "con dueño", quienes: ["#274"] } });
    assert.match(anotacionDeFichero([h("a")], base), /ya estaban/);
  });

  it("un superviviente que la última medida no conocía se marca sin atribuir", () => {
    // Solo puede venir de un `npm run mutacion -- local` posterior. Decirlo
    // evita leer la atribución de la huella como si también cubriera a estos.
    const base = medida({ vivos: [h("a")], nuevos: [], duenos: { veredicto: "con dueño", quienes: ["#274"] } });
    assert.match(anotacionDeFichero([h("a"), h("z")], base), /1 sin atribuir/);
  });

  it("los resueltos se enseñan: es la mitad buena del delta", () => {
    const base = medida({ vivos: [h("a")], nuevos: [], resueltos: 3, duenos: { veredicto: "sin dueño" } });
    assert.match(anotacionDeFichero([h("a")], base), /3 resueltos/);
  });

  // ── #381 un piso más abajo: lo que la huella GUARDA de la atribución ──
  it("un NUEVO de un RANGO VACÍO no se lee como «sin dueño»: nadie lo buscó", () => {
    // El bug de #381 desplazado a la huella. `atribuir` distingue los dos
    // estados y la consola de `repartir` los imprime bien; si al escribir se
    // colapsaran en una lista vacía, `npm run deuda` diría «1 NUEVOS · sin
    // dueño en el rango» de un módulo al que NADIE le buscó dueño. Una
    // no-medida con cara de resultado, que es el fallo original con otra cara.
    const sinRango = medida({ vivos: [h("b")], nuevos: [h("b")], duenos: { veredicto: "rango vacío" } });
    const sinDueno = medida({ vivos: [h("b")], nuevos: [h("b")], duenos: { veredicto: "sin dueño" } });
    const leidoSinRango = anotacionDeFichero([h("b")], sinRango);
    const leidoSinDueno = anotacionDeFichero([h("b")], sinDueno);
    assert.notEqual(leidoSinRango, leidoSinDueno, "los dos estados no pueden leerse igual");
    assert.doesNotMatch(leidoSinRango, /sin dueño/, "no puede leerse como el otro veredicto");
    assert.match(leidoSinRango, /nadie buscó dueño/);
    assert.match(leidoSinDueno, /sin dueño en el rango/);
  });

  it("los TRES estados del dueño se leen distintos, como los tres del delta", () => {
    const leidos = (["con dueño", "sin dueño", "rango vacío"] as const).map((v) =>
      duenosLegibles(v === "con dueño" ? { veredicto: v, quienes: ["#274"] } : { veredicto: v }),
    );
    assert.equal(new Set(leidos).size, 3, "dos veredictos con la misma frase son un veredicto");
  });
});

describe("el dueño que se GUARDA sale de la atribución, no se rehace aparte", () => {
  const commit = (sha: string, modulos: string[], pr?: number): CommitDelRango => ({
    sha,
    asunto: pr ? `algo (#${pr})` : "algo directo",
    pr,
    modulos,
  });

  it("una candidata → se guarda con su nombre", () => {
    const d = duenosDeLaMedida(atribuir("store", rangoDe([commit("aaa1111", ["store"], 274)])));
    assert.deepEqual(d, { veredicto: "con dueño", quienes: ["#274"] });
  });

  it("dos candidatas → se guardan LAS DOS, como se imprimen", () => {
    const d = duenosDeLaMedida(
      atribuir("store", rangoDe([commit("aaa1111", ["store"], 274), commit("bbb2222", ["store"], 276)])),
    );
    assert.deepEqual(d, { veredicto: "con dueño", quienes: ["#274", "#276"] });
  });

  it("un commit directo a main se guarda con su sha corto, no se pierde", () => {
    // Rehacer los nombres a mano en `repartir` era una copia de
    // `nombreDeCommit`: dos reglas para el mismo nombre, capaces de divergir.
    const d = duenosDeLaMedida(atribuir("store", rangoDe([commit("aaa1111c", ["store"])])));
    assert.deepEqual(d, { veredicto: "con dueño", quienes: ["aaa1111"] });
  });

  it("nadie lo tocó → SIN DUEÑO; no había rango → RANGO VACÍO. Nunca la misma cosa", () => {
    assert.deepEqual(duenosDeLaMedida(atribuir("store", rangoDe([commit("aaa1111", ["world-map"], 274)]))), {
      veredicto: "sin dueño",
    });
    assert.deepEqual(duenosDeLaMedida(atribuir("store", rangoDe([]))), { veredicto: "rango vacío" });
  });
});

describe("frescura y antigüedad, sin `mtime`", () => {
  it("sin módulos desactualizados no hay aviso", () => {
    assert.equal(avisoDeFrescura([]), undefined);
  });

  it("los nombra en vez de solo contarlos", () => {
    const aviso = avisoDeFrescura(["store", "world-map", "npc-director", "scene-normalize"]);
    assert.match(aviso ?? "", /store, world-map, npc-director y 1 más/);
    assert.match(aviso ?? "", /mutacion-ultima/);
  });

  it("avisa del módulo que lleva más días sin medida", () => {
    const hoy = Date.parse("2026-08-25T00:00:00.000Z");
    const aviso = avisoDeAntiguedad(
      [
        { id: "reciente", fecha: "2026-08-24T00:00:00.000Z" },
        { id: "viejo", fecha: "2026-08-01T00:00:00.000Z" },
      ],
      hoy,
      7,
    );
    assert.match(aviso ?? "", /viejo lleva 24 días sin medida/);
    assert.doesNotMatch(aviso ?? "", /reciente/);
  });

  it("un módulo sin medida NUNCA no se cuela entre los frescos", () => {
    // Es el estado de `session-facets` desde que entró con #273: sin nocturna,
    // la única forma de que un módulo se quede años sin medir es que nadie lo
    // mire, y esto lo mira.
    const aviso = avisoDeAntiguedad([{ id: "session-facets" }], Date.parse("2026-08-25T00:00:00.000Z"), 7);
    assert.match(aviso ?? "", /session-facets sin medir NUNCA/);
  });

  it("con todo fresco, silencio", () => {
    const hoy = Date.parse("2026-08-25T00:00:00.000Z");
    assert.equal(avisoDeAntiguedad([{ id: "a", fecha: "2026-08-24T00:00:00.000Z" }], hoy, 7), undefined);
  });

  it("una fecha ilegible cuenta como sin medir, no como fresca", () => {
    const aviso = avisoDeAntiguedad([{ id: "a", fecha: "ayer por la tarde" }], Date.now(), 7);
    assert.match(aviso ?? "", /sin medir NUNCA/);
  });
});

describe("el muro de `npm run mutate`", () => {
  // H4: era la decisión más nueva de la tanda y la única sin batería, en un
  // trabajo cuya tesis es que un candado sin candado no vale.
  it("sin autorizar, no se corre, y el mensaje dice qué hacer en su lugar", () => {
    const m = muroDeMutacion(undefined);
    assert.equal(m.ok, false);
    if (m.ok) return;
    assert.match(m.mensaje, /npm run mutacion -- pendiente/);
    assert.match(m.mensaje, /npm run mutacion -- local <id>/);
    assert.match(m.mensaje, /SIGUE\n {2}TRABAJANDO|SIGUE/, "tiene que decir que no se espere");
  });

  it("solo `si` abre el muro: un valor cualquiera NO cuenta", () => {
    // Un `NEFAN_MUTATE_AUTORIZADO=0` heredado del entorno abriría de par en par
    // un muro que comprobara "hay algo". Es el fallo silencioso exacto.
    assert.equal(muroDeMutacion("si").ok, true);
    for (const v of ["", "0", "no", "false", "SI", "sí", "1", "true"]) {
      assert.equal(muroDeMutacion(v).ok, false, `"${v}" no debería abrir el muro`);
    }
  });
});

describe("repartir · idempotencia, que ya ha costado dos bugs", () => {
  // H5. Los dos: (1) dos pasadas antes de commitear publicaron comentarios
  // contradictorios sobre la misma corrida; (2) una tercera pasada, ya
  // commiteada la huella, la reescribía borrando `nuevos` y `duenos`.
  const conRun = (run: string, ficheros: readonly string[]): Huella => ({
    ficheros: Object.fromEntries(ficheros.map((f) => [f, medida({ run })])),
  });

  it("ningún fichero con esta corrida → pendiente de repartir", () => {
    assert.deepEqual(estadoDeReparto("99", ["src/a.ts"], conRun("7", ["src/a.ts"])), {
      tipo: "pendiente",
    });
  });

  it("todos con esta corrida → ya repartida, y no se vuelve a tocar", () => {
    assert.deepEqual(estadoDeReparto("99", ["src/a.ts", "src/b.ts"], conRun("99", ["src/a.ts", "src/b.ts"])), {
      tipo: "ya repartida",
    });
  });

  it("a medias NO se colapsa con ninguno de los otros dos", () => {
    // Media huella con esta corrida y media sin ella es una huella incoherente.
    // Leerla como "pendiente" la reescribiría entera perdiendo lo de la mitad
    // ya repartida; como "ya repartida", dejaría la otra mitad sin dueño para
    // siempre. Las dos lecturas pierden datos en silencio.
    const base: Huella = { ficheros: { "src/a.ts": medida({ run: "99" }), "src/b.ts": medida({ run: "7" }) } };
    assert.deepEqual(estadoDeReparto("99", ["src/a.ts", "src/b.ts"], base), {
      tipo: "a medio repartir",
      repartidos: 1,
      total: 2,
    });
  });

  it("un fichero que la huella no conoce cuenta como sin repartir, no como repartido", () => {
    assert.deepEqual(estadoDeReparto("99", ["src/nuevo.ts"], { ficheros: {} }), { tipo: "pendiente" });
  });
});

describe("repartir · un comentario por corrida y PR", () => {
  // La ventana que produjo los dos comentarios de #273: el guardia de la huella
  // solo está armado cuando la huella está COMMITEADA, y entre
  // `repartir --comentar` y el `git commit` cabe otro `repartir --comentar`.
  // Aquí la idempotencia se comprueba donde ocurre el efecto: en la PR.
  it("reconoce su propio comentario por la marca invisible", () => {
    const cuerpo = `${marcaDeCorrida("32876809618")}\n## Mutación · lo que sea`;
    assert.equal(yaComentada([cuerpo], "32876809618"), true);
  });

  it("no confunde la corrida de al lado", () => {
    assert.equal(yaComentada([marcaDeCorrida("32876809618")], "32881068200"), false);
    assert.equal(yaComentada([], "32876809618"), false);
  });

  it("reconoce también los comentarios publicados antes de que existiera la marca", () => {
    // Los dos de #273 no la llevan. Sin esta rama, un reparto de esa misma
    // corrida publicaría un tercero.
    const viejo = "## Mutación · corrida [32876809618](https://github.com/…) sobre `7c6848f`";
    assert.equal(yaComentada([viejo], "32876809618"), true);
  });

  it("un comentario ajeno no se toma por el propio", () => {
    assert.equal(yaComentada(["Buen trabajo, pero la corrida 32876809618 no me convence"], "32876809618"), false);
  });
});

describe("la huella commiteada es el histórico que este repo no tenía", () => {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  it("el tope real está por DEBAJO de lo que cuesta la corrida entera", () => {
    // Sin esta relación el tope no protege de nada, y no es una comprobación
    // circular: contrasta el número del plan contra el coste MEDIDO que hay en
    // la huella. Si alguien subiera `tope_local` por encima de los 9.082
    // mutantes del plan completo, `npm run mutate` volvería a poder tumbar la
    // máquina de quien está delante y esto se pondría rojo.
    const plan = leerPlan();
    const huella = JSON.parse(
      readFileSync(resolve(raiz, "data/contract/mutacion-huella.json"), "utf8"),
    ) as Huella;
    const total = Object.values(huella.ficheros).reduce((n, m) => n + m.total, 0);
    assert.ok(total > 0, "la huella no tiene costes: el tope no tendría contra qué medirse");
    const p = permisoLocal(`los ${plan.modulos.length} módulos`, total, plan.tope_local);
    assert.equal(p.ok, false, `tope_local=${plan.tope_local} deja pasar la corrida entera (${total} mutantes)`);
  });

  it("existe, es legible y tiene medidas dentro", () => {
    // No comprueba números concretos (los cambia cada corrida): comprueba que
    // el fichero que sostiene el delta no se ha quedado vacío ni corrupto, que
    // es como el delta se quedaría mudo sin decir por qué.
    const huella = JSON.parse(readFileSync(resolve(raiz, "data/contract/mutacion-huella.json"), "utf8")) as Huella;
    const ficheros = Object.keys(huella.ficheros);
    assert.ok(ficheros.length > 0, "la huella está vacía: el delta no tendría contra qué comparar");
    for (const f of ficheros) {
      const m = huella.ficheros[f];
      assert.ok(m.total > 0, `${f} dice 0 mutantes medidos`);
      assert.ok(Array.isArray(m.vivos), `${f} no lleva lista de vivos`);
      for (const h of m.vivos) assert.match(h, /^[0-9a-f]{16}$/, `${f}: huella con formato raro`);
    }
  });

  it("TODA fila commiteada dice su veredicto de dueño, y con dueño nombra a alguien", () => {
    // La totalidad, que es lo que impide que una fila a medio migrar sobreviva
    // en silencio: `fusiona` CONSERVA lo que la corrida no midió, así que una
    // fila con la forma vieja (`duenos: []`) se quedaría ahí para siempre y
    // `duenosLegibles` la leería como `undefined`. El tipo solo sujeta lo que
    // se escribe desde TypeScript; el fichero lo escribe también el editor de
    // quien resuelve un conflicto.
    const huella = JSON.parse(readFileSync(resolve(raiz, "data/contract/mutacion-huella.json"), "utf8")) as Huella;
    for (const [f, m] of Object.entries(huella.ficheros)) {
      const d = m.duenos;
      assert.ok(d !== null && typeof d === "object" && !Array.isArray(d), `${f}: dueños con la forma vieja`);
      assert.ok(
        d.veredicto === "con dueño" || d.veredicto === "sin dueño" || d.veredicto === "rango vacío",
        `${f}: veredicto de dueño desconocido (${JSON.stringify(d)})`,
      );
      if (d.veredicto === "con dueño") {
        assert.ok(d.quienes.length > 0, `${f}: dice tener dueño y no nombra a ninguno`);
      }
      // Y se lee: la cola de trabajo no puede escribir `undefined` de una fila
      // que el fichero traía con otra forma.
      assert.ok(duenosLegibles(d).length > 0, `${f}: sus dueños no se pueden leer`);
    }
  });
});
