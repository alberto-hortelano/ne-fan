/** Panel de diálogo: retrato del hablante, texto con efecto de máquina de
 *  escribir y opciones que se eligen con la tecla O con el ratón.
 *
 *  Teclado y click entran por los MISMOS métodos públicos
 *  (chooseByIndex/openFreeText/advance), así que no hay dos caminos que
 *  mantener. Al abrirse suelta el pointer lock: con el ratón capturado el
 *  cursor no existe y las opciones serían inclicables. */

import { alPulsarTecla } from "../input/puerta-de-teclado.js";
import { ActionBar, type GameAction } from "./action-bar.js";

export type DialogueCallback = () => void;
export type ChoiceCallback = (index: number, text: string) => void;
export type FreeTextCallback = (text: string) => void;

/** Identidad del hablante que acompaña a la línea, para el retrato. */
export interface DialogueSpeaker {
  /** Id de la entidad, cuando el bridge pudo resolverlo. */
  id?: string;
}

export class DialoguePanel {
  private panel: HTMLElement;
  private portraitEl: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private choiceBar: ActionBar;
  private inputEl: HTMLInputElement;
  private _visible = false;
  private _choices: string[] = [];
  private _speakerId: string | undefined;
  private _typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private _fullText = "";
  private _charIndex = 0;
  private _freeTextOpen = false;

  onAdvanced: DialogueCallback = () => {};
  onChoice: ChoiceCallback = () => {};
  onFreeText: FreeTextCallback = () => {};

  constructor() {
    this.panel = document.getElementById("dialogue-panel")!;
    this.portraitEl = document.getElementById("dialogue-portrait")!;
    this.speakerEl = document.getElementById("dialogue-speaker")!;
    this.textEl = document.getElementById("dialogue-text")!;
    this.choicesEl = document.getElementById("dialogue-choices")!;
    this.inputEl = document.getElementById("dialogue-input") as HTMLInputElement;
    this.choiceBar = new ActionBar(this.choicesEl);

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const value = this.inputEl.value.trim();
        if (value) {
          this.hide();
          this.onFreeText(value);
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      } else if (e.key === "Escape") {
        this._closeFreeText();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });

    // Click en el cuerpo del panel = misma cortesía que una tecla de acción:
    // completa el texto de golpe en vez de obligar a esperar.
    this.panel.addEventListener("click", (e) => {
      if (this._typewriterTimer && !(e.target as Element).closest("button, input")) {
        this.finishTypewriter();
      }
    });

    // Por la puerta como todo el input de juego (#285): ninguna tecla se
    // registra por fuera, sin excepciones por widget — que es lo que #246
    // decidió para los píxeles.
    alPulsarTecla((e) => {
      if (!this._visible) return;
      if (this._freeTextOpen) return;  // input element handles its own keys

      // Mientras el typewriter corre las opciones no existen aún: una tecla
      // de acción completa el texto en vez de actuar (elegir sin haber
      // podido leer la línea entera).
      const isActionKey =
        e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter" ||
        e.key === "t" || e.key === "T" || (e.key >= "1" && e.key <= "9");
      if (this._typewriterTimer && isActionKey) {
        this.finishTypewriter();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (e.key === "t" || e.key === "T") {
        this.openFreeText();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (this._choices.length > 0) {
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < this._choices.length) {
          this.chooseByIndex(idx);
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } else if (e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter") {
        this.advance();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    });
  }

  // --- Acciones (mismo camino para tecla y para click) ---

  chooseByIndex(index: number): void {
    const text = this._choices[index];
    if (text === undefined) return;
    this.hide();
    this.onChoice(index, text);
  }

  advance(): void {
    this.hide();
    this.onAdvanced();
  }

  openFreeText(): void {
    this._freeTextOpen = true;
    this.inputEl.style.display = "block";
    this.inputEl.value = "";
    this.inputEl.focus();
  }

  private _closeFreeText(): void {
    this._freeTextOpen = false;
    this.inputEl.style.display = "none";
    this.inputEl.value = "";
  }

  get isVisible(): boolean {
    return this._visible;
  }

  /** Id de la entidad que habla en la línea visible (si el bridge lo
   *  resolvió) — lo usa el retrato y viaja de vuelta con la elección. */
  get speakerId(): string | undefined {
    return this._speakerId;
  }

  /** Retrato del hablante: una imagen (hero-shot ya pagado por el pipeline
   *  de skins) o un lienzo animado (busto del ciclo idle). El panel no sabe
   *  de dónde sale; `null` colapsa el hueco. */
  setPortrait(node: HTMLImageElement | HTMLCanvasElement | null): void {
    if (node) this.portraitEl.replaceChildren(node);
    else this.portraitEl.replaceChildren();
  }

  show(speaker: string, text: string, choices?: string[], who?: DialogueSpeaker): void {
    this._visible = true;
    this._choices = choices ?? [];
    this._speakerId = who?.id;
    this.speakerEl.textContent = speaker;
    this.panel.hidden = false;
    // Con el ratón capturado no hay cursor: las opciones no se podrían
    // clicar. Soltarlo es lo que hace jugable el panel en fps.
    if (document.pointerLockElement !== null) document.exitPointerLock();

    this._fullText = text;
    this._charIndex = 0;
    this.textEl.textContent = "";
    this._stopTypewriter();
    this._typewriterTimer = setInterval(() => {
      if (this._charIndex < this._fullText.length) {
        this.textEl.textContent += this._fullText[this._charIndex];
        this._charIndex++;
      } else {
        this.finishTypewriter();
      }
    }, 25); // ~40 chars/sec

    // Las choices se renderizan al completarse el typewriter: verlas antes
    // deja elegir sin haber leído la línea y hace parecer el texto truncado.
    this.choiceBar.set([]);
  }

  /** Completa el texto de golpe y revela las opciones. */
  finishTypewriter(): void {
    this._stopTypewriter();
    this.textEl.textContent = this._fullText;
    this._renderChoices();
  }

  private _renderChoices(): void {
    const actions: GameAction[] = this._choices.map((text, i) => ({
      id: `choice:${i}`,
      label: text,
      key: String(i + 1),
      invoke: () => this.chooseByIndex(i),
    }));
    actions.push({
      id: "free-text",
      label: this._choices.length > 0 ? "responder otra cosa…" : "responder…",
      key: "T",
      invoke: () => this.openFreeText(),
    });
    if (this._choices.length === 0) {
      actions.push({ id: "advance", label: "continuar", key: "E", invoke: () => this.advance() });
    }
    this.choiceBar.set(actions);
  }

  hide(): void {
    this._visible = false;
    this._choices = [];
    this._speakerId = undefined;
    this._closeFreeText();
    this._stopTypewriter();
    this.choiceBar.set([]);
    this.setPortrait(null);
    this.panel.hidden = true;
  }

  /** Snapshot de la línea visible — el caller lo manda al bridge como
   *  `speaker`/`chosenText` al elegir. */
  current(): { speaker: string; text: string; choices: string[]; speakerId?: string } {
    return {
      speaker: this.speakerEl.textContent ?? "",
      text: this._fullText,
      choices: [...this._choices],
      speakerId: this._speakerId,
    };
  }

  private _stopTypewriter(): void {
    if (this._typewriterTimer) {
      clearInterval(this._typewriterTimer);
      this._typewriterTimer = null;
    }
  }
}
