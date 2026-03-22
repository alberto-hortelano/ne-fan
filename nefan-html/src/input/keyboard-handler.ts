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
  };

  private onAttackTypeChanged?: (type: string) => void;

  constructor(canvas: HTMLCanvasElement, onAttackTypeChanged?: (type: string) => void) {
    this.onAttackTypeChanged = onAttackTypeChanged;

    window.addEventListener("keydown", (e) => {
      switch (e.key.toLowerCase()) {
        case "w": case "arrowup": this.state.up = true; break;
        case "s": case "arrowdown": this.state.down = true; break;
        case "a": case "arrowleft": this.state.left = true; break;
        case "d": case "arrowright": this.state.right = true; break;
        case "shift": this.state.sprint = true; break;
      }
      if (e.key in ATTACK_KEYS) {
        this.state.selectedAttack = ATTACK_KEYS[e.key];
        this.onAttackTypeChanged?.(this.state.selectedAttack);
      }
    });

    window.addEventListener("keyup", (e) => {
      switch (e.key.toLowerCase()) {
        case "w": case "arrowup": this.state.up = false; break;
        case "s": case "arrowdown": this.state.down = false; break;
        case "a": case "arrowleft": this.state.left = false; break;
        case "d": case "arrowright": this.state.right = false; break;
        case "shift": this.state.sprint = false; break;
      }
    });

    // Click to attack
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
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
}
