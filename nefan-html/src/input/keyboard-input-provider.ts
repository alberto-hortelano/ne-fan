/** Proveedor de input por defecto: teclado + ratón.
 *
 *  WASD mueve (relativo al facing), las flechas orientan, Shift esprinta,
 *  E interactúa, LMB ataca (con pointer lock), el ratón acumula lookDelta
 *  bajo pointer lock (yaw y pitch de la mirada), 1..N
 *  seleccionan ataque del catálogo de la sesión, Y/N responden a la propuesta
 *  de tile y R pide respawn. Las teclas de DESARROLLO no están aquí — ver
 *  dev-tools-input.ts. */

import { alPulsarRaton, alPulsarTecla } from "./puerta-de-teclado.js";
import {
  createInputState,
  DEFAULT_ATTACK_IDS,
  type InputProvider,
  type InputState,
  type LookDelta,
} from "./input-provider.js";

export class KeyboardInputProvider implements InputProvider {
  state: InputState = createInputState();
  dialogueActive = false;
  tileProposalActive = false;
  onAttackTypeChanged?: (typeId: string) => void;

  /** Mapeo tecla ("1".."9") → id de ataque, reconstruido por sesión desde el
   *  catálogo del sistema de combate activo. */
  private attackKeys: Record<string, string> = Object.fromEntries(
    DEFAULT_ATTACK_IDS.map((id, i) => [String(i + 1), id]),
  );

  private lookAccum = 0;
  private lookAccumY = 0;
  private tileConfirmRequested = false;
  private tileDeclineRequested = false;
  private respawnRequested = false;

  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onMouseMove: (e: MouseEvent) => void;
  /** Lo que hay que llamar para desenganchar TODO, incluidos los dos que
   *  registra la puerta con un envoltorio propio. Es una lista y no cuatro
   *  campos porque el envoltorio no es `this.onKeyDown`: guardar el manejador
   *  y no el registro dejaba `dispose()` haciendo dos `removeEventListener`
   *  sobre funciones que nadie había registrado — dos no-ops mudos. */
  private readonly desenganches: (() => void)[] = [];

  constructor() {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Dialogue mode suppresses combat/movement keys
      // (dialogue-panel.ts handles its own keys with stopPropagation)
      if (this.dialogueActive) return;
      // stopPropagation NO corta otros listeners del mismo window: si el
      // panel de diálogo ya consumió esta tecla (elección 1-3 que cierra el
      // diálogo y apaga dialogueActive en el mismo evento), sin esta guarda
      // la tecla se filtraba al selector de ataque del HUD.
      if (e.defaultPrevented) return;
      // Los eventos sintéticos sin `key` (autorrelleno, IME) los descarta la
      // puerta, que es por donde entra este manejador.

      switch (e.key.toLowerCase()) {
        case "w": this.state.up = true; break;
        case "s": this.state.down = true; break;
        case "a": this.state.left = true; break;
        case "d": this.state.right = true; break;
        // Flechas = orientación del personaje (direcciones de pantalla).
        // preventDefault: que no hagan scroll de la página.
        case "arrowup": this.state.turnUp = true; e.preventDefault(); break;
        case "arrowdown": this.state.turnDown = true; e.preventDefault(); break;
        case "arrowleft": this.state.turnLeft = true; e.preventDefault(); break;
        case "arrowright": this.state.turnRight = true; e.preventDefault(); break;
        case "shift": this.state.sprint = true; break;
        case "e": this.state.interact = true; break;
        // N = rechazar la propuesta de tile (sin propuesta, N es de
        // DevToolsInput: descubrir props).
        case "n":
          if (!e.repeat && this.tileProposalActive) this.tileDeclineRequested = true;
          break;
        // Y = aceptar la propuesta de generar el tile vecino.
        case "y":
          if (!e.repeat && this.tileProposalActive) this.tileConfirmRequested = true;
          break;
        // R = respawn (el game loop lo aplica solo con el player muerto).
        case "r": if (!e.repeat) this.respawnRequested = true; break;
      }
      if (e.key in this.attackKeys) {
        this.selectAttack(this.attackKeys[e.key]);
      }
      if (e.key === "Escape") {
        document.exitPointerLock();
      }
    };

    this.onKeyUp = (e) => {
      if (typeof e.key !== "string") return;
      switch (e.key.toLowerCase()) {
        case "w": this.state.up = false; break;
        case "s": this.state.down = false; break;
        case "a": this.state.left = false; break;
        case "d": this.state.right = false; break;
        case "arrowup": this.state.turnUp = false; break;
        case "arrowdown": this.state.turnDown = false; break;
        case "arrowleft": this.state.turnLeft = false; break;
        case "arrowright": this.state.turnRight = false; break;
        case "shift": this.state.sprint = false; break;
        case "e": this.state.interact = false; break;
      }
    };

    // Click to attack (only when pointer is locked). En window y no en el
    // canvas: el lock vive en el lienzo WebGL del mundo, que el provider no
    // conoce; el lock solo lo pide nuestro código, así que basta con que
    // haya alguno activo.
    const onMouseDown = (e: MouseEvent): void => {
      // Un click sobre la UI de juego (botones de acción, opciones de
      // diálogo) NO es un ataque: el listener vive en window y llegaría
      // igual. Con pointer lock activo la UI ya es inclicable, pero la
      // guarda evita toda una familia de bugs al soltarlo.
      if ((e.target as Element | null)?.closest?.("#game-ui")) return;
      if (e.button === 0 && document.pointerLockElement !== null && !this.dialogueActive) {
        this.state.attackRequested = true;
      }
    };

    // Delta de mirada: solo bajo pointer lock (el movimiento del ratón fuera
    // de lock es cursor normal, no intención de mirar).
    this.onMouseMove = (e) => {
      if (document.pointerLockElement !== null) {
        this.lookAccum += e.movementX;
        this.lookAccumY += e.movementY;
      }
    };

    // keydown y mousedown por la PUERTA (#285): con el título delante el
    // mundo no se ve, así que moverse, atacar o cambiar de ataque ahí es
    // actuar a ciegas. `keyup` va directo a propósito — descartar la soltada
    // de una tecla dejaría al jugador andando solo al volver del título.
    this.desenganches.push(alPulsarTecla(onKeyDown), alPulsarRaton(onMouseDown));
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  setAttackBindings(attackIds: readonly string[]): void {
    if (attackIds.length === 0) {
      throw new Error("KeyboardInputProvider.setAttackBindings: empty attack catalog");
    }
    this.attackKeys = Object.fromEntries(
      attackIds.slice(0, 9).map((id, i) => [String(i + 1), id]),
    );
    this.selectAttack(attackIds[0]);
  }

  selectAttack(typeId: string): void {
    this.state.selectedAttack = typeId;
    this.onAttackTypeChanged?.(typeId);
  }

  // --- IntentSink: la UI clicable levanta los MISMOS flags que las teclas ---

  queueAttack(): void {
    if (!this.dialogueActive) this.state.attackRequested = true;
  }

  queueInteract(): void {
    this.state.interact = true;
  }

  queueRespawn(): void {
    this.respawnRequested = true;
  }

  queueTileConfirm(): void {
    if (this.tileProposalActive) this.tileConfirmRequested = true;
  }

  queueTileDecline(): void {
    if (this.tileProposalActive) this.tileDeclineRequested = true;
  }

  consumeLookDelta(): LookDelta {
    const d = { dx: this.lookAccum, dy: this.lookAccumY };
    this.lookAccum = 0;
    this.lookAccumY = 0;
    return d;
  }

  consumeAttack(): boolean {
    if (this.state.attackRequested) {
      this.state.attackRequested = false;
      return true;
    }
    return false;
  }

  consumeInteract(): boolean {
    if (this.state.interact) {
      this.state.interact = false;
      return true;
    }
    return false;
  }

  consumeTileConfirm(): boolean {
    if (this.tileConfirmRequested) {
      this.tileConfirmRequested = false;
      return true;
    }
    return false;
  }

  consumeTileDecline(): boolean {
    if (this.tileDeclineRequested) {
      this.tileDeclineRequested = false;
      return true;
    }
    return false;
  }

  consumeRespawn(): boolean {
    if (this.respawnRequested) {
      this.respawnRequested = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    for (const desenganchar of this.desenganches) desenganchar();
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
  }
}
