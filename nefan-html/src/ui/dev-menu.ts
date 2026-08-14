/** Menú dev de imágenes IA (#dev-menu, botón "Imágenes…" de #dev-status).
 *  Único dueño del panel: toggles runtime por faceta (escenarios/personajes)
 *  y lista de las imágenes actualmente FAKE — platós en clay, tiles sin
 *  imagen IA, skins pendientes sobre la base y_bot — con generación por item
 *  (permitida aunque el toggle global esté OFF). Todo por ratón: cero atajos
 *  de teclado. Las acciones que gastan créditos piden confirmación en dos
 *  clicks (patrón armed del title-screen). */
import { errors } from "./error-log.js";

export interface FakeItem {
  kind: "stage" | "tile" | "skin" | "fps_atlas";
  /** Clave del tile/plató o prompt del skin — identidad estable del item. */
  id: string;
  label: string;
  thumb: CanvasImageSource | null;
  inFlight: boolean;
  /** Si está presente, el botón Generar va deshabilitado con este motivo. */
  disabledReason?: string;
}

export interface DevMenuToggles {
  scenes: boolean;
  characters: boolean;
  /** false = backend de skins apagado por config (graphics.ai_skin) — el
   *  toggle de personajes se muestra deshabilitado con el motivo. */
  charactersAvailable: boolean;
}

export interface DevMenuDeps {
  getToggles(): DevMenuToggles;
  /** Lanza si el bridge rechaza el cambio — el menú revierte el checkbox. */
  setToggle(facet: "scenes" | "characters", on: boolean): Promise<void>;
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
  private scenesToggle: HTMLInputElement;
  private charsToggle: HTMLInputElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Items/toggles armados (primer click hecho) → timestamp del click. */
  private armed = new Map<string, number>();
  /** Generaciones lanzadas desde el menú aún sin resolver. */
  private inFlight = new Set<string>();

  constructor(private deps: DevMenuDeps) {
    this.panel = document.getElementById("dev-menu") as HTMLElement;
    this.itemsEl = document.getElementById("dev-menu-items") as HTMLElement;
    this.scenesToggle = document.getElementById("dm-scenes") as HTMLInputElement;
    this.charsToggle = document.getElementById("dm-chars") as HTMLInputElement;
    const openBtn = document.getElementById("ds-menu-btn") as HTMLButtonElement;
    const closeBtn = document.getElementById("dm-close") as HTMLButtonElement;
    openBtn.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    closeBtn.addEventListener("click", () => this.close());
    this.scenesToggle.addEventListener("change", () => void this.onToggle("scenes"));
    this.charsToggle.addEventListener("change", () => void this.onToggle("characters"));
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

  /** Re-sincroniza toggles y lista con el estado real. No-op cerrado. */
  refresh(): void {
    if (!this.isOpen) return;
    const now = performance.now();
    for (const [key, at] of this.armed) {
      if (now - at > ARM_TTL_MS) this.armed.delete(key);
    }
    this.renderToggles();
    this.renderItems();
  }

  private async onToggle(facet: "scenes" | "characters"): Promise<void> {
    const el = facet === "scenes" ? this.scenesToggle : this.charsToggle;
    const on = el.checked;
    // Encender = empezar a gastar créditos → confirmación en dos clicks.
    const armKey = `toggle:${facet}`;
    if (on && !this.armed.has(armKey)) {
      el.checked = false;
      this.armed.set(armKey, performance.now());
      this.labelFor(el).textContent = "¿Confirmar? Gastará créditos";
      return;
    }
    this.armed.delete(armKey);
    el.disabled = true;
    try {
      await this.deps.setToggle(facet, on);
    } catch (err) {
      errors.push("dev-menu", `no se pudo cambiar ${facet} a ${on ? "image" : "vector"}`, err);
    } finally {
      el.disabled = false;
      this.refresh();
    }
  }

  private labelFor(input: HTMLInputElement): HTMLElement {
    return input.parentElement!.querySelector("span")!;
  }

  private renderToggles(): void {
    const t = this.deps.getToggles();
    this.scenesToggle.checked = t.scenes;
    if (!this.armed.has("toggle:scenes")) {
      this.labelFor(this.scenesToggle).textContent = "Escenarios IA";
    }
    const charsLabel = this.charsToggle.parentElement as HTMLElement;
    this.charsToggle.checked = t.characters && t.charactersAvailable;
    this.charsToggle.disabled = !t.charactersAvailable;
    charsLabel.classList.toggle("dm-off", !t.charactersAvailable);
    charsLabel.title = t.charactersAvailable
      ? "Skins IA por descripción sobre la base y_bot (créditos por personaje)"
      : "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts";
    if (!this.armed.has("toggle:characters")) {
      this.labelFor(this.charsToggle).textContent = "Personajes IA (skins)";
    }
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
