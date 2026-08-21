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
import type { GroundFeature } from "../blueprint/ground.js";
import { groundFeaturePrims } from "../blueprint/ground-prims.js";
import { rotatedRectCorners } from "../blueprint/footprint.js";
import { volumeFootprintCells, volumeHeightM } from "../blueprint/volume-metrics.js";
import { PRACTICAL_LIGHT_RE, timeOfDayFromText, type TimeOfDay } from "../blueprint/time-of-day.js";
import { classifyVolume, customVolumePrims } from "../greybox/volume-prims.js";
import {
  canonicalGreyboxJson,
  groundColorFor,
  type GreyboxLight,
  type GreyboxPrimitive,
} from "../greybox/common.js";
import type { StageBlock } from "./schema.js";
import { stageToViewAt, type StageProjParams } from "./projection.js";
import { STAGE_RENDER_SIZE, type StageExpectedElement, type ViewBox } from "./segments.js";

export { canonicalGreyboxJson, groundColorFor, type GreyboxLight, type GreyboxPrimitive };

/** Versión del builder: viaja dentro del spec (y por tanto dentro del hash de
 *  caché). Bump ⇒ regeneración de todos los platós en modo imagen.
 *  v2: view_box con ASPECT FIJO — el recorte vertical ceñido de v1 producía
 *  encuadres 5:1 que el prestretch a cuadrado deformaba ×5 (casas como
 *  torres, props como tablones: el modelo pintaba ESA arquitectura).
 *  v3 (encuadre de cine): la ventana se coloca por FRACCIÓN sobre el
 *  horizonte (v2 dejaba 75% de cielo en un plató de 32 m — el modelo pintaba
 *  casetas perdidas en un campo), el retroceso respeta `stage.focal_m` como
 *  intención (clampado por cobertura del ancho) y el clay se pinta a aspect
 *  NATIVO (`render_px`) en vez del cuadrado anamórfico ×2.
 *  v4 (luz con intención): presets de hora del día (stage.ambience o
 *  inferida del texto), luces prácticas por label (chimenea/farol/vela) con
 *  point lights y resplandor en el clay, cielo/niebla por preset.
 *  v5 (luz convencional): el sol queda SIEMPRE en el cono frontal (±60° desde
 *  el sur, lado cámara) — los sprites de personajes llevan luz genérica y una
 *  escena a contraluz los deja sin integrar; los atardeceres son laterales
 *  con la cara sur iluminada, nunca silueta.
 *  v6 (escala y encuadre de sala): interior por style_tag ADEMÁS de
 *  fourth_wall (que es opcional); techo declarable por escena
 *  (stage.wall_h_m, default 3,5 m) con INT_CEIL_FRAC 0,32 (el techo deja de
 *  ser losa protagonista); la salvaguarda de volúmenes altos AMPLÍA la
 *  ventana hacia arriba anclando el borde inferior (v5 la trasladaba y
 *  recortaba el delantal) con render_px al aspect real; mobiliario sin `h`
 *  recibe altura SEMÁNTICA por label (prop-heights.ts) — dos mesas de la
 *  misma escena ya no salen a alturas dispares.
 *  v7 (pueblo creíble, bench 07_zocodover): `angle` en building/prop (huella
 *  rotada en colisión, manifest por esquinas rotadas, prims con rotY); capa
 *  `stage.surroundings` (decorado FUERA de bounds con elevación, sin colisión
 *  ni manifest — sustituye a las 4 colinas genéricas); contraste real
 *  tierra/empedrado en groundColorFor; atardecer con relleno hemisférico
 *  cálido (1.45) para que las caras sur no se hundan en negro.
 *  v8 (suelo vectorial): el plató acepta el bloque `ground` del tile
 *  (path/area/water/deck) — calles CURVAS de verdad (Catmull-Rom muestreado,
 *  elipses a 32 segmentos) en metros sobre las bandas de terrain, que quedan
 *  como base. Siluetas: copas esféricas, soportales por label, chimeneas en
 *  el caserío de surroundings. */
export const STAGE_GREYBOX_VERSION = 8;

/** Altura de ojos de la cámara EXTERIOR (m). Los platós del juego son ANCHOS
 *  y POCO profundos (~10 m de fondo): a 1,7-2,2 m el suelo jugable colapsa en
 *  un hilo (foreshortening real). 3,2 m — steadicam alta, aún lectura de
 *  cámara a pie de calle — da banda de suelo sin caer en el picado del
 *  compositor v3 (10 m). */
export const GREYBOX_EYE_M = 3.2;
/** Altura de ojos INTERIOR (m): la cámara debe quedar bien por debajo del
 *  techo (wall_h_m, mínimo 2,2) — a la altura del techo lo vería de canto y
 *  el frame queda negro encima; 1,8 = la lectura eye-level del bench de la
 *  taberna. */
export const GREYBOX_EYE_INTERIOR_M = 1.8;
/** FOV horizontal DEFAULT por modo; el retroceso default se deriva del ancho
 *  del plató con él. `stage.focal_m` (intención del motor narrativo) manda
 *  sobre el default, clampado a [MIN_HFOV, MAX_HFOV] para que la placa siga
 *  cubriendo TODO el ancho (la cámara de raíl panea sobre ella) sin smear de
 *  gran angular en los bordes. */
export const EXT_HFOV_DEG = 84;
export const INT_HFOV_DEG = 96;
const MIN_HFOV_DEG = 70; // retreat máximo (focal_m grande clampa aquí)
const MAX_HFOV_DEG = 100; // retreat mínimo

const PX_PER_M = 10;
const GROUND_Y = 100;
const VIEW_MARGIN_X = 8;
const MIN_RETREAT_M = 4;
/** Aspect del view_box (ancho/alto) por modo y colocación de la ventana:
 *  fracción del alto POR ENCIMA del horizonte (cielo en exterior, techo+pared
 *  en interior). v2 anclaba la ventana al suelo y en platós anchos dejaba el
 *  75% de cielo; v3 la ancla al horizonte — composición de cine con el mundo
 *  jugable dominando el encuadre. El pinhole sigue siendo horizontal: esto es
 *  un desplazamiento de ventana (principal point), no una cámara inclinada. */
const EXT_ASPECT = 2.0;
const INT_ASPECT = 1.6;
const EXT_SKY_FRAC = 0.38;
// v6: 0.44 → 0.32 — con casi la mitad del frame por encima del horizonte el
// techo era una losa protagonista; 0.32 lo deja como cuña de perspectiva en
// el borde superior y el mundo jugable domina el encuadre.
const INT_CEIL_FRAC = 0.32;
/** Lado largo del render nativo que pinta el modelo (el alto sale del
 *  aspect, en múltiplos de 16 para gpt-image-2). */
const RENDER_LONG_PX = 1280;
/** Altura DEFAULT de las paredes de un interior (m) — escala humana de una
 *  taberna. El motor puede declarar `stage.wall_h_m` por escena (choza 2.4,
 *  salón noble 5+); el schema lo acota a [2.2, 8]. */
const INTERIOR_WALL_H_M = 3.5;
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
  /** Tamaño NATIVO [w, h] al que se renderiza y pinta el clay (aspect ==
   *  view_box, sin estirado anamórfico). El cliente lo normaliza a su
   *  cuadrado de trabajo 1024² al RECIBIR la pintura (fetchToSquare):
   *  box_px/SAM/pelado siguen en el cuadrado. */
  render_px: [number, number];
  /** Gradiente de cielo (exterior); null = interior (fondo lo dan las paredes). */
  sky: { top: string; bottom: string } | null;
  /** Niebla atmosférica (exterior): distancias DESDE LA CÁMARA en metros. */
  fog: { color: string; near: number; far: number } | null;
  lights: GreyboxLight[];
  primitives: GreyboxPrimitive[];
  manifest: GreyboxManifestItem[];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Plan de escena de un plató: el bloque `stage` + los volúmenes (declarados
 *  y derivados) en celdas de la escena. */
export interface StageScenePlan {
  size: { cols: number; rows: number; meters_per_cell: number };
  stage: StageBlock;
  /** Volúmenes declarados + derivados (deriveVolumesFromSchema del caller),
   *  en celdas de la escena. */
  volumes: Volume[];
  biome?: string;
  /** Rejilla de terreno Format D (opcional) — el greybox pinta el suelo por
   *  bandas de tipo. Base debajo de `ground`. */
  terrain?: string[];
  terrain_legend?: Record<string, string>;
  /** Rasgos vectoriales del suelo (mismo schema que el tile): calles curvas,
   *  plazas orgánicas, agua/decks — se pintan ENCIMA de las bandas de terrain
   *  y su agua entra en colisión y validación. En celdas de la escena. */
  ground?: GroundFeature[];
  /** scene_description del Format D — fallback del detector de hora del día
   *  cuando el stage no declara `ambience`. */
  description?: string;
  /** Plató interior bajo techo: resuelto por stagePlanFromScene desde
   *  `stage.interior` (con fourth_wall como implicación y el style_tag
   *  legacy de saves viejos como fallback de lectura). */
  interior: boolean;
}

/** Hora del día del plató: la declarada en `stage.ambience`, o inferida del
 *  texto (backdrop + descripción + mood) — "luz de atardecer" en el backdrop
 *  debe atardecer aunque el motor no rellene el campo. Default "dia". */
export function resolveTimeOfDay(plan: StageScenePlan): TimeOfDay {
  const declared = plan.stage.ambience?.time_of_day;
  if (declared) return declared;
  return timeOfDayFromText(
    [
      plan.stage.backdrop?.description ?? "",
      plan.description ?? "",
      plan.stage.ambience?.mood ?? "",
    ].join(" "),
  );
}

/** Labels de edificio que ganan soportal (columnas + alero en la fachada). */
const PORCH_LABEL_RE = /soportal|p[oó]rtico|porche|arcada|logia/i;

export function buildGreyboxSpec(plan: StageScenePlan, seedKey: string): GreyboxSpec {
  const { cols, rows } = plan.size;
  const mpc = plan.size.meters_per_cell;
  if (!(cols > 0) || !(rows > 0) || !(mpc > 0)) {
    throw new Error(`buildGreyboxSpec: size inválido ${JSON.stringify(plan.size)}`);
  }
  const widthM = cols * mpc;
  const depthM = rows * mpc;
  const rect = { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 };
  // Interior resuelto por stagePlanFromScene (`stage.interior` con
  // fourth_wall como implicación): un interior no debe salir con cielo,
  // colinas y ojo de exterior (3,2 m).
  const interiorLike = plan.interior;
  const eyeM = interiorLike ? GREYBOX_EYE_INTERIOR_M : GREYBOX_EYE_M;
  const horizonY = GROUND_Y - eyeM * PX_PER_M;

  // Retroceso: `stage.focal_m` es la INTENCIÓN de distancia de cámara del
  // motor narrativo (22 sala íntima … 30+ plano general), clampada para que
  // el frame cubra el ancho completo sin pasar de gran angular.
  const halfWM = widthM / 2 + VIEW_MARGIN_X / PX_PER_M;
  const hfovDefault = interiorLike ? INT_HFOV_DEG : EXT_HFOV_DEG;
  const rDefault = halfWM / Math.tan(rad(hfovDefault / 2));
  const rMin = halfWM / Math.tan(rad(MAX_HFOV_DEG / 2));
  const rMax = halfWM / Math.tan(rad(MIN_HFOV_DEG / 2));
  const retreat = Math.max(
    MIN_RETREAT_M,
    Math.min(rMax, Math.max(rMin, plan.stage.focal_m ?? rDefault)),
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

  // ── Rasgos vectoriales del suelo (v8): calles curvas, plazas orgánicas,
  // agua/decks ENCIMA de las bandas de terrain (que coronan en +0.02). Mismo
  // helper que el tile, aquí en METROS con suavizado Catmull-Rom. ───────────
  if (plan.ground?.length) {
    primitives.push(
      ...groundFeaturePrims(plan.ground, {
        toXZ: (u, v) => [rect.minX + u * mpc, rect.minZ + v * mpc],
        scale: mpc,
        yArea: 0.03,
        yPath: 0.05,
        yWater: 0.07,
        yDeck: 0.09,
        layerT: 0.03,
        // Pareja de contraste del plató (contrato del test tierra≠empedrado).
        colors: { dirt: "#8d6f4e", cobble: "#a4937c" },
        smoothPathSubdiv: 4,
        ellipseSegments: 32,
      }),
    );
  }

  /** Caminos que continúan las salidas norte más allá del telón (exterior). */
  const emitNorthExitPaths = (): void => {
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
  };

  // ── Interior: paredes reales con sus vanos; techo a escala de la sala ─────
  if (interiorLike) {
    const wall = wallColors("plaster");
    const wallT = 0.18; // grosor
    const sideTone = darken(wall.lit, 0.12);
    // Altura de sala declarada por el motor (wall_h_m) o default de taberna.
    const wallHM = plan.stage.wall_h_m ?? INTERIOR_WALL_H_M;

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
      const h = wallHM - holeH;
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
        size: [b - a, wallHM, wallT],
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
          size: [wallT, wallHM, b - a],
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
      pos: [0, wallHM, rect.minZ + ceilDepth / 2],
      // Madera clara: la cara inferior solo recibe ambient/hemi — un tono
      // oscuro se hunde a negro y devora el tercio superior del encuadre.
      color: lighten(PALETTE.woodTop, 0.18),
      cat: "wall",
      noShadow: true,
    });
  } else if (plan.stage.surroundings?.length) {
    // ── Exterior con DECORADO DECLARADO: el motor dice qué hay más allá de
    // los bounds (caserío, cerro con su castillo, tapias, árboles) — pura
    // escenografía: sin volId, sin manifest, sin colisión. Sustituye a las
    // colinas genéricas del else de abajo.
    const srng = seededRng(`stage:${seedKey}:gbsur`);
    for (const s of plan.stage.surroundings) {
      const [sx, sz] = s.pos;
      const yBase = "y_base" in s ? (s.y_base ?? 0) : 0;
      const rotY = "angle" in s && s.angle ? (s.angle * Math.PI) / 180 : undefined;
      switch (s.kind) {
        case "hill":
          primitives.push({
            shape: "cone",
            size: [s.r, s.h, 24],
            pos: [sx, 0, sz],
            color: s.color ?? darken("#8a744f", uniform(srng, 0.05, 0.2)),
            roughness: 1,
            cat: "terrain",
            noShadow: true,
          });
          break;
        case "house": {
          const tone = uniform(srng, -0.1, 0.08);
          const wallC = wallColors("plaster").lit;
          const wall = s.wall_color ?? (tone >= 0 ? lighten(wallC, tone) : darken(wallC, -tone));
          const roof = s.roof_color ?? darken(roofColors("tile").lit, uniform(srng, 0, 0.15));
          const wallH = s.h * 0.72;
          primitives.push({
            shape: "box",
            size: [s.w, wallH, s.d],
            pos: [sx, yBase, sz],
            rotY,
            color: wall,
            cat: "decor",
          });
          primitives.push({
            shape: "gable",
            // Cumbrera a lo largo del lado largo (contrato: a lo largo de d
            // antes de rotY ⇒ lado largo en d con giro extra si hace falta).
            size: s.w >= s.d ? [s.d, s.h - wallH, s.w] : [s.w, s.h - wallH, s.d],
            pos: [sx, yBase + wallH, sz],
            rotY: (rotY ?? 0) + (s.w >= s.d ? Math.PI / 2 : 0),
            color: roof,
            cat: "decor",
          });
          // Chimenea sembrada (v8): la silueta del caserío lejano cobra vida
          // — caja, no cono (el test de colinas cuenta conos lejanos).
          if (uniform(srng, 0, 1) < 0.6) {
            const chAngle = "angle" in s && s.angle ? (s.angle * Math.PI) / 180 : 0;
            const chDx = uniform(srng, -s.w * 0.3, s.w * 0.3);
            const [rdx, rdz] = [
              chDx * Math.cos(chAngle),
              -chDx * Math.sin(chAngle),
            ];
            primitives.push({
              shape: "box",
              size: [0.5, s.h * 0.22, 0.5],
              pos: [sx + rdx, yBase + wallH + (s.h - wallH) * 0.5, sz + rdz],
              color: darken(wall, 0.15),
              cat: "decor",
            });
          }
          break;
        }
        case "tower": {
          const r = s.r ?? 3;
          const h = s.h ?? 12;
          const stoneC = wallColors("stone").lit;
          primitives.push({
            shape: "cylinder",
            size: [r, h],
            pos: [sx, yBase, sz],
            color: lighten(stoneC, uniform(srng, 0, 0.08)),
            cat: "decor",
          });
          primitives.push({
            shape: "cylinder",
            size: [r * 1.1, h * 0.06],
            pos: [sx, yBase + h, sz],
            color: wallColors("stone").top,
            cat: "decor",
          });
          // Parapeto almenado: sin él la torre lee como silo/torre de
          // refrigeración — la silueta medieval es el 90% del landmark.
          const merlons = 8;
          for (let mi = 0; mi < merlons; mi++) {
            const a = (mi / merlons) * Math.PI * 2;
            primitives.push({
              shape: "box",
              size: [Math.max(0.5, r * 0.32), h * 0.08, Math.max(0.5, r * 0.32)],
              pos: [sx + Math.cos(a) * r * 0.92, yBase + h + h * 0.06, sz + Math.sin(a) * r * 0.92],
              color: PALETTE.merlon,
              cat: "decor",
            });
          }
          break;
        }
        case "wall":
          primitives.push({
            shape: "box",
            size: [s.len, s.h ?? 4, 1.4],
            pos: [sx, yBase, sz],
            rotY,
            color: darken(wallColors("stone").lit, uniform(srng, 0, 0.1)),
            cat: "decor",
          });
          break;
        case "tree": {
          const sc = s.s ?? 1;
          primitives.push({
            shape: "cylinder",
            size: [0.2 * sc, 1.7 * sc],
            pos: [sx, yBase, sz],
            color: PALETTE.trunk,
            cat: "decor",
          });
          primitives.push({
            shape: "sphere",
            size: [1.8 * sc, 12],
            pos: [sx, yBase + 1.3 * sc, sz],
            color: darken(PALETTE.canopy, uniform(srng, 0, 0.12)),
            cat: "decor",
          });
          break;
        }
      }
    }
    emitNorthExitPaths();
  } else {
    // ── Exterior SIN decorado declarado: colinas de fondo genéricas ────────
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
    emitNorthExitPaths();
  }

  // ── Volúmenes ─────────────────────────────────────────────────────────────
  for (const v of plan.volumes) {
    buildVolumePrimitives(v, plan, rect, mpc, seedKey, primitives);
  }

  // ── Luces: preset por HORA DEL DÍA + prácticas por label ─────────────────
  const tod = resolveTimeOfDay(plan);
  const lights: GreyboxLight[] = [];
  const lrng = seededRng(`stage:${seedKey}:light`);
  if (interiorLike) {
    // Interior cálido (posada del bench): ambient alta para que techo y
    // rincones no se hundan a negro, y una clave desde la cuarta pared
    // ausente cuyo color sigue la hora (la "ventana" del set).
    const key = { amanecer: "#ffe0b0", dia: "#ffd9a8", atardecer: "#ffbe82", noche: "#7a8cb8" }[tod];
    const keyIntensity = tod === "noche" ? 0.8 : 1.7;
    lights.push({ kind: "ambient", color: "#8a7c6a", intensity: tod === "noche" ? 0.7 : 0.85 });
    lights.push({ kind: "hemi", color: "#a89a86", groundColor: "#6a5c4c", intensity: 0.6 });
    const az = rad(uniform(lrng, -12, 12));
    lights.push({
      kind: "sun",
      color: key,
      intensity: keyIntensity,
      pos: [Math.sin(az) * 14, 6.5, rect.maxZ + retreat * 0.6],
      castShadow: true,
    });
  } else {
    // Sol/luna por preset: elevación y color cuentan la hora; el azimut
    // sembrado da variedad entre platós PERO siempre dentro del cono FRONTAL
    // (±60° desde el sur, lado cámara): los sprites de personajes llevan luz
    // genérica y un set a contraluz los deja sin integrar. Los atardeceres
    // son laterales-frontales (cara sur iluminada), nunca silueta.
    const preset = {
      amanecer: { sun: "#ffd9a0", elev: 18, azBase: 55, intensity: 2.2, hemi: "#a8b4cc", ground: "#7a6a58", hemiI: 0.9 },
      dia: { sun: "#fff2dd", elev: 40, azBase: -45, intensity: 2.2, hemi: "#bfd4e6", ground: "#8a795a", hemiI: 0.6 },
      // Atardecer con RELLENO (bench 07_zocodover): hemi violácea intensa con
      // suelo cálido — sin ella las caras sur (todas, con el sol frontal bajo)
      // y el tercio del delantal se hunden a negro.
      atardecer: { sun: "#ffb36b", elev: 18, azBase: -55, intensity: 2.4, hemi: "#9a86a0", ground: "#8a6a4a", hemiI: 1.45 },
      noche: { sun: "#9ab0d8", elev: 50, azBase: -30, intensity: 0.9, hemi: "#4a5878", ground: "#2e3040", hemiI: 0.8 },
    }[tod];
    lights.push({ kind: "hemi", color: preset.hemi, groundColor: preset.ground, intensity: preset.hemiI });
    if (tod === "noche") lights.push({ kind: "ambient", color: "#30405c", intensity: 0.4 });
    const FRONT_CONE_DEG = 60;
    const az = rad(
      Math.max(-FRONT_CONE_DEG, Math.min(FRONT_CONE_DEG, preset.azBase + uniform(lrng, -10, 10))),
    );
    const dist = 90;
    lights.push({
      kind: "sun",
      color: preset.sun,
      intensity: preset.intensity,
      pos: [dist * Math.sin(az), dist * Math.tan(rad(preset.elev)), dist * Math.cos(az)],
      castShadow: true,
    });
  }
  // Luces prácticas: un volumen etiquetado como fuego/farol/vela enciende un
  // punto cálido encima (y un pequeño resplandor en el clay) — la chimenea
  // del bench como sistema. Cap 6 por plató.
  let practicals = 0;
  for (const v of plan.volumes) {
    if (practicals >= 6 || !PRACTICAL_LIGHT_RE.test(v.label)) continue;
    const fp = volumeFootprintCells(v);
    if (!fp) continue;
    const px = rect.minX + (fp[0] + fp[2] / 2) * mpc;
    const pz = rect.minZ + (fp[1] + fp[3] / 2) * mpc;
    const hM = volumeHeightM(v, mpc);
    const py = Math.min(Math.max(hM * 0.6, 0.5), 2.2);
    lights.push({
      kind: "point",
      color: "#ff9b4a",
      intensity: interiorLike ? 18 : 12,
      pos: [px, py, pz],
      distance: 9,
      decay: 1.8,
    });
    // Resplandor visible en el clay (la "ascua" del bench): el modelo de
    // imagen lo lee como fuego/farol encendido y pinta la fuente de luz.
    primitives.push({
      shape: "box",
      size: [0.35, 0.5, 0.35],
      pos: [px, Math.max(0.05, py - 0.45), pz],
      color: "#ffa04e",
      cat: "prop",
      volId: `vol_${v.id}`,
      noShadow: true,
    });
    practicals++;
  }

  // ── view_box: ventana colocada por FRACCIÓN sobre el horizonte ────────────
  // Aspect fijo por modo; la banda superior (cielo o techo) queda acotada y
  // el mundo jugable domina el encuadre. Salvaguarda: si un volumen alto
  // sobresale de la ventana, se abre hacia arriba para no decapitarlo.
  const vbMinX = -(widthM / 2) * PX_PER_M - VIEW_MARGIN_X;
  const vbWidth = widthM * PX_PER_M + 2 * VIEW_MARGIN_X;
  const vbAspect = interiorLike ? INT_ASPECT : EXT_ASPECT;
  const vbHeightBase = vbWidth / vbAspect;
  let vbMinY = horizonY - (interiorLike ? INT_CEIL_FRAC : EXT_SKY_FRAC) * vbHeightBase;
  // El borde INFERIOR queda FIJO: la salvaguarda de volúmenes altos amplía la
  // ventana hacia arriba (crece height), nunca la traslada — trasladarla
  // recortaba suelo y delantal por abajo (cartel de salida decapitado).
  const vbMaxY = vbMinY + vbHeightBase;
  // Tope superior de los volúmenes en vista (proyección pura, sin view_box).
  let minTopVy = Infinity;
  for (const v of plan.volumes) {
    const fp = volumeFootprintCells(v);
    if (!fp) continue;
    const hM = volumeHeightM(v, mpc);
    for (const x of [rect.minX + fp[0] * mpc, rect.minX + (fp[0] + fp[2]) * mpc]) {
      for (const zWorld of [rect.minZ + fp[1] * mpc, rect.minZ + (fp[1] + fp[3]) * mpc]) {
        const zS = Math.max(0.05, rect.maxZ - zWorld);
        minTopVy = Math.min(minTopVy, stageToViewAt(proj, x, zS, hM)[1]);
      }
    }
  }
  if (Number.isFinite(minTopVy)) vbMinY = Math.min(vbMinY, minTopVy - 6);
  const vbHeight = vbMaxY - vbMinY;
  const viewBox: ViewBox = {
    minX: vbMinX,
    minY: vbMinY,
    width: vbWidth,
    height: vbHeight,
  };
  // Render nativo: aspect REAL del view_box (puede ser más alto que el base
  // si la salvaguarda amplió la ventana), múltiplos de 16 — un aspect
  // constante con height variable pintaría anamórfico (lección de v2).
  const renderPx: [number, number] = [
    RENDER_LONG_PX,
    Math.round((RENDER_LONG_PX * vbHeight) / vbWidth / 16) * 16,
  ];

  // ── Cámara three.js derivada de proj + view_box ───────────────────────────
  const F = PX_PER_M * retreat; // focal en unidades de vista
  const vbMaxX = viewBox.minX + viewBox.width;
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
    // Con `angle` la caja proyectada sale de las 4 esquinas ROTADAS del rect
    // (el AABB daría una caja engordada); sin angle, las del AABB — idéntico.
    const hasAngle =
      (v.type === "building" || v.type === "prop") && v.rect && v.angle ? true : false;
    const cornersCells: [number, number][] = hasAngle
      ? rotatedRectCorners(
          (v as { rect: [number, number, number, number] }).rect,
          (v as { angle: number }).angle,
        )
      : [
          [fp[0], fp[1]],
          [fp[0] + fp[2], fp[1]],
          [fp[0] + fp[2], fp[1] + fp[3]],
          [fp[0], fp[1] + fp[3]],
        ];
    let minVx = Infinity, minVy = Infinity, maxVx = -Infinity, maxVy = -Infinity;
    for (const [cu, cv] of cornersCells) {
      const x = rect.minX + cu * mpc;
      const zWorld = rect.minZ + cv * mpc;
      const zS = Math.max(0.05, rect.maxZ - zWorld);
      for (const h of [0, hM]) {
        const [vx, vy] = stageToViewAt(proj, x, zS, h);
        minVx = Math.min(minVx, vx); maxVx = Math.max(maxVx, vx);
        minVy = Math.min(minVy, vy); maxVy = Math.max(maxVy, vy);
      }
    }
    const toPx = (vx: number, vy: number): [number, number] => [
      ((vx - viewBox.minX) / viewBox.width) * STAGE_RENDER_SIZE,
      ((vy - viewBox.minY) / viewBox.height) * STAGE_RENDER_SIZE,
    ];
    const [x0, y0] = toPx(minVx, minVy);
    const [x1, y1] = toPx(maxVx, maxVy);
    const clamp = (n: number): number => Math.max(0, Math.min(STAGE_RENDER_SIZE, n));
    // solid/tall por TIPO (classifyVolume, la misma semántica del clasificador
    // de visión y de volumeCollisionGrid) — no `true/true` a ciegas: una
    // alfombra (`prop passable`) o un arbusto pintados no deben volverse
    // colisión sólida ni occluder alto al casarse en el stage_review.
    const { solid, tall } = classifyVolume(v);
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
      solid,
      tall,
    });
  }

  return {
    greybox_version: STAGE_GREYBOX_VERSION,
    proj,
    view_box: viewBox,
    camera,
    render_px: renderPx,
    sky: interiorLike
      ? null
      : {
          // Horizontes SUAVES: un cielo-ascua tras el set lee como contraluz
          // aunque el sol venga de cámara (y los sprites no lo llevarían).
          amanecer: { top: "#7a88aa", bottom: "#e4cca8" },
          dia: { top: "#7593b4", bottom: "#cfd8dc" },
          atardecer: { top: "#6a6488", bottom: "#d8ac84" },
          noche: { top: "#101828", bottom: "#2e3e5e" },
        }[tod],
    fog: interiorLike
      ? null
      : {
          color: { amanecer: "#d8c8b0", dia: "#c3cdd4", atardecer: "#c39a74", noche: "#223048" }[tod],
          near: retreat + depthM * 0.6,
          far: retreat + depthM + 130,
        },
    lights,
    primitives,
    manifest,
  };
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
  // Marco LOCAL (angle de building/prop-rect): `fp` es el AABB (expandido al
  // rotar) — la GEOMETRÍA usa las dimensiones reales del rect y offsets
  // locales girados con `rot()`; los sub-prims heredan rotY = angleRad. La
  // rotación preserva el centro, así que cx/cz sirven tal cual. Con angle 0
  // todo es identidad y los prims son idénticos a los de siempre.
  const angleDeg = (v.type === "building" || v.type === "prop") && v.rect ? (v.angle ?? 0) : 0;
  const angleRad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  const rot = (dx: number, dz: number): [number, number] =>
    angleDeg ? [dx * ca + dz * sa, -dx * sa + dz * ca] : [dx, dz];
  /** rotY a emitir: undefined cuando 0 (se cae del canónico — caché estable). */
  const rotYOr = (extra = 0): number | undefined => {
    const total = angleRad + extra;
    return total === 0 ? undefined : total;
  };
  const rectDims =
    angleDeg && (v.type === "building" || v.type === "prop") && v.rect ? v.rect : null;
  const w = (rectDims ? rectDims[2] : fp[2]) * mpc;
  const d = (rectDims ? rectDims[3] : fp[3]) * mpc;
  const southZ = rect.minZ + (fp[1] + fp[3]) * mpc;

  const push = (p: Omit<GreyboxPrimitive, "volId" | "cat"> & { cat?: GreyboxPrimitive["cat"] }): void => {
    out.push({ cat: "prop", ...p, volId });
  };

  switch (v.type) {
    case "building": {
      const wallHM = (v.wall_h ?? 5) * mpc;
      // Variación de tono sembrada por edificio: dos casas iguales del plan
      // dejan de ser gemelas clónicas (el modelo pintaba ESA monotonía).
      const tone = uniform(rng, -0.08, 0.08);
      const baseWall = wallColors(v.walls?.material, v.walls?.color);
      const baseRoof = roofColors(v.roof?.material, v.roof?.color);
      const wall = {
        lit: tone >= 0 ? lighten(baseWall.lit, tone) : darken(baseWall.lit, -tone),
        top: baseWall.top,
      };
      const roofTone = uniform(rng, -0.07, 0.07);
      const roof = {
        lit: roofTone >= 0 ? lighten(baseRoof.lit, roofTone) : darken(baseRoof.lit, -roofTone),
      };
      push({
        shape: "box",
        size: [w, wallHM, d],
        pos: [cx, 0, cz],
        rotY: rotYOr(),
        color: wall.lit,
        cat: "building",
      });
      // Puerta en la fachada sur (cara a cámara), descentrada y sembrada.
      // Offsets LOCALES a la fachada (d/2 + 0.05 == southZ + 0.05 sin angle).
      const doorDx = uniform(rng, -w * 0.28, w * 0.28);
      const [pdx, pdz] = rot(doorDx, d / 2 + 0.05);
      push({
        shape: "box",
        size: [0.9, 1.9, 0.08],
        pos: [cx + pdx, 0, cz + pdz],
        rotY: rotYOr(),
        color: PALETTE.woodFace,
        cat: "building",
      });
      // Soportal por label (v8, patrón del mesón del bench 07_zocodover):
      // fila de columnas delante de la fachada sur + alero. Ancho 0.45 — el
      // test F2 identifica ventanas por size[0]===0.7, no pisar ese valor.
      if (PORCH_LABEL_RE.test(v.label)) {
        const colH = Math.min(3.0, wallHM * 0.8);
        const nCols = Math.max(3, Math.min(9, Math.round(w / 2.2) + 1));
        for (let i = 0; i < nCols; i++) {
          const dx = ((i / (nCols - 1)) - 0.5) * (w - 1.0);
          const [cxr, czr] = rot(dx, d / 2 + 1.4);
          push({
            shape: "box",
            size: [0.45, colH, 0.45],
            pos: [cx + cxr, 0, cz + czr],
            rotY: rotYOr(),
            color: darken(wall.lit, 0.08),
            cat: "building",
          });
        }
        const [adx, adz] = rot(0, d / 2 + 0.95);
        push({
          shape: "box",
          size: [w * 0.97, 0.3, 1.8],
          pos: [cx + adx, colH, cz + adz],
          rotY: rotYOr(),
          color: darken(roof.lit, 0.1),
          cat: "building",
        });
      }
      // Ventanas por PLANTA: una fila por cada ~2.4 m de muro (v2 ponía 1-2
      // ventanas fijas arriba — una casa de dos plantas leía como nave ciega).
      const nFloors = Math.max(1, Math.floor(wallHM / 2.4));
      const winPerFloor = Math.max(1, Math.min(4, Math.round(w / 2.6)));
      const winColor = darken(wall.lit, 0.45);
      for (let f = 0; f < nFloors; f++) {
        const wy = f === 0 ? Math.min(wallHM - 1.1, 1.3) : 1.1 + f * 2.4;
        if (wy + 0.9 > wallHM - 0.1) break;
        for (let i = 0; i < winPerFloor; i++) {
          const wdx = ((i + 0.5) / winPerFloor - 0.5) * w * 0.82 + uniform(rng, -0.12, 0.12);
          if (f === 0 && Math.abs(wdx - doorDx) < 0.9) continue; // no pisar la puerta
          const [wxr, wzr] = rot(wdx, d / 2 + 0.05);
          push({
            shape: "box",
            size: [0.7, 0.9, 0.08],
            pos: [cx + wxr, wy, cz + wzr],
            rotY: rotYOr(),
            color: winColor,
            cat: "building",
          });
        }
      }
      const roofKind = v.roof?.kind ?? "gable";
      if (roofKind === "flat" || roofKind === "none") {
        push({
          shape: "box",
          size: [w + 0.4, 0.3, d + 0.4],
          pos: [cx, wallHM, cz],
          rotY: rotYOr(),
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
          rotY: angleRad + (axis === "x" ? Math.PI / 2 : 0),
          color: roof.lit,
          cat: "building",
        });
        // Chimenea sembrada (2 de cada 3 edificios): silueta de tejado viva.
        if (uniform(rng, 0, 1) < 0.67) {
          const chDx = uniform(rng, -w * 0.3, w * 0.3);
          const chDz = uniform(rng, -d * 0.2, d * 0.2);
          const [cxr, czr] = rot(chDx, chDz);
          push({
            shape: "box",
            size: [0.5, roofH + 0.9, 0.5],
            pos: [cx + cxr, wallHM, cz + czr],
            rotY: rotYOr(),
            color: darken(wall.lit, 0.12),
            cat: "building",
          });
        }
      }
      break;
    }
    case "wall": {
      // Una caja por TRAMO de la polilínea (como el tile, volumePartsForTile),
      // no una única caja del AABB: un muro diagonal o en L tenía un AABB
      // gigante que tapaba medio plató mientras la colisión (markBand por
      // segmento) dejaba pasar. Cada tramo se orienta con su rotY.
      const hM = (v.h ?? 5) * mpc;
      const widthM = (v.width ?? 3) * mpc;
      const wall = wallColors("stone");
      const pts = v.points as [number, number][];
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = rect.minX + pts[i][0] * mpc;
        const az = rect.minZ + pts[i][1] * mpc;
        const bx = rect.minX + pts[i + 1][0] * mpc;
        const bz = rect.minZ + pts[i + 1][1] * mpc;
        const clen = Math.hypot(bx - ax, bz - az);
        if (clen < 1e-6) continue;
        const segRotY = -Math.atan2(bz - az, bx - ax);
        // +widthM en largo: media anchura por extremo, para juntar esquinas.
        push({
          shape: "box",
          size: [clen + widthM, hM, widthM],
          pos: [(ax + bx) / 2, 0, (az + bz) / 2],
          rotY: segRotY,
          color: wall.lit,
          cat: "wall",
        });
        if (v.crenellated) {
          const ux = (bx - ax) / clen;
          const uz = (bz - az) / clen;
          const step = 1.6;
          const n = Math.min(30, Math.floor(clen / step));
          for (let k = 0; k < n; k++) {
            const t = (k + 0.25) * step;
            push({
              shape: "box",
              size: [0.8, 0.4, Math.min(0.8, widthM)],
              pos: [ax + ux * t, hM, az + uz * t],
              rotY: segRotY,
              color: PALETTE.merlon,
              cat: "wall",
            });
          }
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
      // Copa ESFÉRICA (v8): el cono leía como ciprés/abeto siempre — la masa
      // redonda es el árbol genérico del bench.
      push({
        shape: "sphere",
        size: [canopyR * 1.05, 14],
        pos: [cx, trunkH * 0.7, cz],
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
      const label = v.label.toLowerCase();
      // Tres heurísticas de silueta (solo las que el modelo confundía de
      // verdad: una caja llamada "mesa" pintaba un arcón; una llamada "carro"
      // pintaba un portón). El resto: caja/cilindro del TAMAÑO declarado —
      // el tamaño correcto es el 80% del valor.
      if (v.shape !== "cylinder" && /\bmesa|banco\b/.test(label) && w >= 0.8 && d >= 0.4) {
        // Tablero + patas: silueta inequívoca de mueble.
        const topH = Math.max(0.06, hM * 0.1);
        const legH = hM - topH;
        push({
          shape: "box",
          size: [w, topH, d],
          pos: [cx, legH, cz],
          rotY: rotYOr(),
          color,
          cat: "prop",
        });
        const legR = 0.06;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const [lx, lz] = rot(sx * (w / 2 - 0.12), sz * (d / 2 - 0.12));
            push({
              shape: "box",
              size: [legR * 2, legH, legR * 2],
              pos: [cx + lx, 0, cz + lz],
              color: darken(color, 0.15),
              cat: "prop",
            });
          }
        }
      } else if (v.shape !== "cylinder" && /carro|carreta/.test(label) && w >= 1) {
        // Caja del carro elevada + dos ruedas: deja de leer como portón.
        const boxH = hM * 0.5;
        const wheelR = Math.min(0.55, hM * 0.4);
        push({
          shape: "box",
          size: [w, boxH, d * 0.85],
          pos: [cx, wheelR * 0.9, cz],
          rotY: rotYOr(),
          color,
          cat: "prop",
        });
        const along = w >= d;
        for (const s of [-1, 1]) {
          const [wxr, wzr] = along
            ? rot(s * w * 0.28, d * 0.35)
            : rot(w * 0.35, s * d * 0.28);
          push({
            shape: "cylinder",
            size: [wheelR, 0.12],
            // rotX tumba el cilindro sobre su base: el centro del disco queda
            // en pos.y — a la altura del radio para que apoye en el suelo.
            // El eje de la rueda no puede seguir el yaw del carro (rotX+rotY
            // componen Rx·Ry, y el pre-giro Y de un cilindro es invisible):
            // con angle ≤ ~30° el disco desviado no se aprecia.
            pos: [cx + wxr, wheelR, cz + wzr],
            rotX: Math.PI / 2,
            color: darken(color, 0.25),
            cat: "prop",
          });
        }
      } else if (v.shape === "cylinder") {
        push({ shape: "cylinder", size: [Math.min(w, d) / 2, hM], pos: [cx, 0, cz], color, cat: "prop" });
        push({
          shape: "cylinder",
          size: [Math.min(w, d) / 2, 0.04],
          pos: [cx, hM, cz],
          color: lighten(color, 0.15),
          cat: "prop",
        });
      } else {
        push({
          shape: "box",
          size: [w, hM, d],
          pos: [cx, 0, cz],
          rotY: rotYOr(),
          color,
          cat: "prop",
        });
      }
      break;
    }
    case "prism": {
      // Contorno poligonal extruido a `h` — puntos en METROS (rect + celda·mpc).
      // El render (three.js ExtrudeGeometry) ya sabe extruir `polygon`.
      const hM = v.h * mpc;
      const wall = wallColors("stone");
      push({
        shape: "polygon",
        size: [hM],
        pos: [0, 0, 0],
        points: v.points.map(([u, vc]) => [rect.minX + u * mpc, rect.minZ + vc * mpc] as [number, number]),
        color: v.color ?? wall.lit,
        cat: "building",
      });
      break;
    }
    case "custom": {
      // Composición libre: las prims canónicas (celdas, pivote en `at`)
      // escaladas a metros del plató. seg de cone (size[2]) y sphere
      // (size[1]) NO se escalan (contrato de GreyboxPrimitive.size).
      for (const prim of customVolumePrims(v)) {
        const size = prim.size.map((s) => s * mpc);
        if (prim.shape === "cone" && prim.size[2] !== undefined) size[2] = prim.size[2];
        if (prim.shape === "sphere" && prim.size[1] !== undefined) size[1] = prim.size[1];
        push({
          ...prim,
          size,
          pos: [rect.minX + prim.pos[0] * mpc, prim.pos[1] * mpc, rect.minZ + prim.pos[2] * mpc],
        });
      }
      break;
    }
  }
}

/** Pistas para la visión (stage_review) desde el manifest del greybox —
 *  cajas proyectadas EXACTAS en px del cuadrado de trabajo. */
export function expectedElementsFromGreybox(spec: GreyboxSpec): StageExpectedElement[] {
  return spec.manifest.map((m) => ({
    id: m.id,
    label: m.label,
    box_px: m.box_px,
    tall: m.tall,
    solid: m.solid,
  }));
}

