/** ¿ES SÓLIDO ESTE PUNTO, CUÁNTO ME HE METIDO Y POR DÓNDE SALGO — sobre
 *  cualquier suelo por celdas, no solo sobre un rectángulo.
 *
 *  Es la pieza que #616 dice que falta. El repositorio tenía la pregunta de
 *  PUNTO solo para las CAJAS (`penetracionEnCaja` / `salidaDeCaja`, #601 y
 *  #583) y para el TERRENO solo la de MOVIMIENTO («¿puedo ir de aquí a ahí?»).
 *  La consecuencia estaba medida: la regla del terreno eximía las CELDAS que
 *  ya se solapaban, lo que devuelve a quien penetra un muro fino pero no saca
 *  a quien está dentro de un sólido más ancho que su cuerpo — y los edificios
 *  del plan son MACIZOS (`planCollisionGrid` rasteriza la huella entera del
 *  volumen). Sonda del plan de la tanda G sobre las tres fixtures, 36 rumbos ×
 *  5 s con `pasoDelJugador` real: **634 de 2.466 puntos sólidos de robledo,
 *  1.768 de 4.002 de puerto y 160 de 552 de zorder eran estado SIN SALIDA**.
 *
 *  NO HAY UNA SEGUNDA GEOMETRÍA, y es el invariante que sujeta este módulo: la
 *  cuenta es la MISMA que la de `salidaDeCaja` —penetración = distancia más
 *  corta, por los cuatro ejes, hasta dejar de solapar; salida = ese eje— solo
 *  que medida por marcha sobre las celdas en vez de por aritmética de
 *  rectángulo. Sobre un rectángulo rasterizado las dos tienen que coincidir
 *  EXACTAMENTE, y hay candado de ello (`test/salida-del-solido.test.ts`, con
 *  la orla del radio incluida). Si alguna vez discrepan, es que el repositorio
 *  tiene dos ideas de dónde acaba un sólido y el jugador vive en una y el NPC
 *  en la otra.
 *
 *  ## La marcha, y los dos errores que son fáciles y están medidos
 *
 *   1. **Se marcha por el borde TRASERO del cuerpo, no por el delantero.** Al
 *      moverse hacia +x, las celdas ENTRAN por delante y SALEN por detrás;
 *      añadir una celda no puede liberar a nadie, así que el primer punto
 *      libre está siempre en un cruce del borde trasero. Marchar por el
 *      delantero da una penetración distinta (`|Δpen|` 0,20 m medido, con la
 *      batería entera en verde: es un error que la sonda del plan cometió de
 *      verdad).
 *   2. **El solape es ABIERTO** (tocar el borde de una celda NO es estar
 *      dentro), que es la convención de `salidaDeCaja`: su `margen <= 0` es
 *      FUERA. Con el CERRADO —el de `blocksCircle`, `floor()` inclusive— un
 *      paso que aterriza EXACTO en una frontera de celda sigue «ocupado» y la
 *      penetración salta de 0,025 a 0,475 m: 7 puntos de robledo, 36 de puerto
 *      y 8 de zorder se clavaban ahí. Quien implemente `ocupado` tiene que
 *      usar el abierto (`solapaSolido`, en `scene/terrain-collision.ts`).
 *
 *  Las fronteras son ABSOLUTAS (múltiplos de `TILE_MPC` en coordenadas de
 *  mundo: el rect de un tile empieza en `tx·64 − 32`, siempre múltiplo de
 *  0,5), no relativas al cuerpo. Es lo que hace que la penetración baje
 *  EXACTAMENTE lo que se anda: desde un punto ya movido, el siguiente cruce es
 *  el mismo sitio del mundo. De ahí sale la garantía de salida — moverse por
 *  el eje de menor penetración la reduce en cada paso, así que baja monótona
 *  hasta 0 y `solidoBloquea` no frena ninguno de esos pasos.
 *
 *  ## El tope, y por qué SATURA en vez de descartarse
 *
 *  Un sólido más ancho que `TOPE_MARCHA_M` no tiene gradiente que seguir. El
 *  eje que llega al tope devuelve el tope, NO «infinito» ni «este eje no
 *  cuenta»: descartarlo dejaría la penetración en 0 y volvería a encerrar a
 *  todo el mundo. Con la saturación lo que ocurre es lo honesto — dentro de
 *  esa masa nada bloquea y se anda libre hasta ver el gradiente. El peor caso
 *  real medido hoy es de 5,94 m (puerto), y `qa/nadie-se-queda-encerrado.mjs`
 *  imprime la penetración máxima de cada fixture en cada corrida para verlo
 *  venir.
 *
 *  ## Efecto colateral QUERIDO (y que no pide ningún issue)
 *
 *  `npc-behavior.ts` consume `porDondeSalirDeAqui` en cada tick, así que desde
 *  el día que el TERRENO contesta, un NPC metido en la geometría de un tile
 *  sale solo. Es conducta nueva y es mejora; no la confunda nadie con #618,
 *  que es otra cosa (el NPC que NO está dentro de nada y no sabe rodear). */

import { TILE_MPC } from "../scene/tile.js";

/** Hasta dónde marcha la búsqueda de salida, en METROS. Un sólido más ancho
 *  que esto satura (ver cabecera). 40 m es más de medio tile (64 m) y ocho
 *  veces el edificio más grande de las fixtures. */
export const TOPE_MARCHA_M = 40;

/** Cuándo dos ejes EMPATAN, en metros. Un nanómetro: nueve órdenes de magnitud
 *  por debajo de la celda (0,5 m) y cuatro por encima del ruido de coma
 *  flotante que se midió (`|Δpen|` máximo 5,7e-15 m entre esta cuenta y la de
 *  `salidaDeCaja` sobre 76.997 puntos).
 *
 *  No es cosmética. En un empate MATEMÁTICO —el cuerpo a la misma distancia de
 *  dos caras— los dos ejes se calculan por caminos distintos y el último bit
 *  decide. Sin el épsilon, 467 de esos 76.997 puntos elegían el eje contrario
 *  al que elige `salidaDeCaja` (que desempata con `margenX <= margenZ`), o sea
 *  dos geometrías discrepando por medio ulp; y un cuerpo cuyo rumbo de salida
 *  depende del último bit alterna de eje entre ticks y no avanza. */
const EPS_EMPATE_M = 1e-9;

/** EL SUELO VISTO POR ESTA CUENTA: una sola pregunta, de PUNTO.
 *
 *  Quien la implemente decide QUÉ fuentes entran (el grid del terreno, el del
 *  plan, las cajas de runtime…). Lo que NO decide es la convención: tiene que
 *  ser el solape ABIERTO, o la penetración se clava en las fronteras de celda
 *  (ver cabecera, punto 2). */
export interface SueloSolido {
  /** ¿El cuerpo (x, z, radio) solapa algo sólido? */
  ocupado(x: number, z: number, radio: number): boolean;
}

/** POR DÓNDE SE SALE y CUÁNTO falta: el eje de menor penetración y su
 *  distancia. Mismo par que devuelve `salidaDeCaja`, a propósito. */
export interface SalidaDelSolido {
  /** Unitario y paralelo a un eje: la salida más corta siempre lo es. */
  dir: { x: number; z: number };
  /** Metros que faltan para dejar de solapar por ese eje. */
  pen: number;
}

/** Lo mismo más el PUNTO exacto donde acaba la marcha — interno, porque es el
 *  único sitio del módulo donde la coordenada de destino se calcula sin
 *  restar: `x + dir·pen` pierde medio ulp y puede aterrizar un pelo DENTRO,
 *  que sobre un solape abierto es la diferencia entre libre y ocupado.
 *  `sitioParaAparecer` usa el punto; quien solo necesita el rumbo (el NPC) usa
 *  `salidaDelSolido`. `punto: null` = ese eje saturó el tope. */
interface SalidaMedida extends SalidaDelSolido {
  punto: { x: number; z: number } | null;
}

/** La frontera de celda estrictamente MAYOR que `v`. */
function fronteraSiguiente(v: number): number {
  const f = Math.floor(v / TILE_MPC) * TILE_MPC;
  return f > v ? f : f + TILE_MPC;
}

/** La frontera de celda estrictamente MENOR que `v`. */
function fronteraAnterior(v: number): number {
  const f = Math.ceil(v / TILE_MPC) * TILE_MPC;
  return f < v ? f : f - TILE_MPC;
}

/** La marcha por UN eje: el primer cruce del borde trasero en el que el cuerpo
 *  deja de solapar sólido. Satura en `TOPE_MARCHA_M` con `punto: null`. */
function marchaPorEje(
  x: number,
  z: number,
  radio: number,
  suelo: SueloSolido,
  ejeX: boolean,
  signo: 1 | -1,
): SalidaMedida {
  const dir = ejeX ? { x: signo, z: 0 } : { x: 0, z: signo };
  const v = ejeX ? x : z;
  // El borde TRASERO del cuerpo respecto del avance (ver cabecera, punto 1).
  const trasero = v - signo * radio;
  let f = signo > 0 ? fronteraSiguiente(trasero) : fronteraAnterior(trasero);
  for (;;) {
    // El centro cuyo borde trasero cae en la frontera `f`.
    const nuevo = f + signo * radio;
    const pen = signo * (nuevo - v);
    if (pen > TOPE_MARCHA_M) return { dir, pen: TOPE_MARCHA_M, punto: null };
    const px = ejeX ? nuevo : x;
    const pz = ejeX ? z : nuevo;
    if (!suelo.ocupado(px, pz, radio)) return { dir, pen, punto: { x: px, z: pz } };
    f += signo * TILE_MPC;
  }
}

/** La mejor de las cuatro marchas, o `null` si el cuerpo no está dentro.
 *
 *  EL ORDEN DE LOS EJES ES LA REGLA DE DESEMPATE, y es la de `salidaDeCaja`
 *  literalmente: X antes que Z (su `margenX <= margenZ`), y dentro de cada eje
 *  el `+` antes que el `−` (su `dx < 0 ? -1 : 1`, que en el eje central sale
 *  hacia +). Con `<` estricto, el primero de la lista gana los empates. Un
 *  desempate distinto no sería «otra elección igual de buena»: un cuerpo que
 *  alterna de eje entre ticks no avanza. */
function salidaMedida(
  x: number,
  z: number,
  radio: number,
  suelo: SueloSolido,
): SalidaMedida | null {
  if (!suelo.ocupado(x, z, radio)) return null;
  let mejor = marchaPorEje(x, z, radio, suelo, true, 1);
  for (const [ejeX, signo] of [[true, -1], [false, 1], [false, -1]] as [boolean, 1 | -1][]) {
    const otra = marchaPorEje(x, z, radio, suelo, ejeX, signo);
    if (otra.pen < mejor.pen - EPS_EMPATE_M) mejor = otra;
  }
  return mejor;
}

/** CUÁNTO SE ESTÁ METIDO, en metros: 0 fuera, y dentro la distancia más corta
 *  hasta dejar de solapar. Gemela de `penetracionEnCaja` y con el mismo
 *  contrato — la diferencia es el suelo sobre el que se mide. */
export function penetracionEnSolido(
  x: number,
  z: number,
  radio: number,
  suelo: SueloSolido,
): number {
  return salidaMedida(x, z, radio, suelo)?.pen ?? 0;
}

/** POR DÓNDE SALIR de donde se está metido, o `null` si no se está metido en
 *  nada. Gemela de `salidaDeCaja`: quien mueve un cuerpo SIN teclado (un NPC)
 *  necesita que se le diga hacia dónde, porque «salir sí, entrar no» solo dice
 *  qué pasos no se frenan. */
export function salidaDelSolido(
  x: number,
  z: number,
  radio: number,
  suelo: SueloSolido,
): SalidaDelSolido | null {
  const salida = salidaMedida(x, z, radio, suelo);
  return salida ? { dir: salida.dir, pen: salida.pen } : null;
}

/** ¿ESTE SUELO FRENA ESTE PASO? La regla es la PENETRACIÓN NO CRECIENTE, la
 *  misma de `cajaBloquea`: se bloquea el paso que deja al cuerpo MÁS metido de
 *  lo que ya estaba.
 *
 *  DESDE FUERA CORTA EN SECO y no paga ninguna marcha: con el origen libre la
 *  respuesta es `ocupado(hasta)`, que es lo que contestaba la regla de celdas
 *  de siempre salvo en la TANGENCIA EXACTA — aterrizar con el cuerpo justo
 *  pegado al borde de una celda sólida antes quedaba un pelo corto (solape
 *  cerrado) y ahora se permite (abierto). Es la diferencia que hace falta para
 *  que la penetración no se clave (cabecera, punto 2), y es medio centímetro
 *  en un caso que pide una coordenada exacta en binario.
 *
 *  Y DESDE DENTRO es lo que #616 pedía: el paso que reduce la penetración
 *  nunca se frena, así que quien empuja (el jugador) sale andando y quien no
 *  (el NPC) sale con el rumbo de `salidaDelSolido`. */
export function solidoBloquea(
  desde: { x: number; z: number },
  hasta: { x: number; z: number },
  radio: number,
  suelo: SueloSolido,
): boolean {
  if (!suelo.ocupado(desde.x, desde.z, radio)) return suelo.ocupado(hasta.x, hasta.z, radio);
  return (
    penetracionEnSolido(hasta.x, hasta.z, radio, suelo) >
    penetracionEnSolido(desde.x, desde.z, radio, suelo)
  );
}

/** UN SITIO LIBRE DONDE PONER A ALGUIEN, partiendo del que se quería: el
 *  candidato si ya está libre, y si no el punto al que le saca `salidaDelSolido`.
 *
 *  Existe porque teletransportar a una coordenada que nadie ha mirado es la
 *  mitad de ARRIBA de #616: `resolvePlaceTarget` devuelve el centro del
 *  `anchor.rect` del lugar, y los 13 `building` de robledo y puerto tienen el
 *  centro OCUPADO, 13 de 13 (medido con el plan compuesto, que es el que
 *  instala el cliente). Con esto se aparece en la PUERTA del lugar y no en su
 *  cocina: menor penetración = desplazamiento mínimo, **≤ 3,90 m sobre esos
 *  13**, y los 13 puntos que devuelve quedan libres.
 *
 *  `null` es fail-loud y hay que tratarlo: significa que la marcha saturó el
 *  tope `maxPasos` veces seguidas (hasta 160 m de sólido continuo) o que dejó
 *  de haber progreso numérico. Quien llama NO debe usar el candidato crudo —
 *  es justamente el punto del que no se sale. */
export function sitioParaAparecer(
  candidato: { x: number; z: number },
  radio: number,
  mundo: SueloSolido,
  maxPasos = 4,
): { x: number; z: number } | null {
  let p = { x: candidato.x, z: candidato.z };
  for (let paso = 0; paso < maxPasos; paso++) {
    const salida = salidaMedida(p.x, p.z, radio, mundo);
    if (!salida) return p;
    // Saturó: el punto que devolvería sigue dentro. Se avanza el tope entero
    // por el eje menos malo y se vuelve a mirar.
    const siguiente = salida.punto ?? { x: p.x + salida.dir.x * salida.pen, z: p.z + salida.dir.z * salida.pen };
    if (siguiente.x === p.x && siguiente.z === p.z) return null;
    p = siguiente;
  }
  return mundo.ocupado(p.x, p.z, radio) ? null : p;
}
