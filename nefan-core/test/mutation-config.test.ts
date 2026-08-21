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

  /** Un mutante puede romper una condición de bucle: el proceso de test deja
   *  de terminar y ASIGNA MEMORIA hasta que Stryker lo corta. Mientras tanto
   *  no está midiendo nada, solo esperando — así que el techo de ese timeout
   *  es, literalmente, cuánta RAM puede quemar un mutante inútil.
   *
   *  Pasó de verdad (2026-08-21): con `timeoutMS: 120000`, mutar
   *  `scene-validate.ts` —flood-fill sobre una rejilla 128×128— llevó a
   *  procesos de 4,24 GB y a un pico de 21,8 GB con `concurrency: 10`. El
   *  kernel invocó al OOM killer y se llevó por delante el editor. Con 10 s
   *  la misma corrida bajó a 7,6 GB de pico y 2m11s (de 4m48s) **con el mismo
   *  score, 95,39 %**: los 12 mutantes desbocados siguen muriendo, solo que en
   *  10 s en vez de en 120. */
  it("un mutante desbocado no puede quemar la máquina", () => {
    const cfg = leer("stryker.config.json") as { timeoutMS: number };
    // El comando de test tarda ~0,4 s: 10 s ya son 24× el caso normal, así que
    // el margen para un mutante lento legítimo es amplio. Lo que este tope
    // impide es volver a los dos minutos por mutante colgado.
    assert.ok(
      cfg.timeoutMS <= 15000,
      `timeoutMS = ${cfg.timeoutMS}: un mutante que no termina asigna memoria durante todo ese tiempo, ` +
        `y con concurrency ${(leer("stryker.config.json") as { concurrency: number }).concurrency} eso multiplica`,
    );

    // Segunda barrera, independiente del reloj: el tope de heap. Va por
    // NODE_OPTIONS y no por argv porque `node --test` abre un proceso hijo por
    // fichero, y los hijos NO heredan las flags de la línea de comandos del
    // padre — medido: con `node --max-old-space-size=512 --test …` los hijos
    // seguían llegando a 4,2 GB.
    const cmd = leer("package.json").scripts["test:mutate"] as string;
    assert.match(
      cmd,
      /NODE_OPTIONS=[^\s]*--max-old-space-size=\d+/,
      "test:mutate sin tope de heap: un mutante desbocado crece hasta agotar la RAM de la máquina",
    );
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
