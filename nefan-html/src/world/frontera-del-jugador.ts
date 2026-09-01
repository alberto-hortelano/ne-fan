/** EL BORDE DEL MUNDO, VISTO DESDE DENTRO DEL JUEGO.
 *
 *  El `FrontierManager` (vecino de este fichero) decide QUÉ tile falta y
 *  cuándo pedirlo; esto es lo otro: lo que el jugador ve y puede pulsar cuando
 *  se acerca a un borde sin generar — el muro de niebla, la pregunta de sí/no,
 *  y las peticiones que salen hacia el motor con su apunte en el ledger.
 *
 *  Estaba dentro del `gameLoop` de `main.ts`, y no es poca cosa: es el único
 *  sitio del juego donde una tecla GASTA CRÉDITOS. Por eso la generación no se
 *  auto-dispara nunca y por eso el jugador no se congela esperándola: el
 *  bloqueo del borde es direccional (colisión virtual) y puede retroceder.
 *
 *  Se queda en el cliente porque es todo efecto —pintar el velo, poner el
 *  cartel, hablarle al motor— y porque su decisión ya está en core, en el
 *  manager. */

import type { FrontierManager, Edge as FrontierEdge } from "./frontier.js";
import type { TileStore } from "./tile-store.js";
import { errors } from "../ui/error-log.js";

/** Nombre en español del borde hacia el que se propone generar un tile. */
export const EDGE_ES: Record<FrontierEdge, string> = {
  north: "norte",
  south: "sur",
  east: "este",
  west: "oeste",
};

/** La pregunta de sí/no que se le pone al jugador, o `null` para retirarla. */
export interface PreguntaDeFrontera {
  text: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}

export interface DepsDeFrontera {
  frontier: FrontierManager;
  tileStore: TileStore;
  /** Hay partida: sin ella no hay motor al que pedirle un tile. */
  session: { readonly active: boolean };
  /** La intención del jugador sobre la propuesta (tecla o botón: el proveedor
   *  no distingue). */
  input: {
    queueTileConfirm(): void;
    queueTileDecline(): void;
    consumeTileConfirm(): boolean;
    consumeTileDecline(): boolean;
  };
  /** El muro de niebla del borde, o `null` para disiparlo. */
  velo(edge: FrontierEdge | null): void;
  preguntar(q: PreguntaDeFrontera | null): void;
  /** Qué tile se pidió (para el ledger de episodios). */
  pedido(key: string): void;
  /** Pedirle al motor que genere el vecino. GASTA. */
  pedirTile(tx: number, ty: number, reason: "prefetch" | "blocking", edge: FrontierEdge): void;
  log(msg: string): void;
}

export function crearFronteraDelJugador(deps: DepsDeFrontera): { tick(x: number, z: number): void } {
  const pedir = (tx: number, ty: number, edge: FrontierEdge, reason: "prefetch" | "blocking"): void => {
    deps.pedido(`tile_${tx}_${ty}`);
    deps.pedirTile(tx, ty, reason, edge);
  };

  return {
    /** Un frame de frontera, con el jugador ya movido. */
    tick(x: number, z: number): void {
      // Sin partida o sin plano continuo no hay frontera que vigilar: ni velo
      // ni pregunta. La MISMA guarda de la que el proveedor de input deriva si
      // Y/N significan algo (#329) — fuera de aquí, la propuesta del manager
      // está vieja.
      if (!deps.session.active || !deps.tileStore.hasGridTiles) {
        deps.velo(null);
        deps.preguntar(null);
        return;
      }
      const ahora = performance.now();
      const { veil, timedOut, proposal } = deps.frontier.tick(ahora, x, z, deps.tileStore, pedir);
      // El velo es un MURO DE NIEBLA sobre la frontera, no una banda de HUD.
      // Ahí el mundo se acaba de verdad, y verlo disiparse al llegar el vecino
      // cuenta «el mundo continúa» sin escribirlo.
      deps.velo(veil?.edge ?? null);
      for (const key of timedOut) {
        errors.push(
          "narrative",
          `El tile ${key} no llegó a tiempo (timeout); se reintentará al acercarse.`,
        );
      }
      if (!proposal) {
        deps.preguntar(null);
        return;
      }
      deps.preguntar({
        text: `¿Explorar hacia el ${EDGE_ES[proposal.edge]}? Se generará una zona nueva.`,
        yes: "sí, explorar",
        no: "no",
        onYes: () => deps.input.queueTileConfirm(),
        onNo: () => deps.input.queueTileDecline(),
      });
      if (deps.input.consumeTileConfirm()) {
        deps.frontier.confirmProposal(ahora, pedir);
        deps.log(`Generando la zona al ${EDGE_ES[proposal.edge]} (${proposal.key})...`);
      } else if (deps.input.consumeTileDecline()) {
        deps.frontier.declineProposal();
      }
    },
  };
}
