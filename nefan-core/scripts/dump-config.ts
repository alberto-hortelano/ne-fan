/** Serialise `CONFIG` to data/runtime_config.json so non-TypeScript services
 * (ai_server in Python, narrative-mcp in plain Node) can read it.
 *
 * Run with `npx tsx scripts/dump-config.ts` from the `nefan-core` directory,
 * or via the `prebuild` npm hook. start.sh also refreshes it before launching
 * the stack so changes to config.ts propagate without a manual build.
 *
 * Los puertos que escribe son SIEMPRE el bloque BASE, sin desplazar. El
 * desplazamiento (`NEFAN_PORT_OFFSET`) viaja por el ENTORNO de cada proceso, no
 * por este fichero, y la razón es dura: el snapshot es uno por checkout, así
 * que dos stacks con offsets distintos en el mismo worktree —justo el caso que
 * el desplazamiento existe para permitir— se lo pisarían el uno al otro. Quien
 * lea de aquí y pueda estar desplazado suma el offset de su propio entorno
 * (`portOffset` en TS, `qa/lib/stack.mjs` en el banco, `start.sh` en bash).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });

const out = join(dataDir, "runtime_config.json");
writeFileSync(out, JSON.stringify(CONFIG, null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
