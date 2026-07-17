/**
 * dump_blueprint.ts — compone el blueprint de un tile de un save en la
 * proyección pedida y lo vuelca a disco para el bench de fidelidad
 * (fidelity.py). Funciona contra CUALQUIER árbol del repo (working tree
 * oblicuo o worktree de HEAD con topdown/iso): el módulo de blueprint se
 * importa dinámicamente de <core_root> y la API se detecta por sus exports
 * (HEAD exporta projectionFor y composeBlueprint(plan, perspective, seed);
 * el árbol oblicuo exporta PROJECTION y composeBlueprint(plan, seed)).
 *
 * Uso:
 *   npx tsx style_lab/dump_blueprint.ts <core_root> <oblique|topdown|isometric> \
 *     <save_state.json> <tile_key> <out_prefix>
 *
 * Emite <out_prefix>.svg y <out_prefix>.json {perspective, view_box, elements,
 * volumes, scene_description, style_tag}. Réplica de composeTilePlan de
 * nefan-html/src/main.ts (parseVolumes + deriveVolumesFromSchema + map_ground).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [coreRoot, perspective, savePath, tileKey, outPrefix] = process.argv.slice(2);
if (!coreRoot || !perspective || !savePath || !tileKey || !outPrefix) {
  console.error(
    "uso: dump_blueprint.ts <core_root> <oblique|topdown|isometric> <save_state.json> <tile_key> <out_prefix>",
  );
  process.exit(2);
}

async function main(): Promise<void> {
const bp = await import(join(coreRoot, "src/scene/blueprint/index.ts"));

const save = JSON.parse(readFileSync(savePath, "utf8"));
const entry = save?.scenes_loaded?.[tileKey];
if (!entry?.scene_data) {
  console.error(`el save no tiene scenes_loaded['${tileKey}'].scene_data`);
  process.exit(1);
}
const data = entry.scene_data as Record<string, unknown>;

const mapGround = typeof data.map_ground === "string" ? data.map_ground : undefined;
let declared: unknown[] = [];
if (Array.isArray(data.volumes)) {
  const parsed = bp.parseVolumes(data.volumes);
  if (!parsed.ok) {
    console.error(`volumes inválidos: ${parsed.error}`);
    process.exit(1);
  }
  declared = parsed.volumes;
}
const derived = bp.deriveVolumesFromSchema(
  {
    scene_id: tileKey,
    structures: data.structures,
    vegetation_zones: data.vegetation_zones,
    entities: data.entities,
    terrain_features: data.terrain_features,
  },
  declared,
);
const volumes = [...declared, ...derived];
if (!mapGround && volumes.length === 0) {
  console.error("escena sin map_ground ni volúmenes — nada que componer");
  process.exit(1);
}

const plan = {
  map_ground: mapGround,
  volumes,
  biome: typeof data.biome === "string" ? data.biome : undefined,
};

let composed;
if (typeof bp.projectionFor === "function") {
  if (!bp.isPerspective(perspective === "oblique" ? "topdown" : perspective)) {
    console.error(`HEAD no conoce la perspectiva '${perspective}' (vale topdown|isometric)`);
    process.exit(1);
  }
  if (perspective === "oblique") {
    console.error("este árbol es HEAD (dual): 'oblique' no existe aquí — usa el working tree");
    process.exit(1);
  }
  composed = bp.composeBlueprint(plan, perspective, tileKey);
} else {
  if (perspective !== "oblique") {
    console.error(`este árbol es el oblicuo unificado: solo compone 'oblique', no '${perspective}'`);
    process.exit(1);
  }
  composed = bp.composeBlueprint(plan, tileKey);
}

writeFileSync(`${outPrefix}.svg`, composed.svg);
writeFileSync(
  `${outPrefix}.json`,
  JSON.stringify(
    {
      perspective,
      composer_version: bp.COMPOSER_VERSION,
      view_box: composed.viewBox,
      elements: composed.elements,
      volumes,
      scene_description: data.scene_description ?? "",
      style_tag: data.style_tag ?? "",
    },
    null,
    2,
  ),
);
console.log(
  `${perspective}: viewBox=[${composed.viewBox}] elements=${composed.elements.length} ` +
    `volumes=${volumes.length} composer_v${bp.COMPOSER_VERSION} -> ${outPrefix}.{svg,json}`,
);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
