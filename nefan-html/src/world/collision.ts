/** Colisión del mundo del cliente — CABLEADO, no decisión.
 *
 *  «¿(x, z) está bloqueado?» es la unión de tres fuentes, y ninguna se decide
 *  aquí: la FRONTERA del plano y las CAJAS de los objetos son de core
 *  (`simulation/obstaculos-del-jugador.ts`), y los colliders de cada tile
 *  tocado son `collider` (terrain_grid: el agua w) y `svgCollider` (el PLAN,
 *  derivado por `planCollisionGrid` — el MISMO cálculo que el bridge en
 *  sim-collision, así que jugador y NPCs no divergen).
 *
 *  Aquí queda lo que no es regla: el `TileStore`, los colliders instalados y el
 *  `errors.push` de la derivación. Las dos reglas salieron en la PR 5 de #241
 *  (#489), que de paso arregló el salto de las cajas: era POR TILE
 *  (`svgApplied`) y hoy es POR OBJETO (`volume_id`), así que lo que el motor
 *  spawnea pasó a ser sólido. */

import { createTerrainCollider, PLAYER_RADIUS_M, type TerrainCollider } from "@nefan-core/src/scene/terrain-collision.js";
import {
  aabbBloquea,
  fronteraBloquea,
  type ObstaculoAabb,
  type TilesDelMundo,
} from "@nefan-core/src/simulation/obstaculos-del-jugador.js";
import {
  planCollisionGrid,
  type GroundFeature,
  type Volume,
} from "@nefan-core/src/scene/blueprint/index.js";
import { errors } from "../ui/error-log.js";
import { dlog } from "../dev/debug-log.js";
import type { TileStore } from "./tile-store.js";

/** Radio del jugador (punto inflado) para toda la resolución de colisión.
 *  Reexporta la fuente única de core (`PLAYER_RADIUS_M`) — no redefinir aquí. */
export const PLAYER_RADIUS = PLAYER_RADIUS_M;

/** Obstáculo de caja del esquema. El tipo es el de core: lo que el cliente
 *  aporta es la LISTA (sus `Entity` de objeto), no qué significa cada campo. */
export type CollisionObstacle = ObstaculoAabb;

export interface CollisionDeps {
  tileStore: TileStore;
  /** Posición ACTUAL del jugador — origen del movimiento que se resuelve. */
  getPlayerPos(): { x: number; z: number };
  /** Objetos del esquema que colisionan por caja (buildings/props). */
  getObstacles(): readonly CollisionObstacle[];
}

export class CollisionSystem {
  /** El `TileStore` visto como el mundo que pregunta la frontera de core. Se
   *  construye una vez y lee en vivo (`hayGrid` es un getter): el store es
   *  mutable y la respuesta tiene que ser la de este frame. */
  private readonly tiles: TilesDelMundo;

  constructor(private deps: CollisionDeps) {
    const { tileStore } = deps;
    this.tiles = {
      get hayGrid() {
        return tileStore.hasGridTiles;
      },
      tocados: (x, z, r) => tileStore.keysTouching(x, z, r),
      tiene: (tx, ty) => tileStore.has(tx, ty),
    };
  }

  /** ¿El destino (x,z) está bloqueado para el jugador? Unión de las tres
   *  fuentes de la cabecera, en el orden más barato primero. */
  collidesAt(x: number, z: number): boolean {
    const { tileStore } = this.deps;
    const desde = this.deps.getPlayerPos();
    const hasta = { x, z };
    if (fronteraBloquea(desde, hasta, PLAYER_RADIUS, this.tiles)) return true;
    for (const t of tileStore.keysTouching(x, z, PLAYER_RADIUS)) {
      const tile = tileStore.get(t.tx, t.ty);
      if (tile && this.tileBlocks(tile, desde, x, z)) return true;
    }
    return aabbBloquea(desde, hasta, PLAYER_RADIUS, this.deps.getObstacles());
  }

  /** Unión de los dos colliders de un tile sobre el mismo movimiento. */
  private tileBlocks(
    tile: { collider: TerrainCollider | null; svgCollider: TerrainCollider | null },
    from: { x: number; z: number },
    x: number,
    z: number,
  ): boolean {
    return Boolean(
      tile.collider?.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS) ||
      tile.svgCollider?.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS),
    );
  }
}

// ── Instaladores del mundo derivado (colisión que llega en runtime) ────────

/** Colisión base del plan declarado: agua∖decks del `ground` + huellas de los
 *  volúmenes — instalada como collider base del tile, activa desde que llega
 *  el tile. Analítica pura (sin rasterizar nada). Si la derivación falla, el
 *  tile se queda sin esa fuente (`svgApplied` a false) y se dice: las cajas de
 *  sus objetos no la sustituyen, porque los objetos del plan no las llevan.
 *
 *  Ya no lleva deps: el espejo visual del grid (celdas azules del overlay B)
 *  era del renderer oblicuo. En primera persona el overlay de colisión
 *  MUESTREA el CollisionSystem celda a celda, así que no hay una segunda
 *  copia del grid que mantener sincronizada. */
export function applyPlanCollision(
  key: string,
  plan: { ground?: GroundFeature[]; volumes?: Volume[] },
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  tileStore: TileStore,
): void {
  try {
    // Agua∖decks del suelo declarado + huellas de los volúmenes, unidos por la
    // MISMA función de core que usa el bridge (sim-collision) — jugador y NPCs
    // colisionan igual sobre el mismo plan.
    const grid = planCollisionGrid(plan.ground, plan.volumes, rect);
    const collider = grid ? createTerrainCollider(grid) : null;
    tileStore.setSvgCollider(key, collider, "derivada");
    dlog(
      `[collision] ${key}: plan aplicado — ${collider?.solidCellCount ?? 0} celdas sólidas`,
    );
  } catch (err) {
    errors.push("scene", `plan de ${key} no deriva colisión; ese tile se queda sin la solidez del plan`, err);
  }
}
