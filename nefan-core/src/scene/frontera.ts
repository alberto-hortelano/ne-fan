/** LA FRONTERA DEL JUGADOR: cuándo se le PROPONE generar el tile vecino.
 *
 *  Es la única regla de GASTO del jugador. Cada «sí» a la propuesta dispara un
 *  `generate_scene` del motor narrativo y, con imagen IA, el atlas del tile: por
 *  eso la generación no se auto-dispara nunca —se propone, y solo se pide tras
 *  confirmar—, y por eso el jugador no se congela esperándola: si llega al
 *  borde antes de que el vecino exista, la colisión lo retiene SOLO en esa
 *  dirección (puede retroceder y moverse) y el velo direccional explica por qué.
 *
 *  Vivía en el cliente (#512, PR 2 de #241), donde nada se
 *  medía. Aquí no hay una línea de DOM: el cliente pasa el reloj, la posición y
 *  los tiles como argumentos, y se queda con lo que es suyo —pintar el velo,
 *  poner la pregunta de sí/no, hablarle al motor—. El reloj entra SIEMPRE por
 *  parámetro (también en `alError`, que en el cliente leía `performance.now()`
 *  por su cuenta): un autómata con dos relojes distintos es el que no se puede
 *  probar.
 *
 *  El autómata, por tile vecino que falta:
 *
 *    lejos ──(d < PROPONER_A_M, sin rechazo ni cooldown)──▸ PROPUESTO
 *    PROPUESTO ──confirmar──▸ PEDIDO (prefetch) ──(d < BLOQUEO_A_M)──▸ PEDIDO
 *      como blocking, UNA vez ──tile listo──▸ fuera del autómata
 *    PROPUESTO ──rechazar──▸ RECHAZADO, hasta alejarse del borde y volver
 *    PEDIDO ──TIMEOUT_DE_TILE_MS sin respuesta──▸ olvidado (re-pedible)
 *    PEDIDO ──error del bridge──▸ COOLDOWN_TRAS_ERROR_MS sin re-proponer
 *
 *  La geometría (qué tile pisa el jugador, dónde están sus bordes, cuál es el
 *  vecino) es la de `scene/tile.ts`; la clave del tile es la misma
 *  `tile_${tx}_${ty}` que usa el registro del cliente. */

import type { Edge } from "../world-map/types.js";
import { neighborTile, tileKey, tileWorldRect, worldToTile } from "./tile.js";

/** Distancia al borde a la que se PROPONE generar el vecino. */
export const PROPONER_A_M = 16;
/** Distancia al borde a la que se muestra el velo (pegado a la frontera). */
export const VELO_A_M = 8;
/** Pegado al borde: la petición se re-envía como `blocking` (el bridge la
 *  promueve en su cola por delante de los prefetch). */
export const BLOQUEO_A_M = 2;
/** Pasado esto sin respuesta se olvida la petición (permite reintentar). */
export const TIMEOUT_DE_TILE_MS = 5 * 60_000;
/** Tras un error del bridge para un tile, no se re-propone hasta pasado esto.
 *  Sin cooldown, un jugador parado junto a la frontera con el motor narrativo
 *  caído re-pediría el tile en cada frame (spam de errores en bucle). */
export const COOLDOWN_TRAS_ERROR_MS = 15_000;

/** Los cuatro bordes, en el orden en que se recorren (empates: gana el primero). */
const BORDES: readonly Edge[] = ["north", "south", "east", "west"];

/** Por qué se pide un tile. Es el valor que viaja al bridge tal cual. */
export type MotivoDePeticion = "prefetch" | "blocking";

/** Pedirle al motor que genere el vecino. GASTA. */
export type PedirTile = (tx: number, ty: number, edge: Edge, motivo: MotivoDePeticion) => void;

/** Lo que la frontera necesita saber del mundo del cliente: si hay plano
 *  continuo (sin él no hay frontera que vigilar) y qué tiles existen ya. */
export interface TilesDelPlano {
  readonly hayGrid: boolean;
  tiene(tx: number, ty: number): boolean;
}

/** El muro de niebla a pintar: sobre qué borde y con qué texto. */
export interface Velo {
  edge: Edge;
  text: string;
}

/** Tile vecino sin generar cerca del jugador, a la espera de confirmación.
 *  Su forma es la que publica `debugState()` y leen los guiones del banco
 *  (`__nefan.frontier.proposal`): no se renombra. */
export interface PropuestaDeTile {
  key: string;
  tx: number;
  ty: number;
  edge: Edge;
}

/** Un frame de frontera: qué velo pintar (o ninguno), qué peticiones vencieron
 *  por timeout y qué propuesta hay sobre la mesa. */
export interface FrameDeFrontera {
  velo: Velo | null;
  vencidos: string[];
  propuesta: PropuestaDeTile | null;
}

export class Frontera {
  /** key del tile → instante de la petición (dedupe + timeout). */
  readonly #pedidos = new Map<string, number>();
  /** Tiles ya re-pedidos como blocking (para promover solo una vez). */
  readonly #bloqueoEnviado = new Set<string>();
  /** key del tile → instante del último error (cooldown antes de reintentar). */
  readonly #errorEn = new Map<string, number>();
  /** Texto de estado por tile (lo actualizan los narrative_status). */
  readonly #textoDeEstado = new Map<string, string>();
  /** Tiles que el jugador rechazó generar. Se limpian al alejarse del borde,
   *  así la propuesta reaparece si vuelve (rechazo ≠ veto permanente). */
  readonly #rechazados = new Set<string>();
  /** Propuesta activa (recalculada cada tick; borde más cercano gana). */
  #propuesta: PropuestaDeTile | null = null;

  /** Llamar cada frame con la posición del jugador. Propone tiles que faltan
   *  cerca (pendientes de `confirmar`) y devuelve el velo a pintar (o null) más
   *  las peticiones vencidas. */
  tick(now: number, px: number, pz: number, tiles: TilesDelPlano, pedir: PedirTile): FrameDeFrontera {
    const vencidos: string[] = [];
    for (const [key, pedidoEn] of this.#pedidos) {
      if (now - pedidoEn > TIMEOUT_DE_TILE_MS) {
        this.#olvidar(key);
        vencidos.push(key);
      }
    }
    if (!tiles.hayGrid) {
      this.#propuesta = null;
      return { velo: null, vencidos, propuesta: null };
    }

    const t = worldToTile(px, pz);
    const rect = tileWorldRect(t.tx, t.ty);
    const distancia: Record<Edge, number> = {
      west: px - rect.minX,
      east: rect.maxX - px,
      north: pz - rect.minZ,
      south: rect.maxZ - pz,
    };

    let velo: Velo | null = null;
    let distVelo = Infinity;
    let propuesta: PropuestaDeTile | null = null;
    let distPropuesta = Infinity;
    const bordesCerca: Edge[] = [];
    const clavesCerca = new Set<string>();
    for (const edge of BORDES) {
      const n = neighborTile(t.tx, t.ty, edge);
      if (tiles.tiene(n.tx, n.ty)) continue;
      const d = distancia[edge];
      const key = tileKey(n.tx, n.ty);
      if (d < PROPONER_A_M) {
        bordesCerca.push(edge);
        clavesCerca.add(key);
        // La generación gasta LLM/créditos: se PROPONE (borde más cercano
        // gana) y solo se pide tras confirmar(). Nunca se auto-dispara.
        if (this.#puedeProponer(now, key) && d < distPropuesta) {
          distPropuesta = d;
          propuesta = { key, tx: n.tx, ty: n.ty, edge };
        }
      }
      // Pegado al borde esperando: promover la petición a blocking (una vez).
      if (d < BLOQUEO_A_M && this.#pedidos.has(key) && !this.#bloqueoEnviado.has(key)) {
        this.#bloqueoEnviado.add(key);
        pedir(n.tx, n.ty, edge, "blocking");
      }
      if (d < VELO_A_M && d < distVelo) {
        distVelo = d;
        velo = {
          edge,
          text: this.#pedidos.has(key)
            ? (this.#textoDeEstado.get(key) ?? "Explorando lo desconocido")
            : "Zona sin generar",
        };
      }
    }
    // Esquina: dos bordes cercanos CONFIRMADOS → pedir también el diagonal
    // para que no quede un hueco visible al caminar en diagonal. La esquina
    // no se pregunta aparte: la cubre la confirmación de sus dos bordes.
    if (
      bordesCerca.length === 2 &&
      bordesCerca.every((e) => {
        const n = neighborTile(t.tx, t.ty, e);
        return this.#pedidos.has(tileKey(n.tx, n.ty));
      })
    ) {
      const dx = bordesCerca.includes("east") ? 1 : bordesCerca.includes("west") ? -1 : 0;
      const dy = bordesCerca.includes("south") ? 1 : bordesCerca.includes("north") ? -1 : 0;
      if (dx !== 0 && dy !== 0 && !tiles.tiene(t.tx + dx, t.ty + dy)) {
        this.#pedirUnaVez(now, t.tx + dx, t.ty + dy, dx > 0 ? "east" : "west", pedir);
      }
    }
    // Rechazos de tiles ya lejanos se olvidan: al volver se re-propone.
    for (const key of this.#rechazados) {
      if (!clavesCerca.has(key)) this.#rechazados.delete(key);
    }
    this.#propuesta = propuesta;
    return { velo, vencidos, propuesta };
  }

  /** El jugador acepta la propuesta activa: se pide la generación del tile. */
  confirmar(now: number, pedir: PedirTile): void {
    if (!this.#propuesta) return;
    const { tx, ty, edge } = this.#propuesta;
    this.#propuesta = null;
    this.#pedirUnaVez(now, tx, ty, edge, pedir);
  }

  /** El jugador rechaza la propuesta activa: no se re-propone hasta que se
   *  aleje del borde y vuelva. */
  rechazar(): void {
    if (!this.#propuesta) return;
    this.#rechazados.add(this.#propuesta.key);
    this.#propuesta = null;
  }

  #puedeProponer(now: number, key: string): boolean {
    if (this.#pedidos.has(key) || this.#rechazados.has(key)) return false;
    return !this.#enCooldown(now, key);
  }

  #enCooldown(now: number, key: string): boolean {
    const errorEn = this.#errorEn.get(key);
    return errorEn !== undefined && now - errorEn < COOLDOWN_TRAS_ERROR_MS;
  }

  #pedirUnaVez(now: number, tx: number, ty: number, edge: Edge, pedir: PedirTile): void {
    const key = tileKey(tx, ty);
    if (this.#pedidos.has(key) || this.#enCooldown(now, key)) return;
    this.#errorEn.delete(key);
    this.#pedidos.set(key, now);
    pedir(tx, ty, edge, "prefetch");
  }

  /** Una petición deja de estar en vuelo: por timeout, por llegar o por fallar. */
  #olvidar(key: string): boolean {
    this.#textoDeEstado.delete(key);
    this.#bloqueoEnviado.delete(key);
    return this.#pedidos.delete(key);
  }

  /** Texto de progreso que llega por narrative_status para un tile pedido.
   *  `false` si el tile no está pedido: el texto de un tile que nadie espera no
   *  se guarda. */
  alTexto(tx: number, ty: number, texto: string): boolean {
    const key = tileKey(tx, ty);
    if (!this.#pedidos.has(key)) return false;
    this.#textoDeEstado.set(key, texto);
    return true;
  }

  /** Tile completado: desmarca la petición y devuelve el borde del tile del
   *  JUGADOR hacia el nuevo tile (para el aviso direccional), o null si no es
   *  vecino inmediato. */
  alTileListo(tx: number, ty: number, px: number, pz: number): Edge | null {
    this.#olvidar(tileKey(tx, ty));
    const t = worldToTile(px, pz);
    for (const edge of BORDES) {
      const n = neighborTile(t.tx, t.ty, edge);
      if (n.tx === tx && n.ty === ty) return edge;
    }
    return null;
  }

  /** Error del bridge para un tile pedido: permite reintentar tras un cooldown
   *  (evita el bucle petición→error→petición pegado a la frontera). `now` es el
   *  MISMO reloj que recibe `tick`: el cooldown se mide contra él. Devuelve si
   *  el tile estaba pedido. */
  alError(tx: number, ty: number, now: number): boolean {
    const key = tileKey(tx, ty);
    this.#errorEn.set(key, now);
    return this.#olvidar(key);
  }

  /** OLVIDA LA PARTIDA: todo lo que esta frontera sabía era de UN mundo.
   *
   *  Lo que guarda —qué tiles se pidieron, cuáles rechazó el jugador, qué
   *  bordes ya se promovieron a `blocking`, qué error enfría a cuál y hasta
   *  cuándo— son coordenadas de tile (`tile_1_0`), y esas coordenadas
   *  significan otra cosa en cada partida. Sin este olvido, `#pedidos`
   *  sobrevivía al cambio de mundo y la frontera creía en vuelo un tile que
   *  nadie ha pedido: no se propone (`#puedeProponer` sale por `#pedidos`), no
   *  se pinta el velo de «sin generar» sino el de «explorando», y el timeout
   *  del mundo anterior vence en el nuevo con el aviso de un tile que no
   *  existe. Y al revés cuesta dinero: un `#errorEn` heredado calla la
   *  propuesta 15 s, y un rechazo heredado la calla hasta que el jugador se
   *  aleje 16 m de un borde que en este mundo puede ser el de partida.
   *
   *  Lo llama el cliente como FACETA de sesión (`session-facets.ts`), por el
   *  mismo camino que vaciar el mundo y cerrar el diálogo: no es una línea que
   *  nadie tenga que acordarse de escribir en los dos retornos al título
   *  (#517; la forma exacta del bug de #249). */
  olvidarLaPartida(): void {
    this.#pedidos.clear();
    this.#bloqueoEnviado.clear();
    this.#errorEn.clear();
    this.#textoDeEstado.clear();
    this.#rechazados.clear();
    this.#propuesta = null;
  }

  /** La propuesta que hay AHORA MISMO sobre la mesa, o `null`.
   *
   *  Es la fuente de la que el proveedor de input deriva si Y/N significan algo
   *  (#329). Se recalcula en cada `tick`, así que fuera del bucle puede estar
   *  VIEJA — quien la lea tiene que acompañarla de las mismas guardas con las
   *  que el bucle decide llamar a `tick` (hay partida y el mundo tiene tiles de
   *  grid). */
  get propuesta(): PropuestaDeTile | null {
    return this.#propuesta;
  }

  /** Estado para el hook `__nefan.frontier` del banco. La FORMA es contrato con
   *  los guiones de `qa/` (05, 10, 42, 58 la leen): no se traduce. */
  debugState(): { requested: string[]; declined: string[]; proposal: PropuestaDeTile | null } {
    return {
      requested: [...this.#pedidos.keys()],
      declined: [...this.#rechazados],
      proposal: this.#propuesta,
    };
  }
}
