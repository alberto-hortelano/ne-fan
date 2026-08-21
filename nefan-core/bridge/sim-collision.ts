/** Colisión server-side por tile para la vida ambiental de NPCs.
 *
 *  Espejo del CollisionSystem del cliente (fuentes en unión), construido solo
 *  con lo que el bridge tiene persistido en NarrativeState:
 *  1. terrain_grid del esquema (formatDToWorld — muros W, agua w, leyenda);
 *  2. PLAN declarado: agua∖decks del `ground` + huellas de los `volumes`,
 *     unidos por la MISMA función de core que el cliente (planCollisionGrid),
 *     no dos colliders OR'd — así jugador y NPCs colisionan idéntico.
 *
 *  Lazy + caché por sceneId: nada revisa un plan ya emitido, así que la caché
 *  no se invalida. Un grid inconsistente degrada ese tile a "sin esa fuente"
 *  con warning (mismo patrón que el cliente), nunca tumba el tick.
 *
 *  DIVERGENCIA INTENCIONAL con el cliente: la frontera de tiles y los AABBs
 *  del esquema son del jugador (cliente), no de los NPCs. */

import type { NarrativeState } from "../src/narrative/narrative-state.js";
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
import { tileKey, tileWorldRect, worldToTile, type WorldRect } from "../src/scene/tile.js";

export interface SimCollisionProvider {
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
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

    // 2. El plan declarado solo aplica a tiles del plano continuo (tienen
    // rect mundial).
    if (rec.tile) {
      const planCollider = buildPlanCollider(
        sceneId,
        rec.scene_data,
        tileWorldRect(rec.tile.tx, rec.tile.ty),
      );
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
  };
}
