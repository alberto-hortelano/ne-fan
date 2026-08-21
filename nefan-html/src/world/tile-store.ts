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
  /** Colisión base derivada del PLAN declarado (agua∖decks del `ground` +
   *  huellas de los `volumes`). Disponible en cuanto llega el tile. Se UNE al
   *  collider de terreno. Con `svgApplied`, los AABBs del esquema dejan de
   *  bloquear (el plan ya dibuja esos edificios con sus muros y puertas); si
   *  la derivación falla, el flag queda a false y los AABBs siguen. */
  svgCollider: TerrainCollider | null;
  svgApplied: boolean;
}

export class TileStore {
  readonly entries = new Map<string, TileClientState>();
  private grid = new Map<string, TileClientState>();
  /** Huella del scene data con el que se registró cada clave. Es lo único que
   *  distingue "el tile vuelve a llegar igual" (resume, re-broadcast) de "el
   *  tile CAMBIÓ" — y de eso depende si la colisión derivada se restaura o se
   *  recalcula. Vivía en el renderer oblicuo, que era quien re-pintaba; con
   *  una sola vista, el dueño del dato es el modelo de mundo. */
  private fingerprints = new Map<string, string>();

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
    const grid = this.get(t.tx, t.ty);
    if (grid) return grid;
    // Escenas SIN grid (fixtures legacy del selector): localizar por rect —
    // sin esto, el gate de AABBs del esquema no ve `svgApplied` y las cajas
    // declaradas bloquean aunque la colisión del plan las haya sustituido.
    for (const e of this.entries.values()) {
      if (e.tx === undefined && x >= e.rect.minX && x < e.rect.maxX && z >= e.rect.minZ && z < e.rect.maxZ) {
        return e;
      }
    }
    return undefined;
  }

  /** ADITIVO: re-añadir la misma clave sustituye (re-render tras resume).
   *  Devuelve `sceneChanged`: la clave ya estaba Y su escena es distinta. Un
   *  tile nuevo NO cuenta como cambio (no hay nada que restaurar). */
  add(tile: TileClientState): { sceneChanged: boolean } {
    const fingerprint = JSON.stringify(tile.scene);
    const sceneChanged =
      this.entries.has(tile.key) && this.fingerprints.get(tile.key) !== fingerprint;
    this.entries.set(tile.key, tile);
    this.fingerprints.set(tile.key, fingerprint);
    if (Number.isInteger(tile.tx) && Number.isInteger(tile.ty)) {
      this.grid.set(tileKey(tile.tx!, tile.ty!), tile);
    }
    return { sceneChanged };
  }

  /** Instala la colisión base derivada del plan del tile (null = plan sin
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
    this.fingerprints.clear();
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
