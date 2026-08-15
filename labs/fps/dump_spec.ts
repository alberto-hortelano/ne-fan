/** Vuelca el spec greybox del tile medieval (fixture de labs/render) para el
 *  bench FPS. Usa el MISMO builder que el juego (buildTileGreyboxSpec) — la
 *  geometría del exterior es exactamente la del modo vector oblicuo, solo que
 *  el viewer FPS la recorre a nivel de suelo (celdas → metros ×0.5).
 *
 *  Uso: npx tsx labs/fps/dump_spec.ts   (desde la raíz del repo o nefan-core)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTileGreyboxSpec } from "../../nefan-core/src/scene/blueprint/greybox.js";
import { parseVolumes } from "../../nefan-core/src/scene/blueprint/volumes.js";

const here = dirname(fileURLToPath(import.meta.url));
const planPath = join(here, "..", "render", "fixtures", "medieval", "plan.json");
const outPath = join(here, "escenas", "exterior", "spec.json");

const plan = JSON.parse(readFileSync(planPath, "utf-8")) as {
  volumes: unknown;
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
const spec = buildTileGreyboxSpec(
  { volumes: parsed.volumes, biome: plan.biome ?? "grass" },
  "fps_exterior",
);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      source: "labs/render/fixtures/medieval/plan.json",
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
