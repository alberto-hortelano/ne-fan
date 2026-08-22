#!/usr/bin/env node
// dump_escena.mjs <interior|exterior|...> — vuelca a escenas/<n>/escena.json el
// resultado EXACTO de load() (prims en metros con delantal/escalado aplicados,
// lights, env, playerStart, poses, npcs): lo que renderiza el viewer three.js,
// consumible tal cual por cualquier renderer que se quiera comparar. Un solo
// origen de datos — cero divergencia.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [sceneName] = process.argv.slice(2);
if (!sceneName) {
  console.error("uso: node dump_escena.mjs <interior|exterior|...>");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(`./escenas/${sceneName}/escena.mjs`);
const scene = await mod.load();
const out = {
  scene: sceneName,
  meta: scene.meta,
  env: scene.env,
  playerStart: scene.playerStart,
  poses: scene.poses,
  npcs: scene.npcs ?? [],
  lights: scene.lights,
  prims: scene.prims,
};
const outPath = join(here, "escenas", sceneName, "escena.json");
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.error(
  `${sceneName}: ${out.prims.length} prims, ${out.lights.length} luces, ` +
    `${out.poses.length} poses → ${outPath}`,
);
