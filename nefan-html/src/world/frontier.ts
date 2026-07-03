/** Prefetch proactivo + bloqueo direccional de fronteras del plano de tiles.
 *
 *  El jugador NUNCA se congela: al acercarse a un borde sin tile se pide la
 *  generación en segundo plano; si llega al borde antes de que exista, la
 *  colisión lo retiene SOLO en esa dirección (puede retroceder y moverse) y
 *  el velo direccional explica el porqué. Al completarse el tile se notifica
 *  desde esa dirección (flash + toast). */

import { neighborTile, worldToTile, tileWorldRect } from "@nefan-core/src/scene/tile.js";
import { oppositeEdge } from "@nefan-core/src/world-map/edges.js";
import type { Edge } from "@nefan-core/src/world-map/types.js";
import { tileKey, type TileStore } from "./tile-store.js";

/** Distancia al borde a la que se pide el tile vecino (en segundo plano). */
const PREFETCH_M = 16;
/** Distancia al borde a la que se muestra el velo (pegado a la frontera). */
const VEIL_M = 8;
/** Pegado al borde: la petición se re-envía como blocking (el bridge la
 *  promueve en su cola por delante de los prefetch). */
const BLOCKING_M = 2;
/** Pasado esto sin respuesta se olvida la petición (permite reintentar). */
const TILE_TIMEOUT_MS = 5 * 60_000;

export interface VeilState {
  edge: Edge;
  text: string;
}

export class FrontierManager {
  /** key del tile → timestamp de la petición (dedupe + timeout). */
  private requested = new Map<string, number>();
  /** Tiles ya re-pedidos como blocking (para promover solo una vez). */
  private blockingSent = new Set<string>();
  /** Texto de estado por tile (lo actualizan los narrative_status). */
  private statusText = new Map<string, string>();

  /** Llamar cada frame con la posición del jugador. Pide tiles que faltan
   *  cerca y devuelve el velo a pintar (o null) + timeouts vencidos. */
  tick(
    now: number,
    px: number,
    pz: number,
    tiles: TileStore,
    request: (tx: number, ty: number, edge: Edge, reason: "prefetch" | "blocking") => void,
  ): { veil: VeilState | null; timedOut: string[] } {
    const timedOut: string[] = [];
    for (const [key, startedAt] of this.requested) {
      if (now - startedAt > TILE_TIMEOUT_MS) {
        this.requested.delete(key);
        this.statusText.delete(key);
        this.blockingSent.delete(key);
        timedOut.push(key);
      }
    }
    if (!tiles.hasGridTiles) return { veil: null, timedOut };

    const t = worldToTile(px, pz);
    const rect = tileWorldRect(t.tx, t.ty);
    const distTo: Record<Edge, number> = {
      west: px - rect.minX,
      east: rect.maxX - px,
      north: pz - rect.minZ,
      south: rect.maxZ - pz,
    };

    let veil: VeilState | null = null;
    let veilDist = Infinity;
    const nearEdges: Edge[] = [];
    for (const edge of ["north", "south", "east", "west"] as Edge[]) {
      const n = neighborTile(t.tx, t.ty, edge);
      if (tiles.has(n.tx, n.ty)) continue;
      const d = distTo[edge];
      if (d < PREFETCH_M) {
        nearEdges.push(edge);
        this.requestOnce(now, n.tx, n.ty, edge, request);
      }
      // Pegado al borde esperando: promover la petición a blocking (una vez).
      if (d < BLOCKING_M) {
        const key = tileKey(n.tx, n.ty);
        if (this.requested.has(key) && !this.blockingSent.has(key)) {
          this.blockingSent.add(key);
          request(n.tx, n.ty, edge, "blocking");
        }
      }
      if (d < VEIL_M && d < veilDist) {
        veilDist = d;
        const key = tileKey(n.tx, n.ty);
        veil = { edge, text: this.statusText.get(key) ?? "Explorando lo desconocido" };
      }
    }
    // Esquina: dos bordes cercanos sin tile → pedir también el diagonal para
    // que no quede un hueco visible al caminar en diagonal.
    if (nearEdges.length === 2) {
      const dx = nearEdges.includes("east") ? 1 : nearEdges.includes("west") ? -1 : 0;
      const dy = nearEdges.includes("south") ? 1 : nearEdges.includes("north") ? -1 : 0;
      if (dx !== 0 && dy !== 0 && !tiles.has(t.tx + dx, t.ty + dy)) {
        this.requestOnce(now, t.tx + dx, t.ty + dy, dx > 0 ? "east" : "west", request);
      }
    }
    return { veil, timedOut };
  }

  private requestOnce(
    now: number,
    tx: number,
    ty: number,
    edge: Edge,
    request: (tx: number, ty: number, edge: Edge, reason: "prefetch" | "blocking") => void,
  ): void {
    const key = tileKey(tx, ty);
    if (this.requested.has(key)) return;
    this.requested.set(key, now);
    request(tx, ty, edge, "prefetch");
  }

  /** Texto de progreso que llega por narrative_status para un tile pedido. */
  onStatusText(tx: number, ty: number, text: string): boolean {
    const key = tileKey(tx, ty);
    if (!this.requested.has(key)) return false;
    this.statusText.set(key, text);
    return true;
  }

  /** Tile completado: desmarca la petición y devuelve el borde del tile del
   *  JUGADOR hacia el nuevo tile (para el flash/toast direccional), o null si
   *  no es vecino inmediato. */
  onTileReady(tx: number, ty: number, px: number, pz: number): Edge | null {
    const key = tileKey(tx, ty);
    this.requested.delete(key);
    this.statusText.delete(key);
    this.blockingSent.delete(key);
    const t = worldToTile(px, pz);
    for (const edge of ["north", "south", "east", "west"] as Edge[]) {
      const n = neighborTile(t.tx, t.ty, edge);
      if (n.tx === tx && n.ty === ty) return edge;
    }
    return null;
  }

  /** Error del bridge para un tile pedido: permite reintentar al reacercarse. */
  onTileError(tx: number, ty: number): boolean {
    const key = tileKey(tx, ty);
    this.statusText.delete(key);
    this.blockingSent.delete(key);
    return this.requested.delete(key);
  }

  /** Estado para el hook __nefan / bench. */
  debugState(): { requested: string[] } {
    return { requested: [...this.requested.keys()] };
  }
}

export { oppositeEdge };
export type { Edge };
