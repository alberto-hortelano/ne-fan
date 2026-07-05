/** Modelo de mundo del cliente: colección ACUMULATIVA de tiles/escenas.
 *
 *  La geometría (64 m, tile (0,0) centrado, worldToTile con round) se importa
 *  de nefan-core — única fuente de verdad. Los tiles del plano se indexan por
 *  (tx,ty); las escenas legacy (fixtures, saves viejos sin migrar) conviven
 *  como entradas sin coords de grid, ancladas por su world_rect.
 *
 *  Sin dependencias de DOM: testeable y reutilizable. */

import {
  TILE_SIZE_M,
  tileKey,
  tileWorldRect,
  worldToTile,
  type WorldRect,
} from "@nefan-core/src/scene/tile.js";
import type { TerrainCollider } from "@nefan-core/src/scene/terrain-collision.js";

export { TILE_SIZE_M, tileKey, tileWorldRect, worldToTile };
export type { WorldRect };

export interface TileClientState {
  /** Clave del registro (tileKey para tiles del grid; scene_id para legacy). */
  key: string;
  /** Coords de grid — ausentes en escenas legacy. */
  tx?: number;
  ty?: number;
  rect: WorldRect;
  /** WorldScene normalizado (formatDToWorld), posiciones GLOBALES. */
  scene: Record<string, unknown>;
  collider: TerrainCollider | null;
  /** Colisión DERIVADA de la imagen IA (segmentos sólidos clasificados por
   *  visión). Con `imageAnalyzed`, la imagen manda: los AABBs de objetos del
   *  esquema en este tile dejan de bloquear. */
  imageCollider: TerrainCollider | null;
  imageAnalyzed: boolean;
  /** Colisión base derivada del map_svg (capas #water+#solid, perforadas por
   *  #deck). Disponible en cuanto llega el tile — antes de imagen y análisis.
   *  Se UNE al resto de colliders. Con `svgApplied`, los AABBs del esquema
   *  dejan de bloquear (el SVG ya dibuja esos edificios con muros y puertas);
   *  si la derivación falla, el flag queda a false y los AABBs siguen. */
  svgCollider: TerrainCollider | null;
  svgApplied: boolean;
}

export class TileStore {
  readonly entries = new Map<string, TileClientState>();
  private grid = new Map<string, TileClientState>();

  /** ¿Hay algún tile del grid? (las reglas de frontera solo aplican entonces). */
  get hasGridTiles(): boolean {
    return this.grid.size > 0;
  }

  has(tx: number, ty: number): boolean {
    return this.grid.has(tileKey(tx, ty));
  }

  get(tx: number, ty: number): TileClientState | undefined {
    return this.grid.get(tileKey(tx, ty));
  }

  getAt(x: number, z: number): TileClientState | undefined {
    const t = worldToTile(x, z);
    return this.get(t.tx, t.ty);
  }

  /** ADITIVO: re-añadir la misma clave sustituye (re-render tras resume). */
  add(tile: TileClientState): void {
    this.entries.set(tile.key, tile);
    if (Number.isInteger(tile.tx) && Number.isInteger(tile.ty)) {
      this.grid.set(tileKey(tile.tx!, tile.ty!), tile);
    }
  }

  /** Marca un tile como analizado (mundo derivado de imagen) e instala su
   *  collider derivado (null = sin celdas sólidas, pero analizado igualmente:
   *  los AABBs del esquema dejan de aplicar). Fail-loud si la clave no existe:
   *  el análisis siempre corre sobre un tile registrado. */
  markAnalyzed(key: string, collider: TerrainCollider | null): void {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`TileStore.markAnalyzed: tile ${key} no registrado`);
    entry.imageCollider = collider;
    entry.imageAnalyzed = true;
  }

  /** Instala la colisión base derivada del map_svg del tile (null = svg sin
   *  celdas sólidas, aplicado igualmente: los AABBs del esquema se apagan).
   *  Fail-loud si la clave no existe: se deriva justo tras registrar el tile. */
  setSvgCollider(key: string, collider: TerrainCollider | null): void {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`TileStore.setSvgCollider: tile ${key} no registrado`);
    entry.svgCollider = collider;
    entry.svgApplied = true;
  }

  /** Solo para resetWorld (arranque/resume/fixtures). */
  clear(): void {
    this.entries.clear();
    this.grid.clear();
  }

  /** Coords de los tiles del grid que toca el AABB (x±r, z±r) — ≤4. */
  keysTouching(x: number, z: number, r: number): { tx: number; ty: number }[] {
    const out: { tx: number; ty: number }[] = [];
    const t0 = worldToTile(x - r, z - r);
    const t1 = worldToTile(x + r, z + r);
    for (let ty = t0.ty; ty <= t1.ty; ty++) {
      for (let tx = t0.tx; tx <= t1.tx; tx++) out.push({ tx, ty });
    }
    return out;
  }
}
