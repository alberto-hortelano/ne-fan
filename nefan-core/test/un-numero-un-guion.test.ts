/** UN NÚMERO, UN GUION — Y EN `docs/agents/` NO VIVE NADA EJECUTABLE (#680, #683).
 *
 *  El prefijo numérico de un guion de `qa/guiones/` es su NOMBRE en toda la
 *  casa: la fila de `qa/README.md`, el `node qa/run.mjs 126` con que se corre,
 *  la remisión de una cabecera a otra («la prueba completa sigue en el 126»).
 *  Tres veces en dos semanas dos ramas paralelas eligieron el mismo número a
 *  ciegas (dos 83 el 09-07, dos 126 el 09-14, dos 148 el 09-18 CON el issue
 *  abierto), y con el segundo 126 la remisión del 136 dejó de nombrar nada.
 *  Nadie lo candaba: `candados-headless-totalidad` declara en su cabecera que
 *  `qa/guiones/*.mjs` queda fuera de su censo, y el runner los carga por
 *  `readdirSync` + `.mjs`, así que dos ficheros con el mismo prefijo corren los
 *  dos sin que nada se queje.
 *
 *  LA COMPARACIÓN ES POR VALOR, NO POR TEXTO: `07` y `7` son el MISMO número.
 *  Hay prefijos con cero a la izquierda (`07-npc-clave-del-skin.mjs` convive
 *  con `70-…`), y «el 7» en el README y `node qa/run.mjs 7` nombran uno solo;
 *  un candado que los distinguiera por grafía dejaría pasar justo el choque
 *  que más confunde. Y TODO guion lleva número: hoy hay cero sin él, y «un
 *  número, un guion» exige el número.
 *
 *  LA SEGUNDA MITAD (#683) es dónde vive el material ejecutable de una QA. La
 *  respuesta es «no hay tercera categoría»: un guion de `qa/guiones/` (con
 *  `export const sinNavegador` si no conduce navegador, molde del 148), y en
 *  `docs/agents/` solo prosa. El sondeo de #609 se dejó en `docs/agents/<tanda>/`
 *  y murió con el worktree sin que nadie lo commiteara: por eso este test mira
 *  el ÁRBOL DE TRABAJO y no `git ls-files`, para ponerse rojo en el worktree de
 *  la QA ANTES del `git add`. Corolario que hay que saber para no tomarlo por
 *  un rojo ajeno: un `.mjs` suelto en el `docs/agents/` de TU worktree te pone
 *  TU `npm test` rojo, y eso es lo buscado.
 *
 *  Vive en `nefan-core/test/` y no en `qa/` por la misma razón que
 *  `el-banco-declara-el-modo-de-gasto`: la dirección es test → banco, y así
 *  corre en `npm test` (o sea, en el job `nefan-core` de cada PR y en el bucle
 *  local de `verify`), que es donde tiene que salir el rojo del que renumera.
 *  Un guion `sinNavegador` correría solo en CI y consumiría un número: el
 *  candado del prefijo dentro del recurso que reparte prefijos.
 *
 *  LO QUE NO CUBRE, dicho por escrito:
 *   - Dos ramas paralelas lo pasan las dos en verde hasta fusionar: el número
 *     lo asigna QUIEN FUSIONA mirando `main` (convención en `qa/README.md`,
 *     §«Cómo se escribe un guion»); este test solo salta en la segunda PR que
 *     entra con el número repetido, y entonces cede la joven.
 *   - Que el número tenga fila en «Los guiones sembrados» de `qa/README.md`, y
 *     que cada fila tenga guion: solo mira el nombre del fichero.
 *   - El filtro del runner casa por SUBCADENA (`node qa/run.mjs 12` corre el
 *     12, el 112 y del 120 al 129): fuera de alcance por requisitos.
 *   - Un ejecutable en `docs/agents/` con una extensión que no esté en la lista
 *     (o sin extensión): el censo es por extensión, no por bit de ejecución ni
 *     por shebang.
 *   - Un ENLACE SIMBÓLICO `.mjs` en `docs/agents/`: `isFile()` lo deja fuera
 *     (hallazgo H-2 de la QA; hoy no hay ninguno). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const core = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUIONES = join(core, "..", "qa", "guiones");
const DOCS_AGENTS = join(core, "..", "docs", "agents");

/** El prefijo numérico de un guion, o `null` si no lo lleva. Se compara por
 *  VALOR (`Number`), no por texto: `07` y `7` son el 7. */
export function numeroDelGuion(nombre: string): number | null {
  const m = /^(\d+)-/.exec(nombre);
  return m ? Number(m[1]) : null;
}

/** Extensiones que hacen de un fichero algo que alguien podría CORRER. Es una
 *  lista y se dice: un `.mjs` en `docs/agents/` es un sondeo que nadie volverá
 *  a correr (#683); su sitio es `qa/guiones/`. */
const EXTENSIONES_EJECUTABLES = new Set([".mjs", ".cjs", ".js", ".mts", ".cts", ".ts", ".sh", ".py"]);

describe("un número, un guion (#680)", () => {
  const guiones = readdirSync(GUIONES).filter((f) => f.endsWith(".mjs"));

  it("hay guiones: la totalidad tiene sujeto", () => {
    // El peor verde sería un directorio vacío o movido: cero repetidos, cero sin número.
    assert.ok(guiones.length >= 100, `solo ${guiones.length} guiones en ${GUIONES}: ¿se movió el directorio?`);
  });

  it("todo guion lleva prefijo numérico", () => {
    const sinNumero = guiones.filter((f) => numeroDelGuion(f) === null);
    assert.deepEqual(
      sinNumero,
      [],
      `guiones sin prefijo numérico (el número es su nombre en toda la casa: README, ` +
        `\`node qa/run.mjs <n>\`, remisiones entre cabeceras): ${sinNumero.join(", ")}`,
    );
  });

  it("ningún número lo comparten dos guiones (07 y 7 son el mismo)", () => {
    const porNumero = new Map<number, string[]>();
    for (const f of guiones) {
      const n = numeroDelGuion(f);
      if (n === null) continue; // ya lo reporta el aserto anterior
      porNumero.set(n, [...(porNumero.get(n) ?? []), f]);
    }
    const repetidos = [...porNumero.entries()].filter(([, ficheros]) => ficheros.length > 1);
    assert.deepEqual(
      repetidos.map(([n, ficheros]) => `${n} → [${ficheros.join(", ")}]`),
      [],
      `prefijo repetido en qa/guiones/. El joven cede: renumera al primer libre en \`main\` ` +
        `(y su fila de qa/README.md, y su \`scene_id\` si lleva el número dentro). ` +
        `El número lo asigna quien fusiona mirando \`main\`, no quien escribe.`,
    );
  });
});

describe("en docs/agents/ no vive nada ejecutable (#683)", () => {
  it("todo fichero de docs/agents/** es prosa", () => {
    const ejecutables = readdirSync(DOCS_AGENTS, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && EXTENSIONES_EJECUTABLES.has(extname(d.name)))
      .map((d) => join(d.parentPath, d.name).slice(DOCS_AGENTS.length + 1))
      .sort();
    assert.deepEqual(
      ejecutables,
      [],
      `material ejecutable en docs/agents/ (nadie lo corre y muere con el worktree, #683). ` +
        `Su sitio es qa/guiones/ como guion —con \`export const sinNavegador\` si no conduce ` +
        `navegador, molde del 148: SABOTAJES rojos + AGUJEROS conocidos con su issue—: ${ejecutables.join(", ")}`,
    );
  });
});
