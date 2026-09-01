/** EL VIGILANTE DE LAS EXCEPCIONES DEL TOPE DE TAMAÑO (#358).
 *
 *  El tope en sí lo aplica eslint (`nefan-html/eslint.config.js`, que lee las
 *  cifras de `data/contract/client-file-size.json`). Lo que eslint NO puede
 *  hacer es ver envejecer sus propias excepciones: sabe decir «te has pasado» y
 *  no sabe decir «esta exención sobra desde que troceaste el fichero».
 *
 *  Y esa mitad es la que importa aquí, porque es por donde se deshace la
 *  congelación sin que nadie se entere (QA 2026-09-01, H-2): el día que #346
 *  baje `title-screen.ts` de 1.651 a 900, una excepción que siga diciendo 1.651
 *  le acaba de regalar **751 líneas de recrecimiento** — el candado seguiría
 *  verde y el fichero podría volver a crecer hasta donde estaba. Lo único que
 *  lo impedía era una frase en un comentario («cada entrega que corte BAJA su
 *  número en el mismo commit»), o sea la misma clase de prosa que esta tanda
 *  vino a sustituir por un candado.
 *
 *  LA CIFRA ES EXACTA, no un techo cómodo, y ese es todo el mecanismo: como la
 *  excepción tiene que valer justo lo que mide el fichero, quitarle líneas pone
 *  ESTE test rojo hasta que el número baje en el mismo commit. Un trinquete: el
 *  número solo puede ir hacia abajo, y hacerlo bajar es gratis mientras que
 *  subirlo exige explicar por qué.
 *
 *  Es el hermano de `deadExceptions()` de `arch-rules.json`, que hace lo mismo
 *  para las exenciones de fronteras. La diferencia es que allí una exención
 *  muere cuando su fichero desaparece, y aquí cuando su fichero adelgaza.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const repoRoot = join(coreRoot, "..");
const clienteRoot = join(repoRoot, "nefan-html");

interface Excepcion {
  fichero: string;
  lineas: number;
  porque: string;
  issue: string | null;
}

interface Contrato {
  tope: number;
  excepciones: Excepcion[];
}

const contrato = JSON.parse(
  readFileSync(join(coreRoot, "data", "contract", "client-file-size.json"), "utf-8"),
) as Contrato;

/** Las líneas de un fichero CON LA MISMA DEFINICIÓN QUE `wc -l`: saltos de
 *  línea. Es la que reporta eslint (comprobado en los cuatro casos de la tanda:
 *  «File has too many lines (3136)» sobre un `wc -l` de 3.136), y hay un test
 *  abajo que impide que las dos definiciones se separen en silencio. */
function lineasDe(rel: string): number {
  const texto = readFileSync(join(clienteRoot, rel), "utf-8");
  return texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
}

/** Todos los `.ts` de `nefan-html/src`, en rutas relativas al paquete. */
function ficherosDelCliente(): string[] {
  const out: string[] = [];
  const anda = (dir: string): void => {
    for (const entrada of readdirSync(join(clienteRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) anda(rel);
      else if (entrada.name.endsWith(".ts")) out.push(rel);
    }
  };
  anda("src");
  return out.sort();
}

describe("el tope de tamaño del cliente", () => {
  it("el escaneo encuentra el árbol del cliente", () => {
    const todos = ficherosDelCliente();
    assert.ok(todos.length > 30, `solo ${todos.length} ficheros — ¿mal la raíz de nefan-html?`);
  });

  it("ningún fichero pasa del tope sin excepción declarada", () => {
    // El MISMO invariante que aplica eslint, medido aquí con otro motor. No es
    // redundancia gratuita: si alguien borra el bloque de `eslint.config.js` o
    // saca un fichero del régimen, esto sigue rojo. Los dos leen las mismas
    // cifras del contrato, así que no pueden discrepar del número.
    const eximidos = new Set(contrato.excepciones.map((e) => e.fichero));
    const pasados = ficherosDelCliente()
      .filter((f) => !eximidos.has(f))
      .map((f) => ({ f, n: lineasDe(f) }))
      .filter(({ n }) => n > contrato.tope);
    assert.deepEqual(
      pasados,
      [],
      `estos ficheros del cliente pasan del tope de ${contrato.tope} y no tienen excepción:\n` +
        pasados.map(({ f, n }) => `   ${f} — ${n} líneas`).join("\n") +
        `\nO se trocean, o su excepción entra en data/contract/client-file-size.json con su motivo.`,
    );
  });
});

describe("las excepciones no envejecen", () => {
  it("cada excepción apunta a un fichero que existe", () => {
    const fantasmas = contrato.excepciones
      .map((e) => e.fichero)
      .filter((f) => !existsSync(join(clienteRoot, f)));
    assert.deepEqual(fantasmas, [], `excepciones sin sujeto: ${fantasmas.join(", ")}`);
  });

  it("la cifra de cada excepción es EXACTAMENTE el tamaño de hoy", () => {
    // El corazón de H-2. Una cifra por encima del tamaño real es holgura
    // REGALADA: el fichero puede volver a crecer hasta ella sin que nada se
    // ponga rojo, y eso deshace la congelación que la tanda vino a poner.
    const desfasadas = contrato.excepciones
      .map((e) => ({ ...e, real: lineasDe(e.fichero) }))
      .filter((e) => e.real !== e.lineas);
    assert.deepEqual(
      desfasadas.map((e) => `${e.fichero}: la excepción dice ${e.lineas} y el fichero mide ${e.real}`),
      [],
      desfasadas
        .map((e) =>
          e.real < e.lineas
            ? `${e.fichero} ADELGAZÓ a ${e.real} y su excepción sigue en ${e.lineas}: le está ` +
              `regalando ${e.lineas - e.real} línea(s) de recrecimiento. Baja la cifra en ` +
              `data/contract/client-file-size.json, en este mismo commit.`
            : `${e.fichero} mide ${e.real} y su excepción dice ${e.lineas}: eslint ya debería ` +
              `estar rojo. Si el crecimiento es deliberado, sube la cifra con su motivo.`,
        )
        .join("\n"),
    );
  });

  it("una excepción cuyo fichero ya cabe bajo el tope está MUERTA y hay que quitarla", () => {
    // El caso terminal del anterior: cuando el troceo llega hasta abajo, la
    // excepción no es que sobre holgura — es que sobra entera. Hermano exacto
    // de `deadExceptions()` en arch-rules.
    const muertas = contrato.excepciones
      .map((e) => ({ ...e, real: lineasDe(e.fichero) }))
      .filter((e) => e.real <= contrato.tope);
    assert.deepEqual(
      muertas.map((e) => e.fichero),
      [],
      muertas
        .map(
          (e) =>
            `${e.fichero} ya mide ${e.real} (≤ ${contrato.tope}): su excepción sobra. ` +
            `Quítala de data/contract/client-file-size.json — el régimen general le vale.`,
        )
        .join("\n"),
    );
  });

  it("cada excepción dice POR QUÉ, y no solo cuánto", () => {
    for (const e of contrato.excepciones) {
      assert.ok(
        e.porque.length > 60,
        `la excepción de ${e.fichero} no explica por qué existe: "${e.porque}"`,
      );
    }
  });

  it("los ficheros eximidos acaban en salto de línea, o las dos cuentas se separan", () => {
    // El único sitio donde `wc -l` y el contador de eslint pueden discrepar es
    // un fichero sin salto final. Se afirma en vez de suponerse: si alguien
    // deja uno así, este test lo dice antes de que la cifra del contrato
    // signifique una cosa aquí y otra allí.
    for (const e of contrato.excepciones) {
      const texto = readFileSync(join(clienteRoot, e.fichero), "utf-8");
      assert.ok(texto.endsWith("\n"), `${e.fichero} no termina en salto de línea`);
    }
  });
});
