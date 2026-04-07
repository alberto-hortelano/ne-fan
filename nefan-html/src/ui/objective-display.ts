/** Objective text display (top-right corner). */

export class ObjectiveDisplay {
  private el: HTMLElement;

  constructor() {
    this.el = document.getElementById("objective-display")!;
  }

  show(text: string): void {
    this.el.textContent = text;
    this.el.style.display = "block";
  }

  hide(): void {
    this.el.style.display = "none";
  }
}
