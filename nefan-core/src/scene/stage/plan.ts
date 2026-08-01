/** Construcción del StageScenePlan desde una escena Format D cruda — el
 *  camino compartido entre el cliente 2D (carga de escena/fixture) y los
 *  tests. Fail-loud: una escena con `stage` malformado lanza (nunca degradar
 *  en silencio a escena plana). */

import { parseVolumes, type Volume } from "../blueprint/volumes.js";
import { deriveVolumesFromSchema, type DeriveInput } from "../blueprint/derive.js";
import { parseStage } from "./schema.js";
import type { StageScenePlan } from "./compose.js";

/** null si la escena no es proscenio (sin bloque `stage`). */
export function stagePlanFromScene(raw: Record<string, unknown>): StageScenePlan | null {
  if (raw.stage === undefined) return null;
  const stage = parseStage(raw.stage);
  if (!stage.ok) throw new Error(`stagePlanFromScene: ${stage.error}`);
  const size = raw.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
  if (
    typeof size?.cols !== "number" ||
    typeof size?.rows !== "number" ||
    typeof size?.meters_per_cell !== "number"
  ) {
    throw new Error("stagePlanFromScene: la escena proscenio necesita size {cols, rows, meters_per_cell}");
  }
  let declared: Volume[] = [];
  if (raw.volumes !== undefined) {
    const parsed = parseVolumes(raw.volumes);
    if (!parsed.ok) throw new Error(`stagePlanFromScene: ${parsed.error}`);
    declared = parsed.volumes;
  }
  const derived = deriveVolumesFromSchema(raw as DeriveInput, declared);
  return {
    size: { cols: size.cols, rows: size.rows, meters_per_cell: size.meters_per_cell },
    stage: stage.stage,
    volumes: [...declared, ...derived],
    biome: typeof raw.biome === "string" ? raw.biome : undefined,
  };
}
