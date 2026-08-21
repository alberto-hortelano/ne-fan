/** Teclas de DESARROLLO del cliente 2D — fijas, fuera del InputProvider:
 *  son del harness (pipeline de imagen IA, debug de colisión), no del esquema
 *  de control del jugador, así que funcionan igual con cualquier provider.
 *
 *  G = pedir el atlas de superficies del tile activo · B = ciclar la vista de
 *  debug (off → colisiones → blueprint). Las teclas X (segmentar la imagen),
 *  N (descubrir props) y R (revisar el blueprint por visión) se fueron con el
 *  pipeline de imagen del repintado por tile, que ya no existe. */

export interface DevToolsDeps {
  /** El diálogo suprime también las teclas dev (mismo guard que el provider). */
  isDialogueActive(): boolean;
}

export class DevToolsInput {
  private generateRequested = false;
  private collisionDebugRequested = false;

  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(deps: DevToolsDeps) {
    this.onKeyDown = (e) => {
      if (deps.isDialogueActive()) return;
      if (typeof e.key !== "string" || e.repeat) return;
      switch (e.key.toLowerCase()) {
        // Generación de escena IA (dev): G pide el atlas de superficies.
        case "g": this.generateRequested = true; break;
        // B = ciclar la vista de debug (colisiones → blueprint compuesto).
        case "b": this.collisionDebugRequested = true; break;
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** True once per G press (pedir el atlas de superficies del tile activo). */
  consumeGenerateScene(): boolean {
    if (this.generateRequested) {
      this.generateRequested = false;
      return true;
    }
    return false;
  }

  /** True once per B press (ciclar la vista de debug del renderer). */
  consumeToggleCollisionDebug(): boolean {
    if (this.collisionDebugRequested) {
      this.collisionDebugRequested = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
