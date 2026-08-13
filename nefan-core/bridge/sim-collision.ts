/** Colisión server-side por tile para la vida ambiental de NPCs.
 *
 *  Espejo del CollisionSystem del cliente 2D (fuentes en unión), construido
 *  solo con lo que el bridge tiene persistido en NarrativeState:
 *  1. terrain_grid del esquema (formatDToWorld — muros W, agua w, leyenda);
 *  2. PLAN declarado: agua∖decks del `ground` + huellas de los `volumes`,
 *     unidos por la MISMA función de core que el cliente (planCollisionGrid),
 *     no dos colliders OR'd — así jugador y NPCs colisionan idéntico;
 *  3. rects sólidos del análisis de imagen (rec.analysis.elements).
 *
 *  Lazy + caché por sceneId; `invalidate(sceneId)` desde map_plan_update /
 *  tile_analysis. Un grid inconsistente degrada ese tile a "sin esa fuente"
 *  con warning (mismo patrón que el cliente), nunca tumba el tick.
 *
 *  DIVERGENCIAS INTENCIONALES con el cliente (no unificadas — el bridge no
 *  tiene esos datos): (a) el análisis lo rasteriza de los rects de elementos
 *  (analysisGrid) mientras el cliente parte del grid de contactos PINTADOS,
 *  más fino; (b) en platós modo imagen el cliente SUSTITUYE la huella declarada
 *  por los recortes pintados (applyStageDerivedCollision) y aquí se mantiene la
 *  declarada; (c) frontera de tiles, viewConstraint (bounds del proscenio) y
 *  AABBs del esquema son del jugador (cliente), no de los NPCs. */

import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { AnalyzedElement } from "../src/narrative/types.js";
import {
  createTerrainCollider,
  type TerrainCollider,
  type TerrainGridData,
} from "../src/scene/terrain-collision.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import {
  parseGround,
  parseVolumes,
  planCollisionGrid,
  type CollisionGridDims,
  type GroundFeature,
  type Volume,
} from "../src/scene/blueprint/index.js";
import {
  TILE_CELLS,
  TILE_MPC,
  tileKey,
  tileWorldRect,
  worldToTile,
  type WorldRect,
} from "../src/scene/tile.js";

export interface SimCollisionProvider {
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
  /** Olvida los colliders derivados de una escena (el plan o el análisis
   *  cambiaron); la próxima consulta los re-deriva. */
  invalidate(sceneId: string): void;
}

/** Rasteriza los AABBs sólidos del análisis de imagen al grid del tile. */
function analysisGrid(elements: AnalyzedElement[], rect: WorldRect): TerrainGridData | null {
  const solids = elements.filter((e) => e.solid);
  if (solids.length === 0) return null;
  const marked = new Uint8Array(TILE_CELLS * TILE_CELLS);
  let any = false;
  for (const el of solids) {
    const c0 = Math.max(0, Math.floor((el.rect.minX - rect.minX) / TILE_MPC));
    const c1 = Math.min(TILE_CELLS - 1, Math.ceil((el.rect.maxX - rect.minX) / TILE_MPC) - 1);
    const r0 = Math.max(0, Math.floor((el.rect.minZ - rect.minZ) / TILE_MPC));
    const r1 = Math.min(TILE_CELLS - 1, Math.ceil((el.rect.maxZ - rect.minZ) / TILE_MPC) - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        marked[r * TILE_CELLS + c] = 1;
        any = true;
      }
    }
  }
  if (!any) return null;
  const rows: string[] = [];
  for (let r = 0; r < TILE_CELLS; r++) {
    let row = "";
    for (let c = 0; c < TILE_CELLS; c++) row += marked[r * TILE_CELLS + c] ? "S" : "g";
    rows.push(row);
  }
  return {
    grid: rows,
    cols: TILE_CELLS,
    rows: TILE_CELLS,
    meters_per_cell: TILE_MPC,
    origin: [rect.minX, rect.minZ],
    solid_chars: ["S"],
  };
}

/** Collider del PLAN de una escena (agua∖decks del ground + huellas de los
 *  volumes), unidos por la MISMA función de core que el cliente 2D
 *  (applyPlanCollision) — un solo grid, no dos colliders OR'd, para que
 *  jugador y NPCs colisionen idéntico. Un source con parse inválido degrada a
 *  "sin esa fuente" con warning (nunca tumba el tick). */
function buildPlanCollider(
  sceneId: string,
  sceneData: { ground?: unknown; volumes?: unknown },
  rect: WorldRect,
  dims?: CollisionGridDims,
): TerrainCollider | null {
  let ground: GroundFeature[] | undefined;
  const rawGround = sceneData.ground;
  if (Array.isArray(rawGround) && rawGround.length > 0) {
    const parsed = parseGround(rawGround);
    if (parsed.ok) ground = parsed.features;
    else console.warn(`[sim-collision] ${sceneId}: ground inválido (${parsed.error}) — sin agua declarada`);
  }
  let volumes: Volume[] | undefined;
  const rawVolumes = sceneData.volumes;
  if (Array.isArray(rawVolumes) && rawVolumes.length > 0) {
    const parsed = parseVolumes(rawVolumes);
    if (parsed.ok) volumes = parsed.volumes;
    else console.warn(`[sim-collision] ${sceneId}: volumes inválidos (${parsed.error}) — sin huellas`);
  }
  if (!ground && !volumes) return null;
  try {
    return createTerrainCollider(planCollisionGrid(ground, volumes, rect, dims));
  } catch (err) {
    console.warn(`[sim-collision] ${sceneId}: plan no deriva colisión —`, err);
    return null;
  }
}

export function createSimCollisionProvider(narrative: NarrativeState): SimCollisionProvider {
  const cache = new Map<string, TerrainCollider[]>();

  function buildColliders(sceneId: string): TerrainCollider[] {
    const rec = narrative.scenes_loaded[sceneId];
    if (!rec) return [];
    const colliders: TerrainCollider[] = [];

    // 1. terrain_grid del esquema. formatDToWorld devuelve el raw intacto en
    // escenas no-Format-D (legacy), que no traen terrain_grid → sin fuente.
    try {
      const world = formatDToWorld(rec.scene_data) as { terrain_grid?: TerrainGridData };
      const tc = createTerrainCollider(world.terrain_grid ?? null);
      if (tc) colliders.push(tc);
    } catch (err) {
      console.warn(`[sim-collision] ${sceneId}: terrain_grid no deriva colisión —`, err);
    }

    // 2..4 solo aplican a tiles del plano continuo (tienen rect mundial).
    if (rec.tile) {
      const rect = tileWorldRect(rec.tile.tx, rec.tile.ty);

      const planCollider = buildPlanCollider(sceneId, rec.scene_data, rect);
      if (planCollider) colliders.push(planCollider);

      if (rec.analysis) {
        try {
          const tc = createTerrainCollider(analysisGrid(rec.analysis.elements, rect));
          if (tc) colliders.push(tc);
        } catch (err) {
          console.warn(`[sim-collision] ${sceneId}: análisis no deriva colisión —`, err);
        }
      }
    }

    // 5. Platós proscenio (bloque `stage`, sin rect de tile): agua del
    // `ground` + huellas de volumes en su rect CENTRADO, con las dims de la
    // ESCENA — sin esto los NPCs del plató atravesaban agua y edificios.
    const sizeRaw = rec.scene_data.size as { cols?: number; rows?: number; meters_per_cell?: number } | undefined;
    if (
      !rec.tile &&
      rec.scene_data.stage !== undefined &&
      typeof sizeRaw?.cols === "number" &&
      typeof sizeRaw?.rows === "number" &&
      typeof sizeRaw?.meters_per_cell === "number"
    ) {
      const widthM = sizeRaw.cols * sizeRaw.meters_per_cell;
      const depthM = sizeRaw.rows * sizeRaw.meters_per_cell;
      const rect = { minX: -widthM / 2, minZ: -depthM / 2, maxX: widthM / 2, maxZ: depthM / 2 };
      const dims = { cols: sizeRaw.cols, rows: sizeRaw.rows, mpc: sizeRaw.meters_per_cell };
      const planCollider = buildPlanCollider(sceneId, rec.scene_data, rect, dims);
      if (planCollider) colliders.push(planCollider);
    }
    return colliders;
  }

  function collidersFor(sceneId: string): TerrainCollider[] {
    let entry = cache.get(sceneId);
    if (!entry) {
      entry = buildColliders(sceneId);
      cache.set(sceneId, entry);
    }
    return entry;
  }

  /** Tiles del plano tocados por el AABB del círculo (≤4). */
  function touchedKeys(x: number, z: number, radius: number): string[] {
    const keys = new Set<string>();
    for (const [px, pz] of [
      [x - radius, z - radius], [x + radius, z - radius],
      [x - radius, z + radius], [x + radius, z + radius],
    ]) {
      const t = worldToTile(px, pz);
      keys.add(tileKey(t.tx, t.ty));
    }
    return [...keys];
  }

  return {
    blocksMove(fromX, fromZ, toX, toZ, radius): boolean {
      for (const key of touchedKeys(toX, toZ, radius)) {
        for (const tc of collidersFor(key)) {
          if (tc.blocksMove(fromX, fromZ, toX, toZ, radius)) return true;
        }
      }
      return false;
    },
    blocksCircle(x, z, radius): boolean {
      for (const key of touchedKeys(x, z, radius)) {
        for (const tc of collidersFor(key)) {
          if (tc.blocksCircle(x, z, radius)) return true;
        }
      }
      return false;
    },
    invalidate(sceneId: string): void {
      cache.delete(sceneId);
    },
  };
}
