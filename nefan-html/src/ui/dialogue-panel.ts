/** Dialogue overlay panel with typewriter effect and choice buttons. */

export type DialogueCallback = () => void;
export type ChoiceCallback = (index: number) => void;

export class DialoguePanel {
  private panel: HTMLElement;
  private speakerEl: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private _visible = false;
  private _choices: string[] = [];
  private _typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private _fullText = "";
  private _charIndex = 0;

  onAdvanced: DialogueCallback = () => {};
  onChoice: ChoiceCallback = () => {};

  constructor() {
    this.panel = document.getElementById("dialogue-panel")!;
    this.speakerEl = document.getElementById("dialogue-speaker")!;
    this.textEl = document.getElementById("dialogue-text")!;
    this.choicesEl = document.getElementById("dialogue-choices")!;

    // Keyboard handler for dialogue
    window.addEventListener("keydown", (e) => {
      if (!this._visible) return;

      if (this._choices.length > 0) {
        // Choice mode: 1, 2, 3...
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < this._choices.length) {
          this.hide();
          this.onChoice(idx);
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
        btn.addEventListener("click", () => {
          this.hide();
          this.onChoice(i);
        });
        this.choicesEl.appendChild(btn);
      }
    }
  }

  hide(): void {
    this._visible = false;
    this._choices = [];
    this._stopTypewriter();
    this.panel.style.display = "none";
  }

  private _stopTypewriter(): void {
    if (this._typewriterTimer) {
      clearInterval(this._typewriterTimer);
      this._typewriterTimer = null;
    }
  }
}
