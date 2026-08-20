/** Guardia del instrumento de medida.
 *
 *  `npm run mutate` es un candado (thresholds.break) del que dependen la cola
 *  de `npm run deuda` y la decisión de si un test comprueba lo que dice. Un
 *  instrumento mal apuntado no falla: se pone VERDE midiendo el vacío.
 *
 *  Pasó de verdad: `mutate` apuntaba a `src/combat/resolver.ts`, una ruta que
 *  nunca existió (el fichero real es `combat-resolver.ts`), así que ese
 *  objetivo llevaba desde el renombrado generando cero mutantes mientras
 *  `test:mutate` sí gastaba tiempo corriendo su suite. Nadie se enteró porque
 *  un glob que no casa con nada no es un error para Stryker.
 *
 *  Este test no mide mutación: solo comprueba que lo que el config nombra
 *  existe en el disco. Es barato y corre en cada `npm test`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (f: string) => JSON.parse(readFileSync(resolve(raiz, f), "utf8"));

describe("configuración de mutación", () => {
  /** Un patrón vale si nombra un fichero que existe o si su glob casa con al
   *  menos uno. Un glob que no casa con nada es el caso PELIGROSO: ni Stryker
   *  ni `node --test` lo consideran un error, simplemente no miden nada. */
  const casaConAlgo = (patron: string): boolean =>
    patron.includes("*")
      ? globSync(patron, { cwd: raiz }).length > 0
      : existsSync(resolve(raiz, patron));

  it("todo objetivo de `mutate` corresponde a algún fichero real", () => {
    const objetivos = leer("stryker.config.json").mutate as string[];
    assert.ok(objetivos.length > 0, "mutate no puede estar vacío");
    for (const patron of objetivos) {
      assert.ok(
        casaConAlgo(patron),
        `stryker.config.json mutate: "${patron}" no casa con ningún fichero — el objetivo mide el vacío en verde`,
      );
    }
  });

  it("todo fichero de `test:mutate` corresponde a algún test real", () => {
    const cmd = leer("package.json").scripts["test:mutate"] as string;
    const patrones = cmd.split(/\s+/).filter((t) => t.includes("test/") && t.endsWith(".ts"));
    assert.ok(patrones.length > 0, "test:mutate debe nombrar ficheros de test");
    for (const patron of patrones) {
      assert.ok(
        casaConAlgo(patron),
        `test:mutate nombra "${patron}", que no casa con ningún fichero — node --test lo ignora sin avisar`,
      );
    }
  });

  it("el gate `mutate` mide en frío, sin reutilizar la caché incremental", () => {
    // Con testRunner "command" Stryker no hashea los ficheros de test, así que
    // la caché NO se invalida al editar un test: medido, vaciar dos ficheros
    // de test y re-correr devuelve el score viejo en 3 s. `--force` corre
    // todos los mutantes Y reconstruye la caché; la caché la explota
    // `mutate:quick`, que solo vale si no has tocado test/.
    const scripts = leer("package.json").scripts as Record<string, string>;
    assert.match(
      scripts.mutate,
      /--force\b/,
      "npm run mutate es el gate: sin --force puede dar verde sobre veredictos viejos",
    );
  });
});
