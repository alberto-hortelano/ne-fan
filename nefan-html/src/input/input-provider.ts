/** Contrato del proveedor de input del cliente 2D (sistema intercambiable).
 *
 *  Implementaciones registradas en ./registry.ts (default: teclado+ratón;
 *  "scripted" para bench/E2E). Solo cubre GAMEPLAY: las teclas de desarrollo
 *  (G/X/B/N-descubrir/R-review) viven en DevToolsInput, fijo e independiente
 *  del esquema de control — un gamepad no las necesita. */

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Flechas de dirección: orientan al personaje (no lo mueven). */
  turnUp: boolean;
  turnDown: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  sprint: boolean;
  attackRequested: boolean;
  selectedAttack: string;
  interact: boolean;
}

/** Catálogo por defecto (sistema de combate estándar) hasta que la sesión
 *  instale el suyo vía setAttackBindings. */
export const DEFAULT_ATTACK_IDS = ["quick", "heavy", "medium", "defensive", "precise"];

export function createInputState(): InputState {
  return {
    up: false, down: false, left: false, right: false,
    turnUp: false, turnDown: false, turnLeft: false, turnRight: false,
    sprint: false, attackRequested: false,
    selectedAttack: DEFAULT_ATTACK_IDS[0],
    interact: false,
  };
}

export interface InputProvider {
  /** Estado continuo, leído por el game loop cada frame. */
  readonly state: InputState;
  /** When true, movement and combat inputs are suppressed (dialogue active). */
  dialogueActive: boolean;
  /** True mientras hay una propuesta de tile en pantalla: Y/N responden a
   *  ella. Lo fija el game loop. */
  tileProposalActive: boolean;
  /** Reconstruye el mapeo de selección (1..N en teclado) desde el catálogo
   *  del sistema de combate de la sesión y resetea la selección al primero. */
  setAttackBindings(attackIds: readonly string[]): void;
  /** Selección de ataque (teclas, clicks del HUD…) — un único dueño del
   *  estado; la UI se refresca vía onAttackTypeChanged. */
  selectAttack(typeId: string): void;
  onAttackTypeChanged?: (typeId: string) => void;
  /** Intención de zoom acumulada con signo (+ acerca) — se resetea al leer. */
  consumeZoomDelta(): number;
  consumeAttack(): boolean;
  consumeInteract(): boolean;
  /** Aceptar/rechazar la propuesta de generar el tile vecino. */
  consumeTileConfirm(): boolean;
  consumeTileDecline(): boolean;
  /** Intención de respawn — el game loop decide si aplica (player muerto). */
  consumeRespawn(): boolean;
  /** Quita listeners (swap de provider en dev). */
  dispose(): void;
}

export interface InputDeps {
  canvas: HTMLCanvasElement;
}
