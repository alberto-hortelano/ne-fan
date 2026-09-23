/** LAS ANCLAS DE LOS CANDADOS EN NEGATIVO SIGUEN PUESTAS (#486).
 *
 *  `qa/bateria-candados-en-negativo.mjs` demuestra que ciertos guiones se ponen
 *  ROJOS cuando se rompe lo que dicen defender, y para eso parchea código de
 *  producción por su TEXTO: una tabla de anclas (`buscar`) que tienen que
 *  aparecer EXACTAMENTE una vez en su fichero. Un ancla que ya no aparece —o
 *  que aparece dos veces— no rompe nada: el candado deja de candar y nadie se
 *  entera. Eso YA se comprobaba… dentro de la corrida cara (una batería de
 *  Chromium por invariante, bajo demanda), o sea casi nunca. Aquí se hace en
 *  cada `npm test`, que es en cada PR y en cada bucle local.
 *
 *  Es exactamente la enfermedad del 2026-09-05, cuando un candado llevaba un
 *  día rojo en `main` sin que nadie lo supiera porque nadie lo corría; y el
 *  riesgo es real y reciente: dos programas de troceo (#358, #346) movieron
 *  medio cliente en un mes, y las anclas viven en `nefan-html/src` y en dos
 *  guiones.
 *
 *  El sujeto es `qa/lib/invariantes-en-negativo.mjs`, la MISMA tabla que
 *  consume la batería: una copia aquí no probaría nada de ella. El import
 *  cruzado es la regla (#357): la dirección es test → banco
 *  (`el-banco-no-entra-en-produccion` en arch-rules.json).
 *
 *  Y la función que cuenta es `qa/lib/anclas.mjs` (#700): la MISMA con la que
 *  sustituyen los seis guiones en negativo, así que lo que aquí sale limpio es
 *  lo que allí se rompe. Sus casos van en el segundo `describe`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Invariante = [string, string, string, [string, string][], RegExp, number?];
type Entrada = { nombre: string; fichero: string; pares: [string, string][] };
type AnclaSuelta = { nombre: string; fichero: string; buscar: string; veces: number | null };
type Parche = { ok: true; texto: string } | { ok: false; indice: number; buscar: string; veces: number };

const { INVARIANTES } = (await import(join(repoRoot, "qa", "lib", "invariantes-en-negativo.mjs"))) as {
  INVARIANTES: Invariante[];
};
const { aplicarPares, anclasSueltas, explicarAnclaSuelta } = (await import(
  join(repoRoot, "qa", "lib", "anclas.mjs")
)) as {
  aplicarPares: (texto: string, pares: [string, string][]) => Parche;
  anclasSueltas: (entradas: Entrada[], leer: (f: string) => string | null) => AnclaSuelta[];
  explicarAnclaSuelta: (s: AnclaSuelta) => string;
};

/** La tabla de la batería va en tuplas; la función común, en entradas con nombre. */
const entradas = (inv: Invariante[]): Entrada[] => inv.map(([nombre, fichero, , pares]) => ({ nombre, fichero, pares }));

/** El lector de verdad: el árbol de este checkout. */
const enDisco = (fichero: string): string | null => {
  const ruta = join(repoRoot, fichero);
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : null;
};

describe("los candados en negativo apuntan a donde creen (#486)", () => {
  it("hay tabla y tiene sujeto: no se aprueba una lista vacía", () => {
    // El peor de los verdes sería un fichero que se quedó sin invariantes o un
    // detector que no lee nada. Hoy son ocho anclas en cuatro ficheros.
    assert.ok(INVARIANTES.length >= 5, `solo ${INVARIANTES.length} invariantes: ¿se vació la tabla?`);
    const anclas = INVARIANTES.flatMap(([, , , pares]) => pares);
    assert.ok(anclas.length >= 8, `solo ${anclas.length} anclas`);
  });

  it("cada ancla aparece EXACTAMENTE una vez en su fichero", () => {
    const sueltas = anclasSueltas(entradas(INVARIANTES), enDisco);
    assert.deepEqual(
      sueltas.map(explicarAnclaSuelta),
      [],
      "hay candados que ya no apuntan a donde creen. El código se movió: mueve el ancla con él " +
        "(qa/lib/invariantes-en-negativo.mjs) o el candado dejará de candar sin decirlo",
    );
  });

  it("los ficheros que se rompen a propósito existen", () => {
    const ausentes = [...new Set(INVARIANTES.map(([, f]) => f))].filter((f) => enDisco(f) === null);
    assert.deepEqual(ausentes, [], "un invariante apunta a un fichero que ya no está");
  });

  it("cada invariante nombra un guion de qa/guiones que existe", () => {
    // El otro extremo del ancla: romper el fuente no sirve de nada si el guion
    // que tenía que enterarse ya no está (o se renombró). `qa/run.mjs` casa por
    // subcadena del nombre, así que basta con que ALGÚN guion case.
    const nombres = readdirSync(join(repoRoot, "qa", "guiones")).filter((f) => f.endsWith(".mjs"));
    const huerfanos = INVARIANTES.filter(([, , guion]) => !nombres.some((n) => n.includes(guion))).map(
      ([nombre, , guion]) => `${nombre} → ningún guion casa con "${guion}"`,
    );
    assert.deepEqual(huerfanos, []);
  });
});

describe("el detector de anclas sueltas", () => {
  const inv = (pares: [string, string][]): Entrada[] => [{ nombre: "invariante de prueba", fichero: "x.ts", pares }];

  it("una vez es lo correcto: no dice nada", () => {
    assert.deepEqual(anclasSueltas(inv([["const a = 1;", "const a = 2;"]]), () => "const a = 1;\n"), []);
  });

  it("SABE PONERSE ROJO: cero apariciones y dos apariciones son las dos un fallo", () => {
    // Sin este negativo, un detector que devolviera siempre `[]` se vería
    // exactamente igual que uno que funciona — que es la enfermedad que este
    // fichero entero persigue.
    assert.deepEqual(
      anclasSueltas(inv([["const a = 1;", "x"]]), () => "const b = 2;").map((s) => s.veces),
      [0],
    );
    assert.deepEqual(
      anclasSueltas(inv([["const a = 1;", "x"]]), () => "const a = 1; const a = 1;").map((s) => s.veces),
      [2],
    );
  });

  it("«el fichero no existe» NO se colapsa con «no aparece»", () => {
    // Son dos averías distintas y piden dos arreglos distintos: mover el ancla,
    // o mover el invariante entero. `null` frente a `0`.
    const [suelta] = anclasSueltas(inv([["const a = 1;", "x"]]), () => null);
    assert.equal(suelta.veces, null);
    assert.match(explicarAnclaSuelta(suelta), /el fichero no existe/);
  });

  it("mira TODOS los pares de un invariante, no solo el primero", () => {
    // Tres de los invariantes de hoy llevan dos anclas, y la segunda es la que
    // inyecta el destrozo de verdad.
    const sueltas = anclasSueltas(
      inv([
        ["viva", "x"],
        ["muerta", "y"],
      ]),
      () => "viva",
    );
    assert.deepEqual(sueltas.map((s) => s.buscar), ["muerta"]);
  });
});

describe("aplicarPares: la sustitución que usan los seis guiones en negativo (#700)", () => {
  it("una vez: sustituye", () => {
    assert.deepEqual(aplicarPares("a; const x = 1; b", [["const x = 1;", "const x = 2;"]]), {
      ok: true,
      texto: "a; const x = 2; b",
    });
  });

  it("SABE PONERSE ROJO con el patrón AUSENTE: no toca nada y dice cero", () => {
    assert.deepEqual(aplicarPares("const y = 1;", [["const x = 1;", "z"]]), {
      ok: false,
      indice: 0,
      buscar: "const x = 1;",
      veces: 0,
    });
  });

  it("SABE PONERSE ROJO con el patrón DUPLICADO: no sustituye la primera copia y calla", () => {
    // La forma de #700: con `includes` + `replace`, `reparto` rompía la
    // primera copia —que puede no ser la que el probe cree— y daba un veredicto
    // (verde, o un «SIN CANDADO» inventado) sobre algo que no había probado.
    assert.deepEqual(aplicarPares("f(); f();", [["f();", "g();"]]), { ok: false, indice: 0, buscar: "f();", veces: 2 });
  });

  it("cuenta sobre el texto YA PARCHEADO: un par que crea una segunda copia del siguiente es un fallo", () => {
    // Único en el ORIGINAL, doble tras el primer par: contar sobre el original
    // daría luz verde y la sustitución caería en la copia equivocada.
    const r = aplicarPares("uno; dos;", [
      ["uno;", "dos;"],
      ["dos;", "tres;"],
    ]);
    assert.deepEqual(r, { ok: false, indice: 1, buscar: "dos;", veces: 2 });
  });

  it("cuenta sobre el texto YA PARCHEADO: un par que se COME al siguiente es un fallo", () => {
    const r = aplicarPares("uno dos", [
      ["uno dos", "nada"],
      ["dos", "tres"],
    ]);
    assert.deepEqual(r, { ok: false, indice: 1, buscar: "dos", veces: 0 });
  });

  it("aplica los pares EN ORDEN y todos", () => {
    assert.deepEqual(
      aplicarPares("a b c", [
        ["a", "x"],
        ["c", "z"],
      ]),
      { ok: true, texto: "x b z" },
    );
  });

  it("el `poner` es LITERAL: `$&`, `$'` y `$1` no se interpretan como en `String.replace`", () => {
    const r = aplicarPares("antes X después", [["X", "[$&|$'|$`|$1]"]]);
    assert.deepEqual(r, { ok: true, texto: "antes [$&|$'|$`|$1] después" });
  });

  it("un `buscar` vacío es un error de la tabla, no un «aparece N veces»", () => {
    assert.throws(() => aplicarPares("abc", [["", "x"]]), /texto no vacío/);
  });
});
