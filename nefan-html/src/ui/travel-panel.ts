/** Travel panel (bottom-left corner). Lists the current place's exits as
 *  buttons; clicking one asks the bridge to realize that place. */

import type { SceneExit } from "@nefan-core/src/protocol/messages.js";

// El tipo canónico vive en el protocolo (lo fabrica enrichSceneWithExits);
// se re-exporta para que los consumidores existentes no cambien de import.
export type { SceneExit } from "@nefan-core/src/protocol/messages.js";

export class TravelPanel {
  private el: HTMLElement;
  /** Called with the target place_id when the player picks an exit. */
  onTravel: (placeId: string) => void = () => {};

  constructor() {
    this.el = document.getElementById("travel-panel")!;
  }

  setExits(exits: SceneExit[]): void {
    this.el.innerHTML = "";
    if (!exits || exits.length === 0) {
      this.el.style.display = "none";
      return;
    }
    const title = document.createElement("div");
    title.className = "travel-title";
    title.textContent = "Salidas";
    this.el.appendChild(title);

    for (const exit of exits) {
      const btn = document.createElement("button");
      btn.className = "travel-exit";
      btn.textContent = `→ ${exit.name} (${exit.link_kind})`;
      if (exit.description) btn.title = exit.description;
      btn.addEventListener("click", () => this.onTravel(exit.place_id));
      this.el.appendChild(btn);
    }
    this.el.style.display = "block";
  }

  hide(): void {
    this.el.style.display = "none";
  }
}
