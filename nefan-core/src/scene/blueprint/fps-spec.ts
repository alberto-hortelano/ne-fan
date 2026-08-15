/** Spec del tile para la vista FPS — lógica PURA.
 *
 *  Reutiliza el builder greybox del tile oblicuo (buildTileGreyboxSpec) con
 *  dos adaptaciones que a ras de suelo son obligatorias (bench labs/fps):
 *
 *  1. Los `cutaway` se CIERRAN: un edificio sin techo y con el frente a 0.8 m
 *     se ve como una ruina en primera persona. Se clona el plan (no se muta —
 *     el spec oblicuo del mismo tile no debe cambiar).
 *  2. Las primitivas y luces se escalan de CELDAS a METROS (×TILE_MPC): el
 *     clasificador de superficies y las UVs del renderer FPS trabajan en
 *     metros (DENSITY_M por repetición).
 *
 *  Además propaga `surface_desc` de los volúmenes a sus prims como celda
 *  "hero" del atlas (la vía del motor narrativo para pedir una superficie
 *  concreta que entra en la librería). */

import { TILE_MPC } from "../tile.js";
import type { GreyboxLight, GreyboxPrimitive } from "../greybox/common.js";
import type { SurfacePrim } from "../greybox/surfaces.js";
import { buildTileGreyboxSpec, type TileGreyboxPlan, type TileGreyboxSpec } from "./greybox.js";

/** Separación extra por prim entre rasgos planos del suelo (metros). El
 *  greybox escalona ENTRE capas (área<path<agua<deck) pero dentro de una capa
 *  todas las prims comparten y — coplanares exactas (cajas de segmento +
 *  cilindros de junta de un path). En la oblicua no importa (se rasteriza una
 *  vez a PNG ortográfico); en la perspectiva fps en tiempo real z-fightean.
 *  2 mm por prim es invisible a pie pero supera la precisión del z-buffer
 *  hasta el fog (~1.6 mm a 90 m con near 0.3). No se toca el builder
 *  compartido: su spec canónico es el layout_key del arte pagado. */
const GROUND_STAGGER_M = 0.002;

/** Banda de elevación (celdas) de los rasgos ground del greybox: Y_AREA 0.05
 *  … Y_DECK 0.18. El detalle procedural queda por debajo (≤0.05 con cat
 *  decor) y el agua de fuente muy por encima (1.05, cat water). */
const GROUND_BAND_MIN = 0.045;
const GROUND_BAND_MAX = 0.185;

function isGroundFeaturePrim(p: GreyboxPrimitive): boolean {
  return (
    (p.cat === "terrain" || p.cat === "water") &&
    p.noShadow === true &&
    p.pos[1] >= GROUND_BAND_MIN &&
    p.pos[1] <= GROUND_BAND_MAX
  );
}

export interface FpsTileSpec {
  /** Spec del builder (unidades CELDAS — coherente con elements/occluders). */
  spec: TileGreyboxSpec;
  /** Primitivas en METROS con hero/desc propagados: la entrada de
   *  buildLayout (surfaces.ts) y del renderer FPS. */
  primsM: SurfacePrim[];
  /** Luces con posiciones en METROS. */
  lightsM: GreyboxLight[];
}

function scalePrim(p: GreyboxPrimitive): GreyboxPrimitive {
  const q: GreyboxPrimitive = {
    ...p,
    pos: [p.pos[0] * TILE_MPC, p.pos[1] * TILE_MPC, p.pos[2] * TILE_MPC],
    size: p.size.map((v) => v * TILE_MPC),
  };
  if (p.points) q.points = p.points.map(([x, z]) => [x * TILE_MPC, z * TILE_MPC]);
  // size[2] de cone es "segmentos" y size[1] de sphere también: no se escalan.
  if (p.shape === "cone" && p.size[2] !== undefined) q.size[2] = p.size[2];
  if (p.shape === "sphere" && p.size[1] !== undefined) q.size[1] = p.size[1];
  return q;
}

export function buildFpsTileSpec(plan: TileGreyboxPlan, seedKey: string): FpsTileSpec {
  // Clonar volúmenes cerrando cutaways (sin mutar el plan de entrada).
  const volumes = plan.volumes.map((v) =>
    v.type === "building" && v.cutaway ? { ...v, cutaway: undefined } : v,
  );
  const spec = buildTileGreyboxSpec({ ...plan, volumes }, seedKey);

  // surface_desc por volId → celda hero en las prims del cuerpo del volumen.
  const heroByVolId = new Map<string, string>();
  for (const v of volumes) {
    const desc = (v as { surface_desc?: string }).surface_desc;
    if (desc) heroByVolId.set(`vol_${v.id}`, desc);
  }

  let groundIdx = 0;
  const primsM: SurfacePrim[] = spec.primitives.map((p) => {
    const scaled: SurfacePrim = scalePrim(p);
    // Stagger intra-capa de los rasgos planos del suelo (anti z-fighting).
    // El orden de emisión es el contractual (área→path→agua→deck, juntas
    // tras sus cajas), así que el índice creciente preserva la prioridad
    // visual del contrato y las juntas ganan en los codos.
    if (isGroundFeaturePrim(p)) {
      groundIdx += 1;
      scaled.pos = [scaled.pos[0], scaled.pos[1] + groundIdx * GROUND_STAGGER_M, scaled.pos[2]];
    }
    const desc = p.volId ? heroByVolId.get(p.volId) : undefined;
    if (desc) {
      scaled.hero = true;
      scaled.desc = desc;
    }
    return scaled;
  });

  const lightsM: GreyboxLight[] = spec.lights.map((l) =>
    l.pos
      ? { ...l, pos: [l.pos[0] * TILE_MPC, l.pos[1] * TILE_MPC, l.pos[2] * TILE_MPC] }
      : l,
  );

  return { spec, primsM, lightsM };
}
