/** Composición de la escena del plató SIN pintura: geometría jugable (bounds,
 *  exits en metros de mundo, items con huella/altura) derivada del
 *  `GreyboxSpec` — el spec 3D es la ÚNICA fuente del arte del plató (clay
 *  three.js en modo vector; repintado IA del clay en modo imagen). Sustituye
 *  al compositor SVG de capas: la proyección efectiva del renderer es SIEMPRE
 *  la del greybox (`spec.proj`/`spec.view_box`), en ambos modos.
 *
 *  DETERMINISTA: mismo plan + seedKey ⇒ mismo spec ⇒ mismo canónico (la clave
 *  de caché del repintado). Convención de cámara: SUR (stage/projection.ts). */

import type { Edge } from "../../world-map/types.js";
import type { StageBounds, StageProjParams } from "./projection.js";
import type { ViewBox } from "./segments.js";
import { buildGreyboxSpec, type GreyboxSpec, type StageScenePlan } from "./greybox.js";

/** Margen de clamp del jugador respecto al rect de la escena (m). */
const BOUNDS_INSET_M = 0.25;

export interface ComposedStageExit {
  id: string;
  edge: Edge;
  to_place_id: string;
  kind: "door" | "opening" | "stairs";
  label: string;
  /** Zona de transición en metros de MUNDO. */
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
}

/** Un volumen del plató como dato jugable (sin pintura): espejo 1:1 del
 *  manifest del greybox, con el z de plató como orden del pintor (entidad
 *  delante ⟺ su zStage < item.z). */
export interface StageItem {
  /** "vol_<volId>" — mismo id que el manifest y que los recortes casados. */
  id: string;
  /** zStage de la línea de contacto sur (m desde la embocadura). */
  z: number;
  label: string;
  /** Huella XZ en metros de MUNDO [minX, minZ, maxX, maxZ]. */
  footprint: [number, number, number, number];
  hM: number;
  solid: boolean;
  tall: boolean;
}

export interface ComposedStage {
  /** Proyección del greybox — la ÚNICA del plató (== spec.proj). */
  proj: StageProjParams;
  view_box: ViewBox;
  /** Límites jugables (clamp de movimiento) en metros de MUNDO. */
  bounds: StageBounds;
  /** Items de fondo a frente (z descendente). */
  items: StageItem[];
  exits: ComposedStageExit[];
  /** El spec 3D completo: el cliente lo renderiza con three.js. */
  spec: GreyboxSpec;
}

export function composeStageScene(plan: StageScenePlan, seedKey: string): ComposedStage {
  const spec = buildGreyboxSpec(plan, seedKey); // valida plan.size (fail-loud)
  const mpc = plan.size.meters_per_cell;
  const widthM = plan.size.cols * mpc;
  const depthM = plan.size.rows * mpc;
  const rect = { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 };
  const bounds: StageBounds = {
    minX: rect.minX + BOUNDS_INSET_M,
    maxX: rect.maxX - BOUNDS_INSET_M,
    minZ: rect.minZ + BOUNDS_INSET_M,
    maxZ: rect.maxZ - BOUNDS_INSET_M,
  };
  const zoneToWorld = (zone: [number, number, number, number]) => ({
    minX: rect.minX + zone[0] * mpc,
    minZ: rect.minZ + zone[1] * mpc,
    maxX: rect.minX + (zone[0] + zone[2]) * mpc,
    maxZ: rect.minZ + (zone[1] + zone[3]) * mpc,
  });
  const exits: ComposedStageExit[] = plan.stage.exits.map((e) => ({
    id: e.id,
    edge: e.edge as Edge,
    to_place_id: e.to_place_id,
    kind: e.kind,
    label: e.label,
    rect: zoneToWorld(e.zone),
  }));
  const items: StageItem[] = spec.manifest
    .map((m) => ({
      id: m.id,
      z: m.zStage,
      label: m.label,
      footprint: m.footprintWorld,
      hM: m.hM,
      solid: m.solid,
      tall: m.tall,
    }))
    .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
  return { proj: spec.proj, view_box: spec.view_box, bounds, items, exits, spec };
}
