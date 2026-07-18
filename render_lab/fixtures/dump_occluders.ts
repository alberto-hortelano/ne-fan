/**
 * dump_occluders.ts — vuelca TODO lo que el bench render_lab necesita de un
 * tile: el plan crudo (map_ground + volumes + biome), el blueprint compuesto
 * (SVG + elements), los occluders por tramo (SVG standalone + baseline +
 * huella) y el suelo solo (compose con volumes=[]; mismo seedKey ⇒ mismo
 * detalle procedural).
 *
 * Uso:
 *   npx tsx render_lab/fixtures/dump_occluders.ts <core_root> \
 *     <save_state.json> <tile_key> <out_dir>
 *
 * Emite en <out_dir>:
 *   plan.json                 {map_ground, volumes, biome, scene_description, style_tag, tile_key}
 *   blueprint.svg / .json     como dump_blueprint.ts (elements + volumes + view_box)
 *   ground_only.svg           solo la capa de suelo (para E3: suelo aparte)
 *   occluders/<id>.svg        un SVG por tramo occluder
 *   occluders/occluders.json  [{id, vid, label, bbox, baseline_y, footprint_cells, overhead}]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [coreRoot, savePath, tileKey, outDir] = process.argv.slice(2);
if (!coreRoot || !savePath || !tileKey || !outDir) {
  console.error("uso: dump_occluders.ts <core_root> <save_state.json> <tile_key> <out_dir>");
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
  const biome = typeof data.biome === "string" ? data.biome : undefined;

  const plan = { map_ground: mapGround, volumes, biome };
  const composed = bp.composeBlueprint(plan, tileKey);
  const groundOnly = bp.composeBlueprint({ map_ground: mapGround, volumes: [], biome }, tileKey);

  mkdirSync(join(outDir, "occluders"), { recursive: true });
  writeFileSync(
    join(outDir, "plan.json"),
    JSON.stringify(
      {
        tile_key: tileKey,
        map_ground: mapGround ?? null,
        volumes,
        biome: biome ?? null,
        scene_description: data.scene_description ?? "",
        style_tag: data.style_tag ?? "",
      },
      null,
      2,
    ),
  );
  writeFileSync(join(outDir, "blueprint.svg"), composed.svg);
  writeFileSync(
    join(outDir, "blueprint.json"),
    JSON.stringify(
      {
        perspective: "oblique",
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
  writeFileSync(join(outDir, "ground_only.svg"), groundOnly.svg);
  for (const occ of composed.occluders) {
    writeFileSync(join(outDir, "occluders", `${occ.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.svg`), occ.svg);
  }
  writeFileSync(
    join(outDir, "occluders", "occluders.json"),
    JSON.stringify(
      composed.occluders.map((o: Record<string, unknown>) => ({
        id: o.id,
        vid: o.vid,
        label: o.label,
        file: `${String(o.id).replace(/[^a-zA-Z0-9_-]/g, "_")}.svg`,
        bbox: o.bbox,
        baseline_y: o.baseline_y,
        footprint_cells: o.footprint_cells,
        overhead: o.overhead ?? false,
      })),
      null,
      2,
    ),
  );
  console.log(
    `${tileKey}: elements=${composed.elements.length} occluders=${composed.occluders.length} ` +
      `volumes=${volumes.length} composer_v${bp.COMPOSER_VERSION} -> ${outDir}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
