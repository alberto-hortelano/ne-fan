/** Dialogue overlay panel with typewriter effect and choice buttons. */

export type DialogueCallback = () => void;
export type ChoiceCallback = (index: number, text: string) => void;
export type FreeTextCallback = (text: string) => void;

export class DialoguePanel {
  private panel: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private hintEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private _visible = false;
  private _choices: string[] = [];
  private _typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private _fullText = "";
  private _charIndex = 0;
  private _freeTextOpen = false;

  onAdvanced: DialogueCallback = () => {};
  onChoice: ChoiceCallback = () => {};
  onFreeText: FreeTextCallback = () => {};

  constructor() {
    this.panel = document.getElementById("dialogue-panel")!;
    this.speakerEl = document.getElementById("dialogue-speaker")!;
    this.textEl = document.getElementById("dialogue-text")!;
    this.choicesEl = document.getElementById("dialogue-choices")!;

    // Free-text affordance — added once, lives next to the choices block.
    this.hintEl = document.createElement("div");
    this.hintEl.id = "dialogue-hint";
    this.hintEl.style.cssText = "color:#666;font-size:11px;margin-top:8px";
    this.hintEl.textContent = "[T] respuesta libre";
    this.panel.appendChild(this.hintEl);

    this.inputEl = document.createElement("input");
    this.inputEl.id = "dialogue-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "Escribe tu respuesta y pulsa Enter…";
    this.inputEl.style.cssText = [
      "display:none","width:100%","margin-top:8px","padding:6px 8px",
      "background:#1a1a22","color:#ddd","border:1px solid #444",
      "font-family:inherit","font-size:13px",
    ].join(";");
    this.panel.appendChild(this.inputEl);

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const value = this.inputEl.value.trim();
        if (value) {
          this.hide();
          this.onFreeText(value);
        }
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Escape") {
        this._closeFreeText();
        e.preventDefault();
        e.stopPropagation();
      }
    });

    // Keyboard handler for dialogue
    window.addEventListener("keydown", (e) => {
      if (!this._visible) return;
      if (this._freeTextOpen) return;  // input element handles its own keys

      if (e.key === "t" || e.key === "T") {
        this._openFreeText();
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (this._choices.length > 0) {
        // Choice mode: 1, 2, 3...
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < this._choices.length) {
          const text = this._choices[idx];
          this.hide();
          this.onChoice(idx, text);
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        // Advance mode: E, Space, Enter
        if (e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter") {
          // If still typing, show full text immediately
          if (this._typewriterTimer) {
            this._stopTypewriter();
            this.textEl.textContent = this._fullText;
          } else {
            this.hide();
            this.onAdvanced();
          }
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });
  }

  private _openFreeText(): void {
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

  show(speaker: string, text: string, choices?: string[]): void {
    this._visible = true;
    this._choices = choices ?? [];
    this.speakerEl.textContent = speaker;
    this.panel.style.display = "block";

    // Typewriter effect
    this._fullText = text;
    this._charIndex = 0;
    this.textEl.textContent = "";
    this._stopTypewriter();
    this._typewriterTimer = setInterval(() => {
      if (this._charIndex < this._fullText.length) {
        this.textEl.textContent += this._fullText[this._charIndex];
        this._charIndex++;
      } else {
        this._stopTypewriter();
      }
    }, 25); // ~40 chars/sec

    // Choices
    this.choicesEl.innerHTML = "";
    if (this._choices.length > 0) {
      for (let i = 0; i < this._choices.length; i++) {
        const btn = document.createElement("span");
        btn.className = "dialogue-choice";
        btn.textContent = `[${i + 1}] ${this._choices[i]}`;
        const text = this._choices[i];
        btn.addEventListener("click", () => {
          this.hide();
          this.onChoice(i, text);
        });
        this.choicesEl.appendChild(btn);
      }
    }
  }

  hide(): void {
    this._visible = false;
    this._choices = [];
    this._closeFreeText();
    this._stopTypewriter();
    this.panel.style.display = "none";
  }

  /** Snapshot of the currently shown line — useful for the caller to feed into
   *  the bridge as `speaker`/`chosenText` when the player makes a choice. */
  current(): { speaker: string; text: string; choices: string[] } {
    return {
      speaker: this.speakerEl.textContent ?? "",
      text: this._fullText,
      choices: [...this._choices],
    };
  }

  private _stopTypewriter(): void {
    if (this._typewriterTimer) {
      clearInterval(this._typewriterTimer);
      this._typewriterTimer = null;
    }
  }
}
