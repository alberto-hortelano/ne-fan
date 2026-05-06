/** Keyboard + mouse input for 2D client. */

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  attackRequested: boolean;
  selectedAttack: string;
  clickTarget: { x: number; y: number } | null;
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
    selectedAttack: "quick", clickTarget: null,
    interact: false,
  };

  /** When true, movement and combat keys are suppressed (dialogue active). */
  dialogueActive = false;

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
