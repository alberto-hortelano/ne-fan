/** Colisión server-side por tile para la vida ambiental de NPCs.
 *
 *  Espejo del CollisionSystem del cliente (fuentes en unión), construido solo
 *  con lo que el bridge tiene persistido en NarrativeState:
 *  1. terrain_grid del esquema (formatDToWorld — muros W, agua w, leyenda);
 *  2. PLAN COMPUESTO (`__plan` de la world scene: lo declarado por el motor
 *     MÁS lo derivado del esquema — edificios de `structures`, entities
 *     estáticas y la vegetación de masa), rasterizado con la MISMA función de
 *     core que el cliente (planCollisionGrid), no dos colliders OR'd — así
 *     jugador y NPCs colisionan idéntico. Antes aquí solo entraban los
 *     `volumes` DECLARADOS, así que en un tile cuyo pueblo viene de
 *     `structures` los NPCs se metían dentro de las casas.
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
import { DEFAULT_SOLID_CHARS, formatDToWorld } from "../src/scene/scene-normalize.js";
import {
  planCollisionGrid,
  type CollisionGridDims,
  type GroundFeature,
  type Volume,
} from "../src/scene/blueprint/index.js";
import type { TilePlan } from "../src/scene/tile-plan.js";
import { tileKey, tileWorldRect, worldToTile, type WorldRect } from "../src/scene/tile.js";

export interface SimCollisionProvider {
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
}

/** Collider del PLAN ya compuesto (agua∖decks del ground + huellas de los
 *  volumes), rasterizado con la MISMA función de core que el cliente
 *  (applyPlanCollision) — un solo grid, no dos colliders OR'd, para que
 *  jugador y NPCs colisionen idéntico. El bridge NO deriva: lee `__plan`, que
 *  ya viene compuesto de la normalización. */
function buildPlanCollider(
  sceneId: string,
  plan: { ground?: GroundFeature[]; volumes?: Volume[] },
  rect: WorldRect,
  /** Solidez resuelta de la leyenda de ESA escena: el agua que el autor
   *  declaró vadeable no bloquea tampoco por el plan (ver planCollisionGrid).
   *  Sin ella, jugador y NPCs discreparían del vado. */
  solidChars: readonly string[],
  dims?: CollisionGridDims,
): TerrainCollider | null {
  const ground = plan.ground?.length ? plan.ground : undefined;
  const volumes = plan.volumes?.length ? plan.volumes : undefined;
  if (!ground && !volumes) return null;
  try {
    return createTerrainCollider(planCollisionGrid(ground, volumes, rect, { solidChars, dims }));
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
    // Su leyenda resuelta (`solid_chars`) manda también sobre el plan (2), y
    // de la misma normalización sale el plan compuesto.
    let solidChars: readonly string[] = DEFAULT_SOLID_CHARS;
    let plan: TilePlan | null = null;
    try {
      const world = formatDToWorld(rec.scene_data) as { terrain_grid?: TerrainGridData; __plan?: TilePlan };
      if (world.terrain_grid?.solid_chars) solidChars = world.terrain_grid.solid_chars;
      plan = world.__plan ?? null;
      const tc = createTerrainCollider(world.terrain_grid ?? null);
      if (tc) colliders.push(tc);
    } catch (err) {
      console.warn(`[sim-collision] ${sceneId}: terrain_grid no deriva colisión —`, err);
    }

    // 2. El plan compuesto solo aplica a tiles del plano continuo (tienen
    // rect mundial).
    if (rec.tile && plan) {
      const planCollider = buildPlanCollider(
        sceneId,
        plan,
        tileWorldRect(rec.tile.tx, rec.tile.ty),
        solidChars,
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
