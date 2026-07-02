/** Serialise `CONFIG` to data/runtime_config.json so non-TypeScript services
 * (ai_server in Python, narrative-mcp in plain Node) can read it.
 *
 * Also emits data/combat_effective_params.json — the effective attack params
 * (weapon × attack type) precomputed by nefan-core's getEffectiveParams, so
 * Godot reads a table instead of duplicating the combat math in GDScript
 * ("lógica en nefan-core, Godot solo visual").
 *
 * Run with `npx tsx scripts/dump-config.ts` from the `nefan-core` directory,
 * or via the `prebuild` npm hook. start.sh also refreshes it before launching
 * the stack so changes to config.ts propagate without a manual build.
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.js";
import { loadConfig, getEffectiveParams } from "../src/combat/combat-data.js";
import type { EffectiveParams } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });

const out = join(dataDir, "runtime_config.json");
writeFileSync(out, JSON.stringify(CONFIG, null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);

const combat = loadConfig(JSON.parse(readFileSync(join(dataDir, "combat_config.json"), "utf-8")));
const table: Record<string, Record<string, EffectiveParams>> = {};
for (const [weaponId, weapon] of Object.entries(combat.weapons)) {
  table[weaponId] = {};
  for (const attackTypeId of Object.keys(combat.attack_types)) {
    table[weaponId][attackTypeId] = getEffectiveParams(attackTypeId, combat.attack_types, weapon);
  }
}
const paramsOut = join(dataDir, "combat_effective_params.json");
writeFileSync(paramsOut, JSON.stringify(table, null, 2) + "\n", "utf-8");
console.log(`wrote ${paramsOut}`);
