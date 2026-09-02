/** Travel panel (bottom-left corner). Lists the current place's exits as
 *  buttons; clicking one asks the bridge to realize that place. */

import type { SceneExit } from "@nefan-core/src/protocol/messages.js";

// El tipo canónico vive en el protocolo (las calcula `src/world-map/exits.ts`
// y las pone el bridge al servir la escena o al cambiar el mapa, #179); se
// re-exporta para que los consumidores existentes no cambien de import.
export type { SceneExit } from "@nefan-core/src/protocol/messages.js";

export class TravelPanel {
  private el: HTMLElement;
  /** Called with the target place_id when the player picks an exit. */
  onTravel: (placeId: string) => void = () => {};

  constructor() {
    this.el = document.getElementById("travel-panel")!;
  }

  setExits(
    exits: SceneExit[],
    opts?: { highlightEdge?: "north" | "south" | "east" | "west" },
  ): void {
    this.el.replaceChildren();
    if (!exits || exits.length === 0) {
      this.el.hidden = true;
      return;
    }
    const highlight = opts?.highlightEdge;
    const EDGE_ES: Record<string, string> = { north: "norte", south: "sur", east: "este", west: "oeste" };
    const title = document.createElement("div");
    title.className = "travel-title";
    title.textContent = highlight ? `Salidas hacia el ${EDGE_ES[highlight]}` : "Salidas";
    this.el.appendChild(title);

    // Con highlight, las salidas del lado cruzado van primero y resaltadas —
    // NO se filtra: el jugador puede seguir eligiendo cualquier destino.
    const ordered = highlight
      ? [...exits].sort((a, b) => Number(b.edge === highlight) - Number(a.edge === highlight))
      : exits;
    for (const exit of ordered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "nf-action travel-exit" + (highlight && exit.edge === highlight ? " travel-exit--highlight" : "");
      btn.textContent = `→ ${exit.name} (${exit.link_kind})`;
      if (exit.description) btn.title = exit.description;
      btn.addEventListener("click", () => this.onTravel(exit.place_id));
      this.el.appendChild(btn);
    }
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
