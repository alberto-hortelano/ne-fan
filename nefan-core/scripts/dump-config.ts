/** Serialise `CONFIG` to data/runtime_config.json so non-TypeScript services
 * (ai_server in Python, narrative-mcp in plain Node) can read it.
 *
 * Run with `npx tsx scripts/dump-config.ts` from the `nefan-core` directory,
 * or via the `prebuild` npm hook. start.sh also refreshes it before launching
 * the stack so changes to config.ts propagate without a manual build.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "data", "runtime_config.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(CONFIG, null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
