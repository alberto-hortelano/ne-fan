/** Vuelca a `data/contract/borrador-de-mundo.json` el umbral del borrador de
 *  mundo: el mínimo y el máximo de caracteres que hacen que un borrador valga
 *  una génesis.
 *
 *  Mismo molde y mismo motivo que `dump-physics.ts` y `dump-style-upload.ts`,
 *  incluida la parte que parece un olvido y no lo es: **este snapshot NO se
 *  regenera en los hooks `pre*`**. El job `ai-server` del CI no corre npm (solo
 *  `ruff`, `compileall` y `unittest`), así que ai_server lee el fichero
 *  COMMITEADO. Si se auto-regenerase antes de cada test, mover el mínimo en TS
 *  dejaría el fichero del repo obsoleto sin que nada se pusiera rojo y el
 *  tercer proceso volvería a divergir en silencio — que es justo lo que este
 *  volcado cierra (hallazgo H1 de la QA de la PR 7 de #241). Al no regenerarse
 *  solo, `test/contract-borrador-de-mundo.test.ts` compara lo commiteado con la
 *  fuente y falla diciendo qué comando correr.
 *
 *  Uso: `npm run dump-borrador-de-mundo` desde `nefan-core`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { borradorSnapshot } from "../src/protocol/borrador-de-mundo.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "data", "contract");
mkdirSync(dir, { recursive: true });

const out = join(dir, "borrador-de-mundo.json");
writeFileSync(out, JSON.stringify(borradorSnapshot(), null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
