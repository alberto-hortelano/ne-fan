/** Construcción del StageScenePlan desde una escena Format D cruda — el
 *  camino compartido entre el cliente 2D (carga de escena/fixture) y los
 *  tests. Fail-loud: una escena con `stage` malformado lanza (nunca degradar
 *  en silencio a escena plana). */

import { parseVolumes, type Volume } from "../blueprint/volumes.js";
import { deriveVolumesFromSchema, type DeriveInput } from "../blueprint/derive.js";
import { defaultPropHeightM, PROP_H_MAX_M, PROP_H_MIN_M } from "../blueprint/prop-heights.js";
import { parseStage } from "./schema.js";
import type { StageScenePlan } from "./greybox.js";

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
  const mpc = size.meters_per_cell;
  // Señal de interior: style_tag y fourth_wall deben ser coherentes — un
  // plató "bajo techo" (fourth_wall) etiquetado con un tag exterior es una
  // contradicción del motor narrativo, no algo que adivinar.
  const styleTag = typeof raw.style_tag === "string" ? raw.style_tag : undefined;
  const EXTERIOR_STAGE_TAGS = new Set([
    "stage_street", "stage_plaza", "stage_nature", "stage_harbor", "stage_gate",
  ]);
  if (stage.stage.fourth_wall?.present === true && styleTag && EXTERIOR_STAGE_TAGS.has(styleTag)) {
    throw new Error(
      `stagePlanFromScene: fourth_wall.present=true con style_tag exterior "${styleTag}" — ` +
        "un interior debe etiquetarse stage_interior",
    );
  }
  let declared: Volume[] = [];
  if (raw.volumes !== undefined) {
    const parsed = parseVolumes(raw.volumes);
    if (!parsed.ok) throw new Error(`stagePlanFromScene: ${parsed.error}`);
    // Props declarados SIN `h`: altura semántica por label (misma tabla que
    // el derive) — sin esto volumeHeightM les aplicaba su default en celdas
    // y el mobiliario salía a alturas dispares.
    declared = parsed.volumes.map((v) => {
      if (v.type !== "prop" || v.h !== undefined) return v;
      const hM = Math.min(
        PROP_H_MAX_M,
        Math.max(PROP_H_MIN_M, defaultPropHeightM(v.label) ?? 1.0),
      );
      return { ...v, h: hM / mpc };
    });
  }
  // En proscenio la habitación enterable ES el plató: sus muros ya van
  // estampados en el terrain (expandScenePrimitives) y pintarla como fachada
  // frontal taparía el set entero. Por eso el derive NO consume `structures`
  // (si lo hiciera, además, su rect actuaría de blocker y se tragaría todo el
  // mobiliario de dentro). Los cutaway declarados a mano se filtran igual;
  // los buildings normales (una caseta al fondo de un patio) sí se pintan.
  const derived = deriveVolumesFromSchema(
    // meters_per_cell activa el respeto del `h` declarado por entity (solo
    // proscenio — el derive del tile no cambia).
    { ...(raw as DeriveInput), structures: undefined, meters_per_cell: size.meters_per_cell },
    declared,
  );
  const volumes = [...declared, ...derived].filter(
    (v) => !(v.type === "building" && v.cutaway === true),
  );
  // Rejilla de terreno (opcional): el greybox pinta el suelo por bandas de
  // tipo (la calle de tierra, el prado, el empedrado) — sin ella todo el
  // suelo sería un color plano.
  const terrain = Array.isArray(raw.terrain) && raw.terrain.every((r) => typeof r === "string")
    ? (raw.terrain as string[])
    : undefined;
  const legend =
    raw.terrain_legend && typeof raw.terrain_legend === "object"
      ? (raw.terrain_legend as Record<string, string>)
      : undefined;
  return {
    size: { cols: size.cols, rows: size.rows, meters_per_cell: size.meters_per_cell },
    stage: stage.stage,
    volumes,
    biome: typeof raw.biome === "string" ? raw.biome : undefined,
    ...(terrain ? { terrain } : {}),
    ...(legend ? { terrain_legend: legend } : {}),
    // Texto de escena: alimenta el detector de hora del día del greybox.
    ...(typeof raw.scene_description === "string" && raw.scene_description
      ? { description: raw.scene_description }
      : {}),
    ...(styleTag ? { style_tag: styleTag } : {}),
  };
}
