/** Spec del tile para la vista FPS — lógica PURA.
 *
 *  Reutiliza el builder greybox del tile oblicuo (buildTileGreyboxSpec) con
 *  adaptaciones que a ras de suelo son obligatorias (bench labs/fps):
 *
 *  1. Los `cutaway` se CIERRAN: un edificio sin techo y con el frente a 0.8 m
 *     se ve como una ruina en primera persona. Se clona el plan (no se muta —
 *     el spec oblicuo del mismo tile no debe cambiar).
 *  2. Las primitivas se ENRIQUECEN (fps-detail: copas esféricas, ventanas,
 *     chimeneas, tejados de torre, arcos de gate, rocas facetadas) y se
 *     añade el scatter declarativo (scatter.ts) — todo post-proceso fps-only:
 *     el builder compartido no se toca (su spec canónico es el layout_key
 *     del arte pagado de la vista oblicua).
 *  3. Las primitivas y luces se escalan de CELDAS a METROS (×TILE_MPC): el
 *     clasificador de superficies y las UVs del renderer FPS trabajan en
 *     metros (DENSITY_M por repetición).
 *
 *  Además reparte `surface_desc` de los volúmenes en celdas "hero" del atlas
 *  POR ROL/CARA (la vía del motor narrativo para pedir superficies concretas
 *  que entran en la librería): string = una celda para las caras del CUERPO
 *  (tejado/puertas conservan su material); objeto = celda propia por cara
 *  (n/s/e/w/roof/door/caps/top), cada una con su descripción → su imagen. */

import { TILE_CELLS, TILE_MPC } from "../tile.js";
import type { GreyboxLight, GreyboxPrimitive } from "../greybox/common.js";
import type { SurfacePrim } from "../greybox/surfaces.js";
import { enrichFpsPrims } from "./fps-detail.js";
import { applyFpsCutawayInteriors } from "./fps-interior.js";
import { buildReliefGrid, RELIEF_RIDERS } from "./fps-relief.js";
import { buildFpsAmbience } from "./fps-ambience.js";
import {
  buildScatterExclusions,
  parseScatter,
  runScatter,
  type ScatterCount,
} from "./scatter.js";
import type { SurfaceDescFaces, Volume } from "./volumes.js";
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

/** Plan del tile + bloque opcional de scatter declarativo (crudo — se valida
 *  aquí con parseScatter; el gate de escena ya lo validó fail-loud). */
export interface FpsTilePlanInput extends TileGreyboxPlan {
  scatter_generators?: unknown;
  scatter_zones?: unknown;
  /** Descripción de la escena — la ambientación fps infiere de ella la hora
   *  del día (fps-ambience). */
  scene_description?: string;
}

export interface FpsTileSpec {
  /** Spec del builder (unidades CELDAS — coherente con elements/occluders). */
  spec: TileGreyboxSpec;
  /** Primitivas en METROS con heroes/detalle/scatter: la entrada de
   *  buildLayout (surfaces.ts) y del renderer FPS. */
  primsM: SurfacePrim[];
  /** Luces con posiciones en METROS. */
  lightsM: GreyboxLight[];
  /** Telemetría del scatter (wanted/placed por zona). */
  scatterCounts?: ScatterCount[];
  /** Bloque de scatter presente pero inválido: motivo (el tile compone sin
   *  él — fail-loud en el log del cliente, no un tile negro). */
  scatterError?: string;
  /** Hora inferida del scene_description (telemetría/debug). */
  timeOfDay?: string;
  /** Cielo/niebla de la ambientación — ausentes = constantes del renderer. */
  sky?: { top: string; bottom: string };
  fog?: { color: string; near: number; far: number };
}

function scalePrim(p: SurfacePrim): SurfacePrim {
  const q: SurfacePrim = {
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

/** Rol de una prim dentro de su volumen building/wall/prop — derivado de las
 *  invariantes del builder (volume-prims.ts), sin tocar su salida: el tejado
 *  es el gable o el box elevado; la puerta, el box color #2a2018; el merlón,
 *  el box elevado de un wall. */
type PrimRole = "body" | "roof" | "door" | "merlon" | "other";

function primRole(p: GreyboxPrimitive, vol: Volume): PrimRole {
  if (vol.type === "building") {
    if (p.color === "#2a2018") return "door";
    if (p.shape === "gable") return "roof";
    if (p.noShadow) return "other"; // suelo interior del cutaway
    // Tapa plana a la altura del muro = tejado; el dintel del cutaway
    // (0 < pos.y < wall_h) NO recibe hero — la celda entera comprimida en su
    // franja pintaba una banda; clasifica por color a material tileable.
    if (p.pos[1] >= (vol.wall_h ?? 5)) return "roof";
    if (p.pos[1] > 0) return "other";
    return "body";
  }
  if (vol.type === "wall") return p.pos[1] > 0 ? "merlon" : "body";
  if (vol.type === "prop") return p.noShadow ? "other" : "body";
  if (vol.type === "prism") return "body";
  return "other";
}

/** Reparte el surface_desc del volumen en heroCells por prim. */
function assignHeroCells(p: SurfacePrim, role: PrimRole, volId: string, sd: string | SurfaceDescFaces): void {
  const faces: SurfaceDescFaces = typeof sd === "string" ? { side: sd } : sd;
  const cells: NonNullable<SurfacePrim["heroCells"]> = {};
  if (role === "body") {
    if (faces.side) cells.side = { key: `hero_${volId}_side`, desc: faces.side };
    for (const f of ["n", "s", "e", "w"] as const) {
      if (faces[f]) cells[f] = { key: `hero_${volId}_${f}`, desc: faces[f] };
    }
    // caps/top del cuerpo: hastiales de un gable no aplican aquí; el top de
    // un prop/prism sí.
    if (faces.top) cells.top = { key: `hero_${volId}_top`, desc: faces.top };
    if (faces.caps) cells.caps = { key: `hero_${volId}_caps`, desc: faces.caps };
  } else if (role === "roof") {
    if (faces.roof) {
      cells.side = { key: `hero_${volId}_roof`, desc: faces.roof };
      if (p.shape === "box") cells.top = { key: `hero_${volId}_roof`, desc: faces.roof };
    }
    if (faces.caps && p.shape === "gable") {
      cells.caps = { key: `hero_${volId}_caps`, desc: faces.caps };
    }
  } else if (role === "door") {
    if (faces.door) cells.side = { key: `hero_${volId}_door`, desc: faces.door };
  }
  if (Object.keys(cells).length > 0) p.heroCells = cells;
}

export function buildFpsTileSpec(plan: FpsTilePlanInput, seedKey: string): FpsTileSpec {
  // Clonar volúmenes cerrando cutaways (sin mutar el plan de entrada).
  const volumes = plan.volumes.map((v) =>
    v.type === "building" && v.cutaway ? { ...v, cutaway: undefined } : v,
  );
  const spec = buildTileGreyboxSpec({ ground: plan.ground, volumes, biome: plan.biome }, seedKey);

  // Cutaways ENTERABLES (fps-only): el cuerpo macizo del cierre se sustituye
  // por muros con vanos espejo de la colisión + suelo interior.
  const basePrims = applyFpsCutawayInteriors(spec.primitives, plan.volumes);

  const volById = new Map<string, Volume>();
  for (const v of volumes) volById.set(`vol_${v.id}`, v);

  // surface_desc por volId → celdas hero por rol/cara (en CELDAS, antes del
  // enriquecimiento: los roles se derivan de las prims del builder). Los
  // volúmenes custom van pieza a pieza: prims↔parts casan por ORDEN (contrato
  // de customVolumePrims); pieza con `desc` → celda hero propia, sin desc →
  // clay con su color (mat false).
  const customIdx = new Map<string, number>();
  const enriched = enrichFpsPrims(
    basePrims.map((p) => {
      const vol = p.volId ? volById.get(p.volId) : undefined;
      if (!vol) return p as SurfacePrim;
      if (vol.type === "custom") {
        const i = customIdx.get(p.volId!) ?? 0;
        customIdx.set(p.volId!, i + 1);
        const part = vol.parts[i];
        const q: SurfacePrim = { ...p };
        if (part?.desc) {
          q.heroCells = { side: { key: `hero_${p.volId}_p${i}`, desc: part.desc } };
        } else {
          q.mat = false;
        }
        return q;
      }
      const sd = "surface_desc" in vol ? vol.surface_desc : undefined;
      if (sd === undefined) return p as SurfacePrim;
      const q: SurfacePrim = { ...p };
      assignHeroCells(q, primRole(p, vol), p.volId!, sd);
      return q;
    }),
    volumes,
    seedKey,
  );

  // Scatter declarativo (opcional): validación + poblado, todo en celdas.
  let scatterCounts: ScatterCount[] | undefined;
  let scatterError: string | undefined;
  const hasScatter = plan.scatter_generators !== undefined || plan.scatter_zones !== undefined;
  if (hasScatter) {
    const parsed = parseScatter(plan.scatter_generators, plan.scatter_zones);
    if (parsed.ok) {
      const excluded = buildScatterExclusions(volumes, plan.ground ?? []);
      const run = runScatter(parsed.generators, parsed.zones, { seedKey, excluded });
      enriched.push(...run.prims);
      scatterCounts = run.counts;
    } else {
      scatterError = parsed.error;
    }
  }

  // Relieve del suelo (fps-only): rejilla determinista con aplanado bajo
  // huellas/caminos/agua/áreas. Se cuelga de la prim del suelo del bioma; el
  // renderer desplaza su tapa y ancla cámara/billboards/decor. Las prims de
  // los volúmenes que cabalgan el relieve (tree/bush/rock — no lo aplanan)
  // se marcan `anchor` para que el renderer las suba por su centro.
  const reliefGrid = buildReliefGrid(plan.biome, volumes, plan.ground ?? [], seedKey);
  const anchorVolIds = new Set(
    volumes.filter((v) => RELIEF_RIDERS.has(v.type)).map((v) => `vol_${v.id}`),
  );

  let groundIdx = 0;
  const primsM: SurfacePrim[] = enriched.map((p) => {
    const scaled = scalePrim(p);
    if (
      reliefGrid &&
      p.cat === "terrain" &&
      p.shape === "box" &&
      p.size[0] === TILE_CELLS &&
      p.size[2] === TILE_CELLS
    ) {
      scaled.relief = reliefGrid;
    }
    if (reliefGrid && p.volId && anchorVolIds.has(p.volId)) scaled.anchor = true;
    // Stagger intra-capa de los rasgos planos del suelo (anti z-fighting).
    // El orden de emisión es el contractual (área→path→agua→deck, juntas
    // tras sus cajas), así que el índice creciente preserva la prioridad
    // visual del contrato y las juntas ganan en los codos.
    if (isGroundFeaturePrim(p)) {
      groundIdx += 1;
      scaled.pos = [scaled.pos[0], scaled.pos[1] + groundIdx * GROUND_STAGGER_M, scaled.pos[2]];
    }
    return scaled;
  });

  let lightsM: GreyboxLight[] = spec.lights.map((l) =>
    l.pos
      ? { ...l, pos: [l.pos[0] * TILE_MPC, l.pos[1] * TILE_MPC, l.pos[2] * TILE_MPC] }
      : l,
  );
  // A ras de suelo las sombras necesitan PESO: el ambient 0.85 del clay
  // cenital lava el contacto ("nada toca el suelo" — crítica externa
  // 2026-08-16). Reequilibrio FPS-ONLY (el spec compartido no cambia).
  lightsM = lightsM.map((l) =>
    l.kind === "ambient" && l.intensity === 0.85 ? { ...l, intensity: 0.6 }
    : l.kind === "sun" && l.intensity === 1.6 ? { ...l, intensity: 1.85 }
    : l,
  );

  // Ambientación por hora inferida del texto (fps-only): con señal ≠ día
  // sustituye luces y aporta cielo/niebla; de día no toca nada.
  const ambience = buildFpsAmbience(plan.scene_description, volumes, seedKey);
  if (ambience.lightsM) lightsM = ambience.lightsM;
  if (ambience.extraM) lightsM = [...lightsM, ...ambience.extraM];

  return {
    spec,
    primsM,
    lightsM,
    scatterCounts,
    scatterError,
    timeOfDay: ambience.timeOfDay,
    sky: ambience.sky,
    fog: ambience.fog,
  };
}
