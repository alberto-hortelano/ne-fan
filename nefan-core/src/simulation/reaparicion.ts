/** DÓNDE VUELVE EL JUGADOR AL MORIR.
 *
 *  Eran seis líneas dentro de `handleRespawnRequest`, en el `main.ts` del
 *  cliente (#241), sin un solo test detrás pese a ser la única regla que decide
 *  en qué punto del mundo continúa la partida. Aquí no hay DOM, ni sim, ni
 *  `gameClient`: entra dónde estaba el cadáver, la pregunta de qué es sólido y
 *  el rect del tile de debajo, y sale un punto.
 *
 *  TRES ESCALONES, y el orden es la regla entera:
 *
 *   1. donde cayó, si ahí no hay nada sólido — reaparecer en el mismo sitio es
 *      lo que el jugador espera, y lo que conserva el contexto de la escena;
 *   2. el CENTRO del tile de debajo, si el cadáver quedó dentro de una huella
 *      sólida (le mató un enemigo pegado a un muro, o el tile llegó después y
 *      le puso un edificio encima);
 *   3. el origen del mundo, cuando ni siquiera hay tile bajo los pies —el único
 *      punto que existe seguro en un mundo continuo cuyo primer tile todavía no
 *      ha llegado.
 *
 *  LO QUE ESTA FUNCIÓN NO PROMETE, dicho aquí porque el nombre invita a
 *  suponerlo: los escalones 2 y 3 NO se vuelven a preguntar contra `solido`.
 *  Es la conducta que tenía el cliente y se conserva tal cual (#241 mueve, no
 *  cambia); si el centro del tile está ocupado, el jugador reaparece dentro y
 *  sale andando por la regla «salir sí, entrar no» de `pasoDelJugador`, que es
 *  su hermano y el motivo de que no se quede atrapado.
 */

import type { Vec3 } from "../types.js";
import type { WorldRect } from "../scene/tile.js";

export function puntoDeReaparicion(
  pos: { x: number; z: number },
  solido: (x: number, z: number) => boolean,
  rectDelTile: WorldRect | null,
): Vec3 {
  if (!solido(pos.x, pos.z)) return { x: pos.x, y: 0, z: pos.z };
  if (rectDelTile) {
    return {
      x: (rectDelTile.minX + rectDelTile.maxX) / 2,
      y: 0,
      z: (rectDelTile.minZ + rectDelTile.maxZ) / 2,
    };
  }
  return { x: 0, y: 0, z: 2 };
}
