/** DÓNDE SE PONE CADA COSA cuando el motor manda varias en el MISMO turno.
 *
 *  El problema, medido (#524): el bridge las separaba **1,8 m fijos**
 *  (`SEPARACION_M`, retirada con este módulo) sin mirar el TAMAÑO de lo que
 *  separaba. Con las cajas ya sólidas (#489) y las huellas que el motor puede
 *  declarar desde #532, ese número no se sostiene:
 *
 *   · dos `object` (1,5 m de lado) dejaban **0,3 m** entre caras — el cuerpo
 *     del jugador mide 0,8, así que el hueco existía y no se podía cruzar;
 *   · dos `building` (4 m) **se solapaban 0,4 m**: dos cajas sólidas ocupando
 *     el mismo suelo;
 *   · un `npc` del mismo turno caía **DENTRO** de la caja del edificio (1,8 m
 *     de separación contra 2 m de media huella).
 *
 *  Y el error CRECE con lo que el motor ponga: un carro de `[6,6]` mide 3 m y
 *  un granero de `[20,14]`, diez. Un número fijo no puede seguir a un tamaño
 *  declarado.
 *
 *  LO QUE NO ES ESTE MÓDULO, dicho porque el issue lo pide y no se sostiene:
 *  «el jugador queda encajonado». No queda: `aabbBloquea` tiene «salir sí,
 *  entrar no» (`simulation/obstaculos-del-jugador.ts`), así que a quien
 *  aparezca dentro de una caja no se le atrapa. Lo demostrable es el SOLAPE, y
 *  es lo que se arregla aquí.
 *
 *  LA REGLA, en una frase: el primero cae donde siempre y cada uno de los
 *  demás se pone al lado del ÚLTIMO DE SU LADO, contando desde su BORDE y no
 *  desde su centro — que es exactamente lo que el número fijo no sabía hacer.
 *
 *  Módulo puro y aparte del despacho (`consequence-handler`) a propósito: es
 *  aritmética con casos, y aquí tiene batería y medida propias. */

import { RADIO_SIMULADO_POR_KIND } from "../contract/model-io/physics.js";
import { huellaEnMetros } from "../scene/scene-normalize.js";
import { PLAYER_RADIUS_M } from "../scene/terrain-collision.js";

/** Hueco libre que queda entre las caras de dos cosas del mismo turno.
 *
 *  El cuerpo del jugador (`2 × PLAYER_RADIUS_M` = 0,8 m) más un palmo: pasar
 *  rozando no es pasar, y `aabbBloquea` infla cada caja por el radio del
 *  jugador, así que con EXACTAMENTE 0,8 m las dos cajas infladas se tocarían y
 *  el pasillo sería intransitable — el mismo fallo de los 0,3 m, más fino. El
 *  margen es lo único elegido a ojo de este módulo, y se elige por arriba.
 *
 *  ESTÁ DIMENSIONADO PARA EL JUGADOR Y SE QUEDA CORTO PARA EL NPC, y la cuenta
 *  es de dos constantes que ya están en el árbol:
 *
 *    · este hueco vale **1,0 m** (0,4 × 2 + 0,2);
 *    · el cuerpo del NPC es el MAYOR del juego (`NPC_RADIUS_M` = 0,5), o sea
 *      **1,0 m de diámetro**: exactamente el hueco. Y la regla de la casa para
 *      «¿cabe por aquí?» pide margen de verdad —`celdasLibresParaRadio(0,5,
 *      0,5)` = 3 celdas = **1,5 m** (#289)—, así que lo que el reparto deja no
 *      es un pasillo para un NPC: es un empate.
 *
 *  Qué hace un empate, MEDIDO en el sim (#583, QA H-4) y no deducido: la
 *  penetración de una caja es 0 cuando el margen es 0 (`margen <= 0` en
 *  `penetracionEnCaja`), así que por la **línea central exacta** el NPC pasa —y
 *  solo por ahí—. A **5 cm** de esa línea no pasa: se planta y **el escape NO
 *  se abre**, porque le quedan rumbos legales hacia atrás y el escape solo mira
 *  «las siete deflexiones bloqueadas». Cinco trayectorias medidas (z = 0 ·
 *  0,05 · 0,1 · 0,3 · 0,6): cruza la primera y ninguna más, 0 escapes.
 *
 *  O sea: por el pasillo que deja este número pasa el jugador, y un NPC solo si
 *  entra clavado en el eje. Desde #583 las cajas de estos spawns también son
 *  sólidas para él, así que el hueco es suyo tanto como del jugador, y esto NO
 *  lo tapa ningún escape. Quien suba este número a `2 × NPC_RADIUS_M + margen`
 *  está arreglando esto; quien lo baje, empeorándolo. Rastro de procedencia:
 *  #524 (que puso el reparto por tamaño) y #289 (que fijó cuánto hueco pide
 *  cada cuerpo). */
export const HOLGURA_ENTRE_SPAWNS_M = 2 * PLAYER_RADIUS_M + 0.2;

/** Lo que el reparto necesita saber de cada cosa: su clase y la huella que el
 *  motor declaró (si la declaró). El resto —dónde cae, cómo se llama— no le
 *  incumbe. */
export interface CuerpoDelTurno {
  kind: string;
  footprint?: readonly [number, number] | null;
}

/** Media anchura de un cuerpo, EN METROS: lo que ocupa a cada lado de su
 *  centro cuando se le pone algo al lado.
 *
 *  Un `npc` no es una caja —colisiona por el radio de su cuerpo, y es el mismo
 *  número con el que el simulador lo mueve (`RADIO_SIMULADO_POR_KIND`)—; lo
 *  demás sale de `huellaEnMetros`, la misma función que llena el `sizeXZ` del
 *  effect, con el footprint declarado si lo hay.
 *
 *  Se coge el lado MAYOR y no el del eje lateral: el reparto va perpendicular
 *  al forward del jugador, que no tiene por qué estar alineado con los ejes
 *  del mundo, y las cajas sí lo están. Con el lado mayor no hay orientación en
 *  la que dos cuerpos se toquen; con el lateral, las hay. */
export function mediaAnchura(cuerpo: CuerpoDelTurno): number {
  const radio = RADIO_SIMULADO_POR_KIND[cuerpo.kind];
  if (radio !== undefined) return radio;
  const huella = huellaEnMetros(cuerpo.kind, cuerpo.footprint ?? null);
  return Math.max(huella.x, huella.z) / 2;
}

/** El desplazamiento LATERAL de cada cosa del turno, en metros y con signo
 *  (positivo a un lado, negativo al otro). El primero va a 0: cae donde
 *  siempre, y por eso un turno de UNA sola cosa no cambia de sitio.
 *
 *  Los demás alternan lado y se apoyan en el borde del último de SU lado:
 *  `centro = borde + holgura + media anchura`. Así el hueco entre caras es
 *  siempre `HOLGURA_ENTRE_SPAWNS_M`, midan lo que midan — que es lo que un
 *  número fijo no podía prometer. */
export function repartirEnElTurno(cuerpos: readonly CuerpoDelTurno[]): number[] {
  const salida: number[] = [];
  // Hasta dónde llega lo ya colocado a cada lado, medido desde el centro del
  // primero. Los dos empiezan en su media anchura: es el sitio que ocupa él.
  const borde = { 1: 0, [-1]: 0 };
  cuerpos.forEach((cuerpo, i) => {
    const mitad = mediaAnchura(cuerpo);
    if (i === 0) {
      salida.push(0);
      borde[1] = mitad;
      borde[-1] = mitad;
      return;
    }
    // Alternando: el segundo a un lado, el tercero al otro, el cuarto al
    // primero otra vez. Con las cosas repartidas a los dos lados, el jugador
    // tiene el pasillo del medio libre venga por donde venga.
    const lado = i % 2 === 1 ? 1 : -1;
    const centro = borde[lado] + HOLGURA_ENTRE_SPAWNS_M + mitad;
    salida.push(lado * centro);
    borde[lado] = centro + mitad;
  });
  return salida;
}

/** Rect del tile en metros, semiabierto `[min, max)` como `tileWorldRect`. */
export interface RectDelTile {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

type XZ = { x: number; z: number };

/** DÓNDE PUEDE CAER EL PUNTO DE REFERENCIA de un hint para que TODO el grupo
 *  que cuelga de él quede dentro del tile (tanda CB).
 *
 *  El problema, medido: el punto de un hint es «jugador + forward × 5» (o × 10
 *  con texto libre, o ±50 m con `distant_*`) y nadie miraba dónde acaba el
 *  tile. Hablando a 8 m del borde norte, «junto a la fuente» caía en z = −34
 *  con el tile en [−32, 32): una entity sin suelo, inalcanzable en vivo y, al
 *  reanudar, el muro «Tu partida vuelve incompleta» de `entidadesFueraDelMundo`.
 *
 *  Se acota el ANCLA y no cada punto final, y es a propósito: acotar cada
 *  punto por separado lleva dos cosas del mismo turno pegadas a una esquina al
 *  MISMO x, que es el solape que `repartirEnElTurno` existe para evitar
 *  (#524). Aquí el grupo se mueve entero y los huecos entre caras no cambian.
 *
 *  - `extLateral`: el mayor desplazamiento lateral |reparto| del grupo. El
 *    lateral va perpendicular al forward (`sep = [fwd.z·lat, 0, −fwd.x·lat]`),
 *    así que en X ocupa `|fwd.z|·ext` y en Z `|fwd.x|·ext`.
 *  - `margen`: media anchura del mayor cuerpo del grupo más la holgura: lo que
 *    cada cuerpo necesita entre su centro y el borde para que el jugador lo
 *    rodee sin pegarse al muro del tile.
 *
 *  Si el grupo no cabe en algún eje no hay ancla honesta: `RangeError`, en vez
 *  de devolver un punto que ya se sabe fuera. */
export function anclaDentroDelTile(
  ancla: XZ,
  rect: RectDelTile,
  fwd: XZ,
  extLateral: number,
  margen: number,
): XZ {
  const r = acotarAncla(ancla, rect, fwd, extLateral, margen);
  if ("eje" in r) {
    throw new RangeError(
      `reparto-de-spawns: el grupo necesita ${r.reserva} m a cada lado en ${r.eje} y el tile ` +
        `[${r.min}, ${r.max}) no los tiene`,
    );
  }
  return r;
}

type Acotado = XZ | { eje: "x" | "z"; reserva: number; min: number; max: number };

function acotarAncla(ancla: XZ, rect: RectDelTile, fwd: XZ, extLateral: number, margen: number): Acotado {
  const rx = margen + Math.abs(fwd.z) * extLateral;
  const rz = margen + Math.abs(fwd.x) * extLateral;
  if (rect.minX + rx > rect.maxX - rx) return { eje: "x", reserva: rx, min: rect.minX, max: rect.maxX };
  if (rect.minZ + rz > rect.maxZ - rz) return { eje: "z", reserva: rz, min: rect.minZ, max: rect.maxZ };
  return {
    x: Math.min(rect.maxX - rx, Math.max(rect.minX + rx, ancla.x)),
    z: Math.min(rect.maxZ - rz, Math.max(rect.minZ + rz, ancla.z)),
  };
}

/** Cuánto tiene que haber, como mínimo, entre el centro del JUGADOR y el de
 *  un cuerpo de media anchura `mitad` para que no lo pise: su caja, el cuerpo
 *  del jugador (`PLAYER_RADIUS_M`) y el hueco de paso entre los dos
 *  (`HOLGURA_ENTRE_SPAWNS_M`), para que tampoco lo empareden contra el borde.
 *  Se mide en distancia de Chebyshev (el mayor de |dx|, |dz|): las cajas van
 *  alineadas con los ejes, y para un NPC —un círculo— es más exigente que la
 *  euclídea, nunca menos. */
export function separacionDelJugador(mitad: number): number {
  return mitad + PLAYER_RADIUS_M + HOLGURA_ENTRE_SPAWNS_M;
}

/** Lo que cuelga de UN hint en el turno: el desplazamiento lateral de cada
 *  cosa (de `repartirEnElTurno`) y su media anchura, en el mismo orden. */
export interface GrupoDelHint {
  laterales: readonly number[];
  mitades: readonly number[];
}

export type ColocacionDelGrupo =
  | { ok: true; ancla: XZ; fwd: XZ; posiciones: XZ[] }
  | { ok: false; motivo: string };

/** Giros que se prueban, en orden: delante (lo que pidió el hint), detrás, y
 *  los dos lados. Se gira el vector del hint Y el forward con él, así que el
 *  reparto lateral sigue perpendicular a la dirección elegida. */
const GIROS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** El ancla se pone a EXACTAMENTE la separación mínima cuando hace falta
 *  alargar el hint, y `−28 + 6,4` no da `6,4` al restar en coma flotante:
 *  sin esta tolerancia la dirección buena se descartaba por 1e-15 m. */
const TOLERANCIA_M = 1e-9;
// El `+ 0` normaliza el −0 que sale de girar un eje nulo.
const girar = (v: XZ, [c, s]: readonly [number, number]): XZ => ({
  x: c * v.x - s * v.z + 0,
  z: s * v.x + c * v.z + 0,
});

/** DÓNDE VA EL GRUPO DE UN HINT sin salirse del tile NI caer encima del
 *  jugador (tanda CB, QA H-1).
 *
 *  Acotar el ancla al borde la acerca AL JUGADOR cuando el hint apunta hacia
 *  ese borde: hablando a 2,5 m del borde norte, la forja caía en z = −29 con el
 *  jugador en −29,5, dentro de su caja. Por eso cada dirección candidata se
 *  COMPRUEBA con las posiciones finales: todas dentro del tile con su margen
 *  (lo garantiza el acotado) y cada una a `separacionDelJugador(mitad)` del
 *  jugador. Se queda la primera que cumple; el orden es `GIROS`.
 *
 *  La distancia del hint (5 m, 10 m, 50 m) se alarga lo que haga falta para
 *  que el mayor cuerpo no pise al jugador: un granero de 10 m de media anchura
 *  «cerca del jugador» es su FACHADA cerca, no su centro a 5 m.
 *
 *  Ninguna dirección vale → `{ok:false}` con el porqué: el llamante decide
 *  cómo decirlo (el despacho lanza; el despertar lo comprueba antes de
 *  levantar al jugador). */
export function colocarGrupo(
  jugador: XZ,
  hacia: XZ,
  fwd: XZ,
  grupo: GrupoDelHint,
  rect: RectDelTile,
): ColocacionDelGrupo {
  const mitadMayor = Math.max(0, ...grupo.mitades);
  const ext = Math.max(0, ...grupo.laterales.map(Math.abs));
  const margen = mitadMayor + HOLGURA_ENTRE_SPAWNS_M;
  const largo = Math.hypot(hacia.x, hacia.z);
  const distancia = Math.max(largo, separacionDelJugador(mitadMayor));
  // Sin vector del hint (el hint cae en el jugador) manda el forward; sin
  // ninguno de los dos no hay «delante» desde el que girar, y se dice.
  const base = largo > 0 ? hacia : fwd;
  const n = Math.hypot(base.x, base.z);
  if (n === 0) {
    return { ok: false, motivo: "ni el hint ni el forward del jugador dan una dirección hacia la que colocar" };
  }
  for (const giro of GIROS) {
    const f = girar(fwd, giro);
    const h = girar(base, giro);
    const libre = { x: jugador.x + (h.x / n) * distancia, z: jugador.z + (h.z / n) * distancia };
    const ancla = acotarAncla(libre, rect, f, ext, margen);
    if ("eje" in ancla) continue;
    const posiciones = grupo.laterales.map((lat) => ({ x: ancla.x + f.z * lat, z: ancla.z - f.x * lat }));
    const noPisa = posiciones.every(
      (p, i) =>
        Math.max(Math.abs(p.x - jugador.x), Math.abs(p.z - jugador.z)) >=
        separacionDelJugador(grupo.mitades[i]) - TOLERANCIA_M,
    );
    if (noPisa) return { ok: true, ancla, fwd: f, posiciones };
  }
  return {
    ok: false,
    motivo:
      `no hay sitio en el tile [${rect.minX}, ${rect.maxX}) × [${rect.minZ}, ${rect.maxZ}) para ` +
      `${grupo.laterales.length} cosa(s) (la mayor de ${2 * mitadMayor} m) alrededor del jugador en ` +
      `(${jugador.x}, ${jugador.z}) sin pisarlo: ni delante, ni detrás, ni a los lados`,
  };
}
