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
 *
 *  LAS TRES FUENTES SON «SALIR SÍ, ENTRAR NO», Y CADA UNA MIRA SU ORIGEN. La
 *  frontera exime los tiles ausentes que YA se tocaban; el collider de terreno,
 *  las CELDAS que ya se solapaban (`terrain-collision.ts`); y las cajas, desde
 *  #601, la PENETRACIÓN que ya se tenía (`cajaBloquea`). Que las tres lo hagan
 *  por su cuenta es lo que permite que `pasoDelJugador` no tenga escape propio:
 *  quien aparezca dentro de algo sale andando sin que nadie le abra la puerta
 *  entera. */

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

/** Una caja sólida en el plano XZ: dónde está su centro y cuánto mide su
 *  huella. Es lo mínimo que necesita la geometría, sin categoría ni dueño: de
 *  quién es la caja y si se le aplica lo decide quien la monta. */
export interface CajaXZ {
  pos: { x: number; z: number };
  /** Huella en METROS (XZ). */
  sizeXZ: { x: number; z: number };
}

/** CUÁNTO SE ESTÁ METIDO en la caja, en metros, contando ya el cuerpo: 0 fuera,
 *  y dentro la distancia MÁS CORTA hasta salir por una de las cuatro caras.
 *
 *  Es la misma medida que usa el jugador para saber si empuja hacia dentro o
 *  hacia fuera, y por eso se toma el `min` de los dos ejes y no su suma: salir
 *  se hace por la cara más cercana. En el centro vale el semiancho menor; en el
 *  borde, cero. La caja se infla por el radio, igual que la prueba de siempre,
 *  así que «dentro» aquí significa «el cuerpo solapa la huella». */
export function penetracionEnCaja(
  p: { x: number; z: number },
  caja: CajaXZ,
  radio: number,
): number {
  const margenX = caja.sizeXZ.x / 2 + radio - Math.abs(p.x - caja.pos.x);
  const margenZ = caja.sizeXZ.z / 2 + radio - Math.abs(p.z - caja.pos.z);
  if (margenX <= 0 || margenZ <= 0) return 0;
  return Math.min(margenX, margenZ);
}

/** ¿ESTA CAJA FRENA ESTE MOVIMIENTO? La regla es la PENETRACIÓN NO CRECIENTE:
 *  se bloquea el paso que deja al cuerpo MÁS metido de lo que ya estaba.
 *
 *  Desde fuera `penetracionEnCaja(desde)` es 0, así que la respuesta es byte a
 *  byte la de siempre: entrar bloquea. Lo que cambia es el de dentro. Hasta
 *  #601 la exención era la CAJA ENTERA —«ya solapaba el origen» → no bloquea
 *  nada—, y bastaba rozar una esquina en diagonal para cruzar el edificio de
 *  lado a lado: medido, 5,99 m de penetración sobre 6 de semiancho. Su hermano
 *  de terreno nunca tuvo ese agujero porque exime CELDA A CELDA
 *  (`terrain-collision.ts`), no el grid entero.
 *
 *  Celda a celda literal aquí NO vale, y se midió: rasterizar la caja encierra
 *  a quien aparezca dentro (0 de 8 rumbos salen de una caja de 12×12 m), y eso
 *  es exactamente lo que la regla existe para evitar — `reparto-de-spawns.ts`
 *  razona sobre ella. La penetración no creciente acota igual (0,00 m de
 *  entrada desde fuera) y además deja salir SIEMPRE: alejarse del centro por
 *  cualquiera de los dos ejes nunca aumenta el `min`, y moverse paralelo a una
 *  cara lo deja igual, que no es «mayor». */
export function cajaBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  caja: CajaXZ,
): boolean {
  return penetracionEnCaja(hasta, caja, radio) > penetracionEnCaja(desde, caja, radio);
}

/** Las CAJAS de los objetos que el plan del tile NO pinta, con la regla «salir
 *  sí, entrar no» que aplica `cajaBloquea` caja por caja: se puede
 *  des-penetrar tras un spawn solapado, pero no meterse más adentro.
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
 *  responde es el que contiene al objeto, igual que antes.
 *
 *  Esta función es el bucle del JUGADOR: la política (huella, `category`,
 *  `dueno` y `planAplicadoEn`) es suya; la GEOMETRÍA es de `cajaBloquea`, para
 *  que quien más adelante haga sólidas estas mismas cajas para otro cuerpo no
 *  estrene una segunda. */
export function aabbBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  obstaculos: readonly ObstaculoAabb[],
  plan: PlanDeLosTiles,
): boolean {
  for (const obj of obstaculos) {
    const sizeXZ = obj.sizeXZ;
    if (!sizeXZ) continue;
    if (obj.category !== "building" && obj.category !== "prop") continue;
    if (obj.dueno.de === "tile" && plan.planAplicadoEn(obj.pos.x, obj.pos.z)) continue;
    if (cajaBloquea(desde, hasta, radio, { pos: obj.pos, sizeXZ })) return true;
  }
  return false;
}
