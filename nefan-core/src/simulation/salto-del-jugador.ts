/** EL SALTO DEL JUGADOR: cuándo está en el aire y a qué altura.
 *
 *  Regla de juego, así que vive en core aunque el único que salta sea el
 *  jugador del cliente: sin DOM, sin reloj propio (avanza con el `delta` del
 *  bucle, como `pasoDelJugador`) y sin tocar la posición. El cliente guarda el
 *  estado, se lo devuelve cada frame y pinta la `elevacion` que sale.
 *
 *  Lo que el salto CAMBIA en el mundo no está aquí: en el aire el suelo que se
 *  consulta es otro grid del plan (`planCollisionGridEnElAire`), el que no
 *  tiene lo saltable. Este módulo solo contesta «¿está en el aire?», y es esa
 *  respuesta la que elige grid.
 *
 *  La trayectoria es la parábola de un tiro vertical: `4·A·u·(1−u)` con
 *  `u = t / duración`, que vale 0 al despegar y al aterrizar y `A` en la mitad.
 *  El apogeo `A` es geometría (`SALTO_APOGEO_M`, lo lee el dintel de los
 *  gates); la duración es feel (`combat_config.json`, `salto_duracion_s`).
 */

import { SALTO_APOGEO_M } from "../scene/terrain-collision.js";

/** En el suelo, o en el aire desde hace `t` segundos. Sin un tercer estado:
 *  un salto que ha aterrizado ES el suelo, y así no hay nada que olvidar
 *  resetear. */
export type Salto = { fase: "suelo" } | { fase: "aire"; t: number };

export const EN_EL_SUELO: Salto = { fase: "suelo" };

/** Despega, solo desde el suelo: en el aire no hay doble salto, y pedirlo
 *  devuelve el MISMO salto (no uno reiniciado). */
export function saltar(s: Salto): Salto {
  return s.fase === "suelo" ? { fase: "aire", t: 0 } : s;
}

/** Avanza el reloj del salto `delta` segundos. Aterriza al llegar a la
 *  `duracion`, ni un frame después. Una duración que no es un número positivo
 *  es un config roto, y se lanza en vez de dejar al jugador flotando. */
export function avanzarSalto(s: Salto, delta: number, duracion: number): Salto {
  if (!(duracion > 0)) throw new Error(`avanzarSalto: duración ${duracion} (tiene que ser > 0 s)`);
  if (s.fase === "suelo") return s;
  const t = s.t + delta;
  return t >= duracion ? EN_EL_SUELO : { fase: "aire", t };
}

/** ¿Está en el aire? Es la pregunta que elige el grid de colisión. */
export function enElAire(s: Salto): boolean {
  return s.fase === "aire";
}

/** Metros sobre el suelo en este instante. 0 en el suelo; nunca negativa (un
 *  `t` pasado de la duración se trata como aterrizado). */
export function elevacionDelSalto(s: Salto, duracion: number): number {
  if (s.fase === "suelo") return 0;
  const u = Math.min(1, s.t / duracion);
  return 4 * SALTO_APOGEO_M * u * (1 - u);
}

/** EL SALTO DE ESTE FRAME: avanza el reloj y, si se pidió y el jugador puede
 *  moverse, despega. Lo que el bucle del cliente llama una vez por frame.
 *
 *  El reloj corre SIEMPRE, también con el diálogo abierto o caído: nadie se
 *  queda congelado a media altura porque le hablen. La petición se aplica solo
 *  con `puedeMoverse`, y el llamante la consume igual: un Espacio pulsado con
 *  un panel abierto no salta al cerrarlo. Se avanza ANTES de despegar, así que
 *  pedir el salto el mismo frame en que se aterriza vuelve a despegar. */
export function saltoDelFrame(
  s: Salto,
  p: { delta: number; duracion: number; pide: boolean; puedeMoverse: boolean },
): Salto {
  const avanzado = avanzarSalto(s, p.delta, p.duracion);
  return p.pide && p.puedeMoverse ? saltar(avanzado) : avanzado;
}
