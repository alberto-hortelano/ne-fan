/** Spec del tile para la vista FPS — lógica PURA.
 *
 *  Reutiliza el builder greybox del tile (buildTileGreyboxSpec) con
 *  adaptaciones que a ras de suelo son obligatorias (bench labs/fps):
 *
 *  1. Los `cutaway` se CIERRAN: un edificio sin techo y con el frente a 0.8 m
 *     se ve como una ruina en primera persona. Se clona el plan (no se muta:
 *     el builder compartido debe seguir dando las mismas prims base).
 *  2. Las primitivas se ENRIQUECEN (fps-detail: copas esféricas, ventanas,
 *     chimeneas, tejados de torre, arcos de gate, rocas facetadas) y se
 *     añade el scatter declarativo (scatter.ts) — todo post-proceso fps-only:
 *     el builder compartido no se toca (de sus prims sale la identidad de las
 *     celdas del atlas, que es el arte pagado).
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
import { WALL_SURFACE_BY_MATERIAL, type SurfacePrim } from "../greybox/surfaces.js";
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
import type { SurfaceDescFaces, SurfaceRefFaces, Volume } from "./volumes.js";
import {
  GROUND_STACK_TOP_CELLS,
  buildTileGreyboxSpec,
  type TileGreyboxPlan,
  type TileGreyboxSpec,
} from "./greybox.js";

/** Cara alta del stack de rasgos planos del suelo, en METROS (0,105). Es
 *  CONSTANTE sea cual sea el tile —ocho rasgos o los 64 del schema—: los
 *  rasgos ya no se separan en Y, se pintan en orden (`groundOrder`). */
export const GROUND_STACK_TOP_M = GROUND_STACK_TOP_CELLS * TILE_MPC;

/** Holgura entre la cara alta del suelo y cualquier calco que se dibuje
 *  encima. 2 cm: suficiente para que el calco no comparta profundidad con el
 *  deck ni a 90 m, y poco para que siga leyendo como SUELO y no como una
 *  chapa flotando a los pies del jugador. */
export const GROUND_OVERLAY_CLEARANCE_M = 0.02;

/** Altura a la que va cualquier calco sobre el suelo (telegraph del ataque,
 *  overlay de colisión), en metros sobre el relieve.
 *
 *  DERIVADA, no medida: estuvo en 0,2 m a ojo sobre dos fixtures del golden
 *  mientras el suelo crecía 2 mm por prim sin techo. Un tile de puerto con
 *  quince rasgos —río, cuatro embarcaderos, seis calles y cuatro plazas, o
 *  sea `data/scenes/puerto_tile.json`— dejaba la cara alta del suelo en
 *  0,219 m y ENTERRABA el telegraph del ataque (issue #185). Retirado el
 *  escalonado, el suelo tiene techo por construcción y esta cota se explica
 *  sola. */
export const GROUND_OVERLAY_Y_M = GROUND_STACK_TOP_M + GROUND_OVERLAY_CLEARANCE_M;

/** ¿Es esta prim un rasgo plano de `ground`? Lo dice la MARCA que le puso
 *  quien la emitió (`groundFeaturePrims`), no su cota.
 *
 *  Aquí vivía un olfateador —`cat` terrain|water + `noShadow` + `y` dentro de
 *  una banda 0,045…0,185 celdas— y era un agujero con forma de candado: una
 *  capa por encima del deck se caía de la banda, así que ni se pintaba como
 *  calco (seguía escribiendo profundidad ⇒ ENTERRABA el telegraph) ni la medía
 *  `test/ground-overlay.test.ts`, que filtra por `groundOrder`. O sea que el
 *  candado de #185 dejaba abierta la puerta por la que #185 vuelve. Con la
 *  marca en origen, el alcance no depende de la altura de la capa. */
function isGroundFeaturePrim(p: GreyboxPrimitive): boolean {
  return p.groundLayer !== undefined;
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
  /** Spec del builder, tal cual (primitivas en CELDAS, sin enriquecer). */
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

/** Reparte el surface_desc (y su surface_ref opcional) del volumen en
 *  heroCells por prim. `sr` string = ref para TODAS las celdas creadas;
 *  objeto = ref por cara (subconjunto de las descritas, validado en
 *  parseVolumes). */
function assignHeroCells(
  p: SurfacePrim,
  role: PrimRole,
  volId: string,
  sd: string | SurfaceDescFaces,
  sr?: string | SurfaceRefFaces,
): void {
  const faces: SurfaceDescFaces = typeof sd === "string" ? { side: sd } : sd;
  const refs: SurfaceRefFaces =
    sr === undefined ? {} : typeof sr === "string"
      ? Object.fromEntries(Object.keys(faces).map((f) => [f, sr]))
      : sr;
  const cell = (face: keyof SurfaceDescFaces, key: string, desc: string) => ({
    key,
    desc,
    ...(refs[face] ? { ref: refs[face] } : {}),
  });
  const cells: NonNullable<SurfacePrim["heroCells"]> = {};
  if (role === "body") {
    if (faces.side) cells.side = cell("side", `hero_${volId}_side`, faces.side);
    for (const f of ["n", "s", "e", "w"] as const) {
      if (faces[f]) cells[f] = cell(f, `hero_${volId}_${f}`, faces[f]);
    }
    // caps/top del cuerpo: hastiales de un gable no aplican aquí; el top de
    // un prop/prism sí.
    if (faces.top) cells.top = cell("top", `hero_${volId}_top`, faces.top);
    if (faces.caps) cells.caps = cell("caps", `hero_${volId}_caps`, faces.caps);
  } else if (role === "roof") {
    if (faces.roof) {
      cells.side = cell("roof", `hero_${volId}_roof`, faces.roof);
      if (p.shape === "box") cells.top = cell("roof", `hero_${volId}_roof`, faces.roof);
    }
    if (faces.caps && p.shape === "gable") {
      cells.caps = cell("caps", `hero_${volId}_caps`, faces.caps);
    }
  } else if (role === "door") {
    if (faces.door) cells.side = cell("door", `hero_${volId}_door`, faces.door);
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
          q.heroCells = {
            side: {
              key: `hero_${p.volId}_p${i}`,
              desc: part.desc,
              ...(part.ref ? { ref: part.ref } : {}),
            },
          };
        } else {
          q.mat = false;
        }
        return q;
      }
      const q: SurfacePrim = { ...p };
      // El MATERIAL declarado de la fachada, dicho explícitamente. Antes solo
      // viajaba disfrazado de color y el clasificador tenía que adivinarlo
      // hacia atrás contra una lista de hex escrita a mano; cuando el motor
      // no daba `walls.color`, no adivinaba nada y pintaba mampostería sobre
      // un `material:"plaster"`. Solo el CUERPO: el faldón del tejado y las
      // puertas tienen su propio material.
      if (vol.type === "building" && primRole(p, vol) === "body") {
        const klass = WALL_SURFACE_BY_MATERIAL[vol.walls?.material ?? "stone"];
        if (klass) q.mat = { side: klass };
      }
      const sd = "surface_desc" in vol ? vol.surface_desc : undefined;
      if (sd !== undefined) {
        const sr = "surface_ref" in vol ? vol.surface_ref : undefined;
        assignHeroCells(q, primRole(p, vol), p.volId!, sd, sr);
      }
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
    // Orden de PINTADO de los rasgos planos del suelo. Dentro de una capa
    // todas las prims comparten y —coplanares exactas: cajas de segmento y
    // cilindros de junta de un mismo camino— y en perspectiva fps eso
    // z-fightea. La respuesta NO es separarlas en Y: son calcos, y un calco se
    // resuelve por orden de pintado. El escalonado de 2 mm por prim que vivía
    // aquí no tenía techo (63 prims legales ya subían el suelo a 0,2235 m y
    // enterraban el telegraph — #185) y encima dejaba el último camino
    // flotando 12 cm sobre su capa.
    //
    // El orden de emisión es el contractual (área→path→agua→deck, juntas tras
    // sus cajas), así que el índice creciente preserva la prioridad visual del
    // contrato y las juntas ganan en los codos.
    if (isGroundFeaturePrim(p)) {
      scaled.groundOrder = groundIdx;
      groundIdx += 1;
    }
    return scaled;
  });

  let lightsM: GreyboxLight[] = spec.lights.map((l) =>
    l.pos
      ? { ...l, pos: [l.pos[0] * TILE_MPC, l.pos[1] * TILE_MPC, l.pos[2] * TILE_MPC] }
      : l,
  );
  // A ras de suelo las sombras necesitan PESO: el ambient 0.85 del clay
  // compartido lava el contacto ("nada toca el suelo" — crítica externa
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
