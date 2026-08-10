/** Construcción del StageScenePlan desde una escena Format D cruda — el
 *  camino compartido entre el cliente 2D (carga de escena/fixture) y los
 *  tests. Fail-loud: una escena con `stage` malformado lanza (nunca degradar
 *  en silencio a escena plana). */

import { parseVolumes, type Volume } from "../blueprint/volumes.js";
import { parseGround, type GroundFeature } from "../blueprint/ground.js";
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
  // Surroundings: decorado FUERA de bounds. Un centro DENTRO del rect jugable
  // es un error del motor (taparía el plató sin colisión ni manifest) — la
  // falda de un cerro sí puede solapar, por eso solo se valida el centro.
  const halfW = (size.cols * mpc) / 2;
  const halfD = (size.rows * mpc) / 2;
  for (const s of stage.stage.surroundings ?? []) {
    const [sx, sz] = s.pos;
    if (Math.abs(sx) < halfW && Math.abs(sz) < halfD) {
      throw new Error(
        `stagePlanFromScene: surroundings "${s.kind}" en (${sx}, ${sz}) cae DENTRO del plató ` +
          `(±${halfW}×±${halfD} m) — el decorado va fuera de bounds`,
      );
    }
    // Un cerro pegado al borde mete su falda EN el plató como una pared de
    // tierra: el centro debe quedar al menos 0.4·r más allá del bound más
    // cercano (la falda puede asomar, la masa no).
    if (s.kind === "hill") {
      const out = Math.max(Math.abs(sx) - halfW, Math.abs(sz) - halfD);
      if (out < 0.4 * s.r) {
        throw new Error(
          `stagePlanFromScene: hill en (${sx}, ${sz}) con r=${s.r} demasiado pegado al plató ` +
            `— aleja el centro al menos ${Math.ceil(0.4 * s.r)} m más allá del borde`,
        );
      }
    }
  }
  // Rasgos vectoriales del suelo (v8, opcional): mismo schema que el tile.
  // Fail-loud, y además rango: el schema del tile admite hasta 144 celdas —
  // un path en la celda 100 de un plató de 24 cols pasa el zod pero es un
  // error del motor.
  let ground: GroundFeature[] | undefined;
  if (raw.ground !== undefined) {
    const parsed = parseGround(raw.ground);
    if (!parsed.ok) throw new Error(`stagePlanFromScene: ${parsed.error}`);
    const gridCols = size.cols;
    const gridRows = size.rows;
    const inGrid = (u: number, v: number): boolean =>
      u >= -16 && u <= gridCols + 16 && v >= -16 && v <= gridRows + 16;
    for (const f of parsed.features) {
      const pts: [number, number][] =
        f.kind === "path" ? (f.points as [number, number][])
        : f.rect ? [[f.rect[0], f.rect[1]], [f.rect[0] + f.rect[2], f.rect[1] + f.rect[3]]]
        : f.ellipse ? [[f.ellipse.center[0] - f.ellipse.rx, f.ellipse.center[1] - f.ellipse.ry], [f.ellipse.center[0] + f.ellipse.rx, f.ellipse.center[1] + f.ellipse.ry]]
        : (f.polygon as [number, number][]);
      for (const [u, v] of pts) {
        if (!inGrid(u, v)) {
          throw new Error(
            `stagePlanFromScene: ground "${f.id}" con coord (${u}, ${v}) fuera del grid ` +
              `${size.cols}×${size.rows} de la escena (margen ±16)`,
          );
        }
      }
    }
    ground = parsed.features;
  }
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
    ...(ground ? { ground } : {}),
    // Texto de escena: alimenta el detector de hora del día del greybox.
    ...(typeof raw.scene_description === "string" && raw.scene_description
      ? { description: raw.scene_description }
      : {}),
    ...(styleTag ? { style_tag: styleTag } : {}),
  };
}
