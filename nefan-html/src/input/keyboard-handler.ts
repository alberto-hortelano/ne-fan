/** Keyboard + mouse input for 2D client. */

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  attackRequested: boolean;
  selectedAttack: string;
  interact: boolean;
}

const ATTACK_KEYS: Record<string, string> = {
  "1": "quick",
  "2": "heavy",
  "3": "medium",
  "4": "defensive",
  "5": "precise",
};

export class KeyboardHandler {
  state: InputState = {
    up: false, down: false, left: false, right: false,
    sprint: false, attackRequested: false,
    selectedAttack: "quick",
    interact: false,
  };

  /** When true, movement and combat keys are suppressed (dialogue active). */
  dialogueActive = false;

  /** True mientras hay una propuesta de tile en pantalla: Y/N responden a
   *  ella (y N deja de significar "descubrir props"). Lo fija el game loop. */
  tileProposalActive = false;

  /** Intención de zoom acumulada con signo (rueda + teclas), pendiente de
   *  consumir por el game loop. +1 ≈ un paso de acercar, -1 de alejar. */
  private zoomAccum = 0;

  /** Disparos one-shot de generación de escena IA (tecla G de dev). Se
   *  consumen en el game loop; el guard `e.repeat` evita re-disparar mientras
   *  la tecla está pulsada. */
  private generateRequested = false;
  private segmentRequested = false;
  private collisionDebugRequested = false;
  private discoverRequested = false;
  private reviewRequested = false;
  private tileConfirmRequested = false;
  private tileDeclineRequested = false;

  private onAttackTypeChanged?: (type: string) => void;

  constructor(canvas: HTMLCanvasElement, onAttackTypeChanged?: (type: string) => void) {
    this.onAttackTypeChanged = onAttackTypeChanged;

    window.addEventListener("keydown", (e) => {
      // Dialogue mode suppresses combat/movement keys
      // (dialogue-panel.ts handles its own keys with stopPropagation)
      if (this.dialogueActive) return;
      // Synthetic events (autofill, IME, etc.) can fire without `key`.
      if (typeof e.key !== "string") return;

      switch (e.key.toLowerCase()) {
        case "w": case "arrowup": this.state.up = true; break;
        case "s": case "arrowdown": this.state.down = true; break;
        case "a": case "arrowleft": this.state.left = true; break;
        case "d": case "arrowright": this.state.right = true; break;
        case "shift": this.state.sprint = true; break;
        case "e": this.state.interact = true; break;
        // Zoom por teclado: + / = acercan, - aleja (un paso por pulsación).
        case "+": case "=": this.zoomAccum += 1; break;
        case "-": this.zoomAccum -= 1; break;
        // Generación de escena IA (dev): G regenera la imagen del tile actual.
        case "g": if (!e.repeat) this.generateRequested = true; break;
        // X = eXtraer/segmentar oclusores (muros/edificios) de la imagen actual
        // para que tapen al personaje (depth-sort). S está ocupada por movimiento.
        case "x": if (!e.repeat) this.segmentRequested = true; break;
        // B = toggle de los Bordes de colisión pintados sobre la imagen (debug).
        case "b": if (!e.repeat) this.collisionDebugRequested = true; break;
        // N = descubrir props Nuevos que la IA inventó (SAM3 open-vocab);
        // con propuesta de tile en pantalla, N la rechaza.
        case "n":
          if (e.repeat) break;
          if (this.tileProposalActive) this.tileDeclineRequested = true;
          else this.discoverRequested = true;
          break;
        // Y = aceptar la propuesta de generar el tile vecino.
        case "y":
          if (!e.repeat && this.tileProposalActive) this.tileConfirmRequested = true;
          break;
        // R = Revisar el blueprint con Claude (visión vía MCP) antes de
        // generar con G. Opt-in: requiere terminal de Claude Code escuchando.
        case "r": if (!e.repeat) this.reviewRequested = true; break;
      }
      if (e.key in ATTACK_KEYS) {
        this.state.selectedAttack = ATTACK_KEYS[e.key];
        this.onAttackTypeChanged?.(this.state.selectedAttack);
      }
      if (e.key === "Escape") {
        document.exitPointerLock();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (typeof e.key !== "string") return;
      switch (e.key.toLowerCase()) {
        case "w": case "arrowup": this.state.up = false; break;
        case "s": case "arrowdown": this.state.down = false; break;
        case "a": case "arrowleft": this.state.left = false; break;
        case "d": case "arrowright": this.state.right = false; break;
        case "shift": this.state.sprint = false; break;
        case "e": this.state.interact = false; break;
      }
    });

    // Click to attack (only when pointer is locked)
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0 && document.pointerLockElement === canvas && !this.dialogueActive) {
        this.state.attackRequested = true;
      }
    });

    // Zoom con la rueda del ratón. passive:false + preventDefault para no
    // hacer scroll de la página. deltaY<0 (rueda arriba) = acercar.
    // Funciona siempre (también en diálogo): es control de vista.
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomAccum += e.deltaY < 0 ? 1 : -1;
    }, { passive: false });
  }

  /** Devuelve la intención de zoom acumulada (con signo) y la resetea. */
  consumeZoomDelta(): number {
    const z = this.zoomAccum;
    this.zoomAccum = 0;
    return z;
  }

  /** True once per G press (regenerar imagen del escenario actual). */
  consumeGenerateScene(): boolean {
    if (this.generateRequested) {
      this.generateRequested = false;
      return true;
    }
    return false;
  }

  /** True once per X press (segmentar oclusores de la imagen de escena). */
  consumeSegmentScene(): boolean {
    if (this.segmentRequested) {
      this.segmentRequested = false;
      return true;
    }
    return false;
  }

  /** True once per B press (toggle de bordes de colisión sobre la imagen). */
  consumeToggleCollisionDebug(): boolean {
    if (this.collisionDebugRequested) {
      this.collisionDebugRequested = false;
      return true;
    }
    return false;
  }

  /** True once per R press (revisar el blueprint con Claude antes de generar). */
  consumeReviewBlueprint(): boolean {
    if (this.reviewRequested) {
      this.reviewRequested = false;
      return true;
    }
    return false;
  }

  /** True once per N press (descubrir props inventados por la IA). */
  consumeDiscoverObjects(): boolean {
    if (this.discoverRequested) {
      this.discoverRequested = false;
      return true;
    }
    return false;
  }

  /** True once per Y press con propuesta de tile activa (aceptar). */
  consumeTileConfirm(): boolean {
    if (this.tileConfirmRequested) {
      this.tileConfirmRequested = false;
      return true;
    }
    return false;
  }

  /** True once per N press con propuesta de tile activa (rechazar). */
  consumeTileDecline(): boolean {
    if (this.tileDeclineRequested) {
      this.tileDeclineRequested = false;
      return true;
    }
    return false;
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
}
