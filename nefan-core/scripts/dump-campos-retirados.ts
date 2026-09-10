/** Vuelca a `data/contract/campos-retirados.json` los motivos con los que los
 *  DOS gates de escena rebotan una clave retirada, más el rótulo con el que
 *  nombran a la entity que la trae.
 *
 *  Mismo trato deliberado que `dump-physics.ts`, y por la misma razón: **este
 *  snapshot NO se regenera en los hooks `pre*`**. El job `ai-server` del CI no
 *  corre npm, así que `ai_server/campos_retirados.py` lee el fichero
 *  COMMITEADO. Si se auto-regenerase antes de cada test, un motivo cambiado en
 *  TS dejaría el fichero del repo obsoleto sin que nada se pusiera rojo y el
 *  espejo Python volvería a divergir en silencio — que es exactamente lo que
 *  midió #466 (cinco divergencias con una copia a mano que prometía ser «los
 *  mismos motivos, palabra por palabra»).
 *
 *  Uso: `npm run dump-campos-retirados` desde `nefan-core`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { camposRetiradosSnapshot } from "../src/contract/model-io/retired-terrain-fields.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "data", "contract");
mkdirSync(dir, { recursive: true });

const out = join(dir, "campos-retirados.json");
writeFileSync(out, JSON.stringify(camposRetiradosSnapshot(), null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
