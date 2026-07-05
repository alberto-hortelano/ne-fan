/** Colisión del mundo del cliente 2D — extraída de main.ts.
 *
 *  Tres fuentes de solidez por tile, en UNIÓN (todas bloquean):
 *  1. `collider`      — terrain_grid del esquema (muros W, agua w, features);
 *  2. `svgCollider`   — base derivada del map_svg (#water+#solid menos #deck),
 *                       activa desde que llega el tile;
 *  3. `imageCollider` — derivada del análisis de la imagen IA (segmentos
 *                       `solid` clasificados por visión).
 *  Los AABBs de objetos del esquema solo aplican mientras el tile no tiene
 *  SVG aplicado ni análisis: en cuanto hay mapa real (plano o imagen), los
 *  muros con puertas y huecos sustituyen a la caja ciega.
 *
 *  Semántica "salir sí, entrar no" en todas las fuentes: un obstáculo que YA
 *  solapa la posición actual no bloquea (permite des-penetrar tras un spawn
 *  solapado); solo bloquean los obstáculos NUEVOS del destino. */

import { createTerrainCollider, type TerrainCollider, type TerrainGridData } from "@nefan-core/src/scene/terrain-collision.js";
import { parseTileKey } from "@nefan-core/src/scene/tile.js";
import { svgCollisionGrid } from "../scene/svg-collision.js";
import type { TileAnalysis } from "../scene/scene-image.js";
import { errors } from "../ui/error-log.js";
import type { TileStore } from "./tile-store.js";

/** Radio del jugador (punto inflado) para toda la resolución de colisión. */
export const PLAYER_RADIUS = 0.4;

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
   *  colliders de terreno/svg/imagen de los tiles tocados (≤4, coordenadas
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
      // La imagen (o el SVG) manda: en un tile analizado o con colisión SVG
      // aplicada, los AABBs del esquema dejan de aplicar — la colisión sale
      // de los muros/troncos reales, con sus puertas y huecos.
      const owner = tileStore.getAt(obj.pos.x, obj.pos.z);
      if (owner?.imageAnalyzed || owner?.svgApplied) continue;
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

  /** Unión de los tres colliders de un tile sobre el mismo movimiento. */
  private tileBlocks(
    tile: { collider: TerrainCollider | null; svgCollider: TerrainCollider | null; imageCollider: TerrainCollider | null },
    from: { x: number; z: number },
    x: number,
    z: number,
  ): boolean {
    return Boolean(
      tile.collider?.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS) ||
      tile.svgCollider?.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS) ||
      tile.imageCollider?.blocksMove(from.x, from.z, x, z, PLAYER_RADIUS),
    );
  }
}

// ── Instaladores del mundo derivado (colisión que llega en runtime) ────────

export interface DerivedCollisionDeps {
  tileStore: TileStore;
  /** Espejo visual del overlay B (celdas azules del svg). */
  setTileSvgGrid(key: string, grid: TerrainGridData | null): void;
  /** Espejo visual del overlay B (celdas violetas del análisis). */
  setTileAnalysisGrid(key: string, grid: TerrainGridData | null): void;
  /** Reporta el análisis al bridge (persistencia + contexto LLM); el caller
   *  decide cuándo hay dónde persistir (sesión activa, tiles de grid). */
  reportAnalysis(tx: number, ty: number, elements: TileAnalysis["elements"]): void;
}

/** Colisión base del blueprint SVG: rasteriza #water+#solid (menos #deck) del
 *  map_svg y la instala como collider base del tile — activa desde que llega
 *  el tile, antes de imagen y análisis. Si la derivación falla, los AABBs del
 *  esquema siguen aplicando (svgApplied queda a false). */
export async function applySvgCollision(
  key: string,
  mapSvg: string,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  deps: DerivedCollisionDeps,
): Promise<void> {
  try {
    const grid = await svgCollisionGrid(mapSvg, rect);
    const collider = grid ? createTerrainCollider(grid) : null;
    deps.tileStore.setSvgCollider(key, collider);
    deps.setTileSvgGrid(key, grid);
    console.log(
      `[collision] ${key}: map_svg aplicado — ${collider?.solidCellCount ?? 0} celdas sólidas`,
    );
  } catch (err) {
    errors.push("scene", `map_svg de ${key} no deriva colisión; siguen los AABBs del esquema`, err);
  }
}

/** Mundo derivado de la imagen: materializa el análisis de un tile. El grid
 *  de segmentos sólidos pasa a ser el collider derivado del tile (la imagen
 *  manda: los AABBs del esquema en ese tile dejan de bloquear). Grid null =
 *  analizado sin sólidos (tile abierto). */
export function applyTileAnalysis(
  key: string,
  analysis: TileAnalysis,
  deps: DerivedCollisionDeps,
): void {
  let collider: TerrainCollider | null;
  try {
    collider = analysis.grid ? createTerrainCollider(analysis.grid) : null;
  } catch (err) {
    errors.push("scene", `grid derivado inconsistente en ${key}; colisión de imagen desactivada`, err);
    return;
  }
  deps.tileStore.markAnalyzed(key, collider);
  deps.setTileAnalysisGrid(key, analysis.grid);
  console.log(
    `[collision] ${key}: análisis aplicado — ` +
    `${collider?.solidCellCount ?? 0} celdas sólidas, ${analysis.occluders.length} occluders`,
  );
  const tc = parseTileKey(key);
  if (tc) deps.reportAnalysis(tc.tx, tc.ty, analysis.elements);
}
