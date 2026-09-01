/** LA MIRADA DEL JUGADOR EN PRIMERA PERSONA: yaw continuo, pitch acotado.
 *
 *  Eran tres `let` de módulo (`playerYaw`, `playerPitch`, `playerForward`) más
 *  cuatro de flanco de tecla, cuatro constantes y tres funciones sueltas dentro
 *  del `main.ts` del cliente, sin nada que pudiera ponerse rojo. Lo que hay
 *  aquí es regla de juego —cuánto gira un píxel de ratón, hasta dónde se puede
 *  mirar arriba, cuánto salta una flecha— y no tiene una línea de DOM.
 *
 *  DOS EJES QUE NO SON SIMÉTRICOS, y ahí está casi todo:
 *
 *   · el YAW es continuo y sin tope: da vueltas. De él, y solo de él, sale el
 *     `forward`, que es el marco del WASD y es SIEMPRE horizontal — mirar al
 *     suelo no puede hacerte caminar hacia el suelo;
 *   · el PITCH está acotado a 85° y no entra en el `forward`. Solo lo consumen
 *     la cámara y la puntería.
 */

/** Radianes por píxel de ratón bajo pointer lock (~0,14°/px, el rango típico
 *  de un FPS). La MISMA para los dos ejes: una sensibilidad distinta por eje se
 *  siente como un ratón roto. */
export const SENSIBILIDAD_RAD_POR_PX = 0.0025;

/** Tope de la mirada vertical: 85°, no 90°. Pasar de la vertical invierte el
 *  marco de la cámara (el mundo se da la vuelta) y en la vertical exacta el yaw
 *  deja de estar definido — es el gimbal lock del orden YXZ. Los 5° de margen
 *  son gratis: a 85° ya te estás mirando las botas. */
export const TOPE_DE_PITCH_RAD = (85 * Math.PI) / 180;

/** Paso de ←/→ por pulsación. */
export const PASO_DE_YAW_RAD = Math.PI / 4;

/** Paso de ↑/↓: hermano de los 45° de ←/→, pero 15°. El eje vertical recorre
 *  170° en total y a 45° por pulsación solo tendría cuatro posiciones. */
export const PASO_DE_PITCH_RAD = (15 * Math.PI) / 180;

/** Las cuatro teclas de orientar, tal y como las publica el proveedor de
 *  input. */
export interface TeclasDeGiro {
  turnLeft: boolean;
  turnRight: boolean;
  turnUp: boolean;
  turnDown: boolean;
}

export class Mirada {
  #yaw = Math.PI; // encarando -Z
  #pitch = 0;
  #forward = { x: 0, y: 0, z: -1 };
  #antes: TeclasDeGiro = { turnLeft: false, turnRight: false, turnUp: false, turnDown: false };

  get yaw(): number {
    return this.#yaw;
  }

  get pitch(): number {
    return this.#pitch;
  }

  /** Mirada vertical en GRADOS (positivo = arriba), que es como la publica el
   *  hook de bench: en radianes no hay quien lea un aserto. */
  get pitchEnGrados(): number {
    return (this.#pitch * 180) / Math.PI;
  }

  /** El marco del WASD. Se guarda en vez de derivarse en cada lectura porque
   *  lo leen media docena de sitios por frame, y porque devolver un objeto
   *  nuevo cada vez invita a que alguien lo mute creyendo que gira al jugador
   *  (no lo hace: gira `ponYaw`). */
  get forward(): { x: number; y: number; z: number } {
    return this.#forward;
  }

  ponYaw(rad: number): void {
    this.#yaw = rad;
    this.#forward = { x: Math.sin(rad), y: 0, z: Math.cos(rad) };
  }

  /** El pitch, RECORTADO al tope. Es la única puerta: recortar aquí y no en
   *  cada llamante es lo que impide que una vía nueva se pase de la vertical. */
  ponPitch(rad: number): void {
    this.#pitch = Math.min(TOPE_DE_PITCH_RAD, Math.max(-TOPE_DE_PITCH_RAD, rad));
  }

  /** Mundo nuevo, mirada al frente: reanudar con los ojos clavados en el suelo
   *  porque así acabó la partida anterior es desconcertante. El yaw NO se toca
   *  — la partida decide hacia dónde miras, no hacia dónde inclinas. */
  enderezar(): void {
    this.#pitch = 0;
  }

  /** Mouse look: ratón a la derecha gira a la derecha (mismo signo que la
   *  flecha ←/→) y ratón abajo mira abajo, sin invertir. `dy` es el del
   *  navegador: positivo = ratón hacia ABAJO. */
  raton(dx: number, dy: number): void {
    if (dx !== 0) this.ponYaw(this.#yaw - dx * SENSIBILIDAD_RAD_POR_PX);
    if (dy !== 0) this.ponPitch(this.#pitch - dy * SENSIBILIDAD_RAD_POR_PX);
  }

  /** Los pasos de las flechas, por FLANCO DE SUBIDA: mantener pulsado no
   *  repite. El flanco se guarda aquí dentro, que es donde se puede afirmar —
   *  eran cuatro `let` sueltas en el cliente, y una que se olvidara de
   *  actualizarse convertía la flecha en un giro continuo. */
  pasos(teclas: TeclasDeGiro): void {
    if (teclas.turnLeft && !this.#antes.turnLeft) this.ponYaw(this.#yaw + PASO_DE_YAW_RAD);
    if (teclas.turnRight && !this.#antes.turnRight) this.ponYaw(this.#yaw - PASO_DE_YAW_RAD);
    if (teclas.turnUp && !this.#antes.turnUp) this.ponPitch(this.#pitch + PASO_DE_PITCH_RAD);
    if (teclas.turnDown && !this.#antes.turnDown) this.ponPitch(this.#pitch - PASO_DE_PITCH_RAD);
    this.#antes = { ...teclas };
  }
}
