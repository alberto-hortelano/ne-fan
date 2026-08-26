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
  deltaDeCorrida,
  estadoLegible,
  estadoDeReparto,
  marcaDeCorrida,
  muroDeMutacion,
  yaComentada,
  deltaDeFichero,
  fusiona,
  hash64,
  huellaDeMutante,
  permisoLocal,
  prDelAsunto,
  queHacerCon,
  veredictoDeCorrida,
  verificaDescarga,
  vivosDeFichero,
  type Corrida,
  type CommitDelRango,
  type Huella,
  type MedidaDeFichero,
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
  duenos: [],
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
    const a = atribuir("store", [commit("aaa1111", ["store"], 274), commit("bbb2222", ["world-map"], 276)]);
    assert.equal(a.veredicto, "uno");
    assert.equal(a.etiqueta, "#274");
  });

  it("dos candidatas → se nombran LAS DOS", () => {
    // Un dueño equivocado es peor que dos candidatos: el equivocado se descarta
    // en diez segundos y el hallazgo se queda sin nadie.
    const a = atribuir("store", [commit("aaa1111", ["store"], 274), commit("bbb2222", ["store"], 276)]);
    assert.equal(a.veredicto, "varios");
    assert.equal(a.etiqueta, "#274 o #276");
    assert.equal(a.candidatos.length, 2);
  });

  it("ninguna lo selecciona → SIN DUEÑO, y se dice", () => {
    // No se descarta ni se le adjudica al más cercano: se cuenta y se enseña.
    const a = atribuir("store", [commit("aaa1111", ["world-map"], 274)]);
    assert.equal(a.veredicto, "sin dueño");
    assert.match(a.etiqueta, /sin dueño en el rango/);
  });

  it("un commit directo a main también puede ser dueño, con su sha", () => {
    // 11 de los últimos 40 commits de este repo no llevan `(#NNN)`. Si solo
    // pudieran ser dueñas las PR, esos supervivientes saldrían huérfanos.
    const a = atribuir("store", [commit("aaa1111c", ["store"])]);
    assert.equal(a.etiqueta, "aaa1111");
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

describe("manifiesto · quién puede mover el tag", () => {
  const corrida = (over: Partial<Corrida> = {}): Corrida => ({
    sha: "abc",
    run_id: "1",
    origen: "rango",
    modulos_pedidos: ["a", "b"],
    modulos_con_informe: ["a", "b"],
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
    const v = veredictoDeCorrida(corrida({ modulos_con_informe: ["a"] }));
    assert.equal(v.completa, false);
    assert.equal(v.mueveTag, false);
    assert.match(v.porque, /\bb\b/);
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

describe("descarga · ni falta ni sobra", () => {
  const corrida: Corrida = {
    sha: "abc",
    run_id: "9",
    origen: "rango",
    modulos_pedidos: ["store", "world-map"],
    modulos_con_informe: ["store", "world-map"],
    fecha: "2026-08-25T00:00:00.000Z",
  };

  it("lo exacto pasa", () => {
    assert.deepEqual(verificaDescarga(corrida, ["store", "world-map"]), []);
  });

  it("un módulo declarado que no viene es una corrida truncada", () => {
    const errores = verificaDescarga(corrida, ["store"]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /world-map/);
  });

  it("un informe VIEJO que se quedó en el directorio se rechaza", () => {
    // Es el fallo silencioso: dos medidas de fechas distintas presentadas como
    // una sola foto. `npm run deuda` sumaría los supervivientes de la semana
    // pasada a los de hoy sin decir que son de corridas diferentes.
    const errores = verificaDescarga(corrida, ["store", "world-map", "plugins-dsl"]);
    assert.equal(errores.length, 1);
    assert.match(errores[0], /plugins-dsl/);
    assert.match(errores[0], /medida anterior/);
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
    const base = medida({ vivos: [h("a"), h("b")], nuevos: [h("b")], duenos: ["#274", "#276"] });
    assert.match(anotacionDeFichero([h("a"), h("b")], base), /1 NUEVOS · #274 o #276/);
  });

  it("un NUEVO sin dueño lo dice en vez de inventarse uno", () => {
    const base = medida({ vivos: [h("b")], nuevos: [h("b")], duenos: [] });
    assert.match(anotacionDeFichero([h("b")], base), /sin dueño en el rango/);
  });

  it("si ya no queda ninguno de los nuevos, no se sigue anunciando", () => {
    const base = medida({ vivos: [h("a"), h("b")], nuevos: [h("b")], duenos: ["#274"] });
    assert.match(anotacionDeFichero([h("a")], base), /ya estaban/);
  });

  it("un superviviente que la última medida no conocía se marca sin atribuir", () => {
    // Solo puede venir de un `npm run mutacion -- local` posterior. Decirlo
    // evita leer la atribución de la huella como si también cubriera a estos.
    const base = medida({ vivos: [h("a")], nuevos: [], duenos: ["#274"] });
    assert.match(anotacionDeFichero([h("a"), h("z")], base), /1 sin atribuir/);
  });

  it("los resueltos se enseñan: es la mitad buena del delta", () => {
    const base = medida({ vivos: [h("a")], nuevos: [], resueltos: 3, duenos: [] });
    assert.match(anotacionDeFichero([h("a")], base), /3 resueltos/);
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
});
