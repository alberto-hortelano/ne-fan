/** Colisión server-side por tile para la vida ambiental de NPCs.
 *
 *  Espejo del CollisionSystem del cliente (fuentes en unión), construido solo
 *  con lo que el bridge tiene persistido en NarrativeState:
 *  1. terrain_grid del esquema (formatDToWorld — el agua w; los muros son plan);
 *  2. PLAN COMPUESTO (`__plan` de la world scene: lo declarado por el motor
 *     MÁS lo derivado del esquema — entities estáticas y la vegetación de
 *     masa), rasterizado con la MISMA función de core que el cliente
 *     (planCollisionGrid), no dos colliders OR'd — así jugador y NPCs
 *     colisionan idéntico. Antes aquí solo entraban los `volumes`
 *     DECLARADOS, así que en un tile cuyo pueblo se derivaba del esquema los
 *     NPCs se metían dentro de las casas.
 *
 *  3. LAS CAJAS DE LOS SPAWNS DE RUNTIME (#583): lo que el motor pone a mitad
 *     de partida, que no está en el plan de ningún tile. Fuente y geometría en
 *     `src/simulation/cajas-de-runtime.ts`, la misma `cajaBloquea` con la que
 *     se para el jugador.
 *
 *  LA REGLA DE PASO ES DE CORE Y ES LA MISMA PARA LAS DOS GEOMETRÍAS desde
 *  #616: penetración no creciente. Lo que este fichero aporta del TILE es el
 *  SUELO —la unión de los colliders de los tiles tocados en una sola consulta
 *  de punto—, no una segunda cuenta. Hasta entonces la regla del tile vivía
 *  dentro del collider, eximía CELDAS en vez de penetración y no sacaba a
 *  nadie de un macizo.
 *
 *  Lazy + caché por REGISTRO de escena para (1) y (2): nada revisa un plan ya
 *  emitido, y cada registro nuevo trae su entrada, así que no hay que
 *  invalidar nada (ver `cache` abajo: por `sceneId` cacheaba la ausencia). Un grid inconsistente degrada ese tile a
 *  "sin esa fuente" con warning (mismo patrón que el cliente), nunca tumba el
 *  tick. Las cajas de (3) NO entran en esa caché y no tienen otra: aparecen a
 *  mitad de partida, que es justo cuando una caché por escena miente, así que
 *  se derivan en cada consulta.
 *
 *  EL COSTE, RE-MEDIDO con la regla de #616 puesta (Ryzen 7 5800X, Node 24,
 *  mediana de 7 corridas) AL RITMO REAL DEL SIM, que es un tick por FRAME del
 *  cliente —60/s, no 20: `main.ts` → `handlers/simulation.ts` →
 *  `game-loop.ts`—. Por tick y NPC hay una consulta de salida y las de paso:
 *  UNA si el rumbo directo está libre, que es lo normal, y siete en el peor
 *  caso. Con 10 NPCs EN ABIERTO, milisegundos de CPU por cada segundo de
 *  juego, en el hilo del bridge:
 *
 *    entities de runtime │ caso normal │ peor caso
 *                      0 │     1,8 ms  │    3,4 ms
 *                     50 │     4,5 ms  │   18,5 ms
 *                    200 │    15,6 ms  │   63,4 ms
 *                    600 │    52,8 ms  │  218,3 ms  (22 % de un núcleo)
 *                  1.200 │   108,9 ms  │  436,8 ms
 *                  2.400 │   219,8 ms  │  879,8 ms  (88 %)
 *
 *  La tabla NO SE MOVIÓ con #616, y ese es el dato: el cuerpo que está FUERA
 *  de todo corta en seco —`solidoBloquea` con el origen libre es una consulta
 *  de punto y nada más— y aislada, la regla nueva es incluso más barata que la
 *  que sustituye (0,05 µs contra 0,08). El coste sigue mandándolo el número de
 *  cajas de runtime, que es código que esta tanda no toca.
 *
 *  LO QUE SÍ ESTRENA #616 es el precio del cuerpo que está DENTRO de algo, que
 *  antes no se pagaba porque no se salía: aislada, la regla pasa de 0,05 a
 *  0,98 µs (×19), y a través de este proveedor —que por cada consulta de punto
 *  resuelve los tiles tocados y sus colliders— `queImpideElPaso` cuesta 18 µs
 *  contra 0,66 fuera, y `porDondeSalirDeAqui` 8,4 contra 0,34. Con los DIEZ
 *  NPCs metidos en geometría a la vez y en el peor caso son 86 ms por segundo
 *  de juego, un 9 % de núcleo, y es TRANSITORIO: se paga mientras salen, uno o
 *  dos segundos, donde antes se quedaban dentro para siempre. Si algún día
 *  dejara de ser transitorio, lo barato es memoizar la penetración del ORIGEN
 *  —`pasoDelJugador` la pide dos veces por frame con el mismo punto—, no
 *  cachear aquí.
 *
 *  DÓNDE DEJA DE SER GRATIS: hasta 200 es ruido; **a partir de 600** el peor
 *  caso se lleva un quinto de núcleo del hilo que además mueve el combate, el
 *  WS y los saves, y a 2.400 se lo come entero. ¿Se llega? El ledger NO SE
 *  PODA NUNCA (desde #326 hasta los muertos se quedan) y cada `spawn_entity`
 *  suma uno: son 200-600 turnos narrativos. No es inminente y no es teórico, y
 *  hoy nada lo limita ni lo avisa. Doscientas entities que vengan del TILE
 *  cuestan 0,9 ms: lo que no pasa el filtro de `spawn_reason` no llega a
 *  construirse. Es LINEAL, así que el sitio donde se arregla es el ledger —no
 *  una caché aquí, que vuelve a tener el problema que este diseño evita.
 *
 *  LO QUE NO ENTRA AQUÍ, y no es una divergencia de proceso: la FRONTERA del
 *  plano, que es del JUGADOR. Un NPC no se frena en el borde del mundo
 *  conocido — su tile existe: es donde vive.
 *
 *  Hasta #583 esa exclusión decía también «ni necesita la caja ciega de lo que
 *  el plan ya le pone delante», y era cierta para las cajas DEL TILE y callaba
 *  sobre las de runtime, que no están en el plan de nadie: una justificación
 *  escrita sobre un caso y dejada cubriendo dos. Lo que sigue en pie es que la
 *  caja de una entity del tile NO se aplica aquí (la aplica su volumen
 *  derivado, con sus vanos); lo que entró es la de lo que el motor spawnea. */

import type { NarrativeState } from "../src/narrative/narrative-state.js";
import type { SceneRecord } from "../src/narrative/types.js";
import { createTerrainCollider, type TerrainCollider } from "../src/scene/terrain-collision.js";
import { formatDToWorld } from "../src/scene/scene-normalize.js";
import {
  planCollisionGrid,
  type CollisionGridDims,
  type GroundFeature,
  type Volume,
} from "../src/scene/blueprint/index.js";
import type { TilePlan } from "../src/scene/tile-plan.js";
import {
  cajaQueBloquea,
  cajaQueContiene,
  cajasDeRuntime,
  salidaDeLasCajas,
  type CajaDeRuntime,
  type Impedimento,
  type PorDondeSalir,
} from "../src/simulation/cajas-de-runtime.js";
import {
  salidaDelSolido,
  solidoBloquea,
  type SueloSolido,
} from "../src/simulation/salida-del-solido.js";
import { tileKey, tileWorldRect, worldToTile, type WorldRect } from "../src/scene/tile.js";
import { rutaPorElSuelo, type Punto, type Ruta } from "../src/simulation/ruta-por-el-suelo.js";

export interface SimCollisionProvider {
  /** QUÉ impide este paso, no solo si algo lo impide: el escape del
   *  encajonado (#583) solo puede abrirse sobre una caja de runtime. */
  queImpideElPaso(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): Impedimento;
  /** POR DÓNDE SALIR de lo que te tiene dentro, o `null` si no te tiene nada:
   *  de QUÉ se sale y el rumbo hacia su cara más cercana.
   *
   *  Existe porque «salir sí, entrar no» no saca a quien no empuja: un NPC
   *  sondea rumbos hacia su meta y ninguno le sacaba (#583, QA H-2). Desde #616
   *  contesta por las DOS fuentes, y el TERRENO va primero: es la que nadie
   *  atraviesa, así que un cuerpo metido en un muro Y en una caja tiene que
   *  salir del muro — el otro orden le mandaría contra él. */
  porDondeSalirDeAqui(x: number, z: number, radius: number): PorDondeSalir | null;
  /** ¿ESTE SITIO ESTÁ OCUPADO? La consulta de PUNTO sobre TODAS las fuentes
   *  —el grid del terreno, el del plan y las cajas de runtime—, con el solape
   *  ABIERTO de `SueloSolido.ocupado` (`src/simulation/salida-del-solido.ts`).
   *  Es lo que este proveedor le enseña a la cuenta de salida, y lo que
   *  consulta quien tiene que poner a alguien en un punto del mundo. */
  ocupado(x: number, z: number, radius: number): boolean;
  /** El mismo veredicto colapsado a un sí/no. Producción pregunta por
   *  `queImpideElPaso` desde #583 —el sim necesita saber QUÉ le frena—; esto
   *  se queda para quien solo quiera comparar este proveedor con la colisión
   *  del cliente, que contesta booleanos (`test/plan-collision.test.ts`).
   *  Lleva el nombre de la pregunta que contesta y no el del método inglés del
   *  collider de terreno, que es como se llamaba: ese método lo retiró #616 y
   *  su nombre está hoy en `campos-retirados-no-vuelven`. */
  algoImpideElPaso(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
  /** POR DÓNDE IR de `desde` a un sitio libre junto a `hasta` (#618): A* sobre
   *  el MISMO suelo que `ocupado` —terreno, plan y cajas de runtime—, así que
   *  la ruta ve exactamente lo que después frena el paso. Las cajas se derivan
   *  UNA vez por plan: el A* pregunta por cientos de celdas y re-derivarlas en
   *  cada una es lo que hacía costar 172 ms un plan con 200 cajas (medido en el
   *  plan de la tanda BO) en vez de ~9. */
  buscarRuta(desde: Punto, hasta: Punto, radius: number): Ruta;
}

/** Collider del PLAN ya compuesto (agua∖decks del ground + huellas de los
 *  volumes), rasterizado con la MISMA función de core que el cliente
 *  (applyPlanCollision) — un solo grid, no dos colliders OR'd, para que
 *  jugador y NPCs colisionen idéntico. El bridge NO deriva: lee `__plan`, que
 *  ya viene compuesto de la normalización. */
function buildPlanCollider(
  sceneId: string,
  plan: { ground?: GroundFeature[]; volumes?: Volume[] },
  rect: WorldRect,
  dims?: CollisionGridDims,
): TerrainCollider | null {
  const ground = plan.ground?.length ? plan.ground : undefined;
  const volumes = plan.volumes?.length ? plan.volumes : undefined;
  if (!ground && !volumes) return null;
  try {
    return createTerrainCollider(planCollisionGrid(ground, volumes, rect, dims));
  } catch (err) {
    console.warn(`[sim-collision] ${sceneId}: plan no deriva colisión —`, err);
    return null;
  }
}

export function createSimCollisionProvider(narrative: NarrativeState): SimCollisionProvider {
  /** LA CACHÉ VA POR REGISTRO DE ESCENA, no por `sceneId`. Iba por id, y
   *  guardaba `[]` para un tile todavía NO GENERADO la primera vez que alguien
   *  preguntaba por él —desde #618 lo hace `npc_arrive`, que mira el suelo del
   *  lugar de destino antes de soltar al NPC— y nunca invalidaba: cuando el
   *  tile se realizaba, el sim lo seguía viendo vacío y NPCs y jugador
   *  atravesaban sus edificios (QA de BL, H1). Por id se cruzaba además entre
   *  sesiones del mismo bridge. Cada `recordSceneLoaded` crea un registro
   *  NUEVO, así que con el registro como clave: la ausencia no se cachea
   *  (no hay registro), un tile que se genera o se re-registra trae el suyo, y
   *  otra sesión trae los suyos. Nada que invalidar a mano. */
  const cache = new WeakMap<SceneRecord, TerrainCollider[]>();

  function buildColliders(sceneId: string, rec: SceneRecord): TerrainCollider[] {
    const colliders: TerrainCollider[] = [];

    // 1. terrain_grid del esquema. De la misma normalización sale el plan
    // compuesto (2). Una escena que no sea Format D expandido lanza y se dice.
    let plan: TilePlan | null = null;
    try {
      const world = formatDToWorld(rec.scene_data);
      plan = world.__plan ?? null;
      const tc = createTerrainCollider(world.terrain_grid);
      if (tc) colliders.push(tc);
    } catch (err) {
      console.warn(`[sim-collision] ${sceneId}: terrain_grid no deriva colisión —`, err);
    }

    // 2. El plan compuesto, sobre el rect mundial del tile.
    if (plan) {
      const planCollider = buildPlanCollider(
        sceneId,
        plan,
        tileWorldRect(rec.tile.tx, rec.tile.ty),
      );
      if (planCollider) colliders.push(planCollider);
    }
    return colliders;
  }

  function collidersFor(sceneId: string): TerrainCollider[] {
    const rec = narrative.scenes_loaded[sceneId];
    if (!rec) return [];
    let entry = cache.get(rec);
    if (!entry) {
      entry = buildColliders(sceneId, rec);
      cache.set(rec, entry);
    }
    return entry;
  }

  /** ¿Algún collider de los tiles que toca el AABB del círculo (≤4) cumple
   *  `pred`? Recorre el rango de tiles de las dos esquinas en vez de reunir
   *  las cuatro en un `Set`: es la consulta que el A* repite por cada celda
   *  nueva (#618), y el `Set` con sus strings era un tercio de lo que costaba
   *  un plan (perfil de la tanda BO). */
  function algunCollider(x: number, z: number, radius: number, pred: (tc: TerrainCollider) => boolean): boolean {
    const t0 = worldToTile(x - radius, z - radius);
    const t1 = worldToTile(x + radius, z + radius);
    for (let ty = t0.ty; ty <= t1.ty; ty++) {
      for (let tx = t0.tx; tx <= t1.tx; tx++) {
        for (const tc of collidersFor(tileKey(tx, ty))) if (pred(tc)) return true;
      }
    }
    return false;
  }

  /** La geometría DURA vista como un SUELO: terreno y plan de los tiles que
   *  toca el cuerpo, unidos en una sola consulta de punto. Es lo que
   *  `salida-del-solido.ts` necesita para medir sobre la UNIÓN y no tile a
   *  tile: un cuerpo a caballo de dos tiles tiene UNA penetración, no dos. */
  const sueloDelTile: SueloSolido = {
    ocupado(x, z, radio) {
      return algunCollider(x, z, radio, (tc) => tc.solapaSolido(x, z, radio));
    },
  };

  /** El suelo ENTERO: la cuenta de `ocupado` escrita una vez. La usan la
   *  consulta suelta, que deriva las cajas solo si el tile no contestó ya, y el
   *  plan de ruta, que las deriva UNA vez para todas sus celdas. */
  function sueloCon(cajas: () => readonly CajaDeRuntime[]): SueloSolido {
    return {
      ocupado: (x, z, radio) =>
        sueloDelTile.ocupado(x, z, radio) || cajaQueContiene(x, z, radio, cajas()) !== null,
    };
  }
  const cajasVivas = () => cajasDeRuntime(narrative.entities);

  const provider: SimCollisionProvider = {
    // El TILE primero y la caja después, y el orden es la regla: quien lee
    // esto para decidir si atraviesa solo puede atravesar cajas, así que un
    // paso que además choca con un muro tiene que salir como "tile".
    queImpideElPaso(fromX, fromZ, toX, toZ, radius): Impedimento {
      if (solidoBloquea({ x: fromX, z: fromZ }, { x: toX, z: toZ }, radius, sueloDelTile)) {
        return { de: "tile" };
      }
      const caja = cajaQueBloquea(
        { x: fromX, z: fromZ },
        { x: toX, z: toZ },
        radius,
        cajasDeRuntime(narrative.entities),
      );
      return caja ? { de: "caja", id: caja.id } : null;
    },
    algoImpideElPaso(fromX, fromZ, toX, toZ, radius): boolean {
      return provider.queImpideElPaso(fromX, fromZ, toX, toZ, radius) !== null;
    },
    // El TERRENO primero, por el mismo motivo que en `queImpideElPaso`: es lo
    // que no se atraviesa. A quien le cae una caja encima DENTRO de un muro,
    // sacarle primero por la cara de la caja le empujaría contra el muro.
    porDondeSalirDeAqui(x, z, radius): PorDondeSalir | null {
      const delTile = salidaDelSolido(x, z, radius, sueloDelTile);
      if (delTile) return { de: "tile", dir: delTile.dir };
      return salidaDeLasCajas(x, z, radius, cajasDeRuntime(narrative.entities));
    },
    blocksCircle(x, z, radius): boolean {
      if (algunCollider(x, z, radius, (tc) => tc.blocksCircle(x, z, radius))) return true;
      return cajaQueContiene(x, z, radius, cajasDeRuntime(narrative.entities)) !== null;
    },
    ocupado(x, z, radius): boolean {
      return sueloCon(cajasVivas).ocupado(x, z, radius);
    },
    buscarRuta(desde, hasta, radius): Ruta {
      const foto = cajasVivas();
      return rutaPorElSuelo(desde, hasta, radius, sueloCon(() => foto));
    },
  };
  return provider;
}
