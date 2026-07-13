/** Convierte una escena Format D de data/scenes/ a su world scene normalizada
 * (formatDToWorld) y la escribe en data/rooms/ para el cliente 3D.
 *
 * Godot NO porta la conversión celdas→metros (regla core-first): las escenas
 * del bridge llegan normalizadas por el wire, y las fixtures de disco se
 * generan aquí y se COMMITEAN — el arranque offline no depende de node.
 *
 * Uso: `npx tsx scripts/dump-scene.ts [scene_id]` (default: robledo_village),
 * o `npm run dump-scene`.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDToWorld } from "../src/scene/scene-normalize.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

const sceneId = process.argv[2] ?? "robledo_village";
const src = join(dataDir, "scenes", `${sceneId}.json`);
const raw = JSON.parse(readFileSync(src, "utf-8")) as Record<string, unknown>;

const normalized = formatDToWorld(raw);
if (normalized === raw) {
  throw new Error(`${src} no es Format D — nada que normalizar`);
}
// En disco el crudo no aporta (Godot no lo usa) y duplica el peso.
const world = { ...normalized };
delete world.__format_d;

const out = join(dataDir, "rooms", `${sceneId}.json`);
writeFileSync(out, JSON.stringify(world, null, 2) + "\n", "utf-8");
console.log(`wrote ${out}`);
