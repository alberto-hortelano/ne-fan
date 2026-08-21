/** Menú dev de imágenes IA (#dev-menu, botón "Imágenes…" de #dev-status).
 *  Lista de las imágenes actualmente FAKE — tiles sin atlas de superficies,
 *  skins pendientes sobre la base y_bot — con generación por item
 *  (permitida aunque el modo global de gráficos esté en maqueta/y_bot). Los
 *  toggles globales por faceta viven en el chip de gráficos del HUD
 *  (graphics-mode.ts), UI de cliente. Todo por ratón: cero atajos de teclado.
 *  Las acciones que gastan créditos piden confirmación en dos clicks (patrón
 *  armed del title-screen). */
import { errors } from "./error-log.js";

export interface FakeItem {
  kind: "skin" | "fps_atlas";
  /** Clave del tile o prompt del skin — identidad estable del item. */
  id: string;
  label: string;
  thumb: CanvasImageSource | null;
  inFlight: boolean;
  /** Si está presente, el botón Generar va deshabilitado con este motivo. */
  disabledReason?: string;
}

export interface DevMenuDeps {
  listFakeItems(): FakeItem[];
  generate(item: FakeItem): Promise<void>;
  log(msg: string): void;
}

const THUMB_PX = 96;
/** Vida del estado "armado" (¿confirmar gasto?) antes de desarmarse solo. */
const ARM_TTL_MS = 5000;
const POLL_MS = 1000;

export class DevMenu {
  private panel: HTMLElement;
  private itemsEl: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Items armados (primer click hecho) → timestamp del click. */
  private armed = new Map<string, number>();
  /** Generaciones lanzadas desde el menú aún sin resolver. */
  private inFlight = new Set<string>();

  constructor(private deps: DevMenuDeps) {
    this.panel = document.getElementById("dev-menu") as HTMLElement;
    this.itemsEl = document.getElementById("dev-menu-items") as HTMLElement;
    const openBtn = document.getElementById("ds-menu-btn") as HTMLButtonElement;
    const closeBtn = document.getElementById("dm-close") as HTMLButtonElement;
    openBtn.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    closeBtn.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.panel.hidden = false;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  close(): void {
    this.panel.hidden = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.armed.clear();
  }

  /** Re-sincroniza la lista con el estado real. No-op cerrado. */
  refresh(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    for (const [key, at] of this.armed) {
      if (now - at > ARM_TTL_MS) this.armed.delete(key);
    }
    this.renderItems();
  }

  private renderItems(): void {
    const items = this.deps.listFakeItems();
    this.itemsEl.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dm-empty";
      empty.textContent = "Sin imágenes fake: todo lo visible está generado.";
      this.itemsEl.append(empty);
      return;
    }
    for (const item of items) {
      this.itemsEl.append(this.renderItem(item));
    }
  }

  private renderItem(item: FakeItem): HTMLElement {
    const row = document.createElement("div");
    row.className = "dm-item";
    row.append(this.renderThumb(item.thumb));

    const label = document.createElement("div");
    label.className = "dm-label";
    label.textContent = item.label;
    row.append(label);

    const key = `${item.kind}:${item.id}`;
    const btn = document.createElement("button");
    const busy = item.inFlight || this.inFlight.has(key);
    if (busy) {
      btn.textContent = "Generando…";
      btn.disabled = true;
    } else if (item.disabledReason) {
      btn.textContent = "Generar";
      btn.disabled = true;
      btn.title = item.disabledReason;
    } else if (this.armed.has(key)) {
      btn.textContent = "¿Confirmar? Gastará créditos";
      btn.style.borderColor = "#a63";
      btn.style.color = "#da6";
      btn.addEventListener("click", () => void this.runGenerate(key, item));
    } else {
      btn.textContent = "Generar y aplicar";
      btn.addEventListener("click", () => {
        this.armed.set(key, performance.now());
        this.refresh();
      });
    }
    row.append(btn);
    return row;
  }

  private async runGenerate(key: string, item: FakeItem): Promise<void> {
    this.armed.delete(key);
    this.inFlight.add(key);
    this.deps.log(`Generando ${item.label}…`);
    this.refresh();
    try {
      await this.deps.generate(item);
    } catch (err) {
      // Los controllers ya loguean el detalle; esto evita unhandled rejection
      // y deja rastro de QUÉ item pidió el usuario.
      errors.push("dev-menu", `la generación de ${item.label} falló`, err);
    } finally {
      this.inFlight.delete(key);
      this.refresh();
    }
  }

  private renderThumb(source: CanvasImageSource | null): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_PX;
    canvas.height = THUMB_PX;
    if (!source) return canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    const w = (source as { width?: number }).width ?? THUMB_PX;
    const h = (source as { height?: number }).height ?? THUMB_PX;
    if (!w || !h) return canvas;
    const scale = Math.min(THUMB_PX / w, THUMB_PX / h);
    const dw = w * scale;
    const dh = h * scale;
    try {
      ctx.drawImage(source, (THUMB_PX - dw) / 2, (THUMB_PX - dh) / 2, dw, dh);
    } catch (err) {
      errors.push("dev-menu", "miniatura no dibujable", err);
    }
    return canvas;
  }
}
