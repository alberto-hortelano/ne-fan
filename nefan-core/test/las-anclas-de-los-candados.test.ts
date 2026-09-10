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
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Invariante = [string, string, string, [string, string][], RegExp, number?];
type AnclaSuelta = { nombre: string; fichero: string; buscar: string; veces: number | null };

const mod = (await import(join(repoRoot, "qa", "lib", "invariantes-en-negativo.mjs"))) as {
  INVARIANTES: Invariante[];
  anclasSueltas: (inv: Invariante[], leer: (f: string) => string | null) => AnclaSuelta[];
  explicarAnclaSuelta: (s: AnclaSuelta) => string;
};
const { INVARIANTES, anclasSueltas, explicarAnclaSuelta } = mod;

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
    const sueltas = anclasSueltas(INVARIANTES, enDisco);
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
  const inv = (pares: [string, string][]): Invariante[] => [
    ["invariante de prueba", "x.ts", "01-arranque", pares, /da igual/],
  ];

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
