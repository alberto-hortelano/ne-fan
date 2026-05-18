/** Side panel that piles up every error the client sees, with timestamp and
 *  source tag. Non-blocking: the canvas keeps rendering. Lives in the
 *  right-hand column declared in index.html as <div id="error-log">.
 *
 *  Use the exported `errors` singleton from anywhere:
 *
 *      try { ... }
 *      catch (err) { errors.push("sprite", `${key}: ${err}`, err); throw err; }
 *
 *  Filosofía: nunca se hace un fallback silencioso. Si algo falla aquí queda
 *  registro y el flujo se interrumpe. */

export interface ErrorEntry {
  source: string;
  message: string;
  ts: number;
  detail?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  bridge: "#d9a14a",
  narrative: "#c46a8a",
  sprite: "#7ac08a",
  player: "#a08aff",
  session: "#e36b6b",
  scene: "#69b6d9",
  config: "#bdbd5e",
};

const MAX_ENTRIES = 200;

export class ErrorLog {
  private entries: ErrorEntry[] = [];
  private container: HTMLElement | null = null;

  attach(el: HTMLElement): void {
    this.container = el;
    this.render();
  }

  push(source: string, message: string, err?: unknown): void {
    const ts = Date.now();
    let detail: string | undefined;
    if (err instanceof Error) detail = err.stack ?? err.message;
    else if (err !== undefined) {
      try { detail = JSON.stringify(err); } catch { detail = String(err); }
    }
    this.entries.push({ source, message, ts, detail });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    console.error(`[${source}] ${message}`, err ?? "");
    this.render();
  }

  clear(): void {
    this.entries = [];
    this.render();
  }

  count(): number {
    return this.entries.length;
  }

  private render(): void {
    const el = this.container;
    if (!el) return;
    if (this.entries.length === 0) {
      el.innerHTML = `<div class="error-log__empty">— sin errores —</div>`;
      return;
    }
    const items = this.entries
      .slice()
      .reverse()
      .map((e) => this.renderEntry(e))
      .join("");
    el.innerHTML = `<div class="error-log__header">Errores (${this.entries.length})</div>${items}`;
    el.scrollTop = 0;
  }

  private renderEntry(e: ErrorEntry): string {
    const time = new Date(e.ts).toLocaleTimeString();
    const color = SOURCE_COLORS[e.source] ?? "#bbb";
    const detail = e.detail
      ? `<pre class="error-log__detail">${escapeHtml(e.detail)}</pre>`
      : "";
    return `
      <div class="error-log__entry">
        <div class="error-log__meta">
          <span class="error-log__source" style="color:${color}">${escapeHtml(e.source)}</span>
          <span class="error-log__time">${time}</span>
        </div>
        <div class="error-log__msg">${escapeHtml(e.message)}</div>
        ${detail}
      </div>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const errors = new ErrorLog();
