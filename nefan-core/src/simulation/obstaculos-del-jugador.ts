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
 *  LAS TRES FUENTES SON «SALIR SÍ, ENTRAR NO» Y CADA UNA MIRA SU ORIGEN. Desde
 *  #616 (tanda G, 2026-09-17) LAS TRES PROMETEN LO MISMO —de las tres se
 *  sale—, que no era cierto hasta entonces y por eso conviene seguir teniendo
 *  escrito el alcance de cada una: `pasoDelJugador` no tiene escape propio
 *  (#601 retiró su `atrapado`, que era rama muerta), así que lo que saca es lo
 *  que cada fuente haga por su cuenta.
 *
 *   · FRONTERA (`fronteraBloquea`): exime los tiles ausentes que YA se tocaban
 *     desde el origen. Volver hacia dentro no se bloquea nunca, así que de aquí
 *     siempre se sale.
 *   · CAJA (`cajaBloquea`, desde #601): exime la PENETRACIÓN que ya se tenía.
 *     De aquí también se sale SIEMPRE, y está medido: alejarse del centro por
 *     cualquiera de los dos ejes nunca aumenta el `min`, así que desde todo
 *     punto interior hay rumbo de salida y por los ocho cardinales el jugador
 *     se mueve (QA de #601: 12.528 carreras desde 348 puntos interiores de
 *     cuatro cajas, 0 atascados; y con cajas solapadas, una dentro de otra y
 *     cuatro en cruz, 0 sin salida).
 *   · TERRENO (`salida-del-solido.ts`, sobre el suelo que monta cada cliente):
 *     la MISMA regla de la caja —penetración no creciente— medida por marcha
 *     sobre celdas. De aquí también se sale siempre, salvo dentro de un macizo
 *     más ancho que `TOPE_MARCHA_M` (40 m), donde la penetración satura y no
 *     frena nada. Hasta #616 esta fuente eximía las CELDAS que ya se solapaban
 *     y eso NO era una garantía de salida: sacaba solo a quien ya solapaba
 *     TODAS las celdas sólidas que tenía delante, así que con el sólido más
 *     ancho que el cuerpo la celda siguiente bloqueaba. Medido entonces (banda
 *     de celdas, jugador en su centro, 36 rumbos a 60 fps): con la banda más
 *     estrecha que el cuerpo (≤ 1,5 m) salían 34 de 36; con 2 m o más, **0 de
 *     36 y 0,12 m andados**, midiera la banda 2 m o 20. Como
 *     `planCollisionGrid` rasteriza la huella ENTERA de cada volumen, un
 *     edificio del pueblo es macizo y quien acabara dentro no salía.
 *
 *  Y UN MATIZ QUE #583 OBLIGÓ A ESCRIBIR Y QUE SIGUE EN PIE: «de aquí se sale
 *  siempre» es del JUGADOR, que empuja con su teclado hasta salir. Lo que estas
 *  reglas prometen es que NO FRENAN el paso que saca, no que alguien lo dé. A
 *  un NPC no le empuja nadie —su steering solo sondea rumbos hacia su meta— y
 *  con una caja encima se quedaba dentro andando para siempre (#583). Para eso
 *  está el RUMBO de salida, que es la pieza que convierte «no te frena» en
 *  «sales»: `salidaDeCaja` ahí abajo para la caja, y `salidaDelSolido` para el
 *  terreno. */

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
  return salidaDeCaja(p, caja, radio)?.pen ?? 0;
}

/** POR DÓNDE SE SALE, que es la misma medida mirada del otro lado: la cara más
 *  cercana y cuánto falta para alcanzarla. `null` fuera.
 *
 *  `penetracionEnCaja` contesta CUÁNTO y esta CUÁL, y comparten cuenta a
 *  propósito: si la dirección de salida saliera de una aritmética propia
 *  podrían discrepar, y entonces habría un punto en el que la caja dice «estás
 *  dentro» y la salida apunta a un sitio que no sale.
 *
 *  Quién la necesita, y por qué no basta con la regla «salir sí, entrar no»:
 *  esa regla dice qué pasos NO se frenan, y con eso el JUGADOR sale solo
 *  —empuja con su teclado hasta que sale—. A un NPC no le empuja nadie: el
 *  steering solo sondea rumbos hacia su meta, y si la meta está al otro lado de
 *  la caja, ninguno de ellos le saca (medido: 290 s de 300 dentro de un carro,
 *  QA de #583). Quien mueve un cuerpo sin teclado necesita que se le diga hacia
 *  dónde, y eso es esto.
 *
 *  SOLO PARA LA CAJA, y conviene que se lea aquí: el TERRENO tiene la suya
 *  desde **#616** (`salidaDelSolido`, por celdas y no por rectángulo), y no es
 *  una segunda geometría — es esta misma cuenta generalizada, con candado de
 *  que las dos coinciden sobre un macizo rasterizado
 *  (`test/salida-del-solido.test.ts`: 78.189 puntos, |Δpen| máx 5,7e-15 m).
 *  Quien las une es el proveedor del bridge, que pregunta primero por el
 *  terreno (`test/sim-collision.test.ts`, «de la geometría del TILE también
 *  saca»). */
export function salidaDeCaja(
  p: { x: number; z: number },
  caja: CajaXZ,
  radio: number,
): { dir: { x: number; z: number }; pen: number } | null {
  const dx = p.x - caja.pos.x;
  const dz = p.z - caja.pos.z;
  const margenX = caja.sizeXZ.x / 2 + radio - Math.abs(dx);
  const margenZ = caja.sizeXZ.z / 2 + radio - Math.abs(dz);
  if (margenX <= 0 || margenZ <= 0) return null;
  // Por la cara más cercana, y en el empate por la X: da igual cuál se elija
  // —las dos salen en la misma distancia— pero elegir SIEMPRE la misma hace
  // la salida determinista, y un NPC que alterna de eje no avanza.
  // El signo es el del lado en el que se está; justo en el eje central (dx = 0)
  // se sale hacia +, que es una elección y no un empate con significado.
  return margenX <= margenZ
    ? { dir: { x: dx < 0 ? -1 : 1, z: 0 }, pen: margenX }
    : { dir: { x: 0, z: dz < 0 ? -1 : 1 }, pen: margenZ };
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
