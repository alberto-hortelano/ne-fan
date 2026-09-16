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

/** LOS METROS POR SEGUNDO de este frame: los del config, escalados.
 *
 *  Vivía en el cliente como `ARCADE_SPEED_SCALE = 2.2` y dos constantes de
 *  módulo colgadas de él (#241), encima del `walk_speed`/`sprint_speed` del
 *  `combat_config.json` y con caída a dos literales propios que nadie veía: el
 *  config decía 1,9 m/s y el jugador andaba a 4,18. Hoy los tres números están
 *  en el mismo sitio y esta función es el único lugar donde se multiplican, así
 *  que la velocidad del juego se lee del config y no se deduce de dos ficheros.
 *
 *  Andar o esprintar es lo ÚNICO que decide el llamante: es una tecla, no una
 *  regla. */
export function velocidadDelJugador(
  jugador: { walk_speed: number; sprint_speed: number; speed_scale: number },
  sprint: boolean,
): number {
  return (sprint ? jugador.sprint_speed : jugador.walk_speed) * jugador.speed_scale;
}

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
 *  Resolución por ejes SECUENCIAL contra lo sólido, que es lo que hace deslizar
 *  por las paredes en vez de pegarse a ellas: se prueba X desde el origen y
 *  luego Z desde lo que X haya dejado aplicado. La consecuencia es la que
 *  arregla #601: el punto en el que acaba el jugador SIEMPRE es uno de los que
 *  se preguntaron. Hasta hoy los dos ejes se probaban sueltos desde el origen y
 *  nadie miraba el destino COMBINADO, así que andando hacia la ESQUINA de un
 *  edificio cada sondeo seguía fuera mientras la suma ya estaba dentro —ventana
 *  medida de 0,95° a 60 fps, y no es túnel por delta grande— y el jugador
 *  entraba. Si el primer eje choca aporta 0 y el segundo sondeo sale del origen
 *  exactamente igual que antes, así que el rincón cóncavo no cambia: la
 *  objeción de «en cadena se pega a las esquinas» valía para encadenar el delta
 *  BRUTO, no el ya resuelto.
 *
 *  Aquí NO hay escape para el que empieza dentro de un sólido, y el motivo es
 *  que el que había NO FUNCIONABA: el `atrapado` de esta función (un tercer
 *  sondeo, `solido(desde, desde)`) era rama MUERTA —ninguna de las tres fuentes
 *  cableadas puede contestar `true` cuando el destino es el propio origen— y se
 *  retiró con #601. Quitar código muerto no es dar una garantía: quién saca al
 *  que empieza dentro, y hasta dónde, lo decide CADA fuente por su cuenta y no
 *  todas lo mismo. Está escrito y medido en la cabecera de
 *  `obstaculos-del-jugador.ts`; el resumen es que la caja sí saca siempre y el
 *  terreno solo al que penetra menos de una celda.
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
  // X desde el origen; Z desde lo que X haya dejado puesto. Con el primer eje
  // bloqueado el segundo sondeo es el de siempre (aporta 0); con el primero
  // aplicado, el segundo ES el destino combinado, que es lo que cierra la
  // esquina. Dos preguntas, ni una más.
  const ax = p.solido(p.desde.x + dx, p.desde.z) ? 0 : dx;
  const az = p.solido(p.desde.x + ax, p.desde.z + dz) ? 0 : dz;
  return { dx: ax, dz: az };
}
