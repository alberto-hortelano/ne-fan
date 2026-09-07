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

import type { TileCoord } from "../scene/tile.js";

/** El mundo de tiles visto por la frontera: solo lo que necesita preguntar. Lo
 *  implementa el `TileStore` del cliente. */
export interface TilesDelMundo {
  /** ¿Hay mundo? Sin un solo tile no hay frontera que cruzar. */
  readonly hayGrid: boolean;
  /** Coords de los tiles que toca el círculo (x, z, radio) — a lo sumo 4. */
  tocados(x: number, z: number, radio: number): readonly TileCoord[];
  tiene(tx: number, ty: number): boolean;
}

/** Un obstáculo de caja: lo que el cliente monta como objeto desde la world
 *  scene o desde un spawn del motor. */
export interface ObstaculoAabb {
  pos: { x: number; z: number };
  /** Huella en METROS (XZ). Sin ella no hay caja que probar. */
  sizeXZ?: { x: number; z: number } | null;
  /** Categoría de render: solo `building` y `prop` frenan. */
  category?: string;
  /** El `volume_id` de la world scene: qué volumen del PLAN ya representa a
   *  este objeto. Ver `aabbBloquea`, que es quien lo usa. */
  volumeId?: string;
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
 *  El salto es POR OBJETO y no por tile, y ahí está el arreglo de #489: hasta
 *  el 2026-09-07 se preguntaba si el TILE bajo el objeto tenía la colisión del
 *  plan aplicada (`svgApplied`) y, como todo tile del motor la tiene desde que
 *  llega, se saltaban TODAS las cajas — incluidas las de lo que el motor
 *  spawnea a mitad de partida, que no está en el plan de ningún tile y no era
 *  sólido por ninguna otra vía. El jugador veía una forja de 4×4 m y la
 *  atravesaba.
 *
 *  La pregunta correcta es si ESE objeto ya lo representa un volumen del plan
 *  (`volumeId`): si lo representa, su solidez sale del grid —con sus puertas y
 *  sus huecos, que es justo lo que la caja ciega no tiene— y aplicarle además
 *  la caja taparía el vano; si no, la caja es lo único que hay. */
export function aabbBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  obstaculos: readonly ObstaculoAabb[],
): boolean {
  for (const obj of obstaculos) {
    if (!obj.sizeXZ) continue;
    if (obj.category !== "building" && obj.category !== "prop") continue;
    if (obj.volumeId !== undefined) continue;
    const hx = obj.sizeXZ.x / 2 + radio;
    const hz = obj.sizeXZ.z / 2 + radio;
    if (Math.abs(hasta.x - obj.pos.x) < hx && Math.abs(hasta.z - obj.pos.z) < hz) {
      const yaDentro = Math.abs(desde.x - obj.pos.x) < hx && Math.abs(desde.z - obj.pos.z) < hz;
      if (!yaDentro) return true;
    }
  }
  return false;
}
