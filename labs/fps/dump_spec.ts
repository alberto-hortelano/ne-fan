/** Vuelca el spec greybox de un plan declarativo del juego para el bench FPS.
 *  Usa el MISMO builder que el juego (buildTileGreyboxSpec) — la geometría es
 *  exactamente la del modo vector oblicuo, solo que el viewer FPS la recorre a
 *  nivel de suelo (celdas → metros ×0.5).
 *
 *  Uso: npx tsx labs/fps/dump_spec.ts [plan.json] [outDir] [tileId]
 *  Sin argumentos conserva el comportamiento histórico (tile medieval de
 *  labs/render → escenas/exterior).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTileGreyboxSpec } from "../../nefan-core/src/scene/blueprint/greybox.js";
import { parseVolumes } from "../../nefan-core/src/scene/blueprint/volumes.js";
import { parseGround } from "../../nefan-core/src/scene/blueprint/ground.js";

const here = dirname(fileURLToPath(import.meta.url));
const [planArg, outDirArg, tileIdArg] = process.argv.slice(2);
const planPath = planArg ?? join(here, "..", "render", "fixtures", "medieval", "plan.json");
const outDir = outDirArg ?? join(here, "escenas", "exterior");
const tileId = tileIdArg ?? "fps_exterior";
const outPath = join(outDir, "spec.json");

const plan = JSON.parse(readFileSync(planPath, "utf-8")) as {
  volumes: unknown;
  ground?: unknown;
  biome?: string;
  scene_description?: string;
};
const parsed = parseVolumes(plan.volumes);
if (!parsed.ok) {
  console.error("volumes inválidos:", parsed.error);
  process.exit(1);
}
// A nivel de suelo un cutaway (frente a 1.6 celdas = 0.8 m, sin tejado) se ve
// como una ruina: en el bench FPS todos los edificios van cerrados.
for (const v of parsed.volumes) {
  if (v.type === "building" && v.cutaway) delete (v as { cutaway?: boolean }).cutaway;
}
let ground;
if (plan.ground !== undefined) {
  const g = parseGround(plan.ground);
  if (!g.ok) {
    console.error("ground inválido:", g.error);
    process.exit(1);
  }
  ground = g.ground;
}
const spec = buildTileGreyboxSpec(
  { ground, volumes: parsed.volumes, biome: plan.biome ?? "grass" },
  tileId,
);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      source: relative(join(here, "..", ".."), planPath),
      scene_description: plan.scene_description ?? "",
      units: "cells",
      meters_per_cell: 0.5,
      spec,
    },
    null,
    1,
  ),
);
console.log(
  `spec → ${outPath}: ${spec.primitives.length} prims, ` +
    `${spec.elements.length} elements, ${spec.occluders.length} occluders`,
);
