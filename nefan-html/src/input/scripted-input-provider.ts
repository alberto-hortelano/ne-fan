/** Proveedor de input scriptable para bench/E2E (?input=scripted).
 *
 *  Sin listeners DOM: la automatización (Chrome/consola) conduce el juego con
 *  una API programática en vez de sintetizar KeyboardEvents o mutar
 *  input.state a mano. Activo, se expone como window.__nefan.inputDriver. */

import {
  createInputState,
  DEFAULT_ATTACK_IDS,
  type InputProvider,
  type InputState,
} from "./input-provider.js";

/** Teclas continuas manipulables desde el driver. */
type HoldableKey =
  | "up" | "down" | "left" | "right"
  | "turnUp" | "turnDown" | "turnLeft" | "turnRight"
  | "sprint";

export class ScriptedInputProvider implements InputProvider {
  state: InputState = createInputState();
  dialogueActive = false;
  tileProposalActive = false;
  onAttackTypeChanged?: (typeId: string) => void;

  private attackIds: readonly string[] = DEFAULT_ATTACK_IDS;
  private zoomAccum = 0;
  private tileConfirmRequested = false;
  private tileDeclineRequested = false;
  private respawnRequested = false;

  // --- API del driver (window.__nefan.inputDriver) ---

  press(key: HoldableKey): void {
    this.state[key] = true;
  }

  release(key: HoldableKey): void {
    this.state[key] = false;
  }

  releaseAll(): void {
    const fresh = createInputState();
    fresh.selectedAttack = this.state.selectedAttack;
    this.state = fresh;
  }

  queueAttack(): void {
    this.state.attackRequested = true;
  }

  queueInteract(): void {
    this.state.interact = true;
  }

  queueRespawn(): void {
    this.respawnRequested = true;
  }

  queueZoom(steps: number): void {
    this.zoomAccum += steps;
  }

  queueTileConfirm(): void {
    this.tileConfirmRequested = true;
  }

  queueTileDecline(): void {
    this.tileDeclineRequested = true;
  }

  // --- Contrato InputProvider ---

  setAttackBindings(attackIds: readonly string[]): void {
    if (attackIds.length === 0) {
      throw new Error("ScriptedInputProvider.setAttackBindings: empty attack catalog");
    }
    this.attackIds = attackIds;
    this.selectAttack(attackIds[0]);
  }

  selectAttack(typeId: string): void {
    if (!this.attackIds.includes(typeId)) {
      throw new Error(
        `ScriptedInputProvider.selectAttack: '${typeId}' not in catalog (${this.attackIds.join(", ")})`,
      );
    }
    this.state.selectedAttack = typeId;
    this.onAttackTypeChanged?.(typeId);
  }

  consumeZoomDelta(): number {
    const z = this.zoomAccum;
    this.zoomAccum = 0;
    return z;
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
    // Sin listeners que quitar.
  }
}
