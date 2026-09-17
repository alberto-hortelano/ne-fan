/** Colisión del mundo del cliente — CABLEADO, no decisión.
 *
 *  «¿(x, z) está bloqueado?» es la unión de tres fuentes, y ninguna se decide
 *  aquí: la FRONTERA del plano y las CAJAS de los objetos son de core
 *  (`simulation/obstaculos-del-jugador.ts`) y el TERRENO también lo es desde
 *  #616 (`simulation/salida-del-solido.ts`, penetración no creciente). Lo que
 *  el cliente aporta de este último es solo el SUELO: los colliders de cada
 *  tile tocado —`collider` (terrain_grid: el agua w) y `svgCollider` (el PLAN,
 *  derivado por `planCollisionGrid` — el MISMO cálculo que el bridge en
 *  sim-collision, así que jugador y NPCs no divergen)— unidos en una sola
 *  consulta de punto. Hasta #616 la regla del terreno vivía DENTRO del
 *  collider —eximía las celdas que ya se solapaban— y no sacaba de un macizo.
 *
 *  Aquí queda lo que no es regla: el `TileStore`, los colliders instalados y el
 *  `errors.push` de la derivación. Las dos reglas salieron en la PR 5 de #241
 *  (#489), que de paso arregló el salto de las cajas: se saltaban TODAS
 *  mirando el tile, y hoy solo las de los objetos que DECLARA un tile (que es
 *  lo que se saltaba antes y sigue igual), así que lo que el motor spawnea a
 *  mitad de partida pasó a ser sólido. Qué caja se aplica lo decide core; el
 *  cliente solo le pasa el dueño de cada objeto y el `svgApplied` del tile de
 *  debajo. */

import { createTerrainCollider, PLAYER_RADIUS_M } from "@nefan-core/src/scene/terrain-collision.js";
import { solidoBloquea, type SueloSolido } from "@nefan-core/src/simulation/salida-del-solido.js";
import {
  aabbBloquea,
  aabbOcupa,
  fronteraBloquea,
  type ObstaculoAabb,
  type PlanDeLosTiles,
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
  /** El `TileStore` visto como el mundo que preguntan las dos reglas de core:
   *  qué tiles EXISTEN (la frontera) y si el de debajo de un objeto tiene ya
   *  instalada la colisión de su plan (las cajas). Se construye una vez y lee
   *  en vivo (`hayGrid` es un getter): el store es mutable y la respuesta tiene
   *  que ser la de este frame. */
  private readonly tiles: TilesDelMundo & PlanDeLosTiles;

  constructor(private deps: CollisionDeps) {
    const { tileStore } = deps;
    this.tiles = {
      get hayGrid() {
        return tileStore.hasGridTiles;
      },
      tocados: (x, z, r) => tileStore.keysTouching(x, z, r),
      tiene: (tx, ty) => tileStore.has(tx, ty),
      planAplicadoEn: (x, z) => tileStore.getAt(x, z)?.svgApplied === true,
    };
    this.suelo = {
      ocupado: (x, z, radio) => {
        for (const t of tileStore.keysTouching(x, z, radio)) {
          const tile = tileStore.get(t.tx, t.ty);
          if (tile?.collider?.solapaSolido(x, z, radio)) return true;
          if (tile?.svgCollider?.solapaSolido(x, z, radio)) return true;
        }
        return false;
      },
    };
  }

  /** EL SUELO del jugador visto por la regla de core: los dos colliders
   *  (`collider` = terrain_grid, `svgCollider` = el PLAN) de TODOS los tiles
   *  que toca el cuerpo, unidos en una sola consulta de punto.
   *
   *  La unión es el cableado y no es un detalle: un cuerpo a caballo de dos
   *  tiles tiene UNA penetración, no dos, y preguntar tile a tile daría dos
   *  rumbos de salida que se pelean. Se construye una vez y lee en vivo — el
   *  store es mutable y la respuesta tiene que ser la de este frame. */
  private readonly suelo: SueloSolido;

  /** ¿El destino (x,z) está bloqueado para el jugador? Unión de las tres
   *  fuentes de la cabecera, en el orden más barato primero. */
  collidesAt(x: number, z: number): boolean {
    const desde = this.deps.getPlayerPos();
    const hasta = { x, z };
    if (fronteraBloquea(desde, hasta, PLAYER_RADIUS, this.tiles)) return true;
    if (solidoBloquea(desde, hasta, PLAYER_RADIUS, this.suelo)) return true;
    return aabbBloquea(desde, hasta, PLAYER_RADIUS, this.deps.getObstacles(), this.tiles);
  }

  /** ¿ESTÁ OCUPADO ESTE PUNTO? La pregunta SIN ORIGEN, y por eso su respuesta
   *  no depende de dónde esté el jugador (#644).
   *
   *  `collidesAt` es una consulta de MOVIMIENTO: las tres fuentes son «salir
   *  sí, entrar no», así que contestan que no por donde uno ya está. Eso es lo
   *  correcto para mover a alguien y es falso como descripción del mundo, y el
   *  banco lo estaba leyendo como si fuera lo segundo: el guion 91 sacó 46, 38
   *  y 0 muestras libres de las mismas 121 con el mismo código —dos de esas
   *  corridas en VERDE— porque el resultado dependía de dónde hubiera quedado
   *  el jugador. Esto no se arregla aparcándolo entre sondas (eso es un
   *  protocolo que hay que recordar en cada sitio, y el ejemplar que había lo
   *  cumplía a medias): se arregla con una pregunta que no tiene origen que
   *  olvidar.
   *
   *  DOS FUENTES, NO TRES, y se dice aquí en vez de dejarlo notar: el TERRENO
   *  (el suelo de los colliders) y las CAJAS con su política, que son las que
   *  tienen penetración. La FRONTERA del plano queda fuera a propósito — un
   *  tile que no existe no está «ocupado», es mundo desconocido, y no tiene una
   *  medida de cuánto se está metido en él. Consecuencia que hay que saber: a
   *  menos de un radio del borde del mundo conocido, `collidesAt` bloquea y
   *  esto contesta «libre». Lo que se pregunta es si HAY ALGO ahí, no si el
   *  jugador podría ir. */
  ocupadoEn(x: number, z: number, radio: number = PLAYER_RADIUS): boolean {
    if (this.suelo.ocupado(x, z, radio)) return true;
    return aabbOcupa({ x, z }, radio, this.deps.getObstacles(), this.tiles);
  }
}

// ── Instaladores del mundo derivado (colisión que llega en runtime) ────────

/** Colisión base del plan declarado: agua∖decks del `ground` + huellas de los
 *  volúmenes — instalada como collider base del tile, activa desde que llega
 *  el tile. Analítica pura (sin rasterizar nada). Si la derivación falla,
 *  `svgApplied` se queda a false y se dice: las cajas de los objetos de ESE
 *  tile vuelven a aplicar, que es la red de seguridad de siempre — toscas
 *  (tapan vanos), pero mejor que un pueblo entero atravesable.
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
    errors.push("scene", `plan de ${key} no deriva colisión; siguen las cajas de sus objetos`, err);
  }
}
