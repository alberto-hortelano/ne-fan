/** Vuelca a `data/contract/style-upload.json` las reglas de `POST /styles/upload`:
 *  las carpetas del pack, los límites y el motivo exacto de cada rechazo.
 *
 *  Mismo molde y mismo motivo que `dump-physics.ts`, incluida la parte que
 *  parece un olvido y no lo es: **este snapshot NO se regenera en los hooks
 *  `pre*`**. El job `ai-server` del CI no corre npm (solo `ruff`, `compileall` y
 *  `unittest`), así que ai_server lee el fichero COMMITEADO. Si se
 *  auto-regenerase antes de cada test, cambiar un número en TS dejaría el
 *  fichero del repo obsoleto sin que nada se pusiera rojo y el espejo Python
 *  volvería a divergir en silencio — que es justo lo que este volcado cierra.
 *  Al no regenerarse solo, `test/contract-style-upload.test.ts` compara lo
 *  commiteado con la fuente y falla diciendo qué comando correr.
 *
 *  Uso: `npm run dump-style-upload` desde `nefan-core`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { styleUploadSnapshot } from "../src/contracts/style-upload.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "data", "contract");
mkdirSync(dir, { recursive: true });

const out = join(dir, "style-upload.json");
writeFileSync(out, JSON.stringify(styleUploadSnapshot(), null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
