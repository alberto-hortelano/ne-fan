/** Vuelca a `data/contract/physics.json` la física del CONTRATO: los cuerpos
 *  que el simulador mueve y el tope de `footprint` que sale de ellos.
 *
 *  Existe por el mismo motivo que `dump-config.ts` —que los procesos que no son
 *  TypeScript puedan leer una fuente única en vez de copiarla— pero con una
 *  diferencia deliberada: **este snapshot NO se regenera en los hooks
 *  `pre*`**. Y no es un olvido, es lo que le da valor.
 *
 *  El job `ai-server` del CI no corre npm: solo `ruff`, `compileall` y
 *  `unittest`. O sea que ai_server lee el fichero COMMITEADO, no uno recién
 *  generado en el runner. Si esto se auto-regenerase antes de cada test, un
 *  radio movido en TS dejaría el fichero del repo obsoleto sin que nada se
 *  pusiera rojo, y el espejo Python volvería a divergir en silencio — que es
 *  exactamente el fallo que este volcado viene a cerrar. Al no regenerarse
 *  solo, `test/contract-physics.test.ts` compara lo commiteado con la fuente y
 *  falla diciendo qué comando correr.
 *
 *  Uso: `npm run dump-physics` desde `nefan-core`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { physicsSnapshot } from "../src/contract/model-io/physics.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "data", "contract");
mkdirSync(dir, { recursive: true });

const out = join(dir, "physics.json");
writeFileSync(out, JSON.stringify(physicsSnapshot(), null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
