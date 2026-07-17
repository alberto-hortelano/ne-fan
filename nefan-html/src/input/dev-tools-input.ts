/** Teclas de DESARROLLO del cliente 2D — fijas, fuera del InputProvider:
 *  son del harness (pipeline de imagen IA, debug de colisión), no del esquema
 *  de control del jugador, así que funcionan igual con cualquier provider.
 *
 *  G = regenerar imagen del tile · X = segmentar oclusores · B = ciclar la
 *  vista de debug (off → colisiones → blueprint → imagen IA → segmentación →
 *  placa) · N = descubrir props (si no hay propuesta de tile activa, que la
 *  atiende el provider) · R = revisar blueprint con Claude. */

export interface DevToolsDeps {
  /** El diálogo suprime también las teclas dev (mismo guard que el provider). */
  isDialogueActive(): boolean;
  /** Con propuesta de tile en pantalla, N significa "rechazar" (provider). */
  isTileProposalActive(): boolean;
}

export class DevToolsInput {
  private generateRequested = false;
  private segmentRequested = false;
  private collisionDebugRequested = false;
  private discoverRequested = false;
  private reviewRequested = false;

  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(deps: DevToolsDeps) {
    this.onKeyDown = (e) => {
      if (deps.isDialogueActive()) return;
      if (typeof e.key !== "string" || e.repeat) return;
      switch (e.key.toLowerCase()) {
        // Generación de escena IA (dev): G regenera la imagen del tile actual.
        case "g": this.generateRequested = true; break;
        // X = eXtraer/segmentar oclusores (muros/edificios) de la imagen actual
        // para que tapen al personaje (depth-sort). S está ocupada por movimiento.
        case "x": this.segmentRequested = true; break;
        // B = ciclar la vista de debug (colisiones → fases del pipeline de
        // imagen: blueprint, imagen IA, segmentación, placa inpainted).
        case "b": this.collisionDebugRequested = true; break;
        // N = descubrir props Nuevos que la IA inventó (SAM3 open-vocab).
        case "n":
          if (!deps.isTileProposalActive()) this.discoverRequested = true;
          break;
        // R = Revisar el blueprint con Claude (visión vía MCP) antes de
        // generar con G. Opt-in: requiere terminal de Claude Code escuchando.
        case "r": this.reviewRequested = true; break;
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
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

  /** True once per B press (ciclar la vista de debug del renderer). */
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

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
