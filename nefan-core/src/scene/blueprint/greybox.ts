/** Builder greybox 3D del TILE — lógica PURA (sin three.js).
 *
 *  Produce un `TileGreyboxSpec`: las primitivas del tile en CELDAS más las
 *  luces fijas. Es la geometría base ÚNICA del juego — la vista fps la
 *  post-procesa (fps-spec.ts: cutaways cerrados, detalle, scatter, celdas →
 *  metros) y de ahí sale el atlas de superficies, que es lo que se paga con
 *  IA. DETERMINISTA: mismo plan + seedKey ⇒ las MISMAS primitivas, en el
 *  mismo orden y con los mismos valores. Ese determinismo no es comodidad:
 *  el arte ya generado se reencuentra por la identidad de las celdas que
 *  salen de aquí, y `test/fps-atlas-golden.test.ts` la congela.
 *
 *  Sol fijo desde el sur(-oeste): cara sur iluminada / este en sombra
 *  SIEMPRE. */

import { seededRng, uniform } from "../../rng.js";
import { TILE_CELLS } from "../tile.js";
import { BIOME_COLORS, darken, lighten } from "./palette.js";
import { ellipsePoints, groundFeaturePrims } from "./ground-prims.js";
import type { GroundFeature } from "./ground.js";
import type { GateVolume, Volume } from "./volumes.js";
import type { GreyboxLight, GreyboxPrimitive } from "../greybox/common.js";
import { volumePartsForTile } from "../greybox/volume-prims.js";

/** Versión del builder: viaja dentro del spec. */
export const TILE_GREYBOX_VERSION = 1;

export interface TileGreyboxPlan {
  ground?: GroundFeature[];
  volumes: Volume[];
  biome?: string;
}

export interface TileGreyboxSpec {
  tile_greybox_version: number;
  lights: GreyboxLight[];
  /** Unidades = CELDAS del tile; pos = [u, hBase, v] (y = base). El ORDEN de
   *  emisión es parte del contrato: lo hereda `primsM` y con él la identidad
   *  de las celdas del atlas. */
  primitives: GreyboxPrimitive[];
}

/** Flores por bioma: tonos que leen como vegetación sin gritar. */
const BIOME_FLOWERS: Record<string, string[]> = {
  grass: ["#d8c458", "#c8d2df", "#c98a9a"],
  meadow: ["#d8c458", "#c8d2df", "#c98a9a", "#b48ac9"],
  forest_floor: ["#c8d2df", "#a9b86a"],
  swamp: ["#a9b86a"],
};

/** Elevaciones (celdas) de las capas planas del suelo — separadas para que el
 *  z-buffer nunca haga z-fighting y el orden visual sea el del contrato:
 *  detalle < áreas/caminos < agua < deck. */
const Y_DETAIL = 0.02;
const Y_AREA = 0.05;
const Y_PATH = 0.09;
const Y_WATER = 0.13;
const Y_DECK = 0.18;
const LAYER_T = 0.03;

/** Detalle procedural del suelo — manchas orgánicas del bioma, piedritas y
 *  flores dispersas, sembradas por tile (determinista: caché intacta). */
function groundDetailPrims(base: string, biome: string, seedKey: string): GreyboxPrimitive[] {
  const rng = seededRng(`${seedKey}:ground`);
  const light = lighten(base, 0.09);
  const dark = darken(base, 0.13);
  const out: GreyboxPrimitive[] = [];
  for (let i = 0; i < 10; i++) {
    const cx = uniform(rng, 6, TILE_CELLS - 6);
    const cy = uniform(rng, 6, TILE_CELLS - 6);
    const rx = uniform(rng, 8, 14);
    const ry = rx * uniform(rng, 0.55, 0.8);
    out.push({
      shape: "polygon",
      size: [0.01],
      pos: [0, Y_DETAIL + i * 0.002, 0],
      points: ellipsePoints(cx, cy, rx, ry),
      color: i % 2 === 0 ? light : dark,
      cat: "terrain",
      noShadow: true,
    });
  }
  for (let i = 0; i < 6; i++) {
    const cx = uniform(rng, 3, TILE_CELLS - 3);
    const cy = uniform(rng, 3, TILE_CELLS - 3);
    const r = uniform(rng, 0.7, 1.3);
    out.push({
      shape: "cylinder",
      size: [r, 0.12],
      pos: [cx, Y_DETAIL, cy],
      color: i % 2 === 0 ? "#8f887a" : "#7d7869",
      cat: "terrain",
      noShadow: true,
    });
  }
  const flowers = BIOME_FLOWERS[biome] ?? [];
  if (flowers.length > 0) {
    for (let i = 0; i < 16; i++) {
      const cx = uniform(rng, 2, TILE_CELLS - 2);
      const cy = uniform(rng, 2, TILE_CELLS - 2);
      out.push({
        shape: "cylinder",
        size: [0.45, 0.08],
        pos: [cx, Y_DETAIL + 0.03, cy],
        color: flowers[i % flowers.length],
        cat: "decor",
        noShadow: true,
      });
    }
  }
  return out;
}

/** Construye el spec greybox del tile. `seedKey` (tileKey) siembra el detalle
 *  procedural — estable por tile entre sesiones. */
export function buildTileGreyboxSpec(plan: TileGreyboxPlan, seedKey: string): TileGreyboxSpec {
  const biome = plan.biome ?? "grass";
  const base = BIOME_COLORS[biome] ?? BIOME_COLORS.grass;
  const primitives: GreyboxPrimitive[] = [];

  // ── Suelo: base del bioma (EXACTAMENTE el cuadrado del tile: es la prim
  // que el relieve fps engancha) + detalle procedural sembrado. ────────────
  primitives.push({
    shape: "box",
    size: [TILE_CELLS, 0.1, TILE_CELLS],
    pos: [TILE_CELLS / 2, -0.1, TILE_CELLS / 2],
    color: base,
    cat: "terrain",
    noShadow: true,
  });
  primitives.push(...groundDetailPrims(base, biome, seedKey));

  // ── Rasgos declarativos del suelo (áreas/caminos < agua < decks): transform
  // identidad y unidades en celdas. ─────────────────────────────────────────
  primitives.push(
    ...groundFeaturePrims(plan.ground ?? [], {
      toXZ: (u, v) => [u, v],
      scale: 1,
      yArea: Y_AREA,
      yPath: Y_PATH,
      yWater: Y_WATER,
      yDeck: Y_DECK,
      layerT: LAYER_T,
    }),
  );

  // ── Volúmenes, tramo a tramo y en el orden declarado. ────────────────────
  const gates = plan.volumes.filter((v): v is GateVolume => v.type === "gate");
  for (const v of plan.volumes) {
    for (const part of volumePartsForTile(v, gates)) {
      primitives.push(...part.prims);
    }
  }

  // ── Luces FIJAS: sol desde el sur(-oeste) — cara sur lit / este en sombra
  // siempre. La fps las reequilibra a ras de suelo (fps-spec.ts). ──────────
  const lights: GreyboxLight[] = [
    { kind: "ambient", color: "#ffffff", intensity: 0.85 },
    { kind: "sun", color: "#ffffff", intensity: 1.6, pos: [-80, 140, 220], castShadow: true },
  ];

  return { tile_greybox_version: TILE_GREYBOX_VERSION, lights, primitives };
}
