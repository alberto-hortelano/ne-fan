/** #203 — el guardia DÉBIL: un término que un prompt le promete al modelo y
 *  que no existe en ningún proceso.
 *
 *  Es débil a propósito, y por eso se llama así: comprueba que el token EXISTA
 *  como identificador, no que signifique lo que el prompt dice. Aun así caza
 *  la clase que más duele —la promesa muerta—, que es como sobrevivió
 *  `player_choice` a que el evento real pasara a llamarse `dialogue_choice`:
 *  el motor lo leía, no existía en ninguna parte y nadie se enteraba.
 *
 *  El corpus son los CUATRO procesos más los datos de contrato COMMITEADOS.
 *  Deliberadamente FUERA: los prompts (o cada token se respaldaría a sí
 *  mismo), los tests (un término que solo vive en un test no lo implementa
 *  nadie) y todo lo gitignorado (`world/`, `user_*`, `dist/`) — si el corpus
 *  dependiera de un fichero regenerable, el guardia diría cosas distintas en
 *  local y en CI.
 *
 *  FICHERO PROPIO, Y NUNCA EN UNA BATERÍA DE MUTACIÓN (#347): su sujeto es
 *  TRANS-PROCESO — escanea la raíz del repo entera (`ai_server`,
 *  `narrative-mcp`, `nefan-html`…), y el sandbox de Stryker solo copia
 *  `nefan-core`, así que dentro de él este test revienta con ENOENT y tumba
 *  el dry-run del módulo entero (medido en la corrida 33397924513). Vivía en
 *  `contract-prompts.test.ts` y arrastraba consigo a toda esa batería; el
 *  resto de aquel fichero es sandbox-safe y sigue midiendo mutantes. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PROMPTS_DIR = fileURLToPath(new URL("../data/contract/prompts", import.meta.url));

describe("contrato narrativo — el guardia débil de términos prometidos (#203)", () => {
  /** Ids de EJEMPLO dentro de bloques de muestra de los prompts: nombran cosas
   *  que el motor inventa en su respuesta, no cosas que el código implemente.
   *  Si esta lista crece de ~10, el guardia está mal planteado — hay que
   *  pararlo y decirlo, no seguir ampliándola. */
  const EJEMPLOS_EXENTOS = new Set([
    "tree_n1", "tree_w2",       // scene_instructions.md: ids de dos árboles de muestra
    "roca_musgo", "claro_sur",  // tile_instructions.md: id de generador y de zona de muestra
    "pino_1", "pino_2",         // tile_instructions.md: ids de dos volúmenes de muestra
  ]);

  const TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
  const EXT = new Set([".ts", ".py", ".js", ".mjs", ".json", ".md"]);
  const SALTAR = new Set(["node_modules", "dist", ".git", "prompts", "__pycache__", "cache", "world", ".venv", "test", "tests"]);
  const RAIZ = fileURLToPath(new URL("../..", import.meta.url));

  function corpusDe(dir: string, trozos: string[]): void {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SALTAR.has(e.name) || e.name.startsWith("user_")) continue;
      const p = resolve(dir, e.name);
      if (e.isDirectory()) corpusDe(p, trozos);
      else if (EXT.has(e.name.slice(e.name.lastIndexOf(".")))) trozos.push(readFileSync(p, "utf-8"));
    }
  }

  it("todo término snake_case de los 8 prompts existe como identificador en algún proceso", () => {
    const tokens = new Map<string, string>();
    for (const file of readdirSync(PROMPTS_DIR).sort()) {
      if (!file.endsWith(".md")) continue;
      readFileSync(resolve(PROMPTS_DIR, file), "utf-8").split("\n").forEach((linea, i) => {
        for (const m of linea.matchAll(TOKEN)) if (!tokens.has(m[0])) tokens.set(m[0], `${file}:${i + 1}`);
      });
    }
    assert.ok(tokens.size >= 80, `solo ${tokens.size} términos en los prompts — ¿directorio equivocado?`);

    const trozos: string[] = [];
    for (const d of ["nefan-core/src", "nefan-core/bridge", "nefan-core/data", "narrative-mcp", "ai_server", "nefan-html/src"]) {
      corpusDe(resolve(RAIZ, d), trozos);
    }
    const corpus = trozos.join("\n");
    // Suelo de corpus: sin esto, un `SALTAR` de más lo dejaría casi vacío y el
    // guardia se pondría rojo por todo (o, si se invirtiera, verde por nada).
    assert.ok(trozos.length >= 150, `corpus de solo ${trozos.length} ficheros — el guardia estaría midiendo otra cosa`);

    const muertos = [...tokens]
      .filter(([t]) => !EJEMPLOS_EXENTOS.has(t))
      .filter(([t]) => !new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`).test(corpus))
      .map(([t, donde]) => `${t} (${donde})`);

    assert.deepEqual(
      muertos,
      [],
      "el prompt le promete al modelo términos que no existen en ningún proceso: " +
        "o los implementa alguien, o se corrigen en el .md (el motor los va a usar tal cual)",
    );
  });

  it("la lista de exentos no envejece: todos siguen apareciendo en los prompts", () => {
    let texto = "";
    for (const file of readdirSync(PROMPTS_DIR)) {
      if (file.endsWith(".md")) texto += readFileSync(resolve(PROMPTS_DIR, file), "utf-8");
    }
    const sobrantes = [...EJEMPLOS_EXENTOS].filter(
      (t) => !new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`).test(texto),
    );
    assert.deepEqual(sobrantes, [], "exenciones que ya no eximen nada: bórralas");
    assert.ok(EJEMPLOS_EXENTOS.size <= 10, "más de 10 exenciones: el guardia está mal planteado, párate y dilo");
  });
});
