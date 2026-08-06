/** Builder greybox 3D del plató proscenio — lógica PURA (sin three.js).
 *
 *  Produce un `GreyboxSpec`: la descripción completa de una escena 3D
 *  (primitivas, luces, cielo, cámara) que el cliente renderiza con three.js
 *  como plano base del repintado (bench labs/escenografia/greybox: la vía
 *  clay→gpt-image-2 da la mayor fidelidad de layout). DETERMINISTA: mismo
 *  plan + seedKey ⇒ mismo spec ⇒ mismo `canonicalGreyboxJson` — ese hash es
 *  la clave de caché del repintado (el PNG WebGL NO es byte-determinista y
 *  jamás debe serlo).
 *
 *  Cámara: a nivel de ojo (GREYBOX_EYE_M) — no los 10 m implícitos del
 *  compositor SVG — expresada en el MISMO modelo pinhole de projection.ts:
 *  eyeM = (ground_y − horizon_y)/px_per_m y focal_m = retroceso de la cámara
 *  respecto a la embocadura. La cámara three.js del cliente se DERIVA de
 *  estos números (spec.camera), así `stageToViewAt` y el render coinciden
 *  por construcción: cero calibración de trapecios pintados. */

import { seededRng, uniform } from "../../rng.js";
import { PALETTE, BIOME_COLORS, wallColors, roofColors, darken, lighten } from "../blueprint/palette.js";
import type { Volume } from "../blueprint/volumes.js";
import {
  canonicalGreyboxJson,
  groundColorFor,
  type GreyboxLight,
  type GreyboxPrimitive,
} from "../greybox/common.js";
import { volumeFootprintCells, type StageScenePlan } from "./compose.js";
import { stageToViewAt, type StageProjParams } from "./projection.js";
import { STAGE_RENDER_SIZE, type StageExpectedElement, type ViewBox } from "./segments.js";

export { canonicalGreyboxJson, groundColorFor, type GreyboxLight, type GreyboxPrimitive };

/** Versión del builder: viaja dentro del spec (y por tanto dentro del hash de
 *  caché). Bump ⇒ regeneración de todos los platós en modo imagen.
 *  v2: view_box con ASPECT FIJO — el recorte vertical ceñido de v1 producía
 *  encuadres 5:1 que el prestretch a cuadrado deformaba ×5 (casas como
 *  torres, props como tablones: el modelo pintaba ESA arquitectura). */
export const STAGE_GREYBOX_VERSION = 2;

/** Altura de ojos de la cámara EXTERIOR (m). Los platós del juego son ANCHOS
 *  y POCO profundos (~10 m de fondo): a 1,7-2,2 m el suelo jugable colapsa en
 *  un hilo (foreshortening real). 3,2 m — steadicam alta, aún lectura de
 *  cámara a pie de calle — da banda de suelo sin caer en el picado del
 *  compositor v3 (10 m). */
export const GREYBOX_EYE_M = 3.2;
/** Altura de ojos INTERIOR (m): dentro de una sala de techo 3,2 m la cámara
 *  debe quedar bajo el techo (a 3,2 lo vería de canto y el frame queda negro
 *  encima); 1,8 = la lectura eye-level del bench de la taberna. */
export const GREYBOX_EYE_INTERIOR_M = 1.8;
/** FOV horizontal fijo; el retroceso se deriva del ancho del plató. Focal
 *  CORTA a propósito: acerca la cámara y estira la profundidad percibida de
 *  un plató somero (con 56° el fondo a 10 m apenas convergía). */
export const GREYBOX_HFOV_DEG = 75;

const PX_PER_M = 10;
const GROUND_Y = 100;
const VIEW_MARGIN_X = 8;
const VIEW_BOTTOM_PAD = 10;
const MIN_RETREAT_M = 4;
/** Aspect FIJO del view_box (ancho/alto). El cuadrado de trabajo 1024² lo
 *  estira solo ×1.5 en vertical (rango validado por el prestretch de la
 *  oblicua); el encuadre resultante es el de una cámara real fotografiando
 *  la escena completa — cielo/techo incluidos, como las bases del bench. */
const GREYBOX_VIEW_ASPECT = 2.0;
/** Altura real de las paredes de un interior (m). */
const INTERIOR_WALL_H_M = 3.2;
const DOOR_H_M = 2.1;
const OPENING_H_M = 2.4;

export interface GreyboxManifestItem {
  /** "vol_<id>" — mismo id que la capa equivalente del compositor SVG. */
  id: string;
  label: string;
  /** Huella XZ en metros de MUNDO [minX, minZ, maxX, maxZ]. */
  footprintWorld: [number, number, number, number];
  hM: number;
  /** zStage de la línea de contacto sur (orden del pintor, como layer.z). */
  zStage: number;
  /** Caja proyectada EXACTA en px del cuadrado de trabajo [x, y, w, h]. */
  box_px: [number, number, number, number];
  solid: boolean;
  tall: boolean;
}

export interface GreyboxCamera {
  eye_m: number;
  retreat_m: number;
  /** Posición MUNDO de la cámara (x, y, z). */
  pos: [number, number, number];
  fov_y_deg: number;
  aspect: number;
  /** setViewOffset en unidades de vista: el frame completo es simétrico
   *  respecto al eje óptico (horizonte); la ventana es el view_box. */
  view_offset: { fullW: number; fullH: number; x: number; y: number; w: number; h: number };
}

export interface GreyboxSpec {
  greybox_version: number;
  proj: StageProjParams;
  view_box: ViewBox;
  camera: GreyboxCamera;
  /** Gradiente de cielo (exterior); null = interior (fondo lo dan las paredes). */
  sky: { top: string; bottom: string } | null;
  /** Niebla atmosférica (exterior): distancias DESDE LA CÁMARA en metros. */
  fog: { color: string; near: number; far: number } | null;
  lights: GreyboxLight[];
  primitives: GreyboxPrimitive[];
  manifest: GreyboxManifestItem[];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

export function buildGreyboxSpec(plan: StageScenePlan, seedKey: string): GreyboxSpec {
  const { cols, rows } = plan.size;
  const mpc = plan.size.meters_per_cell;
  if (!(cols > 0) || !(rows > 0) || !(mpc > 0)) {
    throw new Error(`buildGreyboxSpec: size inválido ${JSON.stringify(plan.size)}`);
  }
  const widthM = cols * mpc;
  const depthM = rows * mpc;
  const rect = { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 };
  const interiorLike = plan.stage.fourth_wall?.present === true;
  const eyeM = interiorLike ? GREYBOX_EYE_INTERIOR_M : GREYBOX_EYE_M;
  const horizonY = GROUND_Y - eyeM * PX_PER_M;

  const retreat = Math.max(
    MIN_RETREAT_M,
    (widthM / 2 + VIEW_MARGIN_X / PX_PER_M) / Math.tan(rad(GREYBOX_HFOV_DEG / 2)),
  );
  const proj: StageProjParams = {
    focal_m: retreat,
    depth_m: depthM,
    width_m: widthM,
    px_per_m: PX_PER_M,
    horizon_y: horizonY,
    ground_y: GROUND_Y,
  };

  const floorColor = interiorLike
    ? darken(PALETTE.woodTop, 0.22)
    : (BIOME_COLORS[plan.biome ?? "grass"] ?? PALETTE.grassBase);

  const zoneToWorld = (zone: [number, number, number, number]) => ({
    minX: rect.minX + zone[0] * mpc,
    minZ: rect.minZ + zone[1] * mpc,
    maxX: rect.minX + (zone[0] + zone[2]) * mpc,
    maxZ: rect.minZ + (zone[1] + zone[3]) * mpc,
  });
  /** zStage de la línea SUR de un rango de filas — mismo clamp que compose. */
  const cellsToZStage = (r0: number, h: number): number =>
    Math.min(depthM - 0.05, Math.max(0.05, depthM - (r0 + h) * mpc));

  const primitives: GreyboxPrimitive[] = [];
  const manifest: GreyboxManifestItem[] = [];

  // ── Suelo (a todo el ancho del encuadre + delantal hacia cámara) ──────────
  const floorSpanX = Math.max(widthM * 4, 160);
  const floorBackZ = rect.minZ - (interiorLike ? 0 : 120);
  const floorFrontZ = rect.maxZ + retreat + 4;
  primitives.push({
    shape: "box",
    size: [floorSpanX, 0.1, floorFrontZ - floorBackZ],
    pos: [0, -0.1, (floorBackZ + floorFrontZ) / 2],
    color: floorColor,
    roughness: 0.97,
    cat: "terrain",
    noShadow: true,
  });

  // Bandas de TERRENO de la rejilla Format D (la calle de tierra, el prado…):
  // filas idénticas consecutivas se funden en una banda; dentro, un parche
  // por run de tipo. La última fila (la más cercana a cámara) extiende sus
  // runs por el delantal hasta el borde inferior del encuadre.
  if (plan.terrain && plan.terrain_legend) {
    const grid = plan.terrain;
    let r0 = 0;
    while (r0 < grid.length) {
      let r1 = r0;
      while (r1 + 1 < grid.length && grid[r1 + 1] === grid[r0]) r1++;
      const row = grid[r0];
      const isLast = r1 === grid.length - 1;
      const zNorth = rect.minZ + r0 * mpc;
      const zSouth = isLast ? floorFrontZ : rect.minZ + (r1 + 1) * mpc;
      let c0 = 0;
      while (c0 < row.length) {
        let c1 = c0;
        while (c1 + 1 < row.length && row[c1 + 1] === row[c0]) c1++;
        const type = plan.terrain_legend[row[c0]];
        const color = type ? groundColorFor(type) : null;
        if (color && color !== floorColor) {
          const x0 = rect.minX + c0 * mpc;
          const x1 = rect.minX + (c1 + 1) * mpc;
          primitives.push({
            shape: "box",
            size: [x1 - x0, 0.04, zSouth - zNorth],
            pos: [(x0 + x1) / 2, -0.02, (zNorth + zSouth) / 2],
            color,
            roughness: 0.97,
            cat: "terrain",
            noShadow: true,
          });
        }
        c0 = c1 + 1;
      }
      r0 = r1 + 1;
    }
  }

  // ── Interior: paredes reales con sus vanos; techo bajo ────────────────────
  if (interiorLike) {
    const wall = wallColors("plaster");
    const wallT = 0.18; // grosor
    const sideTone = darken(wall.lit, 0.12);

    /** Segmentos [a,b] de una pared tras restarle los vanos (rangos abiertos). */
    const carve = (full: [number, number], holes: Array<[number, number]>): Array<[number, number]> => {
      const sorted = holes
        .map(([a, b]) => [Math.max(full[0], Math.min(a, b)), Math.min(full[1], Math.max(a, b))] as [number, number])
        .filter(([a, b]) => b - a > 0.01)
        .sort((a, b) => a[0] - b[0]);
      const out: Array<[number, number]> = [];
      let cursor = full[0];
      for (const [a, b] of sorted) {
        if (a - cursor > 0.05) out.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      if (full[1] - cursor > 0.05) out.push([cursor, full[1]]);
      return out;
    };

    /** Dintel sobre un vano (la pared continúa por encima del hueco). */
    const lintel = (
      along: "x" | "z",
      a: number,
      b: number,
      at: number,
      holeH: number,
    ): void => {
      const len = b - a;
      const h = INTERIOR_WALL_H_M - holeH;
      if (h <= 0.02 || len <= 0.02) return;
      primitives.push({
        shape: "box",
        size: along === "x" ? [len, h, wallT] : [wallT, h, len],
        pos: along === "x" ? [(a + b) / 2, holeH, at] : [at, holeH, (a + b) / 2],
        color: along === "x" ? wall.lit : sideTone,
        cat: "wall",
      });
    };

    // Pared del fondo (norte, z = rect.minZ), extendida hasta el borde del
    // encuadre por ambos lados.
    const backHoles: Array<[number, number]> = [];
    for (const e of plan.stage.exits) {
      if (e.edge !== "north") continue;
      const w = zoneToWorld(e.zone);
      if (e.kind === "door") {
        // Puerta pintada: hoja oscura + marco, la pared sigue entera.
        const cx = (w.minX + w.maxX) / 2;
        const dw = Math.max(1.0, Math.min(1.6, w.maxX - w.minX));
        primitives.push({
          shape: "box",
          size: [dw, DOOR_H_M, 0.08],
          pos: [cx, 0, rect.minZ + wallT / 2 + 0.05],
          color: PALETTE.woodFace,
          cat: "wall",
        });
      } else {
        backHoles.push([w.minX, w.maxX]);
        lintel("x", w.minX, w.maxX, rect.minZ, OPENING_H_M);
        // Penumbra de la estancia contigua tras el vano.
        primitives.push({
          shape: "box",
          size: [w.maxX - w.minX + 1.2, OPENING_H_M + 0.4, 0.06],
          pos: [(w.minX + w.maxX) / 2, 0, rect.minZ - 1.2],
          color: "#171219",
          cat: "wall",
          noShadow: true,
        });
      }
    }
    const backSpan: [number, number] = [-floorSpanX / 2, floorSpanX / 2];
    for (const [a, b] of carve(backSpan, backHoles)) {
      primitives.push({
        shape: "box",
        size: [b - a, INTERIOR_WALL_H_M, wallT],
        pos: [(a + b) / 2, 0, rect.minZ],
        color: wall.lit,
        cat: "wall",
      });
    }

    // Paredes laterales (este/oeste) con sus vanos.
    for (const side of [-1, 1] as const) {
      const edge = side < 0 ? "west" : "east";
      const x = side * (widthM / 2);
      const holes: Array<[number, number]> = [];
      for (const e of plan.stage.exits) {
        if (e.edge !== edge) continue;
        const w = zoneToWorld(e.zone);
        if (e.kind === "door") {
          const cz = (w.minZ + w.maxZ) / 2;
          const dw = Math.max(1.0, Math.min(1.6, w.maxZ - w.minZ));
          primitives.push({
            shape: "box",
            size: [0.08, DOOR_H_M, dw],
            pos: [x - side * (wallT / 2 + 0.05), 0, cz],
            color: PALETTE.woodFace,
            cat: "wall",
          });
        } else {
          holes.push([w.minZ, w.maxZ]);
          lintel("z", w.minZ, w.maxZ, x, OPENING_H_M);
          primitives.push({
            shape: "box",
            size: [0.06, OPENING_H_M + 0.4, w.maxZ - w.minZ + 1.2],
            pos: [x + side * 1.2, 0, (w.minZ + w.maxZ) / 2],
            color: "#171219",
            cat: "wall",
            noShadow: true,
          });
        }
      }
      for (const [a, b] of carve([rect.minZ, rect.maxZ], holes)) {
        primitives.push({
          shape: "box",
          size: [wallT, INTERIOR_WALL_H_M, b - a],
          pos: [x, 0, (a + b) / 2],
          color: sideTone,
          cat: "wall",
        });
      }
    }

    // Techo (visible desde abajo) EXTENDIDO hasta la cámara: con el encuadre
    // de aspect fijo la banda alta del frame existe siempre — sin esta
    // extensión quedaría un vacío negro entre el techo de la sala y el borde
    // superior (la cámara está "dentro" del edificio, como en el bench).
    const ceilDepth = depthM + retreat + 2;
    primitives.push({
      shape: "box",
      size: [floorSpanX, 0.12, ceilDepth],
      pos: [0, INTERIOR_WALL_H_M, rect.minZ + ceilDepth / 2],
      // Madera clara: la cara inferior solo recibe ambient/hemi — un tono
      // oscuro se hunde a negro y devora el tercio superior del encuadre.
      color: lighten(PALETTE.woodTop, 0.18),
      cat: "wall",
      noShadow: true,
    });
  } else {
    // ── Exterior: colinas de fondo + caminos de las salidas norte ──────────
    // Colinas LEJANAS y tendidas (media loma, no picos): en v1 una colina a
    // 35 m con h 9 llenaba el telón como una montaña-pirámide.
    const rng = seededRng(`stage:${seedKey}:gbback`);
    for (let i = 0; i < 4; i++) {
      const r = uniform(rng, 45, 90);
      const h = uniform(rng, 2.5, 6);
      const x = uniform(rng, -widthM * 2.5, widthM * 2.5);
      const z = rect.minZ - uniform(rng, 70, 150);
      primitives.push({
        shape: "cone",
        size: [r, h, 24],
        pos: [x, 0, z],
        color: darken("#9db4c6", 0.18 + 0.05 * i),
        roughness: 1,
        cat: "terrain",
        noShadow: true,
      });
    }
    for (const e of plan.stage.exits) {
      if (e.edge !== "north") continue;
      const w = zoneToWorld(e.zone);
      primitives.push({
        shape: "box",
        size: [w.maxX - w.minX, 0.04, 34],
        pos: [(w.minX + w.maxX) / 2, -0.02, rect.minZ - 17],
        color: darken(floorColor, 0.08),
        roughness: 0.97,
        cat: "terrain",
        noShadow: true,
      });
    }
  }

  // ── Volúmenes ─────────────────────────────────────────────────────────────
  for (const v of plan.volumes) {
    buildVolumePrimitives(v, plan, rect, mpc, seedKey, primitives);
  }

  // ── Luces ─────────────────────────────────────────────────────────────────
  const lights: GreyboxLight[] = [];
  const lrng = seededRng(`stage:${seedKey}:light`);
  if (interiorLike) {
    // Interior cálido (posada del bench): ambient alta para que techo y
    // rincones no se hundan a negro, y una clave cálida desde la cuarta
    // pared ausente.
    lights.push({ kind: "ambient", color: "#8a7c6a", intensity: 0.85 });
    lights.push({ kind: "hemi", color: "#a89a86", groundColor: "#6a5c4c", intensity: 0.6 });
    const az = rad(uniform(lrng, -12, 12));
    lights.push({
      kind: "sun",
      color: "#ffd9a8",
      intensity: 1.7,
      pos: [Math.sin(az) * 14, 6.5, rect.maxZ + retreat * 0.6],
      castShadow: true,
    });
  } else {
    lights.push({ kind: "hemi", color: "#bfd4e6", groundColor: "#8a795a", intensity: 0.6 });
    // Sol del suroeste ± variación sembrada, elevación 40°.
    const az = rad(-45 + uniform(lrng, -35, 35));
    const dist = 90;
    lights.push({
      kind: "sun",
      color: "#fff2dd",
      intensity: 2.2,
      pos: [dist * Math.sin(az), dist * Math.tan(rad(40)), dist * Math.cos(az)],
      castShadow: true,
    });
  }

  // ── view_box: aspect FIJO (cámara real, no recorte ceñido) ────────────────
  // El alto sale del ancho: la banda superior es cielo (exterior) o techo
  // (interior, extendido hasta la cámara) — como en las bases del bench.
  const vbMinX = -(widthM / 2) * PX_PER_M - VIEW_MARGIN_X;
  const vbWidth = widthM * PX_PER_M + 2 * VIEW_MARGIN_X;
  const vbHeight = vbWidth / GREYBOX_VIEW_ASPECT;
  const viewBox: ViewBox = {
    minX: vbMinX,
    minY: GROUND_Y + VIEW_BOTTOM_PAD - vbHeight,
    width: vbWidth,
    height: vbHeight,
  };

  // ── Cámara three.js derivada de proj + view_box ───────────────────────────
  const F = PX_PER_M * retreat; // focal en unidades de vista
  const vbMaxX = viewBox.minX + viewBox.width;
  const vbMaxY = viewBox.minY + viewBox.height;
  const halfW = Math.max(Math.abs(viewBox.minX), Math.abs(vbMaxX));
  const halfH = Math.max(Math.abs(horizonY - viewBox.minY), Math.abs(vbMaxY - horizonY));
  const camera: GreyboxCamera = {
    eye_m: eyeM,
    retreat_m: retreat,
    pos: [0, eyeM, rect.maxZ + retreat],
    fov_y_deg: (2 * Math.atan(halfH / F) * 180) / Math.PI,
    aspect: halfW / halfH,
    view_offset: {
      fullW: 2 * halfW,
      fullH: 2 * halfH,
      x: viewBox.minX + halfW,
      y: viewBox.minY - (horizonY - halfH),
      w: viewBox.width,
      h: viewBox.height,
    },
  };

  // ── Manifest por volumen (caja proyectada exacta) ─────────────────────────
  for (const v of plan.volumes) {
    const fp = volumeFootprintCells(v);
    if (!fp) continue;
    const fw: [number, number, number, number] = [
      rect.minX + fp[0] * mpc,
      rect.minZ + fp[1] * mpc,
      rect.minX + (fp[0] + fp[2]) * mpc,
      rect.minZ + (fp[1] + fp[3]) * mpc,
    ];
    const hM = volumeHeightM(v, mpc);
    const zStage = cellsToZStage(fp[1], fp[3]);
    let minVx = Infinity, minVy = Infinity, maxVx = -Infinity, maxVy = -Infinity;
    for (const x of [fw[0], fw[2]]) {
      for (const zWorld of [fw[1], fw[3]]) {
        const zS = Math.max(0.05, rect.maxZ - zWorld);
        for (const h of [0, hM]) {
          const [vx, vy] = stageToViewAt(proj, x, zS, h);
          minVx = Math.min(minVx, vx); maxVx = Math.max(maxVx, vx);
          minVy = Math.min(minVy, vy); maxVy = Math.max(maxVy, vy);
        }
      }
    }
    const toPx = (vx: number, vy: number): [number, number] => [
      ((vx - viewBox.minX) / viewBox.width) * STAGE_RENDER_SIZE,
      ((vy - viewBox.minY) / viewBox.height) * STAGE_RENDER_SIZE,
    ];
    const [x0, y0] = toPx(minVx, minVy);
    const [x1, y1] = toPx(maxVx, maxVy);
    const clamp = (n: number): number => Math.max(0, Math.min(STAGE_RENDER_SIZE, n));
    manifest.push({
      id: `vol_${v.id}`,
      label: v.label,
      footprintWorld: fw,
      hM,
      zStage,
      box_px: [
        Math.round(clamp(x0)),
        Math.round(clamp(y0)),
        Math.round(clamp(x1) - clamp(x0)),
        Math.round(clamp(y1) - clamp(y0)),
      ],
      solid: true,
      tall: true,
    });
  }

  return {
    greybox_version: STAGE_GREYBOX_VERSION,
    proj,
    view_box: viewBox,
    camera,
    sky: interiorLike ? null : { top: "#7593b4", bottom: "#cfd8dc" },
    fog: interiorLike
      ? null
      : { color: "#c3cdd4", near: retreat + depthM * 0.6, far: retreat + depthM + 130 },
    lights,
    primitives,
    manifest,
  };
}

/** Altura total (m) de un volumen — espejo de las alturas que pinta el
 *  compositor SVG (buildVolumeLayer). */
export function volumeHeightM(v: Volume, mpc: number): number {
  switch (v.type) {
    case "building": {
      const wallHM = (v.wall_h ?? 5) * mpc;
      const roofKind = v.roof?.kind ?? "gable";
      return roofKind === "flat" || roofKind === "none"
        ? wallHM + 0.3
        : wallHM + Math.max(1, wallHM * 0.5);
    }
    case "wall":
      return (v.h ?? 5) * mpc + (v.crenellated ? 0.4 : 0);
    case "tower":
      return (v.h ?? 12) * mpc + 0.5;
    case "gate":
      return (v.h ?? 8) * mpc;
    case "tree":
      return (1.6 + 1.7 * 1.9) * (v.s ?? 1); // tronco + copa (≈ SVG)
    case "bush":
      return 1.3 * (v.s ?? 1);
    case "rock":
      return 1.1 * (v.s ?? 1);
    case "fountain":
      return 1.4;
    case "prop":
      return (v.h ?? 2) * mpc;
  }
}

/** Primitivas 3D de un volumen (espejo del billboard del compositor, pero con
 *  volumen real: dos planos de fachada y solape salen gratis del 3D). */
function buildVolumePrimitives(
  v: Volume,
  plan: StageScenePlan,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  mpc: number,
  seedKey: string,
  out: GreyboxPrimitive[],
): void {
  const fp = volumeFootprintCells(v);
  if (!fp) return;
  const rng = seededRng(`stage:${seedKey}:gb:${v.id}`);
  const volId = `vol_${v.id}`;
  const cx = rect.minX + (fp[0] + fp[2] / 2) * mpc;
  const cz = rect.minZ + (fp[1] + fp[3] / 2) * mpc;
  const w = fp[2] * mpc;
  const d = fp[3] * mpc;
  const southZ = rect.minZ + (fp[1] + fp[3]) * mpc;

  const push = (p: Omit<GreyboxPrimitive, "volId" | "cat"> & { cat?: GreyboxPrimitive["cat"] }): void => {
    out.push({ cat: "prop", ...p, volId });
  };

  switch (v.type) {
    case "building": {
      const wallHM = (v.wall_h ?? 5) * mpc;
      const wall = wallColors(v.walls?.material, v.walls?.color);
      const roof = roofColors(v.roof?.material, v.roof?.color);
      push({ shape: "box", size: [w, wallHM, d], pos: [cx, 0, cz], color: wall.lit, cat: "building" });
      // Puerta y ventanas en la fachada sur (cara a cámara).
      push({
        shape: "box",
        size: [0.9, 1.9, 0.08],
        pos: [cx, 0, southZ + 0.05],
        color: PALETTE.woodFace,
        cat: "building",
      });
      const nWin = w > 3.5 ? 2 : 1;
      for (let i = 0; i < nWin; i++) {
        const wx = cx + (i === 0 ? -1 : 1) * uniform(rng, w * 0.22, w * 0.34);
        push({
          shape: "box",
          size: [0.7, 0.7, 0.08],
          pos: [wx, wallHM - 1.3, southZ + 0.05],
          color: darken(wall.lit, 0.45),
          cat: "building",
        });
      }
      const roofKind = v.roof?.kind ?? "gable";
      if (roofKind === "flat" || roofKind === "none") {
        push({
          shape: "box",
          size: [w + 0.4, 0.3, d + 0.4],
          pos: [cx, wallHM, cz],
          color: roof.lit,
          cat: "building",
        });
      } else {
        const roofH = Math.max(1, wallHM * 0.5);
        // Cumbrera a lo largo del lado LARGO (o del axis declarado).
        const axis = v.roof?.axis ?? (w >= d ? "x" : "y");
        push({
          shape: "gable",
          size: axis === "x" ? [d + 0.5, roofH, w + 0.5] : [w + 0.5, roofH, d + 0.5],
          pos: [cx, wallHM, cz],
          rotY: axis === "x" ? Math.PI / 2 : 0,
          color: roof.lit,
          cat: "building",
        });
      }
      break;
    }
    case "wall": {
      const hM = (v.h ?? 5) * mpc;
      const wall = wallColors("stone");
      push({ shape: "box", size: [w, hM, d], pos: [cx, 0, cz], color: wall.lit, cat: "wall" });
      if (v.crenellated) {
        const along = w >= d;
        const span = along ? w : d;
        const step = 1.6;
        const n = Math.min(30, Math.floor(span / step));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.25) * step - span / 2;
          push({
            shape: "box",
            size: [along ? 0.8 : Math.min(0.8, w), 0.4, along ? Math.min(0.8, d) : 0.8],
            pos: along ? [cx + t, hM, cz] : [cx, hM, cz + t],
            color: PALETTE.merlon,
            cat: "wall",
          });
        }
      }
      break;
    }
    case "tower": {
      const hM = (v.h ?? 12) * mpc;
      const r = ((v.r ?? 3) * mpc * 2) / 2;
      const wall = wallColors("stone");
      push({ shape: "cylinder", size: [r, hM], pos: [cx, 0, cz], color: wall.lit, cat: "wall" });
      push({ shape: "cylinder", size: [r * 1.08, 0.5], pos: [cx, hM, cz], color: wall.top, cat: "wall" });
      break;
    }
    case "gate": {
      const hM = (v.h ?? 8) * mpc;
      const wall = wallColors("stone");
      push({ shape: "box", size: [w, hM, d], pos: [cx, 0, cz], color: wall.lit, cat: "wall" });
      // Vano oscuro (arco) en la cara sur.
      const archW = w * 0.44;
      const archH = hM * 0.6;
      push({
        shape: "box",
        size: [archW, archH, 0.1],
        pos: [cx, 0, southZ + 0.06],
        color: "#171219",
        cat: "wall",
      });
      push({
        shape: "cylinder",
        size: [archW / 2, 0.1],
        pos: [cx, archH, southZ + 0.06],
        color: "#171219",
        cat: "wall",
      });
      break;
    }
    case "tree": {
      const s = v.s ?? 1;
      const trunkH = 1.6 * s;
      const canopyR = 1.7 * s;
      push({
        shape: "cylinder",
        size: [0.18 * s, trunkH],
        pos: [cx, 0, cz],
        color: PALETTE.trunk,
        cat: "tree",
      });
      // Copa: cilindro achatado alto (legible como masa de copa en clay).
      push({
        shape: "cone",
        size: [canopyR, canopyR * 2.1, 10],
        pos: [cx, trunkH * 0.8, cz],
        color: PALETTE.canopy,
        cat: "tree",
      });
      break;
    }
    case "bush": {
      const s = v.s ?? 1;
      push({
        shape: "cone",
        size: [0.9 * s, 1.3 * s, 8],
        pos: [cx, 0, cz],
        color: PALETTE.canopy,
        cat: "tree",
      });
      break;
    }
    case "rock": {
      const s = v.s ?? 1;
      push({
        shape: "cone",
        size: [1.1 * s, 1.1 * s, 5],
        pos: [cx, 0, cz],
        rotY: uniform(rng, 0, Math.PI),
        color: PALETTE.stoneTop,
        cat: "prop",
      });
      break;
    }
    case "fountain": {
      const r = (v.r ?? 4) * mpc;
      push({ shape: "cylinder", size: [r, 0.6], pos: [cx, 0, cz], color: PALETTE.stoneTop, cat: "prop" });
      push({
        shape: "cylinder",
        size: [r * 0.8, 0.06],
        pos: [cx, 0.57, cz],
        color: PALETTE.water,
        cat: "water",
        noShadow: true,
      });
      push({ shape: "cylinder", size: [0.15, 1.4], pos: [cx, 0, cz], color: PALETTE.stoneFace, cat: "prop" });
      break;
    }
    case "prop": {
      const hM = (v.h ?? 2) * mpc;
      const color = v.color ?? PALETTE.woodTop;
      if (v.shape === "cylinder") {
        push({ shape: "cylinder", size: [Math.min(w, d) / 2, hM], pos: [cx, 0, cz], color, cat: "prop" });
        push({
          shape: "cylinder",
          size: [Math.min(w, d) / 2, 0.04],
          pos: [cx, hM, cz],
          color: lighten(color, 0.15),
          cat: "prop",
        });
      } else {
        push({ shape: "box", size: [w, hM, d], pos: [cx, 0, cz], color, cat: "prop" });
      }
      break;
    }
  }
}

/** Pistas para la visión (stage_review) desde el manifest del greybox —
 *  mismo contrato que expectedElementsFor (compositor SVG). */
export function expectedElementsFromGreybox(spec: GreyboxSpec): StageExpectedElement[] {
  return spec.manifest.map((m) => ({
    id: m.id,
    label: m.label,
    box_px: m.box_px,
    tall: m.tall,
    solid: m.solid,
  }));
}

