/** Acciones de juego como BOTONES, con su tecla siempre a la vista.
 *
 *  El teclado sigue siendo el camino principal; esto no lo sustituye, lo
 *  duplica para el ratón (y deja el terreno preparado para táctil). Ambos
 *  entran por el MISMO sitio: `invoke()` empuja la intención al
 *  InputProvider igual que haría la tecla, así que aguas abajo son
 *  indistinguibles y no hay lógica de juego duplicada.
 *
 *  El DOM se DIFEA por firma: reconstruir botones a 60 fps no solo es caro,
 *  es que un nodo recreado entre el pointerdown y el mouseup se come el
 *  click. */

export interface GameAction {
  /** Id estable — clave del diff y de la foto para el bench. */
  id: string;
  /** Etiqueta en español, con el objetivo ya resuelto ("hablar con Marta"). */
  label: string;
  /** Tecla equivalente tal como se pinta ("E", "Y", "1", "LMB"). */
  key: string;
  enabled?: boolean;
  /** Resaltado (ataque seleccionado, salida del lado que se empuja). */
  active?: boolean;
  tone?: "neutral" | "danger";
  invoke(): void;
}

function signature(a: GameAction): string {
  return `${a.id}|${a.label}|${a.key}|${a.enabled !== false}|${a.active === true}|${a.tone ?? "neutral"}`;
}

export class ActionBar {
  private lastSig = "";

  constructor(private el: HTMLElement) {}

  /** Foto completa de las acciones del slot. Llamable por frame: si nada
   *  cambió, no toca el DOM. */
  set(actions: readonly GameAction[]): void {
    const sig = actions.map(signature).join("§");
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.el.replaceChildren();
    for (const action of actions) this.el.appendChild(this.button(action));
  }

  private button(action: GameAction): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nf-action";
    btn.dataset.action = action.id;
    if (action.active) btn.dataset.active = "true";
    if (action.tone) btn.dataset.tone = action.tone;
    btn.disabled = action.enabled === false;

    if (action.key) {
      const kbd = document.createElement("kbd");
      kbd.className = "nf-key";
      kbd.textContent = action.key;
      btn.appendChild(kbd);
    }
    const label = document.createElement("span");
    label.className = "nf-label";
    label.textContent = action.label;
    btn.appendChild(label);

    // El botón NUNCA coge el foco: con foco se tragaría Espacio y Enter, que
    // el diálogo usa para avanzar.
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", () => action.invoke());
    return btn;
  }

  /** Foto para el bench (window.__nefan.actions()). */
  snapshot(): Array<{ id: string; label: string; key: string; enabled: boolean; active: boolean }> {
    return [...this.el.querySelectorAll<HTMLButtonElement>("button.nf-action")].map((b) => ({
      id: b.dataset.action ?? "",
      label: b.querySelector(".nf-label")?.textContent ?? "",
      key: b.querySelector(".nf-key")?.textContent ?? "",
      enabled: !b.disabled,
      active: b.dataset.active === "true",
    }));
  }
}
