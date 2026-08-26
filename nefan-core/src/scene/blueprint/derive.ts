/** Volúmenes que el ESQUEMA del tile implica y el motor no escribió: el
 *  puente entre las dos representaciones del mismo objeto.
 *
 *  Una entity estática (`kind` building/tree/prop/decor) y un `volume` son dos
 *  maneras de decir lo mismo — «aquí hay una casa» —, y hasta esta tanda el
 *  cliente pintaba las DOS: el volumen (que colisiona) y un billboard de la
 *  entity (que no). Aquí se reconcilian: cada entity estática deriva SU
 *  volumen y sale marcada en `representedBy`, para que quien pinta sepa que ya
 *  está pintada. `structures` → edificios cutaway; `vegetation_zones` →
 *  árboles/matas dispersos, que son ejemplares de pleno derecho.
 *
 *  Determinista: el scatter usa SeededRng derivado del `seed` (la clave del
 *  tile) + índice de zona. Los volúmenes del LLM mandan: una estructura o una
 *  entity cuyo rect ya solapa un volumen declarado no se deriva — la
 *  representa el declarado, y así sale en `representedBy`. */

import { TILE_CELLS } from "../tile.js";
import { volumeFootprint } from "./footprint.js";
import { fnv1a, seededRng, uniform } from "../../rng.js";
import { treeTrunkRadiusCells } from "./collision.js";
import { buildScatterExclusions } from "./scatter.js";
import type { GroundFeature } from "./ground.js";
import {
  sepEntreTroncos,
  sepPorDensidad,
  VEG_ATTEMPTS_PER_TARGET,
  VEG_BUSH_S_MAX,
  VEG_BUSH_S_MIN,
  VEG_TREE_S_MAX,
  VEG_TREE_S_MIN,
  zoneAreaM2,
  zoneIsBush,
  zoneRect,
  type VegetationZone,
} from "./vegetation.js";
import { TREE_MAX_S, type Volume } from "./volumes.js";

interface RawDoor {
  side?: string;
  at?: number;
  width?: number;
}

interface RawStructure {
  type?: string;
  rect?: unknown;
  doors?: RawDoor[];
}

interface RawEntity {
  id?: string;
  kind?: string;
  cell?: unknown;
  footprint?: unknown;
  name?: string;
  shape?: string;
}

const ENTITY_KIND_PRIORITY: Record<string, number> = { building: 0, prop: 1, decor: 2, tree: 3 };

export interface DeriveInput {
  /** Semilla del scatter: la CLAVE DEL TILE (`tile_tx_ty`), la misma en el
   *  cliente, el bridge, la pre-generación y el validador. */
  seed?: string;
  structures?: RawStructure[];
  /** Zonas YA parseadas (el fail-loud vive en el call site — `composeTilePlan`). */
  vegetation_zones?: VegetationZone[];
  /** Rasgos del suelo YA parseados (el fail-loud vive en el call site): el
   *  scatter de `vegetation_zones` los esquiva — ver
   *  `scatterVegetationVolumes`, que dice también qué queda fuera. */
  ground?: GroundFeature[];
  /** Entities del esquema — las estáticas (building/tree/prop/decor) derivan
   *  su volumen: es la ÚNICA representación con la que se pintan y colisionan. */
  entities?: RawEntity[];
}

export interface DeriveResult {
  /** Adiciones FIJAS: `structures` → edificios cutaway y entities estáticas →
   *  su primitiva (el caller las concatena tras los del LLM). */
  volumes: Volume[];
  /** La masa forestal de `vegetation_zones`, aparte: es lo más prescindible
   *  del plan, así que es lo primero que recorta el presupuesto — y para poder
   *  decirlo hay que poder contarla. */
  vegetation: Volume[];
  /** entityId → id del volumen que la representa. Quien pinta NO la dibuja
   *  aparte: ya está en el plan. Incluye las entities que no derivaron volumen
   *  porque un volumen declarado (o una structure) ya ocupaba su rect. */
  representedBy: Record<string, string>;
}

const SIDE_TO_EDGE: Record<string, "n" | "s" | "e" | "w"> = {
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

/** Huella que ya está ocupada por un volumen, con quién la ocupa: lo segundo
 *  es lo que permite decir «esta entity ya la representa aquel volumen» en vez
 *  de dejarla huérfana y pintarla dos veces. */
interface Blocker {
  id: string;
  rect: [number, number, number, number];
}

/** Ejemplar ya plantado: centro y radio de tronco (0 = no colisiona). */
interface Planted {
  u: number;
  v: number;
  r: number;
}

function asRect4(raw: unknown): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [c, r, w, d] = raw as number[];
  if (w <= 0 || d <= 0) return null;
  return [c, r, w, d];
}

function overlaps(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** Deriva los volúmenes implícitos del esquema. Silencioso ante primitivas mal
 *  formadas — el esquema ya pasó por el zod y por validateScene; esto compone,
 *  no valida. */
export function deriveVolumesFromSchema(raw: DeriveInput, declared: Volume[]): DeriveResult {
  const out: Volume[] = [];
  const representedBy: Record<string, string> = {};
  const blockers: Blocker[] = declared.map((v) => {
    const [u0, v0, u1, v1] = volumeFootprint(v).cells;
    return { id: v.id, rect: [u0, v0, u1 - u0, v1 - v0] as [number, number, number, number] };
  });

  const structures = Array.isArray(raw.structures) ? raw.structures : [];
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i];
    if (s?.type !== "room") continue;
    const rect = asRect4(s.rect);
    if (!rect) continue;
    if (blockers.some((b) => overlaps(b.rect, rect))) continue; // el LLM ya lo cubrió
    const doors = (Array.isArray(s.doors) ? s.doors : [])
      .filter((d) => d && typeof d.at === "number" && typeof d.side === "string" && SIDE_TO_EDGE[d.side])
      .map((d) => ({ edge: SIDE_TO_EDGE[d.side!], at: d.at!, w: d.width ?? 4 }));
    out.push({
      id: `derived_room_${i}`,
      label: "edificio",
      type: "building",
      rect,
      cutaway: true,
      doors,
    });
    blockers.push({ id: `derived_room_${i}`, rect });
  }

  // ── Entities estáticas del esquema → su volumen equivalente ──────────────
  // building = edificio NO enterable (con techo — los enterables son
  // structures); tree/prop/decor = su primitiva. Los ids llevan el id de la
  // entity para poder correlacionar (occluders, debug) y para que
  // `representedBy` diga cuál es cuál.
  const entities = (Array.isArray(raw.entities) ? raw.entities : [])
    .filter((ent) => {
      const kind = ent?.kind;
      return kind === "building" || kind === "tree" || kind === "prop" || kind === "decor";
    })
    .sort((a, b) => (ENTITY_KIND_PRIORITY[a.kind!] ?? 9) - (ENTITY_KIND_PRIORITY[b.kind!] ?? 9));
  for (const ent of entities) {
    const kind = ent.kind!; // el filter garantiza building/tree/prop/decor
    const cell = ent.cell;
    const fp = ent.footprint;
    if (!Array.isArray(cell) || cell.length < 2 || !Array.isArray(fp) || fp.length < 2) continue;
    const [c, r] = cell as number[];
    const [w, d] = fp as number[];
    if (![c, r, w, d].every((n) => typeof n === "number" && Number.isFinite(n)) || w <= 0 || d <= 0) continue;
    const rect: [number, number, number, number] = [
      Math.max(0, Math.min(TILE_CELLS - 1, c)),
      Math.max(0, Math.min(TILE_CELLS - 1, r)),
      Math.min(w, TILE_CELLS),
      Math.min(d, TILE_CELLS),
    ];
    const id = `derived_ent_${ent.id ?? `${c}_${r}`}`;
    const tapada = blockers.find((b) => overlaps(b.rect, rect));
    if (tapada) {
      // El LLM/structures ya cubren ese rect. Un EDIFICIO es el mismo objeto
      // que el volumen que lo tapa (la casa declarada y su entity), así que
      // queda representado por él y no se pinta aparte. El mobiliario de
      // dentro NO: un barril bajo el techo de una posada es una entity de
      // pleno derecho y hay que verla.
      if (kind === "building" && ent.id) representedBy[ent.id] = tapada.id;
      continue;
    }
    const label = typeof ent.name === "string" && ent.name ? ent.name : kind;
    if (kind === "tree") {
      const s = Math.min(TREE_MAX_S, Math.max(0.5, Math.max(w, d) / 4));
      out.push({ id, label, type: "tree", at: [round1(c + w / 2), round1(r + d / 2)], s: round1(s) });
    } else if (kind === "building") {
      out.push({ id, label, type: "building", rect, roof: { kind: "gable" } });
    } else {
      const shape = ent.shape === "cylinder" || ent.shape === "sphere" ? "cylinder" : "box";
      out.push(
        kind === "decor"
          ? { id, label, type: "prop", rect, shape, h: 1, passable: true }
          : { id, label, type: "prop", rect, shape, h: 3 },
      );
    }
    if (ent.id) representedBy[ent.id] = id;
    blockers.push({ id, rect });
  }

  // Los árboles ya presentes (declarados + derivados de entities) siembran la
  // separación del scatter: un pino de zona no puede caer pegado a un roble
  // que el motor puso a mano.
  const placed: Planted[] = [...declared, ...out]
    .filter((v): v is Extract<Volume, { type: "tree" }> => v.type === "tree")
    .map((v) => ({ u: v.at[0], v: v.at[1], r: treeTrunkRadiusCells(v.s ?? 1) }));
  return { volumes: out, vegetation: scatterVegetationVolumes(raw, blockers, placed), representedBy };
}

/** `vegetation_zones` → árboles/matas dispersos: scatter determinista con la
 *  separación que pide la densidad (`sepPorDensidad`) y, como suelo, la que
 *  exige el paso del jugador (`sepEntreTroncos`) — ver `vegetation.ts`, donde
 *  se derivan las dos. Rechaza por `blockers` (con margen ±3 celdas) y por el
 *  SUELO declarado.
 *
 *  La exclusión de suelo es el MISMO predicado que gobierna el scatter de
 *  detalle fps y el relieve (`buildScatterExclusions`): las tres rutas del
 *  blueprint esquivan lo mismo — huellas, agua, decks y la banda del camino
 *  (w/2 + 0,5). **Qué queda FUERA**: se ancla en `ground`, así que el agua o
 *  los caminos declarados SOLO como chars de `terrain_patches` no la ven. Los
 *  parches de material (`kind: "area"` — plaza, huerto) SÍ se pueblan: son
 *  material, y una zona declarada sobre un huerto debe poder plantarse.
 *
 *  `placed` entra con los árboles ya presentes y sale con los colocados aquí:
 *  mutación in-place a propósito, para que las zonas sucesivas se separen
 *  también de las anteriores. */
function scatterVegetationVolumes(
  raw: DeriveInput,
  blockers: Blocker[],
  placed: Planted[],
): Volume[] {
  const out: Volume[] = [];
  const zones = raw.vegetation_zones ?? [];
  // Volumes `[]` a propósito: las huellas ya se miran arriba con margen ±3,
  // más ancho que el ±0,5 del predicado.
  const onGround = buildScatterExclusions([], raw.ground ?? []);
  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    const area = zoneRect(zone.area);
    const isBush = zoneIsBush(zone.type);
    const rng = seededRng(`${raw.seed ?? "tile"}:veg:${zi}:${fnv1a(zone.seed ?? zone.type)}`);
    // Ejemplares/m² × área de la zona = lo que se pide. La separación sale de
    // la densidad, con el suelo geométrico por debajo.
    const target = Math.round(zoneAreaM2(zone.area) * zone.density);
    const sepDensidad = sepPorDensidad(zone.density);
    let attempts = 0;
    let placedCount = 0;
    while (placedCount < target && attempts < target * VEG_ATTEMPTS_PER_TARGET) {
      attempts++;
      // Se REDONDEA antes de comprobar nada: el volumen lleva la posición
      // redondeada, así que la separación hay que garantizarla sobre ESA — con
      // el centro crudo, dos troncos podían acercarse una décima al redondear
      // y la garantía dejaría de ser cierta justo donde se toca.
      const u = round1(uniform(rng, area[0] + 2, area[0] + area[2] - 2));
      const v = round1(uniform(rng, area[1] + 2, area[1] + area[3] - 2));
      if (blockers.some((b) => u > b.rect[0] - 3 && u < b.rect[0] + b.rect[2] + 3 && v > b.rect[1] - 3 && v < b.rect[1] + b.rect[3] + 3)) continue;
      if (onGround(u, v)) continue; // camino, agua o deck declarado
      const s = Math.round(uniform(rng, isBush ? VEG_BUSH_S_MIN : VEG_TREE_S_MIN, isBush ? VEG_BUSH_S_MAX : VEG_TREE_S_MAX) * 100) / 100;
      const radio = isBush ? 0 : treeTrunkRadiusCells(s);
      if (placed.some((p) => {
        const sep = Math.max(sepDensidad, sepEntreTroncos(p.r, radio));
        return (p.u - u) * (p.u - u) + (p.v - v) * (p.v - v) < sep * sep;
      })) continue;
      placed.push({ u, v, r: radio });
      out.push(
        isBush
          ? { id: `derived_veg_${zi}_${placedCount}`, label: zone.type, type: "bush", at: [u, v], s }
          : { id: `derived_veg_${zi}_${placedCount}`, label: zone.type, type: "tree", at: [u, v], s },
      );
      placedCount++;
    }
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
