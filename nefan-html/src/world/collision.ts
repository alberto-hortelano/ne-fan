/** Colisión del mundo del cliente 2D — extraída de main.ts.
 *
 *  Dos fuentes de solidez por tile, en UNIÓN (las dos bloquean):
 *  1. `collider`      — terrain_grid del esquema (muros W, agua w, features);
 *  2. `svgCollider`   — PLAN declarado: agua∖decks del `ground` + huellas de
 *                       los `volumes`, derivados por la función de core
 *                       compartida `planCollisionGrid` (el MISMO cálculo que el
 *                       bridge en sim-collision → jugador y NPCs no divergen).
 *                       Activa desde que llega el tile.
 *  Los AABBs de objetos del esquema solo aplican mientras el tile no tiene el
 *  plan aplicado: en cuanto hay mapa real, los muros con puertas y huecos
 *  sustituyen a la caja ciega.
 *
 *  Semántica "salir sí, entrar no" en todas las fuentes: un obstáculo que YA
 *  solapa la posición actual no bloquea (permite des-penetrar tras un spawn
 *  solapado); solo bloquean los obstáculos NUEVOS del destino. */

import { createTerrainCollider, PLAYER_RADIUS_M, type TerrainCollider, type TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
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

/** Obstáculo AABB del esquema (objeto de escena con footprint). */
export interface CollisionObstacle {
  pos: { x: number; z: number };
  sizeXZ?: { x: number; z: number } | null;
  category?: string;
}

export interface CollisionDeps {
  tileStore: TileStore;
  /** Posición ACTUAL del jugador — origen del movimiento que se resuelve. */
  getPlayerPos(): { x: number; z: number };
  /** Objetos del esquema que colisionan por AABB (buildings/props). */
  getObstacles(): readonly CollisionObstacle[];
}

export class CollisionSystem {
  constructor(private deps: CollisionDeps) {}

  /** Frontera del plano: un tile INEXISTENTE es un sólido virtual con
   *  semántica "salir sí, entrar no" — bloquea el movimiento HACIA él pero
   *  nunca el de vuelta. Con la resolución por ejes del gameLoop esto da el
   *  bloqueo DIRECCIONAL gratis: pegado al borde este solo se bloquea +x;
   *  ±z y -x siguen libres. Solo aplica cuando el mundo es de tiles de grid. */
  frontierBlocksMove(x: number, z: number): boolean {
    const { tileStore } = this.deps;
    if (!tileStore.hasGridTiles) return false;
    const destMissing = tileStore
      .keysTouching(x, z, PLAYER_RADIUS)
      .filter((t) => !tileStore.has(t.tx, t.ty));
    if (destMissing.length === 0) return false;
    const p = this.deps.getPlayerPos();
    const fromKeys = new Set(
      tileStore.keysTouching(p.x, p.z, PLAYER_RADIUS).map((t) => `${t.tx},${t.ty}`),
    );
    return destMissing.some((t) => !fromKeys.has(`${t.tx},${t.ty}`));
  }

  /** ¿El destino (x,z) está bloqueado para el jugador? Unión de frontera,
   *  colliders de terreno/plan de los tiles tocados (≤4, coordenadas
   *  globales) y AABBs del esquema donde aún aplican. */
  collidesAt(x: number, z: number): boolean {
    if (this.frontierBlocksMove(x, z)) return true;
    const { tileStore } = this.deps;
    const p = this.deps.getPlayerPos();
    if (tileStore.hasGridTiles) {
      for (const t of tileStore.keysTouching(x, z, PLAYER_RADIUS)) {
        const tile = tileStore.get(t.tx, t.ty);
        if (tile && this.tileBlocks(tile, p, x, z)) return true;
      }
    } else {
      for (const entry of tileStore.entries.values()) {
        if (this.tileBlocks(entry, p, x, z)) return true;
      }
    }
    for (const obj of this.deps.getObstacles()) {
      if (!obj.sizeXZ) continue;
      if (obj.category !== "building" && obj.category !== "prop") continue;
      // El PLAN manda: en un tile con colisión del plan aplicada, los AABBs
      // del esquema dejan de aplicar — la colisión sale de los muros/troncos
      // reales, con sus puertas y huecos.
      const owner = tileStore.getAt(obj.pos.x, obj.pos.z);
      if (owner?.svgApplied) continue;
      const hx = obj.sizeXZ.x / 2 + PLAYER_RADIUS;
      const hz = obj.sizeXZ.z / 2 + PLAYER_RADIUS;
      if (Math.abs(x - obj.pos.x) < hx && Math.abs(z - obj.pos.z) < hz) {
        const alreadyInside =
          Math.abs(p.x - obj.pos.x) < hx && Math.abs(p.z - obj.pos.z) < hz;
        if (!alreadyInside) return true;
      }
    }
    return false;
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

export interface DerivedCollisionDeps {
  tileStore: TileStore;
  /** Espejo visual del overlay B (celdas azules del plan). */
  setTileSvgGrid(key: string, grid: TerrainGridData | null): void;
}

/** Colisión base del plan declarado: agua∖decks del `ground` + huellas de los
 *  volúmenes — instalada como collider base del tile, activa desde que llega
 *  el tile, antes de imagen y análisis. Analítica pura (sin rasterizar nada).
 *  Si la derivación falla, los AABBs del esquema siguen aplicando
 *  (svgApplied queda a false). */
export function applyPlanCollision(
  key: string,
  plan: { ground?: GroundFeature[]; volumes?: Volume[] },
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  deps: DerivedCollisionDeps,
): void {
  try {
    // Agua∖decks del suelo declarado + huellas de los volúmenes, unidos por la
    // MISMA función de core que usa el bridge (sim-collision) — jugador y NPCs
    // colisionan igual sobre el mismo plan.
    const grid = planCollisionGrid(plan.ground, plan.volumes, rect);
    const collider = grid ? createTerrainCollider(grid) : null;
    deps.tileStore.setSvgCollider(key, collider);
    deps.setTileSvgGrid(key, grid);
    dlog(
      `[collision] ${key}: plan aplicado — ${collider?.solidCellCount ?? 0} celdas sólidas`,
    );
  } catch (err) {
    errors.push("scene", `plan de ${key} no deriva colisión; siguen los AABBs del esquema`, err);
  }
}
