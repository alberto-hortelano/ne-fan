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
 *  Lazy + caché por sceneId para (1) y (2): nada revisa un plan ya emitido,
 *  así que la caché no se invalida. Un grid inconsistente degrada ese tile a
 *  "sin esa fuente" con warning (mismo patrón que el cliente), nunca tumba el
 *  tick. Las cajas de (3) NO entran en esa caché y no tienen otra: aparecen a
 *  mitad de partida, que es justo cuando una caché por escena miente, así que
 *  se derivan en cada consulta.
 *
 *  EL COSTE, medido (Ryzen 7 5800X, Node 22, mediana de 7 corridas) AL RITMO
 *  REAL DEL SIM, que es un tick por FRAME del cliente —60/s, no 20:
 *  `main.ts` → `handlers/simulation.ts` → `game-loop.ts`—. Por tick y NPC hay
 *  una consulta de salida y las de paso: UNA si el rumbo directo está libre,
 *  que es lo normal, y siete en el peor caso. Con 10 NPCs, milisegundos de CPU
 *  por cada segundo de juego, en el hilo del bridge:
 *
 *    entities de runtime │ caso normal │ peor caso
 *                      0 │     0,4 ms  │    2,8 ms
 *                     50 │     4,6 ms  │   17,8 ms
 *                    200 │    15,1 ms  │   62,2 ms
 *                    600 │    53,9 ms  │  222,5 ms  (22 % de un núcleo)
 *                  1.200 │   109,6 ms  │  446,9 ms
 *                  2.400 │   214,9 ms  │  870,2 ms  (87 %)
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
  salidaDeSolido,
  type Impedimento,
  type SalidaDeSolido,
} from "../src/simulation/cajas-de-runtime.js";
import { tileKey, tileWorldRect, worldToTile, type WorldRect } from "../src/scene/tile.js";

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
   *  el id de la caja y el rumbo hacia su cara más cercana. Solo contesta por
   *  las cajas de runtime — de la geometría del tile no saca a nadie, y eso
   *  tiene número propio (#616).
   *
   *  Existe porque «salir sí, entrar no» no saca a quien no empuja: un NPC
   *  sondea rumbos hacia su meta y ninguno le sacaba (#583, QA H-2). */
  porDondeSalirDeAqui(x: number, z: number, radius: number): SalidaDeSolido | null;
  /** El mismo veredicto colapsado a un sí/no. Producción pregunta por
   *  `queImpideElPaso` desde #583 —el sim necesita saber QUÉ le frena—; esto
   *  se queda para quien solo quiera comparar este proveedor con el collider
   *  del cliente, que contesta booleanos (`test/plan-collision.test.ts`). */
  blocksMove(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  blocksCircle(x: number, z: number, radius: number): boolean;
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
  const cache = new Map<string, TerrainCollider[]>();

  function buildColliders(sceneId: string): TerrainCollider[] {
    const rec = narrative.scenes_loaded[sceneId];
    if (!rec) return [];
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
    let entry = cache.get(sceneId);
    if (!entry) {
      entry = buildColliders(sceneId);
      cache.set(sceneId, entry);
    }
    return entry;
  }

  /** Tiles del plano tocados por el AABB del círculo (≤4). */
  function touchedKeys(x: number, z: number, radius: number): string[] {
    const keys = new Set<string>();
    for (const [px, pz] of [
      [x - radius, z - radius], [x + radius, z - radius],
      [x - radius, z + radius], [x + radius, z + radius],
    ]) {
      const t = worldToTile(px, pz);
      keys.add(tileKey(t.tx, t.ty));
    }
    return [...keys];
  }

  /** La geometría DURA: terreno y plan del tile. Es la que nadie atraviesa. */
  function tileBloqueaElPaso(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
  ): boolean {
    for (const key of touchedKeys(toX, toZ, radius)) {
      for (const tc of collidersFor(key)) {
        if (tc.blocksMove(fromX, fromZ, toX, toZ, radius)) return true;
      }
    }
    return false;
  }

  const provider: SimCollisionProvider = {
    // El TILE primero y la caja después, y el orden es la regla: quien lee
    // esto para decidir si atraviesa solo puede atravesar cajas, así que un
    // paso que además choca con un muro tiene que salir como "tile".
    queImpideElPaso(fromX, fromZ, toX, toZ, radius): Impedimento {
      if (tileBloqueaElPaso(fromX, fromZ, toX, toZ, radius)) return { de: "tile" };
      const caja = cajaQueBloquea(
        { x: fromX, z: fromZ },
        { x: toX, z: toZ },
        radius,
        cajasDeRuntime(narrative.entities),
      );
      return caja ? { de: "caja", id: caja.id } : null;
    },
    blocksMove(fromX, fromZ, toX, toZ, radius): boolean {
      return provider.queImpideElPaso(fromX, fromZ, toX, toZ, radius) !== null;
    },
    porDondeSalirDeAqui(x, z, radius): SalidaDeSolido | null {
      return salidaDeSolido(x, z, radius, cajasDeRuntime(narrative.entities));
    },
    blocksCircle(x, z, radius): boolean {
      for (const key of touchedKeys(x, z, radius)) {
        for (const tc of collidersFor(key)) {
          if (tc.blocksCircle(x, z, radius)) return true;
        }
      }
      return cajaQueContiene(x, z, radius, cajasDeRuntime(narrative.entities)) !== null;
    },
  };
  return provider;
}
