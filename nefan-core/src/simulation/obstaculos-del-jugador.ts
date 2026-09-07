/** LO QUE FRENA AL JUGADOR y no es terreno: la frontera del plano y las cajas
 *  de los objetos que el plan del tile no pinta.
 *
 *  Son las dos fuentes de solidez que `pasoDelJugador` pregunta a través de su
 *  `solido(x, z)` y que el collider de terreno no cubre. Vivían dentro de
 *  `nefan-html/src/world/collision.ts` sin un solo test detrás (#241, #489) y
 *  son regla de juego: por dónde se sale del mundo conocido y con qué se choca.
 *
 *  Mismo molde que su vecino `paso-del-jugador.ts`: entran dos puntos y el
 *  mundo como argumento, y sale un sí o un no. Sin DOM, sin estado y sin tocar
 *  nada. La ALTURA no participa en ninguna de las dos: la huella colisionable
 *  es XZ (CLAUDE.md), y aquí no hay ni campo que leer.
 */

import type { DuenoDeEntity } from "../session/entidades-del-tile.js";
import type { TileCoord } from "../scene/tile.js";

/** Re-exportado porque quien monte un `ObstaculoAabb` lo necesita, como hace
 *  `renderer/types.ts` con el tipo al que pertenece el campo. */
export type { DuenoDeEntity };

/** El mundo de tiles visto por la FRONTERA: solo lo que necesita preguntar. Lo
 *  implementa el `TileStore` del cliente. */
export interface TilesDelMundo {
  /** ¿Hay mundo? Sin un solo tile no hay frontera que cruzar. */
  readonly hayGrid: boolean;
  /** Coords de los tiles que toca el círculo (x, z, radio) — a lo sumo 4. */
  tocados(x: number, z: number, radio: number): readonly TileCoord[];
  tiene(tx: number, ty: number): boolean;
}

/** El mundo de tiles visto por las CAJAS: aparte de `TilesDelMundo` porque le
 *  hacen otra pregunta, y una sola. El cliente lo implementa con el mismo
 *  `TileStore`; el motivo de la pregunta está en `aabbBloquea`. */
export interface PlanDeLosTiles {
  /** ¿El tile que contiene (x, z) tiene INSTALADA la colisión de su plan
   *  (`svgApplied`)? */
  planAplicadoEn(x: number, z: number): boolean;
}

/** Un obstáculo de caja: lo que el cliente monta como objeto desde la world
 *  scene o desde un spawn del motor. */
export interface ObstaculoAabb {
  pos: { x: number; z: number };
  /** Huella en METROS (XZ). Sin ella no hay caja que probar. */
  sizeXZ?: { x: number; z: number } | null;
  /** Categoría de render: solo `building` y `prop` frenan. */
  category?: string;
  /** DE QUIÉN ES, que es lo que decide qué caja se le aplica. Es la unión
   *  discriminada y OBLIGATORIA de `session/entidades-del-tile.ts` (#350), no
   *  un booleano suelto: «lo puso el motor» y «se me olvidó decirlo» no pueden
   *  colapsar en el mismo valor, y `tsc` exige el campo en todo sitio que
   *  construya una entity. Ver `aabbBloquea`, que es quien lo lee. */
  dueno: DuenoDeEntity;
}

/** La FRONTERA del plano: un tile INEXISTENTE es un sólido virtual con
 *  semántica «salir sí, entrar no» — bloquea el movimiento HACIA él pero nunca
 *  el de vuelta. Con la resolución por ejes de `pasoDelJugador` esto da el
 *  bloqueo DIRECCIONAL gratis: pegado al borde este solo se bloquea +x; ±z y −x
 *  siguen libres.
 *
 *  El ORIGEN importa: los tiles que faltan y que ya se tocaban desde donde
 *  estás no cuentan. Sin eso, quien apareciera rozando un tile ausente se
 *  quedaría clavado sin poder alejarse. */
export function fronteraBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  tiles: TilesDelMundo,
): boolean {
  if (!tiles.hayGrid) return false;
  const faltanEnDestino = tiles.tocados(hasta.x, hasta.z, radio).filter((t) => !tiles.tiene(t.tx, t.ty));
  if (faltanEnDestino.length === 0) return false;
  const enElOrigen = new Set(tiles.tocados(desde.x, desde.z, radio).map((t) => `${t.tx},${t.ty}`));
  return faltanEnDestino.some((t) => !enElOrigen.has(`${t.tx},${t.ty}`));
}

/** Las CAJAS de los objetos que el plan del tile NO pinta, con la misma regla
 *  «salir sí, entrar no»: un obstáculo que ya solapa el ORIGEN no bloquea (se
 *  puede des-penetrar tras un spawn solapado); solo bloquean los NUEVOS.
 *
 *  QUÉ CAJA SE APLICA LO DECIDE EL ORIGEN DEL OBJETO, y ahí está el arreglo de
 *  #489. Hasta el 2026-09-07 se preguntaba UNA cosa para todos —si el TILE de
 *  debajo tenía la colisión del plan aplicada— y, como todo tile del motor la
 *  tiene desde que llega, se saltaban TODAS las cajas: también las de lo que el
 *  motor spawnea a mitad de partida, que no está en el plan de ningún tile y no
 *  era sólido por ninguna otra vía. El jugador veía una forja de 4×4 m y la
 *  atravesaba.
 *
 *  Los dos orígenes no tienen el mismo problema, así que no comparten regla:
 *
 *   · lo que DECLARA un tile conserva su semántica de siempre (su caja se
 *     aplica solo mientras el plan de ese tile no esté instalado). El plan
 *     dibuja esos edificios con sus muros y sus puertas, y aplicar además la
 *     caja ciega taparía el vano; pero si la derivación falla el tile se
 *     quedaría SIN NINGUNA fuente de solidez, así que la caja sigue siendo su
 *     red de seguridad. Un `prop` tapado por un volumen declarado tampoco
 *     cambia de conducta: es del tile, y el plan responde por él.
 *   · lo que puso el MOTOR a mitad de partida no está en el plan de nadie: su
 *     caja es lo único que hay y se aplica siempre.
 *
 *  Nótese que la pregunta por el plan es POR PUNTO y no por dueño: el tile que
 *  responde es el que contiene al objeto, igual que antes. */
export function aabbBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  obstaculos: readonly ObstaculoAabb[],
  plan: PlanDeLosTiles,
): boolean {
  for (const obj of obstaculos) {
    if (!obj.sizeXZ) continue;
    if (obj.category !== "building" && obj.category !== "prop") continue;
    if (obj.dueno.de === "tile" && plan.planAplicadoEn(obj.pos.x, obj.pos.z)) continue;
    const hx = obj.sizeXZ.x / 2 + radio;
    const hz = obj.sizeXZ.z / 2 + radio;
    if (Math.abs(hasta.x - obj.pos.x) < hx && Math.abs(hasta.z - obj.pos.z) < hz) {
      const yaDentro = Math.abs(desde.x - obj.pos.x) < hx && Math.abs(desde.z - obj.pos.z) < hz;
      if (!yaDentro) return true;
    }
  }
  return false;
}
