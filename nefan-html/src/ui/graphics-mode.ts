/** Chip de gráficos del HUD (#gfx-chip + #gfx-panel): indicador SIEMPRE
 *  visible en juego del modo de generación de imágenes IA de la partida, con
 *  panel para cambiarlo en vivo. Es UI de cliente, no de dev: es la MISMA
 *  selección que el jugador hace al crear la partida en el título (con sesión
 *  el bridge persiste el cambio en world.render_mode/character_mode del save
 *  y lo difunde; sin sesión —fixtures— queda en localStorage vía las deps).
 *  Encender una faceta gasta créditos → confirmación en dos clicks (patrón
 *  armed del menú dev). Se oculta solo mientras el título está abierto: ahí
 *  el modo se elige en el propio título. */
import { errors } from "./error-log.js";
import {
  CHAR_MODE_LABELS,
  MODE_COST_LABELS,
  RENDER_MODE_ICONS,
  RENDER_MODE_LABELS,
} from "./mode-labels.js";

export type GraphicsFacet = "scenes" | "characters";

export interface GraphicsModeState {
  scenesOn: boolean;
  charsOn: boolean;
  /** false = backend de skins apagado por config (graphics.ai_skin). */
  charsAvailable: boolean;
  hasSession: boolean;
}

export interface GraphicsModeDeps {
  getState(): GraphicsModeState;
  /** Lanza si el bridge rechaza el cambio — el panel se re-lee y revierte. */
  setMode(facet: GraphicsFacet, mode: "image" | "vector"): Promise<void>;
}

/** Vida del estado "armado" (¿confirmar gasto?) antes de desarmarse solo. */
const ARM_TTL_MS = 5000;

const CHARS_OFF_REASON =
  "Backend de skins apagado por config: activa graphics.ai_skin en nefan-core/src/config.ts";

interface FacetSpec {
  facet: GraphicsFacet;
  rowLabel: string;
  labels: Record<string, string>;
  /** Nota extra bajo el botón de encender (efecto del cambio). */
  imageNote?: string;
}

const FACETS: FacetSpec[] = [
  {
    facet: "scenes",
    rowLabel: "Escenarios",
    labels: RENDER_MODE_LABELS,
  },
  {
    facet: "characters",
    rowLabel: "Personajes",
    labels: CHAR_MODE_LABELS,
    imageNote: "re-pide los skins de todo lo ya en escena",
  },
];

export class GraphicsModeChip {
  private chip: HTMLButtonElement;
  private panel: HTMLElement;
  private note: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>(); // "facet:mode"
  /** Facetas armadas (primer click de encendido) → timestamp del click. */
  private armed = new Map<GraphicsFacet, number>();
  /** Ocultación externa (título abierto) — manda sobre todo lo demás.
   *  Empieza en true: el título se muestra al arrancar y el chip solo aparece
   *  cuando se cierra (nueva partida, resume o modo fixtures). */
  private hiddenByTitle = true;

  constructor(private deps: GraphicsModeDeps) {
    this.chip = document.getElementById("gfx-chip") as HTMLButtonElement;
    this.panel = document.getElementById("gfx-panel") as HTMLElement;
    this.note = document.createElement("div");
    this.note.className = "gfx-note";
    this.panel.append(this.note);
    for (const spec of FACETS) {
      this.panel.append(this.buildRow(spec));
    }
    this.chip.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    // Click fuera del chip/panel = cerrar (comportamiento de popover).
    document.addEventListener("pointerdown", (ev) => {
      if (!this.isOpen) return;
      const t = ev.target as Node;
      if (!this.panel.contains(t) && !this.chip.contains(t)) this.close();
    });
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.panel.hidden = false;
    this.refresh();
  }

  close(): void {
    this.panel.hidden = true;
    this.armed.clear();
  }

  /** Oculta chip y panel mientras el título está abierto (ahí el modo se
   *  elige en el propio título). */
  setHidden(hidden: boolean): void {
    this.hiddenByTitle = hidden;
    this.chip.hidden = hidden;
    if (hidden) this.close();
  }

  /** Re-sincroniza chip y panel con el estado real. Barato: se llama desde
   *  applyRenderModes en cada cambio de modo (local o difundido). */
  refresh(): void {
    const now = performance.now();
    for (const [facet, at] of this.armed) {
      if (now - at > ARM_TTL_MS) this.armed.delete(facet);
    }
    const st = this.deps.getState();
    this.renderChip(st);
    this.renderPanel(st);
  }

  private renderChip(st: GraphicsModeState): void {
    this.chip.hidden = this.hiddenByTitle;
    let text: string;
    if (st.scenesOn === st.charsOn) {
      const mode = st.scenesOn ? "image" : "vector";
      text = `${RENDER_MODE_ICONS[mode]} ${RENDER_MODE_LABELS[mode]}`;
    } else {
      text = `${RENDER_MODE_ICONS.image}/${RENDER_MODE_ICONS.vector} Mixto`;
    }
    this.chip.textContent = text;
    const sc = st.scenesOn ? "image" : "vector";
    const ch = st.charsOn ? "image" : "vector";
    this.chip.title =
      `Gráficos de la partida — escenarios: ${RENDER_MODE_LABELS[sc]} · ` +
      `personajes: ${CHAR_MODE_LABELS[ch]}. Click para cambiar.`;
  }

  private renderPanel(st: GraphicsModeState): void {
    if (!this.isOpen) return;
    this.note.textContent = st.hasSession
      ? "El cambio se aplica en vivo y se guarda en la partida."
      : "Sin partida (modo fixtures): el modo se recuerda en este navegador.";
    for (const spec of FACETS) {
      const on = spec.facet === "scenes" ? st.scenesOn : st.charsOn;
      const active = on ? "image" : "vector";
      for (const mode of ["image", "vector"] as const) {
        const btn = this.buttons.get(`${spec.facet}:${mode}`)!;
        btn.classList.toggle("active", mode === active);
        const armedNow = mode === "image" && this.armed.has(spec.facet);
        btn.classList.toggle("armed", armedNow);
        const label = btn.querySelector(".gfx-label") as HTMLElement;
        label.textContent = armedNow
          ? "¿Confirmar? Gastará créditos"
          : `${RENDER_MODE_ICONS[mode]} ${spec.labels[mode]}`;
        if (mode === "image" && spec.facet === "characters") {
          btn.disabled = !st.charsAvailable;
          btn.title = st.charsAvailable ? "" : CHARS_OFF_REASON;
        }
      }
    }
  }

  private buildRow(spec: FacetSpec): HTMLElement {
    const row = document.createElement("div");
    row.className = "gfx-row";
    const label = document.createElement("div");
    label.className = "gfx-row-label";
    label.textContent = spec.rowLabel;
    row.append(label);
    const seg = document.createElement("div");
    seg.className = "gfx-seg";
    for (const mode of ["image", "vector"] as const) {
      const btn = document.createElement("button");
      const main = document.createElement("span");
      main.className = "gfx-label";
      btn.append(main);
      const sub = document.createElement("span");
      sub.className = "gfx-sub";
      const extra = mode === "image" && spec.imageNote ? ` · ${spec.imageNote}` : "";
      sub.textContent = `${MODE_COST_LABELS[mode]}${extra}`;
      btn.append(sub);
      btn.addEventListener("click", () => void this.onSelect(spec.facet, mode));
      this.buttons.set(`${spec.facet}:${mode}`, btn);
      seg.append(btn);
    }
    row.append(seg);
    return row;
  }

  private async onSelect(facet: GraphicsFacet, mode: "image" | "vector"): Promise<void> {
    const st = this.deps.getState();
    const currentOn = facet === "scenes" ? st.scenesOn : st.charsOn;
    // Guard no-op: el bridge rechaza pedir el modo que la partida ya tiene.
    if ((mode === "image") === currentOn) return;
    // Encender = empezar a gastar créditos → confirmación en dos clicks.
    if (mode === "image" && !this.armed.has(facet)) {
      this.armed.set(facet, performance.now());
      this.refresh();
      return;
    }
    this.armed.delete(facet);
    try {
      await this.deps.setMode(facet, mode);
    } catch (err) {
      errors.push("graphics-mode", `no se pudo cambiar ${facet} a ${mode}`, err);
    } finally {
      // setMode desemboca en applyRenderModes → refresh(); este refresh cubre
      // el camino de error (revert implícito: se relee el estado real).
      this.refresh();
    }
  }
}
