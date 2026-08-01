/** Compositor proscenio: stage plan → capas vectoriales en perspectiva.
 *
 *  DETERMINISTA byte a byte: mismo plan + mismo seedKey ⇒ misma salida
 *  (SeededRng con namespace "stage:", sin Date.now/Math.random). El hash de
 *  las capas gobernará la caché del repintado por peeling (entrega 2), igual
 *  que el hash del blueprint oblicuo gobierna la suya — versión y namespace
 *  PROPIOS: este módulo no comparte ni un byte de salida con
 *  `blueprint/compose.ts` (COMPOSER_VERSION oblicua intocable).
 *
 *  Salida: capas ordenadas de fondo a frente, cada una un SVG standalone con
 *  el MISMO viewBox (el cliente las rasteriza apiladas e inserta los sprites
 *  entre ellas comparando z). La huella (`footprint`) y las zonas de salida
 *  van en metros de MUNDO — la colisión y las transiciones nunca leen
 *  píxeles. Convención de cámara: SUR (ver stage/projection.ts). */

import { seededRng, uniform, fmt, polygon, rectEl, line, ellipse } from "../blueprint/svg.js";
import { PALETTE, BIOME_COLORS, wallColors, roofColors, darken, lighten } from "../blueprint/palette.js";
import type { Volume } from "../blueprint/volumes.js";
import type { StageBlock } from "./schema.js";
import {
  scaleAt,
  stageToView,
  type StageBounds,
  type StageProjParams,
} from "./projection.js";
import type { Edge } from "../../world-map/types.js";

export const STAGE_COMPOSER_VERSION = 1;

/** Unidades de vista por metro en la embocadura. */
const PX_PER_M = 10;
const HORIZON_Y = 0;
const GROUND_Y = 100;
const VIEW_MARGIN_X = 8;
const VIEW_TOP = -48;
const VIEW_TOP_INTERIOR = -28;
const VIEW_BOTTOM_PAD = 10;
const DEFAULT_FOCAL_M = 12;
/** Altura pintada del muro del telón de fondo (m). */
const BACKDROP_WALL_M = 3.5;
/** Altura de la cuarta pared y de sus huecos de puerta (m). */
const FOURTH_WALL_M = 3;
const DOOR_H_M = 2.3;
/** Margen de clamp del jugador respecto al rect de la escena (m). */
const BOUNDS_INSET_M = 0.25;

export interface StageLayerKind {
  kind: "backdrop" | "floor" | "prop" | "wall" | "fourth_wall";
}

export interface StageLayer {
  id: string;
  /** z de PLATÓ (m desde la embocadura) de la capa: orden del pintor e
   *  inserción de sprites (entidad delante ⟺ su zStage < layer.z). */
  z: number;
  kind: StageLayerKind["kind"];
  /** SVG standalone (viewBox común a todas las capas). */
  svg: string;
  /** [minX, minY, maxX, maxY] en unidades de vista. */
  bbox: [number, number, number, number];
  /** y de vista de la línea de contacto con el suelo. */
  baseline_y: number;
  /** Huella XZ en metros de MUNDO [minX, minZ, maxX, maxZ]; ausente =
   *  decorado sin presencia física (backdrop, suelo, bastidores). */
  footprint?: [number, number, number, number];
  /** Hueco del peeling (entrega 2): imagen repintada de ESTA capa. */
  image_url?: string;
}

export interface ComposedStageExit {
  id: string;
  edge: Edge;
  to_place_id: string;
  kind: "door" | "opening" | "stairs";
  label: string;
  /** Zona de transición en metros de MUNDO. */
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface ComposedStage {
  stage_composer_version: number;
  view_box: { minX: number; minY: number; width: number; height: number };
  proj: StageProjParams;
  /** Límites jugables (clamp de movimiento) en metros de MUNDO. */
  bounds: StageBounds;
  /** Capas de fondo a frente (z descendente). */
  layers: StageLayer[];
  exits: ComposedStageExit[];
  /** Composición completa (debug/preview/tests). */
  svg: string;
}

export interface StageScenePlan {
  size: { cols: number; rows: number; meters_per_cell: number };
  stage: StageBlock;
  /** Volúmenes declarados + derivados (deriveVolumesFromSchema del caller),
   *  en celdas de la escena. */
  volumes: Volume[];
  biome?: string;
}

interface LayerBuild {
  id: string;
  z: number;
  kind: StageLayer["kind"];
  body: string;
  bbox: [number, number, number, number];
  baseline_y: number;
  footprint?: [number, number, number, number];
}

export function composeStage(plan: StageScenePlan, seedKey: string): ComposedStage {
  const { cols, rows } = plan.size;
  const mpc = plan.size.meters_per_cell;
  if (!(cols > 0) || !(rows > 0) || !(mpc > 0)) {
    throw new Error(`composeStage: size inválido ${JSON.stringify(plan.size)}`);
  }
  const widthM = cols * mpc;
  const depthM = rows * mpc;
  const proj: StageProjParams = {
    focal_m: plan.stage.focal_m ?? DEFAULT_FOCAL_M,
    depth_m: depthM,
    width_m: widthM,
    px_per_m: PX_PER_M,
    horizon_y: HORIZON_Y,
    ground_y: GROUND_Y,
  };
  /** Rect completo de la escena en mundo (centrado, como scene-normalize). */
  const rect = { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 };
  const bounds: StageBounds = {
    minX: rect.minX + BOUNDS_INSET_M,
    maxX: rect.maxX - BOUNDS_INSET_M,
    minZ: rect.minZ + BOUNDS_INSET_M,
    maxZ: rect.maxZ - BOUNDS_INSET_M,
  };
  const interiorLike = plan.stage.fourth_wall?.present === true;
  // Interior: encuadre más bajo (la pared del fondo no necesita cielo);
  // exterior: aire para el telón pintado (cielo + colinas).
  const viewTop = interiorLike ? VIEW_TOP_INTERIOR : VIEW_TOP;
  const viewBox = {
    minX: -(widthM / 2) * PX_PER_M - VIEW_MARGIN_X,
    minY: viewTop,
    width: widthM * PX_PER_M + 2 * VIEW_MARGIN_X,
    height: GROUND_Y - viewTop + VIEW_BOTTOM_PAD,
  };
  const viewRight = viewBox.minX + viewBox.width;
  const viewBottom = viewBox.minY + viewBox.height;

  /** xStage del centro de un rango de celdas [c0, c0+w). */
  const cellsToXStage = (c0: number, w: number): number => rect.minX + (c0 + w / 2) * mpc;
  /** zStage de la línea SUR (contacto) de un rango de filas [r0, r0+h). */
  const cellsToZStage = (r0: number, h: number): number =>
    Math.min(depthM - 0.05, Math.max(0.05, depthM - (r0 + h) * mpc));
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

  const layers: LayerBuild[] = [];

  // ── Telón de fondo (norte, zStage = depth) ────────────────────────────────
  {
    const sBack = scaleAt(proj, depthM);
    const yBack = stageToView(proj, 0, depthM)[1];
    const rng = seededRng(`stage:${seedKey}:backdrop`);
    let body = "";
    if (interiorLike) {
      // Pared del fondo de suelo a techo (habitación cerrada).
      const wall = wallColors("plaster");
      body += rectEl(viewBox.minX, viewBox.minY, viewBox.width, yBack - viewBox.minY, wall.lit);
      // Zócalo + juntas verticales sembradas.
      body += rectEl(viewBox.minX, yBack - 2.4, viewBox.width, 2.4, darken(wall.lit, 0.25));
      for (let i = 0; i < 6; i++) {
        const jx = uniform(rng, viewBox.minX + 8, viewRight - 8);
        body += line([jx, viewBox.minY + 6], [jx, yBack - 2.4], darken(wall.lit, 0.12), 0.5);
      }
    } else {
      // Cielo + colinas lejanas + banda de suelo distante.
      body += rectEl(viewBox.minX, viewBox.minY, viewBox.width, yBack - viewBox.minY, "#9db4c6");
      const hillBase = darken("#9db4c6", 0.28);
      for (const [tint, amp, yOff] of [
        [darken(hillBase, 0.08), 14, 18],
        [darken(hillBase, 0.22), 9, 8],
      ] as [string, number, number][]) {
        const pts: [number, number][] = [[viewBox.minX, yBack]];
        const n = 7;
        for (let i = 0; i <= n; i++) {
          const hx = viewBox.minX + (viewBox.width * i) / n;
          pts.push([hx, yBack - yOff - uniform(rng, 0, amp)]);
        }
        pts.push([viewRight, yBack]);
        body += polygon(pts, tint);
      }
      const wallH = BACKDROP_WALL_M * PX_PER_M * sBack * 0.4;
      body += rectEl(viewBox.minX, yBack - wallH, viewBox.width, wallH, darken(BIOME_COLORS[plan.biome ?? "grass"] ?? PALETTE.grassBase, 0.18));
    }
    // Puertas del fondo: un hueco por exit norte.
    for (const e of plan.stage.exits) {
      if (e.edge !== "north") continue;
      const w = zoneToWorld(e.zone);
      const cx = ((w.minX + w.maxX) / 2) * PX_PER_M * sBack;
      const doorW = Math.max(1.2, w.maxX - w.minX) * PX_PER_M * sBack;
      const doorH = DOOR_H_M * PX_PER_M * sBack;
      body += rectEl(cx - doorW / 2, yBack - doorH, doorW, doorH, "#171219");
      body += rectEl(cx - doorW / 2 - 0.8, yBack - doorH - 0.8, doorW + 1.6, 0.8, PALETTE.woodFace);
      body += line([cx - doorW / 2, yBack - doorH], [cx - doorW / 2, yBack], PALETTE.woodFace, 0.8);
      body += line([cx + doorW / 2, yBack - doorH], [cx + doorW / 2, yBack], PALETTE.woodFace, 0.8);
    }
    layers.push({
      id: "backdrop",
      z: depthM + 0.5,
      kind: "backdrop",
      body,
      bbox: [viewBox.minX, viewBox.minY, viewRight, yBack],
      baseline_y: yBack,
    });
  }

  // ── Suelo en perspectiva ──────────────────────────────────────────────────
  {
    const rng = seededRng(`stage:${seedKey}:floor`);
    const sBack = scaleAt(proj, depthM);
    const yBack = stageToView(proj, 0, depthM)[1];
    const halfFront = (widthM / 2) * PX_PER_M;
    const halfBack = halfFront * sBack;
    const floorColor = interiorLike
      ? darken(PALETTE.woodTop, 0.22)
      : (BIOME_COLORS[plan.biome ?? "grass"] ?? PALETTE.grassBase);
    let body = polygon(
      [
        [-halfFront, GROUND_Y],
        [-halfBack, yBack],
        [halfBack, yBack],
        [halfFront, GROUND_Y],
      ],
      floorColor,
    );
    // Delantal: el suelo continúa hacia cámara hasta el borde inferior del
    // encuadre (sin él, la franja bajo la embocadura queda transparente).
    body += rectEl(viewBox.minX, GROUND_Y, viewBox.width, viewBottom - GROUND_Y, darken(floorColor, 0.15));
    if (interiorLike) {
      // Tablones convergentes (fuga real del suelo).
      const step = 1; // m
      for (let x = -widthM / 2 + step; x < widthM / 2 - 1e-6; x += step) {
        body += line(
          [x * PX_PER_M, GROUND_Y],
          [x * PX_PER_M * sBack, yBack],
          darken(floorColor, 0.18),
          0.4,
        );
      }
    } else {
      // Moteado sembrado + líneas de profundidad tenues.
      for (let i = 0; i < 26; i++) {
        const xs = uniform(rng, -widthM / 2 + 0.5, widthM / 2 - 0.5);
        const zs = uniform(rng, 0.4, depthM - 0.4);
        const [vx, vy] = stageToView(proj, xs, zs);
        const s = scaleAt(proj, zs);
        const tint = rng.next() > 0.5 ? darken(floorColor, 0.12) : lighten(floorColor, 0.1);
        body += ellipse(vx, vy, uniform(rng, 1.5, 4) * s, uniform(rng, 0.6, 1.4) * s, tint);
      }
    }
    // Líneas de contacto por profundidad (guía sutil de escala, ambas variantes).
    for (let z = 2; z < depthM - 1e-6; z += 2) {
      const y = stageToView(proj, 0, z)[1];
      const half = (widthM / 2) * PX_PER_M * scaleAt(proj, z);
      body += line([-half, y], [half, y], darken(floorColor, 0.1), 0.3);
    }
    layers.push({
      id: "floor",
      z: depthM + 0.4,
      kind: "floor",
      body,
      bbox: [-halfFront, yBack, halfFront, GROUND_Y],
      baseline_y: GROUND_Y,
    });
  }

  // ── Volúmenes → billboards frontales ──────────────────────────────────────
  for (const v of plan.volumes) {
    const built = buildVolumeLayer(v, proj, rect, mpc, seedKey, cellsToXStage, cellsToZStage);
    if (built) layers.push(built);
  }

  // ── Bastidores (bandas laterales que cierran el encuadre) ─────────────────
  {
    const sBack = scaleAt(proj, depthM);
    const yBack = stageToView(proj, 0, depthM)[1];
    const halfFront = (widthM / 2) * PX_PER_M;
    const halfBack = halfFront * sBack;
    const wingColor = "#17131b";
    for (const side of [-1, 1] as const) {
      const outer = side < 0 ? viewBox.minX : viewRight;
      let body = polygon(
        [
          [side * halfFront, viewBottom],
          [side * halfFront, GROUND_Y],
          [side * halfBack, yBack],
          [side * halfBack, viewBox.minY],
          [outer, viewBox.minY],
          [outer, viewBottom],
        ],
        wingColor,
      );
      // Salidas laterales: arco marcado sobre el bastidor a la z de su zona.
      for (const e of plan.stage.exits) {
        if ((side < 0 && e.edge !== "west") || (side > 0 && e.edge !== "east")) continue;
        const w = zoneToWorld(e.zone);
        const zMid = Math.min(depthM - 0.3, Math.max(0.3, depthM - ((w.minZ + w.maxZ) / 2 - rect.minZ)));
        const s = scaleAt(proj, zMid);
        const [ax, ay] = stageToView(proj, side * (widthM / 2), zMid);
        const aw = 1.4 * PX_PER_M * s;
        const ah = DOOR_H_M * PX_PER_M * s;
        body += rectEl(ax - aw / 2, ay - ah, aw, ah, lighten(wingColor, 0.18));
        body += ellipse(ax, ay - ah, aw / 2, aw / 3, lighten(wingColor, 0.18));
        body += rectEl(ax - aw / 2 + 0.6, ay - ah + 0.6, aw - 1.2, ah - 0.6, "#0d0a10");
      }
      layers.push({
        id: side < 0 ? "wing_west" : "wing_east",
        z: 0.001,
        kind: "wall",
        body,
        bbox: side < 0
          ? [viewBox.minX, viewBox.minY, -halfBack, viewBottom]
          : [halfBack, viewBox.minY, viewRight, viewBottom],
        baseline_y: viewBottom,
      });
    }
  }

  // ── Cuarta pared (embocadura, se desvanece por proximidad) ────────────────
  if (plan.stage.fourth_wall?.present) {
    const wall = wallColors("plaster");
    const wallTop = GROUND_Y - FOURTH_WALL_M * PX_PER_M;
    const doorTop = GROUND_Y - DOOR_H_M * PX_PER_M;
    // Huecos = puertas declaradas ∪ zonas de exits sur (nunca una salida sin
    // su hueco, aunque el motor olvide declararla como puerta).
    const holes: Array<{ x0: number; x1: number }> = [];
    for (const d of plan.stage.fourth_wall.doors ?? []) {
      holes.push({ x0: (rect.minX + d.col * mpc) * PX_PER_M, x1: (rect.minX + (d.col + d.w) * mpc) * PX_PER_M });
    }
    for (const e of plan.stage.exits) {
      if (e.edge !== "south") continue;
      const w = zoneToWorld(e.zone);
      holes.push({ x0: w.minX * PX_PER_M, x1: w.maxX * PX_PER_M });
    }
    holes.sort((a, b) => a.x0 - b.x0);
    const merged: Array<{ x0: number; x1: number }> = [];
    for (const h of holes) {
      const last = merged[merged.length - 1];
      if (last && h.x0 <= last.x1) last.x1 = Math.max(last.x1, h.x1);
      else merged.push({ ...h });
    }
    const tone = darken(wall.lit, 0.08);
    let body = rectEl(viewBox.minX, wallTop, viewBox.width, doorTop - wallTop, tone);
    let cursor = viewBox.minX;
    for (const h of merged) {
      if (h.x0 > cursor) body += rectEl(cursor, doorTop, h.x0 - cursor, viewBottom - doorTop, tone);
      // Marco del hueco.
      body += line([h.x0, doorTop], [h.x0, viewBottom], darken(tone, 0.35), 0.9);
      body += line([h.x1, doorTop], [h.x1, viewBottom], darken(tone, 0.35), 0.9);
      body += line([h.x0 - 0.5, doorTop], [h.x1 + 0.5, doorTop], darken(tone, 0.35), 0.9);
      cursor = h.x1;
    }
    if (cursor < viewRight) body += rectEl(cursor, doorTop, viewRight - cursor, viewBottom - doorTop, tone);
    layers.push({
      id: "fourth_wall",
      z: 0,
      kind: "fourth_wall",
      body,
      bbox: [viewBox.minX, wallTop, viewRight, viewBottom],
      baseline_y: viewBottom,
    });
  }

  // ── Orden del pintor (fondo → frente) + salida ────────────────────────────
  layers.sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
  const vb = `${fmt(viewBox.minX)} ${fmt(viewBox.minY)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`;
  const wrap = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;
  const outLayers: StageLayer[] = layers.map((l) => ({
    id: l.id,
    z: l.z,
    kind: l.kind,
    svg: wrap(l.body),
    bbox: l.bbox,
    baseline_y: l.baseline_y,
    ...(l.footprint ? { footprint: l.footprint } : {}),
  }));

  return {
    stage_composer_version: STAGE_COMPOSER_VERSION,
    view_box: viewBox,
    proj,
    bounds,
    layers: outLayers,
    exits,
    svg: wrap(layers.map((l) => `<g id="${l.id}">${l.body}</g>`).join("")),
  };
}

/** Billboard frontal de un volumen (vista desde la cámara sur). Devuelve null
 *  para volúmenes sin representación frontal razonable. */
function buildVolumeLayer(
  v: Volume,
  proj: StageProjParams,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  mpc: number,
  seedKey: string,
  cellsToXStage: (c0: number, w: number) => number,
  cellsToZStage: (r0: number, h: number) => number,
): LayerBuild | null {
  const rng = seededRng(`stage:${seedKey}:${v.id}`);

  // Huella en celdas [c0, r0, w, h] según el tipo.
  let fp: [number, number, number, number];
  switch (v.type) {
    case "building":
      fp = v.rect;
      break;
    case "wall": {
      let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
      for (const [c, r] of v.points) {
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      }
      const half = (v.width ?? 3) / 2;
      fp = [minC - half, minR - half, maxC - minC + 2 * half, maxR - minR + 2 * half];
      break;
    }
    case "tower": {
      const r = v.r ?? 3;
      fp = [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
      break;
    }
    case "gate": {
      const w = v.w ?? 8;
      fp = v.orient === "x" ? [v.at[0] - w / 2, v.at[1] - 1.5, w, 3] : [v.at[0] - 1.5, v.at[1] - w / 2, 3, w];
      break;
    }
    case "tree": {
      const s = v.s ?? 1;
      fp = [v.at[0] - 1.6 * s, v.at[1] - 1.6 * s, 3.2 * s, 3.2 * s];
      break;
    }
    case "bush": {
      const s = v.s ?? 1;
      fp = [v.at[0] - s, v.at[1] - s, 2 * s, 2 * s];
      break;
    }
    case "rock": {
      const s = v.s ?? 1;
      fp = [v.at[0] - 1.2 * s, v.at[1] - 1.2 * s, 2.4 * s, 2.4 * s];
      break;
    }
    case "fountain": {
      const r = v.r ?? 4;
      fp = [v.at[0] - r, v.at[1] - r, 2 * r, 2 * r];
      break;
    }
    case "prop": {
      if (v.rect) fp = v.rect;
      else if (v.at) fp = [v.at[0] - 1, v.at[1] - 1, 2, 2];
      else return null;
      break;
    }
  }

  const xs = cellsToXStage(fp[0], fp[2]);
  const zs = cellsToZStage(fp[1], fp[3]);
  const s = scaleAt(proj, zs);
  const [cx, baseY] = stageToView(proj, xs, zs);
  const wPx = fp[2] * mpc * PX_PER_M * s;
  const m = (meters: number): number => meters * PX_PER_M * s;

  let body = "";
  let topY = baseY;
  const shadow = (rx: number): string =>
    ellipse(cx, baseY, rx, Math.max(1.2, rx * 0.18), "#000000", 'opacity="0.28"');

  switch (v.type) {
    case "building": {
      const wallHM = (v.wall_h ?? 5) * mpc;
      const wall = wallColors(v.walls?.material, v.walls?.color);
      const roof = roofColors(v.roof?.material, v.roof?.color);
      const hPx = m(wallHM);
      body += shadow(wPx * 0.52);
      body += rectEl(cx - wPx / 2, baseY - hPx, wPx, hPx, wall.lit);
      // Puerta frontal centrada + 1-2 ventanas sembradas.
      const doorW = m(0.9);
      const doorH = m(1.9);
      body += rectEl(cx - doorW / 2, baseY - doorH, doorW, doorH, PALETTE.woodFace);
      const nWin = wPx > m(3.5) ? 2 : 1;
      for (let i = 0; i < nWin; i++) {
        const wx = cx + (i === 0 ? -1 : 1) * uniform(rng, wPx * 0.22, wPx * 0.34);
        body += rectEl(wx - m(0.35), baseY - hPx + m(0.6), m(0.7), m(0.7), darken(wall.lit, 0.45));
      }
      // Tejado: triángulo (gable) o banda (flat).
      if ((v.roof?.kind ?? "gable") === "flat" || v.roof?.kind === "none") {
        body += rectEl(cx - wPx / 2 - m(0.2), baseY - hPx - m(0.3), wPx + m(0.4), m(0.3), roof.lit);
        topY = baseY - hPx - m(0.3);
      } else {
        const roofH = m(Math.max(1, wallHM * 0.5));
        body += polygon(
          [
            [cx - wPx / 2 - m(0.3), baseY - hPx],
            [cx, baseY - hPx - roofH],
            [cx + wPx / 2 + m(0.3), baseY - hPx],
          ],
          roof.lit,
        );
        topY = baseY - hPx - roofH;
      }
      break;
    }
    case "wall": {
      const hM = (v.h ?? 5) * mpc;
      const wall = wallColors("stone");
      const hPx = m(hM);
      body += shadow(wPx * 0.5);
      body += rectEl(cx - wPx / 2, baseY - hPx, wPx, hPx, wall.lit);
      if (v.crenellated) {
        const step = m(0.8);
        for (let x = cx - wPx / 2; x < cx + wPx / 2 - 1e-6; x += step * 2) {
          body += rectEl(x, baseY - hPx - m(0.4), Math.min(step, cx + wPx / 2 - x), m(0.4), PALETTE.merlon);
        }
        topY = baseY - hPx - m(0.4);
      } else {
        topY = baseY - hPx;
      }
      body += line([cx - wPx / 2, baseY - hPx * 0.5], [cx + wPx / 2, baseY - hPx * 0.5], wall.joint, 0.4);
      break;
    }
    case "tower": {
      const hM = (v.h ?? 12) * mpc;
      const wall = wallColors("stone");
      const hPx = m(hM);
      const twPx = m((v.r ?? 3) * 2 * mpc);
      body += shadow(twPx * 0.55);
      body += rectEl(cx - twPx / 2, baseY - hPx, twPx, hPx, wall.lit);
      body += ellipse(cx, baseY - hPx, twPx / 2, m(0.5), wall.top);
      topY = baseY - hPx - m(0.5);
      break;
    }
    case "gate": {
      const hM = (v.h ?? 8) * mpc;
      const wall = wallColors("stone");
      const hPx = m(hM);
      body += shadow(wPx * 0.5);
      body += rectEl(cx - wPx / 2, baseY - hPx, wPx, hPx, wall.lit);
      const archW = wPx * 0.44;
      const archH = hPx * 0.7;
      body += rectEl(cx - archW / 2, baseY - archH, archW, archH, "#171219");
      body += ellipse(cx, baseY - archH, archW / 2, archW / 3, "#171219");
      topY = baseY - hPx;
      break;
    }
    case "tree": {
      const sc = v.s ?? 1;
      const trunkH = m(1.6 * sc);
      const canopyR = m(1.7 * sc);
      body += shadow(canopyR * 0.8);
      body += rectEl(cx - m(0.18 * sc), baseY - trunkH, m(0.36 * sc), trunkH, PALETTE.trunk);
      const cyc = baseY - trunkH - canopyR * 0.85;
      body += ellipse(cx, cyc, canopyR, canopyR * 1.05, PALETTE.canopy);
      body += ellipse(
        cx - canopyR * uniform(rng, 0.15, 0.35),
        cyc - canopyR * uniform(rng, 0.1, 0.3),
        canopyR * 0.55,
        canopyR * 0.5,
        PALETTE.canopyLight,
      );
      topY = cyc - canopyR * 1.05;
      break;
    }
    case "bush": {
      const sc = v.s ?? 1;
      const r = m(0.9 * sc);
      body += shadow(r * 0.9);
      body += ellipse(cx, baseY - r * 0.6, r, r * 0.7, PALETTE.canopy);
      body += ellipse(cx - r * 0.3, baseY - r * 0.75, r * 0.5, r * 0.4, PALETTE.canopyLight);
      topY = baseY - r * 1.3;
      break;
    }
    case "rock": {
      const sc = v.s ?? 1;
      const r = m(1.1 * sc);
      body += shadow(r);
      body += polygon(
        [
          [cx - r, baseY],
          [cx - r * 0.6, baseY - r * uniform(rng, 0.6, 0.85)],
          [cx + r * 0.2, baseY - r],
          [cx + r * 0.9, baseY - r * 0.4],
          [cx + r, baseY],
        ],
        PALETTE.stoneTop,
      );
      topY = baseY - r;
      break;
    }
    case "fountain": {
      const rPx = m((v.r ?? 4) * mpc);
      body += shadow(rPx);
      body += ellipse(cx, baseY, rPx, rPx * 0.28, PALETTE.stoneTop);
      body += ellipse(cx, baseY - rPx * 0.12, rPx * 0.8, rPx * 0.2, PALETTE.water);
      body += rectEl(cx - m(0.15), baseY - m(1.4), m(0.3), m(1.4), PALETTE.stoneFace);
      topY = baseY - m(1.4);
      break;
    }
    case "prop": {
      const hM = (v.h ?? 2) * mpc;
      const hPx = m(hM);
      const color = v.color ?? PALETTE.woodTop;
      // Contorno sutil: separa el prop del suelo cuando comparten gama.
      const edge = `stroke="${darken(color, 0.45)}" stroke-width="0.45"`;
      body += shadow(wPx * 0.5);
      if (v.shape === "cylinder") {
        body += rectEl(cx - wPx / 2, baseY - hPx, wPx, hPx, color, edge);
        body += ellipse(cx, baseY - hPx, wPx / 2, m(0.25), lighten(color, 0.15), edge);
      } else {
        body += rectEl(cx - wPx / 2, baseY - hPx, wPx, hPx, color, edge);
        body += line([cx - wPx / 2, baseY - hPx], [cx + wPx / 2, baseY - hPx], lighten(color, 0.2), 0.6);
      }
      topY = baseY - hPx;
      break;
    }
  }

  const halfW = Math.max(wPx / 2, 2);
  return {
    id: `vol_${v.id}`,
    z: zs,
    kind: v.type === "wall" || v.type === "gate" || v.type === "tower" ? "wall" : "prop",
    body,
    bbox: [cx - halfW - 2, topY - 2, cx + halfW + 2, baseY + 3],
    baseline_y: baseY,
    footprint: [
      rect.minX + fp[0] * mpc,
      rect.minZ + fp[1] * mpc,
      rect.minX + (fp[0] + fp[2]) * mpc,
      rect.minZ + (fp[1] + fp[3]) * mpc,
    ],
  };
}
