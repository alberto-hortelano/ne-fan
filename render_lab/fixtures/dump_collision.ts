/**
 * dump_collision.ts — vuelca el grid de colisión analítico de un tile
 * (volumeCollisionGrid de nefan-core: huellas declaradas, puertas y vanos
 * limpiados) a fixtures/<tile>/collision.json para la demo interactiva.
 *
 * Uso:
 *   npx tsx render_lab/fixtures/dump_collision.ts <core_root_ABSOLUTO> \
 *     <save_state.json> <tile_key> <out_json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [coreRoot, savePath, tileKey, outPath] = process.argv.slice(2);
if (!coreRoot || !savePath || !tileKey || !outPath) {
  console.error("uso: dump_collision.ts <core_root> <save_state.json> <tile_key> <out_json>");
  process.exit(2);
}

async function main(): Promise<void> {
  const bp = await import(join(coreRoot, "src/scene/blueprint/index.ts"));
  const collision = await import(join(coreRoot, "src/scene/blueprint/collision.ts"));

  const save = JSON.parse(readFileSync(savePath, "utf8"));
  const data = save?.scenes_loaded?.[tileKey]?.scene_data as Record<string, unknown>;
  if (!data) {
    console.error(`el save no tiene scenes_loaded['${tileKey}'].scene_data`);
    process.exit(1);
  }

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

  const rect = { minX: 0, minZ: 0, maxX: 64, maxZ: 64 }; // solo informa el origin
  const grid = collision.volumeCollisionGrid(volumes, rect);
  if (!grid) {
    console.error("tile sin celdas sólidas — nada que volcar");
    process.exit(1);
  }
  let solid = 0;
  for (const row of grid.grid) for (const ch of row) if (ch === "S") solid++;
  writeFileSync(outPath, JSON.stringify(grid));
  console.log(
    `${tileKey}: ${grid.cols}x${grid.rows} celdas, ${solid} sólidas ` +
      `(${((100 * solid) / (grid.cols * grid.rows)).toFixed(1)}%) -> ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
