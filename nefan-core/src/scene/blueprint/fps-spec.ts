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

  const primsM: SurfacePrim[] = spec.primitives.map((p) => {
    const scaled: SurfacePrim = scalePrim(p);
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
