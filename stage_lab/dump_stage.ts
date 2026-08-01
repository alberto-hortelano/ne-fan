/** Dump del plató compuesto para el bench de segmentación (stage_lab).
 *
 *  Toma una escena Format D de plató (fixture o extraída de un save), la pasa
 *  por stagePlanFromScene + composeStage — la MISMA ruta que el cliente — y
 *  vuelca la geometría que run.py necesita para desproyectar píxeles de la
 *  imagen pintada a mundo: proj, view_box, rect, capas (z/bbox/footprint),
 *  exits y los expected_elements (pistas para la visión).
 *
 *  Uso: npx tsx stage_lab/dump_stage.ts <escena.json> <salida.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

import {
  composeStage,
  stagePlanFromScene,
  expectedElementsFor,
} from "../nefan-core/src/scene/stage/index.js";

const [scenePath, outPath] = process.argv.slice(2);
if (!scenePath || !outPath) {
  console.error("uso: npx tsx stage_lab/dump_stage.ts <escena.json> <salida.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(scenePath, "utf-8")) as Record<string, unknown>;
const plan = stagePlanFromScene(raw);
if (!plan) {
  console.error(`la escena ${scenePath} no es un plató (sin bloque stage válido)`);
  process.exit(1);
}
const key = String(raw.scene_id ?? raw.place_id ?? "stage");
const stage = composeStage(plan, key);
const widthM = plan.size.cols * plan.size.meters_per_cell;
const depthM = plan.size.rows * plan.size.meters_per_cell;

const dump = {
  key,
  scene_description: raw.scene_description ?? "",
  backdrop: (raw.stage as { backdrop?: { description?: string } } | undefined)?.backdrop?.description ?? "",
  proj: stage.proj,
  view_box: stage.view_box,
  bounds: stage.bounds,
  /** Rect COMPLETO de la escena (el de la colisión; bounds lleva el inset). */
  rect: { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 },
  meters_per_cell: plan.size.meters_per_cell,
  layers: stage.layers.map((l) => ({
    id: l.id,
    z: l.z,
    kind: l.kind,
    label: l.label ?? null,
    bbox: l.bbox,
    baseline_y: l.baseline_y,
    footprint: l.footprint ?? null,
  })),
  exits: stage.exits,
  expected_elements: expectedElementsFor(stage),
};

writeFileSync(outPath, JSON.stringify(dump, null, 2));
console.log(
  `dump de "${key}" → ${outPath}: ${dump.expected_elements.length} expected, ` +
  `${dump.layers.length} capas, proj focal=${stage.proj.focal_m} depth=${stage.proj.depth_m}`,
);
