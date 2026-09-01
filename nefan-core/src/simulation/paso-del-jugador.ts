/** EL PASO DEL JUGADOR: de qué teclas están pulsadas a cuánto se mueve.
 *
 *  Son treinta líneas que vivían dentro del `gameLoop` de `nefan-html`, sin un
 *  solo test detrás (#241), y son REGLA DE JUEGO: el marco relativo al facing,
 *  que la diagonal no corra más, el deslizamiento por ejes contra las paredes y
 *  la regla «salir sí, entrar no». Nada de eso es pintar, así que no era del
 *  cliente.
 *
 *  Entra la intención y una pregunta —`solido(x, z)`—, y sale un delta. Sin
 *  DOM, sin estado y sin tocar la posición: quien la mueve es el llamante, así
 *  que este módulo se puede interrogar tantas veces como haga falta con el
 *  mismo mundo delante.
 */

/** Hacia dónde quiere ir el jugador, en SU marco: `adelante` positivo es hacia
 *  donde mira, `derecha` positivo es strafe a su derecha. */
export interface Intencion {
  adelante: number;
  derecha: number;
}

/** Las teclas de movimiento, ya leídas del proveedor de input. */
export function intencionDeTeclas(teclas: {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}): Intencion {
  return {
    adelante: (teclas.up ? 1 : 0) - (teclas.down ? 1 : 0),
    derecha: (teclas.right ? 1 : 0) - (teclas.left ? 1 : 0),
  };
}

/** El desplazamiento PERMITIDO de este frame, eje a eje.
 *
 *  WASD RELATIVO al personaje (Souls-like): la mirada orienta y las teclas se
 *  expresan en su marco — W avanza hacia donde mira, S camina de espaldas, A/D
 *  son strafe lateral. El movimiento nunca toca la orientación: por eso se
 *  puede retroceder o desplazarse de lado sin dejar de encarar al enemigo. La
 *  diagonal se RENORMALIZA o correría un 41 % más rápido que recto.
 *
 *  Resolución POR EJES contra lo sólido, que es lo que hace deslizar por las
 *  paredes en vez de pegarse a ellas: cada eje se prueba por su cuenta y el que
 *  choca se queda a cero. Y si el ORIGEN ya es sólido —un save antiguo dentro
 *  de una huella que hoy bloquea, un teletransporte del bench— el movimiento se
 *  permite ENTERO: se puede salir, nunca se queda atrapado. Esa es la regla
 *  «salir sí, entrar no», y sin ella un jugador mal colocado no tiene juego.
 *
 *  El `forward` se toma HORIZONTAL (solo x,z): mirar al suelo no puede hacerte
 *  caminar hacia el suelo. Uno de longitud cero no es «no se mueve», es una
 *  llamada mal construida, y por eso se lanza en vez de devolver quieto.
 */
export function pasoDelJugador(p: {
  desde: { x: number; z: number };
  forward: { x: number; z: number };
  intencion: Intencion;
  /** Metros por segundo (andar o esprintar: lo decide el llamante). */
  velocidad: number;
  /** Segundos de este frame. */
  delta: number;
  solido(x: number, z: number): boolean;
}): { dx: number; dz: number } {
  const { adelante, derecha } = p.intencion;
  if (adelante === 0 && derecha === 0) return { dx: 0, dz: 0 };
  const flen = Math.hypot(p.forward.x, p.forward.z);
  if (flen < 1e-9) {
    throw new Error("pasoDelJugador: forward nulo (sin marco en el que expresar las teclas)");
  }
  // right = forward rotado 90° en sentido horario.
  const rx = -p.forward.z;
  const rz = p.forward.x;
  const mx = p.forward.x * adelante + rx * derecha;
  const mz = p.forward.z * adelante + rz * derecha;
  const mlen = Math.hypot(mx, mz) || 1;
  const dx = (mx / mlen) * p.velocidad * p.delta;
  const dz = (mz / mlen) * p.velocidad * p.delta;
  const atrapado = p.solido(p.desde.x, p.desde.z);
  return {
    dx: atrapado || !p.solido(p.desde.x + dx, p.desde.z) ? dx : 0,
    dz: atrapado || !p.solido(p.desde.x, p.desde.z + dz) ? dz : 0,
  };
}
