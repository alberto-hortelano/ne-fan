/** Prefetch con confirmación + bloqueo direccional de fronteras del plano.
 *
 *  El jugador NUNCA se congela: al acercarse a un borde sin tile se le
 *  PROPONE generar el vecino (la generación gasta LLM/créditos, así que no se
 *  dispara sola) y solo tras confirmar se pide en segundo plano; si llega al
 *  borde antes de que exista, la colisión lo retiene SOLO en esa dirección
 *  (puede retroceder y moverse) y el velo direccional explica el porqué. Al
 *  completarse el tile se notifica desde esa dirección (flash + toast). */

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
/** Tras un error del bridge para un tile, no se re-pide hasta pasado esto.
 *  Sin cooldown, un jugador parado junto a la frontera con el motor narrativo
 *  caído re-pediría el tile en cada frame (spam de errores en bucle). */
const ERROR_COOLDOWN_MS = 15_000;

export interface VeilState {
  edge: Edge;
  text: string;
}

/** Tile vecino sin generar cerca del jugador, a la espera de confirmación. */
export interface TileProposal {
  key: string;
  tx: number;
  ty: number;
  edge: Edge;
}

export class FrontierManager {
  /** key del tile → timestamp de la petición (dedupe + timeout). */
  private requested = new Map<string, number>();
  /** Tiles ya re-pedidos como blocking (para promover solo una vez). */
  private blockingSent = new Set<string>();
  /** key del tile → timestamp del último error (cooldown antes de reintentar). */
  private erroredAt = new Map<string, number>();
  /** Texto de estado por tile (lo actualizan los narrative_status). */
  private statusText = new Map<string, string>();
  /** Tiles que el jugador rechazó generar. Se limpian al alejarse del borde,
   *  así la propuesta reaparece si vuelve (rechazo ≠ veto permanente). */
  private declined = new Set<string>();
  /** Propuesta activa (recalculada cada tick; borde más cercano gana). */
  private proposal: TileProposal | null = null;

  /** Llamar cada frame con la posición del jugador. Propone tiles que faltan
   *  cerca (pendientes de confirmar con confirmProposal) y devuelve el velo a
   *  pintar (o null) + timeouts vencidos. */
  tick(
    now: number,
    px: number,
    pz: number,
    tiles: TileStore,
    request: (tx: number, ty: number, edge: Edge, reason: "prefetch" | "blocking") => void,
  ): { veil: VeilState | null; timedOut: string[]; proposal: TileProposal | null } {
    const timedOut: string[] = [];
    for (const [key, startedAt] of this.requested) {
      if (now - startedAt > TILE_TIMEOUT_MS) {
        this.requested.delete(key);
        this.statusText.delete(key);
        this.blockingSent.delete(key);
        timedOut.push(key);
      }
    }
    if (!tiles.hasGridTiles) {
      this.proposal = null;
      return { veil: null, timedOut, proposal: null };
    }

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
    let proposal: TileProposal | null = null;
    let proposalDist = Infinity;
    const nearEdges: Edge[] = [];
    const nearKeys = new Set<string>();
    for (const edge of ["north", "south", "east", "west"] as Edge[]) {
      const n = neighborTile(t.tx, t.ty, edge);
      if (tiles.has(n.tx, n.ty)) continue;
      const d = distTo[edge];
      const key = tileKey(n.tx, n.ty);
      if (d < PREFETCH_M) {
        nearEdges.push(edge);
        nearKeys.add(key);
        // La generación gasta LLM/créditos: se PROPONE (borde más cercano
        // gana) y solo se pide tras confirmProposal(). Nunca se auto-dispara.
        if (this.canPropose(now, key) && d < proposalDist) {
          proposalDist = d;
          proposal = { key, tx: n.tx, ty: n.ty, edge };
        }
      }
      // Pegado al borde esperando: promover la petición a blocking (una vez).
      if (d < BLOCKING_M) {
        if (this.requested.has(key) && !this.blockingSent.has(key)) {
          this.blockingSent.add(key);
          request(n.tx, n.ty, edge, "blocking");
        }
      }
      if (d < VEIL_M && d < veilDist) {
        veilDist = d;
        veil = {
          edge,
          text: this.requested.has(key)
            ? (this.statusText.get(key) ?? "Explorando lo desconocido")
            : "Zona sin generar",
        };
      }
    }
    // Esquina: dos bordes cercanos CONFIRMADOS → pedir también el diagonal
    // para que no quede un hueco visible al caminar en diagonal. La esquina
    // no se pregunta aparte: la cubre la confirmación de sus dos bordes.
    if (nearEdges.length === 2 && nearEdges.every((e) => {
      const n = neighborTile(t.tx, t.ty, e);
      return this.requested.has(tileKey(n.tx, n.ty));
    })) {
      const dx = nearEdges.includes("east") ? 1 : nearEdges.includes("west") ? -1 : 0;
      const dy = nearEdges.includes("south") ? 1 : nearEdges.includes("north") ? -1 : 0;
      if (dx !== 0 && dy !== 0 && !tiles.has(t.tx + dx, t.ty + dy)) {
        this.requestOnce(now, t.tx + dx, t.ty + dy, dx > 0 ? "east" : "west", request);
      }
    }
    // Rechazos de tiles ya lejanos se olvidan: al volver se re-propone.
    for (const key of this.declined) {
      if (!nearKeys.has(key)) this.declined.delete(key);
    }
    this.proposal = proposal;
    return { veil, timedOut, proposal };
  }

  /** El jugador acepta la propuesta activa: se pide la generación del tile. */
  confirmProposal(
    now: number,
    request: (tx: number, ty: number, edge: Edge, reason: "prefetch" | "blocking") => void,
  ): void {
    if (!this.proposal) return;
    const { tx, ty, edge } = this.proposal;
    this.proposal = null;
    this.requestOnce(now, tx, ty, edge, request);
  }

  /** El jugador rechaza la propuesta activa: no se re-propone hasta que se
   *  aleje del borde y vuelva. */
  declineProposal(): void {
    if (!this.proposal) return;
    this.declined.add(this.proposal.key);
    this.proposal = null;
  }

  private canPropose(now: number, key: string): boolean {
    if (this.requested.has(key) || this.declined.has(key)) return false;
    const failedAt = this.erroredAt.get(key);
    return failedAt === undefined || now - failedAt >= ERROR_COOLDOWN_MS;
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
    const failedAt = this.erroredAt.get(key);
    if (failedAt !== undefined && now - failedAt < ERROR_COOLDOWN_MS) return;
    this.erroredAt.delete(key);
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

  /** Error del bridge para un tile pedido: permite reintentar tras un
   *  cooldown (evita el bucle petición→error→petición pegado a la frontera). */
  onTileError(tx: number, ty: number): boolean {
    const key = tileKey(tx, ty);
    this.statusText.delete(key);
    this.blockingSent.delete(key);
    // Misma base de tiempo que el `now` de tick() (performance.now del caller).
    this.erroredAt.set(key, performance.now());
    return this.requested.delete(key);
  }

  /** Estado para el hook __nefan / bench. */
  debugState(): { requested: string[]; declined: string[]; proposal: TileProposal | null } {
    return {
      requested: [...this.requested.keys()],
      declined: [...this.declined],
      proposal: this.proposal,
    };
  }
}

export { oppositeEdge };
export type { Edge };
